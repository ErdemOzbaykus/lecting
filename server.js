const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { plan, key } = require('./lib/planner');
const { ROOT, DATA, LEC, SRC, readJson, writeJson, topics, env, saveEnv } = require('./lib/topics');
const evren = require('./tools/evren');
const { loadQuiz } = require('./lib/quiz');
const yt = require('./lib/youtube');
const learn = require('./lib/learn');
const browser = require('./lib/browser');
const { parseAssignments } = require('./lib/parse');

const PORT = +process.env.PORT || 3100;
const F = ['settings', 'progress', 'manifest', 'exams'].reduce((o, n) => ({ ...o, [n]: path.join(DATA, n + '.json') }), {});
const SCORES = path.join(DATA, 'quiz-scores.json');
const DEFAULTS = { mode: 'A', hoursPerDay: 4 };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.m4a': 'audio/mp4', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const inside = (base, rel) => { const p = path.resolve(base, rel.replace(/^\/+/, '')); return p.startsWith(base + path.sep) ? p : null; };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('büyük')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'yok', 'text/plain');
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || ''); // ses ileri/geri sarma için
    if (m) {
      const start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1; // "bytes=-N": son N bayt
      if (!(m[1] || m[2]) || start > end) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); } // geçersiz aralık sunucuyu düşürmesin
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

function state() {
  const hasEvrenKey = !!env().EVREN_KEY;
  const settings = { ...DEFAULTS, provider: hasEvrenKey ? 'evren' : 'claude', model: 'auto', ...readJson(F.settings, {}) };
  const all = topics();
  const exams = readJson(F.exams, []);
  const mf = readJson(F.manifest, { courses: {}, assignments: [] });
  return {
    today: key(new Date()), settings, topics: all,
    exams: exams.map(e => ({ ...e, name: mf.courses[e.course]?.name })),
    plan: plan({ today: new Date(), exams, topics: all, hoursPerDay: settings.hoursPerDay }),
    courses: Object.fromEntries(Object.entries(mf.courses).map(([k, c]) => [k, c.name])),
    assignments: mf.assignments || [],
    quiz: readJson(SCORES, {}), // { konuId: { score, total, date } }
    hasCreds: !!env().IEU_USER, hasEvrenKey,
    sync: readJson(path.join(DATA, 'sync-status.json'), null),
    building: building(), errors: Object.fromEntries(Object.entries(buildErrors()).filter(([id]) => all.some(t => t.id === id && !t.ready))), // { konuId: son hata } — arayüz "üretilemedi" gösterir
  };
}

function topicDetail(id) {
  const t = topics().find(x => x.id === id);
  if (!t || !t.ready) return null;
  const dir = path.join(LEC, t.id);
  const read = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  const questions = read('questions.md').split(/\n\s*\n/).map(b => ({
    q: (/^S:\s*([\s\S]*?)(?=^C:)/m.exec(b) || [])[1]?.trim(),
    a: (/^C:\s*([\s\S]*)$/m.exec(b) || [])[1]?.trim(),
  })).filter(x => x.q && x.a);
  return { id: t.id, course: t.course, title: t.title, notes: read('notes.md'), questions, quiz: loadQuiz(dir), audio: t.audio, youtube: t.youtube };
}

