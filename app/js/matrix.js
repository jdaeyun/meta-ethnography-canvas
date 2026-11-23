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
// Fold the 3rd Order Theme column to a narrow strip (more room for the study columns); the setting is remembered
state.matrixThemeFolded = lsGet('me_theme_folded') === 'true';
function setThemeFolded(folded) {
  flushAllPendingSaves();
  state.matrixThemeFolded = folded;
  lsSet('me_theme_folded', folded ? 'true' : 'false');
  renderMatrixTable();
}

document.getElementById('matrixCompactToggle').addEventListener('change', (e) => {
  state.matrixCompactMode = e.target.checked;
  // Rebuild, so rows built later measure (and remember) their height under the right mode
  renderMatrixTable();
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
    createdAt: Date.now(),
    baseDocId: opts.baseDocId || '' // '' = the study of the first construct placed establishes the row
  });
  await dbPut('clusters', cluster);
  state.clusters.push(cluster);
  if (!opts.silent) {
    await recordAuditLog({
      clusterIds: [cluster.id],
      category: 'third_order',
      action: 'Created New 3rd Order Row',
      toVal: initialTitle || '(Untitled Concept Row)'
    });
  }
  return cluster;
}

async function assignSecondOrderToCluster(sec, cluster) {
  normalizeAnnotation(sec);
  if (sec.clusterIds.includes(cluster.id)) return;
  sec.clusterIds.push(cluster.id);
  if (!sec.clusterRelations) sec.clusterRelations = {};
  // No relation is assumed: the placement starts as "not yet judged" (see secRelation). A judgement, note or line-of-argument
  // mark left from an earlier placement in this row (kept by older versions when a card was taken out) does not come back.
  delete sec.clusterRelations[cluster.id];
  if (sec.clusterComments) delete sec.clusterComments[cluster.id];
  if (sec.aspectUsedInLoa && sec.aspectUsedInLoa[cluster.id]) { sec.aspectUsedInLoa = { ...sec.aspectUsedInLoa }; delete sec.aspectUsedInLoa[cluster.id]; }
  await dbPut('annotations', sec);
  normalizeCluster(cluster);
  // The first construct placed in a new row establishes it (◆); the reviewer can change this in the row header
  if (cluster.baseDocId === '') {
    cluster.baseDocId = sec.docId;
    await dbPut('clusters', cluster);
  }
  // The study now has a construct in this row, so an earlier "not addressed / different aspect" note no longer applies
  const prevStatus = emptyCellInfo(cluster, sec.docId);
  if (prevStatus) {
    delete cluster.cellStatus[sec.docId];
    await dbPut('clusters', cluster);
    await recordAuditLog({
      clusterIds: [cluster.id], category: 'relating_studies',
      action: `Cleared "${prevStatus.label}" for ${getDisplayName(state.docs.find(d => d.id === sec.docId))} in "${cluster.thirdOrderTitle || 'Untitled Row'}": a construct was placed there`,
      detail: prevStatus.note || '', fromVal: prevStatus.label, toVal: 'Construct placed'
    });
  }

  const doc = state.docs.find(d => d.id === sec.docId);
  await recordAuditLog({
    clusterIds: [cluster.id],
    category: 'matrix_mapping',
    action: `Placed 2nd Order Construct in a 3rd Order Row`,
    detail: `${getDisplayName(doc)} (p.${sec.page}): ${sec.note ? sec.note + ' — ' : ''}"${sec.text.slice(0, 75)}..."`,
    toVal: `Row: ${cluster.thirdOrderTitle || '(Untitled Row)'} [in ${sec.clusterIds.length} row(s)]`,
    isMinorOp: true
  });
}

