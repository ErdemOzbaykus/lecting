// Sahte OpenAI uyumlu sunucu: gerçek anahtar ve ağ olmadan EVREN akışını sınamak için.
const http = require('http');

const NOTES = '```markdown\n# Deneme Notu\n\n## Birinci bölüm\n\nOhm yasası $V = I R$ (s. 1).\n\n> **Sınav ipucu:** Birimlere dikkat.\n```';
const TAIL = '===ÖZET===\nBu bir deneme özetidir. Ohm yasasını anlatır.\n===SORULAR===\nS: Ohm yasası nedir?\nC: $V = I R$.\n\nS: Güç nedir?\nC: $P = V I$.';

// Test (quiz) isteği: istemdeki şema örneğinden ('"type":"mcq"') tanınır. 7 soru, biri geçersiz (cevap sırası aralık dışı).
const QUIZ_QS = [
  { type: 'mcq', q: 'Ohm yasası hangisidir?', options: ['V = I R', 'P = V I', 'F = m a'], answer: 0, explain: 'Gerilim akım ve dirençle orantılıdır.', page: 1 },
  { type: 'mcq', q: 'Bozuk soru', options: ['a', 'b'], answer: 5, explain: 'x' },
  { type: 'fill', q: 'Ohm yasasında gerilim ile ___ orantılıdır.', answer: 'akım', alts: ['akim'], explain: 'V = I R.', page: '1' },
  { type: 'tf', q: 'Güç P = V I ile bulunur.', answer: true, explain: 'Güç gerilim çarpı akımdır.' },
  { type: 'tf', q: 'Direnç birimi Volt\'tur.', answer: false, explain: 'Direnç birimi Ohm\'dur.' },
  { type: 'match', q: 'Büyüklük - birim eşleştir.', pairs: [{ l: 'Gerilim', r: 'Volt' }, { l: 'Akım', r: 'Amper' }, { l: 'Direnç', r: 'Ohm' }], explain: 'SI birimleri.' },
  { type: 'fill', q: 'Güç birimi ___ olur.', answer: 'watt', explain: 'W.' },
];
const QUIZ = '```json\n' + JSON.stringify({ questions: QUIZ_QS }, null, 1) + '\n```';

// 0,1 sn sessiz 16 bit mono 8 kHz WAV (ffmpeg'in açabildiği geçerli dosya)
const PCM = Buffer.alloc(1600);
const WAV = Buffer.concat([Buffer.from('RIFF'), u32(36 + PCM.length), Buffer.from('WAVEfmt '), u32(16), u16(1), u16(1), u32(8000), u32(16000), u16(2), u16(16), Buffer.from('data'), u32(PCM.length), PCM]);
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }

// opts.quiz: test isteğine verilecek ham yanıt (varsayılan QUIZ). opts.rateLimitFirst: ilk istek 429 (Retry-After: 1) döner.
// opts.asrFailFirst: ilk ses tanıma isteği 400 döner. calls: gelen isteklerin kaydı.
function start(opts = {}) {
  const calls = [];
  let first = true;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const send = (code, obj, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(obj)); };
      calls.push({ url: req.url, auth: req.headers.authorization, body: /json/.test(req.headers['content-type']) ? JSON.parse(body) : body || null });
      if (req.headers.authorization !== 'Bearer test-key') return send(401, { error: { message: 'Invalid API key' } });
      if (req.url === '/v1/models') return send(200, { data: [{ id: 'auto' }, { id: 'deneme-model' }] });
      if (opts.sse) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (opts.stallFirst && first) { first = false; return res.write(opts.sse.split('\n\n')[0] + '\n\n'); } // ilk parçadan sonra donar
        return res.end(opts.sse);
      }
      if (req.url === '/v1/audio/transcriptions') {
        if (opts.asrFailFirst && first) { first = false; return send(400, { error: { message: 'bozuk parça' } }); }
        return send(200, { text: `parça ${calls.length}` });
      }
      if (req.url === '/v1/audio/speech') { res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(WAV); }
      if (opts.rateLimitFirst && first) { first = false; return send(429, { error: { message: 'slow down' } }, { 'retry-after': '1' }); }
      const user = JSON.parse(body).messages.at(-1).content;
      const reply = user.includes('"type":"mcq"') ? (opts.quiz ?? QUIZ) : user.includes('===ÖZET===') ? TAIL : NOTES;
      return send(200, { choices: [{ message: { content: reply } }] });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => { server.closeAllConnections(); server.close(); } })));
}

module.exports = { start, QUIZ_QS, QUIZ };
