// Meta-Ethnography Canvas — Core
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// IndexedDB storage, auto-save status, app state, data normalisation and small shared helpers. Must load first.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// INDEXEDDB ENGINE (Singleton + Binary Store Separation)
// ========================================================
// Demo mode (open me_canvas.html?demo): uses its own database and its own localStorage keys,
// so the demo never touches a real project in the same browser.
const DEMO_MODE = /[?&]demo(=|&|#|$)/.test(location.search);
const LS_PREFIX = DEMO_MODE ? 'demo:' : '';
function lsGet(key) { try { return localStorage.getItem(LS_PREFIX + key); } catch (e) { return null; } }
function lsSet(key, value) { try { localStorage.setItem(LS_PREFIX + key, value); } catch (e) { /* storage blocked */ } }
function lsRemove(key) { try { localStorage.removeItem(LS_PREFIX + key); } catch (e) { /* storage blocked */ } }

const DB_NAME = DEMO_MODE ? 'MetaEthnoCanvasDB_demo' : 'MetaEthnoCanvasDB';
const DB_VERSION = 6;
// Project data format, written into every backup (formatVersion). From v1.4.7 on, a project saved in this format must open
// with the same meaning in every later version: a change to the data shape raises PROJECT_FORMAT and adds an upgrade step
// to upgradeProjectData() (and to normalize*() for the browser's own database). Files without the number are older
// (before 1.4.7) and are opened on a best-effort basis.
const PROJECT_FORMAT = 1;
function upgradeProjectData(data) {
  const f = Number(data && data.formatVersion) || 0;
  if (f > PROJECT_FORMAT) {
    throw new Error(`This file was saved by a newer version of Meta-Ethnography Canvas (${(data && data.appVersion) || 'unknown version'}, data format ${f}; this app reads format ${PROJECT_FORMAT}). Update the app, or download the latest offline edition, to open it. Nothing was changed.`);
  }
  // Format 1 is the current one: nothing to upgrade yet. Later formats add their steps here, oldest first.
  return sanitizeProjectData(data);
}
let dbInstancePromise = null;

function initDB() {
  if (dbInstancePromise) return dbInstancePromise;
  dbInstancePromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pdf_binaries')) db.createObjectStore('pdf_binaries', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('annotations')) db.createObjectStore('annotations', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('clusters')) db.createObjectStore('clusters', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('logs')) db.createObjectStore('logs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbInstancePromise = null;
      reject(req.error);
    };
  });
  return dbInstancePromise;
}
let saveBadgeTimer = null;
function flashSaveStatus(status = 'saved') {
  const badge = document.getElementById('saveStatusBadge');
  const icon = document.getElementById('saveStatusIcon');
  const text = document.getElementById('saveStatusText');
  if (!badge || !icon || !text) return;
  badge.classList.remove('hidden', 'opacity-75');
  badge.classList.add('inline-flex');
  if (status === 'saving') {
    badge.className = 'inline-flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0 select-none';
    icon.className = 'ph ph-arrows-clockwise animate-spin text-xs';
    text.textContent = 'Saving...';
  } else if (status === 'error') {
    badge.className = 'inline-flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shrink-0 select-none';
    icon.className = 'ph ph-warning-circle text-xs';
    text.textContent = 'Save Error';
  } else {
    badge.className = 'inline-flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 transition-opacity duration-300 shrink-0 select-none';
    icon.className = 'ph ph-check-circle text-xs';
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    text.textContent = `Saved ${nowStr}`;
  }
  badge.title = text.textContent + ' — all changes are saved automatically in this browser (IndexedDB).';
  if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
  if (status === 'saved') {
    saveBadgeTimer = setTimeout(() => badge.classList.add('opacity-75'), 2500);
  }
}

const pendingSaveCleanups = new Set();

// Starts every pending save / commit at once. The state changes are synchronous; the database writes and audit
// entries finish later, so a caller that shows them (Audit Trail, exports, backup) awaits the returned promise.
// Returns null when nothing was pending, so callers can render at once in the usual case.
function flushAllPendingSaves() {
  if (pendingSaveCleanups.size === 0) return null;
  const running = [];
  for (const flushFn of Array.from(pendingSaveCleanups)) {
    try { running.push(Promise.resolve(flushFn()).catch(e => console.error('Flush save error:', e))); }
    catch (e) { console.error('Flush save error:', e); }
  }
  return Promise.all(running);
}

// Text field whose "commit" (save + audit-log entry) must never be skipped.
// The commit runs once after typing, on whichever comes first: change, blur, a tab switch / re-render
// (flushAllPendingSaves) or leaving the page. Use it instead of a bare `onchange` for every logged text field.
function bindPendingCommit(el, commitFn) {
  let dirty = false;
  const run = async () => {
    if (!dirty) return;
    dirty = false;
    pendingSaveCleanups.delete(run);
    await commitFn();
  };
  run.isCommit = true;
  el.addEventListener('input', () => { dirty = true; pendingSaveCleanups.add(run); });
  // Leaving the box commits; the window losing focus (a look at the PDF in another window, another app) does not, so a text
  // being written is not logged in pieces. It is still committed on the next real leave, a tab switch or the page closing.
  const onLeave = () => { if (document.hasFocus()) run(); };
  el.addEventListener('change', onLeave);
  el.addEventListener('blur', onLeave);
  return run;
}

// A text field of a record (a row's Step A, a construct's label…): the ONE way such a box saves and logs.
//  - While typing, the text goes into the record (set) and the record is saved after a short pause (a draft, so nothing is
//    lost if the browser closes while the box is still being written in).
//  - When the box is left (or on a tab switch, a re-render, the page closing: bindPendingCommit), a draft still waiting is
//    dropped and the commit runs once: the trimmed text is set and saved, and commit(prev, next) is called only if it changed
//    since the last commit (it writes the audit entry and anything else that follows from the change).
// So a record is never saved by two paths for one edit, and a saved text never lacks its audit entry.
// get(): the text as stored; set(v): put it into the record; save(): write the record; onInput(v): e.g. a live preview.
/** @param {any} el @param {{ get: () => any, set: (v: string) => void, save: () => any, commit?: (prev: string, next: string) => any, onInput?: (v: string) => void, delay?: number }} o */
function bindTextField(el, { get, set, save, commit, onInput, delay = 350 }) {
  let committed = String(get() || '').trim();
  let timer = null;
  el.addEventListener('input', () => {
    set(el.value);
    if (onInput) onInput(el.value);
    flashSaveStatus('saving');
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; Promise.resolve().then(save).catch(e => console.error('Save error:', e)); }, delay);
  });
  return bindPendingCommit(el, async () => {
    clearTimeout(timer); timer = null; // the commit writes the record itself
    const next = el.value.trim();
    set(next);
    const prev = committed;
    committed = next;
    await save();
    if (next !== prev && commit) await commit(prev, next);
  });
}

