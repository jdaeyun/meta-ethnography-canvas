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

function pushUndoAction(actionObj) {
  state.undoStack.push(actionObj);
  if (state.undoStack.length > 15) state.undoStack.shift();
  updateUndoButtonUI();
}

async function performUndo() {
  if (state.undoStack.length === 0) return;
  const last = state.undoStack.pop();
  updateUndoButtonUI();

  if (last.type === 'delete_annotation') {
    for (const a of last.annotations) {
      await dbPut('annotations', a);
      if (!state.annotations.find(x => x.id === a.id)) {
        state.annotations.push(a);
      }
    }
    if (last.unlinkedChildrenIds && last.parentId) {
      for (const cid of last.unlinkedChildrenIds) {
        const child = state.annotations.find(x => x.id === cid);
        if (child) {
          linkQuote(child, last.parentId);
          await dbPut('annotations', child);
        }
      }
    }
    renderHighlights();
    updateSidebar();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'annotation_snapshots') {
    // Generic restore: put every snapshotted annotation back, delete the ones the operation created
    for (const snap of last.snapshots) {
      const copy = normalizeAnnotation(JSON.parse(JSON.stringify(snap)));
      const idx = state.annotations.findIndex(a => a.id === copy.id);
      if (idx >= 0) state.annotations[idx] = copy; else state.annotations.push(copy);
      await dbPut('annotations', copy);
    }
    const snapIds = new Set(last.snapshots.map(x => x.id));
    for (const id of (last.createdIds || [])) {
      if (snapIds.has(id)) continue;
      await dbDelete('annotations', id);
      state.annotations = state.annotations.filter(a => a.id !== id);
    }
    await recordAuditLog({ category: 'reading_extraction', action: `Undid: ${last.label}`, detail: '' });
    renderHighlights();
    updateSidebar();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'delete_cluster') {
    await dbPut('clusters', last.cluster);
    if (!state.clusters.find(c => c.id === last.cluster.id)) {
      state.clusters.push(last.cluster);
      state.clusters.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
    }
    for (const secId of (last.assignedSecIds || [])) {
      const sec = state.annotations.find(a => a.id === secId);
      if (sec) {
        normalizeAnnotation(sec);
        if (!sec.clusterIds.includes(last.cluster.id)) {
          sec.clusterIds.push(last.cluster.id);
          await dbPut('annotations', sec);
        }
      }
    }
    renderLoaClusterChips();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'delete_study') {
    const d = last.doc;
    if (!state.docs.find(x => x.id === d.id)) {
      d.hasBinary = Boolean(last.binary && last.binary.byteLength > 0);
      if (d.hasBinary) await dbPut('pdf_binaries', { id: d.id, data: last.binary });
      const pos = Math.max(0, Math.min(state.docs.length, last.position ?? state.docs.length));
      state.docs.splice(pos, 0, d);
      await persistDocOrder();
    }
    for (const a of (last.annotations || [])) {
      await dbPut('annotations', a);
      if (!state.annotations.find(x => x.id === a.id)) state.annotations.push(normalizeAnnotation(a));
    }
    await recordAuditLog({
      category: 'study_order',
      action: `Restored Study (Undo): ${getDisplayName(d)}`,
      detail: `${(last.annotations || []).length} construct(s)/quote(s) restored.`
    });
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
      detail: ''
    });
    updateAuditBadge();
    if (!divAudit.classList.contains('hidden')) renderAuditTimeline();
  } else if (last.type === 'unassign_cluster') {
    const sec = state.annotations.find(a => a.id === last.secId);
    if (sec) {
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
      await dbPut('annotations', sec);
    }
    updateSidebar();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  } else if (last.type === 'toggle_order_type') {
    const idx = state.annotations.findIndex(a => a.id === last.snapshot.id);
    if (idx >= 0) {
      const restored = normalizeAnnotation(JSON.parse(JSON.stringify(last.snapshot)));
      state.annotations[idx] = restored;
      await dbPut('annotations', restored);
    }
    if (Array.isArray(last.unlinkedChildrenIds) && last.unlinkedChildrenIds.length > 0) {
      for (const cid of last.unlinkedChildrenIds) {
        const child = state.annotations.find(x => x.id === cid);
        if (child) {
          linkQuote(child, last.snapshot.id);
          await dbPut('annotations', child);
        }
      }
    }
    renderHighlights();
    updateSidebar();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  }
  showSnackbar(`Undid: ${last.label}`);
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
  updateAuditBadge();
  if (!divAudit.classList.contains('hidden')) renderAuditView();
  return entry;
}

function updateAuditBadge() {
  document.getElementById('auditCountBadge').textContent = state.logs.length;
}
