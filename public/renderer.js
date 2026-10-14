const grade = document.getElementById('grade');
const status = document.getElementById('status');
const btnLogin = document.getElementById('login');
const sessaoDot = document.querySelector('#sessao-info .dot');
const sessaoTexto = document.getElementById('sessao-texto');
const alertaLogin = document.getElementById('alerta-login');
const btnAlertaLogin = document.getElementById('btn-alerta-login');
const btnAlertaToken = document.getElementById('btn-alerta-token');
const btnAbrirToken = document.getElementById('btn-abrir-token');
const modalToken = document.getElementById('modal-token');
const inputToken = document.getElementById('input-token');
const btnSalvarToken = document.getElementById('btn-salvar-token');
const btnCancelarToken = document.getElementById('btn-cancelar-token');

const cards = {};
let intervalo = 60;
let consultando = false;
let usuarioAtual = null;

// ─── Modal de Token ─────────────────────────────────────────────────────────

function abrirModalToken() {
  if (modalToken) {
    inputToken.value = '';
    modalToken.showModal();
    inputToken.focus();
  }
}

if (btnAbrirToken) btnAbrirToken.addEventListener('click', abrirModalToken);
if (btnAlertaToken) btnAlertaToken.addEventListener('click', abrirModalToken);

if (btnCancelarToken) {
  btnCancelarToken.addEventListener('click', () => {
    modalToken.close();
  });
}

if (btnSalvarToken) {
  btnSalvarToken.addEventListener('click', async () => {
    const val = inputToken.value.trim();
    if (!val) {
      alert('Por favor, cole o auth-token.');
      return;
    }

    btnSalvarToken.textContent = 'Salvando…';
    btnSalvarToken.disabled = true;

    try {
      const res = await window.twitchMod.salvarAuthToken(val);
      if (res && res.sucesso) {
        modalToken.close();
        atualizarIndicadorSessao({ logado: true, usuario: res.usuario });
        recarregarPlayers();
        alert(`Conta ${res.usuario} conectada com sucesso! Recarregando streams...`);
      } else {
        alert('Erro ao salvar token: ' + (res?.erro || 'Tente novamente'));
      }
    } catch (e) {
      alert('Erro inesperado: ' + e.message);
    } finally {
      btnSalvarToken.textContent = 'Salvar e Conectar';
      btnSalvarToken.disabled = false;
    }
  });
}

// ─── Login Tradicional ──────────────────────────────────────────────────────

btnLogin.addEventListener('click', () => {
  window.twitchMod.login();
});

if (btnAlertaLogin) {
  btnAlertaLogin.addEventListener('click', () => {
    window.twitchMod.login();
  });
}

function atualizarIndicadorSessao(info) {
  if (info && info.logado) {
    usuarioAtual = info.usuario;
    sessaoDot.className = 'dot logado';
    sessaoTexto.textContent = `Logado: ${info.usuario}`;
    btnLogin.textContent = `Trocar Conta (${info.usuario})`;
    if (alertaLogin) alertaLogin.style.display = 'none';
  } else {
    usuarioAtual = null;
    sessaoDot.className = 'dot';
    sessaoTexto.textContent = 'Não conectado';
    btnLogin.textContent = 'Entrar na Twitch';
    if (alertaLogin) alertaLogin.style.display = 'block';
  }
}

// ─── URL da stream ──────────────────────────────────────────────────────────

function urlPlayer(canal) {
  return `https://www.twitch.tv/${encodeURIComponent(canal)}`;
}

const UA_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

// ─── Script Injetado no Webview ─────────────────────────────────────────────

