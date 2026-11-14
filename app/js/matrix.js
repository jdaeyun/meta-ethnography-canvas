// Meta-Ethnography Canvas — Synthesis matrix (Tab 2)
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// 2nd order pool, 3rd order rows (synthesis / GRADE-CERQual / team tabs), #1 study auto-placement, paper visibility, row reordering, pool resizer.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// SYNTHESIS MATRIX & COMPACT 3-TAB ROW HEADER
// ========================================================
document.getElementById('showAssignedToggle').addEventListener('change', () => renderSecondOrderPool());
document.getElementById('toggleContextRow').addEventListener('change', (e) => {
  state.showContextRow = e.target.checked;
  renderMatrixTable();
});
document.getElementById('matrixCompactToggle').addEventListener('change', (e) => {
  state.matrixCompactMode = e.target.checked;
  const t = document.getElementById('matrixTable');
  if (t) t.classList.toggle('matrix-compact', state.matrixCompactMode);
});
document.getElementById('matrixRefutationalOnlyToggle').addEventListener('change', (e) => {
  state.matrixRefutationalOnly = e.target.checked;
  renderMatrixTable();
});
document.getElementById('poolSearchInput').addEventListener('input', (e) => {
  state.poolSearchQuery = e.target.value.trim().toLowerCase();
  document.getElementById('clearPoolSearchBtn').classList.toggle('hidden', !state.poolSearchQuery);
  renderSecondOrderPool();
});
document.getElementById('clearPoolSearchBtn').addEventListener('click', () => {
  const inp = document.getElementById('poolSearchInput');
  inp.value = '';
  state.poolSearchQuery = '';
  document.getElementById('clearPoolSearchBtn').classList.add('hidden');
  renderSecondOrderPool();
});
document.getElementById('poolStudyFilter').addEventListener('change', (e) => {
  state.poolStudyFilter = e.target.value;
  renderSecondOrderPool();
});
document.getElementById('poolRefutationalToggle').addEventListener('change', (e) => {
  state.poolRefutationalOnly = e.target.checked;
  renderSecondOrderPool();
});

const handleAddMatrixRow = async (scrollToBottom = false) => {
  await createNewClusterRow();
  renderMatrixView();
  if (scrollToBottom) {
    const bottomBtn = document.getElementById('addMatrixRowBottomBtn');
    bottomBtn?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
};
document.getElementById('addMatrixRowBtn').addEventListener('click', () => handleAddMatrixRow(false));
document.getElementById('addMatrixRowBottomBtn')?.addEventListener('click', () => handleAddMatrixRow(true));

async function createNewClusterRow(initialTitle = '', opts = {}) {
  const cluster = normalizeCluster({
    id: 'cl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    by: state.reviewerId || 'Reviewer',
    thirdOrderTitle: initialTitle,
    translationSummary: '',
    synthesisNote: '',
    concordanceStatus: 'pending',
    concordanceNote: '',
    cerqualLimitations: 'Not assessed',
    cerqualCoherence: 'Not assessed',
    cerqualAdequacy: 'Not assessed',
    cerqualRelevance: 'Not assessed',
    cerqualConfidence: 'Not assessed',
    cerqualExplanation: '',
    cerqualLimNote: '', cerqualCohNote: '', cerqualAdeqNote: '', cerqualRelNote: '',
    order: state.clusters.length,
    createdAt: Date.now()
  });
  await dbPut('clusters', cluster);
  state.clusters.push(cluster);
  if (!opts.silent) {
    await recordAuditLog({
      clusterIds: [cluster.id],
      category: 'third_order',
      action: 'Created New 3rd Order Concept Cluster (Row)',
      toVal: initialTitle || '(Untitled Concept Row)'
    });
  }
  return cluster;
}

async function assignSecondOrderToCluster(sec, cluster) {
  normalizeAnnotation(sec);
  if (sec.clusterIds.includes(cluster.id)) return;
  normalizeCluster(cluster);
  const rowWasEmpty = !state.annotations.some(a => a.type === 'second_order' && a.id !== sec.id && Array.isArray(a.clusterIds) && a.clusterIds.includes(cluster.id));
  sec.clusterIds.push(cluster.id);
  // No relation is assumed: the cell stays "not yet judged" until the reviewer decides (Phase 4–5)
  if (!sec.clusterRelations) sec.clusterRelations = {};
  await dbPut('annotations', sec);

  let clusterChanged = false;
  if (cluster.emptyCells[sec.docId]) { delete cluster.emptyCells[sec.docId]; clusterChanged = true; }
  const opensRowBeyondFirst = rowWasEmpty && !cluster.originDocId && !isBaselineDocId(sec.docId);
  if (opensRowBeyondFirst) { cluster.originDocId = sec.docId; clusterChanged = true; }
  if (clusterChanged) await dbPut('clusters', cluster);

  const doc = state.docs.find(d => d.id === sec.docId);
  await recordAuditLog({
    clusterIds: [cluster.id],
    category: 'matrix_mapping',
    action: `Mapped 2nd Order Construct into 3rd Order Cluster`,
    detail: `${getDisplayName(doc)} (p.${sec.page}): ${sec.note ? sec.note + ' — ' : ''}"${sec.text.slice(0, 75)}..."`,
    toVal: `Cluster: ${cluster.thirdOrderTitle || '(Untitled Row)'} [Total mapped rows: ${sec.clusterIds.length}]`,
    isMinorOp: true
  });
  if (opensRowBeyondFirst) {
    const pos = state.docs.findIndex(d => d.id === sec.docId) + 1;
    await recordAuditLog({
      clusterIds: [cluster.id],
      category: 'translation_process',
      action: `New concept emerged in translation: study #${pos} (${getDisplayName(doc)}) opened 3rd Order row "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
      detail: `${sec.note ? sec.note + ' — ' : ''}"${secEvidenceText(sec).slice(0, 120)}" (p.${sec.page})`,
      rationale: 'This concept was not present in study #1; translating later studies extended the synthesis rather than fitting into existing rows.'
    });
  }
}

async function removeSecondOrderFromCluster(sec, cluster) {
  normalizeAnnotation(sec);
  pushUndoAction({
    type: 'unassign_cluster',
    label: `Unassign "${(sec.note || sec.text).slice(0, 28)}" from "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
    secId: sec.id,
    clusterId: cluster.id,
    prevRelation: sec.clusterRelations ? sec.clusterRelations[cluster.id] : undefined,
    prevComment: sec.clusterComments ? sec.clusterComments[cluster.id] : ''
  });
  sec.clusterIds = sec.clusterIds.filter(id => id !== cluster.id);
  await dbPut('annotations', sec);

  const doc = state.docs.find(d => d.id === sec.docId);
  await recordAuditLog({
    clusterIds: [cluster.id],
    category: 'matrix_mapping',
    action: `Removed 2nd Order Construct from 3rd Order Cluster`,
    detail: `${getDisplayName(doc)} (p.${sec.page}): ${sec.note || '"' + sec.text.slice(0, 60) + '..."'}`,
    fromVal: `Cluster: ${cluster.thirdOrderTitle || '(Untitled Row)'}`,
    isMinorOp: true
  });
}

const newClusterDropZone = document.getElementById('newClusterDropZone');
newClusterDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  newClusterDropZone.classList.add('bg-indigo-100', 'border-indigo-500');
});
newClusterDropZone.addEventListener('dragleave', () => {
  newClusterDropZone.classList.remove('bg-indigo-100', 'border-indigo-500');
});
newClusterDropZone.addEventListener('drop', async e => {
  e.preventDefault();
  newClusterDropZone.classList.remove('bg-indigo-100', 'border-indigo-500');
  let secId = e.dataTransfer.getData('text/sec-id');
  let sec = state.annotations.find(a => a.id === secId && a.type === 'second_order');
  if (!sec) {
    const firstId = e.dataTransfer.getData('text/unlinked-first-id');
    const f = state.annotations.find(a => a.id === firstId && a.type === 'first_order');
    if (f) sec = await wrapFirstOrderInSecondOrder(f);
  }
  if (!sec) return;
  const newCluster = await createNewClusterRow(sec.note || '');
  await assignSecondOrderToCluster(sec, newCluster);
  renderMatrixView();
});

function computeClusterEvidenceStats(clusterId) {
  const mappedSecs = state.annotations.filter(a => a.type === 'second_order' && normalizeAnnotation(a).clusterIds.includes(clusterId));
  const docIds = [...new Set(mappedSecs.map(s => s.docId))];
  const contributingDocs = docIds.map(id => state.docs.find(d => d.id === id)).filter(Boolean);
  const quoteCount = uniqueQuotesOf(mappedSecs).length; // a quote linked to two constructs in this row counts once

  return {
    studiesCount: contributingDocs.length,
    secCount: mappedSecs.length,
    quoteCount,
    contributingDocs
  };
}

function renderMatrixView() {
  renderStudyVisibilityBar();
  renderSecondOrderPool();
  renderMatrixTable();
  if (state.autoSeedIndex && !divMatrix.classList.contains('hidden')) {
    seedIndexPaperRows().then(changed => {
      if (changed) {
        renderLoaClusterChips();
        renderSecondOrderPool();
        renderMatrixTable();
      }
    });
  }
}