// The browser does not wait for asynchronous work while a page closes. If a text commit (save + audit entry) is still
// pending, ask the browser to confirm leaving: the commit finishes while that dialog is shown. Saves without an audit
// entry (debounced writes) are only started; they are tiny and normally complete.
window.addEventListener('beforeunload', (e) => {
  const hadCommit = Array.from(pendingSaveCleanups).some(f => f.isCommit);
  flushAllPendingSaves();
  if (hadCommit) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushAllPendingSaves();
  }
});

// ---- Backup reminder: remember when the first change after the last JSON backup happened ----
function markUnbackedChange() {
  if (!lsGet('unbackedSince')) lsSet('unbackedSince', String(Date.now()));
  updateBackupReminder();
}
function markBackupDone() {
  lsSet('lastBackupAt', String(Date.now()));
  lsRemove('unbackedSince');
  updateBackupReminder();
}
function updateBackupReminder() {
  const el = document.getElementById('backupReminder');
  if (!el) return;
  const since = parseInt(lsGet('unbackedSince') || '', 10);
  if (!since) { el.classList.add('hidden'); return; }
  const days = Math.floor((Date.now() - since) / 86400000);
  const last = parseInt(lsGet('lastBackupAt') || '', 10);
  el.textContent = days >= 1 ? `${days}d` : '●';
  el.className = `${days >= 7 ? 'bg-rose-100 text-rose-700 border-rose-300' : 'bg-amber-100 text-amber-800 border-amber-300'} text-[10px] font-bold leading-none px-1 py-0.5 rounded border`;
  el.title = (days >= 1 ? `Changes not backed up for ${days} day${days === 1 ? '' : 's'}. ` : 'Changes since the last backup. ')
    + (last ? `Last backup: ${new Date(last).toLocaleString()}.` : 'No backup made yet.')
    + ' Click Backup to save a JSON file.';
}