async function removeSecondOrderFromCluster(sec, cluster) {
  normalizeAnnotation(sec);
  pushUndoAction({
    type: 'unassign_cluster',
    label: `Unassign "${(sec.note || sec.text).slice(0, 28)}" from "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
    secId: sec.id,
    clusterId: cluster.id,
    prevRelation: sec.clusterRelations ? sec.clusterRelations[cluster.id] : undefined,
    prevComment: sec.clusterComments ? sec.clusterComments[cluster.id] : '',
    prevAspectUsed: !!(sec.aspectUsedInLoa && sec.aspectUsedInLoa[cluster.id])
  });
  sec.clusterIds = sec.clusterIds.filter(id => id !== cluster.id);
  // Taken out of the row: its judgement, note and line-of-argument mark there go too (Ctrl+Z brings all three back)
  if (sec.clusterRelations) delete sec.clusterRelations[cluster.id];
  if (sec.clusterComments) delete sec.clusterComments[cluster.id];
  if (sec.aspectUsedInLoa && sec.aspectUsedInLoa[cluster.id]) { sec.aspectUsedInLoa = { ...sec.aspectUsedInLoa }; delete sec.aspectUsedInLoa[cluster.id]; }
  await dbPut('annotations', sec);

  const doc = state.docs.find(d => d.id === sec.docId);
  await recordAuditLog({
    clusterIds: [cluster.id],
    category: 'matrix_mapping',
    action: `Removed 2nd Order Construct from a 3rd Order Row`,
    detail: `${getDisplayName(doc)} (p.${sec.page}): ${sec.note || '"' + sec.text.slice(0, 60) + '..."'}`,
    fromVal: `Row: ${cluster.thirdOrderTitle || '(Untitled Row)'}`,
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

// One pass over the constructs, quotes and audit trail for the whole matrix, instead of one per row and card
function getMatrixIndex() {
  if (matrixIndexCache) return matrixIndexCache;
  const secsByRow = new Map(), quotesBySec = new Map(), logsByRow = new Map();
  state.annotations.forEach(a => {
    if (a.type === 'second_order') normalizeAnnotation(a).clusterIds.forEach(cid => { if (!secsByRow.has(cid)) secsByRow.set(cid, []); secsByRow.get(cid).push(a); });
    else if (a.type === 'first_order') quoteParentIds(a).forEach(pid => { if (!quotesBySec.has(pid)) quotesBySec.set(pid, []); quotesBySec.get(pid).push(a); });
  });
  state.logs.forEach(l => (l.clusterIds || []).forEach(cid => { if (!logsByRow.has(cid)) logsByRow.set(cid, new Set()); logsByRow.get(cid).add(l); }));
  matrixIndexCache = { secsByRow, quotesBySec, logsByRow };
  return matrixIndexCache;
}
function rowSecsIndexed(clusterId) { return getMatrixIndex().secsByRow.get(clusterId) || []; }
function quotesOfIndexed(secId) { return getMatrixIndex().quotesBySec.get(secId) || []; }
// Entries in a row's history (its own and those of the rows it absorbed or was split from; see logIsForRow)
function rowHistoryCount(cluster) {
  const idx = getMatrixIndex(), seen = new Set();
  rowHistoryIds(cluster).forEach(id => (idx.logsByRow.get(id) || []).forEach(l => seen.add(l)));
  return seen.size;
}

function computeClusterEvidenceStats(clusterId) {
  const mappedSecs = rowSecsIndexed(clusterId);
  const docIds = [...new Set(mappedSecs.map(s => s.docId))];
  const contributingDocs = docIds.map(id => state.docs.find(d => d.id === id)).filter(Boolean);
  const seenQ = new Set();
  mappedSecs.forEach(s => quotesOfIndexed(s.id).forEach(f => seenQ.add(f.id)));
  const quoteCount = seenQ.size; // a quote linked to two constructs in this row counts once

  return {
    studiesCount: contributingDocs.length,
    secCount: mappedSecs.length,
    quoteCount,
    contributingDocs
  };
}

function renderMatrixView() {
  flushAllPendingSaves();
  syncSeedToggle();
  renderStudyVisibilityBar();
  renderSecondOrderPool();
  renderMatrixTable();
  if (!divMatrix.classList.contains('hidden') && seedChoice() === null) maybeAskSeedChoice();
  if (seedChoice() === 'seed' && !divMatrix.classList.contains('hidden')) {
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
  if (seedChoice() !== 'seed' || indexSeedBusy || state.docs.length === 0) return false;
  indexSeedBusy = true;
  try {
    const indexDoc = state.docs[0];
    const fresh = state.annotations
      .filter(a => a.type === 'second_order' && a.docId === indexDoc.id)
      .map(normalizeAnnotation)
      .filter(sec => !sec.indexSeeded)
      .sort((a, b) => ((a.firstPage || parseInt(a.page, 10) || 0) - (b.firstPage || parseInt(b.page, 10) || 0)) || String(a.id).localeCompare(String(b.id)));
    if (fresh.length === 0) return false;

    // Study #1 has changed since rows were seeded (seeded rows come from another study): making rows from the new #1's
    // constructs is a new decision about method, so ask; "leave them" marks them, so the question is not asked again
    const seededFromOther = state.clusters.some(c => c.autoSeeded && c.seededFromId &&
      (state.annotations.find(a => a.id === c.seededFromId) || {}).docId !== indexDoc.id);
    const unplaced = fresh.filter(sec => liveClusterIds(sec).length === 0);
    if (seededFromOther && unplaced.length) {
      const how = await askChoice({
        title: `Study #1 is now ${getDisplayName(indexDoc)}`,
        body: `${unplaced.length} of its 2nd Order construct(s) are in no row. The rows so far were started from an earlier study #1.`,
        choices: [
          { value: 'leave', tone: 'primary', label: 'Leave them in the pool', hint: 'Place them yourself, by translating them into the existing rows or making rows for them.' },
          { value: 'seed', tone: 'plain', label: `Make a provisional row for each of them`, hint: 'As for the first study #1: each becomes a row established by this study (◆).' }
        ]
      });
      if (how !== 'seed') {
        if (how === 'leave') for (const sec of fresh) { sec.indexSeeded = true; await dbPut('annotations', sec); }
        return false;
      }
    }

    const created = [];
    const createdIds = [];
    for (const sec of fresh) {
      if (liveClusterIds(sec).length === 0) {
        const fallback = String(sec.text || '').replace(/^\[Concept derived[^\]]*\]:\s*/, '').replace(/^"+|"+$/g, '').trim();
        const title = ((sec.note || '').trim() || fallback).slice(0, 80);
        const cluster = await createNewClusterRow(title, { silent: true, baseDocId: indexDoc.id });
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

// ---- How the rows start is a project-level choice about method, asked once and recorded (loa.seedChoice) ----
// 'seed' = study #1's constructs become provisional rows; 'manual' = the reviewer creates every row. null = not decided yet.
function seedChoice() {
  const v = state.loa && state.loa.seedChoice;
  if (v === 'seed' || v === 'manual') return v;
  // Projects that already have rows were started one way or the other: read it from the rows, without asking
  if (state.clusters.length) return state.clusters.some(c => c.autoSeeded) ? 'seed' : 'manual';
  return null;
}
async function setSeedChoice(choice, why = '', reason = '') {
  const prev = seedChoice();
  state.loa = { ...state.loa, id: 'loa_main', seedChoice: choice, updatedAt: Date.now() };
  await dbPut('meta', state.loa);
  autoSeedToggleEl.checked = choice === 'seed';
  if (prev !== choice || reason) {
    await recordAuditLog({
      category: 'translation_process',
      action: choice === 'seed' ? 'Rows start from study #1: its 2nd Order constructs become provisional 3rd Order rows' : 'Rows are created by the reviewer: study #1 is not placed automatically',
      detail: reason || '',
      fromVal: prev === 'seed' ? 'Start from study #1' : prev === 'manual' ? 'Empty matrix' : '(not decided)',
      toVal: choice === 'seed' ? 'Start from study #1' : 'Empty matrix',
      rationale: why
    });
  }
}
let seedAskOpen = false;
function maybeAskSeedChoice() {
  if (seedAskOpen || !state.docs.length) return;
  const first = state.docs[0];
  if (!state.annotations.some(a => a.type === 'second_order' && a.docId === first.id)) return; // nothing to place yet
  seedAskOpen = true;
  document.getElementById('seedChoiceFirst').textContent = getDisplayName(first);
  document.getElementById('seedChoiceWhy').value = '';
  const m = document.getElementById('seedChoiceModal');
  m.classList.remove('hidden'); m.classList.add('flex');
}
function closeSeedChoice() {
  const m = document.getElementById('seedChoiceModal');
  m.classList.add('hidden'); m.classList.remove('flex');
  seedAskOpen = false;
}
async function chooseSeed(choice) {
  const why = document.getElementById('seedChoiceWhy').value.trim();
  closeSeedChoice();
  await setSeedChoice(choice, why);
  renderMatrixView();
}
document.getElementById('seedChoiceSeedBtn').addEventListener('click', () => chooseSeed('seed'));
document.getElementById('seedChoiceManualBtn').addEventListener('click', () => chooseSeed('manual'));
document.getElementById('seedChoiceCloseBtn').addEventListener('click', closeSeedChoice); // decide later: asked again next time

const autoSeedToggleEl = document.getElementById('autoSeedIndexToggle');
autoSeedToggleEl.checked = false; // set from the project once it is loaded (syncSeedToggle)
function syncSeedToggle() { autoSeedToggleEl.checked = seedChoice() === 'seed'; }
autoSeedToggleEl.addEventListener('change', async () => {
  const on = autoSeedToggleEl.checked;
  const why = await askReason({
    title: on ? 'Start rows from study #1' : 'Stop placing study #1 automatically',
    context: on ? 'Each 2nd Order construct of study #1 becomes a provisional row established by study #1 (◆), and the other studies are translated into these rows. Study #1\'s structure can shape the whole synthesis.' : 'You create the rows yourself; study #1 is not placed automatically. Rows already made stay as they are.',
    confirmLabel: on ? 'Start from study #1' : 'Stop', draftKey: 'seed-choice'
  });
  if (why === null) { syncSeedToggle(); return; } // cancelled: the setting stays as it was
  await setSeedChoice(autoSeedToggleEl.checked ? 'seed' : 'manual', why);
  if (autoSeedToggleEl.checked) renderMatrixView();
});

// ---- Paper visibility (focus mode for Tab 2) ----
function visibleDocCount() { return state.docs.filter(d => !state.hiddenStudyIds.has(d.id)).length; }
function saveHiddenStudies() {
  try { lsSet('me_hidden_studies', JSON.stringify([...state.hiddenStudyIds])); } catch (e) { /* ignore */ }
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
  const groups = [...new Set(state.docs.map(d => (d.group || '').trim()).filter(Boolean))];
  groups.forEach(g => {
    const members = state.docs.filter(d => (d.group || '').trim() === g);
    bar.appendChild(mk(`Subgroup: ${g} (${members.length})`, 'Show only this subgroup (subgroup-first translation). Click "Show all" afterwards to synthesise across subgroups.', () => {
      const keep = new Set(members.map(d => d.id));
      state.hiddenStudyIds = new Set(state.docs.filter(d => !keep.has(d.id)).map(d => d.id));
      refreshAfterVisibilityChange();
    }));
  });
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
      const hasRefutInCell = liveClusterIds(sec).some(cid => isSecRefutational(sec, cid));
      if (!hasRefutInCell) return false;
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
      ${count === 0 ? `<details class="pool-nt mt-1.5 rounded border border-slate-200 bg-slate-50 p-1.5" ${sec.notTranslatedNote ? 'open' : ''}>
        <summary class="text-[11px] font-semibold text-slate-600 cursor-pointer select-none">${sec.notTranslatedNote ? '✎ Why not translated (Appendix B)' : '+ Why not translated? (optional, reported in Appendix B)'}</summary>
        <textarea rows="2" class="pool-nt-input mt-1 w-full text-xs border border-slate-300 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-indigo-500 resize-y" placeholder="e.g., outside the review question; contradicts the rows but does not translate into any; too thin to interpret…">${escapeHtml(sec.notTranslatedNote)}</textarea>
      </details>` : ''}
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
    const ntInput = card.querySelector('.pool-nt-input');
    if (ntInput) {
      // The note box sits on a draggable card: keep text selection inside it from starting a drag
      card.querySelector('.pool-nt').addEventListener('mousedown', () => { card.draggable = false; });
      ntInput.addEventListener('blur', () => { card.draggable = true; });
      ntInput.addEventListener('mouseup', () => { card.draggable = true; });
      let initialNt = sec.notTranslatedNote;
      bindPendingCommit(ntInput, async () => {
        const next = ntInput.value.trim();
        if (next === initialNt.trim()) return;
        const prev = initialNt;
        initialNt = next;
        sec.notTranslatedNote = next;
        await dbPut('annotations', sec);
        await recordAuditLog({
          category: 'translation_process',
          action: 'Noted why a 2nd Order construct was not translated into any 3rd Order row',
          detail: `${docName} (p.${sec.page}): ${sec.note || '"' + String(sec.text || '').slice(0, 60) + '…"'}`,
          fromVal: prev,
          toVal: next
        });
      });
    }
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

let matrixRowObserver = null;
const matrixRowHeights = {};

// ---- Empty cell: nothing placed. Record whether the study was checked and does not address the row,
// or addresses a different aspect of the topic (Phase 4: the third way studies relate) ----
function buildEmptyCell(cluster, doc) {
  normalizeCluster(cluster);
  const info = emptyCellInfo(cluster, doc.id);
  const wrap = document.createElement('div');
  wrap.className = `empty-cell h-full min-h-[120px] rounded border border-dashed ${info ? (info.status === 'other_aspect' ? 'border-sky-300 bg-sky-50/40' : 'border-slate-300 bg-slate-50') : 'border-slate-200'} flex flex-col items-center justify-center gap-1.5 p-1.5 text-[13px] text-slate-400`;
  wrap.innerHTML = `
    ${info ? `<div class="text-lg leading-none ${info.status === 'other_aspect' ? 'text-sky-700' : 'text-slate-500'}" aria-hidden="true">${info.symbol}</div>` : '<div class="select-none text-slate-300">Drop 2nd Order here</div>'}
    <select class="empty-status matrix-card-detail max-w-full text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600" title="Nothing of this study is in this row. Was it checked?">
      <option value="">Not yet checked</option>
      ${Object.entries(EMPTY_CELL_STATUS).map(([k, v]) => `<option value="${k}" ${info && info.status === k ? 'selected' : ''}>${v.symbol} ${escapeHtml(v.label)}</option>`).join('')}
    </select>
    ${info ? `<input type="text" class="empty-note matrix-card-detail w-full text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-700" placeholder="${info.status === 'other_aspect' ? 'Which aspect? (feeds the line of argument)' : 'Why (optional)'}" value="${escapeHtml(info.note || '')}">` : ''}`;
  const sel = wrap.querySelector('.empty-status');
  sel.addEventListener('mousedown', e => e.stopPropagation());
  sel.onchange = async () => {
    const prev = emptyCellInfo(cluster, doc.id);
    if (sel.value) cluster.cellStatus[doc.id] = { status: sel.value, note: prev ? prev.note || '' : '' };
    else delete cluster.cellStatus[doc.id];
    await dbPut('clusters', cluster);
    if (state.isLoaOpen) renderLoaAspects(); // the drawer lists the ◇ cells
    await recordAuditLog({
      clusterIds: [cluster.id], category: 'relating_studies',
      action: `${getDisplayName(doc)} in "${cluster.thirdOrderTitle || 'Untitled Row'}": ${sel.value ? EMPTY_CELL_STATUS[sel.value].label : 'not yet checked'}`,
      fromVal: prev ? prev.label : 'Not yet checked', toVal: sel.value ? EMPTY_CELL_STATUS[sel.value].label : 'Not yet checked'
    });
    wrap.replaceWith(buildEmptyCell(cluster, doc));
  };
  const note = wrap.querySelector('.empty-note');
  if (note) {
    let committed = (info && info.note) || '';
    bindPendingCommit(note, async () => {
      const next = note.value.trim();
      if (next === committed || !cluster.cellStatus[doc.id]) return;
      const prev = committed; committed = next;
      cluster.cellStatus[doc.id].note = next;
      await dbPut('clusters', cluster);
      await recordAuditLog({
        clusterIds: [cluster.id], category: 'relating_studies',
        action: `Note on ${getDisplayName(doc)} in "${cluster.thirdOrderTitle || 'Untitled Row'}" (${EMPTY_CELL_STATUS[cluster.cellStatus[doc.id].status].label})`,
        fromVal: prev, toVal: next
      });
    });
  }
  return wrap;
}

function renderMatrixTable() {
  if (matrixRowObserver) { matrixRowObserver.disconnect(); matrixRowObserver = null; }
  invalidateMatrixIndex(); // state may have changed in memory since the last write
  const t = document.getElementById('matrixTable');
  const scrollParent = t ? t.parentElement : null;
  const prevTop = scrollParent ? scrollParent.scrollTop : 0;
  const prevLeft = scrollParent ? scrollParent.scrollLeft : 0;
  // Anchor = the first row visible now. After the rebuild, scroll so this same row sits at the same place on screen,
  // however the heights of not-yet-built rows were estimated.
  let anchorId = null, anchorOffset = 0;
  if (scrollParent && scrollParent.clientHeight > 0) {
    const ptop = scrollParent.getBoundingClientRect().top;
    for (const r of t.querySelectorAll('tbody > tr[data-cluster-id]')) {
      const rect = r.getBoundingClientRect();
      if (rect.bottom > ptop + 1) { anchorId = r.dataset.clusterId; anchorOffset = rect.top - ptop; break; }
    }
  }
  t.innerHTML = '';
  t.classList.toggle('matrix-compact', Boolean(state.matrixCompactMode));
  t.classList.toggle('matrix-theme-folded', Boolean(state.matrixThemeFolded));

  if (state.docs.length === 0) {
    t.innerHTML = '<tr><td class="p-6 text-sm text-slate-500">Add PDF studies in the Extract View first.</td></tr>';
    return;
  }

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  htr.innerHTML = `
    <th>
      <div class="theme-head-full flex items-start justify-between gap-2">
        <div>
          <div class="text-xs font-bold text-slate-800">3rd Order Theme (Your Synthesis)</div>
          <div class="text-xs font-normal text-slate-500 mt-0.5">Use the tabs below each theme title to switch between Synthesis, CERQual, and Team Perspectives</div>
        </div>
        <button type="button" class="theme-fold-btn shrink-0 px-1.5 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 cursor-pointer text-xs" title="Fold this column to a narrow strip (more room for the studies)">◀</button>
      </div>
      <button type="button" class="theme-head-strip theme-unfold-btn px-1 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 cursor-pointer text-xs" title="Expand the theme column">▶</button>
    </th>
  `;
  htr.querySelector('.theme-fold-btn').onclick = () => setThemeFolded(true);
  htr.querySelector('.theme-unfold-btn').onclick = () => setThemeFolded(false);

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
          ${(() => { const ls = studyConceptLinks(d); return ls.length ? `<details class="text-xs bg-white border border-violet-200 rounded p-1 mt-1"><summary class="font-semibold text-violet-900 cursor-pointer select-none">🔗 How its concepts relate (${ls.length})</summary><ul class="mt-1 space-y-0.5 text-slate-700">${ls.map(l => `<li>${escapeHtml(conceptLinkText(l))}${l.note ? ` <span class="text-slate-500">— ${escapeHtml(l.note)}</span>` : ''}</li>`).join('')}</ul></details>` : ''; })()}
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

  const visibleClusters = matrixVisibleClusters();

  if (visibleClusters.length === 0) {
    const emptyFilterTr = document.createElement('tr');
    emptyFilterTr.innerHTML = `
      <td colspan="${visibleDocCount() + 1}" class="p-8 text-center text-rose-700 bg-rose-50/40 text-xs">
        No rows match the <b>⚡ Contradictions Only</b> filter. Uncheck the filter above or mark a row/construct as Refutational.
      </td>
    `;
    tbody.appendChild(emptyFilterTr);
    t.appendChild(tbody);
    return;
  }

  // One pass over the annotations: (row id | study id) -> its 2nd Order constructs, so each cell does not rescan everything
  const cellIndex = new Map();
  state.annotations.forEach(a => {
    if (a.type !== 'second_order') return;
    normalizeAnnotation(a).clusterIds.forEach(cid => {
      const key = cid + '|' + a.docId;
      const list = cellIndex.get(key);
      if (list) list.push(a); else cellIndex.set(key, [a]);
    });
  });

  // Rows are built lazily: only rows near the viewport get their (heavy) content; the rest are light placeholders
  // that are filled in as they scroll into view. This keeps big projects (dozens of studies) responsive.
  const compactKey = (state.matrixCompactMode ? 'c' : 'n') + (state.matrixThemeFolded ? 'f' : 'w'); // row heights differ per layout
  const knownHeights = Object.values(matrixRowHeights).filter(h => typeof h === 'number' && h > 0);
  const avgRowHeight = knownHeights.length ? knownHeights.reduce((x, y) => x + y, 0) / knownHeights.length : 320;
  const eagerLimit = prevTop + (scrollParent ? scrollParent.clientHeight : 900) + 1200;
  let estimatedBottom = 0;
  const anchorIdx = anchorId ? visibleClusters.findIndex(c => c.id === anchorId) : -1;
  const viewH = scrollParent ? scrollParent.clientHeight : 900;
  let sinceAnchor = 0;
  const lazyRows = new Map();

  visibleClusters.forEach((cluster, rowIdx) => {
    normalizeCluster(cluster);

    const tr = document.createElement('tr');
    tr.dataset.clusterId = cluster.id;
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

    const buildRowBody = () => {
    const cBadge = getConcordanceBadgeMeta(cluster.concordanceStatus);
    const cqBadge = getCerqualBadgeMeta(cluster.cerqualConfidence);
    const stats = computeClusterEvidenceStats(cluster.id);
    const activeSubTab = state.clusterActiveTabs[cluster.id] || 'synthesis';

    const tdMeta = document.createElement('td');
    tdMeta.innerHTML = `
      <div class="space-y-2">
        <!-- Header Badges & Reviewer -->
        <div class="flex items-center justify-between">
          <div class="flex items-center flex-wrap gap-1">
            <span class="text-xs font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">3rd Order</span>
            <button type="button" class="cl-rev-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 px-1.5 py-0.2 rounded font-mono cursor-pointer" title="Click to change reviewer for this 3rd Order row">@${escapeHtml(cluster.by || 'Unknown')}</button>
            <span class="cl-conc-pill text-[11px] px-1.5 py-0.2 rounded border font-semibold ${cBadge.cls}">${cBadge.label}</span>
            ${(() => { const n = rowHistoryCount(cluster); return n ? `<button type="button" class="cl-history-btn text-[11px] px-1.5 py-0.2 rounded border border-purple-300 bg-purple-50 text-purple-800 font-semibold cursor-pointer hover:bg-purple-100" title="Open this row's history in the Audit Trail (${n} entr${n === 1 ? 'y' : 'ies'})">🕘 ${n}</button>` : ''; })()}
            ${cluster.autoSeeded && !cluster.seedConfirmed ? `<button type="button" class="cl-seed-confirm text-[11px] px-1.5 py-0.2 rounded border border-amber-400 bg-amber-100 text-amber-900 font-semibold cursor-pointer" title="Auto-placed from the Index Paper's 2nd order construct. The title is still the primary authors' wording, not yet your 3rd order interpretation. Click once you have reviewed / rewritten it.">🌱 Provisional · click to confirm</button>` : ''}
            <span class="cl-cerqual-pill text-[11px] px-1.5 py-0.2 rounded border font-semibold ${cqBadge.cls}">${cqBadge.label}</span>
          </div>
          <div class="flex items-center space-x-1">
            <button type="button" class="move-cl-up px-1.5 py-0.2 bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer text-[11px]" ${rowIdx === 0 ? 'disabled' : ''} title="Move row up">▲</button>
            <button type="button" class="move-cl-down px-1.5 py-0.2 bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer text-[11px]" ${rowIdx === visibleClusters.length - 1 ? 'disabled' : ''} title="Move row down">▼</button>
            <button type="button" class="cl-rowops text-slate-400 hover:text-indigo-600 cursor-pointer ml-1" title="Merge this row into another, or split some of its cards into a new row"><i class="ph ph-git-merge"></i></button>
            <button class="del-cluster text-slate-400 hover:text-rose-500 cursor-pointer ml-1" title="Delete Row"><i class="ph ph-trash"></i></button>
          </div>
        </div>
        
        ${(() => {
          // Which study's construct established this row (◆). Its own cards are not judged in this row; every other study's are.
          const rowDocIds = new Set(rowSecsIndexed(cluster.id).map(a => a.docId));
          const rowDocs = state.docs.filter(d => rowDocIds.has(d.id));
          const base = rowBaseDocId(cluster);
          if (!rowDocs.length && !base) return '';
          const opts = rowDocs.slice();
          if (base && !opts.some(d => d.id === base)) opts.unshift(state.docs.find(d => d.id === base));
          return `<div class="flex items-center flex-wrap gap-1 text-[11px] text-slate-600">
            <span class="font-semibold" title="The study whose construct established this row. Its cards here are the reading the other studies are translated into, so they get no Reciprocal / Refutational judgement. In index-paper approaches this is usually study #1; choose 'No single base' if you compare every concept with all the others.">◆ Established by</span>
            <select class="cl-base-select text-[11px] border border-slate-300 rounded px-1 py-0.5 bg-white max-w-full">
              ${opts.map(d => `<option value="${escapeHtml(d.id)}" ${d.id === base ? 'selected' : ''}>${escapeHtml(getDisplayName(d))}${state.docs[0] && state.docs[0].id === d.id ? ' (#1)' : ''}${rowDocs.includes(d) ? '' : ' (no construct here)'}</option>`).join('')}
              <option value="" ${base ? '' : 'selected'}>No single base: judge every study</option>
            </select>
          </div>`;
        })()}

        ${cluster.baselineChange ? (() => {
          const bc = cluster.baselineChange;
          const nowFirst = state.docs[0];
          const canRebase = nowFirst && nowFirst.id !== rowBaseDocId(cluster) && state.annotations.some(a => a.type === 'second_order' && a.docId === nowFirst.id && (a.clusterIds || []).includes(cluster.id));
          return `<div class="cl-baseline-warn rounded border border-amber-400 bg-amber-50 p-1.5 text-[11px] text-amber-900 leading-snug">
          <div class="font-bold">⚠ Study #1 changed after this row was built</div>
          <div>This row was established by ${escapeHtml(bc.fromName || 'the former #1')}, which is no longer study #1 (now <b>${escapeHtml(bc.toName)}</b>). The row keeps its base: the other studies were translated into ${escapeHtml(bc.fromName || 'that study')}'s construct. Re-read it: does the row and its title still hold in the new translation order?${canRebase ? ` If ${escapeHtml(getDisplayName(nowFirst))} should establish it instead, make it the base: ${escapeHtml(bc.fromName || 'the former #1')} is then translated into the row.` : ''}</div>
          <div class="flex flex-wrap gap-1 mt-1">
            ${canRebase ? `<button type="button" class="cl-baseline-rebase px-1.5 py-0.5 rounded border border-amber-400 bg-white font-semibold cursor-pointer hover:bg-amber-100">Make ${escapeHtml(getDisplayName(nowFirst))} the base</button>` : ''}
            <button type="button" class="cl-baseline-ok px-1.5 py-0.5 rounded border border-amber-400 bg-white font-semibold cursor-pointer hover:bg-amber-100">Re-read · mark as reviewed</button>
          </div>
        </div>`;
        })() : ''}

        <!-- Always-visible 3rd Order Title -->
        <input type="text" class="cluster-title w-full text-xs font-bold border border-slate-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-indigo-600" placeholder="3rd Order Construct / Theme Name..." value="${escapeHtml(cluster.thirdOrderTitle)}">

        <!-- 3-Mode Mini-Tab Bar to prevent vertical clutter -->
        <div class="cl-subtab-bar grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
          <button type="button" data-subtab="synthesis" class="cl-subtab-btn py-1 rounded font-semibold cursor-pointer transition ${activeSubTab === 'synthesis' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">📝 Synthesis</button>
          <button type="button" data-subtab="cerqual" class="cl-subtab-btn py-1 rounded font-semibold cursor-pointer transition ${activeSubTab === 'cerqual' ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">📊 CERQual</button>
          <button type="button" data-subtab="concordance" class="cl-subtab-btn py-1 rounded font-semibold cursor-pointer transition ${activeSubTab === 'concordance' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">🤝 Team</button>
        </div>

        <!-- SUB-PANEL 1: SYNTHESIS (Default) -->
        <div class="subpanel-synthesis space-y-2 ${activeSubTab === 'synthesis' ? '' : 'hidden'}">
          <div class="rounded border border-emerald-200 bg-emerald-50/40 p-1.5">
            <label class="block text-xs font-bold text-emerald-900 mb-0.5" title="Phase 5 (Noblit & Hare): translate the studies into one another. Keep each study's own concepts and terms visible — name the study and its concept, then say how it maps onto (reciprocal) or challenges (refutational) the others, and what context explains the difference.">Step A · Translation Summary <span class="font-normal text-emerald-700">(Phase 5 — in the studies' own terms)</span></label>
            <textarea class="cluster-trans w-full text-[13px] border border-emerald-300 rounded p-1.5 h-20 resize-y bg-white focus:outline-none focus:border-emerald-600 font-normal" placeholder="Study by study, keeping the authors' concepts: e.g., 'Smith's “holding back” corresponds to Lee's “protective silence” — both describe…; Tanaka's “open disclosure” runs counter to these, which may reflect the outpatient setting…'. Note what is shared, what differs or contradicts, and the context of each.">${escapeHtml(cluster.translationSummary)}</textarea>
          </div>
          <div class="rounded border border-indigo-200 bg-indigo-50/40 p-1.5">
            <label class="block text-xs font-bold text-indigo-900 mb-0.5" title="The 3rd order construct is the reviewer's own interpretation, derived from the translation in Step A. It should say something that no single study says on its own.">Step B · 3rd Order Construct: Definition & Interpretation <span class="font-normal text-indigo-700">(derived from Step A)</span></label>
            <div class="cl-stepb-warn text-[11px] text-amber-700 font-semibold mb-0.5 ${(cluster.synthesisNote && !cluster.translationSummary) ? '' : 'hidden'}">⚠ Step A is empty. A 3rd order construct should be derived from the translation, not written directly from the grouped cards.</div>
            <textarea class="cluster-note w-full text-[13px] border border-indigo-300 rounded p-1.5 h-20 resize-y bg-white focus:outline-none focus:border-indigo-600 font-normal" placeholder="Your construct in your own words: what it means (definition), and what the translation shows that goes beyond any single study (interpretation).">${escapeHtml(cluster.synthesisNote)}</textarea>
          </div>
          <div class="rounded border border-amber-200 bg-amber-50/40 p-1.5">
            <label class="block text-xs font-bold text-amber-900 mb-0.5" title="Optional. In qualitative research the interpreter is part of the analysis: say, in a line or two, how your own background or position may have shaped this construct. Recorded in the Audit Trail as a reflexive memo.">Reflexive note <span class="font-normal text-amber-700">(optional: how does my position shape this reading?)</span></label>
            <textarea class="cluster-reflex w-full text-[13px] border border-amber-300 rounded p-1.5 h-12 resize-y bg-white focus:outline-none focus:border-amber-600 font-normal" placeholder="e.g., As a former ward nurse I may over-read “alone” as isolation...">${escapeHtml(cluster.reflexiveNote)}</textarea>
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
            <span class="text-xs font-bold text-indigo-900">🤝 Team Perspectives</span>
            <select class="cl-conc-status text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white font-semibold">
              <option value="pending" ${cluster.concordanceStatus === 'pending' ? 'selected' : ''}>⏳ Pending</option>
              <option value="discuss" ${cluster.concordanceStatus === 'discuss' ? 'selected' : ''}>💬 Needs Discussion</option>
              <option value="agreed" ${cluster.concordanceStatus === 'agreed' ? 'selected' : ''}>✅ Agreed (for now)</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-indigo-900 mb-0.5">Co-Reviewer / Supervisor Discussion Note</label>
            <textarea class="cl-conc-note w-full text-xs border border-slate-200 rounded p-1.5 h-16 resize-y bg-white focus:outline-none focus:border-indigo-500" placeholder="Record how the team read this 3rd order construct, or supervisory feedback...">${escapeHtml(cluster.concordanceNote)}</textarea>
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

    // Narrow strip shown instead of the full panel when the column is folded (row number + title, click to expand)
    tdMeta.firstElementChild.classList.add('theme-full');
    tdMeta.insertAdjacentHTML('beforeend', `<div class="theme-fold-strip" title="${escapeHtml(cluster.thirdOrderTitle || 'Untitled row')} (click to expand)"><span class="theme-strip-num">#${state.clusters.indexOf(cluster) + 1}</span><span class="theme-strip-title">${escapeHtml(cluster.thirdOrderTitle || 'Untitled row')}</span></div>`);
    tdMeta.querySelector('.theme-fold-strip').onclick = () => setThemeFolded(false);

    const historyBtn = tdMeta.querySelector('.cl-history-btn');
    if (historyBtn) historyBtn.onclick = () => {
      setActiveTab('audit');
      const rowSel = document.getElementById('auditFilterRow');
      const catSel = document.getElementById('auditFilterCategory');
      if (catSel) catSel.value = 'all';
      if (rowSel) { rowSel.value = cluster.id; renderAuditTimeline(); }
    };

    let initialClusterTitle = cluster.thirdOrderTitle || '';
    // Only the row title appears in the line-of-argument drawer (chips, map labels): redraw it when the title changed
    let chipsTitle = cluster.thirdOrderTitle;
    const debouncedSaveCluster = createDebouncedSaver(async () => {
      await dbPut('clusters', cluster);
      if (cluster.thirdOrderTitle !== chipsTitle) { chipsTitle = cluster.thirdOrderTitle; renderLoaClusterChips(); }
    }, 350);

    tdMeta.querySelector('.cluster-title').addEventListener('input', e => {
      cluster.thirdOrderTitle = e.target.value.trim();
      const stripTitle = tdMeta.querySelector('.theme-strip-title');
      if (stripTitle) stripTitle.textContent = cluster.thirdOrderTitle || 'Untitled row';
      debouncedSaveCluster();
    });

    bindPendingCommit(tdMeta.querySelector('.cluster-title'), async () => {
      const e = { target: tdMeta.querySelector('.cluster-title') };
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
    });

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
    bindPendingCommit(tdMeta.querySelector('.cluster-trans'), async () => {
      const e = { target: tdMeta.querySelector('.cluster-trans') };
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
    });

    let initialClusterNote = cluster.synthesisNote || '';
    tdMeta.querySelector('.cluster-note').addEventListener('input', e => {
      cluster.synthesisNote = e.target.value;
      refreshStepBWarn();
      debouncedSaveCluster();
    });

    bindPendingCommit(tdMeta.querySelector('.cluster-note'), async () => {
      const e = { target: tdMeta.querySelector('.cluster-note') };
      const oldNote = initialClusterNote;
      const newNote = e.target.value.trim();
      if (oldNote !== newNote) {
        initialClusterNote = newNote;
        cluster.synthesisNote = newNote;
        await dbPut('clusters', cluster);
        await recordAuditLog({
          clusterIds: [cluster.id],
          category: 'third_order',
          action: `Updated Step B 3rd Order Definition & Interpretation for "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
          fromVal: oldNote || '(Empty)',
          toVal: newNote
        });
      }
    });

    let initialReflex = cluster.reflexiveNote || '';
    const reflexEl = tdMeta.querySelector('.cluster-reflex');
    reflexEl.addEventListener('input', e => { cluster.reflexiveNote = e.target.value; debouncedSaveCluster(); });
    bindPendingCommit(reflexEl, async () => {
      const oldVal = initialReflex;
      const newVal = reflexEl.value.trim();
      if (oldVal === newVal) return;
      initialReflex = newVal;
      cluster.reflexiveNote = newVal;
      await dbPut('clusters', cluster);
      await recordAuditLog({
        clusterIds: [cluster.id],
        category: 'reflexive_memo',
        action: `Reflexive note on "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
        fromVal: oldVal || '(Empty)',
        toVal: newVal || '(Empty)'
      });
    });

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
        action: `3rd Order Team Perspective Updated ("${cluster.thirdOrderTitle || 'Untitled Row'}")`,
        detail: newNote ? `Team Discussion Note: ${newNote}` : 'Updated team status.',
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
    // Changing the study that established the row: logged, and its effect on the cards is stated
    const setRowBase = async (nextId, extraDetail = '') => {
      const prevId = rowBaseDocId(cluster);
      if ((prevId || '') === (nextId || '')) return;
      const nameOf = id => { const d = id && state.docs.find(x => x.id === id); return d ? getDisplayName(d) : 'No single base'; };
      cluster.baseDocId = nextId || null;
      const clearedFlag = !!(cluster.baselineChange && nextId && state.docs[0] && nextId === state.docs[0].id);
      if (clearedFlag) delete cluster.baselineChange;
      await dbPut('clusters', cluster);
      await recordAuditLog({
        clusterIds: [cluster.id],
        category: 'third_order',
        action: `Changed the study that established "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
        detail: [
          prevId ? `${nameOf(prevId)} is now translated into the row: judge its cards here (Reciprocal / Refutational).` : '',
          nextId ? `${nameOf(nextId)}'s own Reciprocal / Refutational judgements in this row are kept but not shown while it is the base.` : 'Every study in the row is now judged against the row.',
          clearedFlag ? 'The row is now based on the current study #1, so the re-reading note is cleared.' : '',
          extraDetail
        ].filter(Boolean).join(' '),
        fromVal: nameOf(prevId),
        toVal: nameOf(nextId)
      });
      renderMatrixView();
    };
    const baseSel = tdMeta.querySelector('.cl-base-select');
    if (baseSel) baseSel.onchange = () => setRowBase(baseSel.value || null);
    const rebaseBtn = tdMeta.querySelector('.cl-baseline-rebase');
    if (rebaseBtn) rebaseBtn.onclick = () => setRowBase(state.docs[0].id, 'Chosen after study #1 changed.');
    const baselineOkBtn = tdMeta.querySelector('.cl-baseline-ok');
    if (baselineOkBtn) baselineOkBtn.onclick = async () => {
      const bc = cluster.baselineChange;
      const why = await askReason({
        title: `Re-read: ${cluster.thirdOrderTitle || 'Untitled Row'}`,
        context: `Study #1 changed from ${bc.fromName || 'another study'} to ${bc.toName}.`,
        label: 'What did you check or change in this row? (optional, saved in the Audit Trail)',
        confirmLabel: 'Mark as re-read', draftKey: 'reread-' + cluster.id
      });
      if (why === null) return;
      delete cluster.baselineChange;
      await dbPut('clusters', cluster);
      await recordAuditLog({
        clusterIds: [cluster.id],
        category: 'third_order',
        action: `Re-read row after study #1 changed: "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
        detail: `#1 changed from ${bc.fromName || 'another study'} to ${bc.toName}.`,
        rationale: why
      });
      renderMatrixTable();
    };
    bindPendingCommit(tdMeta.querySelector('.cl-conc-note'), updateClusterConcordance);

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

    ['.cq-lim', '.cq-coh', '.cq-adeq', '.cq-rel', '.cq-conf'].forEach(sel => {
      tdMeta.querySelector(sel).onchange = saveCerqualChanges;
    });
    ['.cq-exp', '.cq-lim-note', '.cq-coh-note', '.cq-adeq-note', '.cq-rel-note'].forEach(sel => {
      bindPendingCommit(tdMeta.querySelector(sel), saveCerqualChanges);
    });

    tdMeta.querySelector('.cl-rowops').onclick = () => openRowOps(cluster);
    tdMeta.querySelector('.del-cluster').onclick = async () => {
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
        action: 'Deleted 3rd Order Row',
        fromVal: cluster.thirdOrderTitle || '(Untitled Row)'
      });
      renderMatrixView();
      showUndoSnackbar(`Removed the row "${cluster.thirdOrderTitle || 'Untitled'}" (its constructs stay in the pool / other rows)`);
    };

    tr.appendChild(tdMeta);

    state.docs.forEach(doc => {
      if (state.hiddenStudyIds.has(doc.id)) return;
      const td = document.createElement('td');
      const cellConstructs = cellIndex.get(cluster.id + '|' + doc.id) || [];

      if (cellConstructs.length === 0) {
        td.appendChild(buildEmptyCell(cluster, doc));
      } else {
        const cellWrap = document.createElement('div');
        cellWrap.className = 'space-y-2.5';

        cellConstructs.forEach(sec => {
          const firsts = quotesOfIndexed(sec.id);
          const otherClustersCount = sec.clusterIds.length - 1;
          const cellComment = (sec.clusterComments && sec.clusterComments[cluster.id]) || '';
          const cellRelation = secRelation(sec, cluster.id);
          const isBaselineCell = cellRelation === 'baseline';
          const relMeta = getCellRelationMeta(cellRelation);
          const secBadge = getConcordanceBadgeMeta(sec.concordanceStatus);
          const showConcUI = state.teamMode || sec.concordanceStatus !== 'pending' || Boolean(sec.concordanceNote);

          const placeholderFor = rel => rel === 'refutational' ? 'Explain how this study contrasts or disagrees in this row...'
            : rel === 'other_aspect' ? 'Which other aspect of the topic does this speak to, and how might it feed the line of argument?'
            : rel === 'unjudged' ? 'Read it against the row: does it translate into it (reciprocal) or contrast with it (refutational)?' : 'Note on how this concept fits into this theme...';
          const cellPlaceholder = placeholderFor(cellRelation);

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
                  ? `<span class="text-[11px] font-bold px-1.5 py-0.5 rounded border ${relMeta.badgeCls}" title="This study's construct established the row; the constructs of the other studies are judged against it (Reciprocal / Refutational). Change it under Established by in the row header.">${relMeta.label}</span>`
                  : `<select class="rel-select text-[11px] font-bold px-1 py-0.5 rounded border cursor-pointer ${relMeta.badgeCls}" title="How this study's construct relates to the row: not yet judged, Reciprocal (translates into it), Refutational (contrasts with it) or Different aspect (speaks to another aspect of the topic, for the line of argument)">
                  ${CELL_RELATIONS.map(r => `<option value="${r}" ${r === cellRelation ? 'selected' : ''}>${escapeHtml(getCellRelationMeta(r).label)}</option>`).join('')}
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
            <div class="cell-quote-display text-[13px] font-serif italic text-slate-700 bg-white p-1.5 rounded border ${relMeta.quoteBorderCls} leading-snug cursor-pointer" title="Double-click to edit quote text">"${escapeHtml(sec.text)}"</div>
            <div class="matrix-card-detail cell-quote-editor hidden space-y-1 bg-amber-50/70 p-1.5 rounded border border-amber-200 mt-1">
              <textarea class="cell-quote-textarea w-full text-xs border border-amber-300 rounded p-1 bg-white focus:outline-none focus:border-indigo-500 resize-y h-16">${escapeHtml(sec.text)}</textarea>
              <div class="flex justify-end space-x-1">
                <button type="button" class="cell-quote-cancel px-1.5 py-0.5 text-[11px] bg-white border border-slate-300 rounded text-slate-600 cursor-pointer">Cancel</button>
                <button type="button" class="cell-quote-save px-2 py-0.5 text-[11px] bg-emerald-600 text-white font-bold rounded cursor-pointer">Save</button>
              </div>
            </div>
            <input type="text" class="matrix-card-detail sec-label-input w-full text-xs font-bold text-slate-800 border-b border-transparent hover:border-slate-300 focus:border-emerald-600 bg-transparent py-0.5 mt-1 focus:outline-none" placeholder="Label: authors' own term (optional)" value="${escapeHtml(sec.note)}" title="${escapeHtml(sec.text)}">
            ${nuanceHtml}
            ${quotesHtml}
            <div class="matrix-card-detail mt-2 pt-1.5 border-t ${relMeta.dividerCls}">
              <div class="sec-comment-view text-xs border border-slate-200 rounded px-1.5 py-1 bg-white cursor-text whitespace-pre-wrap break-words ${cellComment ? 'text-slate-700' : 'text-slate-400'}" title="${escapeHtml(cellComment || 'Click to write a note')}">${escapeHtml(cellComment || cellPlaceholder)}</div>
              <textarea rows="3" class="sec-comment-input hidden w-full text-xs border border-indigo-400 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-indigo-500 resize-y" placeholder="${cellPlaceholder}">${escapeHtml(cellComment)}</textarea>
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
            if (cellQuoteDisp.closest('.matrix-compact')) return;
            toggleCellQuoteEdit(true);
          };
          card.querySelector('.cell-quote-cancel').onclick = () => toggleCellQuoteEdit(false);
          card.querySelector('.cell-quote-save').onclick = async () => {
            const cleaned = stripOuterQuotes(cellQuoteTa.value);
            if (cleaned && cleaned !== sec.text) {
              const oldText = sec.text;
              sec.text = cleaned;
              cellQuoteDisp.textContent = `"${cleaned}"`;
              await dbPut('annotations', sec);
              await logExtractedTextEdit(sec, oldText);
            }
            toggleCellQuoteEdit(false);
          };

          const relSelect = card.querySelector('.rel-select');
          if (relSelect) {
            relSelect.addEventListener('mousedown', e => e.stopPropagation());
            relSelect.onchange = async (e) => {
              e.stopPropagation();
              if (!sec.clusterRelations) sec.clusterRelations = {};
              const prevRel = secRelation(sec, cluster.id);
              const nextRel = relSelect.value;
              if (nextRel === prevRel) return;
              sec.clusterRelations[cluster.id] = nextRel;
              await dbPut('annotations', sec);
              if (state.isLoaOpen && (nextRel === 'other_aspect' || prevRel === 'other_aspect')) renderLoaAspects();

              const nextMeta = getCellRelationMeta(nextRel);
              card.className = `matrix-cell-card ${nextMeta.cardCls} border rounded-lg p-2.5 shadow-sm text-xs cursor-grab transition`;
              relSelect.className = `rel-select text-[11px] font-bold px-1 py-0.5 rounded border cursor-pointer ${nextMeta.badgeCls}`;
              const cmtInput = card.querySelector('.sec-comment-input');
              if (cmtInput) {
                cmtInput.placeholder = placeholderFor(nextRel);
                const cmtView = card.querySelector('.sec-comment-view');
                if (cmtView && !cmtInput.value.trim()) cmtView.textContent = placeholderFor(nextRel);
              }
              await recordAuditLog({
                clusterIds: [cluster.id],
                category: 'third_order',
                action: `Judged construct as ${getCellRelationMeta(nextRel).label.replace(/^\S+\s/, '')} in "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
                detail: `${getDisplayName(doc)} (p.${sec.page}): ${sec.note || '"' + sec.text.slice(0, 65) + '..."'}`,
                fromVal: getCellRelationMeta(prevRel).label,
                toVal: getCellRelationMeta(nextRel).label
              });
            };
          }

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

          bindPendingCommit(card.querySelector('.sec-label-input'), async () => {
            const e = { target: card.querySelector('.sec-label-input') };
            const oldLabel = initialSecLabel;
            const newLabel = e.target.value.trim();
            sec.note = newLabel;
            await dbPut('annotations', sec);
            if (oldLabel !== newLabel) {
              initialSecLabel = newLabel;
              await recordAuditLog({
                clusterIds: liveClusterIds(sec),
                category: 'matrix_mapping',
                action: `Updated 2nd Order Summary Label (${getDisplayName(doc)})`,
                fromVal: oldLabel || '(None)',
                toVal: newLabel
              });
            }
          });

          // "Note on how this concept fits": 3-line preview, click to edit (full text), logged to the Audit Trail on blur
          const cmtView = card.querySelector('.sec-comment-view');
          const cmtInput = card.querySelector('.sec-comment-input');
          let initialCellComment = cellComment;
          const refreshCmtView = () => {
            const v = (sec.clusterComments && sec.clusterComments[cluster.id]) || '';
            cmtView.textContent = v || (cmtInput.placeholder || '');
            cmtView.classList.toggle('text-slate-700', Boolean(v));
            cmtView.classList.toggle('text-slate-400', !v);
            cmtView.title = v || 'Click to write a note';
          };
          cmtView.onclick = () => {
            cmtView.classList.add('hidden');
            cmtInput.classList.remove('hidden');
            cmtInput.focus();
          };
          // Commit = save + audit-log. Registered as a pending flush while dirty, so a tab switch / re-render
          // (flushAllPendingSaves) logs it even if the textarea never receives a blur event.
          const commitCellComment = async () => {
            pendingSaveCleanups.delete(commitCellComment);
            const newVal = cmtInput.value.trim();
            if (!sec.clusterComments) sec.clusterComments = {};
            sec.clusterComments[cluster.id] = newVal;
            if (newVal === initialCellComment) return;
            const oldVal = initialCellComment;
            initialCellComment = newVal;
            await dbPut('annotations', sec);
            await recordAuditLog({
              clusterIds: [cluster.id],
              category: 'third_order',
              action: `Updated note on how a concept fits "${cluster.thirdOrderTitle || 'Untitled Row'}" (${getDisplayName(doc)}, p.${sec.page})`,
              fromVal: oldVal || '(Empty)',
              toVal: newVal || '(Empty)'
            });
          };
          commitCellComment.isCommit = true;
          cmtInput.addEventListener('input', e => {
            if (!sec.clusterComments) sec.clusterComments = {};
            sec.clusterComments[cluster.id] = e.target.value.trim();
            pendingSaveCleanups.add(commitCellComment);
            debouncedSaveCellSec();
          });
          cmtInput.addEventListener('blur', async () => {
            cmtInput.classList.add('hidden');
            cmtView.classList.remove('hidden');
            refreshCmtView();
            await commitCellComment();
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

    };  // end buildRowBody

    const rowHeightKey = cluster.id + ':' + compactKey;
    const estHeight = matrixRowHeights[rowHeightKey] || avgRowHeight;
    let buildNow;
    if (anchorIdx >= 0) {
      buildNow = rowIdx >= anchorIdx - 1 && sinceAnchor <= viewH + 1200;
      if (rowIdx >= anchorIdx - 1) sinceAnchor += estHeight;
    } else {
      buildNow = estimatedBottom <= eagerLimit;
    }
    if (buildNow) {
      buildRowBody();
    } else {
      const ph = document.createElement('td');
      ph.colSpan = visibleDocCount() + 1;
      ph.innerHTML = `<div class="text-xs text-slate-300 italic p-3" style="height:${Math.round(estHeight)}px">${escapeHtml(cluster.thirdOrderTitle || 'Untitled row')} …</div>`;
      tr.appendChild(ph);
      lazyRows.set(tr, buildRowBody);
    }
    estimatedBottom += estHeight;
    // Remember the real height of built rows so placeholders (and scroll restore) are accurate next time
    if (!lazyRows.has(tr)) requestAnimationFrame(() => { if (tr.isConnected && tr.offsetHeight > 0) matrixRowHeights[rowHeightKey] = tr.offsetHeight; });
    tr._rowHeightKey = rowHeightKey;
    tbody.appendChild(tr);
  });

  t.appendChild(tbody);
  if (window.growTextareasNow) window.growTextareasNow(tbody);
  if (lazyRows.size > 0 && 'IntersectionObserver' in window) {
    matrixRowObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const row = entry.target;
        if (!entry.isIntersecting || !lazyRows.has(row)) return;
        const build = lazyRows.get(row);
        lazyRows.delete(row);
        matrixRowObserver.unobserve(row);
        const pRect = scrollParent ? scrollParent.getBoundingClientRect() : null;
        const rect0 = row.getBoundingClientRect();
        const startsAboveView = !!pRect && rect0.top < pRect.top;
        row.replaceChildren();
        build();
        if (window.growTextareasNow) window.growTextareasNow(row); // final height before we compensate the scroll position
        if (startsAboveView) scrollParent.scrollTop += row.getBoundingClientRect().height - rect0.height;
        requestAnimationFrame(() => { if (row.isConnected && row.offsetHeight > 0) matrixRowHeights[row._rowHeightKey] = row.offsetHeight; });
      });
    }, { root: scrollParent || null, rootMargin: '1200px 0px 1200px 0px' });
    lazyRows.forEach((_, row) => matrixRowObserver.observe(row));
  } else {
    lazyRows.forEach((build, row) => { row.replaceChildren(); build(); });
  }
  if (scrollParent) {
    scrollParent.style.overflowAnchor = 'none'; // we compensate ourselves (Safari has no scroll anchoring; avoid double correction elsewhere)
    const anchorRow = anchorId ? tbody.querySelector(`tr[data-cluster-id="${CSS.escape(anchorId)}"]`) : null;
    if (anchorRow) {
      const pos = anchorRow.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top + scrollParent.scrollTop;
      scrollParent.scrollTop = pos - anchorOffset;
    } else {
      scrollParent.scrollTop = prevTop;
    }
    scrollParent.scrollLeft = prevLeft;
  }
}

