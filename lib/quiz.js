// Konu testi (lectures/<id>/quiz.json): şema, sıkı doğrulama, okuma/yazma. Cevap karşılaştırma public/quiz.js'te.
// Şema: { version: 1, questions: [ soru, ... ] }; her soru { type, q, explain, page? } +
//   mcq:   options (2-6, birbirinden farklı), answer (0 tabanlı sıra)
//   fill:  q içinde tam bir "___", answer (boş değil), alts (kabul edilen diğer yazımlar)
//   tf:    answer (true/false)
//   match: pairs [{ l, r }] (3-6, sol ve sağ kendi içinde farklı)
const fs = require('fs');
const path = require('path');

const MIN = 4, MAX = 10; // LLM 6-8 üretir; geçerli kalan MIN'in altına düşerse test hiç yazılmaz

// Her iki sağlayıcının promptuna giren şema anlatımı.
const QUIZ_SPEC = `Çıktı yalnızca tek bir JSON nesnesi olsun: {"questions":[ ... ]}. 6-8 soru, karışık türde (en az 3 farklı tür). Türler:
- {"type":"mcq","q":"...","options":["...","...","...","..."],"answer":1,"explain":"...","page":12}
  Çoktan seçmeli: 3-4 seçenek, yalnızca biri doğru; answer = doğru seçeneğin 0'dan başlayan sırası.
- {"type":"fill","q":"Ohm yasasına göre ___ akımla orantılıdır.","answer":"gerilim","alts":["voltaj"],"explain":"..."}
  Boşluk doldurma: q içinde boşluk tam bir kez "___"; answer kısa (1-3 kelime); alts = kabul edilebilir diğer yazımlar (yoksa []).
- {"type":"tf","q":"...","answer":true,"explain":"..."}
  Doğru/Yanlış: answer true veya false (JSON boolean).
- {"type":"match","q":"Eşleştir.","pairs":[{"l":"...","r":"..."},{"l":"...","r":"..."},{"l":"...","r":"..."}],"explain":"..."}
  Eşleştirme: 3-5 çift; sol değerler kendi içinde, sağ değerler kendi içinde farklı. En fazla 1 tane.
Kurallar: yalnızca nottaki bilgiye dayan, uydurma; Türkçe yaz (teknik terimler İngilizce kalabilir); formülleri KaTeX ile $...$ yaz;
explain = neden doğru olduğunu anlatan 1-2 cümle; page = yalnızca notta o bilgi için "(s. N)" atfı varsa sayı (ör. 12 ya da "4, 6"), yoksa page alanını hiç yazma.
Kod bloğu ve ek açıklama yazma.`;

const str = (s, max) => (typeof s === 'string' && s.trim() && s.trim().length <= max ? s.trim() : null);
const pageRef = p => { // "12", 12, "4, 6", "4-6"; başka her şey atılır (soru yine geçerli)
  const s = String(p ?? '').trim();
  return /^\d{1,4}(\s*[,–-]\s*\d{1,4})*$/.test(s) ? s : undefined;
};

// Tek soruyu doğrular ve sadeleştirir; geçersizse null.
function question(r) {
  if (!r || typeof r !== 'object') return null;
  const q = str(r.q, 600), explain = str(r.explain, 800);
  if (!q || !explain) return null;
  const out = { type: r.type, q, explain };
  const page = pageRef(r.page);
  if (page) out.page = page;
  if (r.type === 'mcq') {
    const options = Array.isArray(r.options) ? r.options.map(o => str(o, 300)) : [];
    if (options.length < 2 || options.length > 6 || options.some(o => !o) || new Set(options.map(o => o.toLowerCase())).size !== options.length) return null;
    if (!Number.isInteger(r.answer) || r.answer < 0 || r.answer >= options.length) return null;
    return { ...out, options, answer: r.answer };
  }
  if (r.type === 'tf') return typeof r.answer === 'boolean' ? { ...out, answer: r.answer } : null;
  if (r.type === 'fill') {
    const answer = str(r.answer, 100);
    if (!answer || (q.match(/_{3,}/g) || []).length !== 1) return null;
    const alts = Array.isArray(r.alts) ? r.alts.map(a => str(a, 100)).filter(Boolean) : [];
    return { ...out, answer, alts };
  }
  if (r.type === 'match') {
    const pairs = Array.isArray(r.pairs) ? r.pairs.map(p => ({ l: str(p?.l, 200), r: str(p?.r, 200) })) : [];
    if (pairs.length < 3 || pairs.length > 6 || pairs.some(p => !p.l || !p.r)) return null;
    if (new Set(pairs.map(p => p.l.toLowerCase())).size !== pairs.length || new Set(pairs.map(p => p.r.toLowerCase())).size !== pairs.length) return null;
    return { ...out, pairs };
  }
  return null;
}

// LLM çıktısı (kod bloğu veya önünde/arkasında açıklama olabilir) -> doğrulanmış test; yeterli geçerli soru yoksa hata.
function parseQuiz(text, min = MIN) {
  let s = String(text ?? '');
  const fence = /```(?:json)?[ \t]*\n?([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1];
  const a = s.search(/[{[]/), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  let raw;
  try { raw = JSON.parse(a < 0 ? s : s.slice(a, b + 1)); } catch { throw new Error('Test yanıtı JSON değil'); }
  const list = Array.isArray(raw) ? raw : raw?.questions;
  if (!Array.isArray(list)) throw new Error('Test yanıtında "questions" listesi yok');
  const seen = new Set(), questions = [];
  for (const r of list) {
    const q = question(r);
    if (q && !seen.has(q.q.toLowerCase())) { seen.add(q.q.toLowerCase()); questions.push(q); }
  }
  if (questions.length < min) throw new Error(`Testte yeterli geçerli soru yok (${questions.length}/${list.length}, en az ${min})`);
  return { version: 1, questions: questions.slice(0, MAX) };
}

const file = dir => path.join(dir, 'quiz.json');
function saveQuiz(dir, quiz) { // geçici dosyaya yazıp yeniden adlandırır: sunucu yarım dosya okumasın
  fs.writeFileSync(file(dir) + '.tmp', JSON.stringify(quiz, null, 2));
  fs.renameSync(file(dir) + '.tmp', file(dir));
}
function loadQuiz(dir) { // yok ya da bozuksa null: oturum eskisi gibi testsiz biter
  try { return parseQuiz(fs.readFileSync(file(dir), 'utf8'), 1); } catch { return null; }
}

module.exports = { MIN, MAX, QUIZ_SPEC, parseQuiz, saveQuiz, loadQuiz };
