// Meta-Ethnography Canvas — Core
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// IndexedDB storage, auto-save status, app state, data normalisation and small shared helpers. Must load first.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// INDEXEDDB ENGINE (Singleton + Binary Store Separation)
// ========================================================
const DB_NAME = 'MetaEthnoCanvasDB'; 
const DB_VERSION = 6;
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
  if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
  if (status === 'saved') {
    saveBadgeTimer = setTimeout(() => badge.classList.add('opacity-75'), 2500);
  }
}

const pendingSaveCleanups = new Set();

function flushAllPendingSaves() {
  if (pendingSaveCleanups.size === 0) return;
  for (const flushFn of Array.from(pendingSaveCleanups)) {
    try { flushFn(); } catch (e) { console.error('Flush save error:', e); }
  }
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
      fn(...argsToRun);
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

window.addEventListener('beforeunload', () => {
  flushAllPendingSaves();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushAllPendingSaves();
  }
});

async function dbPut(store, item) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(item);
    tx.oncomplete = () => {
      if (store !== 'pdf_binaries') flashSaveStatus('saved');
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
async function dbDelete(store, key) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => { flashSaveStatus('saved'); resolve(); };
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
  reviewerId: localStorage.getItem('me_reviewer_id') || '',
  projectCode: localStorage.getItem('me_project_code') || '',
  teamMode: localStorage.getItem('me_team_mode') === 'true',
  logMinorOps: localStorage.getItem('me_log_minor_ops') === 'true',
  autoSeedIndex: localStorage.getItem('me_auto_seed_index') !== 'false',
  hiddenStudyIds: new Set((() => { try { return JSON.parse(localStorage.getItem('me_hidden_studies') || '[]'); } catch (e) { return []; } })()),
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
  const opts = { cMapUrl: PDFJS_BASE + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_BASE + 'standard_fonts/' };
  if (IS_FILE_PROTOCOL) Object.assign(opts, { useWorkerFetch: false, CMapReaderFactory: ScriptCMapReaderFactory, StandardFontDataFactory: ScriptStandardFontDataFactory });
  return opts;
}
let pageObserver = null;

