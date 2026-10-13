'use strict';
/**
 * دیتابیس نمونه برای تست سریع:  node scripts/seed.js  [--db مسیر] [--n 40]
 */
const path = require('path');
const { PhoneBook } = require('../server/db');

const NAMES = [
  ['زهرا محمدی', '2345', 'امور کارکنان'],
  ['علی رضایی', '1102', 'دبیرخانه'],
  ['مریم احمدی', '3300', 'مالی'],
  ['حسین کریمی', '2410', 'فناوری اطلاعات'],
  ['فاطمه نوری', '1207', 'حوزه مدیریت'],
  ['رضا موسوی', '3115', 'پشتیبانی'],
  ['سارا جعفری', '2288', 'دفتر فنی'],
  ['مهدی شریفی', '1450', 'بازرسی'],
  ['نگار رحیمی', '2311', 'امور بانوان'],
  ['امیر تقوی', '3040', 'تردد و نگهبانی'],
  ['الهام صادقی', '1188', 'بایگانی'],
  ['بهرام قاسمی', '2620', 'تدارکات'],
];

async function main() {
  const argv = process.argv.slice(2);
  const dbFile = argv.includes('--db') ? argv[argv.indexOf('--db') + 1] : path.resolve(__dirname, '..', 'data', 'dahili.sqlite');
  const rounds = argv.includes('--n') ? Number(argv[argv.indexOf('--n') + 1]) : 1;
  const pb = await PhoneBook.open(dbFile);
  let added = 0;
  for (let r = 0; r < rounds; r++) {
    for (const [name, ext, note] of NAMES) {
      try { pb.create({ fullName: r ? name + ' ' + ['(۲)', '(۳)', '(۴)'][r - 1] : name, extension: String(Number(ext) + r * 10000), note }); added++; }
      catch { /* تکراری */ }
    }
  }
  await pb.flush();
  console.log('seeded', added, 'rows ->', dbFile);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