// ---- Index Paper auto-placement: each 2nd Order construct of the Index Paper (#1) becomes an initial 3rd Order row, once ----
let indexSeedBusy = false;
async function seedIndexPaperRows() {
  if (!state.autoSeedIndex || indexSeedBusy || state.docs.length === 0) return false;
  indexSeedBusy = true;
  try {
    const indexDoc = state.docs[0];
    const fresh = state.annotations
      .filter(a => a.type === 'second_order' && a.docId === indexDoc.id)
      .map(normalizeAnnotation)
      .filter(sec => !sec.indexSeeded)
      .sort((a, b) => ((a.firstPage || parseInt(a.page, 10) || 0) - (b.firstPage || parseInt(b.page, 10) || 0)) || String(a.id).localeCompare(String(b.id)));
    if (fresh.length === 0) return false;

    const created = [];
    const createdIds = [];
    for (const sec of fresh) {
      if (liveClusterIds(sec).length === 0) {
        const fallback = String(sec.text || '').replace(/^\[Concept derived[^\]]*\]:\s*/, '').replace(/^"+|"+$/g, '').trim();
        const title = ((sec.note || '').trim() || fallback).slice(0, 80);
        const cluster = await createNewClusterRow(title, { silent: true });
        cluster.autoSeeded = true;
        cluster.seededFromId = sec.id;
        await dbPut('clusters', cluster);
        await assignSecondOrderToCluster(sec, cluster);
        created.push(`${title} (p.${sec.page})`);
        createdIds.push(cluster.id);
      }
      sec.indexSeeded = true; // seeded or already placed: never auto-place this construct again (even if the row is later deleted)
      await dbPut('annotations', sec);
    }
    if (created.length > 0) {
      await recordAuditLog({
        clusterIds: createdIds,
        category: 'matrix_mapping',
        action: `Auto-placed ${created.length} 2nd Order construct(s) of the #1 study (${getDisplayName(indexDoc)}; ${firstStudyMeta().long}) as initial 3rd Order rows`,
        detail: created.map(t => '• ' + t).join('\n'),
        rationale: 'The #1 study\'s concepts seed the translation; later studies are translated into these rows.'
      });
      showSnackbar(`Placed ${created.length} concept(s) from study #1 as provisional rows.`);
    }
    return created.length > 0;
  } finally {
    indexSeedBusy = false;
  }
}

const autoSeedToggleEl = document.getElementById('autoSeedIndexToggle');
autoSeedToggleEl.checked = state.autoSeedIndex;
autoSeedToggleEl.addEventListener('change', () => {
  state.autoSeedIndex = autoSeedToggleEl.checked;
  localStorage.setItem('me_auto_seed_index', String(state.autoSeedIndex));
  if (state.autoSeedIndex) renderMatrixView();
});

