const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('twitchMod', {
  getConfig: () => ipcRenderer.invoke('config'),
  getLives: () => ipcRenderer.invoke('live'),
  checarLogin: () => ipcRenderer.invoke('checar-login'),
  salvarAuthToken: (token) => ipcRenderer.invoke('salvar-auth-token', token),
  login: () => ipcRenderer.send('login'),
  abrirExterno: (url) => ipcRenderer.send('abrir-externo', url),
  aoAtualizarLogin: (callback) => {
    ipcRenderer.on('twitch-login-atualizado', (_evento, dados) => {
      callback(dados);
    });
  }
});