const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

// ── Otimizações de Memória, Autoplay e Anti-Detecção ─────────────────────────
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');

const cfgPath = path.join(__dirname, 'config.json');
const preloadPath = path.join(__dirname, 'preload.js');

let token = null;
let tokenExpiraEm = 0;
let janelaPrincipal = null;

// ─── Conexão Direta ao Twitch IRC (Garante Presença no Chat para o PokeIdle) ──
let chatWs = null;
let canaisAtuaisNoChat = [];
let usuarioIrcAtivo = null;
let tokenIrcAtivo = null;

function sincronizarPresencaNoChat(usuario, tokenAuth, canais) {
  if (!usuario || !tokenAuth || !canais || canais.length === 0) return;

  usuarioIrcAtivo = usuario.toLowerCase();
  tokenIrcAtivo = tokenAuth;
  canaisAtuaisNoChat = canais.map(c => c.toLowerCase());

  // Se o WebSocket já estiver aberto, apenas envia os JOINs
  if (chatWs && chatWs.readyState === 1) { // 1 = OPEN
    for (const canal of canaisAtuaisNoChat) {
      chatWs.send(`JOIN #${canal}\r\n`);
      console.log(`[TwitchIRC] JOIN #${canal}`);
    }
    notificarStatusPresenca();
    return;
  }

  try {
    if (chatWs) {
      try { chatWs.close(); } catch {}
    }

    console.log(`[TwitchIRC] Conectando ao chat como ${usuarioIrcAtivo}...`);
    chatWs = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    chatWs.onopen = () => {
      console.log('[TwitchIRC] WebSocket aberto! Autenticando com Twitch IRC...');
      chatWs.send(`PASS oauth:${tokenIrcAtivo}\r\n`);
      chatWs.send(`NICK ${usuarioIrcAtivo}\r\n`);

      setTimeout(() => {
        for (const canal of canaisAtuaisNoChat) {
          chatWs.send(`JOIN #${canal}\r\n`);
          console.log(`[TwitchIRC] Entrou no chat do canal: #${canal}`);
        }
        notificarStatusPresenca();
      }, 1000);
    };

    chatWs.onmessage = (event) => {
      const msg = String(event.data || '');
      if (msg.startsWith('PING')) {
        chatWs.send('PONG :tmi.twitch.tv\r\n');
      }
    };

    chatWs.onerror = (err) => {
      console.error('[TwitchIRC] Erro de conexão:', err.message || err);
    };

    chatWs.onclose = () => {
      console.log('[TwitchIRC] Conexão encerrada. Reconectando em 10s...');
      setTimeout(() => {
        if (usuarioIrcAtivo && tokenIrcAtivo && canaisAtuaisNoChat.length > 0) {
          sincronizarPresencaNoChat(usuarioIrcAtivo, tokenIrcAtivo, canaisAtuaisNoChat);
        }
      }, 10000);
    };
  } catch (err) {
    console.error('[TwitchIRC] Falha ao inicializar WebSocket:', err);
  }
}

function notificarStatusPresenca() {
  if (janelaPrincipal && !janelaPrincipal.isDestroyed()) {
    janelaPrincipal.webContents.send('chat-presenca-status', {
      conectado: true,
      canais: canaisAtuaisNoChat
    });
  }
}

// ─── Configuração ───────────────────────────────────────────────────────────

function lerCfg() {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('Preencha clientId e clientSecret no config.json.');
  }

  if (!Array.isArray(cfg.canais)) {
    throw new Error('"canais" deve ser uma lista no config.json.');
  }

  cfg.canais = [...new Set(
    cfg.canais
      .map(c => String(c).trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, 10);

  cfg.intervalo = Math.max(30, Number(cfg.intervalo) || 60);

  return cfg;
}

// ─── Token Helix da Twitch (para checar quais canais estão ao vivo) ─────────

async function obterToken(cfg) {
  if (token && Date.now() < tokenExpiraEm - 60_000) {
    return token;
  }

  const corpo = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'client_credentials'
  });

  const resposta = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo.toString()
  });

  const dados = await resposta.json();

  if (!resposta.ok || !dados.access_token) {
    console.error('Erro ao gerar token:', resposta.status, dados);
    throw new Error(`Falha no token da Twitch: HTTP ${resposta.status}`);
  }

  token = dados.access_token;
  tokenExpiraEm = Date.now() + (Number(dados.expires_in || 3600) * 1000);

  return token;
}

