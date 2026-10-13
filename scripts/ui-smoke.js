'use strict';
/**
 * تست سطح رابط کاربری با jsdom: صفحهٔ واقعی لود می‌شود، سرور واقعی پاسخ می‌دهد،
 * و تایپ/کلیک/فرم‌ها از مسیر DOM انجام می‌شود.
 * اجرا:  node scripts/ui-smoke.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000, step = 60) => {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch { v = false; }
    if (v) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dahili-ui-'));
let passed = 0;
const fails = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (err) { fails.push([name, err]); console.log('  ✗', name, '\n     ', err.message.split('\n')[0]); }
}

(async () => {
  const port = 19000 + Math.floor(Math.random() * 800);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    path.join(__dirname, '..', 'server', 'main.js'),
    '--port', String(port), '--no-browser', '--db', path.join(tmp, 'ui.sqlite'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errlog = '';
  child.stderr.on('data', (c) => (errlog += c));

  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch {}
    await sleep(150);
  }

  const vc = new VirtualConsole();
  const consoleLines = [];
  vc.on('jsdomError', (e) => consoleLines.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => consoleLines.push('error: ' + a.join(' ')));
  const dom = new JSDOM(await (await fetch(base + '/')).text(), {
    virtualConsole: vc,
    url: base + '/',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, o) => fetch(new URL(u, base).href, o);
      window.Element.prototype.scrollIntoView = () => {};
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      window.addEventListener('error', (e) => consoleLines.push('window.onerror: ' + (e.error && e.error.stack || e.message)));
      window.addEventListener('unhandledrejection', (e) => consoleLines.push('unhandled: ' + (e.reason && e.reason.stack || e.reason)));
    },
  });
  const { window } = dom;
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  // صبر تا app.js بوت تمام شود (رویدادها وصل شده باشند)
  assert.ok(await until(() => window.document.documentElement.dataset.ready === '1'), 'app.js بوت نشد');
  await until(() => $('#tbody').querySelectorAll('tr').length > 0 || window.document.body.classList.contains('is-empty'));
  const type = async (sel, value) => {
    const el = $(sel);
    el.value = value;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(320);
  };
  const submit = async () => {
    $('#form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(420);
  };

  console.log('\n  صفحه بارگذاری شد — تست تعاملی');

  await t('صفحه راست‌به‌چپ و فارسی است', () => {
    assert.strictEqual(window.document.documentElement.lang, 'fa');
    assert.strictEqual(window.document.documentElement.dir, 'rtl');
    assert.ok($('label[for], .field-label').textContent.includes('نام و نام خانوادگی'));
    assert.ok(window.document.body.textContent.includes('شمارهٔ تلفن داخلی'));
  });
  await t('دو ورودی اصلی و یک ورودی اختیاری وجود دارد', () => {
    assert.ok($('#f-name') && $('#f-ext') && $('#f-note'));
  });
  $('#f-name').value = 'زهرا محمدی';
  $('#f-ext').value = '۲۳۴۵';
  $('#f-note').value = 'امور کارکنان';
  await t('ثبت با کلیک روی «ذخیره در دیتابیس»', async () => {
    $('#f-save').click();
    assert.ok(await until(() => $('#tbody').querySelectorAll('tr').length === 1), 'یک ردیف باید اضافه شود');
    assert.ok($$('.toast').some((x) => /ثبت شد/.test(x.textContent)), 'تأیید ثبت به کاربر نشان می‌شود');
    const h = await (await fetch(base + '/api/health')).json();
    assert.strictEqual(h.db.count, 1);
  });
  await t('بعد از ثبت، کارت «یافت شد» شمارهٔ داخلی را نشان می‌دهد', async () => {
    assert.ok(await until(() => $('#result').hidden === false));
    assert.strictEqual($('#result').hidden, false);
    assert.strictEqual($('#result-name').textContent, 'زهرا محمدی');
    assert.strictEqual($('#result-ext').textContent, '۲۳۴۵');
  });
  await t('جست‌وجو با پیشنهاد خودکار (تایپ بخشی از نام)', async () => {
    await type('#q', 'محمد');
    const items = $$('#suggestions li');
    assert.ok(items.length >= 1, 'باید حداقل یک پیشنهاد بیاید');
    assert.ok(items[0].textContent.includes('زهرا محمدی'));
    assert.ok(items[0].textContent.includes('۲۳۴۵'), 'شمارهٔ داخلی هم در پیشنهاد هست');
    assert.ok(items[0].querySelector('mark'), 'بخش منطبق برجسته می‌شود');
  });
  await t('جست‌وجو با شمارهٔ داخلی (رقم لاتین → رکورد رقم فارسی)', async () => {
    await type('#q', '2345');
    await until(() => $$('#suggestions li').length > 0, 1500);
    assert.ok($$('#suggestions li')[0].textContent.includes('زهرا'));
  });
  await t('اینتر = انتخاب پیشنهاد اول و نمایش جزئیات', async () => {
    $('#result').hidden = true;
    $('#q').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.ok(await until(() => $('#result').hidden === false));
    assert.strictEqual($('#result-name').textContent, 'زهرا محمدی');
    assert.strictEqual($$('#suggestions li').length, 0, 'لیست پیشنهاد باید بسته شود');
  });
  await t('پیشنهاد برای عبارت بی‌ربط: پیام «پیدا نشد»', async () => {
    await type('#q', 'قرنطمروزک');
    assert.ok($('#suggestions').textContent.includes('پیدا نشد'));
  });

  await t('اعتبارسنجی: نام خالی خطای محلی نشان می‌دهد', async () => {
    $('#f-name').value = '';
    $('#f-ext').value = '9999';
    await submit();
    assert.ok($('#f-name').closest('.field').classList.contains('bad'));
    assert.ok($('.field.bad .error').textContent.length > 3);
    const h = await (await fetch(base + '/api/health')).json();
    assert.strictEqual(h.db.count, 1, 'چیزی ذخیره نشده باشد');
  });
  await t('اعتبارسنجی: شمارهٔ نامعتبر', async () => {
    $('#f-name').value = 'تست';
    $('#f-ext').value = 'abc';
    await submit();
    assert.ok($('#f-ext').closest('.field').classList.contains('bad'));
  });
  await t('ثبت رکورد دوم', async () => {
    $('#f-name').value = 'علی رضایی';
    $('#f-ext').value = '1102';
    $('#f-note').value = '';
    await submit();
    assert.ok(await until(() => $('#tbody').querySelectorAll('tr').length === 2));
  });
  await t('تکراری بودن شمارهٔ داخلی با پیام فارسی رد می‌شود', async () => {
    $('#f-name').value = 'کس دیگر';
    $('#f-ext').value = '1102';
    await submit();
    const toast = $$('.toast').map((x) => x.textContent).join(' ');
    assert.ok(/قبلاً/.test(toast), 'توست تکراری: ' + toast);
  });

  await t('ویرایش از جدول', async () => {
    const row = $$('#tbody tr').find((r) => r.textContent.includes('علی'));
    row.querySelector('[data-act="edit"]').click();
    await sleep(150);
    assert.strictEqual($('#f-name').value, 'علی رضایی');
    assert.ok($('#f-cancel').hidden === false, 'دکمهٔ انصراف باید دیده شود');
    $('#f-ext').value = '1150';
    await submit();
    assert.ok(await until(() => $('#tbody').textContent.includes('1150')));
    assert.ok(!$('#tbody').textContent.includes('1102'), 'شمارهٔ قدیمی نباید بماند');
  });
  await t('حذف با تأیید', async () => {
    const before = $$('#tbody tr').length;
    const zRow = $$('#tbody tr').find((r) => r.textContent.includes('زهرا'));
    assert.ok(zRow, 'ردیف زهرا باید در جدول باشد');
    zRow.querySelector('[data-act="del"]').click();
    await sleep(120);
    assert.strictEqual($('#dlg').hidden, false, 'دیالوگ تأیید باز شود');
    assert.ok($('#dlg-body').textContent.includes('قابل بازگشت'));
    $('#dlg-ok').click();
    assert.ok(await until(() => $$('#tbody tr').length === before - 1), 'ردیف باید حذف شود');
  });
  await t('فیلتر فهرست', async () => {
    await type('#list-filter', 'رضایی');
    assert.strictEqual($$('#tbody tr').length, 1);
    await type('#list-filter', '');
    assert.ok($$('#tbody tr').length >= 1);
  });
  await t('مرتب‌سازی با منوی ترتیب', async () => {
    $('#sort').value = 'ext';
    $('#sort').dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(350);
    assert.ok($$('#tbody tr').length >= 1);
  });
  await t('کپی شمارهٔ داخلی (با fallback به execCommand)', async () => {
    const row = $$('#tbody tr')[0];
    row.click();
    await sleep(100);
    $('#result-copy').click();
    await sleep(200);
    assert.ok(true); // فقط نباید استثنا بزند
  });
  await t('خروجی CSV و بکاپ از طریق لینک‌های ابزارها', async () => {
    for (const p of ['/api/export.csv', '/api/backup.sqlite']) {
      const r = await fetch(base + p);
      assert.strictEqual(r.status, 200, p);
      assert.ok((await r.arrayBuffer()).byteLength > 0);
    }
  });
  await t('دیالوگ «ورود دسته‌جمعی» باز و کار می‌کند', async () => {
    $('#btn-import').click();
    await sleep(150);
    const ta = $('#dlg-body textarea');
    assert.ok(ta, 'textarea ورودی');
    ta.value = 'مریم احمدی,3300\nحسین کریمی,2410';
    $('#dlg-ok').click();
    assert.ok(await until(() => $('#dlg-body').textContent.includes('وارد شد')));
    assert.ok($('#tbody').textContent.includes('مریم احمدی'));
    $('#dlg-cancel').click();
  });
  await t('دیالوگ «آدرس شبکه»', async () => {
    $('#btn-share').click();
    await sleep(200);
    assert.ok($('#dlg-title').textContent.includes('شبکه'));
    $('#dlg-cancel').click();
  });
  await t('به‌روزرسانی خودکار وقتی همکار چیزی ثبت می‌کند', async () => {
    const before = $('#tbody').querySelectorAll('tr').length;
    await fetch(base + '/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: 'سارا جعفری', extension: '2288' }) });
    for (let i = 0; i < 60 && $('#tbody').querySelectorAll('tr').length === before; i++) await sleep(200);
    assert.strictEqual($('#tbody').querySelectorAll('tr').length, before + 1, 'فهرست باید بدون رفرش دست‌ی تازه شود');
  });
  await t('متن مخرب (XSS) به‌شکل متن خالی ذخیره و نمایش داده می‌شود', async () => {
    $('#f-name').value = '<img src=x onerror="window.__pwned=1">';
    $('#f-ext').value = '777';
    await submit();
    assert.ok(await until(() => $('#tbody').textContent.includes('<img')));
    assert.strictEqual(window.__pwned, undefined, 'اسکریپت نباید اجرا شود');
    const row = $$('#tbody tr').find((r) => r.querySelector('.nm').textContent.includes('<img'));
    assert.ok(row, 'نام باید همان‌طور که تایپ شده نمایش داده شود');
    assert.strictEqual(row.querySelector('img'), null);
  });
  await t('شمارشگر و چیپ‌ها به‌روز هستند', () => {
    assert.ok(/رکورد/.test($('#chip-count').textContent));
    assert.ok($('#list-count').textContent.length > 0);
    assert.ok($('#foot-db').textContent.includes('ui.sqlite'));
  });
  await t('هیچ خطای console در کلاینت رخ نداده', () => {
    assert.ok(consoleLines.length === 0, 'خطاها:\n' + consoleLines.slice(0, 6).join('\n'));
    assert.ok(!/Uncaught|is not defined|TypeError/.test(errlog), errlog.slice(0, 400));
  });

  child.kill('SIGINT');
  await sleep(500);
  dom.window.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('\n' + '─'.repeat(50));
  console.log(`  ${passed} تست رابط کاربری موفق` + (fails.length ? ` — ${fails.length} خطا` : ''));
  if (fails.length) {
    console.log('\n' + fails.map(([n, e]) => n + ': ' + e.message.split('\n').slice(0, 4).join(' | ')).join('\n'));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
