#!/usr/bin/env node
/**
 * کپی موتور SQLite (sql.js / wasm) به پوشه‌ی vendor تا اپ نه به npm و نه به
 * هیچ فایلی بیرون از خودش وابسته باشد (شرط اصلی برای پرتابل بودن و ساخت exe).
 *
 * اجرا:  node scripts/make-vendor.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'sql.js', 'dist');
const OUT = path.join(ROOT, 'server', 'vendor');

fs.mkdirSync(OUT, { recursive: true });

const js = fs.readFileSync(path.join(SRC, 'sql-wasm.js'));
fs.writeFileSync(path.join(OUT, 'sql-wasm.js'), js);

const wasm = fs.readFileSync(path.join(SRC, 'sql-wasm.wasm'));
const banner =
  '/* فایل خودکار — توسط scripts/make-vendor.js ساخته می‌شود.\n' +
  '   موتور SQLite (wasm) به‌صورت base64 داخل همین فایل است تا موقع اجرا\n' +
  '   هیچ فایل بیرونی لازم نباشد. دستی ویرایشش نکنید. */\n' +
  "'use strict';\nmodule.exports = ";

fs.writeFileSync(path.join(OUT, 'sql-wasm.data.js'), banner + JSON.stringify(wasm.toString('base64')) + ';\n');

// نسخه برای نمایش در «دربارهٔ برنامه»
const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'VERSION.txt'), 'sql.js ' + pkg.version + ' | wasm ' + wasm.length + ' bytes\n');

console.log('vendor ready:', {
  'sql-wasm.js': js.length + ' B',
  'sql-wasm.data.js': (wasm.length / 1024).toFixed(0) + ' KiB (base64)',
});
