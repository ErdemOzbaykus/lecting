// EVREN (OpenAI uyumlu sohbet API'si) ile not üretimi. Claude'a göre limit harcamaz.
// Slayt metni `pdftotext` ile çıkar, API'ye yalnızca metin gider (görsel göndermiyoruz).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { QUIZ_SPEC, parseQuiz, saveQuiz } = require('../lib/quiz');

const base = () => (process.env.EVREN_BASE || 'https://evren-llmapi.ssyz.org.tr').replace(/\/+$/, '');
const MAX_CHARS = 40000; // tek istekte slayt metni üst sınırı; fazlası parçalara bölünür
const wait = ms => new Promise(r => setTimeout(r, ms));

// 429/5xx'te Retry-After'a (yoksa 15/30/45/60 sn) uyup 5 kez dener; hata mesajını sağlayıcıdan aynen alır. Başarılı Response döner.
// init.signal: çağıranın ek iptali (akış durunca).
async function request(url, key, init, ms = 300000) {
  for (let n = 1; ; n++) {
    let r;
    try {
      r = await fetch(`${base()}${url}`, { method: 'POST', ...init, headers: { ...init.headers, authorization: `Bearer ${key}` }, signal: AbortSignal.any([AbortSignal.timeout(ms), ...(init.signal ? [init.signal] : [])]) });
    } catch (e) { // EVREN yoğunken yanıtsız kalabiliyor ya da bağlantı kopabiliyor: bir kez daha dene
      if ((e.name === 'TimeoutError' || e.message === 'fetch failed') && n < 2) continue;
      throw e;
    }
    if (r.ok) return r;
    if ((r.status === 429 || r.status >= 500) && n < 5) { await wait((+r.headers.get('retry-after') || 15 * n) * 1000); continue; } // "Model şu anda dolu" dakikalarca sürebiliyor
    const j = await r.json().catch(() => ({}));
    throw new Error(`EVREN ${r.status}: ${j.error?.message || j.message || JSON.stringify(j).slice(0, 200)}`);
  }
}
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// Akış yanıtını birleştirir; bitiş işareti gelmeden kopan yanıt hatadır (yarım not yazılmasın). Akışsız JSON da kabul edilir.
async function readChat(r, idle) {
  if (!/event-stream/.test(r.headers.get('content-type') || '')) return (await r.json().catch(() => ({}))).choices?.[0]?.message?.content;
  const dec = new TextDecoder();
  let text = '', buf = '', done = false, timer;
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error('EVREN yanıtı durdu')), STALL); };
  kick();
  try {
    for await (const chunk of r.body) {
      kick();
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.startsWith('data:')) continue;
        let j;
        try { j = JSON.parse(l.slice(5)); } catch { continue; } // "[DONE]"
        if (j.error) throw new Error('EVREN: ' + (j.error.message || JSON.stringify(j.error).slice(0, 200)));
        text += j.choices?.[0]?.delta?.content || '';
        if (j.choices?.[0]?.finish_reason) done = true;
      }
    }
  } catch (e) { throw idle.signal.aborted ? idle.signal.reason : e; } finally { clearTimeout(timer); }
  if (!done) throw new Error('EVREN yanıtı yarıda kesildi');
  return text;
}

// Akışlı istenir; EVREN yük altında yanıtı yarıda dondurabiliyor: STALL sn ilerlemezse kesip bir kez yeniden dener.
let STALL = 90000;
async function chat({ key, model, messages }) {
  for (let n = 1; ; n++) {
    const idle = new AbortController();
    let text;
    try {
      text = await readChat(await request('/v1/chat/completions', key, { ...json({ model, messages, temperature: 0.2, stream: true }), signal: idle.signal }, 1800000), idle);
    } catch (e) {
      if (n < 2 && /durdu|yarıda/.test(e.message)) continue;
      throw e;
    }
    if (!text) throw new Error('EVREN boş yanıt döndü');
    return text.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1').trim(); // sarmalayan kod bloğunu aç
  }
}
const setStall = ms => { STALL = ms; }; // testler için

// Konuşma tanıma (qwen3-asr). Yanıt tek parça metin, zaman damgası yok: çağıran sesi kısa parçalara böler.
async function transcribe(key, wav) {
  const f = new FormData();
  f.append('file', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), path.basename(wav)); // tür verilmezse süreyi yanlış okuyor
  f.append('model', 'qwen3-asr-1.7b');
  return String((await (await request('/v1/audio/transcriptions', key, { body: f }, 60000)).json()).text || '').trim(); // 30 sn'lik parça normalde 5 sn sürer
}

// Metinden ses (voxcpm2): 48 kHz mono WAV döner.
async function speech(key, input) {
  return Buffer.from(await (await request('/v1/audio/speech', key, json({ model: 'voxcpm2', input, response_format: 'wav' }), 180000)).arrayBuffer());
}