const SCRIPT_INJECAO = `
(function() {
  console.log('[TwitchMod] Inicializando modo economico nativo...');

  // 1. Clicar em avisos de conteúdo maduro ("Começar a assistir")
  function dispensarAvisos() {
    const seletores = [
      '[data-a-target="content-classification-gate-overlay-start-watching-button"]',
      'button[data-a-target="player-overlay-mature-accept"]',
      '[data-a-target="consent-banner-accept"]',
      'button.consent-banner__accept'
    ];
    for (const sel of seletores) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        console.log('[TwitchMod] Clicou aviso:', sel);
      }
    }
  }

  // 2. Mudar qualidade para 160p e mutar
  let qualidadeSetada = false;

  function forcar160p() {
    const video = document.querySelector('video');
    if (!video) return;

    video.muted = true;
    video.volume = 0;

    if (qualidadeSetada) return;

    // React Fiber da Twitch
    let el = video;
    while (el) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      if (fiberKey) {
        let fiber = el[fiberKey];
        while (fiber) {
          const props = fiber.memoizedProps;
          const player = props?.mediaPlayerInstance || props?.player;
          if (player && typeof player.getQualities === 'function') {
            const qualities = player.getQualities();
            if (qualities && qualities.length > 0) {
              const target = qualities.find(q => q.group && q.group.includes('160')) ||
                             qualities[qualities.length - 1];
              if (target) {
                player.setQuality(target.group);
                player.setMuted(true);
                qualidadeSetada = true;
                console.log('[TwitchMod] 160p setado via Fiber:', target.group);
                return;
              }
            }
          }
          fiber = fiber.return;
        }
      }
      el = el.parentElement;
    }

    // Fallback menu da Twitch
    const settingsBtn = document.querySelector('button[data-a-target="player-settings-button"]');
    if (settingsBtn) {
      settingsBtn.click();
      setTimeout(() => {
        const botoes = Array.from(document.querySelectorAll('button'));
        const qualBtn = botoes.find(b => {
          const txt = (b.textContent || '').toLowerCase();
          return txt.includes('qualidade') || txt.includes('quality');
        });

        if (qualBtn) {
          qualBtn.click();
          setTimeout(() => {
            const opcoes = Array.from(document.querySelectorAll('div, span, button'));
            const btn160 = opcoes.find(o => (o.textContent || '').trim().includes('160p'));
            if (btn160) {
              btn160.click();
              qualidadeSetada = true;
              console.log('[TwitchMod] 160p setado via Menu');
            }
            setTimeout(() => {
              const fechar = document.querySelector('button[data-a-target="player-settings-button"]');
              if (fechar) fechar.click();
            }, 150);
          }, 200);
        } else {
          settingsBtn.click();
        }
      }, 200);
    }
  }

  // 3. Ativar Modo Teatro (mantém chat ativo em segundo plano)
  function ativarModoTeatro() {
    const teatroBtn = document.querySelector('button[data-a-target="player-theatre-mode-button"]');
    if (teatroBtn) {
      const emTeatro = document.body.classList.contains('theatre-mode') ||
                       document.querySelector('.channel-root--theatre-mode') !== null;
      if (!emTeatro) {
        teatroBtn.click();
      }
    }
  }

  let ciclo = 0;
  const loop = setInterval(() => {
    ciclo++;
    dispensarAvisos();
    ativarModoTeatro();
    forcar160p();

    if (ciclo >= 30 && qualidadeSetada) {
      clearInterval(loop);
      setInterval(() => {
        dispensarAvisos();
        const v = document.querySelector('video');
        if (v && (!v.muted || v.volume > 0)) {
          v.muted = true;
          v.volume = 0;
        }
      }, 30000);
    }
  }, 1500);
})();
`;

// ─── Criar Card de Stream ───────────────────────────────────────────────────

function criarCard(live) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.canal = live.canal;

  const topo = document.createElement('div');
  topo.className = 'card-topo';

  const canal = document.createElement('span');
  canal.className = 'canal';
  canal.textContent = live.canal;

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = live.jogo || live.titulo || '';

  const tagConta = document.createElement('span');
  tagConta.className = 'modo-economico';
  tagConta.style.borderColor = '#9147ff';
  tagConta.style.color = '#bf94ff';
  tagConta.textContent = 'Verificando...';

  const pillEco = document.createElement('span');
  pillEco.className = 'modo-economico';
  pillEco.textContent = '160p MUDO';

  const selo = document.createElement('span');
  selo.className = 'selo';
  selo.textContent = 'AO VIVO';

  // ── Webview com sessão compartilhada ──
  const player = document.createElement('webview');
  player.className = 'player';
  player.setAttribute('partition', 'persist:twitch-unica');
  player.setAttribute('src', urlPlayer(live.canal));
  player.setAttribute('useragent', UA_CHROME);
  player.setAttribute(
    'webpreferences',
    'contextIsolation=yes,nodeIntegration=no'
  );

  player.addEventListener('dom-ready', () => {
    player.executeJavaScript(SCRIPT_INJECAO).catch((e) => {
      console.warn('Erro ao injetar script no webview:', e);
    });

    checarStatusWebview();
  });

  async function checarStatusWebview() {
    try {
      const info = await player.executeJavaScript(`
        (function() {
          const userBtn = document.querySelector('button[data-a-target="user-menu-toggle"]');
          const loginBtn = document.querySelector('button[data-a-target="login-button"]');
          const video = document.querySelector('video');
          return {
            logado: !!userBtn,
            deslogado: !!loginBtn,
            tocando: video && !video.paused && video.readyState >= 2
          };
        })()
      `);

      if (info) {
        if (info.logado) {
          tagConta.style.borderColor = '#00c853';
          tagConta.style.color = '#00c853';
          tagConta.textContent = usuarioAtual ? `👤 ${usuarioAtual}` : '👤 Logado';
        } else if (info.deslogado) {
          tagConta.style.borderColor = '#e91916';
          tagConta.style.color = '#e91916';
          tagConta.textContent = '⚠️ NÃO LOGADO';
        }
      }
    } catch {
      // Ignora erro de recarregamento
    }
  }

  const intervalCheck = setInterval(checarStatusWebview, 4000);

  player.addEventListener('new-window', (evento) => {
    evento.preventDefault();
    window.twitchMod.abrirExterno(evento.url);
  });

  player.addEventListener('did-fail-load', (evento) => {
    if (!evento.isMainFrame || evento.errorCode === -3) {
      return;
    }
    console.warn(`Falha ao carregar ${live.canal}:`, evento.errorCode, evento.errorDescription);
  });

  topo.append(canal, meta, tagConta, pillEco, selo);
  card.append(topo, player);

  return {
    card,
    player,
    meta,
    intervalCheck
  };
}

