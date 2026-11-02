const test = require('node:test');
const assert = require('node:assert');
const { chat, setStall, speech, chunks, parseTail, listModels } = require('../tools/evren');
const mock = require('./mock-evren');

const msgs = [{ role: 'user', content: 'SLAYT METNİ merhaba' }];

test('chat: yanıtı döndürür, kod bloğunu açar, anahtarı Bearer olarak yollar', async () => {
  const m = await mock.start();
  process.env.EVREN_BASE = m.url;
  const text = await chat({ key: 'test-key', model: 'auto', messages: msgs });
  assert.ok(text.startsWith('# Deneme Notu') && !text.includes('```'));
  assert.equal(m.calls[0].auth, 'Bearer test-key');
  assert.equal(m.calls[0].body.model, 'auto');
  m.close();
});

test('chat: 429 gelirse Retry-After kadar bekleyip yeniden dener', async () => {
  const m = await mock.start({ rateLimitFirst: true });
  process.env.EVREN_BASE = m.url;
  const text = await chat({ key: 'test-key', model: 'auto', messages: msgs });
  assert.ok(text.includes('Deneme Notu'));
  assert.equal(m.calls.length, 2);
  m.close();
});

test('chat: hatalı anahtarda sağlayıcının mesajı hataya girer, yeniden denenmez', async () => {
  const m = await mock.start();
  process.env.EVREN_BASE = m.url;
  await assert.rejects(chat({ key: 'yanlis', model: 'auto', messages: msgs }), /401.*Invalid API key/);
  assert.equal(m.calls.length, 1);
  m.close();
});

test('chat: akış yanıtını birleştirir, bitiş işareti yoksa hata verir', async () => {
  const d = o => `data: ${JSON.stringify({ choices: [o] })}\n\n`;
  const part = d({ delta: { content: 'Mer' } }) + d({ delta: { content: 'haba' } });
  let m = await mock.start({ sse: part + d({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n' });
  process.env.EVREN_BASE = m.url;
  assert.equal(await chat({ key: 'test-key', model: 'auto', messages: msgs }), 'Merhaba');
  assert.equal(m.calls[0].body.stream, true);
  m.close();
  m = await mock.start({ sse: part });
  process.env.EVREN_BASE = m.url;
  await assert.rejects(chat({ key: 'test-key', model: 'auto', messages: msgs }), /yarıda/);
  m.close();
  // akış donarsa kesilip bir kez yeniden denenir
  m = await mock.start({ sse: part + d({ delta: {}, finish_reason: 'stop' }), stallFirst: true });
  process.env.EVREN_BASE = m.url;
  setStall(200);
  try { assert.equal(await chat({ key: 'test-key', model: 'auto', messages: msgs }), 'Merhaba'); } finally { setStall(90000); m.close(); }
  assert.equal(m.calls.length, 2);
});

test('speech: WAV baytlarını döndürür', async () => {
  const m = await mock.start();
  process.env.EVREN_BASE = m.url;
  const wav = await speech('test-key', 'Merhaba.');
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(m.calls[0].body.model, 'voxcpm2');
  m.close();
});

test('listModels: geçerli anahtarla model listesi, geçersizde ok:false', async () => {
  const m = await mock.start();
  process.env.EVREN_BASE = m.url;
  assert.deepEqual(await listModels('test-key'), { ok: true, status: 200, models: ['auto', 'deneme-model'] });
  const bad = await listModels('yanlis');
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
  m.close();
});

test('chunks: uzun metin sayfa sınırında bölünür, sayfa etiketleri korunur', () => {
  const page = 'x'.repeat(30000);
  const parts = chunks([page, page, 'son']);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].startsWith('[Sayfa 1]') && parts[1].startsWith('[Sayfa 2]') && parts[1].includes('[Sayfa 3]'));
});

test('parseTail: özet ve soruları ayırır, biçim bozuksa hata verir', () => {
  const { summary, questions } = parseTail('===ÖZET===\nKısa özet.\n===SORULAR===\nS: a?\nC: b.');
  assert.equal(summary, 'Kısa özet.');
  assert.ok(questions.startsWith('S: a?'));
  assert.throws(() => parseTail('sadece düz metin'), /biçiminde değil/);
  assert.throws(() => parseTail('===ÖZET===\nx\n===SORULAR===\nsoru yok'), /biçiminde değil/);
});
