// Meta-Ethnography Canvas — Studies & PDF viewer
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// PDF import, translation order, study list, study details / appraisal dock, PDF rendering, text selection, highlights, PDF search, citation auto-fill, study sorting, right sidebar resizer.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// PDF IMPORT & STUDY MANAGEMENT (With Binary Re-linking)
// ========================================================
document.getElementById('addPdfBtn').addEventListener('click', () => document.getElementById('pdfFileInput').click());
document.getElementById('pdfFileInput').addEventListener('change', async (e) => {
  if (e.target.files.length > 0) await handleFiles(Array.from(e.target.files));
  e.target.value = '';
});

// Stores a PDF file for an existing study record (e.g. one restored from a backup). buffer / sha: when the caller has already
// read the file and found it identical to the study's recorded fingerprint, it is not read or fingerprinted again.
async function attachPdfFileToDoc(doc, file, { buffer = null, sha = '' } = {}) {
  const data = buffer || await file.arrayBuffer();
  doc.hasBinary = true;
  const sameFile = !!sha && sha === doc.sha256;
  // Another file (or one not checked yet): its fingerprint is worked out again from the file itself, so an old one (e.g. from a
  // backup) never stands for it. The DOI stays: it describes the study (and may have been entered by hand), not the file.
  if (!sameFile) { doc.fpDone = false; doc.sha256 = ''; }
  await commitOps([{ store: 'pdf_binaries', put: { id: doc.id, data } }, { store: 'docs', put: doc }]); // the PDF and its study together
  if (pdfSearchState.docId === doc.id) Object.assign(pdfSearchState, { docId: null, pageTexts: [] }); // its text index was the old file's
  ensureDocFingerprints(); // only studies not yet fingerprinted are read (e.g. one whose DOI was never looked for)
}

// ---- Study fingerprints: recognise the same paper in a co-reviewer's file, whatever it is called ----
// sha256 = identical file; doi = same article even if downloaded from another source. Computed once per PDF, in the background.
function normalizeDoi(s) {
  const m = String(s || '').match(/10\.\d{4,9}\/[^\s"'<>]+/i);
  return m ? m[0].replace(/[.,;:)\]}]+$/, '').toLowerCase() : '';
}
async function sha256Hex(buffer) {
  try {
    if (!(window.crypto && crypto.subtle)) return '';
    const h = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return ''; }
}
// The article's own DOI: PDF metadata first, then page 1 only (later pages hold the DOIs of cited works)
async function findDoiInPdf(buffer) {
  if (typeof pdfjsLib === 'undefined') return '';
  let pdf = null;
  try {
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)), ...pdfjsDocumentOptions() }).promise;
    try {
      const meta = await pdf.getMetadata();
      const xmp = meta && meta.metadata;
      const cands = [xmp && xmp.get('prism:doi'), xmp && xmp.get('dc:identifier'), meta && meta.info && meta.info.doi, meta && meta.info && meta.info.Subject];
      for (const c of cands) { const d = normalizeDoi(Array.isArray(c) ? c.join(' ') : c); if (d) return d; }
    } catch (e) { /* no metadata */ }
    const page = await pdf.getPage(1);
    const tc = await page.getTextContent();
    return normalizeDoi(tc.items.map(i => i.str).join(' ').replace(/doi\s*:\s*/gi, ' ').replace(/(10\.\d{4,9})\s*\/\s*/g, '$1/'));
  } catch (e) {
    return '';
  } finally {
    if (pdf) { try { await pdf.destroy(); } catch (e) { /* ignore */ } }
  }
}
// One run at a time; a study added while it runs is picked up by the same run (the next study to do is looked up after each one)
let fingerprintBusy = false;
async function ensureDocFingerprints() {
  if (fingerprintBusy) return;
  fingerprintBusy = true;
  const tried = new Set();
  try {
    let d;
    while ((d = state.docs.find(x => x.hasBinary && !x.fpDone && !tried.has(x.id)))) {
      tried.add(d.id);
      try {
        const rec = await dbGet('pdf_binaries', d.id); // one PDF in memory at a time
        if (!rec || !rec.data || !rec.data.byteLength) continue;
        const sha256 = await sha256Hex(rec.data);
        const doi = d.doi || await findDoiInPdf(rec.data);
        // The study's info dock open on it with an empty DOI box: the box shows it, so "Save Info" keeps it
        const box = document.getElementById('metaDoi');
        if (doi && !d.doi && state.isEditMetaMode && state.activeDocId === d.id && box && !box.value.trim()) box.value = doi;
        // Bookkeeping (no save badge, no backup reminder); a study deleted meanwhile is not written back
        if (state.docs.includes(d)) await commitOps([{ store: 'docs', put: { ...d, sha256, doi, fpDone: true } }], { quiet: true });
      } catch (e) { console.warn('Fingerprinting skipped for one study:', e); }
    }
  } finally {
    fingerprintBusy = false;
  }
}

async function handleFiles(files) {
  let lastAffectedId = null;
  // While the "reconnect your PDFs" window is open, only reconnect files by name; unmatched files are reported, not added as new studies
  const reconnectModal = document.getElementById('missingPdfModal');
  const reconnectMode = !!reconnectModal && !reconnectModal.classList.contains('hidden');
  const unmatched = [];
  for (const file of files) {
    // A study without its PDF (e.g. after a JSON restore) is reconnected by file name, or, if the file was renamed,
    // by its fingerprint: the backup keeps each study's SHA-256, so the identical file is recognised whatever it is called.
    let existingStub = state.docs.find(d => d.name && d.name.toLowerCase() === file.name.toLowerCase() && !d.hasBinary);
    let buffer = null, sha = '';
    if (!existingStub && state.docs.some(d => !d.hasBinary && d.sha256)) {
      buffer = await file.arrayBuffer();
      sha = await sha256Hex(buffer);
      if (sha) existingStub = state.docs.find(d => !d.hasBinary && d.sha256 === sha) || null;
    }
    if (!existingStub && reconnectMode) { unmatched.push(file); continue; }
    if (existingStub) {
      await attachPdfFileToDoc(existingStub, file, { buffer, sha });
      lastAffectedId = existingStub.id;
      continue;
    }
    // The same PDF dropped again (same file name, or the identical file under another name): ask before adding a second study
    let dup = state.docs.find(d => d.hasBinary && d.name && d.name.toLowerCase() === file.name.toLowerCase());
    if (!dup && state.docs.some(d => d.hasBinary && d.sha256)) {
      if (!buffer) buffer = await file.arrayBuffer();
      if (!sha) sha = await sha256Hex(buffer);
      if (sha) dup = state.docs.find(d => d.hasBinary && d.sha256 === sha);
    }
    if (dup) {
      const add = await askChoice({
        title: 'This PDF is already in the project',
        body: `"${file.name}" ${dup.name && dup.name.toLowerCase() === file.name.toLowerCase() ? 'has the same file name as' : 'is the identical file of'} ${getDisplayName(dup)}.`,
        choices: [{ value: 'add', tone: 'plain', label: 'Add it as another study anyway', hint: 'For example, a different paper that happens to have the same file name.' }],
        cancelLabel: 'Skip this file'
      });
      if (!add) continue;
    }
    if (!buffer) buffer = await file.arrayBuffer();

    const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const doc = normalizeDoc({
      id: docId,
      name: file.name,
      hasBinary: true,
      author: '',
      etAl: true,
      year: '',
      title: '',
      setting: '',
      participants: '',
      methodology: '',
      appraisalTool: 'CASP',
      quality: '',
      richness: '',
      contextNote: '',
      studyOverview: '',
      order: state.docs.length,
      addedAt: new Date().toISOString()
    });
    // The PDF and its study in one transaction: a failure part way leaves no PDF without a study
    await commitOps([{ store: 'pdf_binaries', put: { id: docId, data: buffer } }, { store: 'docs', put: doc }]); // (adds it to state.docs)
    lastAffectedId = doc.id;
  }
  if (!state.loa.baselineDocId) await checkBaselineChange(); // the first study added becomes #1
  ensureDocFingerprints();
  renderStudyList();
  if (typeof refreshMissingPdfModal === 'function') refreshMissingPdfModal(unmatched);
  if (lastAffectedId) switchStudy(lastAffectedId);
}

// ---- Translation-order strategy (Index paper vs chronological vs other; cf. Atkins et al., 2008) ----
const ORDER_STRATEGIES = {
  index: { label: 'Index paper first', badge: 'Index', long: 'Index Paper', short: '[Index Paper]' },
  chronological: { label: 'Chronological', badge: '#1 · Earliest', long: '#1 (chronological order)', short: '[#1, chronological]' },
  other: { label: 'Other', badge: '#1', long: 'Study #1', short: '[#1]' }
};
function getOrderStrategy() {
  const v = state.loa && state.loa.orderStrategy;
  return ORDER_STRATEGIES[v] ? v : 'index';
}
function firstStudyMeta() { return ORDER_STRATEGIES[getOrderStrategy()]; }
async function setOrderStrategy(next, { rationale = '', reason = '' } = {}) {
  if (!ORDER_STRATEGIES[next]) return;
  const labels = Object.fromEntries(Object.entries(ORDER_STRATEGIES).map(([k, v]) => [k, v.label]));
  if (!(await runOperation(opOrderStrategy(state, { next, rationale, reason, labels })))) return;
  const sel = document.getElementById('orderStrategySelect');
  if (sel) sel.value = next;
  renderStudyList();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  if (!divPub.classList.contains('hidden')) renderPublicationView();
}
document.getElementById('orderStrategySelect')?.addEventListener('change', async (e) => {
  const next = e.target.value;
  const why = await askReason({
    title: `Translation order: ${ORDER_STRATEGIES[next].label}`,
    context: `From "${ORDER_STRATEGIES[getOrderStrategy()].label}" to "${ORDER_STRATEGIES[next].label}". The reason is also used in the Methods Summary.`,
    label: 'Why this order? (optional, saved in the Audit Trail)',
    confirmLabel: 'Change order', draftKey: 'order-strategy'
  });
  if (why === null) { e.target.value = getOrderStrategy(); return; } // cancelled: nothing changed
  await setOrderStrategy(next, { rationale: why });
});

function getDisplayName(doc) {
  if (!doc) return 'Unknown Study';
  if (doc.author || doc.year) {
    const etAlStr = (doc.etAl !== false && doc.author) ? " et al." : "";
    const a = doc.author ? doc.author + etAlStr : "Unknown";
    const y = doc.year ? ` (${doc.year})` : "";
    return a + y;
  }
  return doc.name;
}

// The display name of the study a record (a quote, a construct) belongs to
function studyNameOf(rec) { return getDisplayName(state.docs.find(d => d.id === (rec && rec.docId))); }

function getAppraisalDisplayString(doc) {
  if (!doc) return '-';
  normalizeDoc(doc);
  if (!doc.quality) return '-';
  const tool = doc.appraisalTool || 'CASP';
  const q = doc.quality || 'Appraised';
  return `${tool}: ${q}`;
}

