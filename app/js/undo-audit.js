// Meta-Ethnography Canvas — Undo & audit logging
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// Undo stack for deletions and recordAuditLog(), used by every feature that changes data.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// UNDO ENGINE (1-Step / Multi-Step Stack for Deletions)
// ========================================================
function updateUndoButtonUI() {
  const btn = document.getElementById('undoDeleteBtn');
  if (!btn) return;
  btn.disabled = state.undoStack.length === 0;
  if (state.undoStack.length > 0) {
    const last = state.undoStack[state.undoStack.length - 1];
    btn.title = `Undo: ${last.label} (Ctrl+Z / Cmd+Z)`;
  } else {
    btn.title = 'Undo last deletion (Ctrl+Z / Cmd+Z)';
  }
}

// PDF bytes kept for undoing a study deletion stay in memory: only the two latest deletions keep them. An older one is still
// undone (study, constructs, links), and its PDF is then reconnected like after a restore.
const UNDO_KEEP_PDF = 2;
function pushUndoAction(actionObj) {
  state.undoStack.push(actionObj);
  if (state.undoStack.length > 15) state.undoStack.shift();
  const withPdf = state.undoStack.filter(a => a.type === 'delete_study' && a.binary);
  withPdf.slice(0, Math.max(0, withPdf.length - UNDO_KEEP_PDF)).forEach(a => { a.binary = null; });
  updateUndoButtonUI();
}

// The undo stack belongs to one workspace: empty it whenever the workspace is replaced (reset, clean restore),
// so Ctrl+Z can never bring a deleted item of the previous project into the new one.
function clearUndoStack() {
  state.undoStack = [];
  updateUndoButtonUI();
}

// ---- A change: the generic Undo (revertChange / tidyRefsOps, logic.js) ----
// An undoable operation names the records it will touch BEFORE it changes them (beginChange: they are copied as they are),
// does its work, then calls finishChange (they are copied as it left them, with the records it made) and the change goes on
// the stack. Ctrl+Z puts back what the operation changed and is still as it left it; later work is kept (and named in the
// trail). undoLogs: the audit entries Ctrl+Z writes (recordAuditLog arguments; clusterIds narrowed to rows still here).
/** @param {string} label @param {{ store: string, id: any }[]} keys @param {{ undoLogs?: any[], before?: Record<string, any> }} [opts] */
function beginChange(label, keys, { undoLogs = [], before = {} } = {}) {
  const seen = new Set();
  const records = [];
  keys.forEach(({ store, id }) => {
    const k = store + '|' + id;
    if (id === undefined || id === null || seen.has(k)) return;
    seen.add(k);
    // before[k]: the record as it was, when the caller changed it in memory before (e.g. a map box dragged)
    records.push({ store, id, before: k in before ? deepCopy(before[k]) : (deepCopy(recordOf(state, store, id)) ?? null), after: null });
  });
  return { type: 'change', label, records, undoLogs };
}
/** @param {any} change @param {{ store: string, id: any }[]} [created] */
function finishChange(change, created = []) {
  const seen = new Set(change.records.map(r => r.store + '|' + r.id));
  created.forEach(({ store, id }) => { if (!seen.has(store + '|' + id)) { seen.add(store + '|' + id); change.records.push({ store, id, before: null, after: null }); } });
  change.records.forEach(r => { r.after = deepCopy(recordOf(state, r.store, r.id)) ?? null; });
  pushUndoAction(change);
}
// What was kept, in words for the trail
function describeKept(kept) {
  const what = { annotations: 'a construct / quote', clusters: 'a 3rd Order row', docs: 'a study', meta: 'the overall model', logs: 'a trail entry' };
  return [...new Set(kept.map(k => `${what[k.store] || k.store}${k.path ? ` (${k.path.split('.')[0]})` : ' (changed or deleted since)'}`))].join('; ');
}

