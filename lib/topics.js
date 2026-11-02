// Sunucu ve not üretici ortak: dosya yolları ve manifest'ten konu listesi.
const fs = require('fs');
const path = require('path');

const ROOT = process.env.LECTING_ROOT || path.join(__dirname, '..'); // testler başka klasörde çalıştırır
const DATA = path.join(ROOT, 'data');
const LEC = path.join(ROOT, 'lectures'); // lectnote düzeni: lectures/<DERS>/<NN-konu>/notes.md
const SRC = path.join(DATA, 'sources');

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));
const slug = s => s.toLowerCase().replace(/ı/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

// .env: KEY="json-değer" satırları. Okul hesabı ve EVREN anahtarı burada, sadece sahibi okuyabilir (0600).
const ENV_FILE = path.join(ROOT, '.env');
function env() {
  const o = {};
  try {
    for (const l of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = /^(\w+)=(.*)$/.exec(l);
      if (m) { try { o[m[1]] = JSON.parse(m[2]); } catch { o[m[1]] = m[2]; } }
    }
  } catch { /* .env yok */ }
  return o;
}
function saveEnv(updates) { // mevcut satırları koruyup verilenleri günceller
  const all = { ...env(), ...updates };
  fs.writeFileSync(ENV_FILE, Object.entries(all).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n', { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600); // dosya zaten vardıysa mode uygulanmaz
}

function topics() {
  const mf = readJson(path.join(DATA, 'manifest.json'), { courses: {} });
  const prog = readJson(path.join(DATA, 'progress.json'), {}); // { konuId: tamamlanma günü }
  const out = [];
  for (const [course, c] of Object.entries(mf.courses)) {
    c.topics.forEach((t, i) => {
      if (t.hidden) return; // silinen konu manifest'te kalır: kimlikler sıraya bağlı, senkron da geri eklemesin
      const id = `${course}/${String(i + 1).padStart(2, '0')}-${slug(t.title)}`;
      const dir = path.join(LEC, id);
      const yt = /^[\w-]{11}$/.test(t.youtube || '') ? t.youtube : null;
      out.push({
        id, course, courseName: c.name, order: i, title: t.title, file: t.file, minutes: t.minutes || 40,
        youtube: yt, transcript: yt ? path.join(SRC, course, `yt-${yt}.txt`) : null, // YouTube konusunda PDF yok, kaynak altyazı metni
        pdf: yt ? null : path.join(SRC, course, path.basename(t.file).replace(/\.[^.]+$/, '.pdf')), // PPTX/DOCX'in çevrilmiş hali yanında durur
        ready: fs.existsSync(path.join(dir, 'notes.md')),
        audio: fs.existsSync(path.join(dir, 'summary.m4a')),
        hasQuiz: fs.existsSync(path.join(dir, 'quiz.json')),
        done: !!prog[id], doneOn: prog[id] || null,
      });
    });
  }
  return out;
}

module.exports = { ROOT, DATA, LEC, SRC, readJson, writeJson, slug, topics, env, saveEnv };
