const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseUrl, canonical, vttToText } = require('../lib/youtube');
const { pack, generateYoutube } = require('../tools/evren');
const mock = require('./mock-evren');

const ID = 'dQw4w9WgXcQ';

test('parseUrl: kabul edilen biçimler', () => {
  for (const u of [`https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&t=42s&list=x`, `http://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=abc`, `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/shorts/${ID}/`, `  https://youtu.be/${ID}  `]) {
    assert.equal(parseUrl(u), ID, u);
  }
  assert.equal(canonical(ID), `https://www.youtube.com/watch?v=${ID}`);
});

test('parseUrl: reddedilenler', () => {
  for (const u of [`https://evil.com/watch?v=${ID}`, `https://youtube.com.evil.com/watch?v=${ID}`, `https://evil.com/?u=https://youtu.be/${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`, `https://www.youtube.com:8080/watch?v=${ID}`, `javascript:alert(1)//youtu.be/${ID}`,
    `ftp://youtu.be/${ID}`, `https://www.youtube.com/watch?v=short`, `https://www.youtube.com/watch?v=${ID}x`, `https://www.youtube.com/watch?v=${ID}; rm -rf ~`,
    `https://www.youtube.com/watch?v=$(id)aaaa`, `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/playlist?list=${ID}`,
    `https://youtu.be/${ID}/extra`, `https://www.youtube.com/shorts/${ID}/x`, `https://www.youtube.com/watch`, '', 'bos', null, undefined, 42, { toString: () => 'x' }, 'x'.repeat(400)]) {
    assert.equal(parseUrl(u), null, String(u).slice(0, 60));
  }
});

