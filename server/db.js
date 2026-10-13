'use strict';
/**
 * لایهٔ دیتابیس: یک فایل واقعی SQLite کنار برنامه نگه داشته می‌شود.
 * موتور: sql.js (SQLite کامپایل‌شده به wasm) -> بدون هیچ نصب یا ماژول نیتیو.
 */

const fs = require('fs');
const path = require('path');
const { normalizeFa, compact, tokens, faCompare } = require('./text');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT    NOT NULL,
  name_norm     TEXT    NOT NULL,
  name_compact  TEXT    NOT NULL,
  extension     TEXT    NOT NULL,
  ext_norm      TEXT    NOT NULL,
  ext_compact   TEXT    NOT NULL,
  note          TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_contacts_ext   ON contacts(ext_compact);
CREATE INDEX        IF NOT EXISTS ix_contacts_name  ON contacts(name_norm);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

class DbError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'bad_request';
  }
}

class PhoneBook {
  constructor(SQL, db, file) {
    this.SQL = SQL;
    this.db = db;
    this.file = file;
    this._saveTimer = null;
    this._saving = Promise.resolve();
    this.version = 0;
    this.ready = false;
  }

  /** ساخت/باز کردن دیتابیس */
  static async open(file, opts = {}) {
    // ماژول‌ها با مسیر ثابت require می‌شوند تا pkg بتواند آن‌ها را درون exe بگذارد
    const initSqlJs = require('./vendor/sql-wasm.js');
    const wasmB64 = require('./vendor/sql-wasm.data.js');
    const SQL = await initSqlJs({ wasmBinary: Buffer.from(wasmB64, 'base64') });

    fs.mkdirSync(path.dirname(file), { recursive: true });
    let db;
    let initialSize = 0;
    if (fs.existsSync(file)) {
      const bytes = fs.readFileSync(file);
      initialSize = bytes.length;
      try {
        db = new SQL.Database(new Uint8Array(bytes));
      } catch (err) {
        const backup = file + '.broken-' + Date.now();
        fs.renameSync(file, backup);
        console.error('[db] فایل دیتابیس آسیب‌دیده بود، به', backup, 'منتقل شد و فایل تازه ساخته می‌شود.');
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }
    db.run('PRAGMA foreign_keys = ON;');
    db.run(SCHEMA);
    const pb = new PhoneBook(SQL, db, file);
    pb.lastSaved = initialSize;
    pb.acquireLock(Boolean(opts.force));
    pb.bumpMeta(); // فقط ثبت نسخهٔ اسکیما
    pb.version = Number(pb.getMeta('version') || 0);
    pb.ready = true;
    return pb;
  }

  /**
   * قفل: اگر یک نمونهٔ دیگر از برنامه همین فایل را باز داشته باشد،
   * با خطا می‌ایستد تا دو نسخه همدیگر را روی دیسک پاک نکنند.
   */
  acquireLock(force = false) {
    const lock = this.file + '.lock';
    this._lock = lock;
    const read = () => {
      try { return JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { return null; }
    };
    const alive = (info) => {
      if (!info || !info.pid) return false;
      try { process.kill(info.pid, 0); return true; } catch { return false; }
    };
    const cur = read();
    if (cur && cur.pid !== process.pid && alive(cur) && !force) {
      const err = new DbError(
        'این دیتابیس همین حالا توسط برنامهٔ دیگری (پروسهٔ ' + cur.pid + '، پورت ' + (cur.port || '?') + ') باز است.\n' +
        '  اگر نمونهٔ دیگری باز است، همان را استفاده کنید یا از --port متفاوت با همان نمونه کار بکشید.\n' +
        '  برای اجرای اجباری: --force',
        'locked'
      );
      throw err;
    }
    this._lockInfo = { pid: process.pid, port: 0, at: new Date().toISOString(), token: process.pid + ':' + Date.now() };
    try { fs.writeFileSync(lock, JSON.stringify(this._lockInfo)); } catch { /* فقط اطلاع‌رسانی است */ }
    const release = () => {
      try {
        const c = read();
        if (c && c.token === this._lockInfo.token) fs.unlinkSync(lock);
      } catch {}
    };
    process.once('exit', release);
    return this;
  }

  setLockPort(port) {
    if (this._lockInfo) {
      this._lockInfo.port = port;
      try { fs.writeFileSync(this._lock, JSON.stringify(this._lockInfo)); } catch {}
    }
  }

  // ---------------------------------------------------------------- utilities
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    const rows = this.all(sql, params);
    return rows[0] || null;
  }

  getMeta(key) {
    const row = this.get('SELECT value FROM meta WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  bumpMeta() {
    const v = Number(this.getMeta('version') || 0) + 1;
    this.db.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ['version', String(v)]);
    this.version = v;
    return v;
  }

  /** نوشتن فایل روی دیسک (اثری/تمیز) */
  /**
   * نوشتن فایل روی دیسک.
   * - همیشه بعد از هر تغییر صدا زده می‌شود (با ۱۲۰ms تأخیر برای ادغام تغییرهای پشت‌سرهم)
   * - نوشتن‌ها پشت‌سرهم صف می‌شوند تا هرگز دو نوشتن هم‌زمان انجام نشود
   * - اگر برنامه ناگهانی بسته شود، `beforeExit` و تایمر ۵ ثانیه‌ای از دست رفتن داده را جلوگیری می‌کنند
   */
  persist() {
    this.dirty = true;
    if (this._saveTimer) return this._saving;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saving = this._writeNow();
    }, 120);
    return this._saving;
  }

  _writeNow() {
    if (!this.dirty && !this._force) return this._saving;
    return this._saving.then(
      () =>
        new Promise((resolve) => {
          try {
            const bytes = Buffer.from(this.db.export());
            const tmp = this.file + '.tmp';
            fs.writeFileSync(tmp, bytes);
            try {
              fs.renameSync(tmp, this.file);
            } catch (err) {
              fs.copyFileSync(tmp, this.file);
              try { fs.unlinkSync(tmp); } catch {}
            }
            try { // مطمئن شو فایل واقعاً روی دیسک نشسته
              const fd = fs.openSync(this.file, 'r');
              fs.fsyncSync(fd);
              fs.closeSync(fd);
            } catch {}
            this.lastSaved = bytes.length;
            this.dirty = false;
            this._force = false;
          } catch (err) {
            console.error('[db] ذخیرهٔ فایل دیتابیس ناموفق بود:', err.message);
          }
          resolve();
        })
    );
  }

  /** نوشتن فوری (برای لحظهٔ بستن برنامه یا بازیابی بکاپ) */
  async flush() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._force = true;
    this.dirty = true;
    this._saving = this._writeNow();
    await this._saving;
  }

  /** ذخیرهٔ پشتیبان: هر ۵ ثانیه اگر چیز عوض‌شده‌ای روی دیسک نرفته باشد */
  startAutoSave(ms = 5000) {
    this._auto = setInterval(() => { if (this.dirty) this.persist(); }, ms);
    if (this._auto.unref) this._auto.unref();
    const bye = () => { this._force = true; this.dirty = true; this._saving = this._writeNow(); };
    process.once('beforeExit', bye);
    return this;
  }

  stopAutoSave() {
    if (this._auto) clearInterval(this._auto);
    this._auto = null;
  }

  // ---------------------------------------------------------------------- CRUD
  static clean(input) {
    const fullName = String((input && input.fullName) || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    const extension = String((input && input.extension) || '').replace(/\s+/g, '').trim();
    const note = String((input && input.note) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    return { fullName, extension, note };
  }

  static validate({ fullName, extension }, { id } = {}) {
    if (!fullName) throw new DbError('نام و نام خانوادگی را وارد کنید.', 'missing_name');
    if (fullName.length > 120) throw new DbError('نام و نام خانوادگی خیلی بلند است (حداکثر ۱۲۰ حرف).', 'name_too_long');
    if (!extension) throw new DbError('شمارهٔ تلفن داخلی را وارد کنید.', 'missing_ext');
    if (!/^[0-9۰-۹٠-٩][0-9۰-۹٠-٩\-\/x*.#+ ]{0,19}$/.test(extension))
      throw new DbError('شمارهٔ داخلی فقط می‌تواند رقم و علامت ‎- / + ‎ باشد.', 'bad_ext');
    if (extension.length > 24) throw new DbError('شمارهٔ داخلی خیلی بلند است.', 'ext_too_long');
    return { fullName, extension, note: '', id };
  }

  stats() {
    const row = this.get('SELECT COUNT(*) AS c FROM contacts');
    return { count: row ? Number(row.c) : 0, file: this.file, bytes: this.lastSaved || 0, version: this.version };
  }

  search(query, limit = 12) {
    const toks = tokens(query);
    const FIELDS = 'SELECT id, full_name, extension, note FROM contacts';
    const CAP = 5000; // سقف نامزدها؛ بعد از آن رتبه‌بندی دقیق در JS انجام می‌شود
    let rows;
    if (!toks.length) {
      rows = this.all(FIELDS + ' ORDER BY name_norm ASC LIMIT ?', [CAP]);
    } else {
      const longest = toks.reduce((a, b) => (a.length >= b.length ? a : b), '');
      const q = (str) => '%' + str.replace(/[%_]/g, (c) => '\\' + c) + '%';
      // هم شکل نرمال‌شده و هم شکل فشرده (بدون خط تیره/فاصله) مقایسه می‌شود تا «3300» با «33-00» جور شود
      const likeNorm = q(longest);
      const likeFlat = q(compact(longest));
      rows = this.all(
        FIELDS + " WHERE name_norm LIKE ? ESCAPE '\\' OR ext_norm LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\'" +
          " OR name_compact LIKE ? ESCAPE '\\' OR ext_compact LIKE ? ESCAPE '\\' ORDER BY name_norm ASC LIMIT ?",
        [likeNorm, likeNorm, likeNorm, likeFlat, likeFlat, CAP]
      );
    }
    const scored = [];
    for (const r of rows) {
      const s = this._score(r, toks, query);
      if (s > 0) scored.push({ ...r, score: s });
    }
    scored.sort((a, b) => b.score - a.score || faCompare(a.full_name, b.full_name));
    return scored.slice(0, limit);
  }

  _score(row, toks, rawQuery) {
    const name = normalizeFa(row.full_name);
    const nameC = compact(row.full_name);
    const ext = normalizeFa(row.extension);
    const extC = compact(row.extension);
    const note = normalizeFa(row.note || '');
    const qC = compact(toks.join(' '));
    let score = 0;

    if (qC && extC) {
      if (extC === qC) score += 400;
      else if (extC.startsWith(qC)) score += 260;
      else if (extC.includes(qC)) score += 120;
    }
    for (const t of toks) {
      const hit =
        name.includes(t) || nameC.includes(compact(t)) || ext.includes(t) || extC.includes(compact(t)) || note.includes(t);
      if (!hit) return 0; // همهٔ کلمات باید پیدا شوند
    }
    if (name.startsWith(toks[0])) score += 120;
    else if (name.includes(toks[0])) score += 60;
    else score += 20;
    if (nameC.startsWith(qC)) score += 80;
    if (note.includes(toks[0])) score += 5;
    return score;
  }

  list({ q = '', sort = 'name', limit = 500, offset = 0 } = {}) {
    const rows = this.search(q, Number.MAX_SAFE_INTEGER);
    const total = q && q.trim() ? rows.length : Number(this.get('SELECT COUNT(*) AS c FROM contacts').c);
    if (sort === 'ext' || sort === 'extension') rows.sort((a, b) => faCompare(a.extension, b.extension));
    else if (sort === 'new') rows.sort((a, b) => b.id - a.id);
    else rows.sort((a, b) => faCompare(a.full_name, b.full_name) || a.id - b.id);
    return { total, items: rows.slice(offset, offset + limit) };
  }

  getOne(id) {
    return this.get('SELECT id, full_name, extension, note, created_at, updated_at FROM contacts WHERE id = ?', [Number(id)]);
  }

  create(input) {
    const { fullName, extension, note } = PhoneBook.clean(input);
    PhoneBook.validate({ fullName, extension });
    const extC = compact(extension);
    const clash = this.get('SELECT full_name FROM contacts WHERE ext_compact = ?', [extC]);
    if (clash) throw new DbError('این شمارهٔ داخلی قبلاً برای «' + clash.full_name + '» ثبت شده است.', 'dup_ext');
    const t = nowIso();
    this.db.run(
      'INSERT INTO contacts(full_name,name_norm,name_compact,extension,ext_norm,ext_compact,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [fullName, normalizeFa(fullName), compact(fullName), extension, normalizeFa(extension), extC, note, t, t]
    );
    const id = Number(this.get('SELECT last_insert_rowid() AS id').id);
    this.bumpMeta();
    this.persist();
    return this.getOne(id);
  }

  update(id, input) {
    const found = this.getOne(id);
    if (!found) throw new DbError('رکورد پیدا نشد.', 'not_found');
    const clean = PhoneBook.clean({
      fullName: input.fullName !== undefined ? input.fullName : found.full_name,
      extension: input.extension !== undefined ? input.extension : found.extension,
      note: input.note !== undefined ? input.note : found.note,
    });
    PhoneBook.validate(clean);
    const extC = compact(clean.extension);
    const clash = this.get('SELECT id, full_name FROM contacts WHERE ext_compact = ? AND id <> ?', [extC, Number(id)]);
    if (clash) throw new DbError('این شمارهٔ داخلی برای «' + clash.full_name + '» قبلاً ثبت شده است.', 'dup_ext');
    this.db.run(
      'UPDATE contacts SET full_name=?, name_norm=?, name_compact=?, extension=?, ext_norm=?, ext_compact=?, note=?, updated_at=? WHERE id=?',
      [clean.fullName, normalizeFa(clean.fullName), compact(clean.fullName), clean.extension, normalizeFa(clean.extension), extC, clean.note, nowIso(), Number(id)]
    );
    this.bumpMeta();
    this.persist();
    return this.getOne(id);
  }

  remove(id) {
    const found = this.getOne(id);
    if (!found) throw new DbError('رکورد پیدا نشد.', 'not_found');
    this.db.run('DELETE FROM contacts WHERE id = ?', [Number(id)]);
    this.bumpMeta();
    this.persist();
    return found;
  }

  /** ورود دسته‌جمعی: ردیف‌های معتبر ثبت، بقیه گزارش می‌شوند */
  importRows(lines) {
    const result = { added: 0, skipped: [], total: 0 };
    for (const line of lines.slice(0, 20000)) {
      result.total++;
      const cols = String(line).split(/[\t,;|]+/).map((c) => c.trim().replace(/^"|"$/g, ''));
      if (!cols[0] && !cols[1]) continue;
      // اگر ستون دوم نبود، فرض می‌کنیم شماره در ستون آخر است
      let fullName = cols[0];
      let extension = cols[1] || cols[2] || '';
      if (!extension && /\d/.test(fullName)) {
        const m = fullName.match(/^(.*?)[\s:,-]+(\d[\d\-/]*)$/);
        if (m) { fullName = m[1].trim(); extension = m[2].trim(); }
      }
      try {
        this.create({ fullName, extension });
        result.added++;
      } catch (err) {
        result.skipped.push({ line: String(line).slice(0, 120), reason: err.message });
      }
    }
    this.persist();
    return result;
  }

  /** بکاپ / بازگردانی فایل خام SQLite */
  rawBytes() {
    return Buffer.from(this.db.export());
  }

  csv() {
    const rows = this.all('SELECT full_name, extension, note, updated_at FROM contacts ORDER BY name_norm');
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['\uFEFF' + esc('نام و نام خانوادگی'), esc('شماره داخلی'), esc('توضیحات'), esc('آخرین تغییر')].join(',');
    const body = rows.map((r) => [esc(r.full_name), '\u200E"' + String(r.extension).replace(/"/g, '""') + '"', esc(r.note), esc(r.updated_at)].join(','));
    return [head, ...body].join('\r\n') + '\r\n';
  }

  /** همهٔ نام‌ها برای ساخت ایندکس سمت کلاینت (اختیاری) */
  allNames(limit = 5000) {
    return this.all('SELECT id, full_name, extension FROM contacts ORDER BY name_norm LIMIT ?', [limit]);
  }
}

/** بازگردانی از فایل آپلودی: دیتابیس تازه باز و جایگزین می‌شود */
PhoneBook.prototype.replaceFromBytes = async function (bytes) {
  const fresh = new this.SQL.Database(new Uint8Array(bytes));
  fresh.run(SCHEMA); // اگر فایل قدیمی باشد، جداول اضافه می‌شوند
  this.db.close();
  this.db = fresh;
  this.bumpMeta();
  await this.flush();
  return this.stats();
};

module.exports = { PhoneBook, DbError };
