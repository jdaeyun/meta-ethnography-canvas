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

  if (last.type === 'delete_annotation') {
    // The construct, its quotes' links and its within-study relationships come back in one transaction (as they went);
    // a placement in a row that was deleted in the meantime is not brought back
    const ops = [];
    const backSecIds = last.annotations.filter(a => a.type === 'second_order').map(a => a.id);
    const back = last.annotations.map(raw => dropGoneLinks(normalizeAnnotation(JSON.parse(JSON.stringify(raw))), backSecIds));
    back.forEach(a => ops.push({ store: 'annotations', put: a }));
    if (last.unlinkedChildrenIds && last.parentId) {
      for (const cid of last.unlinkedChildrenIds) {
        const child = state.annotations.find(x => x.id === cid);
        if (child && child.type === 'first_order') { linkQuote(child, last.parentId); ops.push({ store: 'annotations', put: child }); } // not one switched to a construct since
      }
    }
    restoreConceptLinksOps(last, ops);
    ops.push(...placementRowOps(back)); // a card back in a row: no "not addressed / different aspect" note for its study there
    await dbBatch(ops);
    back.forEach(a => {
      const idx = state.annotations.findIndex(x => x.id === a.id);
      if (idx >= 0) state.annotations[idx] = a; else state.annotations.push(a);
    });
    // The deletion was logged, so is its undoing; a construct placed in rows concerns those rows (a key decision, as its
    // deletion was)
    for (const a of last.annotations) {
      const isSec = a.type === 'second_order';
      const rows = isSec ? (a.clusterIds || []).filter(id => state.clusters.some(c => c.id === id)) : [];
      const doc = state.docs.find(d => d.id === a.docId);
      await recordAuditLog({
        category: 'reading_extraction',
        action: `Restored a deleted ${isSec ? '2nd Order construct' : '1st Order quote'} (Undo): ${doc ? getDisplayName(doc) : 'Study'}, p.${a.page}`,
        detail: `${a.note ? a.note + ': ' : ''}"${String(a.text || '').slice(0, 80)}..."`,
        clusterIds: rows.length ? rows : null
      });
    }
    renderHighlights();
    updateSidebar();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'annotation_snapshots') {
    // Generic restore: put every snapshotted annotation back, delete the ones the operation created (one transaction);
    // never a placement in a row that was deleted in the meantime
    // (a quote's construct may be one of the snapshots: e.g. a construct absorbed as a passage comes back with its quotes)
    const snapSecIds = last.snapshots.filter(a => a.type === 'second_order').map(a => a.id);
    const copies = last.snapshots.map(snap => dropGoneLinks(normalizeAnnotation(JSON.parse(JSON.stringify(snap))), snapSecIds));
    const snapIds = new Set(last.snapshots.map(x => x.id));
    const gone = (last.createdIds || []).filter(id => !snapIds.has(id));
    await dbBatch([...copies.map(c => ({ store: 'annotations', put: c })), ...gone.map(id => ({ store: 'annotations', del: id })), ...placementRowOps(copies)]);
    copies.forEach(copy => {
      const idx = state.annotations.findIndex(a => a.id === copy.id);
      if (idx >= 0) state.annotations[idx] = copy; else state.annotations.push(copy);
    });
    if (gone.length) state.annotations = state.annotations.filter(a => !gone.includes(a.id));
    // Passages and constructs placed in rows: the undoing belongs to those rows' history
    const rowIds = [...new Set((last.snapshots || []).flatMap(a => (a.type === 'second_order' && a.clusterIds) || []))].filter(id => state.clusters.some(c => c.id === id));
    await recordAuditLog({ category: 'reading_extraction', action: `Undid: ${last.label}`, detail: '', clusterIds: rowIds.length ? rowIds : null });
    renderHighlights();
    updateSidebar();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'delete_cluster') {
    // The row, its cards' placements and its concept-map relations come back in one transaction (as they went)
    const ops = [{ store: 'clusters', put: last.cluster }];
    for (const secId of (last.assignedSecIds || [])) {
      const sec = state.annotations.find(a => a.id === secId && a.type === 'second_order'); // not one switched to a quote since
      if (sec) {
        normalizeAnnotation(sec);
        if (!sec.clusterIds.includes(last.cluster.id)) sec.clusterIds.push(last.cluster.id);
        Object.entries((last.perRow || {})[secId] || {}).forEach(([k, v]) => { sec[k] = { ...(sec[k] || {}), [last.cluster.id]: v }; });
        ops.push({ store: 'annotations', put: sec });
      }
    }
    if ((last.removedLinks || []).length) {
      const have = new Set((state.loa.links || []).map(l => l.id));
      const rows = new Set([...state.clusters.map(c => c.id), last.cluster.id]); // never a relation to a row that is gone
      state.loa = { ...state.loa, links: [...(state.loa.links || []), ...last.removedLinks.filter(l => !have.has(l.id) && rows.has(l.from) && rows.has(l.to))] };
      ops.push({ store: 'meta', put: state.loa });
    }
    await dbBatch(ops);
    if (!state.clusters.find(c => c.id === last.cluster.id)) {
      state.clusters.push(last.cluster);
      state.clusters.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
    }
    // The deletion is in the trail, so its undoing is too (else Appendix A says "deleted" while Table 2 shows the row)
    await recordAuditLog({
      clusterIds: [last.cluster.id],
      category: 'third_order',
      action: 'Restored 3rd Order Row (Undo)',
      toVal: last.cluster.thirdOrderTitle || '(Untitled Row)',
      detail: `${(last.assignedSecIds || []).length} construct(s) placed in it again.`
    });
    renderLoaClusterChips();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'delete_study') {
    const d = last.doc;
    // The study, its PDF and its constructs come back in one transaction (as they went); a construct's placement in a row
    // that was deleted in the meantime is not brought back
    // (the same tidying as every other Undo: dropGoneLinks; a quote keeps its links to the study's constructs coming back with it)
    const ops = [];
    const backSecIds = (last.annotations || []).filter(a => a.type === 'second_order').map(a => a.id);
    const restored = (last.annotations || []).map(raw => dropGoneLinks(normalizeAnnotation(JSON.parse(JSON.stringify(raw))), backSecIds));
    const isNew = !state.docs.find(x => x.id === d.id);
    if (isNew) {
      d.hasBinary = Boolean(last.binary && last.binary.byteLength > 0);
      if (d.hasBinary) ops.push({ store: 'pdf_binaries', put: { id: d.id, data: last.binary } });
      ops.push({ store: 'docs', put: d });
    }
    restored.forEach(a => ops.push({ store: 'annotations', put: a }));
    (last.cellStatus || []).forEach(({ id, v }) => { const c = state.clusters.find(x => x.id === id); if (c) { c.cellStatus = { ...(c.cellStatus || {}), [d.id]: v }; ops.push({ store: 'clusters', put: c }); } });
    (last.companions || []).forEach(id => { const o = state.docs.find(x => x.id === id); if (o && !o.companionOf) { o.companionOf = d.id; ops.push({ store: 'docs', put: o }); } });
    await dbBatch(ops);
    if (isNew) {
      const pos = Math.max(0, Math.min(state.docs.length, last.position ?? state.docs.length));
      state.docs.splice(pos, 0, d);
    }
    restored.forEach(a => { if (!state.annotations.find(x => x.id === a.id)) state.annotations.push(a); });
    await recordAuditLog({
      category: 'study_order',
      action: `Restored Study (Undo): ${getDisplayName(d)}`,
      detail: `${(last.annotations || []).length} construct(s)/quote(s) restored.`
    });
    if (isNew) await persistDocOrder(); // after the entry: a change of #1 it causes is logged after it
    renderStudyList();
    await switchStudy(d.id);
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'delete_log') {
    await dbPut('logs', last.log);
    if (!state.logs.find(x => x.id === last.log.id)) {
      state.logs.push(last.log);
      state.logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
    await recordAuditLog({
      category: 'audit_edit',
      action: `Restored a deleted audit trail entry (Undo): ${last.log.action}`,
      detail: '',
      clusterIds: last.log.clusterIds || null
    });
    updateAuditBadge();
    if (!divAudit.classList.contains('hidden')) renderAuditTimeline();
  } else if (last.type === 'row_merge' || last.type === 'row_split') {
    // Put back only what the merge / split changed and is still as it left it; later edits are kept (and named in the log)
    const same = (x, y) => JSON.stringify(x === undefined ? null : x) === JSON.stringify(y === undefined ? null : y);
    const opId = last.type === 'row_merge' ? last.tgtId : last.newId; // the row the cards were moved into
    const ids = [last.srcId, opId];
    const kept = [];
    const ops = []; // written in one transaction at the end (as the merge / split was)
    const touched = []; // cards back in their rows: those rows lose an empty-cell note for the card's study (placementRowOps)
    const PER_ROW = ANNOTATION_ROW_FIELDS;
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
      await dbBatch(ops);
    } else {
      // Only the row the split created goes; every other row (including rows added since) stays in its place. What was put
      // into that row after the split is not lost: cards go to the original row, its texts are added there marked with
      // their origin, and concept-map relations follow it.
      const nw = state.clusters.find(c => c.id === last.newId);
      const srcRow = state.clusters.find(c => c.id === last.srcId);
      if (nw && srcRow) {
        const nwTitle = clusterLabel(nw);
        for (const a of state.annotations.filter(x => x.type === 'second_order' && (x.clusterIds || []).includes(nw.id))) {
          a.clusterIds = a.clusterIds.filter(x => x !== nw.id);
          if (!a.clusterIds.includes(srcRow.id)) a.clusterIds.push(srcRow.id);
          const otherBase = rowBaseDocId(nw) !== rowBaseDocId(srcRow); // a judgement against the split-off row's base stays behind
          PER_ROW.forEach(k => { if (a[k] && nw.id in a[k]) { a[k] = { ...a[k] }; if (!(srcRow.id in a[k]) && !(k === 'clusterRelations' && otherBase)) a[k][srcRow.id] = a[k][nw.id]; delete a[k][nw.id]; } });
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
          const seen = new Set(), out = [];
          state.loa.links.forEach(l => {
            const n = { ...l, from: l.from === nw.id ? srcRow.id : l.from, to: l.to === nw.id ? srcRow.id : l.to };
            // For a relation without direction (⇄, ⚡), A–B and B–A are the same relation (as in mergeRows)
            const key = isDirectedLink(n.type) ? [n.from, n.to, n.type].join('|') : [[n.from, n.to].sort().join('~'), n.type].join('|');
            if (n.from === n.to || seen.has(key)) return;
            seen.add(key); out.push(n);
          });
          state.loa = { ...state.loa, links: out }; ops.push({ store: 'meta', put: state.loa });
          kept.push(`concept-map relations of "${nwTitle}", moved to the original row`);
        }
      }
      // The new row goes and the order is renumbered in the same transaction
      ops.push({ store: 'clusters', del: last.newId });
      state.clusters = state.clusters.filter(c => c.id !== last.newId);
      ops.push(...placementRowOps(touched));
      state.clusters.forEach((c, i) => { c.order = i; ops.push({ store: 'clusters', put: c }); });
      await dbBatch(ops);
    }
    await recordAuditLog({ category: 'third_order', action: `Undid: ${last.label}`, clusterIds: ids,
      detail: kept.length ? `Kept what was changed after it: ${[...new Set(kept)].join('; ')}.` : '' });
    renderLoaClusterChips();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'unassign_cluster') {
    const sec = state.annotations.find(a => a.id === last.secId && a.type === 'second_order'); // not one switched to a quote since
    // The row may have been deleted since (and that deletion not undone): never put a card back into a row that is gone
    if (sec && !state.clusters.some(c => c.id === last.clusterId)) {
      showSnackbar('That row no longer exists, so the card stays out of it.');
    } else if (sec) {
      normalizeAnnotation(sec);
      if (!sec.clusterIds.includes(last.clusterId)) {
        sec.clusterIds.push(last.clusterId);
      }
      if (last.prevRelation) {
        if (!sec.clusterRelations) sec.clusterRelations = {};
        sec.clusterRelations[last.clusterId] = last.prevRelation;
      }
      if (typeof last.prevComment === 'string' && last.prevComment) {
        if (!sec.clusterComments) sec.clusterComments = {};
        sec.clusterComments[last.clusterId] = last.prevComment;
      }
      if (last.prevAspectUsed) sec.aspectUsedInLoa = { ...(sec.aspectUsedInLoa || {}), [last.clusterId]: true };
      await dbBatch([{ store: 'annotations', put: sec }, ...placementRowOps([sec])]); // back in the row: no empty-cell note for its study there
      // The removal was logged (with the minor operations), so is its undoing
      await recordAuditLog({ clusterIds: [last.clusterId], category: 'matrix_mapping', action: `Undid: ${last.label}`, detail: 'The construct is back in the row with its judgement, note and line-of-argument mark.', isMinorOp: true });
    }
    updateSidebar();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'map_layout') {
    // Places of the boxes in the line-of-argument map (layout only: no audit entry, as for the move itself)
    state.loa.mapPositions = { ...(state.loa.mapPositions || {}) };
    if (last.before) state.loa.mapPositions[last.layout] = last.before; else delete state.loa.mapPositions[last.layout];
    await dbPut('meta', state.loa);
    renderLoaMap();
  } else if (last.type === 'toggle_order_type') {
    // Back to its type with its links, row placements (only rows that still exist) and within-study relationships, in one transaction
    const ops = [];
    const idx = state.annotations.findIndex(a => a.id === last.snapshot.id);
    const restored = idx >= 0 ? dropGoneLinks(normalizeAnnotation(JSON.parse(JSON.stringify(last.snapshot)))) : null;
    if (restored) ops.push({ store: 'annotations', put: restored });
    if (Array.isArray(last.unlinkedChildrenIds) && last.unlinkedChildrenIds.length > 0) {
      for (const cid of last.unlinkedChildrenIds) {
        const child = state.annotations.find(x => x.id === cid);
        if (child && child.type === 'first_order') { linkQuote(child, last.snapshot.id); ops.push({ store: 'annotations', put: child }); }
      }
    }
    if (restored) { restoreConceptLinksOps(last, ops); ops.push(...placementRowOps([restored])); }
    await dbBatch(ops);
    if (restored) state.annotations[idx] = restored;
    const rows = restored ? liveClusterIds(restored) : [];
    await recordAuditLog({ category: 'linking', action: `Undid: ${last.label}`, detail: 'Back to its type before the switch, with its links and row placements.', clusterIds: rows.length ? rows : null, isMinorOp: true });
    renderHighlights();
    updateSidebar();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  }
  showSnackbar(`Undid: ${last.label}`);
}

