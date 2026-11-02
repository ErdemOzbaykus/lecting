const app = document.getElementById('app');
const HDR = { 'content-type': 'application/json', 'x-lecting': '1' };
const get = p => fetch(p).then(r => r.ok ? r.json() : Promise.reject(new Error(p)));
const post = (p, b) => fetch(p, { method: 'POST', headers: HDR, body: JSON.stringify(b) }).then(r => r.ok ? r.json() : Promise.reject(new Error(p)));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = window.markdownit(); // html:false -> ham HTML kaçırılır
const YT_ID = /^[\w-]{11}$/;
const ytPlayer = id => YT_ID.test(id || '') ? `<div class="yt"><iframe class="yt" data-id="${id}" title="Video" allowfullscreen
  allow="encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"
  src="https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&rel=0&origin=${encodeURIComponent(location.origin)}"></iframe></div>` : '';
let st, ses, view = 'home', timer;

// Sabit (veri içermeyen) çizgi ikonlar; currentColor ile temaya uyar.
const P = { home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>', plus: '<path d="M12 5v14M5 12h14"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  book: '<path d="M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4V4zM8 4v16"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', play: '<path d="M7 4.5v15l12-7.5z"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>', spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>', sync: '<path d="M20 11a8 8 0 00-14-4M4 4v4h4M4 13a8 8 0 0014 4M20 20v-4h-4"/>', left: '<path d="M15 5l-7 7 7 7"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>', moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>', auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>', side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>' };
const ico = n => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[n]}</svg>`;

// $...$ ve $$...$$ KaTeX ile; markdown-it'e girmeden önce yer tutucuya alınır.
function render(src, id, yt) {
  const maths = [];
  if (id) src = src.replace(/\]\(photos\//g, `](/lectures/${id}/photos/`); // notlardaki göreli görsel yolları
  src = src.replace(/^[ \t]*\[\[GÖRSEL [\d:]+\]\][ \t]*$/gm, ''); // video karesi henüz çekilmediyse işaret görünmesin
  src = src.replace(/\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g, (_, d, i) => { maths.push({ tex: (d || i).trim(), display: !!d }); return `@@M${maths.length - 1}@@`; });
  // YouTube bölümünde "(12:34)" / "(1:02:34)" atıfları oynatıcıyı o ana sarar
  if (YT_ID.test(yt || '')) src = src.replace(/\(([^()\n]*?\d{1,3}:\d{2}[^()\n]*)\)/g, (_, g) => '(' + g.replace(/\b(\d{1,3}):(\d{2})(?::(\d{2}))?\b/g,
    (t, a, b, c) => `[${t}](#yt=${yt}&t=${c ? a * 3600 + b * 60 + +c : a * 60 + +b})`) + ')');
  return md.render(src).replace(/@@M(\d+)@@/g, (_, n) => {
    const m = maths[n];
    try { return katex.renderToString(m.tex, { displayMode: m.display, throwOnError: false }); } catch { return esc(m.tex); }
  });
}
const sections = notes => {
  const p = notes.split(/\n(?=## )/);
  if (p.length > 1 && !/\S/.test(p[0].replace(/^#[^\n]*\n?/, ''))) p.shift(); // sadece başlık satırı olan ilk parça
  return p;
};

async function refresh() { st = await get('/api/state'); }

const remain = ms => {
  if (ms <= 0) return 'süresi geçti';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  return d ? `${d} gün ${h} sa kaldı` : `${h} sa ${m} dk kaldı`;
};
const cc = c => 'c' + Math.max(0, Object.keys(st.courses).indexOf(c)) % 6; // ders başına sabit renk sınıfı
const scoreTag = t => { const q = st.quiz?.[t.id]; return q ? `test ${q.score}/${q.total}` : ''; };

const examItem = e => {
  const d = new Date(e.start), r = remain(d - Date.now()), big = r.replace(/ kaldı$/, '');
  return `<li class="exam ${cc(e.course)}"><div class="ecount"><b>${esc(big)}</b>${r === big ? '' : '<span>kaldı</span>'}</div>
    <div><b>${esc(e.course)}</b> <span class="mut">${esc(e.name || '')}</span></div>
    <div class="mut">${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'short' })} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · ${esc(e.room)}</div></li>`;
};

// --- Kabuk: solda kalıcı gezinme rayı (telefonda alt çubuk), sağda içerik ---
const syncHtml = () => {
  const s = st.sync; if (!s) return '<span class="mut">Okul senkronu henüz çalışmadı</span>';
  const label = s.state === 'running' ? 'çalışıyor… ' : s.state === 'ok' ? 'tamam · ' : 'olmadı · ';
  return `<span class="sdot ${s.state === 'running' ? 'run' : s.state === 'ok' ? 'ok' : 'err'}"></span><span>Okul senkronu: ${esc(label + s.message)}</span>`;
};

function rail(active, course, chapters) {
  const nav = (id, icon, text) => `<button class="navi" data-nav="${id}" ${active === id ? 'aria-current="page"' : ''}>${ico(icon)}<span>${text}</span></button>`;
  const courses = Object.entries(st.courses).filter(([c]) => st.topics.some(t => t.course === c));
  return `<nav class="rail" aria-label="Ana gezinme"><div class="brand rhide">Lecting</div>
    ${nav('home', 'home', 'Bugün')}
    <div class="rlabel rhide">Dersler</div>
    ${courses.map(([c, name]) => `<button class="navi course rhide ${cc(c)}" data-nb="${esc(c)}" ${course === c ? 'aria-current="page"' : ''}><i class="dot"></i><span><b>${esc(c)}</b><small>${esc(name)}</small></span></button>${course === c ? chapters || '' : ''}`).join('')}
    <button class="navi monly" data-nav="courses" ${active === 'courses' ? 'aria-current="page"' : ''}>${ico('book')}<span>Dersler</span></button>
    ${nav('upload', 'plus', 'Kaynak ekle')}${nav('settings', 'gear', 'Ayarlar')}
    <div class="rsync rhide"><div class="syncmsg" data-sync>${syncHtml()}</div><button class="sm" data-act="sync">${ico('sync')}Okuldan güncelle</button>${themeBtn()}</div></nav>`;
}

// Görünüm: sistem -> açık -> koyu. Seçim yalnızca bu tarayıcıda; depolama yoksa sistem ayarı geçerli.
const THEMES = { system: 'Sistem', light: 'Açık', dark: 'Koyu' };
const theme = () => { try { return THEMES[localStorage.getItem('theme')] ? localStorage.getItem('theme') : 'system'; } catch { return 'system'; } };
const themeBtn = () => `<button class="sm" data-themebtn title="Görünümü değiştir">${ico(theme() === 'dark' ? 'moon' : theme() === 'light' ? 'sun' : 'auto')}Görünüm: ${THEMES[theme()]}</button>`;
function cycleTheme() {
  const next = { system: 'light', light: 'dark', dark: 'system' }[theme()];
  try { localStorage.setItem('theme', next); } catch { /* yok */ }
  if (next === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
  app.querySelectorAll('[data-themebtn]').forEach(b => { b.outerHTML = themeBtn(); });
  app.querySelector('[data-themebtn]')?.focus();
  bindTheme();
}
const bindTheme = () => app.querySelectorAll('[data-themebtn]').forEach(b => { b.onclick = cycleTheme; });

// Kenar çubuğu tercihi yalnızca kolaylık: depolama yoksa görünür kalır.
const railHidden = () => { try { return localStorage.getItem('railHidden') === '1'; } catch { return false; } };
function toggleRail() {
  const off = !document.querySelector('.shell').classList.toggle('noRail') ? '0' : '1';
  try { localStorage.setItem('railHidden', off); } catch { /* yok */ }
}

function shell(active, inner, course, chapters) {
  document.title = (course || { home: 'Bugün', courses: 'Dersler', upload: 'Kaynak ekle', settings: 'Ayarlar' }[active]) + ' · Lecting';
  app.innerHTML = `<a class="skip" href="#main">İçeriğe geç</a><div class="shell ${railHidden() ? 'noRail' : ''}"><button class="ib railtg noprint" id="railtg" title="Kenar çubuğunu gizle veya göster (⌃⌘S)" aria-label="Kenar çubuğunu gizle veya göster">${ico('side')}</button>${rail(active, course, chapters)}<main class="stage" id="main" tabindex="-1">${inner}</main></div>`;
  document.getElementById('railtg').onclick = toggleRail;
  bindTheme();
  app.querySelector('.skip').onclick = e => { e.preventDefault(); document.getElementById('main').focus(); };
  app.querySelectorAll('[data-nav]').forEach(b => { b.onclick = async () => { const n = b.dataset.nav; if (n === 'home') { await refresh(); home(); } else ({ settings, upload, courses }[n])(); }; });
  app.querySelectorAll('[data-nb]').forEach(b => { b.onclick = () => notebook(b.dataset.nb); });
  app.querySelectorAll('[data-act=sync]').forEach(b => { b.onclick = doSync; });
}

// Kısa durum mesajı (ekran okuyucu da duyar)
function toast(text) {
  let t = document.getElementById('toast');
  if (!t) { t = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = text; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 5000);
}
// Not üretimi işlemleri: sunucu 409 (üretim sürüyor) gibi hataları açıklamayla döner
async function act(p, b, okText) {
  const r = await fetch(p, { method: 'POST', headers: HDR, body: JSON.stringify(b) });
  const j = await r.json().catch(() => ({}));
  toast(r.ok ? okText : j.error || 'Olmadı (' + r.status + ')');
  await refresh();
  if (view === 'home') home(); else if (view === 'courses') courses(); else if (view === 'notebook') notebook(b.course || b.id.split('/')[0]);
}
// Onay: düğmeler sonucu söyler, varsayılan odak Vazgeç'te. Esc vazgeçer.
function ask(title, text, yes, danger) {
  return new Promise(res => {
    const d = document.createElement('dialog');
    d.className = 'ask';
    d.innerHTML = `<h2>${esc(title)}</h2><p class="mut">${esc(text)}</p><div class="btns"><button value="" autofocus>Vazgeç</button><button value="1" class="${danger ? 'danger' : 'primary'}">${esc(yes)}</button></div>`;
    d.querySelectorAll('button').forEach(b => { b.onclick = () => d.close(b.value); });
    d.onclose = () => { d.remove(); res(d.returnValue === '1'); };
    document.body.append(d); d.showModal();
  });
}
const lacking = t => !t.ready || !t.hasQuiz;
const topicStatus = t => st.building ? 'hazırlanıyor…' : st.errors?.[t.id] ? 'üretilemedi' : 'not yok';
const topicActs = t => `<span class="tacts"><button class="ib" data-reset="${esc(t.id)}" title="Notu sil ve yeniden üret" aria-label="${esc(t.title)}: yeniden üret">${ico('sync')}</button><button class="ib" data-del="${esc(t.id)}" title="Konuyu sil" aria-label="${esc(t.title)}: sil">${ico('trash')}</button></span>`;
function bindTopicActs() {
  app.querySelectorAll('[data-reset]').forEach(b => { b.onclick = async () => {
    const t = st.topics.find(x => x.id === b.dataset.reset);
    if (!t.ready || await ask('Yeniden üretilsin mi?', `"${t.title}" notu, sesi ve testi silinip baştan üretilir.`, 'Yeniden üret')) act('/api/topic-reset', { id: t.id }, 'Yeniden üretim başladı. Birkaç dakika sürer.');
  }; });
  app.querySelectorAll('[data-del]').forEach(b => { b.onclick = async () => {
    const t = st.topics.find(x => x.id === b.dataset.del);
    if (await ask('Konu silinsin mi?', `"${t.title}" listeden ve plandan kalkar, notları da silinir. Okul senkronu onu geri getirmez.`, 'Konuyu sil', true)) act('/api/topic-delete', { id: t.id }, 'Konu silindi.');
  }; });
  app.querySelectorAll('[data-build]').forEach(b => { b.onclick = () => act('/api/build', b.dataset.build ? { course: b.dataset.build } : {}, 'Not üretimi başladı. Hazır olanlar sırayla açılır.'); });
}

async function doSync() {
  if (!st.hasCreds) return settings();
  await post('/api/sync', {});
  st.sync = { state: 'running', message: 'başlatılıyor…' };
  if (view === 'home') home(); else document.querySelectorAll('[data-sync]').forEach(el => { el.innerHTML = syncHtml(); });
}

// Ders kartları: konu listesi açılır kapanır. Varsayılan olarak sınavı en yakın ders açık; seçim yeniden çizimde korunur.
const openState = {};
function courseCards(allOpen) {
  const soonest = [...st.exams].filter(e => new Date(e.end) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start))[0]?.course;
  return Object.entries(st.courses).map(([c, name]) => {
    const ts = st.topics.filter(t => t.course === c);
    if (!ts.length) return '';
    const done = ts.filter(t => t.done).length, missing = ts.filter(lacking).length;
    return `<article class="ccard ${cc(c)}"><header><div><b><i class="dot"></i>${esc(c)}</b><div class="mut">${esc(name)}</div></div><div class="hbtns">
      ${missing && !st.building ? `<button class="sm primary" data-build="${esc(c)}">${ico('spark')}Eksikleri üret (${missing})</button>` : ''}
      <button class="sm" data-nb="${esc(c)}">${ico('book')}Defteri aç</button></div></header>
      <div class="cprog"><span class="pbar" aria-hidden="true"><i style="width:${done / ts.length * 100}%"></i></span><span class="mut">${done}/${ts.length} konu tamam</span></div>
      <details class="tdet" data-c="${esc(c)}" ${allOpen || (openState[c] ?? c === soonest) ? 'open' : ''}><summary>Konular (${ts.length})</summary>
      <ul class="topics">${ts.map(t => `<li class="tli">${t.ready
        ? `<button class="trow" data-open="${esc(t.id)}"><span class="tick ${t.done ? 'on' : ''}">${t.done ? ico('check') : ''}</span><span class="tt">${esc(t.title)}</span><span class="mut">${scoreTag(t)}</span></button>`
        : `<div class="trow dim"><span class="tick"></span><span class="tt">${esc(t.title)}</span><span class="${st.errors?.[t.id] && !st.building ? 'late' : 'mut'}" title="${esc(st.errors?.[t.id] || '')}">${topicStatus(t)}</span></div>`}
        ${st.building ? '' : topicActs(t)}</li>`).join('')}</ul></details></article>`;
  }).join('');
}
function bindCards() {
  app.querySelectorAll('[data-open]').forEach(el => { const t = st.topics.find(x => x.id === el.dataset.open); el.onclick = () => open([t], 0); });
  app.querySelectorAll('details[data-c]').forEach(d => { d.ontoggle = () => { openState[d.dataset.c] = d.open; }; });
  bindTopicActs();
}
function courses() {
  view = 'courses'; ses = null; clearInterval(timer);
  shell('courses', `<header class="phead"><h1>Dersler</h1></header><div class="cgrid">${courseCards(true)}</div>`);
  bindCards(); scrollTo(0, 0);
}
// Arka plan yenilemesi: veri değişmediyse dokunma, değiştiyse kaydırma ve odak yerinde kalsın.
function poll() {
  timer = setInterval(async () => {
    const was = JSON.stringify(st);
    await refresh();
    if (view !== 'home' || JSON.stringify(st) === was) return;
    const y = scrollY, el = document.activeElement, key = ['data-open', 'data-q', 'data-nb', 'data-build', 'data-reset', 'data-del'].find(a => el?.hasAttribute?.(a));
    home(); scrollTo(0, y);
    if (key) app.querySelector(`[${key}="${CSS.escape(el.getAttribute(key))}"]`)?.focus();
  }, 20000);
}

function home() {
  view = 'home'; ses = null; clearInterval(timer);
  const day = st.plan.days.find(d => d.date === st.today);
  const queue = day ? day.items : [];
  const readyQ = queue.filter(t => t.ready);
  const exams = st.exams.filter(e => new Date(e.end) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start));
  const pending = st.assignments.filter(a => a.status === 'pending' && a.due).sort((a, b) => a.due.localeCompare(b.due));
  const missingAll = st.topics.filter(lacking).length;
  const gen = st.building ? `<div class="genbar" role="status"><span class="sdot run"></span><span class="gt">Notlar üretiliyor (${st.settings.provider === 'evren' ? 'EVREN' : 'Claude'}). Hazır olanlar sırayla açılır; bu sayfa kendini yeniler.</span></div>`
    : missingAll ? `<div class="genbar"><span>${missingAll} konunun notu veya testi eksik.</span><button class="sm primary" data-build="">${ico('spark')}Hepsini üret</button></div>` : '';
  const over = st.plan.overflow.length
    ? `<div class="warn" role="note">Sınavdan önce sığmayan ${st.plan.overflow.length} konu var (${esc([...new Set(st.plan.overflow.map(t => t.course))].join(', '))}). Ayarlardan günlük saati artır.</div>` : '';
  const dateLong = new Date(st.today + 'T12:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  shell('home', `<header class="phead"><h1>Bugün</h1>
      <p class="mut">${esc(dateLong)} · günde ${st.settings.hoursPerDay} saat</p>
      <div class="mobsync"><span class="mut" data-sync>${syncHtml()}</span><button class="sm" data-act="sync">${ico('sync')}Okuldan güncelle</button></div></header>
    <div class="cols"><div class="colmain">
      <section class="today" aria-labelledby="hq"><div class="trow2"><div><h2 id="hq">Bugünün sırası</h2>
        ${queue.length ? `<p class="mut">${queue.length} konu, ~${queue.reduce((s, t) => s + t.minutes, 0)} dk</p>` : ''}</div>
        <button class="primary big" id="start" ${readyQ.length ? '' : 'disabled'}>${ico('play')}Çalışmaya başla</button></div>
        ${queue.length ? `<div class="strip">${queue.map(t => `<button class="qcard ${cc(t.course)}" ${t.ready ? `data-q="${readyQ.indexOf(t)}"` : 'disabled'}>
          <span class="qc"><i class="dot"></i>${esc(t.course)}</span><span class="qt">${esc(t.title)}</span>
          <span class="mut">${t.ready ? t.minutes + ' dk' : 'notlar hazırlanıyor…'}</span></button>`).join('')}</div>`
        : '<p class="mut empty">Bugün için kalan konu yok.</p>'}</section>
      ${over}${gen}
      <section class="csec" aria-labelledby="hc"><h2 id="hc">Dersler ve defterler</h2><div class="cgrid">${courseCards()}</div></section>
    </div>
    <aside class="side"><section aria-labelledby="he"><h2 id="he">Sınavlar</h2><ul class="exams">${exams.map(examItem).join('') || '<li class="mut">Yaklaşan sınav yok.</li>'}</ul></section>
      <section aria-labelledby="ha"><h2 id="ha">Bekleyen ödevler</h2>
      ${pending.length ? `<ul class="plain">${pending.map(a => {
        const ms = new Date(a.due) - Date.now();
        return `<li class="item"><span>${esc(a.title)}${a.course ? ` <span class="mut">· ${esc(a.course)}</span>` : ''}</span><span class="${ms < 864e5 ? 'late' : 'mut'}">${remain(ms)}</span></li>`;
      }).join('')}</ul>` : '<p class="mut">Bekleyen ödev yok.</p>'}</section></aside></div>`);
  document.getElementById('start').onclick = () => open(readyQ, 0);
  app.querySelectorAll('[data-q]').forEach(b => { b.onclick = () => open(readyQ, +b.dataset.q); });
  bindCards();
  if (st.sync?.state === 'running' || st.building) poll();
}

async function open(queue, pos) {
  const t = await get('/api/topic?id=' + encodeURIComponent(queue[pos].id));
  const A = st.settings.mode === 'A', secs = sections(t.notes);
  const steps = A ? [...secs.map((_, i) => ({ k: 'sec', i })), ...(t.quiz ? [{ k: 'test' }] : [])]
    : [t.audio && { k: 'listen', n: 'Dinle' }, { k: 'read', n: 'Oku' }, t.questions.length && { k: 'quiz', n: 'Kendini dene' }, t.quiz && { k: 'test', n: 'Test' }, { k: 'end', n: 'Bitti' }].filter(Boolean);
  ses = { queue, pos, t, A, secs, steps, i: 0, qi: 0, show: false };
  view = 'session'; draw(); scrollTo(0, 0);
}

// Ders defteri: dersin tüm notları çizgili defter sayfasında; içindekiler solda rayda. "PDF / Yazdır" = PDF olarak kaydet.
async function notebook(course, focusId) {
  const nb = await get('/api/notebook?course=' + encodeURIComponent(course));
  view = 'notebook'; clearInterval(timer);
  const ex = st.exams.find(e => e.course === course);
  const ready = nb.chapters.filter(c => c.ready).length;
  const links = nb.chapters.map((c, i) => `<a href="#ch${i}" data-ch="${i}" class="rchap ${c.ready ? '' : 'dim'}" title="${esc(c.title)}">${c.done ? ico('check') : '<i></i>'}<span>${esc(c.title)}${c.ready ? '' : ` <em>(${topicStatus(c)})</em>`}</span></a>`).join('');
  const cap = `İçindekiler · ${ready}/${nb.chapters.length} konu hazır`;
  const body = nb.chapters.map((c, i) => !c.ready ? '' : `<section class="chapter" id="ch${i}">
    <div class="chtools noprint"><button class="sm" data-study="${esc(c.id)}">${ico('play')}Bu konuyu çalış</button>${c.audio ? `<audio controls preload="none" src="/lectures/${c.id}/summary.m4a"></audio>` : ''}${st.building ? '' : topicActs(c)}</div>
    ${ytPlayer(c.youtube)}<div class="note">${render(c.notes, c.id, c.youtube)}</div>
    ${c.questions.length ? `<h3>Kendini dene</h3>${c.questions.map(q => `<details><summary>${render(q.q).replace(/<\/?p>/g, '')}</summary>${render(q.a)}</details>`).join('')}` : ''}</section>`).join('');
  shell('notebook', `<div class="nbbar noprint"><details class="tocm"><summary>${esc(cap)}</summary>${links}</details>
    ${st.building ? '<span class="mut"><span class="sdot run"></span> Notlar üretiliyor…</span>' : nb.chapters.some(lacking) ? `<button class="primary" data-build="${esc(course)}">${ico('spark')}Eksikleri üret (${nb.chapters.filter(lacking).length})</button>` : ''}
    <button id="print">${ico('print')}PDF / Yazdır</button></div>
    <article class="paper"><header class="cover"><h1>${esc(course)}</h1><div class="sub">${esc(nb.name)}</div>
    ${ex ? `<div class="mut">Sınav: ${new Date(ex.start).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · ${esc(ex.room)}</div>` : ''}</header>
    ${body || '<p>Notlar hazırlanıyor…</p>'}</article>`, course, `<div class="rchaps"><div class="rcap">${esc(cap)}</div>${links}</div>`);
  document.getElementById('print').onclick = () => print();
  bindTopicActs();
  const go = i => document.getElementById('ch' + i)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  app.querySelectorAll('[data-ch]').forEach(a => { a.onclick = e => { e.preventDefault(); go(a.dataset.ch); a.closest('details')?.removeAttribute('open'); }; });
  app.querySelectorAll('[data-study]').forEach(b => { b.onclick = () => open([st.topics.find(t => t.id === b.dataset.study)], 0); });
  const at = nb.chapters.findIndex(c => c.id === focusId);
  if (at >= 0) go(at); else scrollTo(0, 0);
  // Okunan bölüm rayda işaretlenir
  if (window.IntersectionObserver) {
    const io = new IntersectionObserver(es => es.forEach(en => {
      if (!en.isIntersecting) return;
      app.querySelectorAll('.rail .rchap').forEach(a => a.toggleAttribute('aria-current', a.dataset.ch === en.target.id.slice(2)));
    }), { rootMargin: '-10% 0px -80% 0px' });
    app.querySelectorAll('.chapter').forEach(s => io.observe(s));
  }
}

// --- Çalışma oturumu: kenar çubuğu yok, tek odak ---
function draw() {
  const { t, A, steps, i, queue, pos } = ses, s = steps[i];
  const last = i === steps.length - 1;
  let body = '', primary = last ? 'Konuyu bitir' : 'Devam', wait = false;
  const audio = `/lectures/${t.id}/summary.m4a`;
  if (s.k === 'test') ({ body, primary, wait } = qzView());
  else if (A) body = (t.audio ? `<audio controls preload="none" src="${audio}"></audio>` : '') + ytPlayer(t.youtube) + `<div class="note">${render(ses.secs[s.i], t.id, t.youtube)}</div>`;
  else if (s.k === 'listen') body = `<h2>Sesli özet</h2><audio controls autoplay src="${audio}"></audio><p class="mut">Yaklaşık 40 saniye. Bitince Devam.</p>`;
  else if (s.k === 'read') body = ytPlayer(t.youtube) + `<div class="note">${render(t.notes, t.id, t.youtube)}</div>`;
  else if (s.k === 'quiz') {
    const q = t.questions[ses.qi];
    body = `<h2>Soru ${ses.qi + 1} / ${t.questions.length}</h2><div class="note">${render(q.q)}</div>${ses.show ? `<div class="answer note">${render(q.a)}</div>` : ''}`;
    primary = !ses.show ? 'Cevabı göster' : ses.qi < t.questions.length - 1 ? 'Sonraki soru' : 'Devam';
  } else body = `<h2>Konu bitti mi?</h2><p class="note">${esc(t.title)}</p>`;
  app.innerHTML = `<div class="focus"><div class="bar" role="progressbar" aria-label="Konu ilerlemesi" aria-valuemin="1" aria-valuemax="${steps.length}" aria-valuenow="${i + 1}"><i style="width:${(i + 1) / steps.length * 100}%"></i></div>
    <header class="ftop"><button id="exit" class="ghost">${ico('x')}Çık<kbd>Esc</kbd></button>
      <span class="crumb"><b>${esc(t.course)}</b> ${esc(t.title)}</span><span class="mut cnt">konu ${pos + 1}/${queue.length}${A ? ` · ${i + 1}/${steps.length}` : ''}</span></header>
    <main class="fmain">${A ? '' : `<ol class="steps">${steps.map((x, n) => `<li ${n === i ? 'class="on" aria-current="step"' : ''}><b>${n + 1}</b> ${x.n}</li>`).join('')}</ol>`}
      <div class="fcard">${body}</div></main>
    <footer class="foot"><button id="back" ${i ? '' : 'disabled'}>${ico('left')}Geri</button><button class="primary big" id="next" ${wait ? 'disabled' : ''}>${primary}</button>
      <span class="hint mut">Boşluk veya → ile ilerle</span></footer></div>`;
  document.getElementById('exit').onclick = async () => { await refresh(); home(); };
  document.getElementById('back').onclick = back;
  document.getElementById('next').onclick = go;
  if (s.k === 'test') qzBind();
}

function go() {
  const s = ses.steps[ses.i];
  if (s.k === 'test' && qzGo()) return;
  if (!ses.A && s.k === 'quiz') {
    if (!ses.show) { ses.show = true; return draw(); }
    if (ses.qi < ses.t.questions.length - 1) { ses.qi++; ses.show = false; return draw(); }
  }
  if (ses.i === ses.steps.length - 1) return finish();
  ses.i++; draw(); scrollTo(0, 0);
}
function back() { if (ses.i) { ses.i--; ses.qi = 0; ses.show = false; draw(); scrollTo(0, 0); } }

// --- Test: tek tek soru, anında geri bildirim, skor, yanlışları tekrar. Cevap kontrolü public/quiz.js ---
const inl = s => render(s).replace(/<\/?p>/g, '').trim();
const qzNew = (list, round) => ({ round, list: list.map(q => Quiz.prep(q)), idx: 0, phase: 'ask', ok: 0, wrong: [], res: null }); // phase: ask | fb | result

function qzView() {
  const z = ses.qz ||= qzNew(ses.t.quiz.questions, 0), n = z.list.length;
  if (z.phase === 'result') {
    return { primary: ses.A ? 'Konuyu bitir' : 'Devam', body: `<h2>${z.round ? 'Tekrar bitti' : 'Test bitti'}</h2>
      <p class="score"><b>${z.ok}</b><span>/ ${n} doğru</span></p>${z.round ? '<p class="mut">Tekrar turu; kayıtlı skor ilk turunki.</p>' : ''}
      ${z.wrong.length ? `<p><button id="qretry">Yanlışları tekrar çöz (${z.wrong.length})</button></p>` : '<p class="note">Hepsi doğru.</p>'}` };
  }
  const q = z.list[z.idx], fb = z.phase === 'fb', r = z.res;
  const choices = q.type === 'mcq' ? q.options : q.type === 'tf' ? ['Doğru', 'Yanlış'] : null;
  const right = q.type === 'mcq' ? q.answer : q.answer ? 0 : 1, picked = r && (q.type === 'mcq' ? r.a : r.a ? 0 : 1);
  let ui = '';
  if (choices) ui = choices.map((c, i) => `<button class="qopt ${fb ? (i === right ? 'right' : i === picked ? 'wrong' : '') : ''}" data-a="${i}" ${fb ? 'disabled' : ''}><b class="qn">${i + 1}</b><span>${inl(c)}</span>${fb && i === right ? ico('check') : fb && i === picked ? ico('x') : ''}</button>`).join('');
  else if (q.type === 'fill') ui = `<input type="text" id="fa" aria-label="Cevabın" autocomplete="off" spellcheck="false" placeholder="Cevabın" ${fb ? `disabled value="${esc(r.a)}"` : ''}>`;
  else ui = q.pairs.map((p, i) => `<div class="mrow"><span>${inl(p.l)}</span><select data-m="${i}" aria-label="Eşleşen seçenek" ${fb ? 'disabled' : ''}><option value="">—</option>${q.rights.map(x => `<option value="${esc(x)}" ${fb && r.a[i] === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>`).join('');
  const fix = fb && !r.ok ? (q.type === 'fill' ? ` Cevap: <b>${esc(q.answer)}</b>.` : q.type === 'match' ? ' ' + q.pairs.map(p => `${inl(p.l)} → ${inl(p.r)}`).join('; ') + '.' : '') : '';
  const card = fb ? `<div class="qfb ${r.ok ? 'right' : 'wrong'}" role="status"><b>${r.ok ? 'Doğru.' : 'Yanlış.'}</b>${fix} ${inl(q.explain)}${q.page ? `<div class="mut">Kaynak: s. ${esc(q.page)}</div>` : ''}</div>` : '';
  return { primary: fb ? (z.idx < n - 1 ? 'Sonraki soru' : 'Sonucu gör') : choices ? 'Bir seçenek seç' : 'Kontrol et', wait: !fb && !!choices,
    body: `<h2>${z.round ? 'Tekrar' : 'Test'} · soru ${z.idx + 1} / ${n}</h2><div class="note">${render(q.q.replace(/_{3,}/g, '\\_\\_\\_\\_\\_'))}</div><div class="qui">${ui}</div>${card}` };
}

function qzBind() {
  app.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => qzPick(+b.dataset.a); });
  const fa = document.getElementById('fa');
  if (fa && !fa.disabled) { fa.onkeydown = e => { if (e.key === 'Enter' && !e.repeat) qzGo(); }; fa.focus(); }
  const rt = document.getElementById('qretry');
  if (rt) rt.onclick = () => { ses.qz = qzNew(ses.qz.wrong, ses.qz.round + 1); draw(); };
}

function qzPick(i) { // çoktan seçmeli / doğru-yanlış: tıklanınca ya da sayı tuşuyla anında cevaplanır
  const z = ses.qz, q = z.list[z.idx];
  if (z.phase === 'ask') qzAnswer(q.type === 'mcq' ? i : i === 0);
}

function qzAnswer(a) {
  const z = ses.qz, q = z.list[z.idx], ok = Quiz.isCorrect(q, a);
  z.res = { a, ok }; z.phase = 'fb';
  if (ok) z.ok++; else z.wrong.push(q);
  draw();
}

// true: test adımı Devam/Enter'ı kendi yuttu (soruyu denetle, sonraki soruya ya da sonuca geç); false: sonuç ekranı, oturum sürsün.
function qzGo() {
  const z = ses.qz;
  if (!z || z.phase === 'result') return false;
  const q = z.list[z.idx];
  if (z.phase === 'ask') {
    if (q.type === 'fill') { const v = document.getElementById('fa')?.value; if (v?.trim()) qzAnswer(v); }
    else if (q.type === 'match') { const a = [...app.querySelectorAll('select[data-m]')].map(s => s.value); if (a.length && a.every(Boolean)) qzAnswer(a); }
    return true;
  }
  if (z.idx < z.list.length - 1) { z.idx++; z.phase = 'ask'; z.res = null; }
  else {
    z.phase = 'result';
    if (!z.round) { // yalnızca ilk tur kaydedilir
      const s = { score: z.ok, total: z.list.length, date: st.today };
      (st.quiz ||= {})[ses.t.id] = s;
      post('/api/quiz-score', { id: ses.t.id, score: s.score, total: s.total }).catch(() => {});
    }
  }
  draw(); scrollTo(0, 0);
  return true;
}

async function finish() {
  await post('/api/done', { id: ses.t.id, done: true });
  await refresh();
  const { queue, pos } = ses;
  if (pos + 1 < queue.length) return open(queue, pos + 1);
  view = 'end';
  const left = (st.plan.days.find(d => d.date === st.today)?.items || []).length;
  shell('home', `<div class="endcard"><h1>${left ? 'Hazır konular bitti' : 'Bugünlük bu kadar'}</h1>
    <p class="mut">${left ? `Bugünün sırasında ${left} konu daha var, notları hazırlanıyor. Hazır olunca ana ekranda açılır.` : 'Kalan konular yarının sırasına geçti.'}</p>
    <p><button class="primary big" id="h">Ana ekran</button></p></div>`);
  document.getElementById('h').onclick = home;
}

function settings() {
  view = 'settings'; clearInterval(timer);
  const s = st.settings;
  const opt = (name, val, cur, title, text) => `<label class="opt"><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}><span><b>${title}</b><small>${text}</small></span></label>`;
  shell('settings', `<header class="phead"><h1>Ayarlar</h1><p class="monly">${themeBtn()}</p></header><div class="sgrid">
    <section class="panel"><h2>Çalışma modu</h2><div class="choices">
      ${opt('m', 'A', s.mode, 'A · Tek akış', 'Ekranda sadece o an okuduğun bölüm. Tek "Devam" düğmesi.')}
      ${opt('m', 'B', s.mode, 'B · Her konu 4 adım', 'Sesli özet, not, sorular, bitti.')}</div>
      <h2>Günlük çalışma</h2><p class="inl"><label for="h">Günde</label><input type="number" id="h" min="0.5" max="16" step="0.5" value="${s.hoursPerDay}"> saat</p></section>
    <section class="panel"><h2>Not üretici</h2><div class="choices">
      ${opt('p', 'evren', s.provider, 'EVREN (API anahtarı)', 'Claude limitini harcamaz. Slayt metni, altyazısız videoda ses de EVREN sunucusuna gider.')}
      ${opt('p', 'claude', s.provider, 'Claude aboneliği', 'Slaytları görsel olarak da okur ama abonelik limitini çok harcar.')}</div>
      <p class="mut">EVREN anahtarı yalnızca bu bilgisayarda (.env, sadece sen okuyabilirsin) saklanır.${st.hasEvrenKey ? ' <b>Kayıtlı.</b> Değiştirmek için yeniden yaz.' : ''}</p>
      <div class="frow"><div class="field grow"><label for="ek">EVREN API anahtarı</label><input type="password" id="ek" autocomplete="off"></div>
        <div class="field"><label for="md">Model</label><input type="text" id="md" value="${esc(s.model)}" title="Model adı"></div></div>
      <p><button id="ptest">Bağlantıyı dene</button> <span class="mut" id="pres" role="status"></span></p></section>
    <section class="panel"><h2>Okul hesabı</h2>
      <p class="mut">IEULearn ve sınav sitesi için. Sadece bu bilgisayarda (.env, sadece sen okuyabilirsin) saklanır, Claude'a verilmez.${st.hasCreds ? ' <b>Kayıtlı.</b> Değiştirmek için yeniden yaz.' : ''}</p>
      <div class="frow"><div class="field grow"><label for="u">EkoID</label><input type="text" id="u" autocomplete="username"></div>
        <div class="field grow"><label for="pw">Şifre</label><input type="password" id="pw" autocomplete="current-password"></div></div></section>
    </div><p class="actions"><button class="primary big" id="save">Kaydet</button> <button id="cancel">Vazgeç</button></p>`);
  document.getElementById('cancel').onclick = home;
  document.getElementById('save').onclick = async () => {
    await saveSecrets();
    await post('/api/settings', { mode: app.querySelector('input[name=m]:checked').value, hoursPerDay: +document.getElementById('h').value,
      provider: app.querySelector('input[name=p]:checked').value, model: document.getElementById('md').value.trim() || 'auto' });
    await refresh(); home(); toast('Ayarlar kaydedildi.');
  };
  // Yalnızca doldurulan alanlar gönderilir; anahtar ve şifre sunucuda .env'ye yazılır, geri okunmaz.
  async function saveSecrets() {
    const u = document.getElementById('u').value.trim(), pw = document.getElementById('pw').value, ek = document.getElementById('ek').value.trim();
    const body = { ...(u && pw ? { user: u, pass: pw } : {}), ...(ek ? { evrenKey: ek } : {}) };
    if (Object.keys(body).length) await post('/api/credentials', body);
  }
  document.getElementById('ptest').onclick = async () => {
    const out = document.getElementById('pres'); out.textContent = 'deneniyor…';
    try {
      await saveSecrets();
      const r = await post('/api/provider-test', {});
      out.textContent = r.ok ? `Bağlandı. Modeller: ${r.models.join(', ') || '(liste boş)'}` : `Olmadı (${r.status || ''}): ${r.message}`;
    } catch (e) { out.textContent = 'Hata: ' + e.message; }
  };
}

function upload() {
  view = 'upload'; clearInterval(timer);
  shell('upload', `<header class="phead"><h1>Kaynak ekle</h1><p class="mut">Okul sitesinde olmayan kaynaklar (ör. FENG 497). Notlar birkaç dakikada hazırlanır.</p></header>
    <div class="field cpick"><label for="c">Ders</label><select id="c">${Object.entries(st.courses).map(([c, n]) => `<option value="${esc(c)}" ${c === 'FENG497' ? 'selected' : ''}>${esc(c)} · ${esc(n)}</option>`).join('')}</select></div>
    <div class="sgrid"><section class="panel"><h2>Dosya</h2><p class="mut">PDF, PowerPoint veya Word.</p>
      <p><input type="file" id="f" multiple accept=".pdf,.ppt,.pptx,.doc,.docx" aria-label="Dosya seç"></p>
      <p><button class="primary" id="go">Yükle</button></p></section>
    <section class="panel"><h2>YouTube videosu</h2><p class="mut">Altyazı varsa o kullanılır. Yoksa ses yazıya çevrilir: EVREN seçiliyse ses EVREN'e gider, değilse bu bilgisayarda işlenir. Uzun videoda birkaç dakika sürer.</p>
      <div class="field"><label for="yt">Video bağlantısı</label><input type="text" id="yt" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off"></div>
      <p><button id="goYt">Videoyu ekle</button></p></section></div>
    <p id="msg" class="mut" role="status"></p><p class="actions"><button id="cancel">Geri</button></p>`);
  document.getElementById('cancel').onclick = async () => { await refresh(); home(); };
  document.getElementById('go').onclick = async () => {
    const files = [...document.getElementById('f').files], c = document.getElementById('c').value, msg = document.getElementById('msg');
    for (const f of files) {
      msg.textContent = `Yükleniyor: ${f.name}`;
      const r = await fetch(`/api/upload?course=${encodeURIComponent(c)}&name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'x-lecting': '1' }, body: f });
      if (!r.ok) { msg.textContent = `Hata: ${f.name} (${(await r.json()).error})`; return; }
    }
    msg.textContent = files.length ? 'Yüklendi. Notlar arka planda hazırlanıyor, ana ekranda "hazırlanıyor" yazısı kaybolunca açılır.' : 'Dosya seç.';
  };
  document.getElementById('goYt').onclick = async () => {
    const msg = document.getElementById('msg');
    const r = await fetch('/api/youtube', { method: 'POST', headers: HDR, body: JSON.stringify({ course: document.getElementById('c').value, url: document.getElementById('yt').value }) });
    const j = await r.json().catch(() => ({}));
    msg.textContent = !r.ok ? `Hata: ${j.error || r.status}` : j.duplicate ? 'Bu video bu derste zaten ekli.'
      : 'Eklendi. Notlar arka planda hazırlanıyor; altyazı yoksa önce ses yazıya çevrilir.';
    if (r.ok) document.getElementById('yt').value = '';
  };
}

// Not içindeki (mm:ss) bağlantısı: aynı bölümdeki oynatıcıyı o ana sarar, oynatıcı yoksa videoyu o saniyede açar.
addEventListener('click', e => {
  const a = e.target.closest('a[href^="#yt="]');
  if (!a) return;
  e.preventDefault();
  const [, id, t] = /^#yt=([\w-]{11})&t=(\d+)$/.exec(a.getAttribute('href')) || [];
  if (!id) return;
  const f = a.closest('.chapter, main')?.querySelector(`iframe.yt[data-id="${id}"]`);
  if (!f) return Object.assign(document.createElement('a'), { href: `https://www.youtube.com/watch?v=${id}&t=${t}s`, target: '_blank', rel: 'noopener' }).click();
  const cmd = (func, args) => f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
  cmd('seekTo', [+t, true]); cmd('playVideo', []);
  f.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

addEventListener('unhandledrejection', e => toast('Olmadı: ' + (e.reason?.message || 'bağlantı hatası') + '. Yeniden dene.'));

addEventListener('keydown', e => {
  if (e.metaKey && e.ctrlKey && e.key.toLowerCase() === 's' && document.querySelector('.shell')) { e.preventDefault(); return toggleRail(); }
  if (document.querySelector('dialog[open]')) return; // Esc onay penceresini kapatır, sayfayı değiştirmez
  if (view === 'notebook' && e.key === 'Escape') return home();
  if (view !== 'session' || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; // yazarken Boşluk/oklar tetiklenmez
  const z = ses.steps[ses.i].k === 'test' && ses.qz;
  if (z && z.phase === 'ask') { // soru cevaplanmadan Boşluk/oklar soruyu atlatmaz
    const q = z.list[z.idx], n = q.type === 'mcq' ? q.options.length : q.type === 'tf' ? 2 : 0;
    if (/^[1-9]$/.test(e.key) && +e.key <= n) qzPick(+e.key - 1);
    else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !e.repeat) go();
    else if (e.key === 'Escape') document.getElementById('exit')?.click();
    return;
  }
  if (z && e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !e.repeat) go();
  else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(); }
  else if (e.key === 'ArrowLeft') back();
  else if (e.key === 'Escape') document.getElementById('exit')?.click();
});

refresh().then(home).catch(e => { app.innerHTML = `<main class="stage"><h1>Hata</h1><p>${esc(e.message)}</p></main>`; });
