const test = require('node:test');
const assert = require('node:assert');
const { field, parseCourses, parsePlan, parseLinks, parseAssignments, parseIcs } = require('../lib/parse');

const HOME = `<article class="dash-course" data-course-id="17660" data-course-status="ongoing" data-course-title="2026-1 MCE 306 Makine Tasarımının Temelleri 1"></article>
<article class="dash-course" data-course-id="19382" data-course-status="ongoing" data-course-title="2026-1 MCE 310 Sistem Dinamiği ve Kontrol 0 - 1"></article>
<article class="dash-course" data-course-id="19323" data-course-status="ongoing" data-course-title="MCE Staj4"></article>
<article class="dash-course" data-course-id="11111" data-course-status="completed" data-course-title="2025-2 MCE 200 Eski Ders 1"></article>`;

test('IEULearn öğrenci ana sayfası: dönem dersleri bulunur, şube numarası ve staj/eski ders ayıklanır', () => {
  assert.deepEqual(parseCourses(HOME), [
    { course: 'MCE306', name: 'Makine Tasarımının Temelleri', courseId: 17660 },
    { course: 'MCE310', name: 'Sistem Dinamiği ve Kontrol', courseId: 19382 },
  ]);
});

// Gerçek IEULearn çıktısından kısaltılmış örnek (MCE 350, Konu 1).
const PLAN = `<li class="ovup-syl-item-wrap" data-sim-resource-id="74895" data-syl-kind="resource" data-syl-id="74895"><a class="ovup-syl-item" href="javascript:void(0)" data-rv-payload="{&quot;id&quot;:74895,&quot;title&quot;:&quot;01-MCE350-Introduction&quot;,&quot;type&quot;:&quot;pdf&quot;,&quot;file_ext&quot;:&quot;pdf&quot;,&quot;file_name&quot;:&quot;01-MCE350-Intro.pdf&quot;}"></a></li>
<li data-syl-kind="resource"><a data-rv-payload="{&quot;id&quot;:1,&quot;title&quot;:&quot;Ders A&quot;,&quot;file_ext&quot;:&quot;pptx&quot;,&quot;file_name&quot;:&quot;a.pptx&quot;}"></a></li>
<li data-syl-kind="resource"><a data-rv-payload="{&quot;id&quot;:2,&quot;title&quot;:&quot;Ders A&quot;,&quot;file_ext&quot;:&quot;pdf&quot;,&quot;file_name&quot;:&quot;a.pdf&quot;}"></a></li>
<li data-syl-kind="resource"><a data-rv-payload="{&quot;id&quot;:3,&quot;title&quot;:&quot;GEET 312_Syllabus&quot;,&quot;file_ext&quot;:&quot;docx&quot;,&quot;file_name&quot;:&quot;s.docx&quot;}"></a></li>
<li class="ovup-syl-item-wrap is-sim-done" data-syl-kind="assignment" data-syl-id="807"><a class="ovup-syl-item"><span class="ovup-syl-item-main"><span class="ovup-syl-item-name" title="Lab1">Lab1 - Input Output Design</span></span></a></li>`;

test('IEULearn planı: dosyalar, aynı başlıkta PDF tercihi, syllabus atlanır', () => {
  assert.deepEqual(parsePlan(PLAN).map(r => r.id), [74895, 2]);
});

// Gerçek IEULearn çıktısı (MCE 412): hocanın konu açıklamasına koyduğu PPTX bağlantıları; bağlantısız ad ve başka site atlanır.
const DESC = `<p><a href="https://learn.ieu.edu.tr/uploads/editor-files/2026/09/ed_6ab3cb8b07b87_1790167947.pptx">Week2- Linear Algebra.pptx</a></p>
<p><a href="https://learn.ieu.edu.tr/uploads/editor-files/2026/09/ed_6ab3cb8b07b87_1790167947.pptx">Week2- Linear Algebra.pptx</a></p>
<p><a href="/uploads/editor-files/2026/09/ed_x.pdf">Kalman &amp; EKF</a></p>
<p>Week13_SLAM.pptx</p>
<p><a href="https://evil.example/uploads/editor-files/a.pptx">Kötü.pptx</a></p>`;

