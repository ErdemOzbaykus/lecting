#!/usr/bin/env node
// IEULearn'den ders dosyaları + ödev listesi, analytics.ieu.edu.tr'den sınav takvimi.
// Kimlik bilgisi: .env (IEU_USER, IEU_PASS) — uygulamanın Ayarlar ekranı yazar, başka yere gitmez.
// Bitince notları üretmek için tools/build.js'i başlatır.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, DATA, SRC, readJson, writeJson, env: loadEnv } = require('../lib/topics');
const { field, parsePlan, parseLinks, parseAssignments, parseIcs } = require('../lib/parse');
const { LEARN, Jar, req, loginLearn, assignmentsFragment } = require('../lib/learn');

const EXAM = 'https://analytics.ieu.edu.tr';
const STATUS = path.join(DATA, 'sync-status.json');
const status = (state, message = '') => writeJson(STATUS, { state, message, pid: process.pid, at: new Date().toISOString() });

async function syncCourses(env, mf) {
  const jar = await loginLearn(env);
  let got = 0;
  mf.assignments = parseAssignments(await (await assignmentsFragment(jar)).text(), LEARN);
  for (const [course, c] of Object.entries(mf.courses)) {
    const html = await (await req(jar, `${LEARN}/student/courses/${c.courseId}/overview/unit-plan`)).text();
    for (const f of parsePlan(html)) { // yeni dosya ekle; elle eklenenleri ve var olanları silme
      const has = c.topics.find(t => t.rid === f.id) || c.topics.find(t => t.title.toLowerCase() === f.title.trim().toLowerCase());
      if (has) has.rid = has.rid || f.id;
      else c.topics.push({ title: f.title.trim(), file: path.basename(f.file_name), rid: f.id });
    }
    for (const f of parseLinks(html, LEARN)) { // açıklamaya bağlantıyla konmuş dosyalar
      const has = c.topics.find(t => t.url === f.url) || c.topics.find(t => t.title.toLowerCase() === f.title.toLowerCase());
      if (has) has.url = has.url || f.url;
      else c.topics.push({ title: f.title, file: f.file_name, url: f.url });
    }
    for (const t of c.topics.filter(t => t.rid || t.url)) {
      const dest = path.join(SRC, course, path.basename(t.file));
      if (fs.existsSync(dest)) continue;
      const r = await req(jar, t.rid ? `${LEARN}/student/courses/${c.courseId}/resources/${t.rid}/download` : t.url);
      if (!r.ok || (r.headers.get('content-type') || '').includes('text/html')) throw new Error(`indirilemedi: ${course} ${t.file} (${r.status})`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      got++;
    }
  }
  return got;
}

async function syncExams({ IEU_USER, IEU_PASS, EXAM_USER, EXAM_PASS }) {
  const jar = new Jar();
  const page = await (await req(jar, EXAM + '/sinav_programi/Login/Login')).text();
  const fd = new FormData();
  fd.set('__RequestVerificationToken', field(page, '__RequestVerificationToken'));
  fd.set('returnUrl', '');
  fd.set('kullanici_adi', EXAM_USER || IEU_USER);
  fd.set('sifre', EXAM_PASS || IEU_PASS);
  const r = await req(jar, EXAM + '/sinav_programi', { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.success) throw new Error('Sınav sitesi girişi başarısız: ' + j.errorMessage);
  const exams = parseIcs(await (await req(jar, EXAM + '/sinav_programi/Ogrenci/Takvim')).text());
  if (!exams.length) throw new Error('Sınav takvimi boş geldi');
  writeJson(path.join(DATA, 'exams.json'), exams);
  return exams.length;
}

async function main() {
  const env = loadEnv();
  if (!env.IEU_USER || !env.IEU_PASS) { status('error', 'Okul hesabı girilmemiş (Ayarlar).'); return; }
  const prev = readJson(STATUS, {});
  if (prev.state === 'running') {
    try { process.kill(prev.pid, 0); return; } catch { /* süreç yok: eski kayıt, devam */ }
  }
  status('running', 'Okul siteleri okunuyor…');
  const mf = readJson(path.join(DATA, 'manifest.json'), { courses: {} }); // yoksa: manifest.example.json'a bakın
  const msgs = [];
  let failed = false;
  try { const n = await syncCourses(env, mf); writeJson(path.join(DATA, 'manifest.json'), mf); msgs.push(`${n} yeni dosya indirildi`); }
  catch (e) { failed = true; msgs.push('Dersler: ' + e.message); }
  try { msgs.push(`${await syncExams(env)} sınav`); }
  catch (e) { failed = true; msgs.push('Sınavlar: ' + e.message); }
  status(failed ? 'error' : 'ok', msgs.join(' · '));
  const log = fs.openSync(path.join(DATA, 'build.log'), 'a');
  spawn(process.execPath, [path.join(ROOT, 'tools/build.js')], { detached: true, stdio: ['ignore', log, log] }).unref(); // notları üret
}

main().catch(e => status('error', e.message));