// ─── Consultar Lives ────────────────────────────────────────────────────────

async function consultarLives(cfg) {
  if (!cfg.canais.length) return [];

  const accessToken = await obterToken(cfg);
  const params = new URLSearchParams();

  for (const canal of cfg.canais) {
    params.append('user_login', canal);
  }

  let resposta = await fetch(
    `https://api.twitch.tv/helix/streams?${params.toString()}`,
    {
      headers: {
        'Client-Id': cfg.clientId,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (resposta.status === 401) {
    token = null;
    tokenExpiraEm = 0;

    const novoToken = await obterToken(cfg);

    resposta = await fetch(
      `https://api.twitch.tv/helix/streams?${params.toString()}`,
      {
        headers: {
          'Client-Id': cfg.clientId,
          Authorization: `Bearer ${novoToken}`
        }
      }
    );
  }

  const dados = await resposta.json();

  if (!resposta.ok || !Array.isArray(dados.data)) {
    console.error('Erro API Twitch:', resposta.status, dados);
    throw new Error(`Falha ao verificar lives: HTTP ${resposta.status}`);
  }

  return dados.data.map(live => ({
    canal: live.user_login.toLowerCase(),
    titulo: live.title || '',
    jogo: live.game_name || ''
  }));
}

// ─── Sessão compartilhada Twitch ────────────────────────────────────────────

function configurarSessao() {
  const ses = session.fromPartition('persist:twitch-unica');

  const permissoesPermitidas = new Set([
    'media',
    'mediaKeySystem',
    'fullscreen',
  ]);

  ses.setPermissionRequestHandler((_wc, permissao, callback) => {
    callback(permissoesPermitidas.has(permissao));
  });

  ses.setPermissionCheckHandler((_wc, permissao) => {
    return permissoesPermitidas.has(permissao);
  });

  // User-Agent idêntico ao Chrome estável
  ses.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/131.0.0.0 Safari/537.36'
  );

  // Bloquear redes de anúncio que comem RAM
  const dominiosBloqueados = [
    'amazon-adsystem.com',
    'doubleclick.net',
    'googleadservices.com',
    'googlesyndication.com',
    'googletagmanager.com',
    'googletagservices.com',
    'scorecardresearch.com',
    'imasdk.googleapis.com',
  ];

  const filtroAds = {
    urls: dominiosBloqueados.flatMap(d => [`*://${d}/*`, `*://*.${d}/*`])
  };

  ses.webRequest.onBeforeRequest(filtroAds, (_detalhes, callback) => {
    callback({ cancel: true });
  });
}

// ─── Verificar Usuário Autenticado na Sessão ────────────────────────────────

async function verificarUsuarioLogado() {
  try {
    const ses = session.fromPartition('persist:twitch-unica');
    const cookies = await ses.cookies.get({ domain: '.twitch.tv' });
    const auth = cookies.find(c => c.name === 'auth-token');
    const login = cookies.find(c => c.name === 'login');
    const name = cookies.find(c => c.name === 'name');

    if (auth && auth.value) {
      return {
        logado: true,
        usuario: login ? login.value : (name ? name.value : 'sucodesaco_'),
        token: auth.value
      };
    }
  } catch (erro) {
    console.error('Erro ao verificar cookies:', erro);
  }
  return { logado: false, usuario: null, token: null };
}

// ─── Janela de Login na Twitch ──────────────────────────────────────────────

function abrirLogin() {
  const janela = new BrowserWindow({
    width: 600,
    height: 800,
    title: 'Login Twitch - Faça login na conta vinculada ao PokeIdle',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: false,
      partition: 'persist:twitch-unica'
    }
  });

  const timerCheck = setInterval(async () => {
    if (janela.isDestroyed()) {
      clearInterval(timerCheck);
      return;
    }
    const info = await verificarUsuarioLogado();
    if (info.logado) {
      console.log('[Login] Sucesso! Conta autenticada:', info.usuario);
      clearInterval(timerCheck);
      const ses = session.fromPartition('persist:twitch-unica');
      await ses.cookies.flushStore();
      setTimeout(() => {
        if (!janela.isDestroyed()) {
          janela.close();
        }
      }, 1500);
    }
  }, 1500);

  janela.on('closed', async () => {
    clearInterval(timerCheck);
    try {
      const ses = session.fromPartition('persist:twitch-unica');
      await ses.cookies.flushStore();
      const info = await verificarUsuarioLogado();
      if (janelaPrincipal && !janelaPrincipal.isDestroyed()) {
        janelaPrincipal.webContents.send('twitch-login-atualizado', info);
      }
    } catch (erro) {
      console.error('Erro ao salvar sessão Twitch:', erro.message);
    }
  });

  janela.loadURL('https://www.twitch.tv/login');

  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('https://www.twitch.tv/') ||
      url.startsWith('https://passport.twitch.tv/')
    ) {
      janela.loadURL(url);
    } else {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────

ipcMain.handle('config', () => {
  const cfg = lerCfg();
  return {
    canais: cfg.canais,
    intervalo: cfg.intervalo
  };
});

ipcMain.handle('live', async () => {
  const cfg = lerCfg();
  const lives = await consultarLives(cfg);

  // Garante presença via WebSocket IRC em todas as transmissões ao vivo
  const usuarioInfo = await verificarUsuarioLogado();
  if (usuarioInfo.logado && usuarioInfo.token) {
    const canaisOnline = lives.map(l => l.canal);
    sincronizarPresencaNoChat(usuarioInfo.usuario, usuarioInfo.token, canaisOnline);
  }

  return lives;
});

ipcMain.handle('checar-login', async () => {
  return verificarUsuarioLogado();
});

ipcMain.handle('salvar-auth-token', async (_evento, tokenString) => {
  try {
    let tokenLimpo = String(tokenString || '').trim();
    tokenLimpo = tokenLimpo.replace(/^["']|["']$/g, '').replace(/^oauth:\s*/i, '');

    if (!tokenLimpo || tokenLimpo.length < 5) {
      return { sucesso: false, erro: 'Token inválido ou muito curto.' };
    }

    const ses = session.fromPartition('persist:twitch-unica');

    await ses.cookies.set({
      url: 'https://www.twitch.tv',
      name: 'auth-token',
      value: tokenLimpo,
      domain: '.twitch.tv',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
    });

    let nomeUsuario = 'sucodesaco_';

    try {
      const resp = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Authorization': `OAuth ${tokenLimpo}`
        }
      });
      const dados = await resp.json();
      if (dados?.data?.[0]?.login) {
        nomeUsuario = dados.data[0].login;
      }
    } catch {
      // Fallback
    }

    await ses.cookies.set({
      url: 'https://www.twitch.tv',
      name: 'login',
      value: nomeUsuario,
      domain: '.twitch.tv',
      path: '/',
      expirationDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
    });

    await ses.cookies.set({
      url: 'https://www.twitch.tv',
      name: 'name',
      value: nomeUsuario,
      domain: '.twitch.tv',
      path: '/',
      expirationDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
    });

    await ses.cookies.flushStore();

    const info = { logado: true, usuario: nomeUsuario, token: tokenLimpo };
    if (janelaPrincipal && !janelaPrincipal.isDestroyed()) {
      janelaPrincipal.webContents.send('twitch-login-atualizado', info);
    }

    // Inicia presença imediata no chat
    const cfg = lerCfg();
    consultarLives(cfg).then(lives => {
      const canaisOnline = lives.map(l => l.canal);
      sincronizarPresencaNoChat(nomeUsuario, tokenLimpo, canaisOnline);
    }).catch(() => {});

    console.log('[Token] Auth-token importado para:', nomeUsuario);
    return { sucesso: true, usuario: nomeUsuario };
  } catch (err) {
    console.error('Erro ao salvar token manual:', err);
    return { sucesso: false, erro: err.message };
  }
});

ipcMain.on('login', () => {
  abrirLogin();
});

ipcMain.on('abrir-externo', (_evento, url) => {
  try {
    const destino = new URL(url);
    if (destino.protocol === 'https:') {
      shell.openExternal(destino.toString());
    }
  } catch {
    console.warn('URL externa inválida bloqueada:', url);
  }
});

// ─── Inicialização ──────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    configurarSessao();

    janelaPrincipal = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 980,
      minHeight: 650,
      title: 'Twitch Live Viewer - PokeIdle Bonus',
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webviewTag: true
      }
    });

    janelaPrincipal.loadFile(path.join(__dirname, 'public', 'index.html'));

    janelaPrincipal.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  } catch (erro) {
    console.error('Erro ao iniciar:', erro);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (chatWs) {
    try { chatWs.close(); } catch {}
  }
  if (process.platform !== 'darwin') app.quit();
});