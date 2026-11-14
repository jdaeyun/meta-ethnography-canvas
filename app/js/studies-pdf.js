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

async function handleFiles(files) {
  let lastAffectedId = null;
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    // Check if a study stub with the same filename already exists (e.g. from JSON restore)
    const existingStub = state.docs.find(d => d.name && d.name.toLowerCase() === file.name.toLowerCase() && !d.hasBinary);
    if (existingStub) {
      existingStub.hasBinary = true;
      await dbPut('pdf_binaries', { id: existingStub.id, data: buffer });
      await dbPut('docs', existingStub);
      lastAffectedId = existingStub.id;
      continue;
    }

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
    await dbPut('pdf_binaries', { id: docId, data: buffer });
    await dbPut('docs', doc);
    state.docs.push(doc);
    lastAffectedId = doc.id;
  }
  renderStudyList();
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
  const prev = getOrderStrategy();
  if (prev === next) return;
  state.loa = { ...state.loa, id: 'loa_main', orderStrategy: next, updatedAt: Date.now() };
  await dbPut('meta', state.loa);
  const sel = document.getElementById('orderStrategySelect');
  if (sel) sel.value = next;
  await recordAuditLog({
    category: 'study_order',
    action: `Set translation-order strategy: ${ORDER_STRATEGIES[next].label}`,
    detail: reason || 'Changed in the study list.',
    fromVal: ORDER_STRATEGIES[prev].label,
    toVal: ORDER_STRATEGIES[next].label,
    rationale
  });
  renderStudyList();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  if (!divPub.classList.contains('hidden')) renderPublicationView();
}
document.getElementById('orderStrategySelect')?.addEventListener('change', async (e) => {
  const next = e.target.value;
  const why = (prompt(`Translation order: "${ORDER_STRATEGIES[next].label}". Why? (optional — recorded in the audit trail)`) || '').trim();
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
    html += `<span class="text-[11px] px-1.5 py-0.2 rounded border font-semibold ${qColor}" title="Critical Appraisal (${escapeHtml(tool)})">${escapeHtml(tool)}: ${escapeHtml(doc.quality)}</span>`;
  }
  if (doc.richness) {
    const rColor = doc.richness === 'Rich' ? 'bg-indigo-100 text-indigo-800 border-indigo-200' :
                   doc.richness === 'Moderate' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200';
    html += `<span class="text-[11px] px-1.5 py-0.2 rounded border font-semibold ${rColor}" title="Conceptual Depth (Richness)">${escapeHtml(doc.richness)}</span>`;
  }
  return html;
}

async function persistDocOrder() {
  for (let i = 0; i < state.docs.length; i++) {
    state.docs[i].order = i;
    await dbPut('docs', state.docs[i]);
  }
}

async function moveStudyOrder(fromIdx, toIdx) {
  if (toIdx < 0 || toIdx >= state.docs.length || fromIdx === toIdx) return;
  const oldIndexPaper = getDisplayName(state.docs[0]);
  const movedDoc = state.docs[fromIdx];
  const [moved] = state.docs.splice(fromIdx, 1);
  state.docs.splice(toIdx, 0, moved);
  await persistDocOrder();
  const newIndexPaper = getDisplayName(state.docs[0]);

  if (oldIndexPaper !== newIndexPaper) {
    const idxWhy = (prompt(`The #1 study (${firstStudyMeta().long}) has changed. Why? (optional — recorded in the audit trail as the rationale)`) || '').trim();
    await recordAuditLog({
      category: 'study_order',
      rationale: idxWhy,
      action: `Changed the #1 Study (${firstStudyMeta().long})`,
      detail: `Reordered "${getDisplayName(movedDoc)}" from position #${fromIdx + 1} to #${toIdx + 1}.`,
      fromVal: `#1: ${oldIndexPaper}`,
      toVal: `#1: ${newIndexPaper}`
    });
  } else {
    await recordAuditLog({
      category: 'study_order',
      action: 'Reordered Study Sequence for Translation',
      detail: `Moved "${getDisplayName(movedDoc)}" from #${fromIdx + 1} to #${toIdx + 1}.`
    });
  }

  renderStudyList();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
}

