const test = require('node:test');
const assert = require('node:assert');
const { segments, assign, sourceText } = require('../lib/lectures');

test('segments: ~5 dk parçalar, saatli damga', () => {
  const s = segments('[0:00] a\n[2:00] b\n[5:10] c\n[1:00:00] d\nçöp satır');
  assert.deepEqual(s.map(x => x.start), [0, 310, 3600]);
  assert.equal(s[0].text, '[0:00] a\n[2:00] b');
});

test('assign: her parça en benzer konuya, konuşma dışı parça atılır; sourceText kayıt başlığıyla', () => {
  const topics = [
    { id: 'C/01-kalman', text: 'Kalman filter prediction update covariance gain measurement noise Gaussian' },
    { id: 'C/02-path', text: 'path planning Dijkstra A-star graph search heuristic cost grid' },
  ];
  const rec = { key: 'K1', id: 'u1', title: 'Hafta 8', text: [
    '[0:00] good morning attendance please sign the list',
    '[5:00] the Kalman gain balances prediction covariance against measurement noise',
    '[10:00] in Dijkstra we expand the graph node with lowest cost, A-star adds a heuristic',
    '[15:00] Kalman update step: covariance shrinks after the measurement',
  ].join('\n') };
  const a = assign(topics, [rec]);
  assert.deepEqual(a['C/01-kalman'].map(p => p.start), [300, 900]);
  assert.deepEqual(a['C/02-path'].map(p => p.start), [600]);
  assert.match(sourceText(a['C/01-kalman']), /^== K1: Hafta 8 ==\n\[5:00\] the Kalman[\s\S]*\[15:00\]/);
});

test('EVREN notesPrompt: ders anlatımı varsa istemde kural ve metin, yoksa hiç yok', () => {
  const { notesPrompt } = require('../tools/evren');
  const t = { course: 'C', courseName: 'D', title: 'T' };
  const withLec = notesPrompt({ ...t, lecture: '== K1: Hafta 8 ==\n[5:00] Kalman gain' }, '[Sayfa 1] x', true);
  assert.match(withLec, /\(K1 12:34\)[\s\S]*--- SLAYT METNİ ---[\s\S]*--- HOCANIN DERS ANLATIMI[^\n]*\n== K1: Hafta 8 ==\n\[5:00\] Kalman gain/);
  assert.doesNotMatch(notesPrompt(t, '[Sayfa 1] x', true), /ANLATIM|K1/);
});

test('topics: slaytı olan derste kayıt gizli; slaytsız derste kayıt konu, adı notun başlığından', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lecting-tp-'));
  const A = '11111111-2222-3333-4444-555555555555', B = '66666666-7777-8888-9999-000000000000';
  process.env.LECTING_ROOT = root;
  delete require.cache[require.resolve('../lib/topics')];
  try {
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data/manifest.json'), JSON.stringify({ courses: {
      S: { name: 's', topics: [{ title: 'Slayt', file: 'a.pdf' }, { title: 'Ders kaydı · 1 Ekim', panopto: A }] },
      N: { name: 'n', topics: [{ title: 'Ders kaydı · 2 Ekim', panopto: B }] },
    } }));
    const id = 'N/01-ders-kaydi-2-ekim';
    fs.mkdirSync(path.join(root, 'lectures', id), { recursive: true });
    fs.writeFileSync(path.join(root, 'lectures', id, 'notes.md'), '# Küreselleşme ve Ticaret\n\n## A\n');
    const t = require('../lib/topics').topics();
    assert.deepEqual(t.map(x => x.id), ['S/01-slayt', id]);
    assert.equal(t[1].title, 'Küreselleşme ve Ticaret');
    assert.equal(t[1].panopto, B);
    assert.match(t[1].transcript, new RegExp(`pn-${B}\\.txt$`));
  } finally { delete process.env.LECTING_ROOT; delete require.cache[require.resolve('../lib/topics')]; fs.rmSync(root, { recursive: true, force: true }); }
});

test('kayıt konusu: istemde içerikten başlık kuralı, tarihli ad yok; notta (12:34) kayda bağlanır', () => {
  const { ytNotesPrompt, PN_TITLE } = require('../tools/evren');
  const p = ytNotesPrompt({ course: 'C', courseName: 'D', title: 'Ders kaydı · 22 Eylül', panopto: 'x' }, '[0:00] a', true);
  assert.ok(p.includes(PN_TITLE));
  assert.doesNotMatch(p, /22 Eylül/);
  const md = require('markdown-it')(), katex = require('katex');
  const render = require('../public/render')(md, katex, /^[\w-]{11}$/);
  const ID = '11111111-2222-3333-4444-555555555555';
  assert.match(render('Bu (12:34).', 't', ID, true), new RegExp(`href="#pn=${ID}&amp;t=754"`));
});
