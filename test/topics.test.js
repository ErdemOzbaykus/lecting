const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('silinen (hidden) konu listeden çıkar, sonrakilerin kimliği değişmez', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lecting-'));
  fs.mkdirSync(path.join(root, 'data'));
  const mf = { courses: { TST100: { name: 'T', topics: [{ title: 'Bir', file: 'a.pdf' }, { title: 'İki', file: 'b.pdf', hidden: true }, { title: 'Üç', file: 'c.pdf' }] } } };
  fs.writeFileSync(path.join(root, 'data/manifest.json'), JSON.stringify(mf));
  process.env.LECTING_ROOT = root;
  delete require.cache[require.resolve('../lib/topics')];
  const ids = require('../lib/topics').topics().map(t => t.id);
  assert.deepStrictEqual(ids, ['TST100/01-bir', 'TST100/03-uc']);
});
