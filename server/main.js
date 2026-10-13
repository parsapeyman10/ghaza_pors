'use strict';
/**
 * سرویس‌دهندهٔ HTTP + مسیرهای API.
 * فقط ماژول‌های داخلی Node استفاده می‌شود (هیچ وابستگی بیرونی = exe ساده‌تر و مطمئن‌تر).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PhoneBook, DbError } = require('./db');
const { highlight } = require('./text');
const config = require('./config');

/**
 * پیدا کردن پوشهٔ فایل‌های ظاهری.
 * در حالت exe فایل‌ها داخل خود exe (snapshot) هستند؛ اگر دسترسی به snapshot
 * مشکلی داشت، از پوشهٔ public کنار فایل exe استفاده می‌شود (در پک پرتابل هست).
 */
function findPublic() {
  const cands = [];
  if (process.pkg) cands.push(path.join(path.dirname(process.execPath), 'public'));
  cands.push(path.join(__dirname, '..', 'public'), path.resolve('public'));
  for (const c of cands) {
    try {
      if (fs.existsSync(path.join(c, 'index.html'))) return path.resolve(c);
    } catch { /* continue */ }
  }
  return path.resolve(cands[cands.length - 1]);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.sqlite': 'application/x-sqlite3',
};

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, {
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(buf);
}

const sendJson = (res, code, obj) => send(res, code, obj, { 'Content-Type': 'application/json; charset=utf-8' });

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new DbError('حجم درخواست بیشتر از حد مجاز است.', 'too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, 512 * 1024);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new DbError('بدنهٔ درخواست JSON معتبر نیست.', 'bad_json');
  }
}

function openBrowser(url) {
  try {
    const cmd =
      process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '""', url.replace(/&/g, '^&')] }
        : process.platform === 'darwin'
        ? { file: 'open', args: [url] }
        : { file: 'xdg-open', args: [url] };
    const p = spawn(cmd.file, cmd.args, { stdio: 'ignore', detached: true, windowsHide: true });
    p.unref();
  } catch {
    /* بی‌سر‌و‌صدا رد می‌شویم */
  }
}