// --- C. 3rd Order Row Reordering (▲ / ▼) ---
async function persistClusterOrder() {
  for (let i = 0; i < state.clusters.length; i++) {
    state.clusters[i].order = i;
    await dbPut('clusters', state.clusters[i]);
  }
}

// Rows shown in the matrix (all, or only those with a ⚡ card while "Contradictions Only" is on)
function matrixVisibleClusters() {
  return state.matrixRefutationalOnly
    ? state.clusters.filter(c => state.annotations.some(a =>
        a.type === 'second_order' && normalizeAnnotation(a).clusterIds.includes(c.id) && isSecRefutational(a, c.id)))
    : state.clusters;
}

async function moveClusterOrder(clusterId, direction) {
  const fromIdx = state.clusters.findIndex(c => c.id === clusterId);
  // ▲ / ▼ move past the next row on view (rows hidden by a filter are skipped, as hidden study columns are)
  const visible = matrixVisibleClusters();
  const vIdx = visible.findIndex(c => c.id === clusterId);
  const neighbour = visible[vIdx + direction];
  if (fromIdx < 0 || vIdx < 0 || !neighbour) return;

  const movedCluster = state.clusters[fromIdx];
  const [moved] = state.clusters.splice(fromIdx, 1);
  const nIdx = state.clusters.findIndex(c => c.id === neighbour.id);
  const toIdx = direction < 0 ? nIdx : nIdx + 1;
  state.clusters.splice(toIdx, 0, moved);
  await persistClusterOrder();

  await recordAuditLog({
    clusterIds: [movedCluster.id],
    category: 'third_order',
    action: `Reordered 3rd Order Theme Row "${movedCluster.thirdOrderTitle || 'Untitled'}"`,
    fromVal: `Row #${fromIdx + 1}`,
    toVal: `Row #${toIdx + 1}`,
    detail: `Moved past "${neighbour.thirdOrderTitle || 'Untitled'}". New row order: ${state.clusters.map((c, i) => (i + 1) + '. ' + (c.thirdOrderTitle || 'Untitled')).join(' | ')}`
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
  lsSet('me_pool_collapsed', collapsed ? 'true' : 'false');
}

if (collapsePoolBtn && expandPoolBtn) {
  collapsePoolBtn.addEventListener('click', () => setMatrixPoolCollapsed(true));
  expandPoolBtn.addEventListener('click', () => setMatrixPoolCollapsed(false));
  if (lsGet('me_pool_collapsed') === 'true') {
    setMatrixPoolCollapsed(true);
  }
}

if (matrixPoolResizer && matrixLeftSidebar) {
  const savedPoolWidth = parseInt(lsGet('me_pool_width'), 10);
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
      if (!isNaN(currentW)) lsSet('me_pool_width', String(currentW));
    }
  });
}