// A write the browser refused (storage full, private mode limits, a damaged database): the change is on screen but not stored.
// Said plainly, at most once a minute, with what to do; the save badge shows "Save Error" as well.
let lastStorageNotice = 0;
function reportStorageError(err) {
  if (Date.now() - lastStorageNotice < 60000) return;
  lastStorageNotice = Date.now();
  const what = (err && (err.name || err.message)) || 'unknown error';
  if (typeof showNotice === 'function') showNotice('A change could not be saved', `The browser did not store the last change (${what}). What you see may differ from what is saved.\n\nMake a Backup now (the backup is made from what you see). If the browser's storage is full, free space (e.g. remove PDFs of studies you no longer need), then reload and restore the backup if anything is missing.`);
}
// quiet: bookkeeping writes the user did not make (e.g. a PDF fingerprint) — no save badge, no backup reminder
// Lookups the matrix builds once per render (rows' constructs, quotes per construct, history per row): dropped whenever the
// data they come from is written, so a row built later (lazily) never reads an outdated index
let matrixIndexCache = null;
// (Rows themselves are read live, so typing a row's texts, which writes 'clusters' while typing, does not drop it.)
function invalidateMatrixIndex(store) { if (!store || store === 'annotations' || store === 'logs') matrixIndexCache = null; }
async function dbPut(store, item, { quiet = false } = {}) {
  invalidateMatrixIndex(store);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(item);
    tx.oncomplete = () => {
      if (quiet) { resolve(); return; }
      if (store !== 'pdf_binaries') flashSaveStatus('saved');
      markUnbackedChange();
      resolve();
    };
    tx.onerror = () => { flashSaveStatus('error'); reportStorageError(tx.error); reject(tx.error); };
    tx.onabort = () => { flashSaveStatus('error'); reportStorageError(tx.error); reject(tx.error || new Error('IndexedDB transaction aborted')); };
  });
}
// Several writes across stores in ONE transaction: all of them are stored, or none (a crash, a full disk or an error part way
// leaves the project as it was). For operations that change several records at once: merging / splitting / deleting rows and
// deleting a study. ops: [{ store, put: item } | { store, del: key }]. quiet: as for dbPut (writes the user did not make)
/** @typedef {{ store: string, put?: any, del?: any }} DbOp */
/** @param {DbOp[]} ops */
async function dbBatch(ops, { quiet = false } = {}) {
  if (!ops.length) return;
  const stores = [...new Set(ops.map(o => o.store))];
  stores.forEach(invalidateMatrixIndex);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    try {
      ops.forEach(o => { const st = tx.objectStore(o.store); if ('del' in o) st.delete(o.del); else st.put(o.put); });
    } catch (err) {
      // A write that cannot even be queued (e.g. a record without its key) aborts the whole transaction: nothing is stored
      try { tx.abort(); } catch (e) { /* already finished */ }
      flashSaveStatus('error');
      reportStorageError(err);
      reject(err);
      return;
    }
    tx.oncomplete = () => { if (!quiet) { flashSaveStatus('saved'); markUnbackedChange(); } resolve(); };
    tx.onerror = () => { flashSaveStatus('error'); reportStorageError(tx.error); reject(tx.error); };
    tx.onabort = () => { flashSaveStatus('error'); reportStorageError(tx.error); reject(tx.error || new Error('IndexedDB transaction aborted')); };
  });
}
// ======================= commitOps: the one way a change of several records is stored and shown =======================
// Every change written with dbBatch goes through here, in the same four steps:
//  1. a deletion first lets every save still waiting finish (flushAllPendingSaves), so none of them writes a deleted record
//     back after it;
//  2. the records are written in one transaction (dbBatch): all of them, or none;
//  3. only then are the same ops applied to `state` (docs / annotations / clusters / logs, and the model in 'meta'): a write
//     the browser refused leaves the records in memory as they are in the database (nothing removed or added on screen alone);
//  4. the lookups built from them (getMatrixIndex) are dropped, also if a render rebuilt them while the write was running.
// A record written that is already in `state` under its id stays the same object (its content is replaced), so a view or a
// handler holding it keeps the current record. A new record is added at the end of its list (a caller that needs another
// place, e.g. a study's position, moves it after). Callers may also have changed records in memory before (in place, as
// before): writing that same object again changes nothing in memory.
/** @param {DbOp[]} ops @param {{ quiet?: boolean }} [opts] */
async function commitOps(ops, { quiet = false } = {}) {
  if (!ops.length) return;
  if (ops.some(o => 'del' in o)) await flushAllPendingSaves();
  await dbBatch(ops, { quiet });
  applyOpsToState(ops);
  invalidateMatrixIndex();
}
const STATE_LIST_OF_STORE = { docs: 'docs', annotations: 'annotations', clusters: 'clusters', logs: 'logs' };
/** @param {DbOp[]} ops */
function applyOpsToState(ops) {
  const gone = {}, index = {};
  let logsAdded = false;
  const indexOf = key => index[key] || (index[key] = new Map(state[key].map((r, i) => [r && r.id, i])));
  for (const o of ops) {
    if (o.store === 'meta') {
      if (!('del' in o) && o.put && o.put.id === 'loa_main' && state.loa !== o.put) state.loa = o.put;
      continue;
    }
    const key = STATE_LIST_OF_STORE[o.store];
    if (!key) continue; // pdf_binaries: not kept in memory
    if ('del' in o) { (gone[key] = gone[key] || new Set()).add(o.del); continue; }
    const rec = o.put;
    if (gone[key]) gone[key].delete(rec.id); // deleted and written again in one batch: it stays
    const at = indexOf(key).get(rec.id);
    if (at === undefined) {
      index[key].set(rec.id, state[key].length);
      state[key].push(rec);
      if (key === 'logs') logsAdded = true;
    } else if (state[key][at] !== rec) {
      const cur = state[key][at];
      Object.keys(cur).forEach(k => { if (!(k in rec)) delete cur[k]; });
      Object.assign(cur, rec);
    }
  }
  Object.keys(gone).forEach(key => { if (gone[key].size) state[key] = state[key].filter(r => !gone[key].has(r && r.id)); });
  if (logsAdded) state.logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // newest first, as at startup
}
async function dbGet(store, key) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(tx.error);
  });
}
async function dbGetAll(store) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(tx.error);
  });
}
// Keys only (no values): lets us compare stored PDFs without loading any PDF bytes into memory
async function dbGetAllKeys(store) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAllKeys();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(tx.error);
  });
}
async function dbDelete(store, key) {
  invalidateMatrixIndex(store);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => { flashSaveStatus('saved'); markUnbackedChange(); resolve(); };
    tx.onerror = () => { flashSaveStatus('error'); reportStorageError(tx.error); reject(tx.error); };
    tx.onabort = () => { flashSaveStatus('error'); reportStorageError(tx.error); reject(tx.error || new Error('IndexedDB transaction aborted')); };
  });
}
async function dbClear(store) {
  invalidateMatrixIndex(store);
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ========================================================
// STATE & NORMALIZATION
// ========================================================
// The page's state. Typed for `npm run typecheck`, so a misspelt field (state.annotaions) is an error: a new field is added
// here and in the typedef below.
/**
 * @typedef {Object} AppState
 * @property {string} reviewerId
 * @property {string} projectCode
 * @property {boolean} teamMode
 * @property {boolean} logMinorOps
 * @property {Set<string>} hiddenStudyIds
 * @property {any[]} docs
 * @property {any[]} annotations
 * @property {any[]} clusters
 * @property {any[]} logs
 * @property {Record<string, any>} loa
 * @property {string | null} activeDocId
 * @property {any} activePdfDoc
 * @property {number} scale
 * @property {any} pendingSelection
 * @property {boolean} isEditMetaMode
 * @property {boolean} showContextRow
 * @property {boolean} isLoaOpen
 * @property {Record<string, string>} clusterActiveTabs
 * @property {Set<string>} rowToolsOpen
 * @property {string} activePubTable
 * @property {any} peerComparison
 * @property {string} activeCompareTab
 * @property {string} poolSearchQuery
 * @property {string} poolStudyFilter
 * @property {boolean} poolRefutationalOnly
 * @property {boolean} matrixRefutationalOnly
 * @property {boolean} matrixCompactMode
 * @property {boolean} matrixThemeFolded
 * @property {any[]} undoStack
 */
/** @type {AppState} */
const state = {
  reviewerId: lsGet('me_reviewer_id') || '',
  projectCode: lsGet('me_project_code') || '',
  teamMode: lsGet('me_team_mode') === 'true',
  logMinorOps: lsGet('me_log_minor_ops') === 'true',
  hiddenStudyIds: new Set((() => { try { return JSON.parse(lsGet('me_hidden_studies') || '[]'); } catch (e) { return []; } })()),
  docs: [],
  annotations: [],
  clusters: [],
  logs: [],
  // The project-wide record (meta store, 'loa_main'): these fields and many optional ones (write-up fields, map, team models…)
  loa: /** @type {Record<string, any>} */ ({ id: 'loa_main', projectCode: '', aim: '', title: '', flow: '', narrative: '', relateProcess: '', relateOutcome: '', synthStudies: '', appraisalPolicy: '', appraisalUse: '', links: [], updatedAt: null }),
  activeDocId: null,
  activePdfDoc: null,
  scale: 1.3,
  pendingSelection: null,
  isEditMetaMode: false,
  showContextRow: true,
  isLoaOpen: false,
  clusterActiveTabs: {}, // { [clusterId]: 'synthesis' | 'cerqual' | 'concordance' }
  rowToolsOpen: new Set(), // rows whose ⋯ tools (reviewer, history, ◆ base, merge / split, delete) are open
  activePubTable: 'method', // 'method' | 'table1' | 'table2' | 'table2_grid' | 'table3' | 'appendix'
  peerComparison: null,
  activeCompareTab: 'divergent',
  poolSearchQuery: '',
  poolStudyFilter: 'all',
  poolRefutationalOnly: false,
  matrixRefutationalOnly: false,
  matrixCompactMode: false,
  matrixThemeFolded: false, // Tab 2: the 3rd Order Theme column folded to a narrow strip (kept in localStorage)
  undoStack: []
};

// Bundled PDF.js (worker, cmaps/, standard_fonts/). Must be an absolute URL: the worker resolves relative URLs against its own location.
const PDFJS_BASE = new URL('app/vendor/pdfjs/', document.baseURI).href;
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
}
// ---- Offline edition (opened by double-click, file://) ----
// Browsers block fetch/XHR of local files, so PDF.js cannot read its CMaps (needed for Japanese, Chinese,
// Korean… PDFs) or standard fonts there. tools/copy-vendor.mjs also writes each of those data files as a small
// <script> (app/vendor/pdfjs/offline/), which file:// pages may load. The PDF.js worker itself falls back to
// running on the main thread automatically. Served over http(s), PDF.js loads everything the normal way.
const IS_FILE_PROTOCOL = location.protocol === 'file:';
const pdfjsScriptData = {};
function pdfjsDataSlot(key) {
  if (!pdfjsScriptData[key]) {
    const slot = {};
    slot.promise = new Promise((resolve, reject) => { slot.resolve = resolve; slot.reject = reject; });
    pdfjsScriptData[key] = slot;
  }
  return pdfjsScriptData[key];
}
// Called by every generated data script: window.__mecPdfjsData('cmap:UniJIS-UCS2-H', '<base64>')
window.__mecPdfjsData = (key, base64) => pdfjsDataSlot(key).resolve(base64);
function loadPdfjsDataScript(key, src) {
  const slot = pdfjsDataSlot(key);
  if (!slot.requested) {
    slot.requested = true;
    const el = document.createElement('script');
    el.src = src;
    el.onerror = () => { slot.requested = false; delete pdfjsScriptData[key]; slot.reject(new Error('Cannot load ' + src)); };
    document.head.appendChild(el);
  }
  return slot.promise.then(b64 => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  });
}
class ScriptCMapReaderFactory {           // same interface as PDF.js' DOMCMapReaderFactory
  constructor() {}
  async fetch({ name }) {
    const cMapData = await loadPdfjsDataScript('cmap:' + name, PDFJS_BASE + 'offline/cmaps/' + encodeURIComponent(name) + '.js');
    return { cMapData, compressionType: pdfjsLib.CMapCompressionType.BINARY };
  }
}
class ScriptStandardFontDataFactory {     // same interface as PDF.js' DOMStandardFontDataFactory
  constructor() {}
  fetch({ filename }) {
    return loadPdfjsDataScript('font:' + filename, PDFJS_BASE + 'offline/standard_fonts/' + encodeURIComponent(filename) + '.js');
  }
}
function pdfjsDocumentOptions() {
  // isEvalSupported:false = mitigation for CVE-2024-4367 (arbitrary JS via a crafted PDF font) in pdfjs-dist <= 4.1.x, which includes the bundled 3.11.174.
  const opts = { cMapUrl: PDFJS_BASE + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_BASE + 'standard_fonts/', isEvalSupported: false };
  if (IS_FILE_PROTOCOL) Object.assign(opts, { useWorkerFetch: false, CMapReaderFactory: ScriptCMapReaderFactory, StandardFontDataFactory: ScriptStandardFontDataFactory });
  return opts;
}
let pageObserver = null;