function renderStudyList() {
  const list = document.getElementById('studyList');
  list.innerHTML = '';
  document.getElementById('studiesCount').textContent = state.docs.length;

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
          ${isIndexPaper ? `<span class="text-[11px] bg-amber-500 text-white px-1 py-0.2 rounded font-bold uppercase shrink-0" title="First column in Synthesis Matrix (${escapeHtml(firstStudyMeta().label)})">${escapeHtml(firstStudyMeta().badge)}</span>` : ''}
          <span class="truncate">${escapeHtml(dName)}</span>
        </div>
        ${doc.setting ? `<div class="text-xs text-slate-500 font-normal truncate mt-0.5 pl-4"><i class="ph ph-map-pin mr-0.5"></i>${escapeHtml(doc.setting)}</div>` : ''}
        ${badges ? `<div class="flex flex-wrap gap-1 mt-1 pl-4">${badges}</div>` : ''}
      </div>
      <button class="del text-slate-400 hover:text-rose-500 px-1 shrink-0 cursor-pointer"><i class="ph ph-trash"></i></button>
    `;

    item.addEventListener('click', (e) => { if (!e.target.closest('.del')) switchStudy(doc.id); });
    item.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this study and its extracted constructs? (You can Undo with Ctrl+Z; the deletion is recorded in the Audit Trail)')) {
        const wasIndex = idx === 0;
        const binRec = await dbGet('pdf_binaries', doc.id);
        const toDel = state.annotations.filter(a => a.docId === doc.id);
        const why = (prompt('Why is this study being removed? (optional — recorded in the audit trail as the rationale)') || '').trim();
        pushUndoAction({
          type: 'delete_study',
          label: `Study (${getDisplayName(doc)})`,
          doc: JSON.parse(JSON.stringify(doc)),
          binary: binRec && binRec.data ? binRec.data : null,
          annotations: toDel.map(a => JSON.parse(JSON.stringify(a))),
          position: idx
        });
        await dbDelete('docs', doc.id);
        await dbDelete('pdf_binaries', doc.id);
        state.docs = state.docs.filter(d => d.id !== doc.id);
        await persistDocOrder();
        for (let a of toDel) await dbDelete('annotations', a.id);
        state.annotations = state.annotations.filter(a => a.docId !== doc.id);
        await recordAuditLog({
          category: 'study_order',
          rationale: why,
          action: `Removed Study from the Synthesis: ${getDisplayName(doc)}${wasIndex ? ' (was the #1 study)' : ''}`,
          detail: `"${doc.title || doc.name}" was deleted together with ${toDel.length} extracted construct(s)/quote(s).${wasIndex && state.docs[0] ? ` New #1 study: ${getDisplayName(state.docs[0])}.` : ''}`,
          fromVal: `${state.docs.length + 1} studies`,
          toVal: `${state.docs.length} studies`
        });
        if (state.activeDocId === doc.id) state.activeDocId = state.docs[0]?.id || null;
        renderStudyList();
        if (state.activeDocId) switchStudy(state.activeDocId);
        else {
          renderWelcomeGuideIfNeeded();
          updateDocHeaderUI();
          updateSidebar();
        }
      }
    });
    list.appendChild(item);
  });
}

let switchStudyToken = 0;
async function switchStudy(id) {
  flushAllPendingSaves();
  const doc = state.docs.find(d => d.id === id);
  if (!doc) return;
  // Each call gets a token; an older call that resumes after a newer one started simply stops (prevents duplicated pages on rapid clicks/zoom)
  const myToken = ++switchStudyToken;
  const isStale = () => myToken !== switchStudyToken;
  state.activeDocId = id;
  renderStudyList();
  updateDocHeaderUI();
  populateMetaEditInputs();

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
      enableXfa: true
    }).promise;
    if (isStale()) { try { await loadedPdf.destroy(); } catch (e) {} return; }
    state.activePdfDoc = loadedPdf;
    wrapper.innerHTML = '';

    const numPages = state.activePdfDoc.numPages;
    document.getElementById('pdfPageCountLabel').textContent = `${numPages} page${numPages > 1 ? 's' : ''}`;
    document.getElementById('zoomPercentInput').value = Math.round(state.scale * 100);

    // Fetch exact per-page viewport dimensions in parallel so landscape/portrait pages size accurately
    const pageViewports = await Promise.all(
      Array.from({ length: numPages }, (_, idx) =>
        loadedPdf.getPage(idx + 1).then(p => p.getViewport({ scale: state.scale }))
      )
    );
    if (isStale()) return;

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
  await switchStudy(state.activeDocId);
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

  // Force immediate render of target page if not yet lazily rendered
  if (!pageContainer.dataset.rendered && !pageContainer.dataset.rendering) {
    await renderPageContent(pageContainer, targetPage);
  }

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
  document.getElementById('metaSetting').value = doc.setting || '';
  document.getElementById('metaParticipants').value = doc.participants || '';
  document.getElementById('metaMethodology').value = doc.methodology || '';
  document.getElementById('metaFunder').value = doc.funder || '';
  const compSel = document.getElementById('metaCompanionOf');
  compSel.innerHTML = '<option value="">— separate study —</option>' + state.docs.filter(d => d.id !== doc.id)
    .map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(getDisplayName(d))}</option>`).join('');
  compSel.value = (doc.companionOf && state.docs.some(d => d.id === doc.companionOf)) ? doc.companionOf : '';
  document.getElementById('metaAppraisalTool').value = doc.appraisalTool || 'CASP';
  document.getElementById('metaQuality').value = doc.quality || '';
  document.getElementById('metaRichness').value = doc.richness || '';
  document.getElementById('metaContextNote').value = doc.contextNote || '';
  document.getElementById('metaStudyOverview').value = doc.studyOverview || '';
}