// Ders başına tek defter: dersin hazır konularının notları sırayla, hazır olmayanlar yer tutucu.
function notebook(course) {
  const mf = readJson(F.manifest, { courses: {} });
  if (!mf.courses[course]) return null;
  const chapters = topics().filter(t => t.course === course).map(t => {
    const d = t.ready ? topicDetail(t.id) : null;
    return { ...t, ...d, title: (d && /^#\s+(.+)$/m.exec(d.notes)?.[1]) || t.title };
  });
  return { course, name: mf.courses[course].name, chapters };
}

function startBuild(course) {
  const log = fs.openSync(path.join(DATA, 'build.log'), 'a');
  spawn(process.execPath, [path.join(ROOT, 'tools/build.js'), ...(course ? [course] : [])], { detached: true, stdio: ['ignore', log, log] }).unref();
}
// build.js çalışırken data/build.lock içinde pid'i durur
function building() {
  try { process.kill(+fs.readFileSync(path.join(DATA, 'build.lock'), 'utf8'), 0); return true; } catch { return false; }
}
// Konunun ürettiği her şey (not, özet, ses, test, görseller); kaynak dosyaya dokunmaz.
const clearTopic = id => fs.rmSync(path.join(LEC, id), { recursive: true, force: true });
// Son build hatası: "HH:MM:SS HATA: <id> <mesaj>" / "BAŞARISIZ: <id> ..." satırları; sonra "hazır:" geldiyse silinir.
function buildErrors() {
  let log = '';
  try { const fd = fs.openSync(path.join(DATA, 'build.log'), 'r'), st = fs.fstatSync(fd), n = Math.min(st.size, 200e3), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd); log = b.toString(); } catch { return {}; }
  const out = {};
  for (const l of log.split('\n')) {
    const m = /(HATA|BAŞARISIZ|kaynak yok):\s+([A-Z0-9]+\/[\w-]+)\s*(.*)$/.exec(l), ok = /(hazır|not üretiliyor[^:]*):\s+([A-Z0-9]+\/[\w-]+)/.exec(l);
    if (m) out[m[2]] = (m[1] === 'kaynak yok' ? 'kaynak dosya yok' : m[3].replace(/^\d+\s*/, '') || 'not dosyaları yazılmadı').slice(0, 160);
    else if (ok) delete out[ok[2]];
  }
  return out;
}

// Ödevi IEULearn'de giriş yapılmış açar (lib/browser.js): sunucu Chrome'un kimliğiyle girer, çerezleri o profile koyar.
async function openAssignment(id) {
  const e = env();
  if (!e.IEU_USER || !e.IEU_PASS) throw new Error('Okul hesabı girilmemiş (Ayarlar).');
  const v = await browser.chrome(path.join(DATA, 'learn-chrome'));
  const jar = await learn.loginLearn(e, v['User-Agent']);
  const a = parseAssignments(await (await learn.assignmentsFragment(jar)).text(), learn.LEARN).find(x => x.id === id);
  if (!a?.url) throw new Error('Bu ödev IEULearn listesinde bulunamadı.');
  await browser.openWithCookies(v, a.url, jar.c);
}

async function api(req, res, u) {
  const p = u.pathname;
  if (p === '/api/state') return send(res, 200, state());
  if (p === '/api/notebook') {
    const nb = notebook(u.searchParams.get('course'));
    return nb ? send(res, 200, nb) : send(res, 404, { error: 'yok' });
  }
  if (p === '/api/topic') {
    const d = topicDetail(u.searchParams.get('id'));
    return d ? send(res, 200, d) : send(res, 404, { error: 'yok' });
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'yok' });

  if (p === '/api/upload') { // FENG 497 gibi okul sitesinde olmayan kaynaklar elle eklenir
    const course = u.searchParams.get('course');
    const name = path.basename(u.searchParams.get('name') || '');
    const mf = readJson(F.manifest, { courses: {} });
    if (!mf.courses[course] || !/^[\w .()\-]+\.(pdf|pptx?|docx?)$/i.test(name)) return send(res, 400, { error: 'geçersiz ders veya dosya' });
    const buf = await readBody(req, 300e6);
    fs.mkdirSync(path.join(SRC, course), { recursive: true });
    fs.writeFileSync(path.join(SRC, course, name), buf);
    const c = mf.courses[course];
    if (!c.topics.some(t => t.file === name)) { c.topics.push({ title: name.replace(/\.[^.]+$/, ''), file: name }); writeJson(F.manifest, mf); }
    startBuild(course);
    return send(res, 200, { ok: true });
  }

  const body = JSON.parse((await readBody(req, 1e5)).toString() || '{}');
  if (p === '/api/youtube') { // YouTube videosu kaynak olarak eklenir; altyazı build.js'te alınır
    const id = yt.parseUrl(body.url), mf = readJson(F.manifest, { courses: {} }), c = mf.courses[body.course];
    if (!c || !id) return send(res, 400, { error: 'geçersiz ders veya YouTube bağlantısı' });
    if (c.topics.some(t => t.youtube === id)) return send(res, 200, { ok: true, duplicate: true });
    c.topics.push({ title: (await yt.fetchTitle(id)) || 'YouTube ' + id, youtube: id });
    writeJson(F.manifest, mf);
    startBuild(body.course);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/assignment-open') {
    try { await openAssignment(String(body.id)); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (p === '/api/credentials') { // okul hesabı ve EVREN anahtarı yalnızca bu bilgisayarda .env'de tutulur, hiçbir yanıtta geri dönmez
    const { user, pass, evrenKey } = body, clean = s => typeof s === 'string' && s.trim() && !/[\r\n]/.test(s);
    const up = {};
    if (user || pass) { if (!clean(user) || !clean(pass)) return send(res, 400, { error: 'geçersiz hesap' }); up.IEU_USER = user; up.IEU_PASS = pass; }
    if (evrenKey) { if (!clean(evrenKey)) return send(res, 400, { error: 'geçersiz anahtar' }); up.EVREN_KEY = evrenKey.trim(); }
    if (!Object.keys(up).length) return send(res, 400, { error: 'boş' });
    saveEnv(up);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/provider-test') { // kullanıcı "Bağlantıyı dene"ye basınca: anahtar geçerli mi, hangi modeller var?
    const key = env().EVREN_KEY;
    if (!key) return send(res, 200, { ok: false, message: 'Anahtar girilmemiş' });
    try { return send(res, 200, await evren.listModels(key)); } catch (e) { return send(res, 200, { ok: false, message: 'Ulaşılamadı: ' + e.message }); }
  }
  if (p === '/api/build') { // "Notları üret": eksik not/ses/testleri üretir (ders verilmezse hepsi)
    const mf = readJson(F.manifest, { courses: {} });
    if (body.course && !mf.courses[body.course]) return send(res, 400, { error: 'bilinmeyen ders' });
    if (building()) return send(res, 409, { error: 'Üretim zaten sürüyor. Bitince eksik kalanlar için yeniden bas.' });
    startBuild(body.course);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/topic-reset' || p === '/api/topic-delete') {
    const t = topics().find(x => x.id === body.id);
    if (!t) return send(res, 400, { error: 'bilinmeyen konu' });
    if (building()) return send(res, 409, { error: 'Şu an not üretiliyor. Bitince tekrar dene.' }); // build yarıda yazarken silmeyelim
    clearTopic(t.id);
    if (p === '/api/topic-reset') { startBuild(t.course); return send(res, 200, { ok: true }); }
    const mf = readJson(F.manifest, { courses: {} });
    mf.courses[t.course].topics[t.order].hidden = true;
    writeJson(F.manifest, mf);
    const prog = readJson(F.progress, {}); delete prog[t.id]; writeJson(F.progress, prog);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/sync') {
    const log = fs.openSync(path.join(DATA, 'sync.log'), 'a');
    spawn(process.execPath, [path.join(ROOT, 'tools/sync.js')], { detached: true, stdio: ['ignore', log, log] }).unref();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/settings') {
    const { mode, hoursPerDay, provider, model } = body;
    if (!['A', 'B'].includes(mode) || !(hoursPerDay >= 0.5 && hoursPerDay <= 16) || !['claude', 'evren'].includes(provider) || !/^[\w.:\/-]{1,60}$/.test(model)) return send(res, 400, { error: 'geçersiz ayar' });
    writeJson(F.settings, { mode, hoursPerDay, provider, model });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/quiz-score') { // konunun son test skoru; progress.json biçimine dokunmaz
    const { id, score, total } = body;
    if (!topics().some(t => t.id === id) || !Number.isInteger(score) || !Number.isInteger(total) || total < 1 || total > 50 || score < 0 || score > total) return send(res, 400, { error: 'geçersiz skor' });
    const all = readJson(SCORES, {});
    all[id] = { score, total, date: key(new Date()) };
    writeJson(SCORES, all);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/done') {
    if (!topics().some(t => t.id === body.id)) return send(res, 400, { error: 'bilinmeyen konu' });
    const prog = readJson(F.progress, {});
    if (body.done) prog[body.id] = key(new Date()); else delete prog[body.id];
    writeJson(F.progress, prog);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'yok' });
}

http.createServer(async (req, res) => {
  try {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, 'host', 'text/plain'); // DNS rebinding
    if (req.method === 'POST' && req.headers['x-lecting'] !== '1') return send(res, 403, 'no', 'text/plain'); // başka siteden gelen POST'u engeller
    const u = new URL(req.url, 'http://x');
    const p = decodeURIComponent(u.pathname);
    if (p.startsWith('/api/')) return await api(req, res, u);
    let m;
    if ((m = /^\/lectures\/([A-Z0-9]+\/[\w-]+)\/summary\.m4a$/.exec(p))) return serveFile(req, res, path.join(LEC, m[1], 'summary.m4a'));
    if ((m = /^\/lectures\/([A-Z0-9]+\/[\w-]+)\/photos\/([pv]-\d+\.jpg)$/.exec(p))) return serveFile(req, res, path.join(LEC, m[1], 'photos', m[2]));
    if (p === '/vendor/markdown-it.min.js') return serveFile(req, res, path.join(ROOT, 'node_modules/markdown-it/dist/markdown-it.min.js'));
    if (p.startsWith('/vendor/katex/')) return serveFile(req, res, inside(path.join(ROOT, 'node_modules/katex/dist'), p.slice(14)) || '/nope');
    return serveFile(req, res, inside(path.join(ROOT, 'public'), p === '/' ? 'index.html' : p) || '/nope');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message) });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}`));
