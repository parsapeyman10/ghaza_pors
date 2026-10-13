/* ==================== دفترچهٔ شماره‌های داخلی — سمت کلاینت ====================
   بدون فریم‌ورک و بدون هیچ منبع بیرونی؛ فقط با سرور محلی (خود exe) کار می‌کند. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const FA = new Intl.NumberFormat('fa-IR');
const fa = (n) => (typeof n === 'number' ? FA.format(n) : String(n));
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  cfg: { suggestLimit: 12, listLimit: 500 },
  items: [],
  total: 0,
  sugg: [],
  active: -1,
  selected: null,
  editingId: null,
  version: 0,
  pin: sessionStorage.getItem('editPin') || '',
  filter: '',
  sort: 'name',
  timer: null,
};

/* ------------------------------------------------------------------ API */
async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (body && !raw) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  if (state.pin) headers['X-Edit-Pin'] = state.pin;
  const res = await fetch(path, { method, headers, body });
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || 'خطا در ارتباط با سرور (' + res.status + ')');
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------ toast/dialog */
function toast(msg, kind = '', ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, ms);
}

/** گفت‌وگوی عمومی. body می‌تواند رشتهٔ HTML یا گره باشد. */
function dialog({ title, html, okText = 'تأیید', cancelText = 'انصراف', onOk, noOk = false }) {
  const ov = $('#dlg');
  $('#dlg-title').textContent = title;
  const body = $('#dlg-body');
  body.innerHTML = '';
  if (typeof html === 'string') body.innerHTML = html;
  else if (html) body.append(html);
  $('#dlg-ok').textContent = okText;
  $('#dlg-cancel').textContent = cancelText;
  $('#dlg-ok').hidden = noOk;
  ov.hidden = false;
  const close = () => { ov.hidden = true; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey);
  $('#dlg-ok').onclick = async () => {
    const keep = onOk ? await onOk(body) : false;
    if (!keep) close();
  };
  $('#dlg-cancel').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const focusable = body.querySelector('input,textarea,select');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return { close, body };
}

const confirmBox = (title, text, okText, onOk) =>
  dialog({ title, html: `<p>${esc(text)}</p>`, okText, onOk });

/* -------------------------------------------------------------- clipboard */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* می‌افتیم روی روش قدیمی */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.dir = 'ltr';
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

/* ----------------------------------------------------------------- search */
const qEl = $('#q');
function setQuery(value, run = true) {
  qEl.value = value;
  $('.searchbox').classList.toggle('has-text', !!value);
  if (run) suggest();
}

let deb = null;
function suggest() {
  clearTimeout(deb);
  const q = qEl.value.trim();
  if (!q) { closeSuggestions(); return; }
  deb = setTimeout(async () => {
    try {
      const data = await api('/api/search?q=' + encodeURIComponent(q) + '&limit=' + state.cfg.suggestLimit);
      state.sugg = data.items;
      state.active = data.items.length ? 0 : -1;
      renderSuggestions(data.items, q);
    } catch (err) {
      $('#search-hint').textContent = err.message;
    }
  }, 90);
}

function closeSuggestions() {
  const ul = $('#suggestions');
  ul.innerHTML = '';
  qEl.setAttribute('aria-expanded', 'false');
  state.sugg = [];
}

function renderSuggestions(items, q = qEl.value.trim()) {
  const ul = $('#suggestions');
  ul.innerHTML = '';
  qEl.setAttribute('aria-expanded', String(items.length > 0));
  if (!items.length && !q.trim()) { state.active = -1; return; }
  if (!items.length) {
    ul.insertAdjacentHTML('beforeend',
      `<li class="no-hit">موردی با «${esc(q)}» پیدا نشد — برای ثبت، از فرم کنار استفاده کنید.</li>`);
    state.active = -1;
    return;
  }
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.i = i;
    li.innerHTML =
      `<span class="idx">${fa(i + 1)}</span>
       <span><span class="nm">${it.nameHtml}</span>${it.note ? ` <span class="sub">— ${esc(it.note)}</span>` : ''}</span>
       <span class="ext">${it.extHtml}</span>`;
    li.onclick = () => pick(i);
    ul.append(li);
  });
  highlightActive();
}