async function saveCurrentMeta() {
  const doc = state.docs.find(d => d.id === state.activeDocId);
  if (!doc) return;
  normalizeDoc(doc);

  const prevSummary = `${doc.appraisalTool}:${doc.quality || 'None'}| Richness:${doc.richness || 'None'}`;
  const prevCompanion = doc.companionOf || '';
  const prevOverview = doc.studyOverview || '';

  doc.author = document.getElementById('metaAuthor').value.trim();
  doc.etAl = document.getElementById('metaEtAl').checked;
  doc.year = document.getElementById('metaYear').value.trim();
  doc.title = document.getElementById('metaTitle').value.trim();
  doc.setting = document.getElementById('metaSetting').value.trim();
  doc.participants = document.getElementById('metaParticipants').value.trim();
  doc.methodology = document.getElementById('metaMethodology').value.trim();
  doc.appraisalTool = document.getElementById('metaAppraisalTool').value || 'CASP';
  doc.quality = document.getElementById('metaQuality').value;
  doc.richness = document.getElementById('metaRichness').value;
  doc.contextNote = document.getElementById('metaContextNote').value.trim();
  doc.funder = document.getElementById('metaFunder').value.trim();
  doc.companionOf = document.getElementById('metaCompanionOf').value || '';
  doc.studyOverview = document.getElementById('metaStudyOverview').value.trim();

  const newSummary = `${doc.appraisalTool}:${doc.quality || 'None'}| Richness:${doc.richness || 'None'}`;

  await dbPut('docs', doc);

  if (prevSummary !== newSummary) {
    await recordAuditLog({
      category: 'context_appraisal',
      action: `Updated Critical Appraisal / Richness for ${getDisplayName(doc)}`,
      detail: `Setting: ${doc.setting || '-'} | Sample: ${doc.participants || '-'} | Note: ${doc.contextNote || '-'}`,
      fromVal: prevSummary,
      toVal: newSummary
    });
  }

  if (prevOverview !== doc.studyOverview) {
    await recordAuditLog({
      category: 'reading_extraction',
      action: `${prevOverview ? 'Revised' : 'Wrote'} Study Overview / Key Metaphors for ${getDisplayName(doc)}`,
      detail: 'Phase 3–4: the account read as a whole (storyline, key metaphors and how they relate) before / alongside construct extraction.',
      fromVal: prevOverview || '(Empty)',
      toVal: doc.studyOverview || '(Empty)'
    });
  }

  if (prevCompanion !== doc.companionOf) {
    const other = state.docs.find(d => d.id === doc.companionOf);
    await recordAuditLog({
      category: 'context_appraisal',
      action: doc.companionOf ? `Linked ${getDisplayName(doc)} as a companion paper (same primary study)` : `Unlinked companion paper: ${getDisplayName(doc)}`,
      detail: doc.companionOf ? `Same primary study as ${getDisplayName(other)} (eMERGe item 10).` : '',
      fromVal: prevCompanion ? getDisplayName(state.docs.find(d => d.id === prevCompanion)) : '(separate study)',
      toVal: other ? getDisplayName(other) : '(separate study)'
    });
  }

  renderStudyList();
  updateDocHeaderUI();
  if (prevOverview !== doc.studyOverview) updateSidebar();
}