// ========================================================
// REFUTATION MAP: the ⚡ cards gathered by study (nothing new to enter)
// ========================================================
// In a row, a study whose construct is marked Refutational contrasts with the reading the row holds: the reading of
// the study that established the row (◆) and of the studies translated into it as Reciprocal. Studies that are also
// Refutational in that row are listed separately: they may share a counter-reading.
function buildRefutationMap() {
  const live = state.clusters.filter(Boolean);
  const secs = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);
  const byStudy = new Map();   // refuting docId -> [{ cluster, refSecs, holders, alsoRefuting }]
  const pairs = new Map();     // 'refId|otherId' -> Set(clusterId)
  live.forEach(c => {
    const inRow = secs.filter(s => s.clusterIds.includes(c.id));
    const docIds = [...new Set(inRow.map(s => s.docId))];
    const refuting = docIds.filter(id => inRow.some(s => s.docId === id && isSecRefutational(s, c.id)));
    if (!refuting.length) return;
    const holders = docIds.filter(id => !refuting.includes(id) && inRow.some(s => s.docId === id && ['baseline', 'reciprocal'].includes(secRelation(s, c.id)))); // the row's base and the reciprocal studies
    refuting.forEach(rid => {
      if (!byStudy.has(rid)) byStudy.set(rid, []);
      byStudy.get(rid).push({
        cluster: c,
        refSecs: inRow.filter(s => s.docId === rid && isSecRefutational(s, c.id)),
        holders,
        alsoRefuting: refuting.filter(x => x !== rid)
      });
      holders.forEach(hid => {
        const k = rid + '|' + hid;
        if (!pairs.has(k)) pairs.set(k, new Set());
        pairs.get(k).add(c.id);
      });
    });
  });
  const docIdx = id => state.docs.findIndex(d => d.id === id);
  const studies = [...byStudy.entries()].sort((a, b) => docIdx(a[0]) - docIdx(b[0]));
  const pairList = [...pairs.entries()].map(([k, set]) => { const [r, h] = k.split('|'); return { r, h, clusterIds: [...set] }; })
    .sort((a, b) => (b.clusterIds.length - a.clusterIds.length) || (docIdx(a.r) - docIdx(b.r)) || (docIdx(a.h) - docIdx(b.h)));
  return { studies, pairList };
}