// ---- Domain-level appraisal (eMERGe Part 3: report the judgement on each domain of the tool for each study) ----
// The checklists are records of judgements with reasons. They are never added up into a score.
// Checklist definitions live in their own files under app/checklists/ (each under its own licence, NOT the MIT licence
// of this app), loaded right after this file. Only checklists whose wording may be redistributed are included: CASP
// (CC BY-NC-SA 4.0). JBI checklists need JBI's permission, so JBI stays a tool name without built-in questions.
const APPRAISAL_CHECKLISTS = {};
function appraisalAnswerLabel(tool, a) { const c = APPRAISAL_CHECKLISTS[tool]; const m = c && c.answers.find(x => x[0] === a); return m ? m[1] : ''; }
// { q1: { a: 'yes', note: '' }, … } for the given tool (answers are kept per tool, so switching tool loses nothing)
function appraisalItemsOf(doc, tool = doc.appraisalTool) {
  if (!doc.appraisalItems || typeof doc.appraisalItems !== 'object') doc.appraisalItems = {};
  if (!doc.appraisalItems[tool] || typeof doc.appraisalItems[tool] !== 'object') doc.appraisalItems[tool] = {};
  return doc.appraisalItems[tool];
}
// Every domain with an answer (open items: with a note)? Completeness only, not a judgement of quality.
function appraisalDomainsComplete(doc) {
  const c = APPRAISAL_CHECKLISTS[doc.appraisalTool];
  if (!c) return false;
  const items = appraisalItemsOf(doc);
  return c.items.every(it => !!(items[it.id] && items[it.id].a));
}
// The checklist's own summary (CASP: positive / negative / unknowns), kept per tool
function appraisalSummaryOf(doc, tool = doc.appraisalTool) {
  if (!doc.appraisalSummary || typeof doc.appraisalSummary !== 'object') doc.appraisalSummary = {};
  if (!doc.appraisalSummary[tool] || typeof doc.appraisalSummary[tool] !== 'object') doc.appraisalSummary[tool] = {};
  return doc.appraisalSummary[tool];
}
function hasAppraisalDomains(doc) {
  const c = APPRAISAL_CHECKLISTS[doc.appraisalTool];
  if (!c) return false;
  const items = appraisalItemsOf(doc);
  const sum = appraisalSummaryOf(doc);
  return c.items.some(it => items[it.id] && (items[it.id].a || items[it.id].note)) || Object.values(sum).some(Boolean);
}

function normalizeDoc(d) {
  if (typeof d.appraisalTool !== 'string' || !d.appraisalTool) d.appraisalTool = 'CASP';
  if (!d.appraisalItems || typeof d.appraisalItems !== 'object') d.appraisalItems = {};
  if (!d.appraisalSummary || typeof d.appraisalSummary !== 'object') d.appraisalSummary = {};
  return d;
}

function stripOuterQuotes(str) {
  if (!str) return '';
  let s = String(str).trim();
  const pairs = [
    ['"', '"'], ['“', '”'], ['„', '“'], ['„', '”'],
    ['«', '»'], ['「', '」'], ['『', '』'], ["'", "'"], ['‘', '’']
  ];
  let changed = true;
  while (changed && s.length >= 2) {
    changed = false;
    for (const [openQ, closeQ] of pairs) {
      if (s.startsWith(openQ) && s.endsWith(closeQ)) {
        s = s.slice(openQ.length, s.length - closeQ.length).trim();
        changed = true;
        break;
      }
    }
  }
  return s.replace(/^["“”]+|["“”]+$/g, '').trim();
}

// Edited text of a construct: as normalizeAnnotation keeps it (a reviewer-wrapped construct's '[Concept derived from …]: "…"'
// keeps its quotation marks; any other text loses the quotation marks around it)
function cleanAnnotationText(a, raw) {
  return a && a.origin === 'wrapped_first_order' ? String(raw || '').trim() : stripOuterQuotes(raw);
}

