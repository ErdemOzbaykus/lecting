#!/usr/bin/env node
// Notlardaki "(s. 12)" atıflarından, görsel/şema içeren kaynak slaytları deftere ekler (LLM kullanmaz).
// Kullanım: node tools/figures.js [DERS...]   — var olan notlara ekler; build.js yeni notlar için de çağırır.
const fs = require('fs');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const { canonical } = require('../lib/youtube');
const { LEC, topics } = require('../lib/topics');

const PER_SECTION = 2, PER_TOPIC = 8;

// Sayfa başına: {chars: metin uzunluğu, imgs: büyük gömülü görsel sayısı}
function pageInfo(pdf) {
  const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 1 << 28 }).toString().split('\f');
  const info = text.slice(0, -1).map(t => ({ chars: t.replace(/\s+/g, '').length, imgs: 0 }));
  const list = execFileSync('pdfimages', ['-list', pdf], { maxBuffer: 1 << 26 }).toString().split('\n').slice(2);
  for (const l of list) {
    const c = l.trim().split(/\s+/);
    if (+c[3] >= 150 && +c[4] >= 150 && info[c[0] - 1]) info[c[0] - 1].imgs++;
  }
  return info;
}

// Görsel/şema olma ihtimali yüksek sayfa: büyük gömülü resim var ya da metni çok az (çizim ağırlıklı slayt).
const looksVisual = p => p && (p.imgs > 0 || (p.chars > 0 && p.chars < 250));

function addFigures(t) {
  const file = path.join(LEC, t.id, 'notes.md');
  if (t.youtube || !fs.existsSync(file) || !fs.existsSync(t.pdf)) return 0; // YouTube konusunda slayt yok
  const notes = fs.readFileSync(file, 'utf8');
  if (/\]\(photos\/p-\d+\.jpg\)/.test(notes)) return 0; // zaten eklenmiş
  const info = pageInfo(t.pdf);
  const used = new Set();
  const parts = notes.split(/\n(?=## )/).map(sec => {
    const pages = [...sec.matchAll(/\bs\.\s*(\d+(?:\s*[,–-]\s*\d+)*)/g)].flatMap(m => m[1].match(/\d+/g).map(Number));
    const pick = [...new Set(pages)].filter(n => !used.has(n) && looksVisual(info[n - 1])).slice(0, Math.min(PER_SECTION, PER_TOPIC - used.size));
    pick.forEach(n => used.add(n));
    return { sec, pick };
  });
  if (!used.size) return 0;
  const dir = path.join(LEC, t.id, 'photos');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of used) {
    execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=72', '-r', '85', '-f', String(n), '-l', String(n), '-singlefile', t.pdf, path.join(dir, `p-${n}`)]);
  }
  const out = parts.map(({ sec, pick }) => sec.trimEnd() + pick.map(n => `\n\n![Slayt ${n}](photos/p-${n}.jpg)`).join('') + '\n').join('\n');
  fs.writeFileSync(file, out);
  return used.size;
}

// YouTube: notu yazan model, konuşmacının ekranda gösterdiği kritik görselin anını "[[GÖRSEL 12:34]]" satırıyla işaretler.
// Video indirilmez: yt-dlp akış adresini verir, ffmpeg yalnızca o saniyenin karesini çeker. Çekilemeyen işaret satırı silinir.
const MARK = /^[ \t]*\[\[GÖRSEL (\d{1,3}):(\d{2})(?::(\d{2}))?\]\][ \t]*$/gm;
const run = promisify(execFile);
async function addVideoFigures(t) {
  const file = path.join(LEC, t.id, 'notes.md');
  if (!t.youtube || !fs.existsSync(file)) return 0;
  const notes = fs.readFileSync(file, 'utf8');
  const secOf = m => m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  const want = [];
  for (const m of notes.matchAll(MARK)) { const s = secOf(m); if (want.length < PER_TOPIC && !want.some(w => Math.abs(w - s) < 15)) want.push(s); } // aynı ekranın tekrarını alma
  if (!notes.match(MARK)) return 0;
  const got = new Set();
  try {
    if (want.length) {
      const { stdout } = await run(process.env.YTDLP || 'yt-dlp', ['-g', '--no-playlist', '--no-warnings', '-f', 'bv*[height<=720][ext=mp4]/bv*[height<=720]/b', '--', canonical(t.youtube)], { timeout: 120000 });
      const url = stdout.trim().split('\n')[0];
      const dir = path.join(LEC, t.id, 'photos');
      fs.mkdirSync(dir, { recursive: true });
      for (const s of want) {
        try { // +1 sn: konuşmacı "bakın" dedikten sonra ekran oturmuş olur
          await run(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-y', '-ss', String(s + 1), '-i', url, '-frames:v', '1', '-vf', 'scale=min(1280\\,iw):-2', '-q:v', '4', path.join(dir, `v-${s}.jpg`)], { timeout: 90000 });
          if (fs.existsSync(path.join(dir, `v-${s}.jpg`))) got.add(s);
        } catch { /* bu kare olmadı, diğerleri sürsün */ }
      }
    }
  } finally {
    const stamp = s => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}` : Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0');
    fs.writeFileSync(file, notes.replace(MARK, (...m) => { const s = secOf(m); return got.has(s) ? `![Videodan kare ${stamp(s)}](photos/v-${s}.jpg)` : ''; }).replace(/\n{3,}/g, '\n\n'));
  }
  return got.size;
}

module.exports = { addFigures, addVideoFigures, pageInfo, looksVisual };

if (require.main === module) {
  const only = process.argv.slice(2);
  for (const t of topics().filter(t => t.ready && (!only.length || only.includes(t.course)))) {
    try { const n = addFigures(t); console.log(n ? `+${n} görsel` : '  –', t.id); } catch (e) { console.log('HATA', t.id, e.message); }
  }
}