function highlightActive() {
  $$('#suggestions li').forEach((li) => li.setAttribute('aria-selected', String(+li.dataset.i === state.active)));
  const cur = $(`#suggestions li[data-i="${state.active}"]`);
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function pick(i) {
  const it = state.sugg[i];
  if (!it) return;
  setQuery(it.name, false);
  closeSuggestions();
  showResult(it);
  focusRow(it.id);
}

/** ردیف مربوطه را در جدول هایلایت و نمایان می‌کند */
function focusRow(id) {
  const row = $(`#tbody tr[data-id="${id}"]`);
  if (!row) return;
  $$('#tbody tr').forEach((r) => r.classList.remove('sel'));
  row.classList.add('sel');
  try { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
}

function showResult(it) {
  state.selected = it;
  $('#result').hidden = false;
  $('#result-name').textContent = it.name;
  $('#result-ext').textContent = it.extension;
  $('#result-note').textContent = it.note || '';
  $('#result-note').hidden = !it.note;
  $$('#tbody tr').forEach((tr) => tr.classList.toggle('sel', +tr.dataset.id === it.id));
  if (!$('#list-filter').value.trim() && !state.filter.trim()) focusRow(it.id);
}

/* ------------------------------------------------------------------- list */
async function loadList() {
  const params = new URLSearchParams({ sort: state.sort, limit: String(state.cfg.listLimit) });
  if (state.filter.trim()) params.set('q', state.filter.trim());
  const data = await api('/api/contacts?' + params);
  state.items = data.items;
  state.total = data.total;
  renderList();
}

function renderList() {
  const tb = $('#tbody');
  tb.innerHTML = '';
  const frag = document.createDocumentFragment();
  state.items.forEach((it, i) => {
    const tr = document.createElement('tr');
    tr.dataset.id = it.id;
    if (state.selected && state.selected.id === it.id) tr.classList.add('sel');
    tr.innerHTML =
      `<td class="num">${fa(i + 1)}</td>
       <td class="nm">${it.nameHtml}</td>
       <td><span class="ext-badge">${it.extHtml}</span></td>
       <td class="note">${esc(it.note)}</td>
       <td class="ops">
         <button class="btn mini ghost" data-act="edit">ویرایش</button>
         <button class="btn mini danger-line" data-act="del">حذف</button>
       </td>`;
    tr.ondblclick = () => copyText(it.extension).then((ok) => toast(ok ? 'شماره کپی شد: ' + it.extension : it.extension, ok ? 'ok' : ''));
    tr.onclick = (e) => {
      const btn = e.target.closest('button');
      if (btn) {
        e.stopPropagation();
        return btn.dataset.act === 'edit' ? startEdit(it) : removeItem(it);
      }
      showResult(it);
    };
    frag.append(tr);
  });
  tb.append(frag);
  document.body.classList.toggle('is-empty', state.items.length === 0);
  $('#list-count').textContent = fa(state.total);
  $('#chip-count').textContent = fa(state.total) + ' رکورد';
}

/* ------------------------------------------------------------------- form */
function setFormError(field, msg) {
  const input = $('#f-' + field);
  const wrap = input.closest('.field');
  wrap.classList.toggle('bad', !!msg);
  $('.error', wrap).textContent = msg || '';
}
function clearFormErrors() { ['name', 'ext', 'note'].forEach((f) => setFormError(f, '')); }

function fillForm({ fullName = '', extension = '', note = '' }, id = null) {
  $('#f-name').value = fullName;
  $('#f-ext').value = extension;
  $('#f-note').value = note;
  state.editingId = id;
  $('#form-title').textContent = id ? 'ویرایش رکورد' : 'ثبت شمارهٔ جدید';
  $('#f-save').textContent = id ? 'ذخیرهٔ تغییرات' : 'ذخیره در دیتابیس';
  $('#f-cancel').hidden = !id;
  $('#form-mode').textContent = id ? 'در حال ویرایش #' + fa(id) : '';
  clearFormErrors();
}

function startEdit(it) {
  fillForm({ fullName: it.name, extension: it.extension, note: it.note }, it.id);
  $('#f-name').focus();
  document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function submitForm(e) {
  e.preventDefault();
  const body = {
    fullName: $('#f-name').value.trim(),
    extension: $('#f-ext').value.trim(),
    note: $('#f-note').value.trim(),
  };
  clearFormErrors();
  if (!body.fullName) { setFormError('name', 'نام و نام خانوادگی را وارد کنید.'); $('#f-name').focus(); return; }
  if (!body.extension) { setFormError('ext', 'شمارهٔ داخلی را وارد کنید.'); $('#f-ext').focus(); return; }

  const btn = $('#f-save');
  btn.disabled = true;
  try {
    const id = state.editingId;
    const data = id
      ? await api('/api/contacts?id=' + id, { method: 'PUT', body })
      : await api('/api/contacts', { method: 'POST', body });
    toast(id ? 'تغییرات ذخیره شد ✓' : `«${data.item.name}» ثبت شد ✓`, 'ok');
    fillForm({}, null);
    if (!id && state.filter.trim()) { state.filter = ''; $('#list-filter').value = ''; } // تا رکورد تازه حتماً دیده شود
    await loadList();
    if (!id) {
      setQuery(data.item.name, true);
      showResult({ ...data.item, nameHtml: esc(data.item.name), extHtml: esc(data.item.extension) });
    } else if (state.selected && state.selected.id === id) {
      showResult({ ...state.selected, ...data.item, nameHtml: esc(data.item.name), extHtml: esc(data.item.extension) });
    }
  } catch (err) {
    handleWriteError(err, (f) => setFormError(f, err.message));
  } finally {
    btn.disabled = false;
  }
}

/** خطاهای نوشتن: رمز لازم، تکراری، … */
function handleWriteError(err, markField) {
  if (err.code === 'need_pin') { askPin(() => toast('رمز وارد شد؛ دوباره دکمهٔ ذخیره را بزنید.', 'ok')); return; }
  if (markField && (err.code === 'missing_name' || err.code === 'name_too_long')) return markField('name');
  if (markField && (err.code === 'missing_ext' || err.code === 'bad_ext' || err.code === 'ext_too_long')) return markField('ext');
  toast(err.message, 'bad', 4200);
}

function removeItem(it) {
  confirmBox('حذف رکورد', `«${it.name}» با داخلی ${it.extension} حذف شود؟ این کار قابل بازگشت نیست.`, 'حذف کن', () => {
    api('/api/contacts?id=' + it.id, { method: 'DELETE' })
      .then(() => {
        if (state.selected && state.selected.id === it.id) { $('#result').hidden = true; state.selected = null; }
        toast('حذف شد ✓', 'ok');
        return loadList();
      })
      .catch((err) => handleWriteError(err));
    return false;
  });
}

/* -------------------------------------------------------------------- pin */
function askPin(after) {
  const inp = document.createElement('input');
  inp.type = 'password'; inp.placeholder = 'رمز ویرایش'; inp.dir = 'ltr';
  dialog({
    title: 'رمز ویرایش لازم است',
    html: `<p>برای ثبت، ویرایش یا حذف باید رمز را وارد کنید.</p>`,
    okText: 'ثبت رمز',
    onOk: () => {
      state.pin = inp.value.trim();
      sessionStorage.setItem('editPin', state.pin);
      $('#btn-pin').textContent = '🔓 رمز وارد شد';
      toast('رمز ذخیره شد ✓', 'ok');
      if (after) after();
      return false;
    },
  });
  $('#dlg-body').append(inp);
}

/* --------------------------------------------------------------- import */
function openImport() {
  const ta = document.createElement('textarea');
  ta.placeholder = 'زهرا محمدی, 2345\nعلی رضایی\t1102\nمریم احمدی | 3300';
  ta.dir = 'rtl';
  const fileInp = document.createElement('input');
  fileInp.type = 'file';
  fileInp.accept = '.csv,.txt';
  fileInp.onchange = async () => {
    const f = fileInp.files[0];
    if (f) ta.value = (await f.text()).slice(0, 400000);
  };
  const dlg = dialog({
    title: 'ورود دسته‌جمعی',
    html: '<p>هر خط یک نفر: <code>نام و نام خانوادگی, شمارهٔ داخلی</code> — جداکننده می‌تواند <code>,</code> یا <code>;</code> یا <code>Tab</code> باشد (می‌توانید ستون‌ها را مستقیم از اکسل Paste کنید).</p>',
    okText: 'وارد کن',
    onOk: async () => {
      const text = ta.value.trim();
      if (!text) { toast('چیزی برای ورود وارد نشده.', 'bad'); return true; }
      const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
      if (state.pin) headers['X-Edit-Pin'] = state.pin;
      const res = await fetch('/api/import', { method: 'POST', headers, body: text });
      const r = await res.json();
      if (!res.ok) {
        if (r.code === 'need_pin') { handleWriteError(Object.assign(new Error(r.error), r)); return true; }
        toast(r.error || 'ورود انجام نشد', 'bad', 4500);
        return true;
      }
      const skipped = r.skipped && r.skipped.length;
      const lines = (r.skipped || []).slice(0, 40)
        .map((x) => '\u26A0 ' + esc(x.line) + ' \u2014 ' + esc(x.reason))
        .join('<br>');
      const rep = skipped ? '<div class="report">' + lines + '</div>' : '';
      dlg.body.innerHTML = '<p><strong>' + fa(r.added) + '</strong> رکورد از ' + fa(r.total) + ' خط وارد شد.'
        + (skipped ? ' <span style="color:var(--danger)">' + fa(skipped) + ' خط رد شد (تکراری یا ناقص).</span>' : '</p>')
        + rep;
      $('#dlg-ok').hidden = true;
      $('#dlg-cancel').textContent = 'بستن';
      await loadList();
      return true; // گفت‌وگو باز بماند تا گزارش دیده شود
    },
  });
  dlg.body.append(ta, fileInp);
}

/* ------------------------------------------------------------- net dialog */
function openShare(health) {
  const list = (health.lan || []).map((u) => `<div class="row-list"><code>${esc(u)}</code></div>`).join('');
  dialog({
    title: 'دسترسی همکاران در شبکه',
    noOk: true,
    html: `<p>این برنامه را روی سیستم میزبان باز نگه دارید؛ بقیهٔ همکاران کافی است آدرس زیر را در مرورگر بزنند:</p>
      ${list || '<p>آی‌پی شبکه‌ای یافت نشد (کابل/Wi‑Fi را بررسی کنید).</p>'}
      <p>اگر باز نشد: در ویندوز Rule فایروال برای پورت ${fa(health.port || 8787)} لازم است (فایل <code>firewall-allow.bat</code> کنار برنامه).</p>`,
  });
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  state.cfg = await api('/api/config');
  state.version = state.cfg.version || 0;
  document.title = state.cfg.title || document.title;
  $('#app-title').textContent = state.cfg.title || document.title;
  $('#app-subtitle').textContent = state.cfg.subtitle || '';
  if (state.cfg.pin) {
    $('#btn-pin').hidden = false;
    $('#btn-pin').textContent = state.pin ? '🔓 رمز وارد شده' : '🔒 نیاز به رمز';
  }

  // رویدادها
  $('#form').addEventListener('submit', submitForm);
  $('#f-reset').onclick = () => { fillForm({}); qEl.focus(); };
  $('#f-cancel').onclick = () => { fillForm({}); loadList(); };
  $('#q-clear').onclick = () => { setQuery(''); closeSuggestions(); $('#list-filter').value = ''; state.filter = ''; loadList(); qEl.focus(); };
  $('#result-copy').onclick = () => copyText(state.selected ? state.selected.extension : '').then((ok) => toast(ok ? 'کپی شد ✓' : 'کپی نشد؛ دستی انتخاب کنید.', ok ? 'ok' : 'bad'));
  $('#result-edit').onclick = () => state.selected && startEdit(state.selected);
  $('#result-del').onclick = () => state.selected && removeItem(state.selected);
  $('#btn-refresh').onclick = () => loadList().then(() => toast('فهرست تازه شد', 'ok', 1200));
  $('#btn-import').onclick = openImport;
  $('#btn-share').onclick = () => api('/api/health').then(openShare);
  $('#btn-pin').onclick = () => askPin();
  $('#sort').onchange = (e) => { state.sort = e.target.value; loadList(); };
  let fdeb = null;
  $('#list-filter').oninput = (e) => { clearTimeout(fdeb); fdeb = setTimeout(() => { state.filter = e.target.value; loadList(); }, 140); };

  qEl.addEventListener('input', () => {
    $('.searchbox').classList.toggle('has-text', !!qEl.value);
    suggest();
  });
  qEl.addEventListener('focus', () => { if (qEl.value.trim()) suggest(); });
  qEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); state.active = Math.min(state.active + 1, state.sugg.length - 1); highlightActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.active = Math.max(state.active - 1, 0); highlightActive(); }
    else if (e.key === 'Enter') { if (state.active >= 0) { e.preventDefault(); pick(state.active); } }
    else if (e.key === 'Escape') { closeSuggestions(); qEl.blur(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.searchbox')) closeSuggestions(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); qEl.select(); qEl.focus(); renderSuggestions(state.sugg); }
    if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); qEl.focus(); }
  });
  $$('details.menu > summary').forEach((s) => (s.onclick = () => setTimeout(() => $$('details.menu').forEach((d) => { if (d !== s.parentElement) d.open = false; }), 0)));

  await loadList();
  const h = await api('/api/health');
  $('#chip-net').textContent = h.lan.length ? 'قابل استفاده در شبکه · ' + fa(h.lan.length) + ' آدرس' : 'فقط روی این سیستم';
  $('#chip-net').title = h.db.file;
  $('#chip-net').onclick = () => openShare(h);
  $('#foot-db').textContent = h.db.file.split(/[\\/]/).slice(-2).join('/');
  $('#foot-meta').textContent = 'نسخه ' + h.version + ' · موتور SQLite · آخرین ذخیره ' + fa(Math.round((h.db.bytes || 0) / 1024)) + ' کیلوبایت';
  $('#file-restore').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      await fetch('/api/restore', { method: 'POST', headers: state.pin ? { 'X-Edit-Pin': state.pin } : {}, body: f });
      toast('بازیابی انجام شد ✓', 'ok');
      await loadList();
    } catch (err) { toast(err.message, 'bad', 5000); }
    e.target.value = '';
  };
  $('#btn-restore').onclick = () =>
    confirmBox('بازیابی دیتابیس', 'با انتخاب فایل بکاپ، تمام رکوردهای فعلی با فایل جایگزین می‌شوند. ادامه می‌دهید؟', 'انتخاب فایل', () => { $('#file-restore').click(); return false; });
  $('#btn-backup').onclick = () => window.open('/api/backup.sqlite', '_blank');
  $('#btn-export').onclick = () => window.open('/api/export.csv', '_blank');

  // به‌روزرسانی خودکار وقتی همکار دیگری چیزی ثبت می‌کند
  setInterval(async () => {
    try {
      const v = await api('/api/version');
      if (v.version !== state.version) { state.version = v.version; await loadList(); }
    } catch { /* سرور ممکن است لحظه‌ای بسته باشد */ }
  }, 4000);

  if (window.innerWidth > 800) qEl.focus(); // روی دسکتاپ، آمادهٔ تایپ از همان اول
  document.documentElement.dataset.ready = '1'; // برای تست‌های خودکار
}

boot().catch((err) => {
  document.body.insertAdjacentHTML('beforeend',
    `<div class="toast bad" style="margin:20px auto;width:max-content">اتصال برقرار نشد: ${esc(err.message)}</div>`);
});