function renderRefutationMap() {
  const body = document.getElementById('refutMapBody');
  const { studies, pairList } = buildRefutationMap();
  const nameOf = id => { const d = state.docs.find(x => x.id === id); return d ? getDisplayName(d) + (state.docs[0] && state.docs[0].id === id ? ' [#1]' : '') : 'Study'; };
  const rowLink = c => `<button type="button" class="refut-row-link font-semibold text-indigo-700 hover:underline cursor-pointer" data-cid="${escapeHtml(c.id)}">${escapeHtml(clusterLabel(c))}</button>`;
  if (!studies.length) {
    body.innerHTML = `<p class="text-slate-500">No card is marked ⚡ Refutational yet. When you mark a study's card as Refutational in a row, it appears here, gathered by study.</p>
      <p class="text-slate-500">Finding no refutation is also a result worth reporting, together with how you looked for it.</p>`;
    return;
  }
  body.innerHTML = `
    <p class="text-slate-500">Built from the ⚡ cards in the matrix; nothing here is entered separately. A Refutational card contrasts with the reading the row holds: the reading of the study that established the row (◆) and of the studies translated into it as Reciprocal. Studies that are also ⚡ in the same row are listed apart, because they may share a counter-reading. Hidden papers are included.</p>
    <section class="space-y-1.5">
      <h3 class="text-xs font-bold text-slate-800">Studies in tension (pairs)</h3>
      <table class="w-full border-collapse text-xs">
        <thead><tr class="text-left text-slate-500"><th class="py-1 pr-2">⚡ Study</th><th class="py-1 pr-2">contrasts with</th><th class="py-1 pr-2">in rows</th></tr></thead>
        <tbody>${pairList.map(p => `<tr class="border-t border-slate-100 align-top">
          <td class="py-1 pr-2 font-semibold text-rose-800">${escapeHtml(nameOf(p.r))}</td>
          <td class="py-1 pr-2">${escapeHtml(nameOf(p.h))}</td>
          <td class="py-1 pr-2">${p.clusterIds.length} — ${p.clusterIds.map(id => rowLink(state.clusters.find(c => c.id === id))).join(', ')}</td></tr>`).join('')}</tbody>
      </table>
    </section>
    <section class="space-y-3">
      <h3 class="text-xs font-bold text-slate-800">By study</h3>
      ${studies.map(([rid, items]) => `
        <div class="rounded-lg border border-rose-200 bg-rose-50/40 p-3 space-y-2">
          <div class="font-bold text-rose-900">⚡ ${escapeHtml(nameOf(rid))} <span class="font-normal text-rose-700">— refutational in ${items.length} row${items.length === 1 ? '' : 's'}</span></div>
          ${items.map(it => `
            <div class="bg-white rounded border border-rose-100 p-2 space-y-1">
              <div>${rowLink(it.cluster)}</div>
              ${it.refSecs.map(s => `<div class="text-slate-700">• ${s.note ? `<b>${escapeHtml(s.note)}</b> — ` : ''}<i>"${escapeHtml(String(s.text || '').slice(0, 160))}${String(s.text || '').length > 160 ? '…' : ''}"</i> <span class="text-slate-400">(p.${escapeHtml(secPagesLabel(s))})</span>
                ${(s.clusterComments && s.clusterComments[it.cluster.id]) ? `<div class="text-rose-800 pl-3">Why it differs: ${escapeHtml(s.clusterComments[it.cluster.id])}</div>` : `<div class="text-blue-600 pl-3">Why it differs: not written yet (comment box under the card)</div>`}</div>`).join('')}
              <div class="text-slate-500">Contrasts with: ${it.holders.length ? it.holders.map(id => escapeHtml(nameOf(id))).join('; ') : '<i>no other study in this row</i>'}</div>
              ${it.alsoRefuting.length ? `<div class="text-rose-700">Also ⚡ in this row: ${it.alsoRefuting.map(id => escapeHtml(nameOf(id))).join('; ')}</div>` : ''}
            </div>`).join('')}
        </div>`).join('')}
    </section>`;
  body.querySelectorAll('.refut-row-link').forEach(btn => btn.onclick = () => {
    closeRefutationMap();
    const tr = document.querySelector(`#matrixTable tr[data-cluster-id="${CSS.escape(btn.dataset.cid)}"]`);
    if (tr) { tr.scrollIntoView({ block: 'start', behavior: 'smooth' }); tr.classList.add('drag-over'); setTimeout(() => tr.classList.remove('drag-over'), 1500); }
  });
}
function openRefutationMap() {
  flushAllPendingSaves();
  renderRefutationMap();
  const m = document.getElementById('refutMapModal');
  m.classList.remove('hidden'); m.classList.add('flex');
}
function closeRefutationMap() {
  const m = document.getElementById('refutMapModal');
  m.classList.add('hidden'); m.classList.remove('flex');
}
document.getElementById('refutMapBtn').addEventListener('click', openRefutationMap);
document.getElementById('refutMapCloseBtn').addEventListener('click', closeRefutationMap);

