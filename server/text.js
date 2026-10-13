'use strict';
/**
 * ابزارهای نرمال‌سازی متن فارسی/عربی برای جست‌وجوی دقیق.
 * هیچ وابستگی بیرونی ندارد.
 */

const LATIN_MAP = {
  '\u064A': '\u06CC', // ي -> ی
  '\u0643': '\u06A9', // ك -> ک
  '\u0623': '\u0627', // أ -> ا
  '\u0625': '\u0627', // إ -> ا
  '\u0622': '\u0627', // آ -> ا
  '\u0624': '\u0648', // ؤ -> و
  '\u0626': '\u06CC', // ئ -> ی
  '\u0629': '\u0647', // ة -> ه
  '\u0649': '\u06CC', // ى -> ی
  '\u06BE': '\u0647', // هٔ variants
};

// نیم‌فاصله و نشانگرهای جهت و تطویل و اعراب: حذف کامل (تا «زه‌را» با «زهرا» یکی شود)
const JOINERS = /[\u200B\u200C\u200D\u200E\u200F\u2060\u0640\u064B-\u065F\u0670\u08D3-\u08FF]/g;
const FA_DIGITS = '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9';
const AR_DIGITS = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';

/** تبدیل ارقام فارسی/عربی به لاتین */
function toLatinDigits(input) {
  let out = '';
  for (const ch of String(input == null ? '' : input)) {
    const p = FA_DIGITS.indexOf(ch);
    if (p >= 0) { out += String(p); continue; }
    const a = AR_DIGITS.indexOf(ch);
    if (a >= 0) { out += String(a); continue; }
    out += ch;
  }
  return out;
}

/** تبدیل ارقام لاتین به فارسی (برای نمایش) */
function toPersianDigits(input) {
  return String(input == null ? '' : input).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
}

/** نرمال‌سازی کامل: یک‌دست کردن حروف، حذف نیم‌فاصله/اعراب، حروف کوچک، ارقام لاتین */
function normalizeFa(input) {
  let s = String(input == null ? '' : input);
  s = s.normalize('NFKC');
  s = toLatinDigits(s);
  s = s.replace(JOINERS, '');
  s = s.replace(/[يئ\u064A]/g, LATIN_MAP['\u064A']);
  s = s.replace(/\u0643/g, LATIN_MAP['\u0643']);
  s = s.replace(/[\u0623\u0625\u0622]/g, '\u0627');
  s = s.replace(/\u0624/g, '\u0648');
  s = s.replace(/[\u0629\u0649]/g, (m) => LATIN_MAP[m] || m);
  s = s.toLowerCase();
  s = s.replace(/[\u2010-\u2015\u2212]/g, '-'); // خط تیره‌های مختلف
  s = s.replace(/[\u00A0\u1680\u202F\u205F\u3000]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** فقط حروف و رقم، بقیه حذف — برای مقایسهٔ فازی شماره‌ها */
function compact(s) {
  return normalizeFa(s).replace(/[^0-9a-z\u0621-\u06FF]/g, '');
}

/** تفکیک عبارت جست‌وجو به توکن‌ها */
function tokens(input) {
  const n = normalizeFa(input);
  return n ? n.split(' ').filter(Boolean) : [];
}

/** برچسب‌گذاری بخش منطبق برای نمایش در پیشنهادها (HTML امن) */
function highlight(text, query) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const src = String(text == null ? '' : text);
  const toks = tokens(query);
  if (!toks.length) return esc(src);
  const hay = normalizeFa(src);
  const marks = new Array(src.length).fill(false);
  for (const t of toks) {
    let from = 0;
    for (;;) {
      const i = hay.indexOf(t, from);
      if (i < 0) break;
      for (let j = i; j < i + t.length && j < src.length; j++) marks[j] = true;
      from = i + t.length;
    }
  }
  let out = '';
  let open = false;
  for (let i = 0; i < src.length; i++) {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += esc(src[i]);
  }
  if (open) out += '</mark>';
  return out;
}


/** ترتیب حروف الفبای فارسی (مستقل از ICU مرورگر/سیستم) */
const FA_ALPHABET = 'آاابتجچحخدذرزژسشصضطظعغفقکگلمنوهیئ'.split('');
const RANK = new Map([['-', 0], ['‌', 0], [' ', 1]]);
let r = 2;
for (const ch of FA_ALPHABET) if (!RANK.has(ch)) RANK.set(ch, r++);
for (let i = 0; i < 10; i++) RANK.set(String(i), 0.5); // رقم‌ها اول (برای شمارهٔ داخلی)
for (let c = 97; c <= 122; c++) RANK.set(String.fromCharCode(c), 100 + (c - 97)); // حروف لاتین آخر

/** آرایهٔ امتیاز برای یک رشتهٔ نرمال‌شده */
function rankKey(norm) {
  const out = [];
  for (const ch of norm) out.push(RANK.has(ch) ? RANK.get(ch) : (ch.charCodeAt(0) < 256 ? 900 + ch.charCodeAt(0) : 950 + ch.codePointAt(0)));
  return out;
}

/** مقایسهٔ دو رشته با ترتیب فارسی؛ ارقام داخل رشته به‌صورت عددی مقایسه می‌شوند */
function faCompare(a, b) {
  const ka = rankKey(normalizeFa(a));
  const kb = rankKey(normalizeFa(b));
  const n = Math.max(ka.length, kb.length);
  for (let i = 0; i < n; i++) {
    const x = ka[i] === undefined ? -1 : ka[i];
    const y = kb[i] === undefined ? -1 : kb[i];
    if (x !== y) return x < y ? -1 : 1;
  }
  return String(a).localeCompare(String(b));
}

module.exports = { normalizeFa, toLatinDigits, toPersianDigits, compact, tokens, highlight, faCompare };
