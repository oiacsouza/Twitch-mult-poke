const { app, session } = require('electron');

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:twitch-unica');
  const cookies = await ses.cookies.get({ domain: '.twitch.tv' });
  console.log('=== VERIFICACAO COOKIES TWITCH ===');
  console.log('Total cookies:', cookies.length);
  const loginCookie = cookies.find(c => c.name === 'login');
  const nameCookie = cookies.find(c => c.name === 'name');
  const authCookie = cookies.find(c => c.name === 'auth-token');
  console.log('Login:', loginCookie ? loginCookie.value : 'NAO ENCONTRADO');
  console.log('Name:', nameCookie ? nameCookie.value : 'NAO ENCONTRADO');
  console.log('Auth-token:', authCookie ? 'PRESENTE (' + authCookie.value.substring(0, 8) + '...)' : 'NAO ENCONTRADO');
  app.quit();
});