function getBadgesHtml(doc) {
  normalizeDoc(doc);
  let html = '';
  if (doc.quality) {
    const tool = doc.appraisalTool || 'CASP';
    const qColor = doc.quality === 'High' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                   doc.quality === 'Moderate' ? 'bg-amber-100 text-amber-800 border-amber-200' :
                   doc.quality === 'Low' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-slate-100 text-slate-700 border-slate-200';
    html += `<span class="text-[11px] px-1.5 py-px rounded border font-semibold ${qColor}" title="Critical Appraisal (${escapeHtml(tool)})">${escapeHtml(tool)}: ${escapeHtml(doc.quality)}</span>`;
  }
  if (doc.richness) {
    const rColor = doc.richness === 'Rich' ? 'bg-indigo-100 text-indigo-800 border-indigo-200' :
                   doc.richness === 'Moderate' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200';
    html += `<span class="text-[11px] px-1.5 py-px rounded border font-semibold ${rColor}" title="Conceptual Depth (Richness)">${escapeHtml(doc.richness)}</span>`;
  }
  return html;
}

// The studies in the order of `list` (a copy of state.docs, reordered), with the audit entries about it and any other writes
// (extraOps), in one transaction; state.docs follows once stored. Then study #1 is checked (checkBaselineChange).
// Only the studies whose number changes are written.
/** @param {any[]} [list] @param {any} [entries] @param {DbOp[]} [extraOps] */
// entries: audit entries already built (auditEntry; one or a list), stored with the order
async function persistDocOrder(list = state.docs, entries = [], extraOps = []) {
  const { ops } = opStudyOrder(state, { ids: list.map(d => d.id), extraOps });
  await saveChange(ops, entries);
  sortStudies(state.docs);
  await checkBaselineChange();
}

// ---- Study #1 is where translation starts: when it changes, rows established by the former #1 have to be re-read ----
// The #1 study is remembered in the project (loa.baselineDocId), so every path that reorders, deletes or restores studies is
// covered (opBaselineCheck, logic.js). Only remembering it (the first study, or a new name) is bookkeeping: no backup reminder.
async function checkBaselineChange() {
  const r = opBaselineCheck(state, OP_NAMES);
  if (!r) return;
  if (r.quiet) { await commitOps(r.ops, { quiet: true }); return; }
  await runOperation(r);
  if (r.affected) showSnackbar(`Study #1 changed: ${r.affected} row(s) marked for re-reading in the Synthesis Matrix.`);
}

async function moveStudyOrder(fromIdx, toIdx) {
  if (toIdx < 0 || toIdx >= state.docs.length || fromIdx === toIdx) return;
  // The new order on a copy; asked about first (a change of #1), then stored with its entry
  const list = state.docs.slice();
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  const oldIndexPaper = getDisplayName(state.docs[0]);
  const newIndexPaper = getDisplayName(list[0]);
  let entry;
  if (state.docs[0].id !== list[0].id) { // by id: two studies can share a display name (Smith et al. 2020)
    const idxWhy = await askReason({
      title: `The #1 study (${firstStudyMeta().long}) has changed`,
      context: `From ${oldIndexPaper} to ${newIndexPaper}. Rows established by study #1 are marked for re-reading.`,
      label: 'Why this study first? (optional, saved in the Audit Trail as the rationale)',
      cancelLabel: null
    });
    entry = auditEntry({
      kind: 'study_order',
      category: 'study_order',
      rationale: idxWhy,
      action: `Changed the #1 Study (${firstStudyMeta().long})`,
      detail: `Reordered "${getDisplayName(moved)}" from position #${fromIdx + 1} to #${toIdx + 1}.`,
      fromVal: `#1: ${oldIndexPaper}`,
      toVal: `#1: ${newIndexPaper}`
    });
  } else {
    entry = auditEntry({
      kind: 'study_order',
      category: 'study_order',
      action: 'Reordered Study Sequence for Translation',
      detail: `Moved "${getDisplayName(moved)}" from #${fromIdx + 1} to #${toIdx + 1}.`
    });
  }
  await persistDocOrder(list, entry);

  renderStudyList();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
}

function renderStudyList() {
  const list = document.getElementById('studyList');
  list.innerHTML = '';
  document.getElementById('studiesCount').textContent = String(state.docs.length);

  if (state.docs.length === 0) {
    list.innerHTML = `
      <div class="p-4 text-center text-[13px] text-slate-400 border border-dashed border-slate-200 rounded-lg my-2 space-y-1">
        <i class="ph ph-files text-xl text-slate-300"></i>
        <div class="font-semibold text-slate-500">No studies yet</div>
        <div>Click <b>+ Add PDF</b> or drop PDFs anywhere to start.</div>
      </div>
    `;
    return;
  }

  state.docs.forEach((doc, idx) => {
    const isActive = doc.id === state.activeDocId;
    const isIndexPaper = idx === 0;
    const dName = getDisplayName(doc);
    const item = document.createElement('div');
    item.className = `p-2 rounded-lg flex items-start justify-between cursor-grab active:cursor-grabbing text-xs border transition ${isActive ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-bold shadow-sm' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`;
    item.draggable = true;

    item.ondragstart = e => e.dataTransfer.setData('text/study-idx', String(idx));
    item.ondragover = e => {
      if (e.dataTransfer.types.includes('text/study-idx')) {
        e.preventDefault();
        item.classList.add('study-drag-over');
      }
    };
    item.ondragleave = () => item.classList.remove('study-drag-over');
    item.ondrop = async e => {
      e.preventDefault();
      item.classList.remove('study-drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/study-idx'), 10);
      if (!isNaN(fromIdx)) await moveStudyOrder(fromIdx, idx);
    };

    const badges = getBadgesHtml(doc);
    item.innerHTML = `
      <div class="truncate pr-1.5 flex-1">
        <div class="flex items-center space-x-1">
          <i class="ph ph-dots-six-vertical text-slate-400 shrink-0"></i>
          ${isIndexPaper ? `<span class="text-[11px] bg-amber-500 text-white px-1 py-px rounded font-bold uppercase shrink-0" title="First column in Synthesis Matrix (${escapeHtml(firstStudyMeta().label)})">${escapeHtml(firstStudyMeta().badge)}</span>` : ''}
          <span class="truncate">${escapeHtml(dName)}</span>
        </div>
        ${doc.setting ? `<div class="text-xs text-slate-500 font-normal truncate mt-0.5 pl-4"><i class="ph ph-map-pin mr-0.5"></i>${escapeHtml(doc.setting)}</div>` : ''}
        ${badges ? `<div class="flex flex-wrap gap-1 mt-1 pl-4">${badges}</div>` : ''}
      </div>
      <button data-action="study-remove" data-doc="${escapeHtml(doc.id)}" class="del text-slate-400 hover:text-rose-500 px-1 shrink-0 cursor-pointer" title="Delete this study"><i class="ph ph-trash"></i></button>
    `;

    item.addEventListener('click', (e) => { if (!e.target.closest('.del')) switchStudy(doc.id); });
    list.appendChild(item);
  });
}

// Removing a study from the synthesis (the study list's 🗑): one dialog for the decision and its reason; undoable (Ctrl+Z),
// with its PDF, constructs and references (opRemoveStudy, logic.js)
async function removeStudyWithReason(doc) {
  const idx = state.docs.indexOf(doc);
  if (idx < 0) return;
  const nExtracted = state.annotations.filter(a => a.docId === doc.id).length;
  // One dialog: the decision and its reason (removing a study from the synthesis is an interpretive decision)
  const why = await askReason({
    title: `Remove ${getDisplayName(doc)} from the synthesis?`,
    context: `The study and its ${nExtracted} extracted construct(s)/quote(s) are deleted${idx === 0 ? ', and the next study becomes #1' : ''}. The removal is recorded in the Audit Trail; Ctrl+Z undoes it.`,
    label: 'Why is this study being removed? (optional, saved in the Audit Trail as the rationale)',
    confirmLabel: 'Remove study', draftKey: 'remove-study-' + doc.id
  });
  if (why !== null) {
    await flushAllPendingSaves(); // nothing of the study still waiting to be saved lands after the deletion
    const binRec = await dbGet('pdf_binaries', doc.id);
    const toDel = state.annotations.filter(a => a.docId === doc.id).map(a => JSON.parse(JSON.stringify(a)));
    // The study, its PDF, its constructs, the references to it (empty-cell records, "same primary study as") and the
    // entry go in one transaction (opRemoveStudy, logic.js); the records in memory change once all of it is stored
    const removal = opRemoveStudy(state, { docId: doc.id, why }, OP_NAMES);
    const refs = removal.refs;
    await runOperation(removal);
    // On the undo stack only once it is stored (a refused write leaves the study, and nothing to undo)
    pushUndoAction({
      type: 'delete_study',
      label: `Study (${getDisplayName(doc)})`,
      doc: JSON.parse(JSON.stringify(doc)),
      binary: binRec && binRec.data ? binRec.data : null,
      annotations: toDel,
      position: idx,
      cellStatus: refs.cellStatus, companions: refs.companions
    });
    await persistDocOrder(); // after the removal's entry: a change of #1 it causes is logged after it
    if (state.activeDocId === doc.id) state.activeDocId = state.docs[0]?.id || null;
    showUndoSnackbar(`Removed ${getDisplayName(doc)}`);
    renderStudyList();
    if (state.activeDocId) switchStudy(state.activeDocId);
    else {
      await closeActivePdf(); // the last study went: its PDF is let go, not only hidden behind the welcome guide
      renderWelcomeGuideIfNeeded();
      updateDocHeaderUI();
      updateSidebar();
    }
  }
}
// The study list's buttons that change data carry data-action; one listener on the list runs them
(() => {
  const list = document.getElementById('studyList');
  if (!list) return;
  list.addEventListener('click', ev => {
    const el = ev.target && ev.target.closest && ev.target.closest('[data-action="study-remove"]');
    if (!el || !list.contains(el)) return;
    ev.stopPropagation();
    const doc = state.docs.find(d => d.id === el.dataset.doc);
    if (doc) removeStudyWithReason(doc).catch(err => console.error('Removing the study failed:', err));
  });
})();

// Page placeholders at the current zoom, observed for lazy rendering. Used when a study opens and when the zoom changes
// (the PDF stays loaded: a new zoom only lays the pages out again).
async function layoutPdfPages(loadedPdf, isStale) {
  const wrapper = document.getElementById('pdfPagesWrapper');
  if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
  const numPages = loadedPdf.numPages;
  document.getElementById('pdfPageCountLabel').textContent = `${numPages} page${numPages > 1 ? 's' : ''}`;
  document.getElementById('zoomPercentInput').value = Math.round(state.scale * 100);

  // Fetch exact per-page viewport dimensions in parallel so landscape/portrait pages size accurately
  const pageViewports = await Promise.all(
    Array.from({ length: numPages }, (_, idx) =>
      loadedPdf.getPage(idx + 1).then(p => p.getViewport({ scale: state.scale }))
    )
  );
  if (isStale()) return false;
  wrapper.innerHTML = '';

  const scrollRoot = document.getElementById('pdfViewerContainer');
  pageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const container = entry.target;
      const pageNum = parseInt(container.dataset.p, 10);
      if (entry.isIntersecting) {
        if (!container.dataset.rendered && !container.dataset.rendering) {
          renderPageContent(container, pageNum);
        }
        // Memory guard: evict rendered canvases more than 10 pages away from current view
        const allPages = wrapper.querySelectorAll('.page-container[data-rendered="true"]');
        if (allPages.length > 16) {
          allPages.forEach(other => {
            const otherNum = parseInt(other.dataset.p, 10);
            if (Math.abs(otherNum - pageNum) > 10) {
              evictPageContent(other, otherNum);
            }
          });
        }
      }
    });
  }, {
    root: scrollRoot,
    rootMargin: '600px 0px 600px 0px',
    threshold: 0.01
  });

  for (let i = 1; i <= numPages; i++) {
    const vp = pageViewports[i - 1];
    const container = createPagePlaceholder(i, vp.width, vp.height);
    wrapper.appendChild(container);
    pageObserver.observe(container);
  }

  return true;
}

