const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseQuiz, saveQuiz, loadQuiz } = require('../lib/quiz');
const Quiz = require('../public/quiz');
const mock = require('./mock-evren');

const ok = {
  mcq: { type: 'mcq', q: 'Hangisi?', options: ['a', 'b', 'c'], answer: 1, explain: 'Çünkü b.' },
  fill: { type: 'fill', q: 'Boşluk ___ burada.', answer: 'kelime', alts: ['sözcük'], explain: 'Öyle.' },
  tf: { type: 'tf', q: 'Doğru mu?', answer: false, explain: 'Hayır.' },
  match: { type: 'match', q: 'Eşleştir', pairs: [{ l: 'a', r: '1' }, { l: 'b', r: '2' }, { l: 'c', r: '3' }], explain: 'Öyle.' },
};
const four = Object.values(ok);
const parse = (qs, min) => parseQuiz(JSON.stringify({ questions: qs }), min);

test('parseQuiz: dört tür geçerli, kod bloğu ve önündeki/arkasındaki metin tolere edilir', () => {
  const j = JSON.stringify({ questions: four });
  for (const text of [j, '```json\n' + j + '\n```', 'İşte test:\n```\n' + j + '\n```\nBaşarılar', 'Buyur ' + j + ' bitti', JSON.stringify(four)]) {
    const q = parseQuiz(text);
    assert.equal(q.version, 1);
    assert.deepEqual(q.questions.map(x => x.type), ['mcq', 'fill', 'tf', 'match']);
  }
});

test('parseQuiz: geçersiz sorular atılır, kalanlar korunur', () => {
  const bad = [
    { ...ok.mcq, q: 'a1', answer: 3 },                       // doğru şık yok
    { ...ok.mcq, q: 'a2', answer: '1' },                     // sayı değil
    { ...ok.mcq, q: 'a3', options: ['a', 'a', 'b'] },        // tekrar eden şık
    { ...ok.mcq, q: 'a4', options: ['a'] },                  // tek şık
    { ...ok.mcq, q: 'a5', options: ['a', '', 'c'] },         // boş şık
    { ...ok.fill, q: 'f1 ___', answer: '  ' },               // boş cevap
    { ...ok.fill, q: 'f2 boşluk yok' },                      // boşluk işareti yok
    { ...ok.fill, q: 'f3 ___ ve ___' },                      // iki boşluk
    { ...ok.tf, q: 't1', answer: 'true' },                   // boolean değil
    { ...ok.match, q: 'm1', pairs: ok.match.pairs.slice(0, 2) },                          // az çift
    { ...ok.match, q: 'm2', pairs: [...ok.match.pairs.slice(0, 2), { l: 'c', r: '2' }] }, // sağ tekrar
    { ...ok.tf, q: 't2', explain: '' },                      // açıklama yok
    { ...ok.tf, q: 't3', type: 'essay' },                    // bilinmeyen tür
    null, 'x', 5,
  ];
  const q = parse([...four, ...bad]);
  assert.equal(q.questions.length, 4);
});

test('parseQuiz: aynı soru metni tekrarlanmaz, en çok 10 soru', () => {
  assert.equal(parse([ok.tf, ok.tf, ok.mcq, ok.fill, ok.match]).questions.length, 4);
  const many = Array.from({ length: 15 }, (_, i) => ({ ...ok.tf, q: 'soru ' + i }));
  assert.equal(parse(many).questions.length, 10);
});

