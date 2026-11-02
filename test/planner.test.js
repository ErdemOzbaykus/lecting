const test = require('node:test');
const assert = require('node:assert');
const { plan } = require('../lib/planner');

const mk = (course, n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `${course}/${i}`, course, order: i, minutes: 40, done: false, doneOn: null, ...extra }));
const exams = [
  { course: 'A', start: '2026-11-07T17:30:00+03:00' },
  { course: 'B', start: '2026-11-08T10:00:00+03:00' },
];
const today = new Date('2026-11-01T11:00:00+03:00');
const last = { A: '2026-11-07', B: '2026-11-08' };

test('hiçbir konu sınav gününden sonraya kalmaz, gün sınırı aşılmaz', () => {
  const { days, overflow } = plan({ today, exams, topics: [...mk('B', 4), ...mk('A', 7)], hoursPerDay: 4 });
  assert.equal(overflow.length, 0);
  assert.equal(days.flatMap(d => d.items).length, 11);
  for (const d of days) {
    assert.ok(d.minutes <= 240);
    for (const t of d.items) assert.ok(d.date <= last[t.course]);
  }
});

test('sınavı önce olan ders önce çalışılır', () => {
  const { days } = plan({ today, exams, topics: [...mk('B', 2), ...mk('A', 2)], hoursPerDay: 4 });
  assert.equal(days[0].items[0].course, 'A');
});

test('sınav gününe sığmayan konu overflow olur', () => {
  const t6 = new Date('2026-11-06T11:00:00+03:00');
  const { overflow } = plan({ today: t6, exams: [exams[0]], topics: mk('A', 5), hoursPerDay: 0.1 });
  assert.equal(overflow.length, 3); // 6-7 Kasım: günde 1 konu
});

test('bugün bitirilen süre bugünün kapasitesinden düşer', () => {
  const done = mk('A', 6, { done: true, doneOn: '2026-11-01' });
  const { days } = plan({ today, exams, topics: [...done, ...mk('B', 2).map(t => ({ ...t, id: 'B2/' + t.id }))], hoursPerDay: 4 });
  assert.equal(days[0].date, '2026-11-02');
});
