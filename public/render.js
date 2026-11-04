// Not işleme: markdown + KaTeX + formül kartları. Tarayıcı (window.Render) ve testler (require) ortak kullanır.
(function (root, make) { if (typeof module === 'object') module.exports = make(); else root.Render = make(); })(this, () => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // ":::formül Başlık" … ":::" — ilk paragraf formül, kalanı not.
  const FORMUL = /^:::[ \t]*form[üu]l[ \t]*([^\n]*)\n([\s\S]*?)\n:::[ \t]*$/gm;
  const fbox = (label, eq, note, plain) => `<div class="fbox" role="group"${label ? ` aria-label="${esc(plain)}"` : ''}><div>${label ? `<div class="flabel">${label}</div>` : ''}${eq}</div>${note ? `<div class="fnote">${note}</div>` : ''}</div>`;
  const bare = h => h.replace(/<\/?p>/g, '').trim();

  // render(src, id, yt, cards): cards=true yalnızca notlarda; sorular/testte formül karta sarılmaz.
  return function make(md, katex, YT_ID) {
    return function render(src, id, yt, cards) {
      const maths = [], boxes = [];
      if (id) src = src.replace(/\]\(photos\//g, `](/lectures/${id}/photos/`); // notlardaki göreli görsel yolları
      src = src.replace(/^[ \t]*\[\[GÖRSEL [\d:]+\]\][ \t]*$/gm, ''); // video karesi henüz çekilmediyse işaret görünmesin
      // $...$ ve $$...$$ KaTeX ile; markdown-it'e girmeden önce yer tutucuya alınır.
      src = src.replace(/\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g, (_, d, i) => { maths.push({ tex: (d || i).trim(), display: !!d }); return `@@M${maths.length - 1}@@`; });
      // YouTube bölümünde "(12:34)" / "(1:02:34)" atıfları oynatıcıyı o ana sarar
      if (YT_ID.test(yt || '')) src = src.replace(/\(([^()\n]*?\d{1,3}:\d{2}[^()\n]*)\)/g, (_, g) => '(' + g.replace(/\b(\d{1,3}):(\d{2})(?::(\d{2}))?\b/g,
        (t, a, b, c) => `[${t}](#yt=${yt}&t=${c ? a * 3600 + b * 60 + +c : a * 60 + +b})`) + ')');
      // Claude çoğu zaman $$'ı önceki cümlenin hemen alt satırına yazar (aynı paragraf); satır yalnızca formülse kendi paragrafına ayır.
      if (cards) src = src.replace(/^@@M(\d+)@@[ \t]*$/gm, (l, n) => maths[n].display ? `\n${l}\n` : l);
      if (cards) src = src.replace(FORMUL, (_, title, body) => {
        const [eq, ...rest] = body.trim().split(/\n\s*\n/);
        boxes.push(fbox(md.renderInline(title.trim()), bare(md.render(eq)), rest.length ? bare(md.render(rest.join('\n\n'))) : '',
          title.trim().replace(/@@M(\d+)@@/g, (_, n) => maths[n].tex))); // aria-label düz metin: KaTeX HTML'i özniteliği bozar
        return `\n@@F${boxes.length - 1}@@\n`;
      });
      let out = md.render(src);
      if (cards) out = out
        .replace(/(?:<p>@@F\d+@@<\/p>\n?)+/g, run => { const b = run.match(/@@F(\d+)@@/g).map(m => boxes[+m.slice(3, -2)]); return b.length > 1 ? `<div class="fgrid">${b.join('')}</div>` : b[0]; })
        .replace(/<p>@@M(\d+)@@<\/p>/g, (p, n) => maths[n].display ? fbox('', `@@M${n}@@`) : p); // tek başına $$ paragrafı
      return out.replace(/@@M(\d+)@@/g, (_, n) => {
        const m = maths[n];
        try { return katex.renderToString(m.tex, { displayMode: m.display, throwOnError: false }); } catch { return esc(m.tex); }
      });
    };
  };
});