// A construct's within-study relationships (Appendix C) removed with it: put them back on their study (ops for dbBatch)
function restoreConceptLinksOps(last, ops) {
  if (!(last.removedConceptLinks || []).length) return;
  const d = state.docs.find(x => x.id === last.conceptLinksDocId);
  if (!d) return;
  const have = new Set((d.conceptLinks || []).map(l => l.id));
  d.conceptLinks = [...(d.conceptLinks || []), ...last.removedConceptLinks.filter(l => !have.has(l.id))];
  ops.push({ store: 'docs', put: d });
}

// ========================================================
// AUDIT LOGGING ENGINE (With Reviewer Stamp & Minor Op Filter)
// ========================================================
async function recordAuditLog({ category, action, detail, fromVal = '', toVal = '', rationale = '', reviewer = null, isMinorOp = false, clusterIds = null }) {
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
    category: 'reading_extraction',
    action: isSec ? 'Edited the extracted text of a 2nd Order Construct' : 'Edited the extracted text of a 1st Order Quote',
    detail: `${getDisplayName(doc)} (p.${anno.page})${anno.note ? ': ' + anno.note : ''}`,
    fromVal: oldText || '',
    toVal: anno.text || '',
    clusterIds: isSec ? liveClusterIds(anno) : null
  });
}

function updateAuditBadge() {
  document.getElementById('auditCountBadge').textContent = state.logs.length;
}
