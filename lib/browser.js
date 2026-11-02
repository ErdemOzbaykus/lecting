// IEULearn'i giriş yapılmış halde açmak için ayrı bir Chrome profili (data/learn-chrome).
// IEULearn girişten sonra hep /student'a döner ve başka sitenin çerezini kullanıcının tarayıcısına veremeyiz;
// bu profili ise DevTools protokolüyle (CDP) yönetebiliyoruz: sunucunun oturum çerezlerini koyup sayfayı açarız.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function version(dir) { // çalışan profilin { webSocketDebuggerUrl, 'User-Agent' } bilgisi, yoksa null
  try {
    const port = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  } catch { return null; }
}

async function chrome(dir) {
  let v = await version(dir);
  if (v) return v;
  if (!fs.existsSync(CHROME)) throw new Error('Google Chrome bulunamadı');
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, 'DevToolsActivePort'), { force: true });
  spawn(CHROME, [`--user-data-dir=${dir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 75; i++) { await sleep(200); if ((v = await version(dir))) return v; }
  throw new Error('Chrome açılamadı');
}

function cdp(url) {
  const ws = new WebSocket(url), wait = new Map();
  let id = 0;
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Chrome bağlantısı kurulamadı')); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data), w = wait.get(m.id);
    if (w) { wait.delete(m.id); m.error ? w[1](new Error(m.error.message)) : w[0](m.result); }
  };
  return {
    send: async (method, params = {}) => { await ready; return new Promise((res, rej) => { wait.set(++id, [res, rej]); ws.send(JSON.stringify({ id, method, params })); }); },
    close: () => ws.close(),
  };
}

// cookies: { ad: değer } — url'nin sitesine yazılır, sonra url yeni sekmede öne gelir.
async function openWithCookies(v, url, cookies) {
  const c = cdp(v.webSocketDebuggerUrl);
  try {
    await c.send('Storage.setCookies', { cookies: Object.entries(cookies).map(([name, value]) => ({ name, value, url, secure: true, httpOnly: true })) });
    const { targetId } = await c.send('Target.createTarget', { url });
    await c.send('Target.activateTarget', { targetId });
  } finally { c.close(); }
}

module.exports = { chrome, openWithCookies };