// One undo at a time: a fast second Ctrl+Z waits for nothing and is ignored while the first is still writing
let undoBusy = false;
async function performUndo() {
  if (undoBusy || state.undoStack.length === 0) return;
  undoBusy = true;
  // Saves still waiting are written first, so none of them lands on top of what the undo puts back
  try { await flushAllPendingSaves(); await performUndoStep(); } finally { undoBusy = false; }
}
async function performUndoStep() {
  const last = state.undoStack.pop();
  updateUndoButtonUI();

  if (last.type === 'change') {
    const { ops, kept } = revertChange(last, state);
    const { ops: tidy, dropped } = tidyRefsOps(state, ops); // never back pointing at what was deleted since
    await commitOps(tidy);
    state.clusters.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0)); // a row back in its place
    const rows = new Set(state.clusters.map(c => c.id));
    const keptText = kept.length ? `Kept what was changed after it: ${describeKept(kept)}.` : '';
    const droppedText = dropped.length ? `Not brought back (deleted since): ${dropped.join('; ')}.` : '';
    for (const l of (last.undoLogs || [])) {
      const ids = (l.clusterIds || []).filter(id => rows.has(id));
      await recordAuditLog({ ...l, clusterIds: ids.length ? ids : null, detail: [l.detail, keptText, droppedText].filter(Boolean).join('\n') });
    }
    if (kept.length || dropped.length) showSnackbar(`Undone: ${last.label}` + (droppedText ? `\n${droppedText}` : '') + (keptText ? `\n${keptText}` : ''));
    refreshOpenViews({ loa: last.records.some(r => r.store === 'meta') });
  } else if (last.type === 'delete_study') {
    const d = last.doc;
    // The study, its PDF and its constructs come back in one transaction (as they went); a construct's placement in a row
    // that was deleted in the meantime is not brought back
    // (the same tidying as every other Undo: dropGoneLinks; a quote keeps its links to the study's constructs coming back with it)
    const ops = [];
    const restored = (last.annotations || []).map(raw => normalizeAnnotation(JSON.parse(JSON.stringify(raw))));
    restored.forEach(a => dropGoneLinks(a, restored));
    const isNew = !state.docs.find(x => x.id === d.id);
    if (isNew) {
      d.hasBinary = Boolean(last.binary && last.binary.byteLength > 0);
      if (d.hasBinary) ops.push({ store: 'pdf_binaries', put: { id: d.id, data: last.binary } });
      ops.push({ store: 'docs', put: d });
    }
    restored.forEach(a => ops.push({ store: 'annotations', put: a }));
    (last.cellStatus || []).forEach(({ id, v }) => { const c = state.clusters.find(x => x.id === id); if (c) { c.cellStatus = { ...(c.cellStatus || {}), [d.id]: v }; ops.push({ store: 'clusters', put: c }); } });
    (last.companions || []).forEach(id => { const o = state.docs.find(x => x.id === id); if (o && !o.companionOf) { o.companionOf = d.id; ops.push({ store: 'docs', put: o }); } });
    await commitOps(ops); // (the study is added at the end of state.docs: moved to where it was)
    if (isNew) {
      const at = state.docs.findIndex(x => x.id === d.id);
      if (at >= 0) state.docs.splice(at, 1);
      const pos = Math.max(0, Math.min(state.docs.length, last.position ?? state.docs.length));
      state.docs.splice(pos, 0, d);
    }
    await recordAuditLog({
      category: 'study_order',
      action: `Restored Study (Undo): ${getDisplayName(d)}`,
      detail: `${(last.annotations || []).length} construct(s)/quote(s) restored.`
    });
    if (isNew) await persistDocOrder(); // after the entry: a change of #1 it causes is logged after it
    renderStudyList();
    await switchStudy(d.id);
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'row_merge' || last.type === 'row_split') {
    // Put back only what the merge / split changed and is still as it left it; later edits are kept (and named in the log)
    const same = (x, y) => JSON.stringify(x === undefined ? null : x) === JSON.stringify(y === undefined ? null : y);
    const opId = last.type === 'row_merge' ? last.tgtId : last.newId; // the row the cards were moved into
    const ids = [last.srcId, opId];
    const kept = [];
    const ops = []; // written in one transaction at the end (as the merge / split was)
    const touched = []; // cards back in their rows: those rows lose an empty-cell note for the card's study (placementRowOps)
    const PER_ROW = ANNOTATION_ROW_FIELDS; // (each field is compared before / after on its own below)
    for (let i = 0; i < last.before.anns.length; i++) {
      const b = last.before.anns[i], af = last.after.anns[i];
      const a = state.annotations.find(x => x.id === b.id && x.type === 'second_order'); // not one switched to a quote since
      if (!a) continue;
      // membership in the two rows
      ids.forEach((rid, j) => {
        const nowIn = (a.clusterIds || []).includes(rid);
        if (nowIn === af.member[j] && nowIn !== b.member[j]) a.clusterIds = b.member[j] ? [...a.clusterIds, rid] : a.clusterIds.filter(x => x !== rid);
      });
      const what = k => k === 'clusterRelations' ? 'a judgement' : k === 'clusterComments' ? 'a cell note' : 'a line-of-argument mark';
      // (split: a judgement is a reading against the row's base; one made in the split-off row against another base does not
      // carry into the original row)
      const splitBasesDiffer = last.type === 'row_split' && (() => {
        const n = state.clusters.find(c => c.id === last.newId), o = state.clusters.find(c => c.id === last.srcId);
        return !!(n && o && rowBaseDocId(n) !== rowBaseDocId(o));
      })();
      PER_ROW.forEach((k, ki) => ids.forEach((rid, j) => {
        const cur = (a[k] || {})[rid];
        if (same(cur, af.keys[ki][j])) {
          if (b.keys[ki][j] === undefined) { if (a[k] && rid in a[k]) { a[k] = { ...a[k] }; delete a[k][rid]; } }
          else a[k] = { ...(a[k] || {}), [rid]: b.keys[ki][j] };
        } else if (last.type === 'row_split' && rid === last.newId) {
          // Changed in the split-off row after the split: that row goes. The newer reading moves to the original row, unless
          // the original row has a reading of its own made since (kept; a note is added to it), or the two rows have different
          // bases (a judgement against another base is not carried)
          a[k] = { ...(a[k] || {}) };
          const srcIsAsBefore = same(a[k][last.srcId], b.keys[ki][0]);
          if (k === 'clusterRelations' && splitBasesDiffer) {
            kept.push(`a judgement on p.${a.page} made in the split-off row against another base, not carried: judge it again in the original row`);
          } else if (srcIsAsBefore) {
            if (cur === undefined) delete a[k][last.srcId]; else a[k][last.srcId] = cur;
            kept.push(`${what(k)} on p.${a.page} made in the split-off row, now in the original row`);
          } else if (k === 'clusterComments' && cur) {
            a[k][last.srcId] = `${a[k][last.srcId] ? a[k][last.srcId] + '\n\n' : ''}[From the split-off row] ${cur}`;
            kept.push(`a cell note on p.${a.page} made in the split-off row, added to the one in the original row`);
          } else {
            kept.push(`${what(k)} on p.${a.page} made in the split-off row, not carried: the original row has its own`);
          }
          delete a[k][rid];
        } else if (!same(cur, b.keys[ki][j])) kept.push(`${what(k)} on p.${a.page}`);
      }));
      ops.push({ store: 'annotations', put: normalizeAnnotation(a) });
      touched.push(a);
    }
    if (last.type === 'row_merge') {
      const tgt = state.clusters.find(c => c.id === last.tgtId);
      if (tgt) {
        Object.keys(last.before.tgt).forEach(f => {
          if (same(tgt[f], last.after.tgt[f])) { if (last.before.tgt[f] === undefined) delete tgt[f]; else tgt[f] = last.before.tgt[f]; }
          else kept.push(`"${f}" of the merged row`);
        });
        ops.push({ store: 'clusters', put: tgt });
      }
      const src = normalizeCluster(last.before.src);
      ops.push({ store: 'clusters', put: src });
      if (!state.clusters.some(c => c.id === src.id)) state.clusters.push(src);
      state.clusters.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
      // Concept-map relations: back to before, plus any relation added since, minus any removed since; never one to a row
      // that is gone
      const nowLinks = state.loa.links || [];
      const nowIds = new Set(nowLinks.map(l => l.id));
      const afterIds = new Set((last.after.links || []).map(l => l.id));
      const added = nowLinks.filter(l => !afterIds.has(l.id));
      const removedSince = new Set([...afterIds].filter(id => !nowIds.has(id)));
      if (added.length) kept.push(`${added.length} concept-map relation(s) added since`);
      if (removedSince.size) kept.push(`${removedSince.size} concept-map relation(s) removed since`);
      const rowsNow = new Set(state.clusters.map(c => c.id));
      state.loa = { ...state.loa, links: [...last.before.links.filter(l => !removedSince.has(l.id)), ...added].filter(l => rowsNow.has(l.from) && rowsNow.has(l.to)) };
      ops.push({ store: 'meta', put: state.loa });
      // The restored row takes its old place; every row is numbered again, so rows moved since the merge never share a place
      ops.push(...placementRowOps(touched));
      state.clusters.forEach((c, i) => { c.order = i; ops.push({ store: 'clusters', put: c }); });
      await commitOps(ops);
    } else {
      // Only the row the split created goes; every other row (including rows added since) stays in its place. What was put
      // into that row after the split is not lost: cards go to the original row, its texts are added there marked with
      // their origin, and concept-map relations follow it.
      const nw = state.clusters.find(c => c.id === last.newId);
      const srcRow = state.clusters.find(c => c.id === last.srcId);
      if (nw && srcRow) {
        const nwTitle = clusterLabel(nw);
        for (const a of state.annotations.filter(x => x.type === 'second_order' && (x.clusterIds || []).includes(nw.id))) {
          const otherBase = rowBaseDocId(nw) !== rowBaseDocId(srcRow); // a judgement against the split-off row's base stays behind
          const had = takeOutOfRow(a, nw.id);
          if (otherBase) delete had.clusterRelations;
          putIntoRow(a, srcRow.id, { ...had, ...rowFieldsOf(a, srcRow.id) }); // what it has in the original row already is kept
          ops.push({ store: 'annotations', put: a });
          touched.push(a);
          kept.push(`a card placed in "${nwTitle}" after the split (p.${a.page}), now in the original row`);
        }
        const carry = (into, from) => from && from.trim() ? (into && into.trim() ? into.trim() + '\n\n' : '') + `[From row "${nwTitle}"] ` + from.trim() : (into || '');
        let carried = false;
        ['translationSummary', 'synthesisNote', 'reflexiveNote', 'concordanceNote', 'cerqualExplanation'].forEach(f => {
          if ((nw[f] || '').trim()) { srcRow[f] = carry(srcRow[f], nw[f]); carried = true; }
        });
        // Empty-cell notes made in the split-off row go to the original row where it has none for that study
        let cellsCarried = 0;
        Object.entries(nw.cellStatus || {}).forEach(([docId, v]) => {
          if (srcRow.cellStatus && srcRow.cellStatus[docId]) return;
          if (state.annotations.some(x => x.type === 'second_order' && x.docId === docId && (x.clusterIds || []).includes(srcRow.id))) return; // the study has a card there
          srcRow.cellStatus = { ...(srcRow.cellStatus || {}), [docId]: v }; cellsCarried++;
        });
        if (cellsCarried) kept.push(`${cellsCarried} empty-cell note(s) of "${nwTitle}", now in the original row`);
        if (carried || cellsCarried) ops.push({ store: 'clusters', put: srcRow });
        if (carried) kept.push(`the texts written in "${nwTitle}", added to the original row`);
        if ((state.loa.links || []).some(l => l.from === nw.id || l.to === nw.id)) {
          ops.push({ store: 'meta', put: { ...state.loa, links: moveRowLinks(state.loa.links, nw.id, srcRow.id) } }); // (as in mergeRows)
          kept.push(`concept-map relations of "${nwTitle}", moved to the original row`);
        }
      }
      // The new row goes and the order is renumbered in the same transaction
      ops.push(...placementRowOps(touched));
      state.clusters.filter(c => c.id !== last.newId).forEach((c, i) => { c.order = i; ops.push({ store: 'clusters', put: c }); });
      ops.push({ store: 'clusters', del: last.newId }); // (leaves state.clusters once all of it is stored)
      await commitOps(ops);
    }
    await recordAuditLog({ category: 'third_order', action: `Undid: ${last.label}`, clusterIds: ids,
      detail: kept.length ? `Kept what was changed after it: ${[...new Set(kept)].join('; ')}.` : '' });
    renderLoaClusterChips();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  }
}

