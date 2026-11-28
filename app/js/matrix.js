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
  // deferWrite: the caller writes the row in its own transaction (dbBatch) together with what else it changes
  if (opts.deferWrite) return cluster;
  await saveChange([{ store: 'clusters', put: cluster }], opts.silent ? [] : auditEntry({
    kind: 'row_create',
    clusterIds: [cluster.id],
    category: 'third_order',
    action: 'Created New 3rd Order Row',
    toVal: initialTitle || '(Untitled Concept Row)'
  }));
  return cluster;
}

// A construct placed in a row (opPlace, logic.js): it starts "not yet judged"; the first construct placed in a new row
// establishes it (◆; the reviewer can change this in the row header), and an earlier "not addressed / different aspect"
// note for this study no longer applies
async function assignSecondOrderToCluster(sec, cluster) {
  normalizeAnnotation(sec);
  normalizeCluster(cluster);
  await runOperation(opPlace(state, { secId: sec.id, rowId: cluster.id }, OP_NAMES));
}

// Deleting a 3rd Order row: nothing of it is left behind (judgements, cell notes and line-of-argument marks in it, its
// concept-map relations: purgeClusterRefs, logic.js); its constructs stay in the pool / other rows. Ctrl+Z puts all of it back.
async function deleteClusterRow(cluster) {
  await flushAllPendingSaves(); // a save of the row still waiting must not write it back after the deletion
  // (rowDeletionOps, logic.js: its references go too, and the rows are numbered by their place, so Undo puts it back exactly)
  const { ops, assignedSecIds, row } = rowDeletionOps(state, cluster.id);
  // Undo covers the row and what named it; the other rows' new numbers stay (they keep the rows in the order shown)
  const keys = ops.filter(o => !(o.store === 'clusters' && !('del' in o))).map(o => ({ store: o.store, id: 'del' in o ? o.del : o.put.id }));
  const change = beginChange(`3rd Order Row (${cluster.thirdOrderTitle || 'Untitled'})`, keys,
    { before: { ['clusters|' + cluster.id]: row }, undoLogs: [{ kind: 'row_restore', clusterIds: [cluster.id], category: 'third_order', action: 'Restored 3rd Order Row (Undo)', toVal: cluster.thirdOrderTitle || '(Untitled Row)',
      detail: `${assignedSecIds.length} construct(s) placed in it again.` }] });
  // Unplacing the cards, deleting the row and its entry in one transaction; the rows in memory change once it is stored
  await saveChange(ops, auditEntry({
    kind: 'row_delete',
    clusterIds: [cluster.id],
    category: 'third_order',
    action: 'Deleted 3rd Order Row',
    fromVal: cluster.thirdOrderTitle || '(Untitled Row)'
  }));
  finishChange(change);
  renderLoaClusterChips(); // the drawer's chips and map (if open) lose the row
  renderMatrixView();
  showUndoSnackbar(`Removed the row "${cluster.thirdOrderTitle || 'Untitled'}" (its constructs stay in the pool / other rows)`);
}

// A construct placed in several rows has a card in each: what is edited on one (its label, its text) is shown on the others
// built so far, so none of them shows, or writes back, the text as it was. A box being written in is left alone.
function syncSecCards(sec, fromCard) {
  document.querySelectorAll(`.matrix-cell-card[data-sec-card="${CSS.escape(sec.id)}"]`).forEach(c => {
    if (c === fromCard) return;
    const label = c.querySelector('.sec-label-input');
    if (label && document.activeElement !== label) { label.value = sec.note || ''; label.title = sec.text || ''; }
    const quote = c.querySelector('.cell-quote-display');
    if (quote) quote.textContent = `"${sec.text || ''}"`;
  });
}

