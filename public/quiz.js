// Test cevap kontrolü ve karıştırma: tarayıcı (window.Quiz) ve testler (require) ortak kullanır.
(function (root, make) { if (typeof module === 'object') module.exports = make(); else root.Quiz = make(); })(this, () => {
  // Türkçe yerel ayarla küçültme (I -> ı, İ -> i), baş/son boşluk atılır, iç boşluklar tekleştirilir.
  const norm = s => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr');
  const shuffle = (a, rnd = Math.random) => {
    a = [...a];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  // Gösterim için hazırlar: çoktan seçmelide şıkları karıştırır (answer yeni sıraya taşınır), eşleştirmede sağ sütunu karıştırır.
  function prep(q, rnd) {
    if (q.type === 'mcq') {
      const order = shuffle(q.options.map((_, i) => i), rnd);
      return { ...q, options: order.map(i => q.options[i]), answer: order.indexOf(q.answer) };
    }
    if (q.type === 'match') return { ...q, rights: shuffle(q.pairs.map(p => p.r), rnd) };
    return q;
  }
  // a: mcq -> seçilen sıra, tf -> boolean, fill -> yazılan metin, match -> her sol satır için seçilen sağ metin
  function isCorrect(q, a) {
    if (q.type === 'mcq' || q.type === 'tf') return a === q.answer;
    if (q.type === 'fill') return typeof a === 'string' && !!norm(a) && [q.answer, ...(q.alts || [])].some(x => norm(x) === norm(a));
    if (q.type === 'match') return Array.isArray(a) && q.pairs.every((p, i) => a[i] === p.r);
    return false;
  }
  return { norm, shuffle, prep, isCorrect };
});