function normalizeDoc(d) {
  if (typeof d.appraisalTool !== 'string' || !d.appraisalTool) d.appraisalTool = 'CASP';
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
  if (typeof a.concordanceStatus !== 'string') a.concordanceStatus = 'pending'; // 'pending' | 'discuss' | 'divergent' | 'agreed'
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

// Study #1 (index paper / earliest study) establishes the rows, so its constructs are not yet
// translated "into" anything: no reciprocal/refutational relation applies to them.
function isBaselineDocId(docId) { return state.docs.length > 0 && state.docs[0].id === docId; }
// How a study's construct relates to a row is a judgement, never a default (Noblit & Hare, Phase 4–5):
// 'unjudged' until the reviewer decides 'reciprocal' or 'refutational'.
const CELL_RELATIONS = ['unjudged', 'reciprocal', 'refutational'];
function cellRelationOf(sec, cid) {
  if (isBaselineDocId(sec.docId)) return 'baseline';
  const r = sec.clusterRelations && sec.clusterRelations[cid];
  return (r === 'reciprocal' || r === 'refutational') ? r : 'unjudged';
}
function isSecRefutational(sec, cid) { return cellRelationOf(sec, cid) === 'refutational'; }
const CELL_REL_SYMBOL = { baseline: '◆', reciprocal: '●', refutational: '⚡', unjudged: '?' };
// Symbol for a study's contribution to a row (Table 2b, grid exports)
function contribSymbol(docSecs, cid) {
  if (docSecs.length && isBaselineDocId(docSecs[0].docId)) return '◆';
  return ['reciprocal', 'refutational', 'unjudged']
    .filter(r => docSecs.some(sc => cellRelationOf(sc, cid) === r))
    .map(r => CELL_REL_SYMBOL[r]).join(' / ');
}

// ---- Empty cells: a study with no construct in a row is not one thing ----
// Absent entry = not yet checked; 'silent' = the account was re-read and does not address the concept;
// 'na' = the concept lies outside this study's scope / population, so silence is not informative.
const EMPTY_CELL_META = {
  unchecked: { label: 'Not yet checked', sym: '' },
  silent: { label: 'Checked: not addressed (silence)', sym: '○' },
  na: { label: 'Checked: outside this study\'s scope', sym: '–' }
};
function emptyCellStatus(cluster, docId) {
  const e = cluster.emptyCells && cluster.emptyCells[docId];
  return (e && EMPTY_CELL_META[e.status]) ? e : { status: 'unchecked', note: '' };
}

// Row-level relations are derived from the cells (a relation is between studies, not a property of a theme)
function rowRelationCounts(cluster) {
  const counts = { reciprocal: 0, refutational: 0, unjudged: 0, silent: 0, na: 0, unchecked: 0, baseline: 0 };
  state.docs.forEach(doc => {
    const secs = state.annotations.filter(a => a.type === 'second_order' && a.docId === doc.id && Array.isArray(a.clusterIds) && a.clusterIds.includes(cluster.id));
    if (secs.length === 0) { counts[emptyCellStatus(cluster, doc.id).status]++; return; }
    if (isBaselineDocId(doc.id)) { counts.baseline++; return; }
    const rels = new Set(secs.map(s => cellRelationOf(s, cluster.id)));
    ['reciprocal', 'refutational', 'unjudged'].forEach(r => { if (rels.has(r)) counts[r]++; });
  });
  return counts;
}
function rowRelationSummary(cluster) {
  const c = rowRelationCounts(cluster);
  const parts = [];
  if (c.baseline) parts.push('◆ index/first study');
  if (c.reciprocal) parts.push(`● ${c.reciprocal} reciprocal`);
  if (c.refutational) parts.push(`⚡ ${c.refutational} refutational`);
  if (c.unjudged) parts.push(`? ${c.unjudged} not yet judged`);
  if (c.silent) parts.push(`○ ${c.silent} silent`);
  if (c.na) parts.push(`– ${c.na} out of scope`);
  if (c.unchecked) parts.push(`${c.unchecked} not yet checked`);
  return parts.join(' · ') || '-';
}
function rowHasRefutation(cluster) { return rowRelationCounts(cluster).refutational > 0; }

// A row opened by a construct from a study other than #1: the concept was not in the first study
function rowOriginDoc(cluster) {
  return cluster.originDocId ? state.docs.find(d => d.id === cluster.originDocId) || null : null;
}

function getCellRelationMeta(rel) {
  if (rel === 'baseline') {
    return {
      label: '◆ Baseline',
      cardCls: 'bg-amber-50/40 border-amber-200',
      badgeCls: 'bg-amber-100 text-amber-800 border-amber-300',
      quoteBorderCls: 'border-amber-100',
      dividerCls: 'border-amber-100'
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
  if (rel === 'reciprocal') {
    return {
      label: '🤝 Reciprocal',
      cardCls: 'bg-emerald-50/40 border-emerald-200',
      badgeCls: 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200',
      quoteBorderCls: 'border-emerald-100',
      dividerCls: 'border-emerald-100'
    };
  }
  return {
    label: '? Not yet judged',
    cardCls: 'bg-white border-slate-300 border-dashed',
    badgeCls: 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200',
    quoteBorderCls: 'border-slate-100',
    dividerCls: 'border-slate-200'
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
  if (!c.emptyCells || typeof c.emptyCells !== 'object') c.emptyCells = {}; // { [docId]: { status: 'silent'|'na', note } }
  if (typeof c.originDocId !== 'string') c.originDocId = '';             // study whose construct opened the row (if not #1)
  delete c.translationType;                                              // relations live on the cells (see rowRelationSummary)
  if (typeof c.translationSummary !== 'string') c.translationSummary = ''; // Step A (Phase 5): how the studies' concepts translate into one another
  if (typeof c.synthesisNote !== 'string') c.synthesisNote = '';           // Step B: the reviewer's 3rd order construct (definition & interpretation)
  ['cerqualLimNote', 'cerqualCohNote', 'cerqualAdeqNote', 'cerqualRelNote'].forEach(k => { if (typeof c[k] !== 'string') c[k] = ''; });
  return c;
}

function getConcordanceBadgeMeta(status) {
  if (status === 'agreed') return { label: '✅ Agreed', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  if (status === 'divergent') return { label: '↔ Divergent (kept)', cls: 'bg-violet-100 text-violet-800 border-violet-300' };
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

function showSnackbar(message) {
  const snackbar = document.getElementById('snackbar');
  if(snackbar) {
    snackbar.textContent = message;
    snackbar.classList.remove('opacity-0');
    setTimeout(() => {
      snackbar.classList.add('opacity-0');
    }, 3000);
  }
}