// Küçük metin parçalarını MAX_CHARS'ı aşmayacak büyük parçalara birleştirir (slayt sayfaları, altyazı satırları).
function pack(parts) {
  const out = [];
  let cur = '';
  for (const part of parts) {
    if (cur && cur.length + part.length > MAX_CHARS) { out.push(cur); cur = ''; }
    cur += part;
  }
  if (cur) out.push(cur);
  return out;
}

// Sayfaları "[Sayfa N]" ile işaretleyip parçalara böler.
const chunks = pages => pack(pages.map((p, i) => `[Sayfa ${i + 1}]\n${p.trim()}\n\n`));

const SYS = 'Sen üniversite öğrencileri için sınava hazırlık notu hazırlayan dikkatli bir asistansın. Yalnızca verilen metne dayanırsın, uydurmazsın.';

const notesPrompt = (t, text, first) => `Ders: ${t.course} ${t.courseName}. Konu: ${t.title}.
Aşağıda bir ders slaytının sayfa sayfa metni var ("[Sayfa N]" ile işaretli). Bundan Türkçe, anlaşılır bir ders notu yaz.

Kurallar:
- Teknik terimleri İngilizce bırak, ilk geçtiği yerde Türkçesini parantez içinde ver.
- ${first ? '"# Konu başlığı" ile başla, sonra' : 'Başlık yazma, doğrudan'} ${first ? '4-8' : '3-6'} adet "## Alt başlık" bölümü yaz. Her bölüm tek başına okunabilsin, 1-3 dakikada bitsin.
- Formülleri KaTeX ile yaz: $...$ veya $$...$$. Kritik yerleri **kalın** yap.
- Her bölümde dayandığın slaytı belirt: (s. 12) veya (s. 4, 6).${t.lecture ? '\n- ' + LECTURE_RULE : ''}
- Sınavda çıkabilecek noktaları bölüm sonunda "> **Sınav ipucu:** ..." satırıyla işaretle.
- Metinde olmayan bilgi ekleme. Şema veya resim yüzünden anlaşılmayan yeri tahmin etme, atla.
- Çıktı yalnızca Markdown olsun, başka açıklama yazma.

--- SLAYT METNİ ---
${text}${t.lecture ? `\n\n--- HOCANIN DERS ANLATIMI (Panopto kaydından yazıya çevrildi) ---\n${t.lecture}` : ''}`;

// Videoda gösterilen kritik görselin anı; tools/figures.js o saniyenin karesini notlara koyar.
// Konuya eşleşen ders kaydı parçaları (lib/lectures.js) varsa not ona da dayanır; build.js'teki Claude istemi de kullanır.
const LECTURE_RULE = 'Hocanın ders anlatımı da verildi ("== K1: ... ==" başlıklı, "[12:34]" damgalı; otomatik yazıya çevrildi, hata içerebilir). Slaytta olmayan açıklamaları, örnekleri ve hocanın vurguladığı noktaları ilgili bölüme ekle ve dayandığın anı (K1 12:34) biçiminde belirt. Anlatımın bu konuyla ilgisiz kısımlarını, yoklama ve duyuruları kullanma.';

const YT_VISUAL = 'Konuşmacı ekranda kritik bir görsel gösterip ona atıf yapıyorsa (şema, devre, grafik, tablo, formül, kod; "burada gördüğünüz", "this diagram", "as you can see" gibi), o anın hemen ardına ayrı bir satırda yalnızca [[GÖRSEL 12:34]] yaz (o anın zaman damgası). Konu başına en fazla 8 tane; konuşmacının yüzü veya giriş ekranı için yazma.';

// YouTube altyazısı için aynı kurallar; sayfa yerine "(12:34)" zaman damgası atfı.
// Ders içeriği olmayan derste Panopto kaydı konu olur; adı (tarih) yerine model içeriğe göre başlık koyar, lib/topics.js konu adını ondan alır.
const PN_TITLE = '"# " başlığı kaydın anlattığı konunun kısa adı olsun (en fazla 8 kelime); tarih, gün, "ders kaydı" ya da hafta numarası yazma.';

const ytNotesPrompt = (t, text, first) => `Ders: ${t.course} ${t.courseName}. ${t.panopto ? 'Kaynak: hocanın ders kaydı.' : `Konu: ${t.title}.`}
Aşağıda bir ders videosunun zaman damgalı altyazı metni var ("[12:34]" veya "[1:02:34]" ile işaretli; otomatik altyazı olabilir, yazım hataları içerebilir). Bundan Türkçe, anlaşılır bir ders notu yaz.

Kurallar:
- Teknik terimleri İngilizce bırak, ilk geçtiği yerde Türkçesini parantez içinde ver.
- ${first ? '"# Konu başlığı" ile başla, sonra' : 'Başlık yazma, doğrudan'} ${first ? '4-8' : '3-6'} adet "## Alt başlık" bölümü yaz. Her bölüm tek başına okunabilsin, 1-3 dakikada bitsin.
- Formülleri KaTeX ile yaz: $...$ veya $$...$$. Kritik yerleri **kalın** yap.
- Her bölümde dayandığın anı videodaki zaman damgasıyla belirt: (12:34) veya (1:02:34). Yalnızca bu biçim, "s." veya "dk" yazma.
- ${YT_VISUAL}${t.panopto && first ? '\n- ' + PN_TITLE : ''}
- Sınavda çıkabilecek noktaları bölüm sonunda "> **Sınav ipucu:** ..." satırıyla işaretle.
- Metinde olmayan bilgi ekleme. Anlaşılmayan veya bozuk yeri tahmin etme, atla. Selamlaşma ve konu dışı sohbeti notlara alma.
- Çıktı yalnızca Markdown olsun, başka açıklama yazma.

--- ALTYAZI METNİ ---
${text}`;