test('parseQuiz: geçerli soru azsa hata verir', () => {
  assert.throws(() => parse([ok.mcq, ok.tf, { ...ok.fill, answer: '' }]), /yeterli geçerli soru yok \(2\/3/);
  assert.throws(() => parse(four, 5), /en az 5/);
  assert.throws(() => parseQuiz('merhaba'), /JSON değil/);
  assert.throws(() => parseQuiz('{"a":1}'), /questions/);
  assert.throws(() => parseQuiz(''), /JSON değil/);
});

test('parseQuiz: page yalnızca sayfa biçimindeyse tutulur, alts temizlenir', () => {
  const q = parse([
    { ...ok.tf, q: 'p1', page: 12 }, { ...ok.tf, q: 'p2', page: '4, 6' }, { ...ok.tf, q: 'p3', page: 'bilinmiyor' },
    { ...ok.fill, q: 'p4 ___', alts: ['x', '', 5, ' y '] },
  ]).questions;
  assert.deepEqual(q.map(x => x.page), ['12', '4, 6', undefined, undefined]);
  assert.deepEqual(q[3].alts, ['x', 'y']);
});

test('saveQuiz/loadQuiz: gidiş-dönüş, dosya yok ya da bozuksa null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lq-'));
  assert.equal(loadQuiz(dir), null);
  const q = parse(four);
  saveQuiz(dir, q);
  assert.deepEqual(loadQuiz(dir), q);
  assert.ok(!fs.existsSync(path.join(dir, 'quiz.json.tmp')));
  fs.writeFileSync(path.join(dir, 'quiz.json'), '{bozuk');
  assert.equal(loadQuiz(dir), null);
});

test('isCorrect fill: büyük/küçük harf Türkçe, boşluklar kırpılır, alternatifler kabul', () => {
  const q = { type: 'fill', answer: 'ısı', alts: ['İstanbul', 'sıcaklık  farkı'] };
  assert.ok(Quiz.isCorrect(q, 'ISI'));          // I -> ı
  assert.ok(Quiz.isCorrect(q, '  Isı '));
  assert.ok(Quiz.isCorrect(q, 'istanbul'));
  assert.ok(Quiz.isCorrect(q, 'İSTANBUL'));     // İ -> i
  assert.ok(Quiz.isCorrect(q, 'Sıcaklık farkı'));
  assert.ok(!Quiz.isCorrect(q, 'isi'));          // i != ı
  assert.ok(!Quiz.isCorrect(q, 'Istanbul'));     // I -> ı, "ıstanbul" != "istanbul"
  assert.ok(!Quiz.isCorrect(q, ''));
  assert.ok(!Quiz.isCorrect(q, '   '));
  assert.ok(!Quiz.isCorrect({ type: 'fill', answer: 'x' }, 5));
});

test('isCorrect mcq/tf/match', () => {
  assert.ok(Quiz.isCorrect(ok.mcq, 1) && !Quiz.isCorrect(ok.mcq, 0) && !Quiz.isCorrect(ok.mcq, '1'));
  assert.ok(Quiz.isCorrect(ok.tf, false) && !Quiz.isCorrect(ok.tf, true) && !Quiz.isCorrect(ok.tf, 0));
  assert.ok(Quiz.isCorrect(ok.match, ['1', '2', '3']));
  assert.ok(!Quiz.isCorrect(ok.match, ['1', '3', '2']) && !Quiz.isCorrect(ok.match, ['1', '2']) && !Quiz.isCorrect(ok.match, '123'));
});

test('prep: şıklar karışsa da doğru cevap izlenir, eşleştirme sağ sütunu aynı elemanları içerir', () => {
  for (let n = 0; n < 50; n++) {
    const p = Quiz.prep(ok.mcq);
    assert.equal(p.options[p.answer], 'b');
    assert.deepEqual([...p.options].sort(), ['a', 'b', 'c']);
    assert.ok(Quiz.isCorrect(p, p.answer));
    assert.deepEqual(Quiz.prep(ok.match).rights.sort(), ['1', '2', '3']);
  }
  assert.strictEqual(Quiz.prep(ok.tf), ok.tf);
});