test('açıklamadaki dosya bağlantıları: tekrar ve dış site atlanır, ad ve uzantı', () => {
  assert.deepEqual(parseLinks(DESC, 'https://learn.ieu.edu.tr'), [
    { url: 'https://learn.ieu.edu.tr/uploads/editor-files/2026/09/ed_6ab3cb8b07b87_1790167947.pptx', file_name: 'Week2- Linear Algebra.pptx', title: 'Week2- Linear Algebra' },
    { url: 'https://learn.ieu.edu.tr/uploads/editor-files/2026/09/ed_x.pdf', file_name: 'Kalman & EKF.pdf', title: 'Kalman & EKF' },
  ]);
});

// Gerçek ödev kartları (overview-fragment): biri bekleyen, biri gönderilmiş.
const CARDS = `<article class="sa-card st-assign" data-sa-group="pending" data-sa-id="2471"> <a class="st-assign-link" href="x"> <span class="st-assign-date"><b>06</b> <small>Kas</small></span> <span class="st-assign-main"> <span class="st-assign-title"> Project Proposal Submission <span class="st-assign-group" title="Grup">Grup</span> </span> <span class="st-assign-meta"> <span class="st-assign-dot"></span> 2026-1 MCE 412 Otonom Robotik 1 <span class="st-assign-meta-sep">·</span> Son teslim 06 Kas 2026, 23:59 </span> </span> <span class="st-assign-chip">5 gün kaldı</span> </a> </article>
<article class="sa-card st-assign" data-sa-group="submitted" data-sa-id="1954"> <a> <span class="st-assign-main"> <span class="st-assign-title">Lab 4</span> <span class="st-assign-meta"> 2026-1 MCE 350 Endüstriyel Gömülü Sistemler 1 · Son teslim 04 Eki 2026, 9:05 </span> </span> </a> </article>`;

test('ödev kartları: durum, ders kodu, İstanbul saatiyle son teslim, sayfa bağlantısı', () => {
  const O = 'https://learn.ieu.edu.tr';
  const [a, b] = parseAssignments(CARDS, O);
  assert.deepEqual(a, { url: O + '/x', id: '2471', status: 'pending', title: 'Project Proposal Submission', course: 'MCE412', due: '2026-11-06T23:59:00+03:00' });
  assert.deepEqual([b.url, b.status, b.title, b.course, b.due], [null, 'submitted', 'Lab 4', 'MCE350', '2026-10-04T09:05:00+03:00']);
  // başka siteye ya da javascript: adresine giden bağlantı alınmaz
  for (const h of ['https://evil.example/a', 'javascript:alert(1)']) assert.equal(parseAssignments(CARDS.replace('href="x"', `href="${h}"`), O)[0].url, null);
});

test('csrf alanı okunur, yoksa hata verir', () => {
  assert.equal(field('<input type="hidden" name="csrf_token" value="abc&amp;1">', 'csrf_token'), 'abc&1');
  assert.throws(() => field('<form></form>', 'csrf_token'));
});

// Gerçek sinavlarim.ics'ten (satır sonları CRLF, saatler UTC).
const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261110T151500Z\r\nDTEND:20261110T161500Z\r\nSUMMARY:Sınav: FENG 497 Çok Disiplinli Mühendislik Projesi\r\nLOCATION:M 01\r\nBEGIN:VALARM\r\nTRIGGER:-P1D\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261107T143000Z\r\nDTEND:20261107T163000Z\r\nSUMMARY:Sınav: MCE 350 Endüstriyel\r\n Gömülü Sistemler\r\nLOCATION:M 102\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

test('ICS: ders kodu, UTC zamanlar ve yer; katlanmış satır açılır', () => {
  const ex = parseIcs(ICS);
  assert.deepEqual(ex[0], { course: 'FENG497', start: '2026-11-10T15:15:00Z', end: '2026-11-10T16:15:00Z', room: 'M 01' });
  assert.equal(ex[1].course, 'MCE350');
  assert.equal(new Date(ex[1].start).getTime(), new Date('2026-11-07T17:30:00+03:00').getTime()); // 17:30 yerel
});