// ─── Gerenciamento de Cards ─────────────────────────────────────────────────

function atualizarVazio() {
  const vazio = document.getElementById('vazio');
  const quantidade = Object.keys(cards).length;

  if (quantidade === 0 && !vazio) {
    const novo = document.createElement('div');
    novo.id = 'vazio';
    novo.innerHTML = '<strong>Nenhum canal configurado está ao vivo agora.</strong><span>Verifique config.json para adicionar mais streamers.</span>';
    grade.appendChild(novo);
  }

  if (quantidade > 0 && vazio) {
    vazio.remove();
  }
}

function adicionarOuAtualizar(live) {
  const existente = cards[live.canal];

  if (existente) {
    existente.meta.textContent = live.jogo || live.titulo || '';
    return;
  }

  cards[live.canal] = criarCard(live);
  grade.appendChild(cards[live.canal].card);
}

function remover(canal) {
  const registro = cards[canal];

  if (!registro) {
    return;
  }

  try {
    if (registro.intervalCheck) clearInterval(registro.intervalCheck);
    registro.player.stop();
    registro.player.src = 'about:blank';
  } catch {
    // Webview já finalizado
  }

  registro.card.remove();
  delete cards[canal];
}

function recarregarPlayers() {
  for (const [canal, registro] of Object.entries(cards)) {
    try {
      registro.player.loadURL(urlPlayer(canal));
    } catch (erro) {
      console.warn(`Não foi possível recarregar ${canal}:`, erro.message);
    }
  }
}

// ─── Consulta Periódica de Lives ────────────────────────────────────────────

async function atualizar() {
  if (consultando) {
    return;
  }

  consultando = true;

  try {
    status.textContent = 'Verificando lives…';

    const lives = await window.twitchMod.getLives();
    const online = lives.map(live => live.canal.toLowerCase());

    for (const live of lives) {
      live.canal = live.canal.toLowerCase();
      adicionarOuAtualizar(live);
    }

    for (const canal of Object.keys(cards)) {
      if (!online.includes(canal)) {
        remover(canal);
      }
    }

    atualizarVazio();

    const hora = new Date().toLocaleTimeString('pt-BR');

    status.textContent = online.length
      ? `${online.length} live(s) ao vivo — atualizado às ${hora}`
      : `Nenhuma live ao vivo — atualizado às ${hora}`;
  } catch (erro) {
    console.error(erro);
    status.textContent = `Erro: ${erro.message}`;
  } finally {
    consultando = false;
  }
}

async function iniciar() {
  try {
    const loginInfo = await window.twitchMod.checarLogin();
    atualizarIndicadorSessao(loginInfo);

    const cfg = await window.twitchMod.getConfig();
    intervalo = Math.max(30, Number(cfg.intervalo) || 60);

    await atualizar();
    setInterval(atualizar, intervalo * 1000);
  } catch (erro) {
    console.error(erro);
    status.textContent = `Erro de configuração: ${erro.message}`;
  }
}

if (typeof window.twitchMod.aoAtualizarLogin === 'function') {
  window.twitchMod.aoAtualizarLogin((info) => {
    atualizarIndicadorSessao(info);
    setTimeout(recarregarPlayers, 1500);
  });
}

iniciar();