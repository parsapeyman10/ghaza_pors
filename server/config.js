'use strict';
/**
 * پیکربندی برنامه.
 * اولویت: خط فرمان > متغیر محیطی > config.json > مقادیر پیش‌فرض.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_NAME = 'GhazaPors Directory';
const APP_VERSION = '1.0.0';

/** پوشه‌ای که برنامه در آن نصب شده (برای exe، پوشهٔ خود فایل exe) */
function appRoot() {
  if (process.pkg) return path.dirname(process.execPath);
  return path.resolve(__dirname, '..');
}

const isPackaged = Boolean(process.pkg);

const DEFAULTS = {
  app: {
    title: 'دفترچهٔ شماره‌های داخلی',
    subtitle: 'ثبت نام و شمارهٔ داخلی + جست‌وجو با پیشنهاد خودکار',
  },
  server: {
    host: '0.0.0.0', // برای دسترسی بقیهٔ سیستم‌های شبکه
    port: 8787,
    openBrowser: true,
  },
  database: {
    // مسیر نسبی = داخل پوشهٔ برنامه (پرتابل). مسیر مطلق هم قبول می‌کند.
    file: isPackaged ? 'data/dahili.sqlite' : path.join(appRoot(), 'data', 'dahili.sqlite'),
  },
  security: {
    // اگر خالی باشد، هر کسی در شبکه می‌تواند ویرایش کند.
    // مثلاً "1234" -> برای ثبت/ویرایش/حذف باید این رمز وارد شود.
    editPin: '',
  },
  ui: {
    listLimit: 500,
    suggestLimit: 12,
    showLanAddress: true,
  },
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) continue;
    const key = a.replace(/^--?/, '');
    if (key === 'no-browser') { args.browser = false; continue; }
    if (key === 'browser') { args.browser = true; continue; }
    if (key === 'help' || key === 'h') { args.help = true; continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
  }
  return args;
}

function load() {
  const root = appRoot();
  const args = parseArgs(process.argv.slice(2));
  let file = null;
  const candidates = [args.config, process.env.GHADA_CONFIG, path.join(root, 'config.json'), path.join(process.cwd(), 'config.json')]
    .filter(Boolean)
    .map((p) => (path.isAbsolute(p) ? p : path.resolve(root, p)));

  for (const c of candidates) {
    if (fs.existsSync(c)) { file = c; break; }
  }

  let cfg = DEFAULTS;
  if (file) {
    try {
      cfg = deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
    } catch (err) {
      console.error('[config] فایل config.json خوانده نشد:', err.message);
    }
  }

  if (args.port) cfg.server.port = Number(args.port);
  if (args.host) cfg.server.host = String(args.host);
  const dbArg = args.data || args.db || args.file;
  if (dbArg) cfg.database.file = String(dbArg);
  if (args.browser !== undefined) cfg.server.openBrowser = args.browser;
  if (process.env.GHADA_PORT) cfg.server.port = Number(process.env.GHADA_PORT);
  if (process.env.GHADA_HOST) cfg.server.host = String(process.env.GHADA_HOST);
  if (process.env.GHADA_DB) cfg.database.file = String(process.env.GHADA_DB);
  if (process.env.GHADA_PIN !== undefined) cfg.security.editPin = String(process.env.GHADA_PIN);
  if (process.env.GHADA_NO_BROWSER) cfg.server.openBrowser = false;

  if (!path.isAbsolute(cfg.database.file)) cfg.database.file = path.resolve(root, cfg.database.file);
  cfg.database.dir = path.dirname(cfg.database.file);
  cfg.__file = file;
  cfg.__root = root;
  cfg.__packaged = isPackaged;
  cfg.__args = args;
  cfg.app.name = APP_NAME;
  cfg.app.version = APP_VERSION;
  return cfg;
}

/** آدرس‌های IP لوکال که همکاران می‌توانند با آن‌ها وصل شوند */
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

function helpText() {
  return [
    `${APP_NAME} v${APP_VERSION}`,
    '',
    'گزینه‌ها:',
    '  --port <عدد>     پورت سرور (پیش‌فرض 8787)',
    '  --host <آدرس>    آدرس اتصال (پیش‌فرض 0.0.0.0 = همهٔ کارت‌های شبکه)',
    '  --data <مسیر>    مسیر فایل دیتابیس SQLite (معادل: --db)',
    '  --config <مسیر>  فایل پیکربندی JSON',
    '  --no-browser     مرورگر خودکار باز نشود',
    '  --force          حتی اگر قفل دیتابیس دست برنامهٔ دیگری بود، اجرا کن (ریسک: تداخل نوشتن)',
    '',
    'متغیرهای محیطی: GHADA_PORT, GHADA_HOST, GHADA_DB, GHADA_PIN, GHADA_CONFIG, GHADA_NO_BROWSER',
  ].join('\n');
}

module.exports = { load, lanAddresses, helpText, appRoot, APP_NAME, APP_VERSION };