// Taken out of the row (opUnplace, logic.js): its judgement, note and line-of-argument mark there go too; Ctrl+Z puts all of
// them back
async function removeSecondOrderFromCluster(sec, cluster) {
  normalizeAnnotation(sec);
  const label = `Unassign "${(sec.note || sec.text).slice(0, 28)}" from "${cluster.thirdOrderTitle || 'Untitled Row'}"`;
  await runOperation(project => opUnplace(project, { secId: sec.id, rowId: cluster.id }, OP_NAMES), { undo: { label, undoLogs: [{ kind: 'undo_placement',
    clusterIds: [cluster.id], category: 'matrix_mapping', action: `Undid: ${label}`, detail: 'The construct is back in the row with its judgement, note and line-of-argument mark.', isMinorOp: true }] } });
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

// A text being typed in the matrix is committed before its box is rebuilt (its audit entry arrives a moment later and updates
// the row's 🕘 History count by itself: refreshRowHistoryButtons, called by recordAuditLog)
function flushBeforeMatrixRebuild() {
  flushAllPendingSaves();
}
function historyBtnTitle(n) { return `Open this row's history in the Audit Trail (${n} entr${n === 1 ? 'y' : 'ies'})`; }
// The 🕘 History count of the rows an audit entry concerns (and of rows that absorbed them), in the rows already built: only the
// button changes, so nothing being typed in the matrix is disturbed
function refreshRowHistoryButtons(rowIds) {
  if (!rowIds || !rowIds.length || divMatrix.classList.contains('hidden')) return;
  const ids = new Set(rowIds);
  state.clusters.filter(c => ids.has(c.id) || (c.historyFrom || []).some(id => ids.has(id))).forEach(c => {
    const btn = document.querySelector(`#matrixTable tr[data-cluster-id="${CSS.escape(c.id)}"] .cl-history-btn`);
    if (!btn) return; // a row not built yet counts when it is built
    const n = rowHistoryCount(c);
    btn.textContent = `🕘 History (${n})`;
    btn.title = historyBtnTitle(n);
    btn.classList.toggle('hidden', !n);
  });
}
function renderMatrixView() {
  flushBeforeMatrixRebuild();
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
    // (a row's seed construct may have been deleted since: the row's base then tells which study it was started from, so
    // deleting one construct of study #1 does not make its rows look as if they came from an earlier study #1)
    const seededFromOther = state.clusters.some(c => {
      if (!c.autoSeeded || !c.seededFromId) return false;
      const seed = state.annotations.find(a => a.id === c.seededFromId);
      return (seed ? seed.docId : c.baseDocId) !== indexDoc.id;
    });
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
        if (how === 'leave') await commitOps(fresh.map(sec => ({ store: 'annotations', put: { ...sec, indexSeeded: true } })));
        return false;
      }
    }

    // Every new row, every construct placed in it and the entry: one transaction
    /** @type {DbOp[]} */
    const ops = [];
    const created = [];
    const createdIds = [];
    for (const sec of fresh) {
      // seeded or already placed: never auto-place this construct again (even if the row is later deleted)
      const next = { ...sec, indexSeeded: true };
      if (liveClusterIds(sec).length === 0) {
        const fallback = String(sec.text || '').replace(/^\[Concept derived[^\]]*\]:\s*/, '').replace(/^"+|"+$/g, '').trim();
        const title = ((sec.note || '').trim() || fallback).slice(0, 80);
        // (a new row established by study #1, so placing in it changes nothing else in it)
        const cluster = await createNewClusterRow(title, { deferWrite: true, baseDocId: indexDoc.id });
        Object.assign(cluster, { autoSeeded: true, seededFromId: sec.id, order: state.clusters.length + createdIds.length });
        ops.push({ store: 'clusters', put: cluster });
        putIntoRow(next, cluster.id);
        created.push(`${title} (p.${sec.page})`);
        createdIds.push(cluster.id);
      }
      ops.push({ store: 'annotations', put: next });
    }
    await saveChange(ops, created.length ? auditEntry({
      kind: 'auto_place',
      clusterIds: createdIds,
      category: 'matrix_mapping',
      action: `Auto-placed ${created.length} 2nd Order construct(s) of the #1 study (${getDisplayName(indexDoc)}; ${firstStudyMeta().long}) as initial 3rd Order rows`,
      detail: created.map(t => '• ' + t).join('\n'),
      rationale: 'The #1 study\'s concepts seed the translation; later studies are translated into these rows.'
    }) : []);
    if (created.length) showSnackbar(`Placed ${created.length} concept(s) from study #1 as provisional rows.`);
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
  await saveChange([{ store: 'meta', put: { ...state.loa, id: 'loa_main', seedChoice: choice, updatedAt: Date.now() } }], (prev !== choice || reason) ? auditEntry({
      kind: 'seed_choice',
      category: 'translation_process',
      action: choice === 'seed' ? 'Rows start from study #1: its 2nd Order constructs become provisional 3rd Order rows' : 'Rows are created by the reviewer: study #1 is not placed automatically',
      detail: reason || '',
      fromVal: prev === 'seed' ? 'Start from study #1' : prev === 'manual' ? 'Empty matrix' : '(not decided)',
      toVal: choice === 'seed' ? 'Start from study #1' : 'Empty matrix',
      rationale: why
    }) : []);
  autoSeedToggleEl.checked = choice === 'seed';
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
          ${linkedQuotes.map(q => `<li>"${escapeHtml(q.text)}" <span class="text-slate-400">(p.${escapeHtml(q.page)})</span></li>`).join('')}
        </ul>
      </details>
    ` : '';

    card.innerHTML = `
      <div class="flex items-center justify-between text-xs font-bold text-indigo-700 mb-1">
        <span class="truncate">${escapeHtml(docName)}</span>
        <div class="flex items-center space-x-1 shrink-0">
          <button type="button" class="rev-badge-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 px-1 py-px rounded font-mono cursor-pointer" title="Click to change reviewer">@${escapeHtml(sec.by || 'Unknown')}</button>
          <span class="text-[11px] px-1 py-px rounded border ${cBadge.cls} ${showConcUI ? '' : 'hidden'}">${cBadge.label}</span>
          <button type="button" class="jump-pdf-btn text-xs bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 px-2 py-0.5 rounded-md font-bold shadow-sm cursor-pointer flex items-center space-x-1 transition transform hover:-translate-y-0.5" title="Open study & jump to PDF page ${escapeHtml(sec.page)}"><i class="ph ph-file-pdf"></i><span>PDF p.${escapeHtml(sec.page)}</span><i class="ph ph-arrow-square-out"></i></button>
        </div>
      </div>
      ${sec.origin === 'wrapped_first_order' ? `<div class="text-[10px] font-semibold text-amber-800 mb-0.5">🏷 Reviewer-wrapped (1st-order quote)</div>` : ''}
      ${sec.note ? `<div class="font-bold text-slate-800 text-xs mb-1">${escapeHtml(sec.note)}${sec.noteSource === 'reviewer' && sec.origin !== 'wrapped_first_order' ? ' <span class="text-[10px] font-semibold text-amber-800">✎ reviewer wording</span>' : ''}</div>` : ''}
      <div class="text-[13px] text-slate-600 italic line-clamp-3 leading-snug">"${escapeHtml(sec.text)}"</div>
      ${sec.nuanceNote ? `<div class="mt-1 text-xs text-sky-800 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 truncate" title="${escapeHtml(sec.nuanceNote)}">🌐 ${escapeHtml(sec.nuanceNote)}</div>` : ''}
      ${poolQuotesPreviewHtml}
      ${(() => {
        // Imported in Compare before the other reviewer's row was here: shown, so the waiting placement is not a hidden state
        const waiting = Object.values(sec._peerRows || {}).map(w => w && w._title).filter(Boolean);
        return waiting.length ? `<div class="pool-waiting mt-1 text-[11px] text-teal-900 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200" title="Imported in Compare, where the other reviewer placed it in this row. It is placed here, with their judgement and cell note, when a row of that name is here: import the row in Compare, or name a row so.">⏳ Waits for the other reviewer's row: ${waiting.map(t => '“' + escapeHtml(t) + '”').join(', ')}</div>` : '';
      })()}
      ${count === 0 ? `<details class="pool-nt mt-1.5 rounded border border-slate-200 bg-slate-50 p-1.5" ${sec.notTranslatedNote ? 'open' : ''}>
        <summary class="text-[11px] font-semibold text-slate-600 cursor-pointer select-none">${sec.notTranslatedNote ? '✎ Why not translated (Appendix B)' : '+ Why not translated? (optional, reported in Appendix B)'}</summary>
        <textarea rows="2" class="pool-nt-input mt-1 w-full text-xs border border-slate-300 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-indigo-500 resize-y" placeholder="e.g., outside the review question; contradicts the rows but does not translate into any; too thin to interpret…">${escapeHtml(sec.notTranslatedNote)}</textarea>
      </details>` : ''}
      <div class="mt-1.5 flex items-center justify-between text-xs text-slate-400">
        <span>🟦 ${linkedQuotes.length} quote(s)</span>
        ${count > 0
          ? `<span class="text-emerald-700 bg-emerald-100 px-1.5 py-px rounded font-semibold">✓ Placed in ${count} row${count > 1 ? 's' : ''}</span>`
          : '<span class="text-indigo-600 font-medium">Drag to Matrix ➔</span>'}
      </div>
      ${(() => {
        // Placing without dragging (many rows, a trackpad, the keyboard): choose the row
        const rows = state.clusters.filter(c => !sec.clusterIds.includes(c.id));
        return rows.length ? `<select class="pool-place mt-1 w-full text-[11px] border border-slate-300 rounded px-1 py-0.5 bg-white text-slate-700" title="Place this construct in a row (it can be in several rows)" aria-label="Place in a 3rd Order row">
          <option value="">${count > 0 ? '+ Also place in row…' : 'Place in row…'}</option>
          ${rows.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(clusterLabel(c))}</option>`).join('')}
        </select>` : '';
      })()}
    `;
    card.querySelector('.jump-pdf-btn').onclick = (e) => {
      e.stopPropagation();
      jumpToPdfAnnotation(sec.id);
    };
    const placeSel = card.querySelector('.pool-place');
    if (placeSel) {
      placeSel.addEventListener('mousedown', e => e.stopPropagation());
      placeSel.onchange = async () => {
        const target = state.clusters.find(c => c.id === placeSel.value);
        if (!target) return;
        await assignSecondOrderToCluster(sec, target);
        renderLoaClusterChips();
        renderMatrixView();
        // Show where it went (rows are built lazily: scroll to the row, which builds it)
        const tr = document.querySelector(`#matrixTable tr[data-cluster-id="${CSS.escape(target.id)}"]`);
        if (tr) { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); tr.classList.add('drag-over'); setTimeout(() => tr.classList.remove('drag-over'), 1500); }
        showSnackbar(`Placed in "${clusterLabel(target)}" (not yet judged).`);
      };
    }
    card.querySelector('.rev-badge-btn').onclick = (e) => {
      e.stopPropagation();
      promptReassignItemReviewer(sec, 'annotations', renderMatrixView);
    };
    const ntInput = card.querySelector('.pool-nt-input');
    if (ntInput) {
      // The note box sits on a draggable card: keep text selection inside it from starting a drag
      // (dragging is off while the box is pressed or written in, so text can be selected; a click on its summary that only
      // opens or closes it gives dragging back on release)
      card.querySelector('.pool-nt').addEventListener('mousedown', () => {
        card.draggable = false;
        whenPointerReleased(() => { if (document.activeElement !== ntInput) card.draggable = true; });
      });
      ntInput.addEventListener('blur', () => { card.draggable = true; });
      ntInput.addEventListener('mouseup', () => { card.draggable = true; });
      bindPendingCommit(ntInput, () => runOperation(opNotTranslated(state, { secId: sec.id, note: ntInput.value.trim() }, OP_NAMES)));
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
          <button type="button" class="jump-pdf-btn truncate bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-0.5 rounded-md font-bold shadow-sm cursor-pointer flex items-center space-x-1 transition" title="Jump to PDF page ${escapeHtml(f.page)}"><i class="ph ph-file-pdf"></i><span class="truncate">${escapeHtml(docName)} (p.${escapeHtml(f.page)})</span><i class="ph ph-arrow-square-out"></i></button>
          <button type="button" class="wrap-btn px-1.5 py-px bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold cursor-pointer" title="Wrap into a 2nd Order Construct">+ Convert to 2nd Order</button>
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
          const target = state.annotations.find(x => x.id === e.target.value);
          if (target && await linkQuoteToConstruct(f, target)) renderMatrixView();
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
  const notePlaceholder = info && info.status === 'other_aspect' ? 'Which aspect? (feeds the line of argument)' : 'Why (optional)';
  const wrap = document.createElement('div');
  wrap.className = `empty-cell h-full min-h-[120px] rounded border border-dashed ${info ? (info.status === 'other_aspect' ? 'border-sky-300 bg-sky-50/40' : 'border-slate-300 bg-slate-50') : 'border-slate-200'} flex flex-col items-center justify-center gap-1.5 p-1.5 text-[13px] text-slate-400`;
  wrap.innerHTML = `
    ${info ? `<div class="text-lg leading-none ${info.status === 'other_aspect' ? 'text-sky-700' : 'text-slate-500'}" aria-hidden="true">${info.symbol}</div>` : '<div class="select-none text-slate-300">Drop 2nd Order here</div>'}
    <select data-action="empty-status" class="empty-status matrix-card-detail max-w-full text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600" title="Nothing of this study is in this row. Was it checked?">
      <option value="">Not yet checked</option>
      ${Object.entries(EMPTY_CELL_STATUS).map(([k, v]) => `<option value="${k}" ${info && info.status === k ? 'selected' : ''}>${v.symbol} ${escapeHtml(v.label)}</option>`).join('')}
    </select>
    ${info ? `<div class="matrix-card-detail w-full">
      <div class="empty-note-view text-xs border border-slate-200 rounded px-1.5 py-1 bg-white cursor-text whitespace-pre-wrap break-words text-left ${info.note ? 'text-slate-700' : 'text-slate-400'}" title="${escapeHtml(info.note || 'Click to write a note')}">${escapeHtml(info.note || notePlaceholder)}</div>
      <textarea rows="3" class="empty-note hidden w-full text-xs border border-indigo-400 rounded px-1.5 py-1 bg-white text-slate-700 focus:outline-none focus:border-indigo-500 resize-y" placeholder="${notePlaceholder}">${escapeHtml(info.note || '')}</textarea>
    </div>` : ''}`;
  wrap.dataset.docId = doc.id; // (the table's actions read the study from here: MATRIX_ACTIONS)
  wrap.querySelector('.empty-status').addEventListener('mousedown', e => e.stopPropagation());
  // The note reads and is written like the note on a placed card: a 3-line preview, click to edit the full text
  const note = wrap.querySelector('.empty-note');
  if (note) {
    const view = wrap.querySelector('.empty-note-view');
    view.addEventListener('click', () => { view.classList.add('hidden'); note.classList.remove('hidden'); note.focus(); });
    note.addEventListener('mousedown', e => e.stopPropagation());
    note.addEventListener('blur', () => {
      const v = note.value.trim();
      view.textContent = v || notePlaceholder;
      view.title = v || 'Click to write a note';
      view.classList.toggle('text-slate-700', Boolean(v));
      view.classList.toggle('text-slate-400', !v);
      note.classList.add('hidden'); view.classList.remove('hidden');
    });
    bindPendingCommit(note, () => runOperation(opEmptyCellNote(state, { rowId: cluster.id, docId: doc.id, note: note.value.trim() }, OP_NAMES)));
  }
  return wrap;
}