// ========================================================
// AUDIT LOGGING ENGINE (With Reviewer Stamp & Minor Op Filter)
// ========================================================
// kind: what kind of entry this is (LOG_KINDS in logic.js): Appendix A goes by it, not by the action's wording.
// targetLabel: what it is about, as named at the time (a row's title, a field); targetId: the record it is about (e.g. the
// trail entry a deletion removed). All three are optional and stored only when given.
async function recordAuditLog({ category, action, detail = '', fromVal = '', toVal = '', rationale = '', reviewer = null, isMinorOp = false, clusterIds = null, kind = undefined, targetLabel = undefined, targetId = undefined }) {
  if (isMinorOp && !state.logMinorOps) return null;
  const entry = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    timestamp: Date.now(),
    isoTime: new Date().toISOString(),
    reviewer: reviewer || state.reviewerId || 'Reviewer',
    category,
    action,
    detail,
    fromVal,
    toVal,
    rationale
  };
  if (kind) entry.kind = kind;
  if (targetLabel) entry.targetLabel = targetLabel;
  if (targetId) entry.targetId = targetId;
  // Tag the entry with the 3rd Order row(s) it concerns, so a row's history survives title changes
  const cids = (Array.isArray(clusterIds) ? clusterIds : []).filter(Boolean);
  if (cids.length) entry.clusterIds = [...new Set(cids)];
  await dbPut('logs', entry);
  state.logs.unshift(entry);
  invalidateMatrixIndex('logs'); // the entry joined the in-memory trail after the write
  updateAuditBadge();
  if (entry.clusterIds && typeof refreshRowHistoryButtons === 'function') refreshRowHistoryButtons(entry.clusterIds);
  if (!divAudit.classList.contains('hidden')) renderAuditView();
  return entry;
}

// Extracted text is evidence from the primary study: every correction of it is logged with the old and new wording.
async function logExtractedTextEdit(anno, oldText) {
  const doc = state.docs.find(d => d.id === anno.docId);
  const isSec = anno.type === 'second_order';
  await recordAuditLog({
    kind: 'extract_edit',
    category: 'reading_extraction',
    action: isSec ? 'Edited the extracted text of a 2nd Order Construct' : 'Edited the extracted text of a 1st Order Quote',
    detail: `${getDisplayName(doc)} (p.${anno.page})${anno.note ? ': ' + anno.note : ''}`,
    fromVal: oldText || '',
    toVal: anno.text || '',
    clusterIds: isSec ? liveClusterIds(anno) : null
  });
}

function updateAuditBadge() {
  document.getElementById('auditCountBadge').textContent = String(state.logs.length);
}