const tailPrompt = notes => `Aşağıdaki ders notuna dayanarak iki şey üret.

1) "===ÖZET===" satırından sonra, sesli okunacak 30-45 saniyelik (80-110 kelime) Türkçe özet. Düz metin; formül, sembol, madde işareti yok; kısaltmaları harf harf okutmayacak şekilde aç (ör. "SMPS" yerine "anahtarlamalı güç kaynağı").
2) "===SORULAR===" satırından sonra 4 kısa soru. Her soru için "S: ..." satırı, hemen altında "C: ..." satırı (1-2 cümle); sorular arasında boş satır.

Yalnızca bu iki bölümü yaz.

--- NOT ---
${notes.slice(0, 30000)}`;

// Yanıtı özet ve sorulara ayırır; biçim bozuksa hata verir (yarım not yazılmasın).
function parseTail(txt) {
  const m = /===ÖZET===\s*([\s\S]*?)\s*===SORULAR===\s*([\s\S]*)$/.exec(txt);
  const summary = m?.[1].trim(), questions = m?.[2].trim();
  if (!summary || !/^S:/m.test(questions || '') || !/^C:/m.test(questions)) throw new Error('EVREN yanıtı özet/soru biçiminde değil');
  return { summary, questions };
}

function pdfPages(pdf) {
  return execFileSync('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 1 << 28 }).toString().split('\f').slice(0, -1);
}

// t: topics() öğesi, pdf: kaynak PDF, dir: ders klasörü. notes.md, summary.txt, questions.md yazar.
async function generate(t, pdf, dir, o) {
  const pages = pdfPages(pdf);
  if (pages.join('').replace(/\s+/g, '').length < 200) throw new Error('PDF\'den metin çıkmadı (taranmış/görsel ağırlıklı olabilir)');
  return writeNotes(t, chunks(pages), notesPrompt, dir, o);
}

// YouTube: txt = lib/youtube.js'in yazdığı zaman damgalı altyazı dosyası.
async function generateYoutube(t, txt, dir, o) {
  const lines = fs.readFileSync(txt, 'utf8').split('\n').filter(l => l.trim());
  if (lines.join('').length < 100) throw new Error('altyazı metni çok kısa');
  return writeNotes(t, pack(lines.map(l => l + '\n')), ytNotesPrompt, dir, o);
}

async function writeNotes(t, texts, promptFor, dir, { key, model }) {
  const parts = [];
  for (const [i, c] of texts.entries()) {
    parts.push(await chat({ key, model, messages: [{ role: 'system', content: SYS }, { role: 'user', content: promptFor(t, c, i === 0) }] }));
  }
  const notes = parts.join('\n\n');
  const { summary, questions } = parseTail(await chat({ key, model, messages: [{ role: 'system', content: SYS }, { role: 'user', content: tailPrompt(notes) }] }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.txt'), summary + '\n');
  fs.writeFileSync(path.join(dir, 'questions.md'), questions + '\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), notes + '\n'); // en son: notes.md varlığı "hazır" demek
}

const quizPrompt = (t, notes) => `Ders: ${t.course} ${t.courseName}. Konu: ${t.title}.
Aşağıdaki ders notuna dayanarak öğrencinin kendini sınaması için bir test hazırla.

${QUIZ_SPEC}

--- NOT ---
${notes.slice(0, 30000)}`;

// Yalnızca notes.md'den test üretir (notları yeniden üretmez); geçerli soru yetmezse hata verir, dosya yazılmaz.
async function generateQuiz(t, dir, { key, model }) {
  const notes = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8');
  const text = await chat({ key, model, messages: [{ role: 'system', content: SYS }, { role: 'user', content: quizPrompt(t, notes) }] });
  saveQuiz(dir, parseQuiz(text));
}

// Ayarlar ekranındaki "Bağlantıyı dene": anahtar geçerli mi, hangi modeller açık?
async function listModels(key) {
  const r = await fetch(`${base()}/v1/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, message: j.error?.message || j.message || 'istek reddedildi' };
  return { ok: true, status: r.status, models: (j.data || []).map(m => m.id).slice(0, 30) };
}

module.exports = { LECTURE_RULE, PN_TITLE, notesPrompt, ytNotesPrompt, chat, setStall, transcribe, speech, chunks, pack, parseTail, generate, generateYoutube, generateQuiz, listModels, YT_VISUAL };