function renderMatrixTable() {
  // Every rebuild (toggles, visibility, row order…) commits what is being typed first: the boxes are about to be replaced
  flushBeforeMatrixRebuild();
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
          <button class="move-left px-1 py-px bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer" ${prevVisibleIdx(idx) < 0 ? 'disabled' : ''} title="Move column left (past hidden papers)">◀</button>
          <button class="move-right px-1 py-px bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer" ${nextVisibleIdx(idx) < 0 ? 'disabled' : ''} title="Move column right (past hidden papers)">▶</button>
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
        <!-- Always visible: the title, the row's status and its place in the order. Everything else about the row
             (reviewer, history, the study that established it, merge / split, delete) opens with ⋯, so the header stays
             light while reading and translating; nothing is hidden for good and no data changes. -->
        <input type="text" class="cluster-title w-full text-xs font-bold border border-slate-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-indigo-600" placeholder="3rd Order Construct / Theme Name..." value="${escapeHtml(cluster.thirdOrderTitle)}">
        <div class="flex items-center justify-between gap-1">
          <div class="flex items-center flex-wrap gap-1 min-w-0">
            <span class="cl-conc-pill text-[11px] px-1.5 py-px rounded border font-semibold ${cBadge.cls}">${cBadge.label}</span>
            <span class="cl-cerqual-pill text-[11px] px-1.5 py-px rounded border font-semibold ${cqBadge.cls}">${cqBadge.label}</span>
            ${cluster.baseDocId === '' ? '' : (() => { const b = rowBaseDocId(cluster); const d = b && state.docs.find(x => x.id === b); return d ? `<span class="cl-base-pill text-[11px] px-1.5 py-px rounded border border-slate-300 bg-white text-slate-700 truncate max-w-[10rem]" title="◆ Established by ${escapeHtml(getDisplayName(d))}: its cards in this row are what the other studies are translated into. Change it under ⋯.">◆ ${escapeHtml(getDisplayName(d))}</span>` : `<span class="cl-base-pill text-[11px] px-1.5 py-px rounded border border-slate-300 bg-white text-slate-500" title="No single base: every study's cards are judged. Change it under ⋯.">◆ none</span>`; })()}
            ${cluster.autoSeeded && !cluster.seedConfirmed ? `<button type="button" data-action="row-seed-confirm" class="cl-seed-confirm text-[11px] px-1.5 py-px rounded border border-amber-400 bg-amber-100 text-amber-900 font-semibold cursor-pointer" title="Auto-placed from study #1's 2nd order construct. The title is still the primary authors' wording, not yet your 3rd order interpretation. Click once you have reviewed / rewritten it.">🌱 Provisional · click to confirm</button>` : ''}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button type="button" data-action="row-up" class="move-cl-up px-1.5 py-px bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer text-[11px]" ${rowIdx === 0 ? 'disabled' : ''} title="Move row up">▲</button>
            <button type="button" data-action="row-down" class="move-cl-down px-1.5 py-px bg-white border border-slate-200 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer text-[11px]" ${rowIdx === visibleClusters.length - 1 ? 'disabled' : ''} title="Move row down">▼</button>
            <button type="button" class="cl-tools-toggle px-1.5 py-px rounded border ${state.rowToolsOpen.has(cluster.id) ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500'} hover:bg-slate-100 cursor-pointer text-[11px] font-bold" aria-expanded="${state.rowToolsOpen.has(cluster.id)}" title="Row tools: reviewer, history, the study that established the row (◆), merge / split, delete">⋯</button>
          </div>
        </div>

        <div class="cl-tools ${state.rowToolsOpen.has(cluster.id) ? '' : 'hidden'} space-y-1.5 rounded border border-slate-200 bg-slate-50 p-1.5">
          <div class="flex items-center justify-between gap-1">
            <div class="flex items-center flex-wrap gap-1">
              <button type="button" class="cl-rev-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 px-1.5 py-px rounded font-mono cursor-pointer" title="Click to change reviewer for this 3rd Order row">@${escapeHtml(cluster.by || 'Unknown')}</button>
              ${(() => { const n = rowHistoryCount(cluster); return `<button type="button" class="cl-history-btn ${n ? '' : 'hidden'} text-[11px] px-1.5 py-px rounded border border-purple-300 bg-purple-50 text-purple-800 font-semibold cursor-pointer hover:bg-purple-100" title="${historyBtnTitle(n)}">🕘 History (${n})</button>`; })()}
            </div>
            <div class="flex items-center gap-1">
              <button type="button" class="cl-rowops text-[11px] px-1.5 py-px rounded border border-slate-200 bg-white text-slate-600 hover:text-indigo-600 cursor-pointer" title="Merge this row into another, or split some of its cards into a new row"><i class="ph ph-git-merge"></i> Merge / split</button>
              <button data-action="row-delete" class="del-cluster text-[11px] px-1.5 py-px rounded border border-slate-200 bg-white text-slate-500 hover:text-rose-600 cursor-pointer" title="Delete Row"><i class="ph ph-trash"></i></button>
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
            <select data-action="row-base" class="cl-base-select text-[11px] border border-slate-300 rounded px-1 py-0.5 bg-white max-w-full">
              ${opts.map(d => `<option value="${escapeHtml(d.id)}" ${d.id === base ? 'selected' : ''}>${escapeHtml(getDisplayName(d))}${state.docs[0] && state.docs[0].id === d.id ? ' (#1)' : ''}${rowDocs.includes(d) ? '' : ' (no construct here)'}</option>`).join('')}
              ${cluster.baseDocId === '' ? `<option value="__unset" selected>Not set yet: the next construct placed sets it</option>` : ''}
              <option value="" ${base || cluster.baseDocId === '' ? '' : 'selected'}>No single base: judge every study</option>
            </select>
          </div>`;
        })()}
        </div>

        ${cluster.baselineChange ? (() => {
          const bc = cluster.baselineChange;
          const nowFirst = state.docs[0];
          const canRebase = nowFirst && nowFirst.id !== rowBaseDocId(cluster) && state.annotations.some(a => a.type === 'second_order' && a.docId === nowFirst.id && (a.clusterIds || []).includes(cluster.id));
          return `<div class="cl-baseline-warn rounded border border-amber-400 bg-amber-50 p-1.5 text-[11px] text-amber-900 leading-snug">
          <div class="font-bold">⚠ Study #1 changed after this row was built</div>
          <div>This row was established by ${escapeHtml(bc.fromName || 'the former #1')}, which is no longer study #1 (now <b>${escapeHtml(bc.toName)}</b>). The row keeps its base: the other studies were translated into ${escapeHtml(bc.fromName || 'that study')}'s construct. Re-read it: does the row and its title still hold in the new translation order?${canRebase ? ` If ${escapeHtml(getDisplayName(nowFirst))} should establish it instead, make it the base: ${escapeHtml(bc.fromName || 'the former #1')} is then translated into the row.` : ''}</div>
          <div class="flex flex-wrap gap-1 mt-1">
            ${canRebase ? `<button type="button" data-action="row-rebase" class="cl-baseline-rebase px-1.5 py-0.5 rounded border border-amber-400 bg-white font-semibold cursor-pointer hover:bg-amber-100">Make ${escapeHtml(getDisplayName(nowFirst))} the base</button>` : ''}
            <button type="button" data-action="row-reread" class="cl-baseline-ok px-1.5 py-0.5 rounded border border-amber-400 bg-white font-semibold cursor-pointer hover:bg-amber-100">Re-read · mark as reviewed</button>
          </div>
        </div>`;
        })() : ''}

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
                <select data-action="row-cerqual" class="${selCls} text-xs border border-slate-300 rounded px-1 py-0.5 bg-white">
                  ${cerqualOpts.map(o => `<option value="${o}" ${cluster[f] === o ? 'selected' : ''}>${o === 'Not assessed' ? o : o + ' concerns'}</option>`).join('')}
                </select>
              </div>
              <textarea class="${noteCls} mt-1 w-full text-[11.5px] border border-slate-200 rounded p-1 h-10 resize-y bg-white focus:outline-none focus:border-teal-600" placeholder="Why this rating? (what in the contributing studies led to it)">${escapeHtml(cluster[nf] || '')}</textarea>
            </div>`).join('')}
          </div>

          <div class="flex items-center justify-between gap-1.5 pt-0.5">
            <div class="flex-1">
              <label class="block text-[11px] font-bold text-teal-900">Overall Confidence</label>
              <select data-action="row-cerqual" class="cq-conf w-full text-xs font-bold border border-teal-400 rounded px-1.5 py-1 bg-white text-slate-800">
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
            <select data-action="row-team" class="cl-conc-status text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white font-semibold">
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

    // The row's texts: saved while typed and logged when left (bindTextField, one path for each box)
    const rowRecord = () => ({ store: 'clusters', put: cluster });
    // Only the row title appears in the line-of-argument drawer (chips, map labels): redraw it when the title changed
    let chipsTitle = cluster.thirdOrderTitle;
    bindTextField(tdMeta.querySelector('.cluster-title'), {
      get: () => cluster.thirdOrderTitle,
      set: v => { cluster.thirdOrderTitle = v.trim(); },
      onInput: () => { const strip = tdMeta.querySelector('.theme-strip-title'); if (strip) strip.textContent = cluster.thirdOrderTitle || 'Untitled row'; },
      record: rowRecord,
      save: async () => { await dbPut('clusters', cluster); if (cluster.thirdOrderTitle !== chipsTitle) { chipsTitle = cluster.thirdOrderTitle; renderLoaClusterChips(); } },
      log: (oldTitle, newTitle) => auditEntry({
        kind: 'row_title', targetLabel: newTitle || '(Untitled)',
        clusterIds: [cluster.id],
        category: 'third_order',
        action: LOG_ACTION.rowTitle,
        fromVal: oldTitle || '(Untitled)',
        toVal: newTitle || '(Untitled)'
      }),
      after: async () => {
        if (cluster.thirdOrderTitle !== chipsTitle) { chipsTitle = cluster.thirdOrderTitle; renderLoaClusterChips(); }
        if (await reattachWaitingForRow(cluster)) { renderSecondOrderPool(); renderMatrixTable(); } // the pool's "waits for the row" badges too
      }
    });

    const stepBWarn = tdMeta.querySelector('.cl-stepb-warn');
    const refreshStepBWarn = () => {
      if (stepBWarn) stepBWarn.classList.toggle('hidden', !((cluster.synthesisNote || '').trim() && !(cluster.translationSummary || '').trim()));
    };

    bindTextField(tdMeta.querySelector('.cluster-trans'), {
      get: () => cluster.translationSummary, set: v => { cluster.translationSummary = v; }, onInput: refreshStepBWarn, record: rowRecord,
      log: (oldVal, newVal) => auditEntry({
        kind: 'step_a', targetLabel: cluster.thirdOrderTitle || 'Untitled Row',
        clusterIds: [cluster.id],
        category: 'translation_process',
        action: `Updated Step A Translation Summary for "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
        fromVal: oldVal || '(Empty)',
        toVal: newVal || '(Empty)'
      })
    });

    bindTextField(tdMeta.querySelector('.cluster-note'), {
      get: () => cluster.synthesisNote, set: v => { cluster.synthesisNote = v; }, onInput: refreshStepBWarn, record: rowRecord,
      log: (oldNote, newNote) => auditEntry({
        kind: 'step_b', targetLabel: cluster.thirdOrderTitle || 'Untitled Row',
        clusterIds: [cluster.id],
        category: 'third_order',
        action: `Updated Step B 3rd Order Definition & Interpretation for "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
        fromVal: oldNote || '(Empty)',
        toVal: newNote
      })
    });

    bindTextField(tdMeta.querySelector('.cluster-reflex'), {
      get: () => cluster.reflexiveNote, set: v => { cluster.reflexiveNote = v; }, record: rowRecord,
      log: (oldVal, newVal) => auditEntry({
        kind: 'row_reflexive', targetLabel: cluster.thirdOrderTitle || 'Untitled Row',
        clusterIds: [cluster.id],
        category: 'reflexive_memo',
        action: `Reflexive note on "${cluster.thirdOrderTitle || 'Untitled Row'}"`,
        fromVal: oldVal || '(Empty)',
        toVal: newVal || '(Empty)'
      })
    });

    // (the row header's menus and buttons: MATRIX_ACTIONS; text boxes commit through the same actions)
    bindPendingCommit(tdMeta.querySelector('.cl-conc-note'), () => MATRIX_ACTIONS['row-team'](matrixActionContext(tdMeta)));

    // GRADE-CERQual: the notes and the explanation commit like the ratings (MATRIX_ACTIONS['row-cerqual'])
    ['.cq-exp', '.cq-lim-note', '.cq-coh-note', '.cq-adeq-note', '.cq-rel-note'].forEach(sel => {
      bindPendingCommit(tdMeta.querySelector(sel), () => MATRIX_ACTIONS['row-cerqual'](matrixActionContext(tdMeta)));
    });

    tdMeta.querySelector('.cl-tools-toggle').onclick = () => {
      const open = !state.rowToolsOpen.has(cluster.id);
      if (open) state.rowToolsOpen.add(cluster.id); else state.rowToolsOpen.delete(cluster.id);
      tdMeta.querySelector('.cl-tools').classList.toggle('hidden', !open);
      const t = tdMeta.querySelector('.cl-tools-toggle');
      t.setAttribute('aria-expanded', String(open));
      t.className = `cl-tools-toggle px-1.5 py-px rounded border ${open ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500'} hover:bg-slate-100 cursor-pointer text-[11px] font-bold`;
    };
    tdMeta.querySelector('.cl-rowops').onclick = () => openRowOps(cluster);

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

          const cellPlaceholder = cellNotePlaceholder(cellRelation);

          const card = document.createElement('div');
          card.className = `matrix-cell-card ${relMeta.cardCls} border rounded-lg p-2.5 shadow-sm text-xs cursor-grab transition`;
          card.dataset.secCard = sec.id; // (syncSecCards: the same construct's cards in other rows follow an edit made here)
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
                  ${firsts.map(f => `<li>"${escapeHtml(f.text)}" ${f.note ? `<span class="font-semibold text-blue-800 not-italic">[${escapeHtml(f.note)}]</span> ` : ''}<span class="text-slate-400">(p.${escapeHtml(f.page)})</span>${f.nuanceNote ? `<div class="text-[11px] text-sky-700 not-italic">🌐 ${escapeHtml(f.nuanceNote)}</div>` : ''}</li>`).join('')}
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
                  : `<select data-action="cell-judge" class="rel-select text-[11px] font-bold px-1 py-0.5 rounded border cursor-pointer ${relMeta.badgeCls}" title="How this study's construct relates to the row: not yet judged, Reciprocal (translates into it), Refutational (contrasts with it) or Different aspect (speaks to another aspect of the topic, for the line of argument)">
                  ${CELL_RELATIONS.map(r => `<option value="${r}" ${r === cellRelation ? 'selected' : ''}>${escapeHtml(getCellRelationMeta(r).label)}</option>`).join('')}
                </select>`}
                <button type="button" class="jump-pdf-btn text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 border border-indigo-700 px-2.5 py-0.5 rounded-md shadow-sm cursor-pointer transition flex items-center space-x-1 transform hover:-translate-y-0.5" title="Open PDF & jump to page ${escapeHtml(sec.page)} in ${escapeHtml(getDisplayName(doc))}"><i class="ph ph-file-pdf"></i><span>PDF p.${escapeHtml(sec.page)}</span><i class="ph ph-arrow-square-out"></i></button>
                <button type="button" class="rev-badge-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 px-1 py-px rounded font-mono cursor-pointer" title="Click to change reviewer">@${escapeHtml(sec.by || 'Unknown')}</button>
                <span class="text-[11px] px-1 py-px rounded border ${secBadge.cls} ${showConcUI ? '' : 'hidden'}">${secBadge.label}</span>
                ${firsts.length > 0 ? `<span class="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 px-1 py-px rounded font-semibold" title="${firsts.length} linked 1st Order Quote(s)">🟦 ${firsts.length}</span>` : ''}
                ${otherClustersCount > 0 ? `<span class="text-[11px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold" title="Also mapped to ${otherClustersCount} other row(s)">+${otherClustersCount} row</span>` : ''}
              </div>
              <div class="flex items-center space-x-1">
                <button type="button" class="matrix-card-detail edit-cell-quote-btn text-slate-400 hover:text-indigo-600 text-xs cursor-pointer" title="Edit quote text"><i class="ph ph-pencil-simple"></i></button>
                <button data-action="cell-unplace" class="unassign-btn text-slate-400 hover:text-rose-500 text-xs cursor-pointer" title="Remove from this row"><i class="ph ph-x-circle"></i></button>
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
            if (await saveExtractedText(sec, cleanAnnotationText(sec, cellQuoteTa.value))) {
              cellQuoteDisp.textContent = `"${sec.text}"`;
              syncSecCards(sec, card);
            }
            toggleCellQuoteEdit(false);
          };

          // (judging, and taking the card out of the row: MATRIX_ACTIONS)
          card.querySelector('.rel-select')?.addEventListener('mousedown', e => e.stopPropagation());

          card.querySelector('.rev-badge-btn').onclick = (e) => {
            e.stopPropagation();
            promptReassignItemReviewer(sec, 'annotations', renderMatrixView);
          };

          const secRecord = () => ({ store: 'annotations', put: sec });
          bindTextField(card.querySelector('.sec-label-input'), {
            get: () => sec.note, set: v => { sec.note = v; }, record: secRecord, onInput: () => syncSecCards(sec, card),
            log: (oldLabel, newLabel) => auditEntry({
              kind: 'construct_label',
              clusterIds: liveClusterIds(sec),
              category: 'matrix_mapping',
              action: `Updated 2nd Order Summary Label (${getDisplayName(doc)})`,
              fromVal: oldLabel || '(None)',
              toVal: newLabel
            })
          });

          // "Note on how this concept fits": 3-line preview, click to edit (full text), saved and logged like every text box
          const cmtView = card.querySelector('.sec-comment-view');
          const cmtInput = card.querySelector('.sec-comment-input');
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
          bindTextField(cmtInput, {
            get: () => (sec.clusterComments || {})[cluster.id],
            set: v => { sec.clusterComments = { ...(sec.clusterComments || {}), [cluster.id]: v.trim() }; },
            record: secRecord,
            log: (oldVal, newVal) => auditEntry({
              kind: 'cell_note',
              clusterIds: [cluster.id],
              category: 'third_order',
              action: `Updated note on how a concept fits "${cluster.thirdOrderTitle || 'Untitled Row'}" (${getDisplayName(doc)}, p.${sec.page})`,
              fromVal: oldVal || '(Empty)',
              toVal: newVal || '(Empty)'
            })
          });
          // Leaving the box shows the preview again (the commit above runs on the same blur). The window losing focus (a look at
          // the PDF elsewhere) is not leaving it: it stays open and uncommitted; a tab switch, re-render or page leave commits it.
          cmtInput.addEventListener('blur', () => {
            if (!document.hasFocus()) return;
            cmtInput.classList.add('hidden');
            cmtView.classList.remove('hidden');
            refreshCmtView();
          });

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
// ======================= What the matrix's buttons and menus do =======================
// The rows only draw: a button or menu carries data-action, and one listener on the table runs the action named here with
// what it belongs to (matrixActionContext). Each action runs an operation worked out in logic.js (runOperation: the change
// and its audit entry in one transaction), then shows the result. Text boxes commit through the same actions.
function matrixActionContext(el) {
  const tr = el.closest('tr[data-cluster-id]');
  const card = el.closest('.matrix-cell-card[data-sec-card]');
  const cell = el.closest('.empty-cell');
  return {
    el, tr,
    row: tr ? clusterById(tr.dataset.clusterId) : null,
    sec: card ? state.annotations.find(a => a.id === card.dataset.secCard) || null : null,
    card, cell, docId: cell ? cell.dataset.docId : null
  };
}
// The placeholder of a card's note, by how the card is judged
function cellNotePlaceholder(rel) {
  return rel === 'refutational' ? 'Explain how this study contrasts or disagrees in this row...'
    : rel === 'other_aspect' ? 'Which other aspect of the topic does this speak to, and how might it feed the line of argument?'
    : rel === 'unjudged' ? 'Read it against the row: does it translate into it (reciprocal) or contrast with it (refutational)?' : 'Note on how this concept fits into this theme...';
}
// A pill in the row header (team status, CERQual) shows its new value
function setRowPill(tr, cls, meta) {
  const pill = tr && tr.querySelector('.' + cls);
  if (!pill) return;
  pill.className = `${cls} text-[11px] px-1.5 py-px rounded border font-semibold ${meta.cls}`;
  pill.textContent = meta.label;
}
/** @type {Record<string, (ctx: any) => any>} */
const MATRIX_ACTIONS = {
  'row-up': ({ row }) => moveClusterOrder(row.id, -1),
  'row-down': ({ row }) => moveClusterOrder(row.id, 1),
  'row-delete': ({ row }) => deleteClusterRow(row),
  'row-team': async ({ row, tr }) => {
    const status = tr.querySelector('.cl-conc-status').value;
    if (await runOperation(opRowTeamStatus(state, { rowId: row.id, status, note: tr.querySelector('.cl-conc-note').value.trim() }))) {
      setRowPill(tr, 'cl-conc-pill', getConcordanceBadgeMeta(status));
    }
  },
  'row-seed-confirm': async ({ row, el }) => { if (await runOperation(opConfirmSeed(state, { rowId: row.id }))) el.remove(); },
  'row-base': async ({ row, el }) => {
    if (el.value === '__unset') return;
    if (await runOperation(opSetRowBase(state, { rowId: row.id, docId: el.value || null }, OP_NAMES))) renderMatrixView();
  },
  'row-rebase': async ({ row }) => {
    if (await runOperation(opSetRowBase(state, { rowId: row.id, docId: state.docs[0].id, extraDetail: 'Chosen after study #1 changed.' }, OP_NAMES))) renderMatrixView();
  },
  'row-reread': async ({ row }) => {
    const bc = row.baselineChange;
    if (!bc) return;
    const why = await askReason({
      title: `Re-read: ${row.thirdOrderTitle || 'Untitled Row'}`,
      context: `Study #1 changed from ${bc.fromName || 'another study'} to ${bc.toName}.`,
      label: 'What did you check or change in this row? (optional, saved in the Audit Trail)',
      confirmLabel: 'Mark as re-read', draftKey: 'reread-' + row.id
    });
    if (why === null) return;
    if (await runOperation(opRereadRow(state, { rowId: row.id, why }))) renderMatrixTable();
  },
  'row-cerqual': async ({ row, tr }) => {
    const box = { cerqualLimitations: '.cq-lim', cerqualCoherence: '.cq-coh', cerqualAdequacy: '.cq-adeq', cerqualRelevance: '.cq-rel', cerqualConfidence: '.cq-conf',
      cerqualExplanation: '.cq-exp', cerqualLimNote: '.cq-lim-note', cerqualCohNote: '.cq-coh-note', cerqualAdeqNote: '.cq-adeq-note', cerqualRelNote: '.cq-rel-note' };
    const values = Object.fromEntries(Object.entries(box).map(([k, sel]) => [k, tr.querySelector(sel).value]));
    const warn = tr.querySelector('.cq-exp-warn');
    if (warn) warn.classList.toggle('hidden', !(values.cerqualConfidence !== 'Not assessed' && !values.cerqualExplanation.trim()));
    if (await runOperation(opRowCerqual(state, { rowId: row.id, values }))) setRowPill(tr, 'cl-cerqual-pill', getCerqualBadgeMeta(row.cerqualConfidence));
  },
  'cell-judge': async ({ row, sec, card, el }) => {
    const prevRel = secRelation(sec, row.id), rel = el.value;
    if (!(await runOperation(opJudge(state, { secId: sec.id, rowId: row.id, rel }, OP_NAMES)))) return;
    if (state.isLoaOpen && (rel === 'other_aspect' || prevRel === 'other_aspect')) renderLoaAspects();
    const meta = getCellRelationMeta(rel);
    card.className = `matrix-cell-card ${meta.cardCls} border rounded-lg p-2.5 shadow-sm text-xs cursor-grab transition`;
    el.className = `rel-select text-[11px] font-bold px-1 py-0.5 rounded border cursor-pointer ${meta.badgeCls}`;
    const cmtInput = card.querySelector('.sec-comment-input');
    if (cmtInput) {
      cmtInput.placeholder = cellNotePlaceholder(rel);
      const cmtView = card.querySelector('.sec-comment-view');
      if (cmtView && !cmtInput.value.trim()) cmtView.textContent = cellNotePlaceholder(rel);
    }
  },
  'cell-unplace': async ({ row, sec }) => { await removeSecondOrderFromCluster(sec, row); renderMatrixView(); },
  'empty-status': async ({ row, el, cell, docId }) => {
    if (!(await runOperation(opEmptyCellStatus(state, { rowId: row.id, docId, status: el.value }, OP_NAMES)))) return;
    if (state.isLoaOpen) renderLoaAspects(); // the drawer lists the ◇ cells
    const doc = state.docs.find(d => d.id === docId);
    if (doc) cell.replaceWith(buildEmptyCell(row, doc));
  }
};
(() => {
  const table = document.getElementById('matrixTable');
  // Buttons on click, menus on change; the rest of the row (drag and drop, text boxes) is not touched here
  const run = (ev, wantChange) => {
    const el = ev.target && ev.target.closest && ev.target.closest('[data-action]');
    if (!el || !table.contains(el) || (el.tagName === 'SELECT') !== wantChange) return;
    const ctx = matrixActionContext(el);
    const action = MATRIX_ACTIONS[el.dataset.action];
    if (!action || !ctx.row) return;
    ev.stopPropagation();
    return Promise.resolve(action(ctx));
  };
  table.addEventListener('click', ev => run(ev, false));
  table.addEventListener('change', ev => run(ev, true));
})();