let switchStudyToken = 0;
async function switchStudy(id) {
  // Each call gets a token, taken BEFORE any wait: an older call that resumes after a newer one started simply stops
  // (prevents duplicated pages on rapid clicks / zoom, and an earlier click winning over a later one)
  const myToken = ++switchStudyToken;
  const isStale = () => myToken !== switchStudyToken;
  // What was typed for the study being left is saved (and logged) before the next one opens
  await flushAllPendingSaves();
  if (isStale()) return;
  const doc = state.docs.find(d => d.id === id);
  if (!doc) return;
  state.activeDocId = id;
  renderStudyList();
  updateDocHeaderUI();
  populateMetaEditInputs();
  resetPdfSearchResults(); // the hits shown were the other paper's

  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }
  if (state.activePdfDoc) {
    try { await state.activePdfDoc.destroy(); } catch (e) {}
    state.activePdfDoc = null;
  }

  const wrapper = document.getElementById('pdfPagesWrapper');
  wrapper.innerHTML = '<div class="py-10 text-xs text-slate-500">Loading PDF...</div>';
  try {
    const binRecord = await dbGet('pdf_binaries', doc.id);
    if (isStale()) return;
    const pdfArrayBuffer = binRecord?.data;

    if (!pdfArrayBuffer || pdfArrayBuffer.byteLength === 0) {
      doc.hasBinary = false;
      wrapper.innerHTML = `<div class="py-10 text-xs text-amber-700 bg-amber-50 px-5 py-4 rounded-lg border border-amber-200 max-w-md text-center"><b>PDF file not loaded yet</b> (Restored from backup).<br>Drop or add <code>${escapeHtml(doc.name)}</code> to view the PDF with all your saved highlights.</div>`;
      updateSidebar();
      return;
    }
    // Full multilingual / UTF-8 CMap & Standard Font support across all scripts (CJK, Arabic, Cyrillic, Accented Latin, etc.)
    const loadedPdf = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfArrayBuffer.slice(0)),
      ...pdfjsDocumentOptions(),
      enableXfa: false
    }).promise;
    if (isStale()) { try { await loadedPdf.destroy(); } catch (e) {} return; }
    state.activePdfDoc = loadedPdf;
    wrapper.innerHTML = '';

    if (!(await layoutPdfPages(loadedPdf, isStale))) return;
    renderHighlights();
    updateSidebar();
  } catch (err) {
    if (isStale()) return;
    console.error(err);
    wrapper.innerHTML = '<div class="py-10 text-xs text-rose-500">Error rendering PDF.</div>';
  }
}

const ZOOM_PRESETS = [50, 75, 90, 100, 115, 130, 150, 175, 200, 250, 300];

function syncZoomSelectUI(pct) {
  const sel = document.getElementById('zoomPercentInput');
  if (!sel) return;
  const strVal = String(Math.round(pct));
  if (!Array.from(sel.options).some(o => o.value === strVal)) {
    const opt = document.createElement('option');
    opt.value = strVal;
    opt.textContent = strVal + '%';
    sel.appendChild(opt);
  }
  sel.value = strVal;
}

async function setPdfZoom(newScale) {
  const clamped = Math.max(0.5, Math.min(3.0, Math.round(newScale * 100) / 100));
  syncZoomSelectUI(clamped * 100);
  if (clamped === state.scale) return;
  state.scale = clamped;
  if (!state.activeDocId) return;
  const scrollContainer = document.getElementById('pdfViewerContainer');
  const scrollRatio = scrollContainer.scrollHeight > 0 ? scrollContainer.scrollTop / scrollContainer.scrollHeight : 0;
  if (state.activePdfDoc) {
    // Same PDF, new size: lay the pages out again without reading and parsing the file again
    const myToken = ++switchStudyToken;
    if (!(await layoutPdfPages(state.activePdfDoc, () => myToken !== switchStudyToken))) return; // another study opened meanwhile: its place is its own
    renderHighlights();
  } else {
    const docId = state.activeDocId;
    await switchStudy(docId);
    if (state.activeDocId !== docId) return;
  }
  scrollContainer.scrollTop = scrollContainer.scrollHeight * scrollRatio;
}

document.getElementById('zoomInBtn').addEventListener('click', () => {
  const curPct = Math.round(state.scale * 100);
  const nextPct = ZOOM_PRESETS.find(p => p > curPct) || ZOOM_PRESETS[ZOOM_PRESETS.length - 1];
  setPdfZoom(nextPct / 100);
});
document.getElementById('zoomOutBtn').addEventListener('click', () => {
  const curPct = Math.round(state.scale * 100);
  const prevPct = [...ZOOM_PRESETS].reverse().find(p => p < curPct) || ZOOM_PRESETS[0];
  setPdfZoom(prevPct / 100);
});
document.getElementById('zoomResetBtn').addEventListener('click', () => setPdfZoom(1.3));
document.getElementById('zoomPercentInput').addEventListener('change', (e) => {
  const val = parseFloat(e.target.value);
  if (!isNaN(val) && val >= 50 && val <= 300) {
    setPdfZoom(val / 100);
  }
});

