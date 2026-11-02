// YouTube kaynağı: URL doğrulama, başlık, altyazı (yt-dlp) -> zaman damgalı düz metin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const evren = require('../tools/evren');

const run = promisify(execFile);
const YTDLP = () => process.env.YTDLP || 'yt-dlp';
const ID = /^[\w-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

// Yalnızca youtube.com/watch?v=, youtu.be/<id> ve /shorts/<id>; 11 karakterlik id'yi döndürür, değilse null.
function parseUrl(input) {
  if (typeof input !== 'string' || input.length > 300) return null;
  let u;
  try { u = new URL(input.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = u.pathname.slice(1).replace(/\/$/, '');
  else if (HOSTS.has(host)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = /^\/shorts\/([^/]+)\/?$/.exec(u.pathname); id = m?.[1]; }
  }
  return ID.test(id || '') ? id : null;
}
const canonical = id => `https://www.youtube.com/watch?v=${id}`;

// Başlık: oEmbed (anahtarsız). Alınamazsa null; çağıran yedek başlık kullanır.
async function fetchTitle(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonical(id))}`, { signal: AbortSignal.timeout(8000) });
    const t = (await r.json()).title;
    return typeof t === 'string' ? t.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120) || null : null;
  } catch { return null; }
}

const stamp = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s % 60).padStart(2, '0'); };
const secs = t => { const [h, m, s] = t.split(':'); return +h * 3600 + +m * 60 + +s; }; // "00:01:02.500"

// VTT -> "[mm:ss] metin" paragrafları. Otomatik altyazıdaki kayan (tekrarlanan) satırlar atılır;
// yaklaşık 20 sn'lik parçalar tek damgayla birleşir.
function vttToText(vtt, gap = 20) {
  const out = [];
  let last = '', from = -1e9, cur = null;
  for (const block of vtt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const m = /^(?:(\d+):)?(\d+):(\d+)[.,]\d+/.exec(lines[i].trim());
    if (!m) continue;
    const start = secs(`${m[1] || 0}:${m[2]}:${m[3]}`);
    for (let l of lines.slice(i + 1)) {
      l = l.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      if (!l || l === last) continue;
      last = l;
      if (!cur || start - from >= gap) { cur = { t: start, text: [] }; out.push(cur); from = start; }
      cur.text.push(l);
    }
  }
  return out.map(c => `[${stamp(c.t)}] ${c.text.join(' ')}`).join('\n') + (out.length ? '\n' : '');
}

// Önce elle girilmiş, yoksa otomatik altyazı; tr sonra en. Video indirilmez. Başarısızlıkta Türkçe mesajlı Error.
// evrenKey: altyazı yoksa ses EVREN'de yazıya çevrilir (yoksa ya da başarısızsa yerel whisper).
async function fetchTranscript(id, outFile, evrenKey) {
  if (!ID.test(id)) throw new Error('geçersiz YouTube kimliği');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lecting-yt-'));
  try {
    for (const [flag, order] of [['--write-subs', ['tr', 'en']], ['--write-auto-subs', ['tr-orig', 'en-orig', 'tr', 'en']]]) {
      try {
        await run(YTDLP(), ['--skip-download', '--no-playlist', '--no-warnings', flag, '--sub-langs', order.join(','), '--sub-format', 'vtt',
          '-o', path.join(tmp, '%(id)s.%(ext)s'), '--', canonical(id)], { timeout: 120000, maxBuffer: 1 << 24 });
      } catch (e) { // 429 vb. ikinci denemeyi (otomatik) engellemesin; hiç dosya yoksa sonunda hata verilir
        if (e.code === 'ENOENT') throw new Error('yt-dlp kurulu değil (brew install yt-dlp)');
        if (flag === '--write-auto-subs' && !fs.readdirSync(tmp).length) throw new Error('yt-dlp başarısız: ' + String(e.stderr || e.message).trim().slice(-300));
      }
      const files = fs.readdirSync(tmp);
      const lang = order.find(l => files.includes(`${id}.${l}.vtt`));
      if (!lang) continue;
      const text = vttToText(fs.readFileSync(path.join(tmp, `${id}.${lang}.vtt`), 'utf8'));
      if (!text.trim()) continue;
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, text);
      return { lang, auto: flag === '--write-auto-subs' };
    }
    await transcribe(id, tmp, outFile, evrenKey); // altyazı yok: sesi yazıya çevir
    return { lang: 'ses', auto: true };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Altyazısız video: yt-dlp ile yalnızca ses -> ffmpeg 16 kHz wav -> EVREN (qwen3-asr) ya da whisper.cpp (whisper-cli, dil otomatik) -> aynı metin biçimi.
// Whisper'da ses bilgisayardan çıkmaz. Model: WHISPER_MODEL ya da data/models/ggml-large-v3-turbo-q5_0.bin
const WHISPER = () => process.env.WHISPER || 'whisper-cli';
const MODEL = () => process.env.WHISPER_MODEL || path.join(process.env.LECTING_ROOT || path.join(__dirname, '..'), 'data/models/ggml-large-v3-turbo-q5_0.bin');
const PART = 30; // sn; EVREN her istek için tek metin döndürür, damga parça başından gelir
const tool = async (bin, args, timeout, what) => {
  try { await run(bin, args, { timeout, maxBuffer: 1 << 26 }); } catch (e) {
    throw new Error(e.code === 'ENOENT' ? `${bin} kurulu değil` : `${what} başarısız: ` + String(e.stderr || e.message).trim().slice(-300));
  }
};
async function transcribe(id, tmp, outFile, evrenKey) {
  if (!evrenKey && !fs.existsSync(MODEL())) throw new Error(`videoda altyazı yok ve konuşma tanıma modeli kurulu değil (${MODEL()}). Not üretilemedi.`);
  await tool(YTDLP(), ['-f', 'bestaudio', '--no-playlist', '--no-warnings', '-o', path.join(tmp, 'a.%(ext)s'), '--', canonical(id)], 15 * 60e3, 'ses indirme');
  const src = fs.readdirSync(tmp).find(f => f.startsWith('a.'));
  if (!src) throw new Error('videonun sesi indirilemedi');
  await tool(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-y', '-i', path.join(tmp, src), '-ar', '16000', '-ac', '1', path.join(tmp, 'a.wav')], 15 * 60e3, 'ses dönüştürme');
  let text = '';
  if (evrenKey) {
    try { text = await viaEvren(tmp, evrenKey); } catch (e) {
      if (!fs.existsSync(MODEL())) throw new Error('EVREN sesi yazıya çeviremedi: ' + e.message);
    }
  }
  if (!text.trim() && fs.existsSync(MODEL())) text = await viaWhisper(tmp);
  if (!text.trim()) throw new Error('videoda anlaşılır konuşma bulunamadı. Not üretilemedi.');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text);
}

// shortcut: parçalar sessizliğe değil süreye göre kesilir, sınırdaki kelime bölünebilir; sorun olursa ffmpeg silencedetect ile kes.
async function viaEvren(tmp, key) {
  await tool(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-y', '-i', path.join(tmp, 'a.wav'), '-f', 'segment', '-segment_time', String(PART), '-c', 'copy', path.join(tmp, 'p%05d.wav')], 15 * 60e3, 'ses bölme');
  const parts = fs.readdirSync(tmp).filter(f => /^p\d{5}\.wav$/.test(f)).sort();
  let out = '', bad = 0;
  for (const [i, f] of parts.entries()) {
    let t;
    try { t = await evren.transcribe(key, path.join(tmp, f)); } catch (e) { // EVREN bazı parçalarda yanıtsız kalıyor: tek tük olanı yerelde çevir, sık olursa tümü whisper'a
      if (++bad > 2 || !fs.existsSync(MODEL())) throw e;
      t = (await viaWhisper(tmp, path.join(tmp, f))).replace(/^\[[\d:]+\] /gm, '');
    }
    t = t.replace(/\s+/g, ' ').trim();
    if (t) out += `[${stamp(i * PART)}] ${t}\n`;
  }
  return out;
}

async function viaWhisper(tmp, wav = path.join(tmp, 'a.wav')) {
  fs.rmSync(path.join(tmp, 'w.srt'), { force: true }); // önceki parçanın çıktısı karışmasın
  await tool(WHISPER(), ['-m', MODEL(), '-f', wav, '-l', 'auto', '-osrt', '-of', path.join(tmp, 'w'), '-np'], 3 * 3600e3, 'konuşma tanıma');
  return fs.existsSync(path.join(tmp, 'w.srt')) ? vttToText(fs.readFileSync(path.join(tmp, 'w.srt'), 'utf8')) : '';
}

module.exports = { parseUrl, canonical, fetchTitle, vttToText, fetchTranscript, ID };