// Companion papers (eMERGe item 10): text describing linked accounts of the same primary study
function companionText(d) {
  const links = new Set();
  if (d.companionOf && state.docs.some(x => x.id === d.companionOf)) links.add(d.companionOf);
  state.docs.forEach(x => { if (x.companionOf === d.id) links.add(x.id); });
  return [...links].map(id => getDisplayName(state.docs.find(x => x.id === id))).join('; ');
}
function funderLinkedText(d) {
  const parts = [];
  parts.push(d.funder ? 'Funder: ' + d.funder : 'Funder: not recorded');
  const c = companionText(d);
  if (c) parts.push('Same study as: ' + c);
  return parts.join(' | ');
}

document.getElementById('saveMetaBtn').addEventListener('click', async () => {
  await saveCurrentMeta();
  state.isEditMetaMode = false;
  toggleMetaDockUI();
});

['metaEtAl', 'metaAppraisalTool', 'metaQuality', 'metaRichness', 'metaCompanionOf'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => saveCurrentMeta());
});

document.querySelectorAll('.meta-drop-target').forEach(input => {
  input.addEventListener('dragover', e => {
    e.preventDefault();
    input.classList.add('drop-input-active');
  });
  input.addEventListener('dragleave', () => input.classList.remove('drop-input-active'));
  input.addEventListener('drop', async e => {
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

async function renderPageContent(container, num) {
  if (!state.activePdfDoc || container.dataset.rendered || container.dataset.rendering) return;
  container.dataset.rendering = 'true';
  try {
    const page = await state.activePdfDoc.getPage(num);
    const vp = page.getViewport({ scale: state.scale });
    container.style.width = vp.width + 'px';
    container.style.height = vp.height + 'px';
    container.style.setProperty('--scale-factor', state.scale);

    const placeholder = container.querySelector('.page-loading-placeholder');
    if (placeholder) placeholder.remove();

    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;

    const hlLayer = container.querySelector('.highlight-layer');
    container.insertBefore(canvas, hlLayer);

    const txtLayer = document.createElement('div');
    txtLayer.className = 'textLayer';
    txtLayer.style.width = vp.width + 'px';
    txtLayer.style.height = vp.height + 'px';
    txtLayer.style.setProperty('--scale-factor', state.scale);
    container.appendChild(txtLayer);

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const textContent = await page.getTextContent();
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
    console.error('Error rendering page ' + num, e);
  }
}

document.addEventListener('mouseup', (e) => {
  const tt = document.getElementById('selectionTooltip');
  if (tt.contains(e.target)) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !state.activeDocId) return tt.classList.add('hidden');

  const range = sel.getRangeAt(0);
  const txt = range.toString().normalize('NFC').trim();
  if (!txt) return tt.classList.add('hidden');

  const rects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
  if (!rects.length) return;

  // Map rects to pages
  const pageRectsMap = {};
  let firstPage = null;
  let lastPage = null;
  let lastRect = rects[rects.length - 1];

  rects.forEach(r => {
    // Find the page container under the centre of this rect
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let el = document.elementFromPoint(cx, cy);
    while (el && !el.classList?.contains('page-container')) el = el.parentElement;
    
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

  // Step 2: Clamp vertical overlap between consecutive lines so bands never double-darken
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const horizOverlap = Math.min(prev.right, curr.right) - Math.max(prev.left, curr.left);
    if (horizOverlap > 0 && curr.top < prev.bottom) {
      const mid = (prev.bottom + curr.top) / 2;
      prev.bottom = mid;
      curr.top = mid;
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
  const a = normalizeAnnotation({
    id: 'a_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    docId: state.activeDocId,
    type,
    by: state.reviewerId || 'Reviewer',
    text: stripOuterQuotes(state.pendingSelection.txt),
    page: state.pendingSelection.page,
    firstPage: state.pendingSelection.firstPage,
    rectsMap: state.pendingSelection.rectsMap, // multi-page rects
    note: '',
    nuanceNote: '',
    concordanceStatus: 'pending',
    concordanceNote: '',
    clusterIds: [],
    clusterComments: {}
  });
  await dbPut('annotations', a);
  state.annotations.push(a);
  document.getElementById('selectionTooltip').classList.add('hidden');
  window.getSelection().removeAllRanges();
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
        b.onclick = () => {
          const cardEl = document.querySelector(`[data-sidebar-anno="${CSS.escape(a.id)}"]`);
          if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            cardEl.classList.add('ring-2', 'ring-amber-400');
            setTimeout(() => cardEl.classList.remove('ring-2', 'ring-amber-400'), 1400);
          }
        };
        layer.appendChild(b);
      });
    }
    });
  });
}