// Rows shown in the matrix (all, or only those with a ⚡ card while "Contradictions Only" is on)
function matrixVisibleClusters() {
  return state.matrixRefutationalOnly
    ? state.clusters.filter(c => state.annotations.some(a =>
        a.type === 'second_order' && normalizeAnnotation(a).clusterIds.includes(c.id) && isSecRefutational(a, c.id)))
    : state.clusters;
}

// ▲ / ▼ move past the next row on view (rows hidden by a filter are skipped, as hidden study columns are): opMoveRow
async function moveClusterOrder(clusterId, direction) {
  const moved = await runOperation(opMoveRow(state, { rowId: clusterId, direction, visibleIds: matrixVisibleClusters().map(c => c.id) }));
  if (!moved) return;
  sortRows(state.clusters);
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
// Names for the notes and log entries of a merge / split (planMergeRows / planSplitRow, logic.js)
const ROW_PLAN_HELPERS = {
  docName: id => { const d = state.docs.find(x => x.id === id); return d ? getDisplayName(d) : null; },
  relLabel: r => getCellRelationMeta(r).label.replace(/^\S+\s/, ''),
  rowTitle: c => clusterLabel(c)
};

async function mergeRows(src, tgt, why) {
  const plan = planMergeRows(state, src.id, tgt.id, ROW_PLAN_HELPERS);
  if (!plan) return null;
  const { srcTitle, tgtTitle, differing, rejudge } = plan;
  // Every write of the merge and its entry in one transaction; the source row leaves memory once it is stored
  await saveChange(plan.ops, auditEntry({
    kind: 'row_merge', clusterIds: [tgt.id, src.id], category: 'third_order',
    action: `Merged row "${srcTitle}" into "${tgtTitle}"`,
    detail: `${plan.moved} construct(s) moved with their judgements and notes; ${plan.alreadyThere} were already in "${tgtTitle}".`
      + (differing.length ? ` Read differently in the two rows (the judgement in "${tgtTitle}" was kept; the other is noted on the card):\n${differing.join('\n')}\n` : ' ')
      + (rejudge.length ? ` "${srcTitle}" was established by ${plan.srcBaseName} and "${tgtTitle}" by ${plan.tgtBaseName}, so ${rejudge.length} moved construct(s) start unjudged (their earlier judgement is noted on the card):\n${rejudge.join('\n')}\n` : '')
      + `Step A / Step B and other texts of "${srcTitle}" were added to "${tgtTitle}", marked with their origin. The CERQual ratings of "${tgtTitle}" were kept: re-read them for the merged finding.`,
    fromVal: `${srcTitle} + ${tgtTitle}`, toVal: tgtTitle, rationale: why
  }));
  pushUndoAction({ type: 'row_merge', label: `Merge "${srcTitle.slice(0, 24)}" into "${tgtTitle.slice(0, 24)}"`, srcId: src.id, tgtId: tgt.id, before: plan.before, after: plan.after });
  return { rejudge: rejudge.length, baseName: plan.tgtBaseName };
}

async function splitRow(src, secIds, title, why) {
  const plan = planSplitRow(state, src.id, secIds, await createNewClusterRow(title, { silent: true, deferWrite: true }), ROW_PLAN_HELPERS);
  if (!plan) return null;
  const nw = plan.newRow;
  const secs = plan.after.anns.map(x => state.annotations.find(a => a.id === x.id)).filter(Boolean); // the cards moved
  // The new row, the moved cards, the order of every row and the entry in one transaction; the rows in memory change once stored
  await saveChange(plan.ops, auditEntry({
    kind: 'row_split', clusterIds: [src.id, nw.id], category: 'third_order',
    action: `Split ${secs.length} construct(s) off "${plan.srcTitle}" into a new row "${clusterLabel(nw)}"`,
    detail: secs.map(s => { const d = state.docs.find(x => x.id === s.docId); return `${d ? getDisplayName(d) : 'Study'} (p.${s.page}): ${s.note || String(s.text || '').slice(0, 60)}`; }).join('\n')
      + (plan.rejudge.length ? `\n"${plan.srcTitle}" was established by ${plan.srcBaseName} and the new row by ${plan.newBaseName}, so ${plan.rejudge.length} moved construct(s) start unjudged (their earlier judgement is noted on the card):\n${plan.rejudge.join('\n')}` : ''),
    fromVal: plan.srcTitle, toVal: `${plan.srcTitle} | ${clusterLabel(nw)}`, rationale: why
  }));
  sortRows(state.clusters); // the new row right below its source
  pushUndoAction({ type: 'row_split', label: `Split ${secs.length} card(s) off "${plan.srcTitle.slice(0, 24)}"`, srcId: src.id, newId: nw.id,
    before: plan.before, after: plan.after });
  return { baseGone: plan.baseGone, rejudge: plan.rejudge.length, baseName: plan.newBaseName };
}

document.getElementById('rowOpsMergeBtn').onclick = async () => {
  const src = rowOpsCluster, tgt = state.clusters.find(c => c.id === document.getElementById('rowOpsMergeTarget').value);
  if (!src || !tgt) return;
  const why = document.getElementById('rowOpsWhy').value.trim();
  closeRowOps();
  const res = await mergeRows(src, tgt, why);
  renderLoaClusterChips(); renderMatrixView();
  showSnackbar(`Merged into "${clusterLabel(tgt)}" — Ctrl+Z to undo`
    + (res && res.rejudge ? `\nThe rows were established by different studies: ${res.rejudge} moved card(s) start unjudged against ${res.baseName} (the earlier judgement is in the card's note).` : ''));
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
    + (res && res.rejudge ? `\nThe new row is established by ${res.baseName}: ${res.rejudge} moved card(s) start unjudged against it (the earlier judgement is in the card's note).` : '')
    + (res && res.baseGone ? `\n"${clusterLabel(src)}" was established by ${res.baseGone}, which now has no construct in it: choose its base again under ◆ Established by (another study, or No single base).` : ''));
};