async function jumpToPdfAnnotation(annoId, pageOverride = null) {
  const anno = state.annotations.find(a => a.id === annoId);
  if (!anno) return;

  // Switch to Extract view if currently in Matrix / Audit / Pub view
  if (divExtract.classList.contains('hidden')) {
    setActiveTab('extract');
  }

  // Switch study if different from active study
  if (state.activeDocId !== anno.docId) {
    await switchStudy(anno.docId);
  }

  const targetPage = pageOverride || anno.firstPage || parseInt(anno.page, 10);
  const wrapper = document.getElementById('pdfPagesWrapper');
  const pageContainer = wrapper.querySelector(`.page-container[data-p="${targetPage}"]`);
  if (!pageContainer) return;

  // Render the page now, or wait for the render already running (e.g. started by scrolling), before looking for the hit
  if (!pageContainer.dataset.rendered) await renderPageContent(pageContainer, targetPage);

  // Scroll to the exact highlight box or page top
  const hlBoxes = Array.from(pageContainer.querySelectorAll(`.hl-box[data-anno-id="${CSS.escape(anno.id)}"]`));
  if (hlBoxes.length > 0) {
    hlBoxes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    hlBoxes.forEach(b => {
      b.classList.remove('hl-flash');
      void b.offsetWidth;
      b.classList.add('hl-flash');
    });
  } else {
    pageContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function updateDocHeaderUI() {
  const doc = state.docs.find(d => d.id === state.activeDocId);
  const authorEl = document.getElementById('docDisplayAuthor');
  const badgesEl = document.getElementById('docDisplayBadges');
  const titleEl = document.getElementById('docDisplayTitle');
  const ctxEl = document.getElementById('docDisplayContextSummary');

  if (!doc) {
    authorEl.textContent = 'No active paper';
    badgesEl.innerHTML = '';
    titleEl.textContent = 'Select a PDF to begin';
    ctxEl.classList.add('hidden');
    document.getElementById('docOverviewBox')?.classList.add('hidden');
    return;
  }
  authorEl.textContent = getDisplayName(doc);
  badgesEl.innerHTML = getBadgesHtml(doc);
  titleEl.textContent = doc.title || doc.name;

  const ctxParts = [doc.setting, doc.participants, doc.methodology].filter(Boolean);
  if (ctxParts.length > 0) {
    ctxEl.textContent = ctxParts.join(' • ');
    ctxEl.classList.remove('hidden');
  } else {
    ctxEl.classList.add('hidden');
  }

  // The study's storyline / key metaphors stay in view while reading, unless the edit dock (which holds the same text) is open
  const ovBox = document.getElementById('docOverviewBox');
  const overview = (doc.studyOverview || '').trim();
  if (ovBox) {
    ovBox.classList.toggle('hidden', !overview || state.isEditMetaMode);
    if (overview) {
      const firstLine = overview.replace(/\s+/g, ' ');
      document.getElementById('docOverviewSummary').textContent = '📖 Storyline & key metaphors: ' + (firstLine.length > 90 ? firstLine.slice(0, 89) + '…' : firstLine);
      document.getElementById('docOverviewText').textContent = overview;
    }
  }
}

// ========================================================
// INLINE BIBLIOGRAPHY, CONTEXT & MULTI-TOOL APPRAISAL DOCK
// ========================================================
const metaDock = document.getElementById('metaEditDock');
const metaQuickBtns = document.getElementById('metaQuickFillBtns');

document.getElementById('activeDocHeader').addEventListener('click', () => {
  if (!state.activeDocId) return;
  state.isEditMetaMode = !state.isEditMetaMode;
  toggleMetaDockUI();
});

document.getElementById('closeMetaDockBtn').addEventListener('click', () => {
  state.isEditMetaMode = false;
  toggleMetaDockUI();
});

function toggleMetaDockUI() {
  updateDocHeaderUI();
  if (state.isEditMetaMode) {
    populateMetaEditInputs();
    metaDock.classList.remove('hidden');
    metaQuickBtns.classList.remove('hidden');
  } else {
    metaDock.classList.add('hidden');
    metaQuickBtns.classList.add('hidden');
  }
}

function populateMetaEditInputs() {
  const doc = state.docs.find(d => d.id === state.activeDocId);
  if (!doc) return;
  normalizeDoc(doc);
  document.getElementById('metaAuthor').value = doc.author || '';
  document.getElementById('metaEtAl').checked = doc.etAl !== false;
  document.getElementById('metaYear').value = doc.year || '';
  document.getElementById('metaTitle').value = doc.title || '';
  document.getElementById('metaDoi').value = doc.doi || '';
  document.getElementById('metaSetting').value = doc.setting || '';
  document.getElementById('metaParticipants').value = doc.participants || '';
  document.getElementById('metaGroup').value = doc.group || '';
  document.getElementById('metaMethodology').value = doc.methodology || '';
  document.getElementById('metaFunder').value = doc.funder || '';
  const compSel = document.getElementById('metaCompanionOf');
  compSel.innerHTML = '<option value="">— separate study —</option>' + state.docs.filter(d => d.id !== doc.id)
    .map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(getDisplayName(d))}</option>`).join('');
  compSel.value = (doc.companionOf && state.docs.some(d => d.id === doc.companionOf)) ? doc.companionOf : '';
  document.getElementById('metaAppraisalTool').value = doc.appraisalTool || 'CASP';
  renderAppraisalDomains(doc);
  document.getElementById('metaQuality').value = doc.quality || '';
  document.getElementById('metaRichness').value = doc.richness || '';
  document.getElementById('metaContextNote').value = doc.contextNote || '';
  document.getElementById('metaStudyOverview').value = doc.studyOverview || '';
}

async function saveCurrentMeta() {
  // Every field of the dock is read and saved here, the text fields too: nothing is left waiting for commitMeta
  metaDirty = false; pendingSaveCleanups.delete(commitMeta);
  const doc = state.docs.find(d => d.id === state.activeDocId);
  if (!doc) return;
  normalizeDoc(doc);

  // The dock's fields on a copy; stored with an audit entry for each part that changed, in one transaction
  const val = id => document.getElementById(id).value.trim();
  const doiEl = document.getElementById('metaDoi'), doiRaw = doiEl.value.trim();
  const next = {
    ...doc,
    author: val('metaAuthor'), etAl: document.getElementById('metaEtAl').checked, year: val('metaYear'), title: val('metaTitle'),
    doi: normalizeDoi(doiRaw) || '',
    setting: val('metaSetting'), participants: val('metaParticipants'), group: val('metaGroup'), methodology: val('metaMethodology'),
    appraisalTool: document.getElementById('metaAppraisalTool').value || 'CASP',
    quality: document.getElementById('metaQuality').value, richness: document.getElementById('metaRichness').value,
    contextNote: val('metaContextNote'), funder: val('metaFunder'),
    companionOf: document.getElementById('metaCompanionOf').value || '', studyOverview: val('metaStudyOverview')
  };
  // The box shows what is stored (e.g. "https://doi.org/10.1/x" is kept as 10.1/x); text that is not a DOI is said so, not
  // silently kept on screen while nothing is stored
  if (doiRaw && !next.doi) showSnackbar('That is not a DOI (it starts with 10.…): it was not saved.');
  if (document.activeElement !== doiEl) doiEl.value = next.doi;

  // Stored with an audit entry for each part that changed, in one transaction (opStudyInfo, logic.js)
  const groupChanged = (doc.group || '') !== next.group;
  const overviewChanged = (doc.studyOverview || '') !== next.studyOverview;
  const fields = Object.fromEntries(Object.keys(next).filter(k => next[k] !== doc[k]).map(k => [k, next[k]]));
  await runOperation(opStudyInfo(state, { docId: doc.id, fields }, { ...OP_NAMES, nameOf: getDisplayName }));
  if (groupChanged && typeof renderStudyVisibilityBar === 'function') renderStudyVisibilityBar();

  renderStudyList();
  // Only the open study's header and sidebar are drawn: if another study was opened meanwhile, they already show it
  if (doc.id === state.activeDocId) {
    updateDocHeaderUI();
    if (overviewChanged) updateSidebar();
  }
}

// ---- Domain judgements for checklists with built-in questions (CASP; eMERGe Part 3). Saved and logged as they change, independently of "Save Info". ----
function renderAppraisalDomains(doc) {
  const box = document.getElementById('metaDomainBox');
  const list = document.getElementById('metaDomainList');
  const sumBox = document.getElementById('metaDomainSummary');
  const tool = document.getElementById('metaAppraisalTool').value || doc.appraisalTool;
  const c = APPRAISAL_CHECKLISTS[tool];
  box.classList.toggle('hidden', !c);
  list.innerHTML = '';
  sumBox.innerHTML = '';
  if (!c) return;
  document.getElementById('metaDomainGuide').textContent = c.guidance ? `${c.name}: “${c.guidance}”` : '';
  // (read each time: a saved answer replaces the study's appraisal objects)
  const items = () => appraisalItemsOf(doc, tool);
  const updateStatus = () => {
    const done = c.items.filter(it => items()[it.id] && items()[it.id].a).length;
    document.getElementById('metaDomainStatus').textContent = `· ${c.name} · ${done === c.items.length ? 'all questions answered' : `${c.items.length - done} question(s) not answered yet`}`;
  };
  updateStatus();
  // One answer, reason or summary text: the study's copy with it and its entry, in one transaction.
  // field: 'appraisalItems' (patch for question id) or 'appraisalSummary' (patch of the summary)
  const saveAnswer = async (field, id, patch, what, detail, from, to) => {
    await runOperation(opAppraisalAnswer(state, { docId: doc.id, tool, field, id, patch, what, detail, from, to }, OP_NAMES));
    updateStatus();
  };
  const bindText = (el, get, save) => {
    let committed = get() || '';
    bindPendingCommit(el, async () => {
      const next = el.value.trim();
      if (next === committed) return;
      await save(committed, next);
      committed = next; // (only once stored: a refused write is tried again, and logged then)
    });
  };
  c.items.forEach((it, i) => {
    const cur = items()[it.id] || {};
    const row = document.createElement('div');
    row.className = 'text-xs';
    row.innerHTML = `
      ${it.section ? `<div class="text-[11px] font-bold text-teal-900 uppercase tracking-wide pt-1">${escapeHtml(it.section)}</div>` : ''}
      <div class="text-slate-700 leading-snug"><b>${i + 1}.</b> ${escapeHtml(it.text)}</div>
      ${(it.consider || []).length ? `<details class="text-[11px] text-slate-500"><summary class="cursor-pointer select-none">Consider</summary><ul class="list-disc pl-4">${it.consider.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></details>` : ''}
      <div class="flex items-center gap-1.5 mt-0.5">
        <select class="dom-a border border-slate-300 bg-white rounded px-1 py-0.5 text-xs focus:outline-none focus:border-indigo-500">
          <option value="">—</option>${c.answers.map(([v, l]) => `<option value="${v}" ${cur.a === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
        </select>
        <input type="text" class="dom-note flex-1 border border-slate-300 bg-white rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-indigo-500" placeholder="Why (what you saw in the paper)" value="${escapeHtml(cur.note || '')}">
      </div>`;
    const sel = row.querySelector('.dom-a');
    sel.onchange = async () => {
      const prev = (items()[it.id] || {}).a || '';
      await saveAnswer('appraisalItems', it.id, { a: sel.value }, it.id.toUpperCase(), it.text, appraisalAnswerLabel(tool, prev), appraisalAnswerLabel(tool, sel.value));
    };
    bindText(row.querySelector('.dom-note'), () => (items()[it.id] || {}).note,
      (prev, next) => saveAnswer('appraisalItems', it.id, { note: next }, it.id.toUpperCase() + ' reason', it.text, prev, next));
    list.appendChild(row);
  });
  if (c.summary) {
    sumBox.innerHTML = `<div class="text-[11px] font-bold text-teal-900 uppercase tracking-wide pt-1">Appraisal summary</div><div class="text-[11px] text-slate-500 leading-snug">${escapeHtml(c.summary.label)}</div>`;
    c.summary.fields.forEach(([k, label]) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<label class="block text-[11px] font-semibold text-slate-600">${escapeHtml(label)}</label>
        <textarea rows="2" class="dom-sum w-full border border-slate-300 bg-white rounded px-1.5 py-0.5 text-xs resize-y focus:outline-none focus:border-indigo-500">${escapeHtml(appraisalSummaryOf(doc, tool)[k] || '')}</textarea>`;
      bindText(wrap.querySelector('textarea'), () => appraisalSummaryOf(doc, tool)[k],
        (prev, next) => saveAnswer('appraisalSummary', null, { [k]: next }, 'summary', label, prev, next));
      sumBox.appendChild(wrap);
    });
  }
}
document.getElementById('metaAppraisalTool').addEventListener('change', async () => {
  // A reason just typed for the other checklist is saved and logged before its boxes are replaced
  await flushAllPendingSaves();
  const doc = state.docs.find(d => d.id === state.activeDocId);
  if (doc) renderAppraisalDomains(doc);
});

// Companion papers (eMERGe item 10): text describing linked accounts of the same primary study
function companionText(d) {
  const links = new Set();
  if (d.companionOf && state.docs.some(x => x.id === d.companionOf)) links.add(d.companionOf);
  state.docs.forEach(x => { if (x.companionOf === d.id) links.add(x.id); });
  return [...links].map(id => getDisplayName(state.docs.find(x => x.id === id))).join('; ');
}
function funderLinkedText(d) {
  const parts = [];
  // "not recorded" only says something when funders are recorded for other studies; with none recorded the gap is in the
  // eMERGe mapping (Item 10), not repeated on every row of Table 1
  if (d.funder) parts.push('Funder: ' + d.funder);
  else if (state.docs.some(x => x.funder)) parts.push('Funder: not recorded');
  const c = companionText(d);
  if (c) parts.push('Same study as: ' + c);
  return parts.join(' | ') || '-';
}

document.getElementById('saveMetaBtn').addEventListener('click', async () => {
  metaDirty = false; pendingSaveCleanups.delete(commitMeta);
  await saveCurrentMeta();
  state.isEditMetaMode = false;
  toggleMetaDockUI();
});

['metaEtAl', 'metaAppraisalTool', 'metaQuality', 'metaRichness', 'metaCompanionOf'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => saveCurrentMeta());
});
// Text fields are saved (and logged where they are) when left, or on a study / tab switch or page leave, like every other
// text box: nothing typed here is lost if the reviewer moves on without clicking Save Info. saveCurrentMeta() reads the
// fields into the active study before its first await, so a flush at the start of switchStudy() saves them to the right study.
// One commit for the whole dock (not one per field), so several edited fields are saved in one go.
let metaDirty = false;
const commitMeta = async () => {
  if (!metaDirty) return;
  metaDirty = false;
  pendingSaveCleanups.delete(commitMeta);
  await saveCurrentMeta();
};
commitMeta.isCommit = true;
['metaAuthor', 'metaYear', 'metaTitle', 'metaDoi', 'metaSetting', 'metaParticipants', 'metaGroup', 'metaMethodology', 'metaFunder', 'metaContextNote', 'metaStudyOverview']
  .forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { metaDirty = true; pendingSaveCleanups.add(commitMeta); });
    el.addEventListener('change', () => { if (document.hasFocus()) commitMeta(); }); // not when only the window lost focus
  });

document.querySelectorAll('.meta-drop-target').forEach(input => {
  input.addEventListener('dragover', e => {
    e.preventDefault();
    input.classList.add('drop-input-active');
  });
  input.addEventListener('dragleave', () => input.classList.remove('drop-input-active'));
  input.addEventListener('drop', async (/** @type {DragEvent} */ e) => {
    e.preventDefault();
    input.classList.remove('drop-input-active');
    const droppedText = (e.dataTransfer.getData('text/plain') || '').replace(/\s+/g, ' ').trim();
    if (!droppedText) return;
    applyMetaFieldText(input.id, droppedText);
    await saveCurrentMeta();
  });
});

document.querySelectorAll('.meta-fill-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!state.pendingSelection?.txt) return;
    const txt = state.pendingSelection.txt.replace(/\s+/g, ' ').trim();
    applyMetaFieldText(btn.dataset.field, txt);
    await saveCurrentMeta();
    document.getElementById('selectionTooltip').classList.add('hidden');
    window.getSelection().removeAllRanges();
  });
});

function applyMetaFieldText(inputId, rawText) {
  const el = document.getElementById(inputId);
  if (!el) return;
  if (inputId === 'metaYear') {
    const match = rawText.match(/\b(19|20)\d{2}\b/);
    el.value = match ? match[0] : rawText;
  } else if (inputId === 'metaAuthor') {
    const cleaned = rawText.replace(/[,0-9*†‡§]/g, ' ').trim();
    const parts = cleaned.split(/\s+/);
    el.value = parts.length > 1 && !rawText.includes(',') ? parts[parts.length - 1] : parts[0];
  } else {
    el.value = rawText;
  }
}

// ========================================================
// PDF LAZY RENDER & HIGHLIGHTS (IntersectionObserver)
// ========================================================
function evictPageContent(container, num) {
  if (!container || !container.dataset.rendered || container.dataset.rendering) return;
  const canvas = container.querySelector('canvas');
  if (canvas) {
    canvas.width = 1;
    canvas.height = 1;
    canvas.remove();
  }
  const txtLayer = container.querySelector('.textLayer');
  if (txtLayer) txtLayer.remove();
  delete container.dataset.rendered;
  if (!container.querySelector('.page-loading-placeholder')) {
    const loadingLabel = document.createElement('div');
    loadingLabel.className = 'page-loading-placeholder absolute inset-0 flex items-center justify-center text-xs text-slate-300 select-none pointer-events-none';
    loadingLabel.textContent = `Page ${num}`;
    container.insertBefore(loadingLabel, container.firstChild);
  }
}

function createPagePlaceholder(num, width, height) {
  const container = document.createElement('div');
  container.className = 'page-container';
  container.dataset.p = num;
  container.style.width = width + 'px';
  container.style.height = height + 'px';

  const loadingLabel = document.createElement('div');
  loadingLabel.className = 'page-loading-placeholder absolute inset-0 flex items-center justify-center text-xs text-slate-300 select-none pointer-events-none';
  loadingLabel.textContent = `Page ${num}`;
  container.appendChild(loadingLabel);

  const hlLayer = document.createElement('div');
  hlLayer.className = 'highlight-layer';
  hlLayer.id = 'hl-' + num;
  container.appendChild(hlLayer);

  return container;
}

// The page being rendered, so a caller that needs its text layer (search jump) can wait for it
const pageRenderPromises = new WeakMap();
function renderPageContent(container, num) {
  if (!state.activePdfDoc || container.dataset.rendered) return Promise.resolve();
  if (container.dataset.rendering) return pageRenderPromises.get(container) || Promise.resolve();
  const p = renderPageContentNow(container, num);
  pageRenderPromises.set(container, p);
  return p;
}
async function renderPageContentNow(container, num) {
  container.dataset.rendering = 'true';
  // Bound to the PDF it started with: if the study is switched or the pages are laid out again (zoom) meanwhile, the
  // container is gone or the PDF replaced, and the render stops quietly instead of drawing into a detached page
  const pdfDoc = state.activePdfDoc;
  const stale = () => !container.isConnected || state.activePdfDoc !== pdfDoc;
  try {
    const page = await pdfDoc.getPage(num);
    if (stale()) { delete container.dataset.rendering; return; }
    const vp = page.getViewport({ scale: state.scale });
    container.style.width = vp.width + 'px';
    container.style.height = vp.height + 'px';
    container.style.setProperty('--scale-factor', state.scale);

    const placeholder = container.querySelector('.page-loading-placeholder');
    if (placeholder) placeholder.remove();

    // Sharp text on HiDPI screens: draw at the device pixel ratio (capped at 2 to keep memory in check), show at CSS size
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = vp.width + 'px';
    canvas.style.height = vp.height + 'px';

    const hlLayer = container.querySelector('.highlight-layer');
    container.insertBefore(canvas, hlLayer);

    const txtLayer = document.createElement('div');
    txtLayer.className = 'textLayer';
    txtLayer.style.width = vp.width + 'px';
    txtLayer.style.height = vp.height + 'px';
    txtLayer.style.setProperty('--scale-factor', String(state.scale));
    container.appendChild(txtLayer);

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    if (stale()) { delete container.dataset.rendering; return; }
    const textContent = await page.getTextContent();
    if (stale()) { delete container.dataset.rendering; return; } // another study opened while the text was read
    await pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: txtLayer,
      viewport: vp,
      textDivs: []
    }).promise;

    container.dataset.rendered = 'true';
    delete container.dataset.rendering;
  } catch (e) {
    delete container.dataset.rendering;
    if (!stale()) console.error('Error rendering page ' + num, e); // a destroyed PDF (study switched) is not an error
  }
}

// Text of a selection in the PDF text layer. Range.toString() joins the last word of one line to the first word
// of the next ("againstthe") because PDF.js text items usually have no trailing space at a line end.
// Here a space is added whenever the next text item starts on a new line or column (hyphen at line end: no space).
function selectionTextWithSpaces(range) {
  // Only the spans under the selection's common ancestor (one page, or the pages it spans), not every rendered page
  let root = range.commonAncestorContainer;
  if (root && root.nodeType !== 1) root = root.parentElement;
  if (!root || !root.closest || !root.closest('#pdfPagesWrapper')) return range.toString();
  const candidates = root.matches('.textLayer span') ? [root] : [...root.querySelectorAll(root.closest('.textLayer') ? 'span' : '.textLayer span')];
  const spans = candidates.filter(sp => sp.firstChild && sp.firstChild.nodeType === 3 && range.intersectsNode(sp));
  if (!spans.length) return range.toString();
  let out = '';
  let prev = null;
  for (const sp of spans) {
    const tn = sp.firstChild;
    let piece = tn.data;
    if (range.startContainer === tn && range.endContainer === tn) piece = piece.slice(range.startOffset, range.endOffset);
    else if (range.startContainer === tn) piece = piece.slice(range.startOffset);
    else if (range.endContainer === tn) piece = piece.slice(0, range.endOffset);
    if (!piece) continue;
    const r = sp.getBoundingClientRect();
    if (prev && out && !/\s$/.test(out) && !/^\s/.test(piece)) {
      const newLine = r.top > prev.top + prev.height * 0.6 || r.left + 1 < prev.left;
      if (newLine && !/[-\u2010\u2011]$/.test(out)) out += joinSeparator(out, piece);
    }
    out += piece;
    prev = r;
  }
  return out.replace(/\s+/g, ' ');
}

document.addEventListener('mouseup', (e) => {
  const tt = document.getElementById('selectionTooltip');
  if (tt.contains(/** @type {Node} */ (e.target))) return;
  if (divExtract.classList.contains('hidden')) return tt.classList.add('hidden'); // the PDF is only in Tab 1
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !state.activeDocId) return tt.classList.add('hidden');

  const range = sel.getRangeAt(0);
  // Both ends in the PDF: a drag that runs on into the sidebar would take its button labels along as "quote" text
  const inPdf = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!(el && el.closest && el.closest('#pdfPagesWrapper')); };
  if (!inPdf(range.startContainer) || !inPdf(range.endContainer)) return tt.classList.add('hidden');
  const txt = selectionTextWithSpaces(range).normalize('NFC').trim();
  if (!txt) return tt.classList.add('hidden');

  const rects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
  if (!rects.length) return;

  // Map rects to pages
  const pageRectsMap = {};
  let firstPage = null;
  let lastPage = null;
  let lastRect = rects[rects.length - 1];

  // Each rect belongs to the page whose box contains its centre. Found by geometry, not elementFromPoint: a selection that runs
  // under the sticky zoom bar or outside the visible area would otherwise lose those lines (and the page range).
  const pageBoxes = [...document.querySelectorAll('#pdfPagesWrapper .page-container')].map(pc => ({ el: pc, box: pc.getBoundingClientRect() }));
  rects.forEach(r => {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = pageBoxes.find(p => cx >= p.box.left && cx <= p.box.right && cy >= p.box.top && cy <= p.box.bottom);
    const el = hit ? hit.el : null;
    
    if (el) {
      const pageNum = parseInt(el.dataset.p, 10);
      if (firstPage === null || pageNum < firstPage) firstPage = pageNum;
      if (lastPage === null || pageNum > lastPage) lastPage = pageNum;
      
      if (!pageRectsMap[pageNum]) {
        pageRectsMap[pageNum] = { containerRect: el.getBoundingClientRect(), rects: [] };
      }
      
      const pRect = pageRectsMap[pageNum].containerRect;
      pageRectsMap[pageNum].rects.push({
        left: (r.left - pRect.left) / pRect.width,
        top: (r.top - pRect.top) / pRect.height,
        width: r.width / pRect.width,
        height: r.height / pRect.height
      });
    }
  });

  if (Object.keys(pageRectsMap).length === 0) return tt.classList.add('hidden');

  const multiPageRects = {};
  for (const p in pageRectsMap) {
    multiPageRects[p] = mergeHighlightRects(pageRectsMap[p].rects);
  }
  
  const pageLabel = firstPage === lastPage ? String(firstPage) : `${firstPage}-${lastPage}`;

  state.pendingSelection = {
    txt,
    page: pageLabel,       // e.g. "2" or "2-3"
    firstPage: firstPage,  // for jumping
    rectsMap: multiPageRects // { "2": [...], "3": [...] }
  };

  refreshAddPassageSelect();
  tt.style.left = Math.max(10, Math.min(window.innerWidth - 460, lastRect.left)) + 'px';
  tt.style.top = Math.max(10, (lastRect.top - 45)) + 'px';
  tt.classList.remove('hidden');
});

// Merge same-line fragments and prevent vertical overlap across consecutive lines
function mergeHighlightRects(normRects) {
  if (!Array.isArray(normRects) || normRects.length === 0) return [];
  const sorted = normRects
    .map(r => ({ left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height }))
    .sort((a, b) => (Math.abs(a.top - b.top) < 0.006 ? a.left - b.left : a.top - b.top));

  // Step 1: Merge boxes on the same text line
  const lines = [];
  for (const r of sorted) {
    const h = r.bottom - r.top;
    if (lines.length === 0) {
      lines.push({ ...r });
      continue;
    }
    const prev = lines[lines.length - 1];
    const prevH = prev.bottom - prev.top;
    const sameLine = Math.abs(r.top - prev.top) < Math.min(h, prevH) * 0.55;
    const horizAdjacent = r.left <= prev.right + 0.025;
    if (sameLine && horizAdjacent) {
      prev.left = Math.min(prev.left, r.left);
      prev.top = Math.min(prev.top, r.top);
      prev.right = Math.max(prev.right, r.right);
      prev.bottom = Math.max(prev.bottom, r.bottom);
    } else {
      lines.push({ ...r });
    }
  }

  // Step 2: Make consecutive lines of one passage meet (no overlap, no gap), like a highlighter pen.
  // Each line is joined to the nearest earlier line above it that overlaps it horizontally.
  for (let i = 1; i < lines.length; i++) {
    const curr = lines[i];
    for (let j = i - 1; j >= 0; j--) {
      const prev = lines[j];
      const horizOverlap = Math.min(prev.right, curr.right) - Math.max(prev.left, curr.left);
      if (horizOverlap <= 0) continue;
      const lineH = prev.bottom - prev.top;
      if (curr.top - prev.bottom < lineH) {
        const mid = (prev.bottom + curr.top) / 2;
        prev.bottom = mid;
        curr.top = mid;
      }
      break;
    }
  }

  return lines.map(l => ({
    left: l.left,
    top: l.top,
    width: Math.max(0.002, l.right - l.left),
    height: Math.max(0.002, l.bottom - l.top)
  }));
}

function refreshAddPassageSelect() {
  const sel = document.getElementById('tagAddPassageSel');
  if (!sel) return;
  const secs = state.annotations.filter(a => a.type === 'second_order' && a.docId === state.activeDocId).map(normalizeAnnotation);
  sel.innerHTML = '<option value="">📑 + passage of…</option>' + secs.map(sx => `<option value="${escapeHtml(sx.id)}">p.${escapeHtml(sx.page)} · ${escapeHtml((sx.note || sx.text).slice(0, 40))}</option>`).join('');
  sel.classList.toggle('hidden', secs.length === 0);
  sel.value = '';
}
document.getElementById('tagAddPassageSel').addEventListener('change', e => { if (e.target.value) addSelectionAsPassage(e.target.value); });
document.getElementById('tagAddPassageSel').addEventListener('mousedown', e => e.stopPropagation());
document.getElementById('tagFirstOrderBtn').onclick = () => addAnno('first_order');
document.getElementById('tagSecondOrderBtn').onclick = () => addAnno('second_order');
document.getElementById('undoDeleteBtn').addEventListener('click', () => performUndo());

// Keyboard shortcuts: '1' -> 1st Order, '2' -> 2nd Order when selection is active; Ctrl/Cmd+Z -> Undo deletion
document.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  const isTyping = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || document.activeElement?.isContentEditable;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTyping) {
    if (state.undoStack.length > 0) {
      e.preventDefault();
      performUndo();
    }
    return;
  }

  if (isTyping) return;
  const tt = document.getElementById('selectionTooltip');
  if (!tt.classList.contains('hidden') && state.pendingSelection?.txt) {
    if (e.key === '1') {
      e.preventDefault();
      addAnno('first_order');
    } else if (e.key === '2') {
      e.preventDefault();
      addAnno('second_order');
    } else if (e.key === 'Escape') {
      tt.classList.add('hidden');
      window.getSelection()?.removeAllRanges();
    }
  }
});

async function addAnno(type) {
  // Taken at once, before any wait: a second press of 1 / 2 (or a second click) finds nothing to add, so nothing is added twice
  const sel = state.pendingSelection;
  if (!sel || !sel.txt) return;
  state.pendingSelection = null;
  document.getElementById('selectionTooltip').classList.add('hidden');
  window.getSelection().removeAllRanges();
  const a = normalizeAnnotation({
    id: 'a_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    docId: state.activeDocId,
    type,
    by: state.reviewerId || 'Reviewer',
    text: stripOuterQuotes(sel.txt),
    page: sel.page,
    firstPage: sel.firstPage,
    rectsMap: sel.rectsMap, // multi-page rects
    note: '',
    nuanceNote: '',
    concordanceStatus: 'pending',
    concordanceNote: '',
    clusterIds: [],
    clusterComments: {}
  });
  await commitOps([{ store: 'annotations', put: a }]);
  renderHighlights();
  updateSidebar();
}

function renderHighlights() {
  document.querySelectorAll('.highlight-layer').forEach(e => e.innerHTML = '');
  state.annotations.filter(a => a.docId === state.activeDocId).forEach(a => {
    // Primary passage + additional passages (same interpretation stated elsewhere in the paper)
    const maps = [];
    if (a.rectsMap) maps.push(a.rectsMap);
    (a.type === 'second_order' && Array.isArray(a.passages) ? a.passages : []).forEach(p => { if (p.rectsMap) maps.push(p.rectsMap); });
    maps.forEach(rmap => {
    for (const pageNum in rmap) {
      const layer = document.getElementById('hl-' + pageNum);
      if (!layer) continue;
      
      const rectsOnPage = rmap[pageNum];
      if (!Array.isArray(rectsOnPage)) continue;

      // mergeHighlightRects is already done on creation, but we can do it again just in case
      mergeHighlightRects(rectsOnPage).forEach(r => {
        const b = document.createElement('div');
        b.className = 'hl-box ' + a.type;
        b.dataset.annoId = a.id;
        b.title = (a.type === 'second_order' ? '2nd Order: ' : '1st Order: ') + (a.note || a.text.slice(0, 60));
        b.style.left = (r.left * 100) + '%';
        b.style.top = (r.top * 100) + '%';
        b.style.width = (r.width * 100) + '%';
        b.style.height = (r.height * 100) + '%';
        layer.appendChild(b);
      });
    }
    });
  });
}

// Clicking a highlight shows its card in the sidebar. The text layer lies above the highlights (so highlighted text can
// still be selected again, e.g. to extract a second construct from it), so the click is matched to the boxes by position:
// a plain click (no text selected) inside a box opens its card; a drag still selects text as usual.
function focusSidebarCard(annoId) {
  const cardEl = document.querySelector(`[data-sidebar-anno="${CSS.escape(annoId)}"]`);
  if (!cardEl) return;
  cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  cardEl.classList.add('ring-2', 'ring-amber-400');
  setTimeout(() => cardEl.classList.remove('ring-2', 'ring-amber-400'), 1400);
}
function hlBoxAtPoint(target, x, y) {
  const pageContainer = target && target.closest ? target.closest('#pdfPagesWrapper .page-container') : null;
  if (!pageContainer) return null;
  // The smallest box under the pointer: a short highlight inside a longer one stays reachable. Boxes are placed in percent of
  // the page, so one measurement of the page is enough (no layout read per box on every mouse move)
  const pr = pageContainer.getBoundingClientRect();
  if (!pr.width || !pr.height) return null;
  const px = (x - pr.left) / pr.width * 100, py = (y - pr.top) / pr.height * 100;
  let best = null, bestArea = Infinity;
  pageContainer.querySelectorAll('.hl-box').forEach(b => {
    const l = parseFloat(b.style.left), t = parseFloat(b.style.top), w = parseFloat(b.style.width), h = parseFloat(b.style.height);
    if (!(px >= l && px <= l + w && py >= t && py <= t + h)) return;
    if (w * h < bestArea) { best = b; bestArea = w * h; }
  });
  return best;
}
(() => {
  const wrapper = document.getElementById('pdfPagesWrapper');
  if (!wrapper) return;
  wrapper.addEventListener('click', e => {
    if (e.button !== 0) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return; // the user selected text
    const box = hlBoxAtPoint(e.target, e.clientX, e.clientY);
    if (box) focusSidebarCard(box.dataset.annoId);
  });
  // Pointer cursor and the highlight's tooltip while hovering over it (checked once per frame)
  let pending = null, lastPage = null;
  wrapper.addEventListener('mousemove', e => {
    if (pending) return;
    const { target, clientX, clientY } = e;
    pending = requestAnimationFrame(() => {
      pending = null;
      const box = hlBoxAtPoint(target, clientX, clientY);
      const pageContainer = target && target.closest ? target.closest('.page-container') : null;
      if (lastPage && lastPage !== pageContainer) { lastPage.classList.remove('hl-hover'); lastPage.removeAttribute('title'); }
      lastPage = pageContainer;
      if (!pageContainer) return;
      pageContainer.classList.toggle('hl-hover', !!box);
      if (box) pageContainer.title = box.title + ' (click to show its card)'; else pageContainer.removeAttribute('title');
    });
  });
})();

// --- D. Full-PDF Keyword Search across Lazy-Rendered Pages ---
const pdfSearchState = {
  docId: null,
  pageTexts: [], // [{ pageNum, text }]
  matches: [],   // [pageNum, ...]
  activeIdx: -1,
  lastQuery: ''
};

// Bound to the PDF it started with: if the user opens another study meanwhile (the old PDF is destroyed),
// stop quietly and never store one paper's text under another paper's id.
async function ensurePdfTextIndex() {
  const pdfDoc = state.activePdfDoc, docId = state.activeDocId;
  if (!pdfDoc || !docId) return [];
  if (pdfSearchState.docId === docId && pdfSearchState.pageTexts.length > 0) {
    return pdfSearchState.pageTexts;
  }
  const pageTexts = [];
  try {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      if (state.activePdfDoc !== pdfDoc) return null;
      const page = await pdfDoc.getPage(i);
      const tc = await page.getTextContent();
      // Runs of spaces and line breaks count as one space, here, in the query and in the highlight (the same text everywhere)
      const joined = joinTextItems(tc.items.map(item => item.str)).normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
      pageTexts.push({ pageNum: i, text: joined });
    }
  } catch (e) {
    if (state.activePdfDoc !== pdfDoc) return null; // destroyed by a study switch
    throw e;
  }
  if (state.activePdfDoc !== pdfDoc) return null;
  pdfSearchState.docId = docId;
  pdfSearchState.pageTexts = pageTexts;
  return pageTexts;
}

// No study is open any more (the last one deleted, a reset, a clean restore): let go of the PDF that was shown, its page
// observer and its search index
async function closeActivePdf() {
  if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
  if (state.activePdfDoc) {
    try { await state.activePdfDoc.destroy(); } catch (e) { /* already closed */ }
    state.activePdfDoc = null;
  }
  Object.assign(pdfSearchState, { docId: null, pageTexts: [] });
  resetPdfSearchResults();
  const label = document.getElementById('pdfPageCountLabel');
  if (label) label.textContent = '0 pages';
}

// Another study opened: forget the hits of the previous one (the words typed stay, so Enter searches the new paper)
function resetPdfSearchResults() {
  pdfSearchState.matches = [];
  pdfSearchState.activeIdx = -1;
  pdfSearchState.lastQuery = '';
  ['pdfSearchStatus', 'pdfSearchPrevBtn', 'pdfSearchNextBtn'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

async function runPdfSearch(query, direction = 1) {
  const statusEl = document.getElementById('pdfSearchStatus');
  const prevBtn = document.getElementById('pdfSearchPrevBtn');
  const nextBtn = document.getElementById('pdfSearchNextBtn');
  const clearBtn = document.getElementById('pdfSearchClearBtn');
  const q = (query || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

  if (!q || !state.activePdfDoc) {
    pdfSearchState.matches = [];
    pdfSearchState.activeIdx = -1;
    pdfSearchState.lastQuery = '';
    statusEl?.classList.add('hidden');
    prevBtn?.classList.add('hidden');
    nextBtn?.classList.add('hidden');
    clearBtn?.classList.add('hidden');
    return;
  }

  clearBtn?.classList.remove('hidden');

  if (q === pdfSearchState.lastQuery && pdfSearchState.docId === state.activeDocId && pdfSearchState.matches.length > 0) {
    await jumpToSearchedPage(pdfSearchState.activeIdx + direction, q);
    return;
  }

  statusEl.textContent = '...';
  statusEl.classList.remove('hidden');
  const pages = await ensurePdfTextIndex();
  if (!pages) return; // another study was opened while indexing
  const matchedPages = [];
  pages.forEach(p => {
    if (p.text.includes(q)) matchedPages.push(p.pageNum);
  });

  pdfSearchState.lastQuery = q;
  pdfSearchState.matches = matchedPages;
  pdfSearchState.activeIdx = matchedPages.length > 0 ? 0 : -1;
  prevBtn.classList.toggle('hidden', matchedPages.length <= 1);
  nextBtn.classList.toggle('hidden', matchedPages.length <= 1);

  if (matchedPages.length === 0) {
    statusEl.textContent = '0/0';
  } else {
    await jumpToSearchedPage(0, q);
  }
}

const searchHighlight = { timer: null, spans: [] }; // the spans lit by the last search, and the timer that clears them
async function jumpToSearchedPage(matchIdx, queryStr) {
  const matches = pdfSearchState.matches;
  if (!matches.length) return;
  pdfSearchState.activeIdx = (matchIdx + matches.length) % matches.length;
  const targetPage = matches[pdfSearchState.activeIdx];
  const statusEl = document.getElementById('pdfSearchStatus');
  if (statusEl) {
    statusEl.textContent = `${pdfSearchState.activeIdx + 1}/${matches.length} (p.${targetPage})`;
  }

  const wrapper = document.getElementById('pdfPagesWrapper');
  const pageContainer = wrapper.querySelector(`.page-container[data-p="${targetPage}"]`);
  if (!pageContainer) return;

  if (!pageContainer.dataset.rendered) await renderPageContent(pageContainer, targetPage); // or wait for the render already running

  const q = (queryStr || document.getElementById('pdfSearchInput')?.value || '').normalize('NFC').trim().toLowerCase();
  // The search index joins the page's text items with spaces, so a phrase can run over several text spans (PDF.js splits
  // lines and words into spans): match against the same joined text and light up every span the match touches.
  const spans = Array.from(pageContainer.querySelectorAll('.textLayer span')).filter(sp => sp.firstChild && sp.firstChild.nodeType === 3);
  const norm = t => t.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
  const needle = norm(q).trim();
  // The same text as the search index: items joined (joinSeparator), then every run of spaces one space. A span that ends or
  // starts with a space must not leave two where the index has one, or a phrase found there is not found here.
  let joined = '';
  const add = str => { for (const ch of str) { if (ch === ' ' && joined.endsWith(' ')) continue; joined += ch; } };
  const ranges = spans.map(sp => {
    const t = norm(sp.textContent);
    if (joined && t) add(joinSeparator(joined, t));
    const at = joined.length; add(t); return [at, joined.length];
  });
  const hits = new Set();
  for (let at = needle ? joined.indexOf(needle) : -1; at >= 0; at = joined.indexOf(needle, at + 1)) {
    const end = at + needle.length;
    spans.forEach((sp, k) => { const [a, b] = ranges[k]; if (a < end && b > at) hits.add(sp); });
  }
  // The previous search's highlight goes now, and its timer with it (else it would clear this one part way)
  clearTimeout(searchHighlight.timer);
  searchHighlight.spans.forEach(sp => { sp.style.backgroundColor = ''; });
  searchHighlight.spans = [];
  if (hits.size) {
    const first = spans.find(sp => hits.has(sp));
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    hits.forEach(sp => {
      sp.style.backgroundColor = 'rgba(250, 204, 21, 0.55)';
      sp.style.borderRadius = '2px';
    });
    searchHighlight.spans = [...hits];
    searchHighlight.timer = setTimeout(() => { searchHighlight.spans.forEach(sp => { sp.style.backgroundColor = ''; }); searchHighlight.spans = []; }, 6000); // long enough to read the passage around it
  } else {
    pageContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

const pdfSearchInputEl = document.getElementById('pdfSearchInput');
pdfSearchInputEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runPdfSearch(pdfSearchInputEl.value, e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    pdfSearchInputEl.value = '';
    runPdfSearch('');
    pdfSearchInputEl.blur();
  }
});
document.getElementById('pdfSearchNextBtn')?.addEventListener('click', () => runPdfSearch(pdfSearchInputEl.value, 1));
document.getElementById('pdfSearchPrevBtn')?.addEventListener('click', () => runPdfSearch(pdfSearchInputEl.value, -1));
document.getElementById('pdfSearchClearBtn')?.addEventListener('click', () => {
  if (pdfSearchInputEl) pdfSearchInputEl.value = '';
  runPdfSearch('');
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !divExtract.classList.contains('hidden')) {
    e.preventDefault();
    pdfSearchInputEl?.focus();
    pdfSearchInputEl?.select();
  }
});

// --- E. Hybrid Citation Auto-Extractor (PDF Metadata + Page 1 Font/Position Heuristics) ---
async function autoExtractCitationFromPdf() {
  const doc = state.docs.find(d => d.id === state.activeDocId);
  if (!doc || !state.activePdfDoc) {
    showSnackbar('Open a study whose PDF is loaded first.'); return;
  }
  // Bound to the study and PDF it started with: if another study is opened meanwhile, its form is never filled with these
  const pdf = state.activePdfDoc;
  const stillHere = () => state.activeDocId === doc.id && state.activePdfDoc === pdf;

  let detectedTitle = '';
  let detectedAuthor = '';
  let detectedEtAl = true;
  let detectedYear = '';
  let yearFromPublicationDate = false;

  // Stage 1: Check embedded PDF Info Dict & XMP Metadata
  try {
    const meta = await pdf.getMetadata();
    const info = meta?.info || {};
    const xmp = meta?.metadata;

    const rawMetaTitle = (xmp && (xmp.get('dc:title') || xmp.get('pdfx:title'))) || info.Title || '';
    if (rawMetaTitle && rawMetaTitle.length > 8 && !/^(untitled|microsoft word|pdf|\.pdf)/i.test(rawMetaTitle.trim())) {
      detectedTitle = String(rawMetaTitle).replace(/\s+/g, ' ').trim();
    }

    const rawMetaAuthor = (xmp && xmp.get('dc:creator')) || info.Author || '';
    const authorStr = Array.isArray(rawMetaAuthor) ? rawMetaAuthor.join('; ') : String(rawMetaAuthor || '');
    if (authorStr && authorStr.length > 2 && !/^(admin|user|unknown|author|ieee|elsevier|springer|wiley)/i.test(authorStr.trim())) {
      const parsed = extractSurnameFromAuthorString(authorStr);
      if (parsed.surname) {
        detectedAuthor = parsed.surname;
        detectedEtAl = Array.isArray(rawMetaAuthor) ? rawMetaAuthor.length > 1 : parsed.hasEtAl;
      }
    }

    // A publication date in the metadata is trusted; a file creation date (often the download or typesetting date) is only a fallback
    const pubDate = xmp && (xmp.get('prism:publicationDate') || xmp.get('dc:date'));
    const rawDate = pubDate || (xmp && xmp.get('xap:CreateDate')) || info.CreationDate || '';
    const metaYear = yearFromPdfDate(rawDate);
    if (metaYear) { detectedYear = metaYear; yearFromPublicationDate = !!pubDate; }
  } catch (e) {
    console.warn('Metadata read warning:', e);
  }

  // Stage 2: Page 1 Visual Layout & Font-Height Heuristics
  try {
    const page1 = await pdf.getPage(1);
    const vp = page1.getViewport({ scale: 1.0 });
    const tc = await page1.getTextContent();

    // Group text items into horizontal lines by Y coordinate
    const lineBuckets = [];
    for (const item of tc.items) {
      const str = (item.str || '').trim();
      if (!str) continue;
      const fontSize = Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.transform[3]) || 10;
      const x = item.transform[4];
      const y = item.transform[5];
      // Ignore very bottom footer or top running header margins
      if (y < vp.height * 0.06 || y > vp.height * 0.95) continue;

      let bucket = lineBuckets.find(b => Math.abs(b.y - y) <= Math.max(4, fontSize * 0.45));
      if (!bucket) {
        bucket = { y, maxFont: fontSize, items: [] };
        lineBuckets.push(bucket);
      }
      bucket.maxFont = Math.max(bucket.maxFont, fontSize);
      bucket.items.push({ x, str, fontSize });
    }

    // Sort top-to-bottom (in PDF coordinates, higher Y is higher on page)
    lineBuckets.sort((a, b) => b.y - a.y);
    const lines = lineBuckets.map(b => {
      b.items.sort((i1, i2) => i1.x - i2.x);
      return {
        y: b.y,
        fontSize: b.maxFont,
        text: b.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim()
      };
    }).filter(l => l.text.length > 2);

    // 2a. Find Year from Page 1 header/footer text if not yet found (or refine)
    const fullPage1Text = lines.map(l => l.text).join(' ');
    const yearMatches = (fullPage1Text.match(new RegExp(YEAR_RE.source, 'g')) || []).map(m => m.replace(/^\D/, ''));
    if (!yearFromPublicationDate && yearMatches.length > 0) {
      // Prefer year near copyright/received/published keywords
      const pubContextMatch = fullPage1Text.match(new RegExp('(?:published|accepted|received|©|copyright|\\()\\s*(?:[a-z]+\\s+\\d{1,2},?\\s*)?(' + YEAR_CORE + ')', 'i'));
      detectedYear = pubContextMatch ? pubContextMatch[1] : yearMatches[0];
    }

    // 2b. Find Title (largest font lines in top 65% of Page 1)
    const topLines = lines.filter(l => l.y > vp.height * 0.35 && l.text.length > 4 && !/^(original article|research paper|review|open access|journal of|elsevier|springer|wiley|bmj)/i.test(l.text));
    if (topLines.length > 0) {
      const maxFont = Math.max(...topLines.map(l => l.fontSize));
      const titleLines = [];
      let started = false;
      for (const l of topLines) {
        if (Math.abs(l.fontSize - maxFont) <= 1.2) {
          titleLines.push(l);
          started = true;
        } else if (started) {
          break;
        }
      }
      if (!detectedTitle && titleLines.length > 0) {
        detectedTitle = titleLines.map(l => l.text).join(' ').replace(/\s+/g, ' ').trim();
      }

      // 2c. Find Author line right below the Title lines
      if (!detectedAuthor && titleLines.length > 0) {
        const lastTitleY = titleLines[titleLines.length - 1].y;
        const candidateAuthorLines = lines.filter(l =>
          l.y < lastTitleY - 2 &&
          l.y > lastTitleY - 140 &&
          l.text.length > 3 &&
          !/^(abstract|summary|introduction|background|keywords|key words|department|university|school of|faculty|hospital|institute|correspondence|email)/i.test(l.text)
        );
        if (candidateAuthorLines.length > 0) {
          const rawAuthorLine = candidateAuthorLines[0].text;
          const firstAuthorChunk = rawAuthorLine.split(/,|;|\band\b|&/i)[0];
          const parsed = extractSurnameFromAuthorString(firstAuthorChunk);
          // A capitalised surname, or one in capitals (SMITH, O'NEILL-JONES) written as Smith, O'Neill-Jones. Names in other
          // scripts are left to the reviewer: the order of family and given name cannot be told from the line.
          // Judged on the surname's last word, so one with particles ("de la Cruz", "van Dijk") is accepted
          const core = parsed.surname ? parsed.surname.split(/\s+/).pop() : '';
          const allCaps = !!core && /^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’-]+$/.test(core);
          if (parsed.surname && (allCaps || /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ-]+/.test(core))) {
            detectedAuthor = allCaps ? parsed.surname.toLowerCase().replace(/(^|[-'’\s])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : parsed.surname;
            // On a title page commas separate authors ("Ann Lee, Bo Kim"); affiliation marks ("Ann Lee1,2*") are taken out first,
            // so one author with two affiliations is not read as several
            detectedEtAl = /,|;|\band\b|&/i.test(rawAuthorLine.replace(/[\d*†‡§¶✉]+(?:\s*,\s*[\d*†‡§¶✉]+)*/g, ''));
          }
        }
      }
    }
  } catch (e) {
    console.warn('Page 1 heuristic parse warning:', e);
  }

  // Stage 3: Filename fallback
  if (!detectedYear && doc.name) {
    const fnYear = doc.name.match(YEAR_RE);
    if (fnYear) detectedYear = fnYear[1];
  }
  if (!detectedAuthor && doc.name) {
    const fnAuthor = doc.name.match(/^([A-Za-zÀ-ÖØ-öø-ÿ-]+?)[_\s-]+(?:et[\s_-]*al[_\s-]+)?(?:19|20)\d{2}/i);
    if (fnAuthor) detectedAuthor = fnAuthor[1];
  }

  if (!stillHere()) return;
  if (!detectedTitle && !detectedAuthor && !detectedYear) {
    showSnackbar('No citation details found in this PDF (it may be a scanned image without OCR). Enter them by hand.'); return;
  }

  if (detectedAuthor) document.getElementById('metaAuthor').value = detectedAuthor;
  if (detectedAuthor) document.getElementById('metaEtAl').checked = detectedEtAl; // "et al." is only judged with an author found
  if (detectedYear) document.getElementById('metaYear').value = detectedYear;
  if (detectedTitle) document.getElementById('metaTitle').value = detectedTitle;

  await saveCurrentMeta();
  showSnackbar(`✨ Auto-filled: ${detectedAuthor || '?'} (${detectedYear || '?'})`);
}

document.getElementById('autoExtractMetaBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  autoExtractCitationFromPdf();
});

// --- F. One-Click Study Ordering for Translation (Chronological / Conceptual Richness) ---
async function sortStudiesByMode(mode) {
  if (state.docs.length < 2) return;
  const oldIndexPaper = getDisplayName(state.docs[0]);
  const oldOrderStr = state.docs.map(d => getDisplayName(d)).join(' ➔ ');
  const oldIds = state.docs.map(d => d.id).join('|'); // by id: two studies can share a display name

  const list = state.docs.slice(); // sorted as a copy: state.docs follows once the order is stored
  if (mode === 'year') {
    list.sort((a, b) => {
      const yA = parseInt(a.year, 10) || 9999;
      const yB = parseInt(b.year, 10) || 9999;
      if (yA !== yB) return yA - yB;
      return (a.author || a.name || '').localeCompare(b.author || b.name || '');
    });
  } else if (mode === 'richness') {
    const richScore = { 'Rich': 3, 'Moderate': 2, 'Thin': 1 };
    // Richness only: quality appraisal is not a ranking criterion for translation order.
    // Studies rated alike keep their current order (stable sort), so an order you set by hand survives the next sort.
    list.sort((a, b) => (richScore[b.richness] || 0) - (richScore[a.richness] || 0));
  }

  const newOrderStr = list.map(d => getDisplayName(d)).join(' ➔ ');
  if (oldIds === list.map(d => d.id).join('|')) {
    showSnackbar('Studies are already in this order.');
    if (mode === 'richness') await offerRichnessTieOrdering();
    return;
  }

  await persistDocOrder(list, auditEntry({
    kind: 'study_order',
    category: 'study_order',
    action: mode === 'year'
      ? 'Sorted Studies Chronologically (by Publication Year) for Translation'
      : 'Sorted Studies by Conceptual Richness for Translation',
    detail: `New Translation Sequence: ${newOrderStr}`,
    fromVal: `#1: ${oldIndexPaper}`,
    toVal: `#1: ${getDisplayName(list[0])}`
  }));
  // Year sort = chronological translation (Atkins et al., 2008); Richness sort = choosing an index paper
  if (mode === 'year' && getOrderStrategy() !== 'chronological') {
    await setOrderStrategy('chronological', { reason: 'Set automatically by the Year▲ sort.' });
  } else if (mode === 'richness' && getOrderStrategy() !== 'index') {
    await setOrderStrategy('index', { reason: 'Set automatically by the Rich★ sort (most conceptually rich study first, as index paper).' });
  }

  renderStudyList();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  showSnackbar(mode === 'year' ? 'Sorted studies chronologically (Year ▲)' : 'Sorted studies by Conceptual Richness (★)');
  if (mode === 'richness') await offerRichnessTieOrdering();
}