// --- EVREN sağlayıcısı ve build.js, sahte sunucu ve geçici LECTING_ROOT ile (gerçek API/claude/kullanıcı verisi yok) ---

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lecting-'));
  const id = 'TST100/01-ilk-konu', dir = path.join(root, 'lectures', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data/manifest.json'), JSON.stringify({ courses: { TST100: { name: 'Test Dersi', topics: [{ title: 'İlk konu', file: 'yok.pdf' }] } } }));
  for (const f of ['summary.txt', 'questions.md', 'summary.m4a']) fs.writeFileSync(path.join(dir, f), 'x');
  fs.writeFileSync(path.join(dir, 'notes.md'), '# İlk\n\n## Bölüm\n\nOhm yasası (s. 1).\n');
  return { root, id, dir };
}
const run = (cmd, args, env) => new Promise(resolve => {
  const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  p.on('close', code => resolve({ code, out }));
});
const build = path.join(__dirname, '../tools/build.js');

test('generateQuiz (EVREN): yalnızca notes.md\'den test üretir, geçersiz soruyu atar', async () => {
  const m = await mock.start();
  process.env.EVREN_BASE = m.url;
  const { dir } = fixture();
  await require('../tools/evren').generateQuiz({ course: 'TST100', courseName: 'Test', title: 'İlk' }, dir, { key: 'test-key', model: 'auto' });
  const q = loadQuiz(dir);
  assert.equal(q.questions.length, 6);          // 7 üretildi, 1 geçersiz
  assert.equal(m.calls.length, 1);
  assert.ok(m.calls[0].body.messages.at(-1).content.includes('Ohm yasası (s. 1)'));
  m.close();
});

test('generateQuiz (EVREN): yeterli geçerli soru yoksa hata verir ve quiz.json yazılmaz', async () => {
  const m = await mock.start({ quiz: '```json\n{"questions":[{"type":"tf","q":"x","answer":true,"explain":"y"}]}\n```' });
  process.env.EVREN_BASE = m.url;
  const { dir } = fixture();
  await assert.rejects(require('../tools/evren').generateQuiz({ course: 'T', courseName: 'T', title: 'T' }, dir, { key: 'test-key', model: 'auto' }), /yeterli geçerli soru/);
  assert.ok(!fs.existsSync(path.join(dir, 'quiz.json')));
  m.close();
});

test('build.js (EVREN): notu olan konuya yalnızca quiz.json eklenir, notlar yeniden üretilmez; ikinci çalıştırmada istek yok', async () => {
  const m = await mock.start();
  const { root, dir } = fixture();
  fs.writeFileSync(path.join(root, 'data/settings.json'), JSON.stringify({ provider: 'evren', model: 'auto' }));
  fs.writeFileSync(path.join(root, '.env'), 'EVREN_KEY="test-key"\n');
  const env = { PATH: process.env.PATH, LECTING_ROOT: root, EVREN_BASE: m.url };
  const before = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8');
  const r = await run(process.execPath, [build], env);
  assert.equal(r.code, 0, r.out);
  assert.equal(m.calls.length, 1, r.out);
  assert.equal(loadQuiz(dir).questions.length, 6);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), before);
  await run(process.execPath, [build], env);
  assert.equal(m.calls.length, 1);               // zaten var: yeniden üretmez
  m.close();
});

test('build.js (EVREN): test üretimi başarısız olsa da build çökmez, notlar ve ses yerinde kalır', async () => {
  const m = await mock.start({ quiz: 'JSON değil' });
  const { root, dir } = fixture();
  fs.writeFileSync(path.join(root, 'data/settings.json'), JSON.stringify({ provider: 'evren', model: 'auto' }));
  fs.writeFileSync(path.join(root, '.env'), 'EVREN_KEY="test-key"\n');
  const r = await run(process.execPath, [build], { PATH: process.env.PATH, LECTING_ROOT: root, EVREN_BASE: m.url });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /test üretilemedi/);
  assert.ok(!fs.existsSync(path.join(dir, 'quiz.json')) && fs.existsSync(path.join(dir, 'notes.md')) && fs.existsSync(path.join(dir, 'summary.m4a')));
  m.close();
});

