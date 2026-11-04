const test = require('node:test');
const assert = require('node:assert');
const md = require('markdown-it')(), katex = require('katex');
const render = require('../public/render')(md, katex, /^[\w-]{11}$/);

test('tek başına $$ paragrafı karta sarılır; cards=false iken ve metinle karışıkken sarılmaz', () => {
  const o = render('Giriş.\n\n$$a = b$$\n\nSon.', 't', '', true);
  assert.match(o, /<div class="fbox" role="group"><div><span class="katex-display">/);
  assert.doesNotMatch(render('$$a = b$$', 't', '', false), /fbox/);
  assert.doesNotMatch(render('Metin $$a$$ aynı\nparagrafta.', 't', '', true), /fbox/);
  // Gerçek notlardaki biçim: formül önceki cümlenin hemen alt satırında, sonrasında da metin var
  const glued = render('Güç torkla hızın çarpımıdır.\n$$P = \\tau\\omega$$\nSlayt bunu işaretler.\n- liste $a$', 't', '', true);
  assert.match(glued, /<p>Güç torkla hızın çarpımıdır\.<\/p>\s*<div class="fbox"/);
  assert.match(glued, /<\/div>\s*<p>Slayt bunu işaretler\./);
  assert.doesNotMatch(render('- $$a = b$$', 't', '', true), /fbox/); // liste maddesindeki formül sarılmaz
});

test(':::formül: etiket + not, ardışık kartlar ızgarada, tek kart ızgarasız', () => {
  const two = render(':::formül Verim ($\\eta$)\n$$\\eta = V_o/V_i$$\n\nKalan enerji **ısıya** gider.\n:::\n\n:::formül Buck\n$$V_o = D V_i$$\n:::', 't', '', true);
  assert.equal((two.match(/class="fbox"/g) || []).length, 2);
  assert.match(two, /class="fgrid"/);
  assert.match(two, /<div class="fnote">Kalan enerji <strong>ısıya<\/strong> gider\.<\/div>/);
  assert.match(two, /class="flabel">Verim \(<span class="katex">/);
  assert.match(two, /aria-label="Verim \(\\eta\)"><div>/); // başlıktaki formül aria-label'ı bozmaz
  const one = render(':::formül Tek\n$$x$$\n:::', 't', '', true);
  assert.match(one, /class="fbox"/); assert.doesNotMatch(one, /fgrid|@@/);
});

test('başlıktaki ham HTML kaçırılır; YouTube zaman damgası kart notunda da bağlanır', () => {
  assert.doesNotMatch(render(':::formül <img src=x onerror=alert(1)>\n$$x$$\n:::', 't', '', true), /<img/);
  assert.match(render(':::formül A\n$$x$$\n\nBakınız (1:05).\n:::', 't', 'dQw4w9WgXcQ', true), /href="#yt=dQw4w9WgXcQ&amp;t=65"/);
});
