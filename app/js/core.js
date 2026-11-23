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
  return data;
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

function createDebouncedSaver(fn, delay = 350) {
  let timer = null;
  let latestArgs = null;
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      pendingSaveCleanups.delete(flush);
      const argsToRun = latestArgs || [];
      latestArgs = null;
      return fn(...argsToRun);
    }
  };
  const debounced = (...args) => {
    latestArgs = args;
    flashSaveStatus('saving');
    if (timer) clearTimeout(timer);
    pendingSaveCleanups.add(flush);
    timer = setTimeout(() => {
      timer = null;
      pendingSaveCleanups.delete(flush);
      const argsToRun = latestArgs || [];
      latestArgs = null;
      fn(...argsToRun);
    }, delay);
  };
  debounced.flush = flush;
  return debounced;
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
  el.addEventListener('change', run);
  el.addEventListener('blur', run);
  return run;
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

// quiet: bookkeeping writes the user did not make (e.g. a PDF fingerprint) — no save badge, no backup reminder
async function dbPut(store, item, { quiet = false } = {}) {
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
    tx.onerror = () => { flashSaveStatus('error'); reject(tx.error); };
    tx.onabort = () => { flashSaveStatus('error'); reject(tx.error || new Error('IndexedDB transaction aborted')); };
  });
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
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => { flashSaveStatus('saved'); markUnbackedChange(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClear(store) {
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
  loa: { id: 'loa_main', projectCode: '', aim: '', title: '', flow: '', narrative: '', relateProcess: '', relateOutcome: '', synthStudies: '', appraisalPolicy: '', appraisalUse: '', links: [], updatedAt: null },
  activeDocId: null,
  activePdfDoc: null,
  scale: 1.3,
  pendingSelection: null,
  isEditMetaMode: false,
  showContextRow: true,
  isLoaOpen: false,
  clusterActiveTabs: {}, // { [clusterId]: 'synthesis' | 'cerqual' | 'concordance' }
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
// Quotes linked to any of the given constructs, each counted once (a quote may illustrate several constructs)
function uniqueQuotesOf(secs) {
  const seen = new Set(), out = [];
  secs.forEach(s => quotesOf(s.id).forEach(f => { if (!seen.has(f.id)) { seen.add(f.id); out.push(f); } }));
  return out;
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

// Asks for the reason of a decision in a multi-line box (instead of prompt()). Resolves to the text ('' = no reason given),
// or null when cancelled. cancelLabel: null means the decision is already made and cannot be cancelled: the second button
// then records it without a reason. A text typed and then cancelled is kept as a draft for the same draftKey.
const reasonDrafts = new Map();
function askReason({ title = 'Why?', context = '', label = 'Why? (optional, saved in the Audit Trail)', confirmLabel = 'Record', cancelLabel = 'Cancel', draftKey = '' } = {}) {
  const modal = document.getElementById('reasonModal');
  const input = document.getElementById('reasonModalInput');
  const okBtn = document.getElementById('reasonModalConfirmBtn');
  const secBtn = document.getElementById('reasonModalSecondaryBtn');
  const closeBtn = document.getElementById('reasonModalCloseBtn');
  document.getElementById('reasonModalTitle').textContent = title;
  document.getElementById('reasonModalContext').textContent = context;
  document.getElementById('reasonModalContext').classList.toggle('hidden', !context);
  document.getElementById('reasonModalLabel').textContent = label;
  okBtn.textContent = confirmLabel;
  secBtn.textContent = cancelLabel === null ? 'Record without a reason' : cancelLabel;
  input.value = (draftKey && reasonDrafts.get(draftKey)) || '';
  return new Promise(resolve => {
    const finish = value => {
      if (draftKey) { if (value === null && input.value.trim()) reasonDrafts.set(draftKey, input.value); else reasonDrafts.delete(draftKey); }
      modal.classList.add('hidden'); modal.classList.remove('flex');
      okBtn.onclick = secBtn.onclick = closeBtn.onclick = input.onkeydown = null;
      resolve(value);
    };
    const dismiss = () => finish(cancelLabel === null ? '' : null);
    okBtn.onclick = () => finish(input.value.trim());
    secBtn.onclick = () => finish(cancelLabel === null ? '' : null);
    closeBtn.onclick = dismiss; // also Escape (modal handling in app.js clicks the close button)
    input.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(input.value.trim()); } };
    modal.classList.remove('hidden'); modal.classList.add('flex');
    setTimeout(() => input.focus(), 20);
  });
}