// ---- Paper visibility (focus mode for Tab 2) ----
function visibleDocCount() { return state.docs.filter(d => !state.hiddenStudyIds.has(d.id)).length; }
function saveHiddenStudies() {
  try { localStorage.setItem('me_hidden_studies', JSON.stringify([...state.hiddenStudyIds])); } catch (e) { /* ignore */ }
}
function refreshAfterVisibilityChange() {
  saveHiddenStudies();
  renderStudyVisibilityBar();
  renderSecondOrderPool();
  renderMatrixTable();
}
function toggleStudyVisible(docId) {
  if (state.hiddenStudyIds.has(docId)) {
    state.hiddenStudyIds.delete(docId);
  } else {
    if (visibleDocCount() <= 1) { showSnackbar('At least one paper must stay visible.'); return; }
    state.hiddenStudyIds.add(docId);
  }
  refreshAfterVisibilityChange();
}
function renderStudyVisibilityBar() {
  const bar = document.getElementById('studyVisibilityBar');
  if (!bar) return;
  const ids = new Set(state.docs.map(d => d.id));
  [...state.hiddenStudyIds].forEach(id => { if (!ids.has(id)) state.hiddenStudyIds.delete(id); });
  if (state.docs.length === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const hiddenCount = state.docs.length - visibleDocCount();
  bar.innerHTML = '<span class="font-bold text-slate-600 mr-1"><i class="ph ph-eye"></i> Papers on view:</span>';
  state.docs.forEach((d, idx) => {
    const hidden = state.hiddenStudyIds.has(d.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-2 py-0.5 rounded-full border font-semibold cursor-pointer transition flex items-center space-x-1 ' +
      (hidden ? 'bg-slate-100 text-slate-400 border-slate-200 line-through' : (idx === 0 ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-indigo-50 text-indigo-800 border-indigo-200'));
    btn.title = hidden ? 'Click to show this paper' : 'Click to hide this paper';
    btn.innerHTML = `<i class="ph ${hidden ? 'ph-eye-slash' : 'ph-eye'}"></i><span>${idx === 0 ? '★ ' : '#' + (idx + 1) + ' '}${escapeHtml(getDisplayName(d))}</span>`;
    btn.onclick = () => toggleStudyVisible(d.id);
    bar.appendChild(btn);
  });
  const mk = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 cursor-pointer';
    b.textContent = label; b.title = title; b.onclick = fn;
    return b;
  };
  const sep = document.createElement('span'); sep.className = 'w-px h-4 bg-slate-200 mx-1'; bar.appendChild(sep);
  bar.appendChild(mk('Show all', 'Show every paper', () => { state.hiddenStudyIds.clear(); refreshAfterVisibilityChange(); }));
  bar.appendChild(mk('#1 only', 'Show only study #1', () => {
    state.hiddenStudyIds = new Set(state.docs.slice(1).map(d => d.id));
    refreshAfterVisibilityChange();
  }));
  if (hiddenCount > 0) {
    const note = document.createElement('span');
    note.className = 'text-slate-400 ml-1';
    note.textContent = `${hiddenCount} hidden (their concepts are also hidden from the pool; exports are unaffected)`;
    bar.appendChild(note);
  }
}

function populatePoolStudyFilter() {
  const sel = document.getElementById('poolStudyFilter');
  if (!sel) return;
  const prev = state.poolStudyFilter || 'all';
  sel.innerHTML = '<option value="all">All Studies (' + state.docs.length + ')</option>';
  state.docs.forEach((d, idx) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `#${idx + 1}: ${getDisplayName(d)}`;
    sel.appendChild(opt);
  });
  sel.value = state.docs.some(d => d.id === prev) ? prev : 'all';
  state.poolStudyFilter = sel.value;
}

// Row ids that still exist (ignores dangling ids from deleted rows or foreign imports)
function liveClusterIds(sec) {
  const ids = new Set(state.clusters.map(c => c.id));
  return (Array.isArray(sec.clusterIds) ? sec.clusterIds : []).filter(id => ids.has(id));
}

function renderSecondOrderPool() {
  populatePoolStudyFilter();
  const pool = document.getElementById('secondOrderPool');
  pool.innerHTML = '';
  const showPlaced = document.getElementById('showAssignedToggle').checked;
  const q = state.poolSearchQuery;
  const studyFilter = state.poolStudyFilter;
  const refutOnly = state.poolRefutationalOnly;

  const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);
  const filtered = allSeconds.filter(sec => {
    if (!showPlaced && liveClusterIds(sec).length > 0) return false;
    if (studyFilter !== 'all' && sec.docId !== studyFilter) return false;
    if (state.hiddenStudyIds.has(sec.docId)) return false;
    if (refutOnly) {
      if (!liveClusterIds(sec).some(cid => isSecRefutational(sec, cid))) return false;
    }
    if (q) {
      const doc = state.docs.find(d => d.id === sec.docId);
      const docName = doc ? getDisplayName(doc).toLowerCase() : '';
      const linkedQuotes = quotesOf(sec.id);
      const quoteMatch = linkedQuotes.some(f => (f.text || '').toLowerCase().includes(q) || (f.note || '').toLowerCase().includes(q));
      const hay = `${sec.note || ''} ${sec.text || ''} ${sec.nuanceNote || ''} ${docName}`.toLowerCase();
      if (!hay.includes(q) && !quoteMatch) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    // Explain WHY the pool is empty (no data / filters / everything placed)
    const activeFilters = [];
    if (q) activeFilters.push(`search "${state.poolSearchQuery}"`);
    if (studyFilter !== 'all') activeFilters.push('study filter');
    if (refutOnly) activeFilters.push('⚡ Refut. only');
    if (state.hiddenStudyIds.size > 0) activeFilters.push(`${state.hiddenStudyIds.size} hidden paper(s)`);
    const unplacedExists = allSeconds.some(sec => liveClusterIds(sec).length === 0);
    let msg;
    if (allSeconds.length === 0) msg = 'No 2nd Order Constructs extracted yet.';
    else if (activeFilters.length > 0) msg = `No 2nd Order Constructs match the current filters (${escapeHtml(activeFilters.join(', '))}). Clear them to see the rest.`;
    else if (!showPlaced && !unplacedExists) msg = 'All 2nd Order Constructs are placed! Check "Show placed" above to reuse them in additional rows.';
    else msg = 'No 2nd Order Constructs to show.';
    pool.innerHTML = `<div class="text-xs text-slate-400 text-center py-6 px-3">${msg}</div>`;
  }

  filtered.forEach(sec => {
    const doc = state.docs.find(d => d.id === sec.docId);
    const docName = doc ? getDisplayName(doc) : 'Unknown Study';
    const linkedQuotes = quotesOf(sec.id);
    const count = liveClusterIds(sec).length;
    const cBadge = getConcordanceBadgeMeta(sec.concordanceStatus);
    const showConcUI = state.teamMode || sec.concordanceStatus !== 'pending' || Boolean(sec.concordanceNote);

    const card = document.createElement('div');
    card.className = `p-2.5 rounded-lg border text-xs cursor-grab active:cursor-grabbing shadow-sm transition ${count > 0 ? 'bg-emerald-50/30 border-emerald-300 hover:border-indigo-500' : 'bg-white border-emerald-400 hover:border-indigo-500'}`;
    card.draggable = true;
    card.ondragstart = e => {
      e.dataTransfer.setData('text/sec-id', sec.id);
    };

    const poolQuotesPreviewHtml = linkedQuotes.length > 0 ? `
      <details class="mt-1.5 bg-blue-50/50 rounded border border-blue-100 p-1.5">
        <summary class="text-xs font-semibold text-blue-700 cursor-pointer select-none">🟦 Preview ${linkedQuotes.length} 1st Order Quote(s)</summary>
        <ul class="pl-3 mt-1 list-disc text-xs text-slate-600 space-y-1">
          ${linkedQuotes.map(q => `<li>"${escapeHtml(q.text)}" <span class="text-slate-400">(p.${q.page})</span></li>`).join('')}
        </ul>
      </details>
    ` : '';

    card.innerHTML = `
      <div class="flex items-center justify-between text-xs font-bold text-indigo-700 mb-1">
        <span class="truncate">${escapeHtml(docName)}</span>
        <div class="flex items-center space-x-1 shrink-0">
          <button type="button" class="rev-badge-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 px-1 py-0.2 rounded font-mono cursor-pointer" title="Click to change reviewer">@${escapeHtml(sec.by || 'Unknown')}</button>
          <span class="text-[11px] px-1 py-0.2 rounded border ${cBadge.cls} ${showConcUI ? '' : 'hidden'}">${cBadge.label}</span>
          <button type="button" class="jump-pdf-btn text-xs bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 px-2 py-0.5 rounded-md font-bold shadow-sm cursor-pointer flex items-center space-x-1 transition transform hover:-translate-y-0.5" title="Open study & jump to PDF page ${sec.page}"><i class="ph ph-file-pdf"></i><span>PDF p.${sec.page}</span><i class="ph ph-arrow-square-out"></i></button>
        </div>
      </div>
      ${sec.origin === 'wrapped_first_order' ? `<div class="text-[10px] font-semibold text-amber-800 mb-0.5">🏷 Reviewer-wrapped (1st-order quote)</div>` : ''}
      ${sec.note ? `<div class="font-bold text-slate-800 text-xs mb-1">${escapeHtml(sec.note)}${sec.noteSource === 'reviewer' && sec.origin !== 'wrapped_first_order' ? ' <span class="text-[10px] font-semibold text-amber-800">✎ reviewer wording</span>' : ''}</div>` : ''}
      <div class="text-[13px] text-slate-600 italic line-clamp-3 leading-snug">"${escapeHtml(sec.text)}"</div>
      ${sec.nuanceNote ? `<div class="mt-1 text-xs text-sky-800 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 truncate" title="${escapeHtml(sec.nuanceNote)}">🌐 ${escapeHtml(sec.nuanceNote)}</div>` : ''}
      ${poolQuotesPreviewHtml}
      <div class="mt-1.5 flex items-center justify-between text-xs text-slate-400">
        <span>🟦 ${linkedQuotes.length} quote(s)</span>
        ${count > 0
          ? `<span class="text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded font-semibold">✓ Placed in ${count} row${count > 1 ? 's' : ''}</span>`
          : '<span class="text-indigo-600 font-medium">Drag to Matrix ➔</span>'}
      </div>
    `;
    card.querySelector('.jump-pdf-btn').onclick = (e) => {
      e.stopPropagation();
      jumpToPdfAnnotation(sec.id);
    };
    card.querySelector('.rev-badge-btn').onclick = (e) => {
      e.stopPropagation();
      promptReassignItemReviewer(sec, 'annotations', renderMatrixView);
    };
    pool.appendChild(card);
  });

  // Also surface any Unlinked ("Floating") 1st Order Quotes across studies (filtered by study & keyword)
  const allSecIdSet = new Set(allSeconds.map(s => s.id));
  const unlinkedFirsts = state.annotations.filter(a => {
    if (a.type !== 'first_order') return false;
    if (quoteParentIds(a).some(id => allSecIdSet.has(id))) return false;
    if (studyFilter !== 'all' && a.docId !== studyFilter) return false;
    if (state.hiddenStudyIds.has(a.docId)) return false;
    if (refutOnly) return false;
    if (q) {
      const hay = `${a.text || ''} ${a.note || ''} ${a.nuanceNote || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).map(normalizeAnnotation);
  if (unlinkedFirsts.length > 0) {
    const uSection = document.createElement('details');
    uSection.className = 'mt-3 pt-2 border-t border-slate-200';
    uSection.open = true;
    uSection.innerHTML = `
      <summary class="text-xs font-bold text-blue-800 bg-blue-50 border border-blue-200 rounded px-2 py-1.5 cursor-pointer select-none flex items-center justify-between">
        <span>🟦 Unlinked 1st Order Quotes (${unlinkedFirsts.length})</span>
        <span class="text-[11px] font-normal text-blue-600">Link or Wrap</span>
      </summary>
      <div class="text-[11px] text-slate-500 mt-1 mb-1.5 px-1 leading-snug">
        Participant quotes (1st Order) are grouped under author concepts (2nd Order). Link these quotes to a 2nd Order concept, or drag them directly into the matrix.
      </div>
      <div class="space-y-1.5 u-list"></div>
    `;
    const uList = uSection.querySelector('.u-list');
    unlinkedFirsts.forEach(f => {
      const doc = state.docs.find(d => d.id === f.docId);
      const docName = doc ? getDisplayName(doc) : 'Unknown Study';
      const sameStudySecs = allSeconds.filter(s => s.docId === f.docId);

      const fCard = document.createElement('div');
      fCard.className = 'p-2 rounded border border-blue-200 bg-blue-50/40 text-xs space-y-1.5 cursor-grab active:cursor-grabbing';
      fCard.draggable = true;
      fCard.ondragstart = e => {
        e.dataTransfer.setData('text/unlinked-first-id', f.id);
      };

      const linkSelectHtml = sameStudySecs.length > 0 ? `
        <select class="link-to-sec-sel w-full text-xs border border-blue-200 rounded px-1 py-0.5 bg-white text-slate-700">
          <option value="">🔗 Link to existing 2nd Order in ${escapeHtml(docName)}...</option>
          ${sameStudySecs.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.note || s.text.slice(0, 45) + '...')}</option>`).join('')}
        </select>
      ` : '';

      fCard.innerHTML = `
        <div class="flex items-center justify-between text-xs font-bold text-blue-800">
          <button type="button" class="jump-pdf-btn truncate bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-0.5 rounded-md font-bold shadow-sm cursor-pointer flex items-center space-x-1 transition" title="Jump to PDF page ${f.page}"><i class="ph ph-file-pdf"></i><span class="truncate">${escapeHtml(docName)} (p.${f.page})</span><i class="ph ph-arrow-square-out"></i></button>
          <button type="button" class="wrap-btn px-1.5 py-0.2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold cursor-pointer" title="Wrap into a 2nd Order Construct">+ Convert to 2nd Order</button>
        </div>
        ${f.note ? `<div class="text-xs font-semibold text-slate-700">${escapeHtml(f.note)}</div>` : ''}
        <div class="text-xs italic text-slate-600 bg-white p-1.5 rounded border border-blue-100 line-clamp-3">"${escapeHtml(f.text)}"</div>
        ${linkSelectHtml}
      `;

      fCard.querySelector('.jump-pdf-btn').onclick = (e) => {
        e.stopPropagation();
        jumpToPdfAnnotation(f.id);
      };

      fCard.querySelector('.wrap-btn').onclick = async () => {
        const created = await wrapFirstOrderInSecondOrder(f);
        if (created) renderMatrixView();
      };

      const sel = fCard.querySelector('.link-to-sec-sel');
      if (sel) {
        sel.onchange = async e => {
          const targetSecId = e.target.value;
          if (!targetSecId) return;
          linkQuote(f, targetSecId);
          await dbPut('annotations', f);
          await recordAuditLog({
            category: 'linking',
            action: `Linked 1st Order Quote to 2nd Order Construct (${docName})`,
            detail: `Quote (p.${f.page}): "${f.text.slice(0, 70)}..."`,
            isMinorOp: true
          });
          renderMatrixView();
        };
      }

      uList.appendChild(fCard);
    });
    pool.appendChild(uSection);
  }
}

function prevVisibleIdx(idx) {
  for (let j = idx - 1; j >= 0; j--) if (!state.hiddenStudyIds.has(state.docs[j].id)) return j;
  return -1;
}
function nextVisibleIdx(idx) {
  for (let j = idx + 1; j < state.docs.length; j++) if (!state.hiddenStudyIds.has(state.docs[j].id)) return j;
  return -1;
}

function renderMatrixTable() {
  const t = document.getElementById('matrixTable');
  const scrollParent = t ? t.parentElement : null;
  const prevTop = scrollParent ? scrollParent.scrollTop : 0;
  const prevLeft = scrollParent ? scrollParent.scrollLeft : 0;
  t.innerHTML = '';
  t.classList.toggle('matrix-compact', Boolean(state.matrixCompactMode));

  if (state.docs.length === 0) {
    t.innerHTML = '<tr><td class="p-6 text-sm text-slate-500">Add PDF studies in the Extract View first.</td></tr>';
    return;
  }

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  htr.innerHTML = `
    <th>
      <div class="text-xs font-bold text-slate-800">3rd Order Theme (Your Synthesis)</div>
      <div class="text-xs font-normal text-slate-500 mt-0.5">Use the tabs below each theme title to switch between Synthesis, CERQual, and Team Agreement</div>
    </th>
  `;

  state.docs.forEach((d, idx) => {
    if (state.hiddenStudyIds.has(d.id)) return;
    const isIndex = idx === 0;
    const th = document.createElement('th');
    th.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <div>
          ${isIndex ? `<span class="text-[11px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">★ ${escapeHtml(firstStudyMeta().long)}</span>` : `<span class="text-xs text-slate-400 font-semibold">Study #${idx + 1}</span>`}
        </div>
        <div class="flex items-center space-x-1">
          <button class="move-left px-1 py-0.2 bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer" ${prevVisibleIdx(idx) < 0 ? 'disabled' : ''} title="Move column left (past hidden papers)">◀</button>
          <button class="move-right px-1 py-0.2 bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer" ${nextVisibleIdx(idx) < 0 ? 'disabled' : ''} title="Move column right (past hidden papers)">▶</button>
        </div>
      </div>
      <div class="font-bold text-slate-800 text-xs truncate" title="${escapeHtml(getDisplayName(d))}">${escapeHtml(getDisplayName(d))}</div>
      <div class="text-[11px] font-normal text-slate-500 line-clamp-2 leading-snug mt-0.5 whitespace-normal" title="${escapeHtml(d.title || d.name)}">${escapeHtml(d.title || d.name)}</div>
    `;
    // Move to the position of the neighbouring VISIBLE column, so hidden papers are not silently jumped over one by one
    th.querySelector('.move-left')?.addEventListener('click', () => { const j = prevVisibleIdx(idx); if (j >= 0) moveStudyOrder(idx, j); });
    th.querySelector('.move-right')?.addEventListener('click', () => { const j = nextVisibleIdx(idx); if (j >= 0) moveStudyOrder(idx, j); });
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  t.appendChild(thead);

  const tbody = document.createElement('tbody');

  if (state.showContextRow) {
    const ctxTr = document.createElement('tr');
    ctxTr.className = 'matrix-context-row';
    ctxTr.innerHTML = `
      <td>
        <div class="text-xs font-bold text-slate-700 flex items-center"><i class="ph ph-info mr-1 text-indigo-600"></i>Study Context & Critical Appraisal</div>
        <div class="text-xs text-slate-500 mt-0.5 leading-normal">Contextual background (Setting, Sample, Method) & Appraisal (CASP/JBI/MMAT/etc.) to inform translation & CERQual.</div>
      </td>
    `;
    state.docs.forEach(d => {
      if (state.hiddenStudyIds.has(d.id)) return;
      const td = document.createElement('td');
      const badges = getBadgesHtml(d);
      td.innerHTML = `
        <div class="space-y-1 text-[13px] text-slate-600">
          ${badges ? `<div class="flex flex-wrap gap-1 mb-1.5">${badges}</div>` : '<div class="text-xs text-slate-400 italic">No quality rating</div>'}
          <div><span class="font-semibold text-slate-700">Setting:</span> ${escapeHtml(d.setting || '-')}</div>
          <div><span class="font-semibold text-slate-700">Sample:</span> ${escapeHtml(d.participants || '-')}</div>
          <div><span class="font-semibold text-slate-700">Method:</span> ${escapeHtml(d.methodology || '-')}</div>
          ${d.contextNote ? `<div class="text-xs bg-amber-50 border border-amber-200/70 text-amber-900 p-1 rounded mt-1"><b>Note:</b> ${escapeHtml(d.contextNote)}</div>` : ''}
          ${d.studyOverview
            ? `<details class="text-xs bg-violet-50/70 border border-violet-200 rounded p-1 mt-1"><summary class="font-semibold text-violet-900 cursor-pointer select-none">📖 Storyline & key metaphors</summary><div class="mt-1 text-slate-700 whitespace-pre-wrap leading-snug">${escapeHtml(d.studyOverview)}</div></details>`
            : '<div class="text-[11px] text-slate-400 italic mt-1">No study overview yet (Tab 1 → Edit Study Info)</div>'}
        </div>
      `;
      ctxTr.appendChild(td);
    });
    tbody.appendChild(ctxTr);
  }

  if (state.clusters.length === 0) {
    const emptyTr = document.createElement('tr');
    emptyTr.innerHTML = `
      <td colspan="${visibleDocCount() + 1}" class="p-10 text-center text-slate-400 text-xs">
        Click <b>"+ Add Theme Row (3rd Order)"</b> above or drag any 2nd Order Construct onto the left drop zone to start building your synthesis matrix.
      </td>
    `;
    tbody.appendChild(emptyTr);
    t.appendChild(tbody);
    return;
  }

  const cerqualOpts = ['Not assessed', 'No/Very minor', 'Minor', 'Moderate', 'Serious'];

  const visibleClusters = state.matrixRefutationalOnly
    ? state.clusters.filter(c => {
        normalizeCluster(c);
        return rowHasRefutation(c) || Object.values(c.emptyCells).some(e => e && e.status === 'silent');
      })
    : state.clusters;

  if (visibleClusters.length === 0) {
    const emptyFilterTr = document.createElement('tr');
    emptyFilterTr.innerHTML = `
      <td colspan="${visibleDocCount() + 1}" class="p-8 text-center text-rose-700 bg-rose-50/40 text-xs">
        No rows match the <b>⚡ Contradictions Only</b> filter. Uncheck the filter above or mark a construct as Refutational (or an empty cell as Silent).
      </td>
    `;
    tbody.appendChild(emptyFilterTr);
    t.appendChild(tbody);
    return;
  }

  visibleClusters.forEach(cluster => {
    normalizeCluster(cluster);
    const cBadge = getConcordanceBadgeMeta(cluster.concordanceStatus);
    const cqBadge = getCerqualBadgeMeta(cluster.cerqualConfidence);
    const stats = computeClusterEvidenceStats(cluster.id);
    const activeSubTab = state.clusterActiveTabs[cluster.id] || 'synthesis';

    const tr = document.createElement('tr');
    tr.className = 'matrix-row-drop transition';

    tr.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('text/sec-id') || e.dataTransfer.types.includes('text/unlinked-first-id')) {
        e.preventDefault();
        tr.classList.add('drag-over');
      }
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
    tr.addEventListener('drop', async e => {
      e.preventDefault();
      tr.classList.remove('drag-over');
      let secId = e.dataTransfer.getData('text/sec-id');
      let sec = state.annotations.find(a => a.id === secId && a.type === 'second_order');
      if (!sec) {
        const firstId = e.dataTransfer.getData('text/unlinked-first-id');
        const f = state.annotations.find(a => a.id === firstId && a.type === 'first_order');
        if (f) sec = await wrapFirstOrderInSecondOrder(f);
      }
      if (sec) {
        await assignSecondOrderToCluster(sec, cluster);
        renderMatrixView();
      }
    });

    const tdMeta = document.createElement('td');
    tdMeta.innerHTML = `
      <div class="space-y-2">
        <!-- Header Badges & Reviewer -->
        <div class="flex items-center justify-between">
          <div class="flex items-center flex-wrap gap-1">
            <span class="text-xs font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">3rd Order</span>
            <button type="button" class="cl-rev-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 px-1.5 py-0.2 rounded font-mono cursor-pointer" title="Click to change reviewer for this 3rd Order Cluster">@${escapeHtml(cluster.by || 'Unknown')}</button>
            <span class="cl-conc-pill text-[11px] px-1.5 py-0.2 rounded border font-semibold ${cBadge.cls}">${cBadge.label}</span>
            ${cluster.autoSeeded && !cluster.seedConfirmed ? `<button type="button" class="cl-seed-confirm text-[11px] px-1.5 py-0.2 rounded border border-amber-400 bg-amber-100 text-amber-900 font-semibold cursor-pointer" title="Auto-placed from the Index Paper's 2nd order construct. The title is still the primary authors' wording, not yet your 3rd order interpretation. Click once you have reviewed / rewritten it.">🌱 Provisional · click to confirm</button>` : ''}
            ${(() => { const od = rowOriginDoc(cluster); return od ? `<span class="text-[11px] px-1.5 py-0.2 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold" title="This row was opened by a construct from a study other than #1: the concept was not present in the first study and emerged during translation.">🌿 Emerged in #${state.docs.indexOf(od) + 1} ${escapeHtml(getDisplayName(od))}</span>` : ''; })()}
            <span class="cl-cerqual-pill text-[11px] px-1.5 py-0.2 rounded border font-semibold ${cqBadge.cls}">${cqBadge.label}</span>
          </div>
          <div class="flex items-center space-x-1">
            <button type="button" class="move-cl-up px-1.5 py-0.2 bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer text-[11px]" ${state.clusters.indexOf(cluster) === 0 ? 'disabled' : ''} title="Move row up">▲</button>
            <button type="button" class="move-cl-down px-1.5 py-0.2 bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer text-[11px]" ${state.clusters.indexOf(cluster) === state.clusters.length - 1 ? 'disabled' : ''} title="Move row down">▼</button>
            <button class="del-cluster text-slate-400 hover:text-rose-500 cursor-pointer ml-1" title="Delete Row"><i class="ph ph-trash"></i></button>
          </div>
        </div>
        
        <!-- Always-visible 3rd Order Title -->
        <input type="text" class="cluster-title w-full text-xs font-bold border border-slate-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-indigo-600" placeholder="3rd Order Construct / Theme Name..." value="${escapeHtml(cluster.thirdOrderTitle)}">

        <div class="matrix-compact-expand-note hidden text-xs text-slate-500">
          <span><i>(${escapeHtml(rowRelationSummary(cluster))})</i></span>
        </div>
        <!-- 3-Mode Mini-Tab Bar to prevent vertical clutter -->
        <div class="cl-subtab-bar grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
          <button type="button" data-subtab="synthesis" class="cl-subtab-btn py-1 rounded font-semibold cursor-pointer transition ${activeSubTab === 'synthesis' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">📝 Synthesis</button>
          <button type="button" data-subtab="cerqual" class="cl-subtab-btn py-1 rounded font-semibold cursor-pointer transition ${activeSubTab === 'cerqual' ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">📊 CERQual</button>
          <button type="button" data-subtab="concordance" class="cl-subtab-btn py-1 rounded font-semibold cursor-pointer transition ${activeSubTab === 'concordance' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">🤝 Team</button>
        </div>

        <!-- SUB-PANEL 1: SYNTHESIS (Default) -->
        <div class="subpanel-synthesis space-y-2 ${activeSubTab === 'synthesis' ? '' : 'hidden'}">
          <div>
            <label class="block text-xs font-semibold text-slate-500 mb-0.5" title="Reciprocal / refutational describe how each study relates to the others in this row, so they are judged per cell (on each construct card), not chosen for the row as a whole.">How the studies relate in this row <span class="font-normal text-slate-400">(from the cells)</span></label>
            <div class="cl-rel-summary text-xs border border-slate-200 rounded px-2 py-1 bg-slate-50 text-slate-700">${escapeHtml(rowRelationSummary(cluster))}</div>
          </div>
          <div class="rounded border border-emerald-200 bg-emerald-50/40 p-1.5">
            <label class="block text-xs font-bold text-emerald-900 mb-0.5" title="Phase 5 (Noblit & Hare): translate the studies into one another. Keep each study's own concepts and terms visible — name the study and its concept, then say how it maps onto (reciprocal) or challenges (refutational) the others, and what context explains the difference.">Step A · Translation Summary <span class="font-normal text-emerald-700">(Phase 5 — in the studies' own terms)</span></label>
            <textarea class="cluster-trans w-full text-[13px] border border-emerald-300 rounded p-1.5 h-20 resize-y bg-white focus:outline-none focus:border-emerald-600 font-normal" placeholder="Study by study, keeping the authors' concepts: e.g., 'Smith's “holding back” corresponds to Lee's “protective silence” — both describe…; Tanaka's “open disclosure” runs counter to these, which may reflect the outpatient setting…'. Note what is shared, what differs or contradicts, and the context of each.">${escapeHtml(cluster.translationSummary)}</textarea>
          </div>
          <div class="rounded border border-indigo-200 bg-indigo-50/40 p-1.5">
            <label class="block text-xs font-bold text-indigo-900 mb-0.5" title="The 3rd order construct is the reviewer's own interpretation, derived from the translation in Step A. It should say something that no single study says on its own.">Step B · 3rd Order Construct: Definition & Interpretation <span class="font-normal text-indigo-700">(derived from Step A)</span></label>
            <div class="cl-stepb-warn text-[11px] text-amber-700 font-semibold mb-0.5 ${(cluster.synthesisNote && !cluster.translationSummary) ? '' : 'hidden'}">⚠ Step A is empty. A 3rd order construct should be derived from the translation, not written directly from the grouped cards.</div>
            <textarea class="cluster-note w-full text-[13px] border border-indigo-300 rounded p-1.5 h-20 resize-y bg-white focus:outline-none focus:border-indigo-600 font-normal" placeholder="Your construct in your own words: what it means (definition), and what the translation shows that goes beyond any single study (interpretation).">${escapeHtml(cluster.synthesisNote)}</textarea>
          </div>
          <div class="text-xs text-slate-400 flex items-center justify-between pt-0.5">
            <span>Contributing: ${stats.contributingDocs.length ? escapeHtml(stats.contributingDocs.map(d => getDisplayName(d)).join('; ')) : 'no 2nd order constructs mapped yet'}</span>
          </div>
        </div>

        <!-- SUB-PANEL 2: GRADE-CERQual -->
        <div class="subpanel-cerqual space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-2 ${activeSubTab === 'cerqual' ? '' : 'hidden'}">
          <div class="text-xs bg-white p-1.5 rounded border border-teal-100 text-slate-600 space-y-0.5">
            <div class="font-semibold text-slate-700">Evidence Snapshot (contributing studies; for your judgement, not a score):</div>
            ${stats.contributingDocs.length
              ? `<div class="text-slate-500">Data: ${stats.studiesCount} stud${stats.studiesCount === 1 ? 'y' : 'ies'}, ${stats.secCount} 2nd order construct(s), ${stats.quoteCount} linked 1st order quote(s) <span class="text-slate-400">(adequacy = richness + quantity)</span></div>` +
                stats.contributingDocs.map(d => `<div>• ${escapeHtml(getDisplayName(d))} <span class="text-slate-400">— quality: ${escapeHtml(d.quality || 'not rated')}; richness: ${escapeHtml(d.richness || 'not rated')}; setting: ${escapeHtml(d.setting || '-')}; sample: ${escapeHtml(d.participants || '-')}</span></div>`).join('') +
                `<div class="text-slate-400 mt-0.5">Relevance is judged against the context in the review question: ${escapeHtml((state.loa && state.loa.aim) ? state.loa.aim.slice(0, 160) + (state.loa.aim.length > 160 ? '…' : '') : '(set the Phase 1 aim / question)')}</div>`
              : '<div class="text-slate-400">No 2nd order constructs mapped to this row yet.</div>'}
          </div>

          <div class="space-y-1.5">
            ${[
              ['cq-lim', 'cq-lim-note', '1. Methodological Limitations', 'cerqualLimitations', 'cerqualLimNote'],
              ['cq-coh', 'cq-coh-note', '2. Coherence', 'cerqualCoherence', 'cerqualCohNote'],
              ['cq-adeq', 'cq-adeq-note', '3. Adequacy of Data', 'cerqualAdequacy', 'cerqualAdeqNote'],
              ['cq-rel', 'cq-rel-note', '4. Relevance', 'cerqualRelevance', 'cerqualRelNote']
            ].map(([selCls, noteCls, label, f, nf]) => `
            <div class="p-1.5 rounded border border-teal-100 bg-white">
              <div class="flex items-center justify-between gap-2">
                <label class="text-[11px] font-semibold text-slate-600">${label}</label>
                <select class="${selCls} text-xs border border-slate-300 rounded px-1 py-0.5 bg-white">
                  ${cerqualOpts.map(o => `<option value="${o}" ${cluster[f] === o ? 'selected' : ''}>${o === 'Not assessed' ? o : o + ' concerns'}</option>`).join('')}
                </select>
              </div>
              <textarea class="${noteCls} mt-1 w-full text-[11.5px] border border-slate-200 rounded p-1 h-10 resize-y bg-white focus:outline-none focus:border-teal-600" placeholder="Why this rating? (what in the contributing studies led to it)">${escapeHtml(cluster[nf] || '')}</textarea>
            </div>`).join('')}
          </div>

          <div class="flex items-center justify-between gap-1.5 pt-0.5">
            <div class="flex-1">
              <label class="block text-[11px] font-bold text-teal-900">Overall Confidence</label>
              <select class="cq-conf w-full text-xs font-bold border border-teal-400 rounded px-1.5 py-1 bg-white text-slate-800">
                <option value="Not assessed" ${cluster.cerqualConfidence === 'Not assessed' ? 'selected' : ''}>⚪ Not assessed</option>
                <option value="High" ${cluster.cerqualConfidence === 'High' ? 'selected' : ''}>🟢 High Confidence</option>
                <option value="Moderate" ${cluster.cerqualConfidence === 'Moderate' ? 'selected' : ''}>🔵 Moderate Confidence</option>
                <option value="Low" ${cluster.cerqualConfidence === 'Low' ? 'selected' : ''}>🟡 Low Confidence</option>
                <option value="Very low" ${cluster.cerqualConfidence === 'Very low' ? 'selected' : ''}>🔴 Very low Confidence</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-[11px] font-semibold text-slate-600 mb-0.5">Explanation of overall confidence (a reasoned judgement across the four components — not a formula or a sum)</label>
            <div class="cq-exp-warn text-[11px] text-amber-700 font-semibold mb-0.5 ${(cluster.cerqualConfidence !== 'Not assessed' && !cluster.cerqualExplanation) ? '' : 'hidden'}">⚠ A confidence level is set but its explanation is empty. GRADE-CERQual asks for a justification of each judgement.</div>
            <textarea class="cq-exp w-full text-xs border border-slate-300 rounded p-1.5 h-14 resize-y bg-white focus:outline-none focus:border-teal-600" placeholder="e.g., Downgraded to Moderate due to minor methodological limitations and moderate adequacy concerns...">${escapeHtml(cluster.cerqualExplanation)}</textarea>
          </div>
        </div>

        <!-- SUB-PANEL 3: TEAM CONCORDANCE -->
        <div class="subpanel-concordance p-2.5 rounded-lg bg-indigo-50/50 border border-indigo-200/80 space-y-2 ${activeSubTab === 'concordance' ? '' : 'hidden'}">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-indigo-900">🤝 Team Consensus Status</span>
            <select class="cl-conc-status text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white font-semibold">
              <option value="pending" ${cluster.concordanceStatus === 'pending' ? 'selected' : ''}>⏳ Pending</option>
              <option value="discuss" ${cluster.concordanceStatus === 'discuss' ? 'selected' : ''}>💬 Needs Discussion</option>
              <option value="divergent" ${cluster.concordanceStatus === 'divergent' ? 'selected' : ''}>↔ Divergent — readings kept</option>
              <option value="agreed" ${cluster.concordanceStatus === 'agreed' ? 'selected' : ''}>✅ Agreed</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-indigo-900 mb-0.5">Co-Reviewer / Supervisor Discussion Note</label>
            <textarea class="cl-conc-note w-full text-xs border border-slate-200 rounded p-1.5 h-16 resize-y bg-white focus:outline-none focus:border-indigo-500" placeholder="Record agreement, or keep differing readings side by side (who reads it how, and why) — divergence is part of the interpretation, not an error to remove...">${escapeHtml(cluster.concordanceNote)}</textarea>
          </div>
        </div>
      </div>
    `;

    // Reviewer badge & row reorder click handlers
    tdMeta.querySelector('.cl-rev-btn').onclick = () => promptReassignItemReviewer(cluster, 'clusters', renderMatrixTable);
    tdMeta.querySelector('.move-cl-up')?.addEventListener('click', () => moveClusterOrder(cluster.id, -1));
    tdMeta.querySelector('.move-cl-down')?.addEventListener('click', () => moveClusterOrder(cluster.id, 1));

    // Sub-tab switching logic (In-place partial DOM update without rebuilding table)
    const subButtons = tdMeta.querySelectorAll('.cl-subtab-btn');
    const panelSyn = tdMeta.querySelector('.subpanel-synthesis');
    const panelCer = tdMeta.querySelector('.subpanel-cerqual');
    const panelCon = tdMeta.querySelector('.subpanel-concordance');

    subButtons.forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.subtab;
        state.clusterActiveTabs[cluster.id] = tab;

        subButtons.forEach(b => {
          const t = b.dataset.subtab;
          const activeColor = t === 'cerqual' ? 'text-teal-800' : t === 'concordance' ? 'text-indigo-900' : 'text-indigo-700';
          b.className = `cl-subtab-btn py-1 rounded font-semibold cursor-pointer transition ${t === tab ? `bg-white ${activeColor} shadow-sm` : 'text-slate-600 hover:text-slate-900'}`;
        });

        panelSyn.classList.toggle('hidden', tab !== 'synthesis');
        panelCer.classList.toggle('hidden', tab !== 'cerqual');
        panelCon.classList.toggle('hidden', tab !== 'concordance');
      };
    });

    let initialClusterTitle = cluster.thirdOrderTitle || '';
    const debouncedSaveCluster = createDebouncedSaver(async () => {
      await dbPut('clusters', cluster);
      renderLoaClusterChips();
    }, 350);

    tdMeta.querySelector('.cluster-title').addEventListener('input', e => {
      cluster.thirdOrderTitle = e.target.value.trim();
      debouncedSaveCluster();
    });

    tdMeta.querySelector('.cluster-title').onchange = async e => {
      const oldTitle = initialClusterTitle || '(Untitled)';
      const newTitle = e.target.value.trim();
      if (initialClusterTitle !== newTitle) {
        initialClusterTitle = newTitle;
        cluster.thirdOrderTitle = newTitle;
        await dbPut('clusters', cluster);
        renderLoaClusterChips();
        await recordAuditLog({
          clusterIds: [cluster.id],
          category: 'third_order',
          action: 'Refined 3rd Order Construct Title',
          fromVal: oldTitle,
          toVal: newTitle || '(Untitled)'
        });
      }
    };

    const stepBWarn = tdMeta.querySelector('.cl-stepb-warn');
    const refreshStepBWarn = () => {
      if (stepBWarn) stepBWarn.classList.toggle('hidden', !((cluster.synthesisNote || '').trim() && !(cluster.translationSummary || '').trim()));
    };

    let initialTransSummary = cluster.translationSummary || '';
    tdMeta.querySelector('.cluster-trans').addEventListener('input', e => {
      cluster.translationSummary = e.target.value;
      refreshStepBWarn();
      debouncedSaveCluster();
    });
    tdMeta.querySelector('.cluster-trans').onchange = async e => {
      const oldVal = initialTransSummary;
      const newVal = e.target.value.trim();
      if (oldVal !== newVal) {
        initialTransSummary = newVal;
        cluster.translationSummary = newVal;
        await dbPut('clusters', cluster);
        await recordAuditLog({
          clusterIds: [cluster.id],
          category: 'translation_process',
          action: `Updated Step A Translation Summary for "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
          fromVal: oldVal || '(Empty)',
          toVal: newVal || '(Empty)'
        });
      }
    };

    let initialClusterNote = cluster.synthesisNote || '';
    tdMeta.querySelector('.cluster-note').addEventListener('input', e => {
      cluster.synthesisNote = e.target.value;
      refreshStepBWarn();
      debouncedSaveCluster();
    });

    tdMeta.querySelector('.cluster-note').onchange = async e => {
      const oldNote = initialClusterNote;
      const newNote = e.target.value.trim();
      if (oldNote !== newNote) {
        initialClusterNote = newNote;
        cluster.synthesisNote = newNote;
        await dbPut('clusters', cluster);
        await recordAuditLog({
          clusterIds: [cluster.id],
          category: 'third_order',
          action: `Updated Step B 3rd Order Definition & Interpretation for "${cluster.thirdOrderTitle || 'Untitled Cluster'}"`,
          fromVal: oldNote || '(Empty)',
          toVal: newNote
        });
      }
    };

    const updateClusterConcordance = async () => {
      const oldStatus = cluster.concordanceStatus;
      const oldNote = cluster.concordanceNote;
      const newStatus = tdMeta.querySelector('.cl-conc-status').value;
      const newNote = tdMeta.querySelector('.cl-conc-note').value.trim();
      if (oldStatus === newStatus && oldNote === newNote) return;

      cluster.concordanceStatus = newStatus;
      cluster.concordanceNote = newNote;
      await dbPut('clusters', cluster);

      const pill = tdMeta.querySelector('.cl-conc-pill');
      const meta = getConcordanceBadgeMeta(newStatus);
      pill.className = `cl-conc-pill text-[11px] px-1.5 py-0.2 rounded border font-semibold ${meta.cls}`;
      pill.textContent = meta.label;

      await recordAuditLog({
        clusterIds: [cluster.id],
        category: 'concordance',
        action: `3rd Order Cluster Concordance Updated ("${cluster.thirdOrderTitle || 'Untitled Row'}")`,
        detail: newNote ? `Reviewer Consensus / Discussion Note: ${newNote}` : 'Updated agreement status.',
        fromVal: `${oldStatus.toUpperCase()}${oldNote ? ' (' + oldNote + ')' : ''}`,
        toVal: `${newStatus.toUpperCase()}${newNote ? ' (' + newNote + ')' : ''}`
      });
    };

    tdMeta.querySelector('.cl-conc-status').onchange = updateClusterConcordance;
    const seedBtn = tdMeta.querySelector('.cl-seed-confirm');
    if (seedBtn) seedBtn.onclick = async () => {
      cluster.seedConfirmed = true;
      await dbPut('clusters', cluster);
      await recordAuditLog({
        clusterIds: [cluster.id],
        category: 'third_order',
        action: `Confirmed auto-placed row as a working 3rd Order construct: "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
        detail: 'The row was seeded from an Index Paper 2nd order construct and has been reviewed by the researcher.'
      });
      seedBtn.remove();
    };
    tdMeta.querySelector('.cl-conc-note').onchange = updateClusterConcordance;

    // GRADE-CERQual Handlers
    const saveCerqualChanges = async () => {
      const sigOf = () => [cluster.cerqualConfidence, cluster.cerqualLimitations, cluster.cerqualCoherence, cluster.cerqualAdequacy, cluster.cerqualRelevance,
        cluster.cerqualLimNote, cluster.cerqualCohNote, cluster.cerqualAdeqNote, cluster.cerqualRelNote, cluster.cerqualExplanation].join('\u241F');
      const prevSig = sigOf();
      const prevSummary = `${cluster.cerqualConfidence} [L:${cluster.cerqualLimitations}, C:${cluster.cerqualCoherence}, A:${cluster.cerqualAdequacy}, R:${cluster.cerqualRelevance}]`;
      cluster.cerqualLimitations = tdMeta.querySelector('.cq-lim').value;
      cluster.cerqualCoherence = tdMeta.querySelector('.cq-coh').value;
      cluster.cerqualAdequacy = tdMeta.querySelector('.cq-adeq').value;
      cluster.cerqualRelevance = tdMeta.querySelector('.cq-rel').value;
      cluster.cerqualConfidence = tdMeta.querySelector('.cq-conf').value;
      cluster.cerqualExplanation = tdMeta.querySelector('.cq-exp').value.trim();
      cluster.cerqualLimNote = tdMeta.querySelector('.cq-lim-note').value.trim();
      cluster.cerqualCohNote = tdMeta.querySelector('.cq-coh-note').value.trim();
      cluster.cerqualAdeqNote = tdMeta.querySelector('.cq-adeq-note').value.trim();
      cluster.cerqualRelNote = tdMeta.querySelector('.cq-rel-note').value.trim();
      const warnEl = tdMeta.querySelector('.cq-exp-warn');
      if (warnEl) warnEl.classList.toggle('hidden', !(cluster.cerqualConfidence !== 'Not assessed' && !cluster.cerqualExplanation));
      const nextSummary = `${cluster.cerqualConfidence} [L:${cluster.cerqualLimitations}, C:${cluster.cerqualCoherence}, A:${cluster.cerqualAdequacy}, R:${cluster.cerqualRelevance}]`;

      await dbPut('clusters', cluster);

      const cqPill = tdMeta.querySelector('.cl-cerqual-pill');
      const cqMeta = getCerqualBadgeMeta(cluster.cerqualConfidence);
      cqPill.className = `cl-cerqual-pill text-[11px] px-1.5 py-0.2 rounded border font-semibold ${cqMeta.cls}`;
      cqPill.textContent = cqMeta.label;

      if (prevSig !== sigOf()) {
        await recordAuditLog({
          clusterIds: [cluster.id],
          category: 'cerqual',
          action: `Updated GRADE-CERQual Assessment for "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
          detail: [
            cluster.cerqualLimNote && `Methodological limitations — ${cluster.cerqualLimNote}`,
            cluster.cerqualCohNote && `Coherence — ${cluster.cerqualCohNote}`,
            cluster.cerqualAdeqNote && `Adequacy — ${cluster.cerqualAdeqNote}`,
            cluster.cerqualRelNote && `Relevance — ${cluster.cerqualRelNote}`,
            cluster.cerqualExplanation && `Overall — ${cluster.cerqualExplanation}`
          ].filter(Boolean).join('\n') || 'Updated component ratings.',
          fromVal: prevSummary,
          toVal: nextSummary
        });
      }
    };

    ['.cq-lim', '.cq-coh', '.cq-adeq', '.cq-rel', '.cq-conf', '.cq-exp', '.cq-lim-note', '.cq-coh-note', '.cq-adeq-note', '.cq-rel-note'].forEach(sel => {
      tdMeta.querySelector(sel).onchange = saveCerqualChanges;
    });

    tdMeta.querySelector('.del-cluster').onclick = async () => {
      if (!confirm('Remove this 3rd Order row? Assigned 2nd Order Constructs will remain in the pool/other rows. (You can Undo with Ctrl+Z)')) return;
      const assigned = state.annotations.filter(a => a.type === 'second_order' && a.clusterIds?.includes(cluster.id));
      pushUndoAction({
        type: 'delete_cluster',
        label: `3rd Order Row (${cluster.thirdOrderTitle || 'Untitled'})`,
        cluster: { ...cluster },
        assignedSecIds: assigned.map(a => a.id)
      });
      for (let a of assigned) {
        a.clusterIds = a.clusterIds.filter(id => id !== cluster.id);
        await dbPut('annotations', a);
      }
      await dbDelete('clusters', cluster.id);
      state.clusters = state.clusters.filter(c => c.id !== cluster.id);
      await recordAuditLog({
        clusterIds: [cluster.id],
        category: 'third_order',
        action: 'Deleted 3rd Order Concept Cluster Row',
        fromVal: cluster.thirdOrderTitle || '(Untitled Row)'
      });
      renderMatrixView();
    };

    tr.appendChild(tdMeta);

    state.docs.forEach(doc => {
      if (state.hiddenStudyIds.has(doc.id)) return;
      const td = document.createElement('td');
      const cellConstructs = state.annotations.filter(a =>
        a.type === 'second_order' &&
        normalizeAnnotation(a).clusterIds.includes(cluster.id) &&
        a.docId === doc.id
      );

      if (cellConstructs.length === 0) {
        // An empty cell is not one thing: not yet checked / silent (checked, not addressed) / outside the study's scope
        const ec = emptyCellStatus(cluster, doc.id);
        const ecBox = ec.status === 'silent' ? 'border-violet-300 bg-violet-50/40' : ec.status === 'na' ? 'border-slate-300 bg-slate-50' : 'border-slate-200';
        td.innerHTML = `<div class="h-full min-h-[120px] rounded border border-dashed ${ecBox} flex flex-col items-center justify-center gap-1.5 p-1.5 text-[13px] text-slate-300">
          <span class="select-none">Drop 2nd Order here</span>
          <select class="empty-cell-sel text-[11px] border border-slate-300 rounded px-1 py-0.5 bg-white text-slate-600 cursor-pointer max-w-full" title="Record what this study's silence means for this row. Silence can itself be a finding (e.g., a concept absent from one setting).">
            ${Object.entries(EMPTY_CELL_META).map(([k, m]) => `<option value="${k}" ${ec.status === k ? 'selected' : ''}>${m.sym ? m.sym + ' ' : ''}${escapeHtml(m.label)}</option>`).join('')}
          </select>
          <input type="text" class="empty-cell-note w-full text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-white text-slate-700 focus:outline-none focus:border-indigo-500 ${ec.status === 'unchecked' ? 'hidden' : ''}" placeholder="Why? e.g., re-read the whole account; no reference to …" value="${escapeHtml(ec.note || '')}">
        </div>`;
        const ecSel = td.querySelector('.empty-cell-sel');
        const ecNote = td.querySelector('.empty-cell-note');
        const saveEmptyCell = async () => {
          const prev = emptyCellStatus(cluster, doc.id);
          const status = EMPTY_CELL_META[ecSel.value] ? ecSel.value : 'unchecked';
          const note = status === 'unchecked' ? '' : ecNote.value.trim();
          if (prev.status === status && (prev.note || '') === note) return;
          if (status === 'unchecked') delete cluster.emptyCells[doc.id];
          else cluster.emptyCells[doc.id] = { status, note };
          await dbPut('clusters', cluster);
          await recordAuditLog({
            clusterIds: [cluster.id],
            category: 'translation_process',
            action: `Empty cell judged for ${getDisplayName(doc)} in "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
            detail: note || '',
            fromVal: EMPTY_CELL_META[prev.status].label,
            toVal: EMPTY_CELL_META[status].label
          });
          const sumEl = tdMeta.querySelector('.cl-rel-summary');
          if (sumEl) sumEl.textContent = rowRelationSummary(cluster);
        };
        ecSel.onchange = async () => {
          ecNote.classList.toggle('hidden', ecSel.value === 'unchecked');
          await saveEmptyCell();
          renderMatrixTable();
        };
        ecNote.onchange = saveEmptyCell;
      } else {
        const cellWrap = document.createElement('div');
        cellWrap.className = 'space-y-2.5';

        cellConstructs.forEach(sec => {
          const firsts = quotesOf(sec.id);
          const otherClustersCount = sec.clusterIds.length - 1;
          const cellComment = (sec.clusterComments && sec.clusterComments[cluster.id]) || '';
          const isBaselineCell = isBaselineDocId(sec.docId);
          const cellRelation = cellRelationOf(sec, cluster.id);
          const relMeta = getCellRelationMeta(cellRelation);
          const secBadge = getConcordanceBadgeMeta(sec.concordanceStatus);
          const showConcUI = state.teamMode || sec.concordanceStatus !== 'pending' || Boolean(sec.concordanceNote);

          const card = document.createElement('div');
          card.className = `matrix-cell-card ${relMeta.cardCls} border rounded-lg p-2.5 shadow-sm text-xs cursor-grab transition`;
          card.draggable = true;
          card.ondragstart = e => {
            e.dataTransfer.setData('text/sec-id', sec.id);
          };

          let quotesHtml = '';
          if (firsts.length > 0) {
            quotesHtml = `
              <details class="matrix-card-detail mt-1.5 bg-white rounded border border-blue-100 p-1.5">
                <summary class="text-xs font-semibold text-blue-700 cursor-pointer">🟦 ${firsts.length} Linked 1st Order Quote(s)</summary>
                <ul class="pl-3 mt-1 list-disc text-xs text-slate-600 space-y-1">
                  ${firsts.map(f => `<li>"${escapeHtml(f.text)}" ${f.note ? `<span class="font-semibold text-blue-800 not-italic">[${escapeHtml(f.note)}]</span> ` : ''}<span class="text-slate-400">(p.${f.page})</span>${f.nuanceNote ? `<div class="text-[11px] text-sky-700 not-italic">🌐 ${escapeHtml(f.nuanceNote)}</div>` : ''}</li>`).join('')}
                </ul>
              </details>
            `;
          }

          const nuanceHtml = sec.nuanceNote ? `
            <details class="matrix-card-detail mt-1.5 bg-sky-50/70 rounded border border-sky-200/80 p-1.5">
              <summary class="text-xs font-semibold text-sky-800 cursor-pointer">🌐 Reading / Nuance Memo</summary>
              <div class="mt-1 text-xs text-slate-700 whitespace-pre-wrap">${escapeHtml(sec.nuanceNote)}</div>
            </details>
          ` : '';

          card.innerHTML = `
            <div class="flex items-start justify-between gap-1 mb-1">
              <div class="flex items-center flex-wrap gap-1">
                ${isBaselineCell
                  ? `<span class="text-[11px] font-bold px-1.5 py-0.5 rounded border ${relMeta.badgeCls}" title="Study #1 establishes this row; reciprocal / refutational relations are assigned to the studies translated into it.">${relMeta.label}</span>`
                  : `<select class="rel-select text-[11px] font-bold px-1 py-0.5 rounded border cursor-pointer transition ${relMeta.badgeCls}" title="How does this study's construct relate to the others in this row? Nothing is assumed: decide after reading it against the other studies.">
                  <option value="unjudged" ${cellRelation === 'unjudged' ? 'selected' : ''}>? Not yet judged</option>
                  <option value="reciprocal" ${cellRelation === 'reciprocal' ? 'selected' : ''}>🤝 Reciprocal</option>
                  <option value="refutational" ${cellRelation === 'refutational' ? 'selected' : ''}>⚡ Refutational</option>
                </select>`}
                <button type="button" class="jump-pdf-btn text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 border border-indigo-700 px-2.5 py-0.5 rounded-md shadow-sm cursor-pointer transition flex items-center space-x-1 transform hover:-translate-y-0.5" title="Open PDF & jump to page ${sec.page} in ${escapeHtml(getDisplayName(doc))}"><i class="ph ph-file-pdf"></i><span>PDF p.${sec.page}</span><i class="ph ph-arrow-square-out"></i></button>
                <button type="button" class="rev-badge-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 px-1 py-0.2 rounded font-mono cursor-pointer" title="Click to change reviewer">@${escapeHtml(sec.by || 'Unknown')}</button>
                <span class="text-[11px] px-1 py-0.2 rounded border ${secBadge.cls} ${showConcUI ? '' : 'hidden'}">${secBadge.label}</span>
                ${firsts.length > 0 ? `<span class="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 px-1 py-0.2 rounded font-semibold" title="${firsts.length} linked 1st Order Quote(s)">🟦 ${firsts.length}</span>` : ''}
                ${otherClustersCount > 0 ? `<span class="text-[11px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold" title="Also mapped to ${otherClustersCount} other row(s)">+${otherClustersCount} row</span>` : ''}
              </div>
              <div class="flex items-center space-x-1">
                <button type="button" class="matrix-card-detail edit-cell-quote-btn text-slate-400 hover:text-indigo-600 text-xs cursor-pointer" title="Edit quote text"><i class="ph ph-pencil-simple"></i></button>
                <button class="unassign-btn text-slate-400 hover:text-rose-500 text-xs cursor-pointer" title="Remove from this row"><i class="ph ph-x-circle"></i></button>
              </div>
            </div>
            <input type="text" class="sec-label-input w-full text-xs font-bold text-slate-800 border-b border-transparent hover:border-slate-300 focus:border-emerald-600 bg-transparent py-0.5 mb-0.5 focus:outline-none" placeholder="${escapeHtml(sec.text.slice(0, 42))}..." value="${escapeHtml(sec.note)}" title="${escapeHtml(sec.text)}">
            <div class="matrix-card-detail cell-quote-display text-[13px] font-serif italic text-slate-700 bg-white p-1.5 rounded border ${relMeta.quoteBorderCls} leading-snug cursor-pointer" title="Double-click to edit quote text">"${escapeHtml(sec.text)}"</div>
            <div class="matrix-card-detail cell-quote-editor hidden space-y-1 bg-amber-50/70 p-1.5 rounded border border-amber-200 mt-1">
              <textarea class="cell-quote-textarea w-full text-xs border border-amber-300 rounded p-1 bg-white focus:outline-none focus:border-indigo-500 resize-y h-16">${escapeHtml(sec.text)}</textarea>
              <div class="flex justify-end space-x-1">
                <button type="button" class="cell-quote-cancel px-1.5 py-0.5 text-[11px] bg-white border border-slate-300 rounded text-slate-600 cursor-pointer">Cancel</button>
                <button type="button" class="cell-quote-save px-2 py-0.5 text-[11px] bg-emerald-600 text-white font-bold rounded cursor-pointer">Save</button>
              </div>
            </div>
            ${nuanceHtml}
            ${quotesHtml}
            <div class="matrix-card-detail mt-2 pt-1.5 border-t ${relMeta.dividerCls}">
              <input type="text" class="sec-comment-input w-full text-xs border border-slate-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-indigo-500" placeholder="${cellRelation === 'refutational' ? 'Explain how this study contrasts or disagrees in this row...' : 'Note on how this concept fits into this theme...'}" value="${escapeHtml(cellComment)}">
            </div>
          `;

          card.querySelector('.jump-pdf-btn').onclick = (e) => {
            e.stopPropagation();
            jumpToPdfAnnotation(sec.id);
          };

          const cellQuoteDisp = card.querySelector('.cell-quote-display');
          const cellQuoteEdit = card.querySelector('.cell-quote-editor');
          const cellQuoteTa = card.querySelector('.cell-quote-textarea');
          const toggleCellQuoteEdit = (open) => {
            cellQuoteDisp.classList.toggle('hidden', open);
            cellQuoteEdit.classList.toggle('hidden', !open);
            if (open) { cellQuoteTa.value = sec.text; cellQuoteTa.focus(); }
          };
          card.querySelector('.edit-cell-quote-btn').onclick = (e) => {
            e.stopPropagation();
            toggleCellQuoteEdit(cellQuoteEdit.classList.contains('hidden'));
          };
          cellQuoteDisp.ondblclick = (e) => {
            e.stopPropagation();
            toggleCellQuoteEdit(true);
          };
          card.querySelector('.cell-quote-cancel').onclick = () => toggleCellQuoteEdit(false);
          card.querySelector('.cell-quote-save').onclick = async () => {
            const cleaned = stripOuterQuotes(cellQuoteTa.value);
            if (cleaned && cleaned !== sec.text) {
              sec.text = cleaned;
              cellQuoteDisp.textContent = `"${cleaned}"`;
              await dbPut('annotations', sec);
            }
            toggleCellQuoteEdit(false);
          };

          const relSelect = card.querySelector('.rel-select');
          if (relSelect) relSelect.onclick = e => e.stopPropagation();
          if (relSelect) relSelect.onchange = async (e) => {
            e.stopPropagation();
            if (!sec.clusterRelations) sec.clusterRelations = {};
            const prevRel = cellRelationOf(sec, cluster.id);
            const nextRel = CELL_RELATIONS.includes(e.target.value) ? e.target.value : 'unjudged';
            if (prevRel === nextRel) return;
            if (nextRel === 'unjudged') delete sec.clusterRelations[cluster.id];
            else sec.clusterRelations[cluster.id] = nextRel;
            await dbPut('annotations', sec);

            const nextMeta = getCellRelationMeta(nextRel);
            card.className = `matrix-cell-card ${nextMeta.cardCls} border rounded-lg p-2.5 shadow-sm text-xs cursor-grab transition`;
            relSelect.className = `rel-select text-[11px] font-bold px-1 py-0.5 rounded border cursor-pointer transition ${nextMeta.badgeCls}`;
            const sumEl = tdMeta.querySelector('.cl-rel-summary');
            if (sumEl) sumEl.textContent = rowRelationSummary(cluster);
            const cmtInput = card.querySelector('.sec-comment-input');
            if (cmtInput) {
              cmtInput.placeholder = nextRel === 'refutational'
                ? 'Explain how this study contrasts or disagrees in this row...'
                : 'Note on how this concept fits into this theme...';
            }

            await recordAuditLog({
              clusterIds: [cluster.id],
              category: 'third_order',
              action: `Judged construct as ${nextRel === 'unjudged' ? 'NOT YET JUDGED' : nextRel.toUpperCase()} in "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
              detail: `${getDisplayName(doc)} (p.${sec.page}): ${sec.note || '"' + sec.text.slice(0, 65) + '..."'}`,
              fromVal: prevRel,
              toVal: nextRel
            });
          };

          card.querySelector('.rev-badge-btn').onclick = (e) => {
            e.stopPropagation();
            promptReassignItemReviewer(sec, 'annotations', renderMatrixView);
          };

          let initialSecLabel = sec.note || '';
          const debouncedSaveCellSec = createDebouncedSaver(async () => {
            await dbPut('annotations', sec);
          }, 350);

          card.querySelector('.sec-label-input').addEventListener('input', e => {
            sec.note = e.target.value;
            debouncedSaveCellSec();
          });

          card.querySelector('.sec-label-input').onchange = async e => {
            const oldLabel = initialSecLabel;
            const newLabel = e.target.value.trim();
            sec.note = newLabel;
            await dbPut('annotations', sec);
            if (oldLabel !== newLabel) {
              initialSecLabel = newLabel;
              await recordAuditLog({
                category: 'matrix_mapping',
                action: `Updated 2nd Order Summary Label (${getDisplayName(doc)})`,
                fromVal: oldLabel || '(None)',
                toVal: newLabel
              });
            }
          };

          card.querySelector('.sec-comment-input').addEventListener('input', e => {
            if (!sec.clusterComments) sec.clusterComments = {};
            sec.clusterComments[cluster.id] = e.target.value.trim();
            debouncedSaveCellSec();
          });

          card.querySelector('.unassign-btn').onclick = async () => {
            await removeSecondOrderFromCluster(sec, cluster);
            renderMatrixView();
          };

          cellWrap.appendChild(card);
        });

        td.appendChild(cellWrap);
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  t.appendChild(tbody);
  if (scrollParent) {
    scrollParent.scrollTop = prevTop;
    scrollParent.scrollLeft = prevLeft;
  }
}

// --- C. 3rd Order Cluster Row Reordering (▲ / ▼) ---
async function persistClusterOrder() {
  for (let i = 0; i < state.clusters.length; i++) {
    state.clusters[i].order = i;
    await dbPut('clusters', state.clusters[i]);
  }
}

async function moveClusterOrder(clusterId, direction) {
  const fromIdx = state.clusters.findIndex(c => c.id === clusterId);
  const toIdx = fromIdx + direction;
  if (fromIdx < 0 || toIdx < 0 || toIdx >= state.clusters.length) return;

  const movedCluster = state.clusters[fromIdx];
  const [moved] = state.clusters.splice(fromIdx, 1);
  state.clusters.splice(toIdx, 0, moved);
  await persistClusterOrder();

  await recordAuditLog({
    clusterIds: [movedCluster.id],
    category: 'third_order',
    action: `Reordered 3rd Order Theme Row "${movedCluster.thirdOrderTitle || 'Untitled'}"`,
    fromVal: `Row #${fromIdx + 1}`,
    toVal: `Row #${toIdx + 1}`,
    detail: `Swapped with "${(state.clusters[fromIdx] && state.clusters[fromIdx].thirdOrderTitle) || 'Untitled'}". New row order: ${state.clusters.map((c, i) => (i + 1) + '. ' + (c.thirdOrderTitle || 'Untitled')).join(' | ')}`
  });

  renderLoaClusterChips();
  renderMatrixTable();
}

// ========================================================
// TAB 2 LEFT POOL RESIZER & COLLAPSE TOGGLE
// ========================================================
const matrixPoolResizer = document.getElementById('matrixPoolResizer');
const matrixLeftSidebar = document.getElementById('matrixLeftSidebar');
const collapsePoolBtn = document.getElementById('collapsePoolBtn');
const expandPoolBtn = document.getElementById('expandPoolBtn');
let isMatrixPoolResizing = false;

function setMatrixPoolCollapsed(collapsed) {
  if (!matrixLeftSidebar || !matrixPoolResizer || !expandPoolBtn) return;
  matrixLeftSidebar.classList.toggle('hidden', collapsed);
  matrixPoolResizer.classList.toggle('hidden', collapsed);
  expandPoolBtn.classList.toggle('hidden', !collapsed);
  expandPoolBtn.classList.toggle('flex', collapsed);
  localStorage.setItem('me_pool_collapsed', collapsed ? 'true' : 'false');
}

if (collapsePoolBtn && expandPoolBtn) {
  collapsePoolBtn.addEventListener('click', () => setMatrixPoolCollapsed(true));
  expandPoolBtn.addEventListener('click', () => setMatrixPoolCollapsed(false));
  if (localStorage.getItem('me_pool_collapsed') === 'true') {
    setMatrixPoolCollapsed(true);
  }
}

if (matrixPoolResizer && matrixLeftSidebar) {
  const savedPoolWidth = parseInt(localStorage.getItem('me_pool_width'), 10);
  if (!isNaN(savedPoolWidth) && savedPoolWidth >= 240 && savedPoolWidth <= 640) {
    matrixLeftSidebar.style.width = savedPoolWidth + 'px';
  }

  matrixPoolResizer.addEventListener('mousedown', (e) => {
    isMatrixPoolResizing = true;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isMatrixPoolResizing) return;
    const newWidth = Math.max(240, Math.min(640, e.clientX));
    matrixLeftSidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isMatrixPoolResizing) {
      isMatrixPoolResizing = false;
      document.body.style.cursor = 'default';
      const currentW = parseInt(matrixLeftSidebar.style.width, 10);
      if (!isNaN(currentW)) localStorage.setItem('me_pool_width', String(currentW));
    }
  });
}