function sanitizePageLabel(p) {
  if (p === null || p === undefined) return '';
  return String(p).replace(/[^\p{L}\p{N}\s.,\-–—:\/()]/gu, '').trim().slice(0, 24);
}

function secLabelTag(s) { return (s.noteSource === 'reviewer' && s.origin !== 'wrapped_first_order') ? ' [reviewer wording]' : ''; }

function normalizeAnnotation(a) {
  // Reviewer-wrapped constructs keep their '[Concept derived from 1st Order Quote …]: "…"' text unchanged
  if (typeof a.text === 'string' && a.origin !== 'wrapped_first_order') a.text = stripOuterQuotes(a.text);
  if (typeof a.nuanceNote !== 'string') a.nuanceNote = '';
  // Page labels are rendered in many HTML templates: keep them to safe characters (digits, ranges, roman numerals, "S1" etc.)
  a.page = sanitizePageLabel(a.page);
  if (typeof a.concordanceStatus !== 'string') a.concordanceStatus = 'pending'; // 'pending' | 'discuss' | 'agreed'
  if (typeof a.concordanceNote !== 'string') a.concordanceNote = '';
  if (typeof a.by !== 'string' || !a.by) a.by = state.reviewerId || 'Reviewer';
  if (a.type === 'second_order') {
    if (a.origin !== 'wrapped_first_order') a.origin = 'author_passage';
    // Label source: 'author' = the authors' own term, 'reviewer' = paraphrase (always for reviewer-wrapped constructs)
    if (a.origin === 'wrapped_first_order') a.noteSource = 'reviewer';
    else if (a.noteSource !== 'reviewer') a.noteSource = 'author';
    if (!Array.isArray(a.clusterIds)) a.clusterIds = [];
    if (!a.clusterComments || typeof a.clusterComments !== 'object') a.clusterComments = {};
    if (!a.clusterRelations || typeof a.clusterRelations !== 'object') a.clusterRelations = {};
    // Additional passages where the authors state the SAME interpretation elsewhere in the paper
    if (typeof a.notTranslatedNote !== 'string') a.notTranslatedNote = ''; // why it was left out of every 3rd order row (Appendix B)
    if (!Array.isArray(a.passages)) a.passages = [];
    a.passages.forEach(p => { p.page = sanitizePageLabel(p.page); if (typeof p.text !== 'string') p.text = ''; });
  }
  if (a.type === 'first_order') quoteParentIds(a);
  return a;
}

