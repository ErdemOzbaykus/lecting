const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/panopto');
const md = require('markdown-it')(), katex = require('katex');
const render = require('../public/render')(md, katex, /^[\w-]{11}$/);

const ID = '5988b11c-18c9-4f36-bce1-b4ce00d5b292';

test('autoForm: LTI formunun adresi ve gizli alanları (HTML kaçışları çözülür)', () => {
  const f = P.autoForm('<form id="ltiAutoForm" action="https://panopto.ieu.edu.tr/x/login?a=1&amp;b=2" method="post"><input type="hidden" name="iss" value="https://learn.ieu.edu.tr"><input type="hidden" name="id_token" value="a&quot;b"></form>');
  assert.equal(f.action, 'https://panopto.ieu.edu.tr/x/login?a=1&b=2');
  assert.equal(f.body.get('iss'), 'https://learn.ieu.edu.tr');
  assert.equal(f.body.get('id_token'), 'a"b');
  assert.equal(P.autoForm('<p>form yok</p>'), null);
});

test('folderFrom: yönlendirmedeki ders klasörü; parseSessions: yalnızca geçerli kayıtlar', () => {
  assert.equal(P.folderFrom(['https://p/a', `https://p/EmbeddedList.aspx?embedded=1&folderID=${ID}`]), ID);
  assert.equal(P.folderFrom([`https://p/List.aspx#folderID=%22${ID}%22`]), ID);
  assert.equal(P.folderFrom(['https://p/a']), null);
  const s = P.parseSessions({ Results: [
    { DeliveryID: ID.toUpperCase(), SessionName: 'Hafta\n3', StartTime: '/Date(1724583014866)/', Duration: 2700.4, HasCaptions: true },
    { DeliveryID: '../etc', SessionName: 'kötü' },
  ] });
  assert.deepEqual(s, [{ id: ID, title: 'Hafta 3', start: '2024-08-25T10:50:14.866Z', minutes: 45, captions: true }]);
});

test('render: (K1 12:34) atfı ilgili ders kaydına bağlanır, bilinmeyen kayıt düz kalır', () => {
  const o = render('Devre (K1 12:34; s. 3). Diğer (K2 1:02:03).', 't', { K1: ID }, true);
  assert.match(o, new RegExp(`href="#pn=${ID}&amp;t=754"`));
  assert.match(o, /\(K2 1:02:03\)/);
  assert.doesNotMatch(render('Devre (K1 12:34).', 't', '', true), /href=/);
});

test('ffHeaders: çerez yalnızca Panopto akışına, yalnızca https', () => {
  const pj = { header: 'a=1' };
  assert.deepEqual(P.ffHeaders(pj, 'https://panopto.ieu.edu.tr/Panopto/Content/x.mp4'), ['-protocol_whitelist', 'https,tls,tcp,crypto', '-headers', 'Cookie: a=1\r\n']);
  assert.deepEqual(P.ffHeaders(pj, 'https://cdn.example/x.mp4'), ['-protocol_whitelist', 'https,tls,tcp,crypto']);
  assert.deepEqual(P.ffHeaders(pj, 'http://panopto.ieu.edu.tr/x.mp4'), ['-protocol_whitelist', 'https,tls,tcp,crypto']);
});
