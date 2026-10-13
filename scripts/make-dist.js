'use strict';
/**
 * ساخت پوشه‌ها و فایل‌های ZIP پرتابل برای انتشار.
 * اجرا:  node scripts/make-dist.js          (بعد از ساخت exe ها)
 *
 * هر پک شامل: فایل اجرایی + اسکریپت اجرا + config.json + داده‌های آماده (data) + راهنما
 * به‌علاوه پوشه‌ی server/ و public/ تا اگر آنتی‌ویروس سازمان اجازهٔ اجرای exe را نداد،
 * با یک Node.js ساده هم بشود برنامه را بالا آورد (بدون تغییر هیچ چیزی).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORTABLE = path.join(DIST, 'portable');

const NAME = 'GhazaPors';
const VARIANTS = [
  { exe: NAME + '.exe', slug: 'win-x64', launcher: ['start.bat', 'firewall-allow.bat'], label: 'ویندوز ۶۴بیت' },
  { exe: NAME + '-linux', slug: 'linux-x64', launcher: ['start.sh'], label: 'لینوکس ۶۴بیت' },
  { exe: NAME + '-mac', slug: 'macos-x64', launcher: ['start.sh'], label: 'مک' },
];

const COPY = ['config.json', 'config.example.json', 'README.md', 'LICENSE', 'server', 'public', 'package.json'];

function copy(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dest, f));
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    if (dest.endsWith('.sh') || dest.endsWith('.bat')) {
      fs.chmodSync(dest, 0o755);
      if (dest.endsWith('.sh')) fs.writeFileSync(dest, fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n'));
    }
  }
}

function zip(fromDir, toFile) {
  try {
    execSync(`zip -rq -X "${toFile}" "${path.basename(fromDir)}"`, { cwd: PORTABLE, stdio: 'pipe' });
  } catch {
    execSync(`python3 -m zipfile -c "${toFile}" "${path.basename(fromDir)}"`, { cwd: PORTABLE, stdio: 'pipe' });
  }
}

function main() {
  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
  fs.rmSync(PORTABLE, { recursive: true, force: true });
  fs.mkdirSync(PORTABLE, { recursive: true });

  const made = [];
  for (const v of VARIANTS) {
    const exe = path.join(DIST, v.exe);
    if (!fs.existsSync(exe)) {
      console.log('  - رد شد (ساخته نشده):', v.exe);
      continue;
    }
    const dir = path.join(PORTABLE, `${NAME}-${v.slug}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(exe, path.join(dir, v.exe));
    if (v.exe !== NAME + '.exe') fs.chmodSync(path.join(dir, v.exe), 0o755);
    for (const f of COPY) {
      const src = path.join(ROOT, f);
      if (fs.existsSync(src)) copy(src, path.join(dir, f));
    }
    for (const f of v.launcher) {
      const src = path.join(ROOT, f);
      if (fs.existsSync(src)) copy(src, path.join(dir, f));
    }
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'data', 'README.txt'),
      'فایل دیتابیس (dahili.sqlite) در این پوشه ساخته و نگهداری می‌شود.\n' +
        'برای انتقال برنامه به جای دیگر، کل همین پوشه را کپی کنید (یا فقط فایل sqlite را).\n'
    );
    const zipFile = path.join(DIST, `${NAME}-${v.slug}.zip`);
    zip(dir, zipFile);
    made.push({ variant: v.label, exe: v.exe, zip: path.relative(ROOT, zipFile), size: (fs.statSync(zipFile).size / 1048576).toFixed(1) + ' MB' });
  }

  if (!made.length) {
    console.error('هیچ فایل اجرایی در dist پیدا نشد. اول بسازید:  npx pkg . --targets node22-win-x64 --output dist/' + NAME + '.exe');
    process.exit(1);
  }
  console.log('\n  پک‌های آماده:\n' + made.map((m) => `   ${m.variant.padEnd(18)} ${m.zip} (${m.size})`).join('\n') + '\n');
}

main();