// ---- 1st ⇄ 2nd Order links are many-to-many: f.parentIds[] ----
function quoteParentIds(f) {
  if (!Array.isArray(f.parentIds)) f.parentIds = [];
  return f.parentIds;
}
function isQuoteLinkedTo(f, secId) { return f.type === 'first_order' && quoteParentIds(f).includes(secId); }
function quotesOf(secId) { return state.annotations.filter(a => a.type === 'first_order' && isQuoteLinkedTo(a, secId)); }
function linkQuote(f, secId) {
  const ids = quoteParentIds(f);
  if (secId && !ids.includes(secId)) ids.push(secId);
}
function unlinkQuote(f, secId) {
  f.parentIds = quoteParentIds(f).filter(id => id !== secId);
}
function clearQuoteLinks(f) { f.parentIds = []; }
// A project code or reviewer ID as part of a download's file name: characters that file systems refuse (/ \ : * ? " < > |,
// control characters) and spaces become _, so any code still gives a valid name; letters of any script are kept
function fileNamePart(s) {
  return String(s || '').replace(/[\\/:*?"<>|\x00-\x1f\s]+/g, '_').replace(/^[._]+|[._]+$/g, '');
}
// (A construct's place in a row — rowFieldsOf / takeOutOfRow / putIntoRow — and every other field that names a row or a
// study: the reference graph in logic.js)

// A construct is in a row (placed, imported, or brought back by Undo): what that changes in the row, in one place.
// A row whose base is not set yet ('') takes this study's; an empty-cell record for this study ("— not addressed" /
// "◇ different aspect") no longer applies now that the study has a construct there. Returns the rows changed (to write).
function rowsTouchedByPlacement(a) {
  if (!a || a.type !== 'second_order') return [];
  const changed = [];
  (a.clusterIds || []).forEach(id => {
    const row = state.clusters.find(c => c.id === id);
    if (!row) return;
    let ch = false;
    if (row.baseDocId === '') { row.baseDocId = a.docId; ch = true; }
    if (row.cellStatus && row.cellStatus[a.docId]) { row.cellStatus = { ...row.cellStatus }; delete row.cellStatus[a.docId]; ch = true; }
    if (ch) changed.push(row);
  });
  return changed;
}
// The same for several constructs, as dbBatch ops (each row once)
function placementRowOps(annos) {
  const rows = new Map();
  annos.forEach(a => rowsTouchedByPlacement(a).forEach(r => rows.set(r.id, r)));
  return [...rows.values()].map(r => ({ store: 'clusters', put: r }));
}
// Drop links to what no longer exists, for an annotation brought back (Undo, split off a passage, a restored file): a construct's
// placements in deleted rows (its clusterIds and every per-row field), a quote's links to deleted 2nd Order constructs.
// A quote keeps links only to constructs of its own study (as checkInvariants requires).
// alsoSecs: constructs being brought back together with it (records, not in state.annotations yet). Returns the annotation.
/** @param {any} a @param {Iterable<any>} [alsoSecs] */
function dropGoneLinks(a, alsoSecs = []) {
  if (!a) return a;
  if (a.type === 'first_order') {
    const secs = new Set([...alsoSecs, ...state.annotations]
      .filter(x => x && x.type === 'second_order' && x.docId === a.docId).map(x => x.id));
    a.parentIds = quoteParentIds(a).filter(id => secs.has(id));
    return a;
  }
  if (a.type !== 'second_order') return a;
  const live = new Set(state.clusters.map(c => c.id));
  if (Array.isArray(a.clusterIds)) a.clusterIds = a.clusterIds.filter(id => live.has(id));
  ANNOTATION_ROW_FIELDS.forEach(k => {
    if (a[k] && typeof a[k] === 'object' && Object.keys(a[k]).some(id => !live.has(id))) {
      a[k] = Object.fromEntries(Object.entries(a[k]).filter(([id]) => live.has(id)));
    }
  });
  return a;
}
// Evidence of a 2nd order construct = primary passage + additional passages
function secAllPassages(s) {
  return [{ text: s.text, page: s.page }, ...((s.passages || []).map(p => ({ text: p.text, page: p.page })))];
}
function secPagesLabel(s) { return [...new Set(secAllPassages(s).map(p => String(p.page)).filter(Boolean))].join(', '); }
function secEvidenceText(s) {
  const ps = secAllPassages(s);
  return ps.length === 1 ? ps[0].text : ps.map(p => `(p.${p.page}) ${p.text}`).join(' […] ');
}

// Each row records the study whose construct established it (cluster.baseDocId). That study's constructs are not translated
// "into" the row, so no reciprocal/refutational relation applies to them there. In index-paper approaches this is usually
// study #1, but a row can also start from a later study (a concept #1 does not have), and the reviewer can choose that no
// single study establishes a row (baseDocId null: every placement is judged). '' = not set yet: the first study placed sets it.
// A row's history covers its own entries and those of the rows it was merged from or split off
function rowHistoryIds(c) { return new Set([c.id, ...((c && c.historyFrom) || [])]); }
function logIsForRow(l, c) { const ids = rowHistoryIds(c); return (l.clusterIds || []).some(id => ids.has(id)); }
function clusterById(cid) { return state.clusters.find(c => c && c.id === cid) || null; }
function rowBaseDocId(c) {
  const id = c && c.baseDocId;
  return id && state.docs.some(d => d.id === id) ? id : null;
}
function isRowBase(sec, cid) { const b = rowBaseDocId(clusterById(cid)); return !!b && sec.docId === b; }
function isSecRefutational(sec, cid) {
  return !isRowBase(sec, cid) && !!(sec.clusterRelations && sec.clusterRelations[cid] === 'refutational');
}
// How a study's construct relates to a row it was placed in. A placement starts as 'unjudged': silence is not agreement,
// and refutational translation is the one most often overlooked (eMERGe criterion 13).
// 'other_aspect': the construct belongs near the row but neither agrees nor contrasts with it: it speaks to another aspect
// of the topic (Noblit & Hare's third relation, the material of a line of argument; eMERGe criterion 12).
const CELL_RELATIONS = ['unjudged', 'reciprocal', 'refutational', 'other_aspect'];
function secRelation(sec, cid) {
  if (isRowBase(sec, cid)) return 'baseline';
  const r = sec.clusterRelations && sec.clusterRelations[cid];
  return CELL_RELATIONS.includes(r) ? r : 'unjudged';
}
// A row's reciprocal / refutational character is derived from its judged cells (each study's relation is set per cell),
// not stored per row: 'reciprocal', 'refutational' (no judged study is reciprocal), 'mixed', 'aspects' (only different
// aspects), 'unjudged' (nothing judged yet),
// or 'untranslated' (fewer than two studies in the row: nothing has been translated yet, so it is not "reciprocal").
function clusterSecsIn(c) {
  return state.annotations.filter(a => a.type === 'second_order' && (a.clusterIds || []).includes(c.id));
}
function clusterSecsTranslated(c) {
  return clusterSecsIn(c).filter(a => secRelation(a, c.id) !== 'baseline');
}
function clusterTranslationType(c) {
  if (new Set(clusterSecsIn(c).map(a => a.docId)).size < 2) return 'untranslated';
  const rels = clusterSecsTranslated(c).map(a => secRelation(a, c.id)).filter(r => r !== 'unjudged');
  if (rels.length === 0) return 'unjudged';
  const recip = rels.filter(r => r === 'reciprocal').length, refut = rels.filter(r => r === 'refutational').length;
  if (!recip && !refut) return 'aspects'; // every judged study speaks to a different aspect
  if (refut === 0) return 'reciprocal';
  return recip ? 'mixed' : 'refutational';
}
function clusterUnjudgedCount(c) { return clusterSecsTranslated(c).filter(a => secRelation(a, c.id) === 'unjudged').length; }
function clusterTranslationLabel(c) {
  const t = clusterTranslationType(c);
  if (t === 'untranslated') return 'Not yet translated (one study only)';
  const base = t === 'unjudged' ? 'Not yet judged' : t === 'aspects' ? 'Different aspects only' : t === 'refutational' ? 'Refutational' : t === 'mixed' ? 'Reciprocal + Refutational' : 'Reciprocal';
  const aspects = t === 'aspects' || t === 'unjudged' ? 0 : clusterSecsTranslated(c).filter(a => secRelation(a, c.id) === 'other_aspect').length;
  const n = t === 'unjudged' ? 0 : clusterUnjudgedCount(c);
  return base + (aspects ? ` + ${aspects} different aspect${aspects === 1 ? '' : 's'}` : '') + (n ? ` (${n} placement${n === 1 ? '' : 's'} not yet judged)` : '');
}
// Symbol for a study's contribution to a row (Table 2b, grid exports)
const CONTRIB_SYMBOLS = { baseline: '◆', reciprocal: '●', refutational: '⚡', other_aspect: '◇', unjudged: '○' };
function contribSymbol(docSecs, cid) {
  if (docSecs.length && isRowBase(docSecs[0], cid)) return '◆';
  const kinds = ['reciprocal', 'refutational', 'other_aspect', 'unjudged'].filter(k => docSecs.some(sc => secRelation(sc, cid) === k));
  return kinds.map(k => CONTRIB_SYMBOLS[k]).join(' / ');
}
// An empty cell (no construct of this study in this row) says nothing by itself. The reviewer can record that the study was
// checked and does not address the theme, or that it addresses a different aspect of the topic (Noblit & Hare's third way
// studies relate, which leads to a line of argument; eMERGe S4, criterion 11).
const EMPTY_CELL_STATUS = {
  absent: { symbol: '—', label: 'Checked: not addressed in this study' },
  other_aspect: { symbol: '◇', label: 'Addresses a different aspect of the topic' }
};
function emptyCellInfo(c, docId) {
  const v = c.cellStatus && c.cellStatus[docId];
  return v && EMPTY_CELL_STATUS[v.status] ? { ...v, ...EMPTY_CELL_STATUS[v.status] } : null;
}
const TABLE2B_LEGEND = '◆ = the study whose construct established the row; ● = Reciprocal; ⚡ = Refutational; ○ = placed, relation not yet judged; ◇ = addresses a different aspect of the topic; — = checked, not addressed; blank = not yet checked';
const TABLE2B_NOTE = 'The symbols record how each study was read against the row; they are not weights, scores or a count of support for the finding.';
function getCellRelationMeta(rel) {
  if (rel === 'unjudged') {
    return {
      label: '○ Not yet judged',
      cardCls: 'bg-white border-slate-300 border-dashed',
      badgeCls: 'bg-slate-100 text-slate-700 border-slate-400',
      quoteBorderCls: 'border-slate-200',
      dividerCls: 'border-slate-200'
    };
  }
  if (rel === 'baseline') {
    return {
      label: '◆ Established the row',
      cardCls: 'bg-amber-50/40 border-amber-200',
      badgeCls: 'bg-amber-100 text-amber-800 border-amber-300',
      quoteBorderCls: 'border-amber-100',
      dividerCls: 'border-amber-100'
    };
  }
  if (rel === 'other_aspect') {
    return {
      label: '◇ Different aspect',
      cardCls: 'bg-sky-50/40 border-sky-300',
      badgeCls: 'bg-sky-100 text-sky-800 border-sky-300',
      quoteBorderCls: 'border-sky-200',
      dividerCls: 'border-sky-200'
    };
  }
  if (rel === 'refutational') {
    return {
      label: '⚡ Refutational',
      cardCls: 'bg-rose-50/70 border-rose-300 ring-1 ring-rose-200/60',
      badgeCls: 'bg-rose-600 text-white border-rose-700 hover:bg-rose-700',
      quoteBorderCls: 'border-rose-200',
      dividerCls: 'border-rose-200/80'
    };
  }
  return {
    label: '🤝 Reciprocal',
    cardCls: 'bg-emerald-50/40 border-emerald-200',
    badgeCls: 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200',
    quoteBorderCls: 'border-emerald-100',
    dividerCls: 'border-emerald-100'
  };
}

function normalizeCluster(c) {
  if (typeof c.concordanceStatus !== 'string') c.concordanceStatus = 'pending';
  if (typeof c.concordanceNote !== 'string') c.concordanceNote = '';
  if (typeof c.by !== 'string' || !c.by) c.by = state.reviewerId || 'Reviewer';
  if (typeof c.cerqualLimitations !== 'string') c.cerqualLimitations = 'Not assessed';
  if (typeof c.cerqualCoherence !== 'string') c.cerqualCoherence = 'Not assessed';
  if (typeof c.cerqualAdequacy !== 'string') c.cerqualAdequacy = 'Not assessed';
  if (typeof c.cerqualRelevance !== 'string') c.cerqualRelevance = 'Not assessed';
  if (typeof c.cerqualConfidence !== 'string') c.cerqualConfidence = 'Not assessed';
  if (typeof c.cerqualExplanation !== 'string') c.cerqualExplanation = '';
  if (typeof c.seedConfirmed !== 'boolean') c.seedConfirmed = false;
  if (!c.cellStatus || typeof c.cellStatus !== 'object') c.cellStatus = {}; // { [docId]: { status: 'absent' | 'other_aspect', note } }
  if (typeof c.translationSummary !== 'string') c.translationSummary = ''; // Step A (Phase 5): how the studies' concepts translate into one another
  if (typeof c.reflexiveNote !== 'string') c.reflexiveNote = '';           // optional: how the reviewer's own position shapes this interpretation
  if (typeof c.synthesisNote !== 'string') c.synthesisNote = '';           // Step B: the reviewer's 3rd order construct (definition & interpretation)
  ['cerqualLimNote', 'cerqualCohNote', 'cerqualAdeqNote', 'cerqualRelNote'].forEach(k => { if (typeof c[k] !== 'string') c[k] = ''; });
  if (!('baseDocId' in c)) {
    // Rows saved before rows recorded their own base: study #1 was the base of every row it had a construct in
    const d0 = state.docs[0];
    c.baseDocId = d0 && state.annotations.some(a => a.type === 'second_order' && a.docId === d0.id && (a.clusterIds || []).includes(c.id)) ? d0.id : null;
  } else if (c.baseDocId !== null && typeof c.baseDocId !== 'string') c.baseDocId = null;
  // Rows this row was merged from or split off (their history belongs to this row's history too)
  if (!Array.isArray(c.historyFrom)) c.historyFrom = [];
  delete c.translationType; // removed: a row's reciprocal / refutational character is derived from its cells (clusterTranslationType)
  return c;
}

// Agreement is provisional (Big Q): the same wording is used in the app and in every export
function concordanceLabel(status) {
  return status === 'agreed' ? 'Agreed (for now)' : status === 'discuss' ? 'Discuss' : 'Pending';
}
function getConcordanceBadgeMeta(status) {
  if (status === 'agreed') return { label: '✅ Agreed (for now)', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  if (status === 'discuss') return { label: '💬 Discuss', cls: 'bg-amber-100 text-amber-800 border-amber-300' };
  return { label: '⏳ Pending', cls: 'bg-slate-100 text-slate-600 border-slate-300' };
}

function getCerqualBadgeMeta(conf) {
  switch (conf) {
    case 'High': return { label: '📊 CERQual: High', cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
    case 'Moderate': return { label: '📊 CERQual: Mod', cls: 'bg-sky-100 text-sky-900 border-sky-300' };
    case 'Low': return { label: '📊 CERQual: Low', cls: 'bg-amber-100 text-amber-900 border-amber-300' };
    case 'Very low': return { label: '📊 CERQual: V.Low', cls: 'bg-rose-100 text-rose-900 border-rose-300' };
    default: return { label: '📊 CERQual: Not assessed', cls: 'bg-slate-100 text-slate-600 border-slate-300' };
  }
}

function escapeHtml(s) {
  return s ? String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) : '';
}

// Short notice at the bottom of the window. With { actionLabel, onAction } it carries one button (e.g. Undo) and stays a
// little longer; a newer notice replaces it (and its button).
let snackbarTimer = null;
function showSnackbar(message, { actionLabel = '', onAction = null, duration = 0 } = {}) {
  const snackbar = document.getElementById('snackbar');
  if (!snackbar) return;
  const textEl = document.getElementById('snackbarText');
  const btn = document.getElementById('snackbarAction');
  if (textEl) textEl.textContent = message; else snackbar.textContent = message;
  const hide = () => {
    snackbar.classList.add('opacity-0', 'pointer-events-none');
    if (btn) { btn.classList.add('hidden'); btn.onclick = null; }
  };
  if (btn) {
    if (actionLabel && onAction) {
      btn.textContent = actionLabel;
      btn.classList.remove('hidden');
      btn.onclick = () => { hide(); onAction(); };
      snackbar.classList.remove('pointer-events-none');
    } else {
      btn.classList.add('hidden'); btn.onclick = null;
      snackbar.classList.add('pointer-events-none');
    }
  }
  snackbar.classList.remove('opacity-0');
  if (snackbarTimer) clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(hide, duration || (actionLabel ? 7000 : Math.min(9000, 3000 + message.length * 25)));
}
// After a deletion that Ctrl+Z can undo: no "Are you sure?" first, a notice with Undo afterwards.
// The button undoes THIS action only (if something else was pushed meanwhile, the notice was replaced anyway).
function showUndoSnackbar(message) {
  const action = state.undoStack[state.undoStack.length - 1];
  showSnackbar(`${message} — Ctrl+Z to undo`, {
    actionLabel: 'Undo',
    onAction: () => { if (state.undoStack[state.undoStack.length - 1] === action) performUndo(); }
  });
}

// A choice between named actions (instead of confirm(), whose OK / Cancel cannot say what each does, and which a browser may
// suppress). choices: [{ value, label, hint, tone: 'primary' | 'danger' | 'plain' }]. Resolves to the chosen value, or null when
// cancelled (Cancel, ×, Escape). Nothing is chosen by default: Enter does not pick an option.
let choiceDismissOpen = null;
function askChoice({ title = 'Choose', body = '', choices = [], cancelLabel = 'Cancel' } = {}) {
  const modal = document.getElementById('choiceModal');
  if (choiceDismissOpen) choiceDismissOpen();
  document.getElementById('choiceModalTitle').textContent = title;
  document.getElementById('choiceModalCancelBtn').textContent = cancelLabel;
  document.getElementById('choiceModalBody').textContent = body;
  document.getElementById('choiceModalBody').classList.toggle('hidden', !body);
  const box = document.getElementById('choiceModalOptions');
  box.innerHTML = '';
  const TONE = {
    primary: 'border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-900',
    danger: 'border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900',
    plain: 'border-slate-300 bg-white hover:bg-slate-50 text-slate-800'
  };
  return new Promise(resolve => {
    const finish = v => {
      choiceDismissOpen = null;
      modal.classList.add('hidden'); modal.classList.remove('flex');
      document.getElementById('choiceModalCloseBtn').onclick = document.getElementById('choiceModalCancelBtn').onclick = null;
      resolve(v);
    };
    choices.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.value = c.value;
      b.className = `choice-option w-full text-left rounded-lg border px-3 py-2 cursor-pointer ${TONE[c.tone] || TONE.plain}`;
      const l = document.createElement('div'); l.className = 'text-[13px] font-bold'; l.textContent = c.label; b.appendChild(l);
      if (c.hint) { const h = document.createElement('div'); h.className = 'text-[12px] mt-0.5 opacity-80'; h.textContent = c.hint; b.appendChild(h); }
      b.onclick = () => finish(c.value);
      box.appendChild(b);
    });
    choiceDismissOpen = () => finish(null);
    document.getElementById('choiceModalCloseBtn').onclick = () => finish(null); // also Escape (modal handling in app.js)
    document.getElementById('choiceModalCancelBtn').onclick = () => finish(null);
    // One place to start (modalAccessibility in app.js focuses it as the dialog opens); the timer only covers a dialog that was
    // already open (a new question replacing the last), and does nothing when the focus is already there
    modal.dataset.focusId = 'choiceModalCancelBtn';
    modal.classList.remove('hidden'); modal.classList.add('flex');
    setTimeout(() => { const b = document.getElementById('choiceModalCancelBtn'); if (document.activeElement !== b) b.focus(); }, 20);
  });
}

// A message that must be read (an error, a long report): the choice dialog with one OK button, instead of alert()
function showNotice(title, body) { return askChoice({ title, body, choices: [], cancelLabel: 'OK' }); }

// Asks for the reason of a decision in a multi-line box (instead of prompt()). Resolves to the text ('' = no reason given),
// or null when cancelled. cancelLabel: null means the decision is already made and cannot be cancelled: the second button
// then records it without a reason. A text typed and then cancelled is kept as a draft for the same draftKey.
const reasonDrafts = new Map();
let reasonDismissOpen = null; // closes a dialog still open when a new question comes (its caller then goes on, not hangs)
// value: initial text; singleLine: a short entry (one line, Enter records), e.g. a reviewer ID or a label.
function askReason({ title = 'Why?', context = '', label = 'Why? (optional, saved in the Audit Trail)', confirmLabel = 'Record', cancelLabel = 'Cancel', draftKey = '', value = '', singleLine = false } = {}) {
  const modal = document.getElementById('reasonModal');
  const input = document.getElementById('reasonModalInput');
  const okBtn = document.getElementById('reasonModalConfirmBtn');
  const secBtn = document.getElementById('reasonModalSecondaryBtn');
  const closeBtn = document.getElementById('reasonModalCloseBtn');
  document.getElementById('reasonModalTitle').textContent = title;
  document.getElementById('reasonModalContext').textContent = context;
  document.getElementById('reasonModalContext').classList.toggle('hidden', !context);
  document.getElementById('reasonModalLabel').textContent = label;
  if (reasonDismissOpen) reasonDismissOpen();
  okBtn.textContent = confirmLabel;
  secBtn.textContent = cancelLabel === null ? 'Record without a reason' : cancelLabel;
  input.value = (draftKey && reasonDrafts.get(draftKey)) || value || '';
  input.rows = singleLine ? 1 : 5;
  input.classList.toggle('resize-y', !singleLine); input.classList.toggle('resize-none', singleLine);
  document.getElementById('reasonModalHint').classList.toggle('hidden', singleLine);
  return new Promise(resolve => {
    const finish = value => {
      reasonDismissOpen = null;
      if (draftKey) { if (value === null && input.value.trim()) reasonDrafts.set(draftKey, input.value); else reasonDrafts.delete(draftKey); }
      modal.classList.add('hidden'); modal.classList.remove('flex');
      okBtn.onclick = secBtn.onclick = closeBtn.onclick = input.onkeydown = null;
      resolve(value);
    };
    const dismiss = () => finish(cancelLabel === null ? '' : null);
    reasonDismissOpen = dismiss;
    okBtn.onclick = () => finish(input.value.trim());
    secBtn.onclick = () => finish(cancelLabel === null ? '' : null);
    closeBtn.onclick = dismiss; // also Escape (modal handling in app.js clicks the close button)
    input.onkeydown = e => { if (e.key === 'Enter' && (singleLine || e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(input.value.trim()); } };
    modal.dataset.focusId = input.id; // as askChoice: one place to start
    modal.classList.remove('hidden'); modal.classList.add('flex');
    setTimeout(() => { if (document.activeElement !== input) input.focus(); if (singleLine) input.select(); }, 20);
  });
}
