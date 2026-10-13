'use strict';
/**
 * تست فایل اجرایی ساخته‌شده با pkg: exe واقعاً بالا می‌آید؟
 * فایل‌های ظاهری از داخل exe خوانده می‌شوند؟ دیتابیس کنار exe ساخته می‌شود؟
 *
 * اجرا:  node scripts/exe-smoke.js [مسیر-exe]
 * در CI روی نسخهٔ لینوکسی اجرا می‌شود (منطق snapshot در ویندوز هم همان است،
 * به‌علاوه پوشهٔ public کنار exe به‌عنوان مسیر یدک در پک پرتابل گذاشته شده).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = process.argv[2] || (process.platform === 'win32' ? 'dist/GhazaPors.exe' : 'dist/GhazaPors-linux');
const port = 20000 + Math.floor(Math.random() * 900);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exe-test-'));
const dbFile = path.join(tmp, 'exe.sqlite');
const base = `http://127.0.0.1:${port}`;

/** پیام را به‌صورت annotation قابل‌خواندن در GitHub نشان می‌دهد */
function annotate(msg) {
  const one = String(msg).replace(/\r?\n/g, '%0A').replace(/\]/g, '%5D').slice(0, 3500);
  console.log('::error::' + one);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + String(msg) + '\n```\n'); } catch {}
  }
}

(async () => {
  if (!fs.existsSync(exe)) {
    console.log('  - فایل اجرایی پیدا نشد، تست exe رد می‌شود:', exe);
    process.exit(0);
  }
  console.log('\n  exe:', exe);
  let spawnErr = null;
  try { fs.accessSync(exe, fs.constants.R_OK); } catch (e) { spawnErr = 'not readable: ' + e.message; }
  if (process.platform !== 'win32') {
    try { fs.accessSync(exe, fs.constants.X_OK); } catch (e) { spawnErr = 'not executable ( chmod +x لازم است ): ' + e.message; }
  }
  console.log('  size:', fs.statSync(exe).size, 'bytes', spawnErr ? '| ' + spawnErr : '');

  const child = spawn(exe, ['--port', String(port), '--no-browser', '--db', dbFile], {
    cwd: path.dirname(path.resolve(exe)),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GHADA_NO_BROWSER: '1' },
  });
  child.on('error', (e) => { spawnErr = 'spawn error: ' + e.message; });
  let log = '';
  child.stdout.on('data', (c) => (log += c));
  child.stderr.on('data', (c) => (log += c));

  let up = false;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) { up = true; break; }
    } catch {}
    if (child.exitCode !== null) break;
    await sleep(250);
  }
  const checks = [];
  const check = async (name, fn) => {
    try { await fn(); checks.push('  ✓ ' + name); }
    catch (e) {
      checks.push('  ✗ ' + name + ' — ' + e.message.split('\n')[0]);
      annotate('exe-smoke :: ' + name + ' :: ' + e.message.slice(0, 900) + (spawnErr ? ' :: ' + spawnErr : '') + ' :: log=' + log.slice(-700));
      process.exitCode = 1;
    }
  };

  await check('exe بالا آمد و /api/health داد', () =>
    assert.ok(up, 'سرور بالا نیامد (exit=' + child.exitCode + ')\n' + (spawnErr || '') + '\n' + log.slice(-900)));
  await check('بنر فارسی در کنسول چاپ شد', () => assert.ok(/دفترچه|دیتابیس/.test(log), log.slice(0, 200)));
  await check('صفحهٔ HTML از داخل exe خوانده می‌شود', async () => {
    const t = await (await fetch(base + '/')).text();
    assert.ok(t.includes('dir="rtl"') && t.includes('شمارهٔ تلفن داخلی'), 'HTML درست سرو نشد');
  });
  await check('فایل‌های css/js سرو می‌شوند', async () => {
    for (const p of ['/styles.css', '/app.js']) assert.strictEqual((await fetch(base + p)).status, 200, p);
  });
  await check('موتور SQLite (wasm) داخل exe کار می‌کند + ثبت رکورد', async () => {
    const r = await fetch(base + '/api/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'زهرا محمدی', extension: '۲۳۴۵', note: 'تست exe' }),
    });
    assert.strictEqual(r.status, 201, await r.text());
  });
  await check('جست‌وجو با پیشنهاد روی exe', async () => {
    const d = await (await fetch(base + '/api/search?q=' + encodeURIComponent('زهرا'))).json();
    assert.strictEqual(d.items[0].extension, '۲۳۴۵');
    const d2 = await (await fetch(base + '/api/search?q=2345')).json();
    assert.strictEqual(d2.items[0].name, 'زهرا محمدی', 'رقم لاتین هم باید پیدا کند');
  });
  await check('فایل دیتابیس کنار مسیر درخواستی ساخته شد (SQLite واقعی)', () => {
    assert.ok(fs.existsSync(dbFile), dbFile + ' وجود ندارد');
    assert.strictEqual(fs.readFileSync(dbFile).slice(0, 15).toString('latin1'), 'SQLite format 3');
  });
  await check('خروجی CSV', async () => {
    const t = await (await fetch(base + '/api/export.csv')).text();
    assert.ok(t.includes('زهرا محمدی'));
  });

  child.kill('SIGINT');
  await sleep(800);
  await check('با بستن برنامه، دیتابیس سالم ماند', () => assert.ok(fs.readFileSync(dbFile).length > 3000));

  console.log(checks.join('\n'));
  child.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
  if (process.exitCode) console.log('\nلاگ exe:\n' + log.slice(-1200));
  console.log(process.exitCode ? '\n  تست exe ناموفق' : '\n  تست exe موفق ✓');
})().catch((e) => { console.error(e); process.exit(1); });