// --- D. Full-PDF Keyword Search across Lazy-Rendered Pages ---
const pdfSearchState = {
  docId: null,
  pageTexts: [], // [{ pageNum, text }]
  matches: [],   // [pageNum, ...]
  activeIdx: -1,
  lastQuery: ''
};

async function ensurePdfTextIndex() {
  if (!state.activePdfDoc || !state.activeDocId) return [];
  if (pdfSearchState.docId === state.activeDocId && pdfSearchState.pageTexts.length > 0) {
    return pdfSearchState.pageTexts;
  }
  const numPages = state.activePdfDoc.numPages;
  const pageTexts = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await state.activePdfDoc.getPage(i);
    const tc = await page.getTextContent();
    const joined = tc.items.map(item => item.str).join(' ').normalize('NFC').toLowerCase();
    pageTexts.push({ pageNum: i, text: joined });
  }
  pdfSearchState.docId = state.activeDocId;
  pdfSearchState.pageTexts = pageTexts;
  return pageTexts;
}

async function runPdfSearch(query, direction = 1) {
  const statusEl = document.getElementById('pdfSearchStatus');
  const prevBtn = document.getElementById('pdfSearchPrevBtn');
  const nextBtn = document.getElementById('pdfSearchNextBtn');
  const clearBtn = document.getElementById('pdfSearchClearBtn');
  const q = (query || '').normalize('NFC').trim().toLowerCase();

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

  if (!pageContainer.dataset.rendered && !pageContainer.dataset.rendering) {
    await renderPageContent(pageContainer, targetPage);
  }

  const q = (queryStr || document.getElementById('pdfSearchInput')?.value || '').normalize('NFC').trim().toLowerCase();
  const spans = Array.from(pageContainer.querySelectorAll('.textLayer span'));
  const hitSpan = spans.find(s => s.textContent.normalize('NFC').toLowerCase().includes(q));
  if (hitSpan) {
    hitSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
    spans.forEach(s => {
      if (s.textContent.normalize('NFC').toLowerCase().includes(q)) {
        s.style.backgroundColor = 'rgba(250, 204, 21, 0.55)';
        s.style.borderRadius = '2px';
        setTimeout(() => { s.style.backgroundColor = ''; }, 2200);
      }
    });
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
function extractSurnameFromAuthorString(rawAuthor) {
  if (!rawAuthor) return { surname: '', hasEtAl: true };
  const cleaned = String(rawAuthor)
    .replace(/[\d*†‡§¶✉]/g, '')
    .replace(/\b(MD|PhD|RN|PharmD|MSc|MPH|BSc|Prof|Dr)\b\.?/gi, '')
    .trim();
  const multiAuthors = /;|,|\band\b|&/i.test(cleaned);
  const firstChunk = cleaned.split(/;|\band\b|&/i)[0].trim();
  if (firstChunk.includes(',')) {
    // "Surname, GivenName" format
    const surname = firstChunk.split(',')[0].trim().replace(/\s+[A-Z]{1,3}\.?$/, ''); // "Hernandez M" -> "Hernandez"
    return { surname, hasEtAl: multiAuthors || cleaned.split(',').length > 2 };
  }
  const parts = firstChunk.split(/\s+/).filter(Boolean);
  // Vancouver style ("Hamdan A"): trailing initials -> surname is the first token
  const initialsLast = parts.length > 1 && /^[A-Z]{1,3}\.?$/.test(parts[parts.length - 1]);
  const surname = parts.length > 0 ? (initialsLast ? parts[0] : parts[parts.length - 1]) : '';
  return { surname, hasEtAl: multiAuthors };
}

async function autoExtractCitationFromPdf() {
  const doc = state.docs.find(d => d.id === state.activeDocId);
  if (!doc || !state.activePdfDoc) {
    return alert('Please load a PDF binary first.');
  }

  let detectedTitle = '';
  let detectedAuthor = '';
  let detectedEtAl = true;
  let detectedYear = '';

  // Stage 1: Check embedded PDF Info Dict & XMP Metadata
  try {
    const meta = await state.activePdfDoc.getMetadata();
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

    const rawDate = (xmp && (xmp.get('prism:publicationDate') || xmp.get('dc:date') || xmp.get('xap:CreateDate'))) || info.CreationDate || '';
    const dateMatch = String(rawDate).match(/(?<!\d)(19[89]\d|20[0-3]\d)(?!\d)/);
    if (dateMatch) detectedYear = dateMatch[1];
  } catch (e) {
    console.warn('Metadata read warning:', e);
  }

  // Stage 2: Page 1 Visual Layout & Font-Height Heuristics
  try {
    const page1 = await state.activePdfDoc.getPage(1);
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
    const yearMatches = fullPage1Text.match(/(?<!\d)(19[89]\d|20[0-2]\d)(?!\d)/g);
    if (yearMatches && yearMatches.length > 0) {
      // Prefer year near copyright/received/published keywords
      const pubContextMatch = fullPage1Text.match(/(?:published|accepted|received|©|copyright|\()\s*(?:[a-z]+\s+\d{1,2},?\s*)?(19[89]\d|20[0-2]\d)/i);
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
          if (parsed.surname && /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ-]+/.test(parsed.surname)) {
            detectedAuthor = parsed.surname;
            detectedEtAl = /,|;|\band\b|&/i.test(rawAuthorLine);
          }
        }
      }
    }
  } catch (e) {
    console.warn('Page 1 heuristic parse warning:', e);
  }

  // Stage 3: Filename fallback
  if (!detectedYear && doc.name) {
    const fnYear = doc.name.match(/(?<!\d)(19[89]\d|20[0-2]\d)(?!\d)/);
    if (fnYear) detectedYear = fnYear[1];
  }
  if (!detectedAuthor && doc.name) {
    const fnAuthor = doc.name.match(/^([A-Za-zÀ-ÖØ-öø-ÿ-]+?)[_\s-]+(?:et[\s_-]*al[_\s-]+)?(?:19|20)\d{2}/i);
    if (fnAuthor) detectedAuthor = fnAuthor[1];
  }

  if (!detectedTitle && !detectedAuthor && !detectedYear) {
    return alert('Could not auto-detect citation metadata from this PDF (it may be a scanned image without OCR).');
  }

  if (detectedAuthor) document.getElementById('metaAuthor').value = detectedAuthor;
  document.getElementById('metaEtAl').checked = detectedEtAl;
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

  if (mode === 'year') {
    state.docs.sort((a, b) => {
      const yA = parseInt(a.year, 10) || 9999;
      const yB = parseInt(b.year, 10) || 9999;
      if (yA !== yB) return yA - yB;
      return (a.author || a.name || '').localeCompare(b.author || b.name || '');
    });
  } else if (mode === 'richness') {
    // Conceptual richness only: methodological quality is a separate judgement and does not choose the index paper.
    // Ties keep the current (reviewer-chosen) order, so the reviewer decides between equally rich studies.
    const richScore = { 'Rich': 3, 'Moderate': 2, 'Thin': 1 };
    state.docs.sort((a, b) => (richScore[b.richness] || 0) - (richScore[a.richness] || 0));
  }

  const newOrderStr = state.docs.map(d => getDisplayName(d)).join(' ➔ ');
  if (oldOrderStr === newOrderStr) {
    showSnackbar('Studies are already in this order.');
    return;
  }

  await persistDocOrder();
  const newIndexPaper = getDisplayName(state.docs[0]);

  await recordAuditLog({
    category: 'study_order',
    action: mode === 'year'
      ? 'Sorted Studies Chronologically (by Publication Year) for Translation'
      : 'Sorted Studies by Conceptual Richness for Translation',
    detail: `New Translation Sequence: ${newOrderStr}${mode === 'richness' ? '\n(Richness only; methodological quality was not used to order studies. Equally rich studies keep their previous order.)' : ''}`,
    fromVal: `#1: ${oldIndexPaper}`,
    toVal: `#1: ${newIndexPaper}`
  });
  // Year sort = chronological translation (Atkins et al., 2008); Richness sort = choosing an index paper
  if (mode === 'year' && getOrderStrategy() !== 'chronological') {
    await setOrderStrategy('chronological', { reason: 'Set automatically by the Year▲ sort.' });
  } else if (mode === 'richness' && getOrderStrategy() !== 'index') {
    await setOrderStrategy('index', { reason: 'Set automatically by the Rich★ sort (most conceptually rich study first, as index paper).' });
  }

  renderStudyList();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  showSnackbar(mode === 'year' ? 'Sorted studies chronologically (Year ▲)' : 'Sorted studies by conceptual richness (★)');
}

document.getElementById('sortStudiesYearBtn')?.addEventListener('click', () => sortStudiesByMode('year'));
document.getElementById('sortStudiesRichBtn')?.addEventListener('click', () => sortStudiesByMode('richness'));

// ========================================================
// TAB 1 RIGHT SIDEBAR RESIZER
// ========================================================
const resizer = document.getElementById('extractResizer');
const rightSidebar = document.getElementById('extractRightSidebar');
let isResizing = false;

if (resizer && rightSidebar) {
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
    }
  });
}
