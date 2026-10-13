'use strict';
/**
 * تست خودکار: موتور جست‌وجو + لایهٔ دیتابیس + API روی HTTP واقعی.
 * اجرا:  npm run check
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { PhoneBook } = require('../server/db');
const { normalizeFa, compact, highlight } = require('../server/text');

let passed = 0;
const fails = [];
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (err) { fails.push([name, err]); console.log('  ✗', name, '\n     ', err.message); }
}
async function ta(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (err) { fails.push([name, err]); console.log('  ✗', name, '\n     ', err.message); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dahili-test-'));
const ext = (base, port) => `http://127.0.0.1:${port}${base}`;
async function j(p, port, opts = {}) {
  const res = await fetch(ext(p, port), { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
}

(async () => {
  console.log('\n[1] نرمال‌سازی متن فارسی');
  t('ی/ي و ک/ك و أ یکسان می‌شوند', () => assert.strictEqual(normalizeFa('علي رضایی'), normalizeFa('علی رضایی')));
  t('ارقام فارسی = لاتین', () => assert.strictEqual(normalizeFa('۲۳۴۵'), '2345'));
  t('نیم‌فاصله و فاصله عادی یکی می‌شوند', () => assert.strictEqual(normalizeFa('زه‌را  محمدی'), normalizeFa('زهرا محمدی')));
  t('compact فقط حرف و رقم', () => assert.strictEqual(compact('(۲۳۴۵)-الف'), '2345الف'));
  t('highlight برچسب امن می‌زند', () => assert.ok(highlight('زهرا <b>', 'زه').includes('<mark>') && !/<b>/.test(highlight('زهرا <b>', 'زه').replace(/<\/?mark>/g, ''))));

  console.log('\n[2] دیتابیس و جست‌وجو');
  const pb = await PhoneBook.open(path.join(tmp, 'unit.sqlite'));
  t('ساخت schema', () => assert.ok(pb.get("SELECT name FROM sqlite_master WHERE name='contacts'")));
  const a = pb.create({ fullName: 'زهرا محمدی', extension: '۲۳۴۵', note: 'امور کارکنان' });
  const b = pb.create({ fullName: 'علی رضایی', extension: '1102' });
  pb.create({ fullName: 'مریم احمدی', extension: '33-00', note: 'مالی' });
  t('ثبت و برگرداندن رکورد', () => assert.ok(a.id > 0 && a.full_name === 'زهرا محمدی' && b.extension === '1102'));
  t('داخلی با رقم فارسی نرمال شد', () => assert.strictEqual(compact(a.extension), '2345'));
  t('تکراری رد می‌شود', () => assert.throws(() => pb.create({ fullName: 'شخص دیگر', extension: '2345' }), /قبلاً.*ثبت شده/));
  t('جست‌وجو با رقم لاتین نتیجه می‌دهد', () => assert.strictEqual(pb.search('2345')[0].full_name, 'زهرا محمدی'));
  t('جست‌وجو با رقم فارسی نتیجه می‌دهد', () => assert.strictEqual(pb.search('۲۳۴۵')[0].full_name, 'زهرا محمدی'));
  t('جست‌وجو با ی عربی', () => assert.strictEqual(pb.search('علي')[0].full_name, 'علی رضایی'));
  t('جست‌وجوی بخشی از نام', () => assert.strictEqual(pb.search('محم')[0].full_name, 'زهرا محمدی'));
  t('دو کلمه = هردو باید باشند', () => assert.strictEqual(pb.search('زهرا مالی').length, 0));
  t('شمارهٔ با خط تیره پیدا می‌شود', () => assert.strictEqual(pb.search('3300')[0].full_name, 'مریم احمدی'));
  t('ویرایش', () => assert.strictEqual(pb.update(a.id, { note: 'تغییر یافت' }).note, 'تغییر یافت'));
  t('مرتب‌سازی نام با ترتیب الفبای فارسی', () => assert.deepStrictEqual(pb.list({}).items.map((r) => r.full_name), ['زهرا محمدی', 'علی رضایی', 'مریم احمدی']));
  t('csv سرصفحه دارد', () => assert.ok(pb.csv().startsWith('\uFEFF"نام و نام خانوادگی"')));
  await pb.flush();
  t('فایل روی دیسک نوشته شد', () => assert.ok(fs.statSync(pb.file).size > 3000));
  t('سربرگ SQLite معتبر', () => assert.strictEqual(fs.readFileSync(pb.file).slice(0, 15).toString('latin1'), 'SQLite format 3'));
  const reopened = await PhoneBook.open(pb.file);
  t('بازخوانی دیتابیس از فایل', () => assert.strictEqual(reopened.stats().count, 3));
  reopened.remove(b.id);
  await reopened.flush();
  await ta('حذف رکورد و ماندگاری روی دیسک', async () => assert.strictEqual((await PhoneBook.open(pb.file)).stats().count, 2));

  console.log('\n[3] سرور و API');
  const port = 18000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, [
    path.join(__dirname, '..', 'server', 'main.js'),
    '--port', String(port), '--no-browser', '--db', path.join(tmp, 'srv.sqlite'),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(ext('/api/health', port)); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  await ta('صفحهٔ اصلی RTL فارسی', async () => {
    const r = await j('/', port);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('dir="rtl"') && r.body.includes('شمارهٔ تلفن داخلی'), 'صفحه باید RTL و فارسی باشد');
  });
  await ta('/api/config', async () => assert.strictEqual((await j('/api/config', port)).body.suggestLimit > 0, true));
  await ta('POST ثبت', async () => {
    const r = await j('/api/contacts', port, { method: 'POST', body: JSON.stringify({ fullName: 'سارا جعفری', extension: '۲۲۸۸' }) });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.item.name, 'سارا جعفری');
  });
  await ta('POST نام خالی = ۴۲۲', async () => {
    const r = await j('/api/contacts', port, { method: 'POST', body: JSON.stringify({ fullName: '  ', extension: '12' }) });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.body.code, 'missing_name');
  });
  await ta('POST تکراری = ۴۲۲', async () => {
    const r = await j('/api/contacts', port, { method: 'POST', body: JSON.stringify({ fullName: 'فلانی', extension: '2288' }) });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.body.code, 'dup_ext');
  });
  await ta('GET /api/search پیشنهادها را با شمارهٔ داخلی می‌دهد', async () => {
    const r = await j('/api/search?q=جعفری', port);
    assert.strictEqual(r.body.items[0].extension, '۲۲۸۸', 'شماره همان‌طور که کاربر تایپ کرده نمایش داده می‌شود');
    assert.ok(r.body.items[0].nameHtml.includes('<mark>'));
  });
  const id = (await j('/api/contacts?limit=1', port)).body.items[0].id;
  await ta('PUT ویرایش', async () => {
    const r = await j('/api/contacts?id=' + id, port, { method: 'PUT', body: JSON.stringify({ extension: '9999', note: 'منتقل شد' }) });
    assert.strictEqual(r.body.item.extension, '9999');
  });
  await ta('DELETE حذف', async () => {
    assert.strictEqual((await j('/api/contacts?id=' + id, port, { method: 'DELETE' })).status, 200);
    assert.strictEqual((await j('/api/contacts', port)).body.total, 0);
  });
  await ta('ورود دسته‌جمعی', async () => {
    const r = await fetch(ext('/api/import', port), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'نام یک,111\nنام دو\t222\nنام سه;333' });
    const body = await r.json();
    assert.strictEqual(body.added, 3, JSON.stringify(body));
  });
  await ta('خروجی CSV با BOM', async () => {
    const r = await fetch(ext('/api/export.csv', port));
    const buf = Buffer.from(await r.arrayBuffer());
    assert.deepStrictEqual([...buf.slice(0, 3)], [0xef, 0xbb, 0xbf], 'اکسل برای UTF-8 به BOM نیاز دارد');
    assert.ok(buf.toString('utf8').includes('نام یک'));
    assert.ok(/\u200E"111"/.test(buf.toString('utf8')), 'شمارهٔ داخلی باید با علامت جهت حفظ شود');
  });
  await ta('بکاپ SQLite دانلود می‌شود', async () => {
    const r = await fetch(ext('/api/backup.sqlite', port));
    const buf = Buffer.from(await r.arrayBuffer());
    assert.strictEqual(buf.slice(0, 15).toString('latin1'), 'SQLite format 3');
    fs.writeFileSync(path.join(tmp, 'restore.sqlite'), buf);
  });
  await ta('بازیابی از فایل', async () => {
    const buf = fs.readFileSync(path.join(tmp, 'restore.sqlite'));
    const r = await fetch(ext('/api/restore', port), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await j('/api/contacts', port)).body.total, 3);
  });
  await ta('مسیر API ناموجود ۴۰۴', async () => assert.strictEqual((await j('/api/nope', port)).status, 404));
  await ta('جلوگیری از path traversal', async () => {
    const r = await fetch(ext('/../../package.json', port).replace('127.0.0.1', '127.0.0.1'));
    assert.ok([200, 403, 404].includes(r.status));
    const txt = await r.text();
    assert.ok(!txt.includes('"pkg"'), 'نباید محتوای بیرون از public سرو شود');
  });
  await ta('/api/version عدد تغییر کرده', async () => assert.ok((await j('/api/version', port)).body.version > 0));

  child.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 700));

  console.log('\n[4] PIN (رمز ویرایش)');
  const port2 = port + 1;
  const child2 = spawn(process.execPath, [
    path.join(__dirname, '..', 'server', 'main.js'),
    '--port', String(port2), '--no-browser', '--db', path.join(tmp, 'pin.sqlite'),
  ], { env: { ...process.env, GHADA_PIN: '1234' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(ext('/api/health', port2)); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  await ta('بدون رمز رد می‌شود', async () => assert.strictEqual((await j('/api/contacts', port2, { method: 'POST', body: JSON.stringify({ fullName: 'x', extension: '1' }) })).status, 403));
  await ta('با رمز قبول می‌شود', async () => {
    const r = await j('/api/contacts', port2, { method: 'POST', body: JSON.stringify({ fullName: 'x', extension: '1' }), headers: { 'X-Edit-Pin': '1234' } });
    assert.strictEqual(r.status, 201);
  });
  await ta('خواندن بدون رمز آزاد است', async () => assert.strictEqual((await j('/api/search?q=x', port2)).status, 200));
  child2.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('\n' + '─'.repeat(50));
  console.log(`  ${passed} تست موفق` + (fails.length ? ` — ${fails.length} خطا` : ''));
  if (fails.length) {
    console.log('\nخطاها:\n' + out.slice(-1500));
    process.exit(1);
  }
  console.log('─'.repeat(50) + '\n');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
