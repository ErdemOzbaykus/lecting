// Panopto ders kayıtlarını konulara kaynak olarak dağıtır (ağ ve LLM yok, test edilebilir).
// Kayıt metni ~5 dk'lık parçalara bölünür; her parça, slayt metni ona en çok benzeyen konuya gider (TF-IDF kosinüs).
// Böylece bir kayıt birden çok konuyu, bir konu birden çok kaydı kapsayabilir.
const STOP = new Set(('the and for are but not you your this that with have has was were will can all any our out who what when which then than there their them they its into from also just like okay yes so very about would could should because here how why one two may might must let lets get got going know think want see look need make' +
  ' bir ve ile için ama bu şu çok daha gibi kadar olan olarak sonra önce yani evet tamam şimdi burada şey ben sen biz siz onlar var yok değil her ise mi mı mu mü ne nasıl neden diye').split(' '));
const words = s => (s.toLowerCase().match(/[\p{L}][\p{L}\d]{2,}/gu) || []).filter(w => !STOP.has(w));

// "[12:34] metin" satırları -> [{ start (sn), text }] parçaları (en az `sec` saniyelik).
function segments(txt, sec = 300) {
  const out = [];
  for (const l of txt.split('\n')) {
    const m = /^\[(?:(\d+):)?(\d+):(\d{2})\]\s*(.*)$/.exec(l.trim());
    if (!m) continue;
    const t = (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3];
    const cur = out[out.length - 1];
    if (!cur || t - cur.start >= sec) out.push({ start: t, lines: [l.trim()] });
    else cur.lines.push(l.trim());
  }
  return out.map(s => ({ start: s.start, text: s.lines.join('\n') }));
}

function vector(ws, idf) {
  const v = new Map();
  for (const w of ws) if (idf.has(w)) v.set(w, (v.get(w) || 0) + 1);
  let n = 0;
  for (const [w, c] of v) { const x = (1 + Math.log(c)) * idf.get(w); v.set(w, x); n += x * x; }
  n = Math.sqrt(n) || 1;
  for (const [w, x] of v) v.set(w, x / n);
  return v;
}
const cos = (a, b) => { let s = 0; for (const [w, x] of a) s += x * (b.get(w) || 0); return s; };

// topics: [{ id, text }] (slayt metni), recs: [{ key, id, title, text }] (kayıt metni).
// Döner: { konuId: [{ key, id, title, start, text, score }] } — kayıttaki sırasıyla.
// shortcut: yalnızca kelime örtüşmesi; slayt İngilizce, anlatım Türkçeyse eşleşme zayıflar. Sorun olursa eşlemeyi LLM'e yaptır.
function assign(topics, recs, { min = 0.12, margin = 1.15 } = {}) {
  const docs = topics.map(t => words(t.text));
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const idf = new Map([...df].map(([w, n]) => [w, Math.log(1 + topics.length / n)]));
  const tv = docs.map(d => vector(d, idf));
  const out = {};
  for (const r of recs) {
    for (const s of segments(r.text)) {
      const v = vector(words(s.text), idf);
      const sc = tv.map(t => cos(v, t)), best = sc.indexOf(Math.max(...sc));
      const second = Math.max(0, ...sc.filter((_, i) => i !== best));
      if (best < 0 || sc[best] < min || sc[best] < second * margin) continue; // konuşma dışı ya da belirsiz parça
      (out[topics[best].id] ||= []).push({ key: r.key, id: r.id, title: r.title, start: s.start, text: s.text, score: +sc[best].toFixed(3) });
    }
  }
  return out;
}

// Konunun kaynak metni: kayıt başına başlık, altında eşleşen parçalar. Kayıtlar "K1", "K2" ile anılır.
function sourceText(parts, max = 40000) {
  let out = '', last = null;
  for (const p of parts) {
    const head = p.key !== last ? `\n== ${p.key}: ${p.title} ==\n` : '';
    if (out.length + head.length + p.text.length > max) break;
    out += head + p.text + '\n';
    last = p.key;
  }
  return out.trim() + '\n';
}

module.exports = { segments, assign, sourceText, words };