async function main() {
  const cfg = config.load();
  if (cfg.__args.help) {
    console.log(config.helpText());
    return 0;
  }

  const pb = await PhoneBook.open(cfg.database.file, { force: Boolean(cfg.__args.force) });
  pb.startAutoSave();

  // ---------- پوشهٔ فایل‌های ظاهری ----------
  const pub = findPublic();

  const pinEnabled = () => Boolean(cfg.security.editPin);
  const pinOk = (req) => !pinEnabled() || String(req.headers['x-edit-pin'] || '') === String(cfg.security.editPin);

  const routes = {
    'GET /api/health': (req, res) =>
      sendJson(res, 200, {
        ok: true,
        app: cfg.app.name,
        title: cfg.app.title,
        version: cfg.app.version,
        time: new Date().toISOString(),
        db: pb.stats(),
        pin: pinEnabled(),
        lan: config.lanAddresses().map((a) => `http://${a.address}:${cfg.server.port}`),
      }),

    'GET /api/config': (req, res) =>
      sendJson(res, 200, {
        title: cfg.app.title,
        subtitle: cfg.app.subtitle,
        suggestLimit: cfg.ui.suggestLimit,
        listLimit: cfg.ui.listLimit,
        pin: pinEnabled(),
        version: pb.version,
      }),

    'GET /api/version': (req, res) => sendJson(res, 200, { version: pb.version, count: pb.stats().count }),

    /** جست‌وجو با پیشنهاد — مهم‌ترین مسیر برنامه */
    'GET /api/search': (req, res, url) => {
      const q = url.searchParams.get('q') || '';
      const limit = Math.min(50, Number(url.searchParams.get('limit') || cfg.ui.suggestLimit));
      const items = pb.search(q, limit).map((r) => ({
        id: r.id,
        name: r.full_name,
        extension: r.extension,
        note: r.note || '',
        nameHtml: highlight(r.full_name, q),
        extHtml: highlight(r.extension, q),
      }));
      sendJson(res, 200, { query: q, count: items.length, items });
    },

    'GET /api/contacts': (req, res, url) => {
      const { total, items } = pb.list({
        q: url.searchParams.get('q') || '',
        sort: url.searchParams.get('sort') || 'name',
        limit: Math.min(2000, Number(url.searchParams.get('limit') || cfg.ui.listLimit)),
        offset: Math.max(0, Number(url.searchParams.get('offset') || 0)),
      });
      sendJson(res, 200, {
        total,
        items: items.map((r) => ({
          id: r.id,
          name: r.full_name,
          extension: r.extension,
          note: r.note || '',
          nameHtml: highlight(r.full_name, url.searchParams.get('q') || ''),
          extHtml: highlight(r.extension, url.searchParams.get('q') || ''),
        })),
      });
    },

    'POST /api/contacts': async (req, res) => {
      if (!pinOk(req)) return sendJson(res, 403, { error: 'رمز ویرایش لازم است.', code: 'need_pin' });
      const body = await readJson(req);
      const row = pb.create(body);
      sendJson(res, 201, { ok: true, item: { id: row.id, name: row.full_name, extension: row.extension, note: row.note } });
    },

    'PUT /api/contacts': async (req, res, url) => {
      if (!pinOk(req)) return sendJson(res, 403, { error: 'رمز ویرایش لازم است.', code: 'need_pin' });
      const id = Number(url.searchParams.get('id'));
      const row = pb.update(id, await readJson(req));
      sendJson(res, 200, { ok: true, item: { id: row.id, name: row.full_name, extension: row.extension, note: row.note } });
    },

    'DELETE /api/contacts': async (req, res, url) => {
      if (!pinOk(req)) return sendJson(res, 403, { error: 'رمز ویرایش لازم است.', code: 'need_pin' });
      const removed = pb.remove(Number(url.searchParams.get('id')));
      sendJson(res, 200, { ok: true, removed: { id: removed.id, name: removed.full_name, extension: removed.extension } });
    },

    'POST /api/import': async (req, res) => {
      if (!pinOk(req)) return sendJson(res, 403, { error: 'رمز ویرایش لازم است.', code: 'need_pin' });
      const text = (await readBody(req, 4 * 1024 * 1024)).toString('utf8').replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const first = (lines[0] || '').toLowerCase();
      if (!/\d/.test(first) && /(نام|name|داخلی|ext|شماره)/.test(first)) lines.shift(); // سرصفحهٔ اکسل
      sendJson(res, 200, { ok: true, ...pb.importRows(lines) });
    },

    'GET /api/export.csv': (req, res) =>
      send(res, 200, pb.csv(), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': "attachment; filename=\"dahili.csv\"; filename*=UTF-8''%D8%AF%D8%A7%D8%AE%D9%84%DB%8C.csv",
      }),

    'GET /api/backup.sqlite': (req, res) =>
      send(res, 200, pb.rawBytes(), {
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': 'attachment; filename="dahili.sqlite"',
      }),

    'POST /api/restore': async (req, res) => {
      if (!pinOk(req)) return sendJson(res, 403, { error: 'رمز ویرایش لازم است.', code: 'need_pin' });
      const bytes = await readBody(req, 32 * 1024 * 1024);
      if (!bytes.slice(0, 15).toString('latin1').startsWith('SQLite format 3'))
        throw new DbError('فایل انتخابی یک دیتابیس SQLite معتبر نیست.', 'bad_file');
      const stats = await pb.replaceFromBytes(bytes);
      sendJson(res, 200, { ok: true, ...stats });
    },
  };

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(res, 400, 'bad request');
    }
    const key = `${req.method} ${url.pathname}`;
    try {
      if (routes[key]) return await routes[key](req, res, url);
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'این مسیر وجود ندارد.', code: 'not_found' });

      // ---------- فایل‌های ظاهری ----------
      let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const target = path.resolve(path.join(pub, rel));
      if (!target.startsWith(pub + path.sep)) return send(res, 403, 'forbidden');
      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        return send(res, 200, fs.readFileSync(target), {
          'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        });
      }
      return send(res, 200, fs.readFileSync(path.join(pub, 'index.html'), 'utf8'), { 'Content-Type': MIME['.html'] });
    } catch (err) {
      const code = err instanceof DbError ? err.code : 'server_error';
      const httpCode = code === 'need_pin' ? 403 : err instanceof DbError ? 422 : 500;
      if (!(err instanceof DbError)) console.error('[api]', err);
      return sendJson(res, httpCode, { error: err.message || 'خطای ناخواسته', code });
    }
  });

  // ---------- شنود + بنر ----------
  const listenHost = cfg.server.host === '0.0.0.0' ? '0.0.0.0' : cfg.server.host;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.server.port, listenHost, resolve);
  });

  pb.setLockPort(cfg.server.port);
  const local = `http://127.0.0.1:${cfg.server.port}`;
  const lan = config.lanAddresses().map((a) => `http://${a.address}:${cfg.server.port}`);
  const line = '─'.repeat(56);
  console.log('\n' + line);
  console.log('  ' + cfg.app.title + '   v' + cfg.app.version);
  console.log(line);
  console.log('  آدرس محلی : ' + local);
  if (cfg.ui.showLanAddress) lan.forEach((u, i) => console.log('  شبکه (' + (i + 1) + ')   : ' + u));
  console.log('  دیتابیس   : ' + pb.file);
  console.log('  رکوردها   : ' + pb.stats().count + (pinEnabled() ? '   |  رمز ویرایش فعال است' : ''));
  console.log(line);
  console.log('  برای بستن: Ctrl+C  (دیتابیس خودکار ذخیره می‌شود)');
  console.log(line + '\n');

  if (cfg.server.openBrowser) openBrowser(local);

  const stop = async (sig) => {
    console.log('\n[server] در حال بستن و ذخیرهٔ دیتابیس… (' + sig + ')');
    try {
      pb.stopAutoSave();
      await pb.flush();
    } finally {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 800).unref();
    }
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('uncaughtException', (e) => {
    console.error('[fatal]', e);
    stop('uncaught');
  });

  return { server, pb, cfg, local, lan };
}

if (require.main === module) {
  main().catch((err) => {
    if (err instanceof DbError) {
      console.error('\n[خطا] ' + err.message);
      process.exitCode = 2;
    } else if (err && err.code === 'EADDRINUSE') {
      console.error('\n[خطا] پورت موردنظر مشغول است. یا برنامه از قبل باز است، یا با --port یک پورت دیگر بدهید.');
      process.exitCode = 2;
    } else {
      console.error('[fatal]', err);
      process.exitCode = 1;
    }
  });
}

module.exports = { main, send, sendJson };