// ========================================================
// MERGE / SPLIT ROWS: interpretive decisions, logged with a reason, undoable; nothing written is lost
// ========================================================
let rowOpsCluster = null;
const rowOpsModal = document.getElementById('rowOpsModal');
function closeRowOps() { rowOpsModal.classList.add('hidden'); rowOpsModal.classList.remove('flex'); rowOpsCluster = null; }
document.getElementById('rowOpsCloseBtn').onclick = closeRowOps;
rowOpsModal.addEventListener('click', e => { if (e.target === rowOpsModal) closeRowOps(); });

function rowSecs(c) { return state.annotations.filter(a => a.type === 'second_order' && (a.clusterIds || []).includes(c.id)); }
function openRowOps(cluster) {
  flushAllPendingSaves();
  rowOpsCluster = cluster;
  document.getElementById('rowOpsTitle').textContent = `Merge or split: ${clusterLabel(cluster)}`;
  const others = state.clusters.filter(c => c.id !== cluster.id);
  const sel = document.getElementById('rowOpsMergeTarget');
  sel.innerHTML = others.length ? others.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(clusterLabel(c))}</option>`).join('') : '<option value="">(no other row)</option>';
  document.getElementById('rowOpsMergeBtn').disabled = !others.length;
  const secs = rowSecs(cluster);
  document.getElementById('rowOpsSplitList').innerHTML = secs.length
    ? secs.map(s => { const d = state.docs.find(x => x.id === s.docId); return `<label class="flex items-start gap-1.5 cursor-pointer"><input type="checkbox" class="row-split-pick mt-0.5" value="${escapeHtml(s.id)}"><span><b>${escapeHtml(d ? getDisplayName(d) : 'Study')}</b> — ${escapeHtml(s.note || String(s.text || '').slice(0, 90))}</span></label>`; }).join('')
    : '<div class="text-slate-400 italic">No cards in this row.</div>';
  document.getElementById('rowOpsSplitTitle').value = '';
  document.getElementById('rowOpsWhy').value = '';
  rowOpsModal.classList.remove('hidden'); rowOpsModal.classList.add('flex');
}
const deepCopy = o => JSON.parse(JSON.stringify(o));
// Text carried from another row is kept, marked with where it came from
const carryText = (into, from, title) => from && from.trim() ? (into && into.trim() ? into.trim() + '\n\n' : '') + `[From row "${title}"] ` + from.trim() : (into || '');

// Fields of a row that a merge changes; an undo puts back only those still as the merge left them
const MERGE_ROW_FIELDS = ['translationSummary', 'synthesisNote', 'reflexiveNote', 'concordanceNote', 'cerqualExplanation', 'cellStatus', 'baseDocId', 'historyFrom', 'baselineChange'];
const pickFields = (c, fields) => { const o = {}; fields.forEach(f => { o[f] = c[f] === undefined ? undefined : deepCopy(c[f]); }); return o; };
const PER_ROW_KEYS = ['clusterRelations', 'clusterComments', 'aspectUsedInLoa'];
const annRowState = (a, ids) => ({ id: a.id, member: ids.map(id => (a.clusterIds || []).includes(id)), keys: PER_ROW_KEYS.map(k => ids.map(id => (a[k] || {})[id])) });

async function mergeRows(src, tgt, why) {
  const srcTitle = clusterLabel(src), tgtTitle = clusterLabel(tgt);
  const secs = rowSecs(src);
  const ids = [src.id, tgt.id];
  const before = { src: deepCopy(src), tgt: pickFields(tgt, MERGE_ROW_FIELDS), anns: secs.map(a => annRowState(a, ids)), links: deepCopy(state.loa.links || []) };
  let moved = 0;
  const differing = [];
  for (const s of secs) {
    normalizeAnnotation(s);
    s.clusterRelations = s.clusterRelations || {}; s.clusterComments = s.clusterComments || {};
    if (!s.clusterIds.includes(tgt.id)) {
      s.clusterIds.push(tgt.id); moved++;
      if (s.clusterRelations[src.id]) s.clusterRelations[tgt.id] = s.clusterRelations[src.id];
      if (s.clusterComments[src.id]) s.clusterComments[tgt.id] = s.clusterComments[src.id];
      if (s.aspectUsedInLoa && s.aspectUsedInLoa[src.id]) s.aspectUsedInLoa = { ...s.aspectUsedInLoa, [tgt.id]: true };
    } else {
      // Already in both rows: the target row's judgement stays; a different reading in the source row is kept as a note
      const rs = secRelation(s, src.id), rt = secRelation(s, tgt.id);
      let carried = s.clusterComments[src.id] && s.clusterComments[src.id] !== s.clusterComments[tgt.id] ? s.clusterComments[src.id] : '';
      if (rs !== rt && rs !== 'unjudged' && rs !== 'baseline') {
        carried = `judged ${getCellRelationMeta(rs).label.replace(/^\S+\s/, '')} there` + (carried ? ` — ${carried}` : '');
        const d = state.docs.find(x => x.id === s.docId);
        differing.push(`${d ? getDisplayName(d) : 'Study'} (p.${s.page}): ${getCellRelationMeta(rs).label.replace(/^\S+\s/, '')} in "${srcTitle}", ${getCellRelationMeta(rt).label.replace(/^\S+\s/, '')} in "${tgtTitle}"`);
      }
      if (carried) s.clusterComments[tgt.id] = carryText(s.clusterComments[tgt.id], carried, srcTitle);
    }
    s.clusterIds = s.clusterIds.filter(id => id !== src.id);
    delete s.clusterRelations[src.id]; delete s.clusterComments[src.id];
    if (s.aspectUsedInLoa) { s.aspectUsedInLoa = { ...s.aspectUsedInLoa }; delete s.aspectUsedInLoa[src.id]; }
    await dbPut('annotations', s);
  }
  normalizeCluster(tgt);
  ['translationSummary', 'synthesisNote', 'reflexiveNote', 'concordanceNote', 'cerqualExplanation'].forEach(k => { tgt[k] = carryText(tgt[k], src[k], srcTitle); });
  // Empty-cell statuses: kept where the merged row still has nothing of that study
  tgt.cellStatus = { ...(tgt.cellStatus || {}) };
  Object.entries(src.cellStatus || {}).forEach(([docId, v]) => {
    const hasCard = rowSecs(tgt).some(a => a.docId === docId);
    if (!hasCard && !tgt.cellStatus[docId]) tgt.cellStatus[docId] = v;
  });
  Object.keys(tgt.cellStatus).forEach(docId => { if (rowSecs(tgt).some(a => a.docId === docId)) delete tgt.cellStatus[docId]; });
  if (!rowBaseDocId(tgt) && rowBaseDocId(src)) tgt.baseDocId = src.baseDocId;
  // A row still waiting to be re-read after study #1 changed passes that on
  if (src.baselineChange && !tgt.baselineChange) tgt.baselineChange = src.baselineChange;
  tgt.historyFrom = [...new Set([...(tgt.historyFrom || []), src.id, ...(src.historyFrom || [])])];
  await dbPut('clusters', tgt);
  // Concept-map relations follow the row; a relation of the two rows to each other, or a duplicate, is dropped
  // (for a symmetric relation, A–C and C–A are the same relation)
  if (Array.isArray(state.loa.links)) {
    const seen = new Set(); const out = [];
    state.loa.links.forEach(l => {
      const n = { ...l, from: l.from === src.id ? tgt.id : l.from, to: l.to === src.id ? tgt.id : l.to };
      const pair = isDirectedLink(n.type) ? n.from + '|' + n.to : [n.from, n.to].sort().join('|');
      const key = pair + '|' + n.type;
      if (n.from !== n.to && !seen.has(key)) { seen.add(key); out.push(n); }
    });
    state.loa = { ...state.loa, links: out }; await dbPut('meta', state.loa);
  }
  await dbDelete('clusters', src.id);
  state.clusters = state.clusters.filter(c => c.id !== src.id);
  pushUndoAction({ type: 'row_merge', label: `Merge "${srcTitle.slice(0, 24)}" into "${tgtTitle.slice(0, 24)}"`, srcId: src.id, tgtId: tgt.id, before,
    after: { tgt: pickFields(tgt, MERGE_ROW_FIELDS), anns: secs.map(a => annRowState(a, ids)), links: deepCopy(state.loa.links || []) } });
  await recordAuditLog({
    clusterIds: [tgt.id, src.id], category: 'third_order',
    action: `Merged row "${srcTitle}" into "${tgtTitle}"`,
    detail: `${moved} construct(s) moved with their judgements and notes; ${secs.length - moved} were already in "${tgtTitle}".`
      + (differing.length ? ` Read differently in the two rows (the judgement in "${tgtTitle}" was kept; the other is noted on the card):\n${differing.join('\n')}\n` : ' ')
      + `Step A / Step B and other texts of "${srcTitle}" were added to "${tgtTitle}", marked with their origin. The CERQual ratings of "${tgtTitle}" were kept: re-read them for the merged finding.`,
    fromVal: `${srcTitle} + ${tgtTitle}`, toVal: tgtTitle, rationale: why
  });
}

async function splitRow(src, secIds, title, why) {
  const srcTitle = clusterLabel(src);
  const secs = rowSecs(src).filter(s => secIds.includes(s.id));
  const nw = await createNewClusterRow(title, { silent: true });
  const ids = [src.id, nw.id];
  const beforeAnns = secs.map(a => annRowState(a, ids));
  const srcBase = rowBaseDocId(src);
  nw.baseDocId = secs.some(s => s.docId === srcBase) ? srcBase : secs[0].docId;
  // If every card of the study that established this row moves, the row keeps its base (an interpretive choice, not a sort
  // result) but the reviewer is told, so they can choose another study or "No single base" under ◆ Established by
  const baseGone = !!srcBase && !rowSecs(src).some(s => s.docId === srcBase && !secs.includes(s));
  const baseDoc = baseGone ? state.docs.find(d => d.id === srcBase) : null;
  nw.historyFrom = [src.id, ...(src.historyFrom || [])];
  for (const s of secs) {
    normalizeAnnotation(s);
    s.clusterRelations = s.clusterRelations || {}; s.clusterComments = s.clusterComments || {};
    s.clusterIds = s.clusterIds.filter(id => id !== src.id).concat(nw.id);
    if (s.clusterRelations[src.id]) s.clusterRelations[nw.id] = s.clusterRelations[src.id];
    if (s.clusterComments[src.id]) s.clusterComments[nw.id] = s.clusterComments[src.id];
    if (s.aspectUsedInLoa && s.aspectUsedInLoa[src.id]) { s.aspectUsedInLoa = { ...s.aspectUsedInLoa, [nw.id]: true }; delete s.aspectUsedInLoa[src.id]; }
    delete s.clusterRelations[src.id]; delete s.clusterComments[src.id];
    await dbPut('annotations', s);
  }
  await dbPut('clusters', nw);
  // The new row sits right below the one it was split from
  state.clusters = state.clusters.filter(c => c.id !== nw.id);
  state.clusters.splice(state.clusters.findIndex(c => c.id === src.id) + 1, 0, nw);
  await persistClusterOrder();
  pushUndoAction({ type: 'row_split', label: `Split ${secs.length} card(s) off "${srcTitle.slice(0, 24)}"`, srcId: src.id, newId: nw.id,
    before: { anns: beforeAnns }, after: { anns: secs.map(a => annRowState(a, ids)) } });
  await recordAuditLog({
    clusterIds: [src.id, nw.id], category: 'third_order',
    action: `Split ${secs.length} construct(s) off "${srcTitle}" into a new row "${clusterLabel(nw)}"`,
    detail: secs.map(s => { const d = state.docs.find(x => x.id === s.docId); return `${d ? getDisplayName(d) : 'Study'} (p.${s.page}): ${s.note || String(s.text || '').slice(0, 60)}`; }).join('\n'),
    fromVal: srcTitle, toVal: `${srcTitle} | ${clusterLabel(nw)}`, rationale: why
  });
  return { baseGone: baseDoc ? getDisplayName(baseDoc) : '' };
}

document.getElementById('rowOpsMergeBtn').onclick = async () => {
  const src = rowOpsCluster, tgt = state.clusters.find(c => c.id === document.getElementById('rowOpsMergeTarget').value);
  if (!src || !tgt) return;
  const why = document.getElementById('rowOpsWhy').value.trim();
  closeRowOps();
  await mergeRows(src, tgt, why);
  renderLoaClusterChips(); renderMatrixView();
  showSnackbar(`Merged into "${clusterLabel(tgt)}" — Ctrl+Z to undo`);
};
document.getElementById('rowOpsSplitBtn').onclick = async () => {
  const src = rowOpsCluster; if (!src) return;
  const ids = [...document.querySelectorAll('.row-split-pick:checked')].map(x => x.value);
  if (!ids.length) { showSnackbar('Tick the cards to split off.'); return; }
  const title = document.getElementById('rowOpsSplitTitle').value.trim();
  const why = document.getElementById('rowOpsWhy').value.trim();
  closeRowOps();
  const res = await splitRow(src, ids, title, why);
  renderLoaClusterChips(); renderMatrixView();
  showSnackbar(`Split ${ids.length} card(s) into a new row — Ctrl+Z to undo`
    + (res && res.baseGone ? `\n"${clusterLabel(src)}" was established by ${res.baseGone}, which now has no construct in it: choose its base again under ◆ Established by (another study, or No single base).` : ''));
};