test('build.js (Claude yolu): claude yalnızca geçici klasörü görür, ham test doğrulanıp quiz.json olur, fazlası alınmaz', async () => {
  const { root, dir } = fixture();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fakebin-'));
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const fs = require('fs'), path = require('path');
if (process.argv.includes('--add-dir') || !fs.existsSync('notes.md')) process.exit(3); // başka klasör izni yok, not kopyası cwd'de
const f = /"([^"]+quiz\\.raw\\.json)"/.exec(process.argv[3])[1]; // gerçek claude yok: istemdeki yola yazar
if (fs.realpathSync(path.dirname(f)) !== process.cwd()) process.exit(4); // macOS: /var -> /private/var
fs.writeFileSync(f, ${JSON.stringify('```json\n' + JSON.stringify({ questions: require('./mock-evren').QUIZ_QS }) + '\n```')});
fs.writeFileSync('notes.md', 'üzerine yazıldı'); fs.writeFileSync('fazla.txt', 'x'); // istenmeyen çıktılar konu klasörüne geçmemeli
`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'data/settings.json'), JSON.stringify({ provider: 'claude' }));
  const before = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8');
  const r = await run(process.execPath, [build], { PATH: bin, LECTING_ROOT: root }); // PATH yalnızca sahte claude: gerçeği bulunamaz
  assert.equal(r.code, 0, r.out);
  assert.equal(loadQuiz(dir).questions.length, 6, r.out);
  assert.ok(!fs.existsSync(path.join(dir, 'quiz.raw.json')) && !fs.existsSync(path.join(dir, 'fazla.txt')));
  assert.equal(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data/work')), []); // geçici klasör silinir
});

// --- Sunucu: konu detayında quiz, skor kaydı ---

test('sunucu: /api/topic quiz döner, /api/quiz-score doğrular ve data/quiz-scores.json\'a yazar, progress.json\'a dokunmaz', async () => {
  const { root, id, dir } = fixture();
  saveQuiz(dir, parse(four));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const srv = spawn(process.execPath, [path.join(__dirname, '../server.js')], { env: { PATH: process.env.PATH, LECTING_ROOT: root, PORT: String(port) }, stdio: 'ignore' });
  try {
    const url = p => `http://127.0.0.1:${port}${p}`;
    for (let n = 0; n < 50; n++) { try { await fetch(url('/api/state')); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    const t = await (await fetch(url('/api/topic?id=' + encodeURIComponent(id)))).json();
    assert.equal(t.quiz.questions.length, 4);
    const post = b => fetch(url('/api/quiz-score'), { method: 'POST', headers: { 'x-lecting': '1', 'content-type': 'application/json' }, body: JSON.stringify(b) });
    for (const bad of [{ id, score: 5, total: 4 }, { id, score: -1, total: 4 }, { id, score: 1.5, total: 4 }, { id: 'X/y', score: 1, total: 4 }, { id, score: 1, total: 0 }]) {
      assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await post({ id, score: 3, total: 4 })).status, 200);
    assert.equal((await post({ id, score: 4, total: 4 })).status, 200); // son skor geçerli
    const s = await (await fetch(url('/api/state'))).json();
    assert.equal(s.quiz[id].score, 4);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/quiz-scores.json')))[id].total, 4);
    assert.ok(!fs.existsSync(path.join(root, 'data/progress.json')));
  } finally { srv.kill(); }
});

test('build.js (Claude yolu): claude kurulu değilse build çökmez, konu "BAŞARISIZ" olur ve nedeni log\'da yazar', async () => {
  const { root } = fixture();
  fs.mkdirSync(path.join(root, 'data/sources/TST100'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../README.md'), path.join(root, 'data/sources/TST100/yok.pdf')); // içerik önemsiz: claude zaten çağrılamaz
  fs.rmSync(path.join(root, 'lectures'), { recursive: true }); // notlar yok: üretilmeli
  fs.writeFileSync(path.join(root, 'data/settings.json'), JSON.stringify({ provider: 'claude' }));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'emptybin-')); // PATH'te claude yok
  const r = await run(process.execPath, [build], { PATH: bin, LECTING_ROOT: root });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /BAŞARISIZ: TST100\/01-ilk-konu .*claude.*bulunamadı/s);
});