test('vttToText: kayan otomatik altyazı tekrarları, etiketler ve zaman damgaları', () => {
  const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.480 --> 00:00:02.310 align:start position:0%
hello and<00:00:01.000><c> welcome</c>

00:00:02.310 --> 00:00:02.320 align:start position:0%
hello and welcome


00:00:02.320 --> 00:00:04.500 align:start position:0%
hello and welcome
to the &amp; lecture<00:00:03.000><c> today</c>

00:00:04.500 --> 00:00:04.510 align:start position:0%
to the & lecture today

00:00:04.510 --> 00:00:30.000 align:start position:0%
to the & lecture today
we study Ohm&#39;s law

00:01:05.000 --> 00:01:07.000
V = I R

01:02:03.000 --> 01:02:05.000
the end
`;
  const out = vttToText(vtt).trim().split('\n');
  assert.deepEqual(out, [
    "[0:00] hello and welcome to the & lecture today we study Ohm's law",
    '[1:05] V = I R',
    '[1:02:03] the end',
  ]);
});

test('vttToText: boş/bozuk girdi boş döner', () => {
  assert.equal(vttToText('WEBVTT\n\n'), '');
  assert.equal(vttToText(''), '');
});

test('pack: parçaları üst sınırı aşmadan birleştirir', () => {
  const parts = Array.from({ length: 5 }, () => 'x'.repeat(15000) + '\n');
  const out = pack(parts);
  assert.equal(out.length, 3); // 40000 sınırı: 2+2+1
  assert.equal(out.join(''), parts.join(''));
});

test('generateYoutube: altyazıdan notları yazar, zaman damgası kuralı istemde', async () => {
  const m = await mock.start();
  process.env.EVREN_BASE = m.url;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lecting-t-'));
  const txt = path.join(tmp, 'yt.txt');
  fs.writeFileSync(txt, Array.from({ length: 60 }, (_, i) => `[${i}:00] Ohm yasasi gerilim akim ve direnc arasindaki iliskiyi anlatir.`).join('\n') + '\n');
  const dir = path.join(tmp, 'out');
  await generateYoutube({ course: 'X', courseName: 'Y', title: 'Z', youtube: ID }, txt, dir, { key: 'test-key', model: 'auto' });
  assert.ok(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8').includes('Deneme Notu'));
  assert.ok(fs.existsSync(path.join(dir, 'summary.txt')) && fs.existsSync(path.join(dir, 'questions.md')));
  assert.match(m.calls[0].body.messages.at(-1).content, /\(12:34\)[\s\S]*\[0:00\] Ohm/);
  await assert.rejects(generateYoutube({ course: 'X', courseName: 'Y', title: 'Z' }, (fs.writeFileSync(txt, '[0:00] kisa\n'), txt), dir, { key: 'test-key', model: 'auto' }), /çok kısa/);
  m.close();
  fs.rmSync(tmp, { recursive: true });
});

test('fetchTranscript: altyazı yoksa ses yazıya çevrilir (sahte yt-dlp/ffmpeg/whisper)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lecting-stt-'));
  const sh = (n, body) => { const f = path.join(dir, n); fs.writeFileSync(f, '#!/bin/sh\n' + body + '\n', { mode: 0o755 }); return f; };
  // yt-dlp: altyazı isteğinde hiçbir şey yazmaz; -f bestaudio'da "-o" kalıbına a.m4a yazar
  const ytdlp = sh('yt-dlp', 'case "$*" in *bestaudio*) while [ "$1" != "-o" ]; do shift; done; o=$(echo "$2" | sed "s/%(ext)s/m4a/"); echo ses > "$o";; esac');
  // ffmpeg: bölme isteğinde (-f segment) iki 30 sn'lik parça, yoksa çıktı dosyası
  const ffmpeg = sh('ffmpeg', 'for a; do last=$a; done; case "$*" in *segment*) d=$(dirname "$last"); echo w > "$d/p00000.wav"; echo w > "$d/p00001.wav";; *) echo wav > "$last";; esac');
  const whisper = sh('whisper-cli', 'while [ "$1" != "-of" ]; do shift; done; printf "1\\n00:00:01,000 --> 00:00:03,000\\nmerhaba ders\\n\\n2\\n00:01:10,000 --> 00:01:12,000\\nOhm yasası\\n" > "$2.srt"');
  const model = path.join(dir, 'model.bin'); fs.writeFileSync(model, 'x');
  Object.assign(process.env, { YTDLP: ytdlp, FFMPEG: ffmpeg, WHISPER: whisper, WHISPER_MODEL: model });
  try {
    const out = path.join(dir, 'out.txt');
    const r = await require('../lib/youtube').fetchTranscript(ID, out);
    assert.deepEqual(r, { lang: 'ses', auto: true });
    assert.equal(fs.readFileSync(out, 'utf8'), '[0:01] merhaba ders\n[1:10] Ohm yasası\n');
    const m = await mock.start();
    process.env.EVREN_BASE = m.url;
    try { // EVREN anahtarı geçersiz: parçalar yerel whisper'la çevrilir (2 parça, 3. hatada tümü whisper'a geçerdi)
      await require('../lib/youtube').fetchTranscript(ID, out, 'yanlis');
      assert.equal(fs.readFileSync(out, 'utf8'), '[0:00] merhaba ders Ohm yasası\n[0:30] merhaba ders Ohm yasası\n');
      process.env.WHISPER_MODEL = path.join(dir, 'yok.bin');
      await assert.rejects(require('../lib/youtube').fetchTranscript(ID, out), /model/);
      await assert.rejects(require('../lib/youtube').fetchTranscript(ID, out, 'yanlis'), /EVREN.*401/);
      // EVREN: her 30 sn'lik parça ayrı istek, damga parça başı
      await require('../lib/youtube').fetchTranscript(ID, out, 'test-key');
      const n = m.calls.length;
      assert.equal(fs.readFileSync(out, 'utf8'), `[0:00] parça ${n - 1}\n[0:30] parça ${n}\n`);
      assert.equal(m.calls.at(-1).url, '/v1/audio/transcriptions');
    } finally { m.close(); }
    process.env.WHISPER_MODEL = model;
    const m2 = await mock.start({ asrFailFirst: true });
    process.env.EVREN_BASE = m2.url;
    try { // tek parça EVREN'de olmazsa yalnızca o parça yerelde çevrilir, damgası korunur
      await require('../lib/youtube').fetchTranscript(ID, out, 'test-key');
      assert.equal(fs.readFileSync(out, 'utf8'), '[0:00] merhaba ders Ohm yasası\n[0:30] parça 2\n');
    } finally { m2.close(); }
  } finally { for (const k of ['YTDLP', 'FFMPEG', 'WHISPER', 'WHISPER_MODEL', 'EVREN_BASE']) delete process.env[k]; fs.rmSync(dir, { recursive: true, force: true }); }
});
