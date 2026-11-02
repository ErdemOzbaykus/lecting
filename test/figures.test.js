const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('addVideoFigures: [[GÖRSEL]] işaretleri video karesine döner, olmayan kare ve tekrar silinir', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lecting-vf-'));
  const sh = (n, body) => { const f = path.join(root, n); fs.writeFileSync(f, '#!/bin/sh\n' + body + '\n', { mode: 0o755 }); return f; };
  process.env.YTDLP = sh('yt-dlp', 'echo https://stream.example/v.mp4');
  // ffmpeg: 75. saniyede (74+1) kare çıkaramıyor gibi davranır
  process.env.FFMPEG = sh('ffmpeg', 'case "$*" in *"-ss 75 "*) exit 1;; esac; for a; do last=$a; done; echo jpg > "$last"');
  process.env.LECTING_ROOT = root;
  for (const m of ['../lib/topics', '../tools/figures']) delete require.cache[require.resolve(m)];
  const { addVideoFigures } = require('../tools/figures');
  const id = 'TST100/01-video', dir = path.join(root, 'lectures', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.md'), '# V\n\n## A\nDevre (1:05).\n[[GÖRSEL 1:05]]\n[[GÖRSEL 1:10]]\n\n## B\n[[GÖRSEL 1:14]]\nson\n\n[[GÖRSEL 1:02:03]]\n');
  try {
    const n = await addVideoFigures({ id, youtube: 'dQw4w9WgXcQ' });
    assert.equal(n, 2);
    const out = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8');
    assert.match(out, /!\[Videodan kare 1:05\]\(photos\/v-65\.jpg\)/);
    assert.match(out, /!\[Videodan kare 1:02:03\]\(photos\/v-3723\.jpg\)/);
    assert.doesNotMatch(out, /GÖRSEL/); // 1:10 tekrar (15 sn içinde), 1:14 kare alınamadı
    assert.ok(fs.existsSync(path.join(dir, 'photos/v-65.jpg')));
  } finally {
    for (const k of ['YTDLP', 'FFMPEG', 'LECTING_ROOT']) delete process.env[k];
    fs.rmSync(root, { recursive: true, force: true });
  }
});