// ---- Studies tied on Richness (quality appraisal is never a ranking criterion): let the reviewer decide their order (and so the Index Paper if the top group is tied) ----
function richnessTieGroups() {
  const groups = [];
  let i = 0;
  while (i < state.docs.length) {
    const key = d => d.richness || '';
    let j = i + 1;
    while (j < state.docs.length && key(state.docs[j]) === key(state.docs[i])) j++;
    // Studies without a richness rating are not a meaningful "tie": nothing was rated, so skip them
    if (j - i > 1 && key(state.docs[i]) !== '') groups.push({ start: i, docs: state.docs.slice(i, j) });
    i = j;
  }
  return groups;
}

let richTieWork = null;
function renderRichnessTieModal() {
  const box = document.getElementById('richTieGroups');
  box.innerHTML = '';
  richTieWork.forEach((g, gi) => {
    const first = g.docs[0];
    const wrap = document.createElement('div');
    wrap.className = 'border border-slate-200 rounded-lg p-2 bg-slate-50 space-y-1';
    wrap.innerHTML = `<div class="font-bold text-slate-700">${escapeHtml(first.richness || 'Richness not rated')} <span class="font-normal text-slate-400">(${g.docs.length} tied, positions #${g.start + 1}–#${g.start + g.docs.length})</span>${g.start === 0 ? ' <span class="text-amber-700">· the first one becomes the Index Paper</span>' : ''}</div>`;
    g.docs.forEach((d, di) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 bg-white border border-slate-200 rounded px-2 py-1';
      row.innerHTML = `<span class="truncate" title="${escapeHtml(getDisplayName(d))}"><span class="text-slate-400 font-mono">#${g.start + di + 1}</span> ${escapeHtml(getDisplayName(d))}</span>
        <span class="flex items-center space-x-1 shrink-0">
          <button type="button" class="tie-up px-1.5 py-px bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer" ${di === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="tie-down px-1.5 py-px bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer" ${di === g.docs.length - 1 ? 'disabled' : ''}>▼</button>
        </span>`;
      const swap = (a, b) => { [g.docs[a], g.docs[b]] = [g.docs[b], g.docs[a]]; renderRichnessTieModal(); };
      row.querySelector('.tie-up').onclick = () => swap(di, di - 1);
      row.querySelector('.tie-down').onclick = () => swap(di, di + 1);
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  });
  document.getElementById('richTieReasonWrap').classList.toggle('hidden', !richTieWork.some(g => g.start === 0));
}

function closeRichnessTieModal() {
  const modal = document.getElementById('richTieModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  richTieWork = null;
}

async function offerRichnessTieOrdering() {
  const groups = richnessTieGroups();
  if (groups.length === 0) return;
  richTieWork = groups.map(g => ({ start: g.start, docs: g.docs.slice() }));
  document.getElementById('richTieReason').value = '';
  const modal = document.getElementById('richTieModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  renderRichnessTieModal();
}

document.getElementById('richTieKeepBtn').addEventListener('click', closeRichnessTieModal);
document.getElementById('richTieCloseBtn').addEventListener('click', closeRichnessTieModal);
document.getElementById('richTieApplyBtn').addEventListener('click', async () => {
  if (!richTieWork) return;
  const oldIds = state.docs.map(d => d.id).join('|'); // by id: two studies can share a display name
  const oldIndexPaper = getDisplayName(state.docs[0]);
  const list = state.docs.slice();
  richTieWork.forEach(g => list.splice(g.start, g.docs.length, ...g.docs));
  const newOrderStr = list.map(d => getDisplayName(d)).join(' ➔ ');
  const reason = document.getElementById('richTieReason').value.trim();
  closeRichnessTieModal();
  // The reason is reused in the Methods Summary: stored with the order (or alone, if the order stays)
  const reasonOps = reason ? [{ store: 'meta', put: { ...state.loa, id: 'loa_main', orderRationale: reason, updatedAt: Date.now() } }] : [];
  if (oldIds === list.map(d => d.id).join('|')) {
    // The order stays, but the reasoning about it is a decision too
    if (reason) {
      await saveChange(reasonOps, auditEntry({ kind: 'study_order', category: 'study_order', action: 'Kept the order of studies tied on Conceptual Richness, with a reason', detail: `Translation sequence: ${newOrderStr}`, rationale: reason }));
      showSnackbar('Order kept; the reason is recorded.');
    }
    return;
  }
  await persistDocOrder(list, auditEntry({
    kind: 'study_order',
    category: 'study_order',
    action: 'Ordered studies tied on Conceptual Richness by reviewer judgement',
    detail: `New Translation Sequence: ${newOrderStr}${reason ? '\nReason: ' + reason : ''}`,
    fromVal: `#1: ${oldIndexPaper}`,
    toVal: `#1: ${getDisplayName(list[0])}`,
    rationale: reason
  }), reasonOps);
  renderStudyList();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  showSnackbar('Order of tied studies saved.');
});

document.getElementById('sortStudiesYearBtn')?.addEventListener('click', () => sortStudiesByMode('year'));
document.getElementById('sortStudiesRichBtn')?.addEventListener('click', () => sortStudiesByMode('richness'));

// ========================================================
// TAB 1 RIGHT SIDEBAR RESIZER
// ========================================================
const resizer = document.getElementById('extractResizer');
const rightSidebar = document.getElementById('extractRightSidebar');
let isResizing = false;

if (resizer && rightSidebar) {
  // The width is remembered in this browser, as the pool width in Tab 2 is (kept within the same 320–800 px)
  const savedSidebarWidth = parseInt(lsGet('me_extract_sidebar_width'), 10);
  if (savedSidebarWidth >= 320 && savedSidebarWidth <= 800) rightSidebar.style.width = savedSidebarWidth + 'px';
  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    // Calculate new width: viewport width - mouse X position
    // e.clientX is relative to viewport
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth >= 320 && newWidth <= 800) {
      rightSidebar.style.width = newWidth + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = 'default';
      lsSet('me_extract_sidebar_width', String(parseInt(rightSidebar.style.width, 10) || ''));
    }
  });
}
