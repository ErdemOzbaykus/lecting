// Çalışma programı: sınavı en yakın dersin konuları önce (EDF), her güne saat sınırı.
const key = d => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); // YYYY-MM-DD

// topics: [{id, course, order, minutes, done, doneOn}] — doneOn bugünse bugünün kapasitesinden düşer.
function plan({ today, exams, topics, hoursPerDay }) {
  const todayKey = key(today);
  const deadline = Object.fromEntries(exams.map(e => [e.course, key(new Date(e.start))]));
  const todo = topics
    .filter(t => !t.done && deadline[t.course])
    .sort((a, b) => deadline[a.course].localeCompare(deadline[b.course]) || a.order - b.order);
  const spent = topics.filter(t => t.doneOn === todayKey).reduce((s, t) => s + t.minutes, 0);
  const days = [], overflow = [];
  let i = 0;
  for (let n = 0; i < todo.length && n < 120; n++) {
    const date = key(new Date(today.getTime() + n * 864e5));
    const cap = hoursPerDay * 60 - (n === 0 ? spent : 0);
    const items = [];
    let used = 0;
    while (i < todo.length && cap > 0) {
      const t = todo[i];
      if (date > deadline[t.course]) { overflow.push(t); i++; continue; } // sınav günü geçti, sığmadı
      if (items.length && used + t.minutes > cap) break;
      items.push(t); used += t.minutes; i++;
    }
    if (items.length) days.push({ date, items, minutes: used });
  }
  overflow.push(...todo.slice(i));
  return { days, overflow };
}

module.exports = { plan, key };
