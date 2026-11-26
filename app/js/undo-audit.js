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
  // A write the browser refuses leaves the project as it was (commitOps changes memory only once stored): the step goes back
  // on the stack, so Ctrl+Z can try again
  try { await undoOneStep(last); } catch (err) {
    state.undoStack.push(last); updateUndoButtonUI();
    throw err;
  }
}
async function undoOneStep(last) {

  if (last.type === 'change') {
    const { ops, kept } = revertChange(last, state);
    const { ops: tidy, dropped } = tidyRefsOps(state, ops); // never back pointing at what was deleted since
    // The rows there will be once it is written (an entry names only those)
    const rows = new Set(state.clusters.map(c => c.id));
    tidy.forEach(o => { if (o.store === 'clusters') { if ('del' in o) rows.delete(o.del); else rows.add(o.put.id); } });
    const keptText = kept.length ? `Kept what was changed after it: ${describeKept(kept)}.` : '';
    const droppedText = dropped.length ? `Not brought back (deleted since): ${dropped.join('; ')}.` : '';
    const entries = (last.undoLogs || []).map(l => {
      const ids = (l.clusterIds || []).filter(id => rows.has(id));
      return auditEntry({ ...l, clusterIds: ids.length ? ids : null, detail: [l.detail, keptText, droppedText].filter(Boolean).join('\n') });
    });
    await saveChange(tidy, entries); // what it puts back and its entries, in one transaction
    sortRows(state.clusters); // a row back in its place
    if (kept.length || dropped.length) showSnackbar(`Undone: ${last.label}` + (droppedText ? `\n${droppedText}` : '') + (keptText ? `\n${keptText}` : ''));
    refreshOpenViews({ loa: last.records.some(r => r.store === 'meta') });
  } else if (last.type === 'delete_study') {
    const d = last.doc;
    // The study, its PDF and its constructs come back in one transaction (as they went); a construct's placement in a row
    // that was deleted in the meantime is not brought back
    // (tidied like every other Undo: tidyRefsOps; a quote keeps its links to the study's constructs coming back with it)
    /** @type {DbOp[]} */
    const ops = [];
    const restored = (last.annotations || []).map(raw => normalizeAnnotation(JSON.parse(JSON.stringify(raw))));
    const isNew = !state.docs.find(x => x.id === d.id);
    if (isNew) {
      d.hasBinary = Boolean(last.binary && last.binary.byteLength > 0);
      if (d.hasBinary) ops.push({ store: 'pdf_binaries', put: { id: d.id, data: last.binary } });
      ops.push({ store: 'docs', put: d });
    }
    restored.forEach(a => ops.push({ store: 'annotations', put: a }));
    // Its empty-cell records and "same primary study as" come back (copies; tidyRefsOps drops an empty-cell record where the
    // study has a card again, and a placement in a row deleted since, and does what placing does in the rows)
    (last.cellStatus || []).forEach(({ id, v }) => { const c = state.clusters.find(x => x.id === id); if (c) ops.push({ store: 'clusters', put: { ...c, cellStatus: { ...(c.cellStatus || {}), [d.id]: v } } }); });
    (last.companions || []).forEach(id => { const o = state.docs.find(x => x.id === id); if (o && !o.companionOf) ops.push({ store: 'docs', put: { ...o, companionOf: d.id } }); });
    const tidy = tidyRefsOps(state, ops);
    ops.length = 0; ops.push(...tidy.ops);
    // (the study is added at the end of state.docs: moved to where it was)
    await saveChange(ops, auditEntry({
      kind: 'study_restore',
      category: 'study_order',
      action: `Restored Study (Undo): ${getDisplayName(d)}`,
      detail: `${(last.annotations || []).length} construct(s)/quote(s) restored.`
    }));
    if (isNew) {
      const at = state.docs.findIndex(x => x.id === d.id);
      if (at >= 0) state.docs.splice(at, 1);
      const pos = Math.max(0, Math.min(state.docs.length, last.position ?? state.docs.length));
      state.docs.splice(pos, 0, d);
    }
    if (isNew) await persistDocOrder(); // after the entry: a change of #1 it causes is logged after it
    await switchStudy(d.id);
    refreshOpenViews();
  } else if (last.type === 'row_merge' || last.type === 'row_split') {
    // Put back only what the merge / split changed and is still as it left it; later edits are kept (and named in the log).
    // Worked out on copies (planUndoRowMerge / planUndoRowSplit, logic.js), tidied, written in one transaction.
    const plan = last.type === 'row_merge' ? planUndoRowMerge(state, last) : planUndoRowSplit(state, last, ROW_PLAN_HELPERS);
    await saveChange(tidyRefsOps(state, plan.ops).ops, auditEntry({ kind: 'row_undo', category: 'third_order', action: `Undid: ${last.label}`,
      clusterIds: [last.srcId, last.type === 'row_merge' ? last.tgtId : last.newId], detail: plan.kept.length ? `Kept what was changed after it: ${plan.kept.join('; ')}.` : '' }));
    sortRows(state.clusters);
    refreshOpenViews({ loa: true });
  }
}

// ========================================================
// AUDIT LOGGING ENGINE (With Reviewer Stamp & Minor Op Filter)
// ========================================================
// An audit entry is built by auditEntry() and written by saveChange() together with the records it describes (one
// transaction: the change and its entry are both stored, or neither). recordAuditLog() writes an entry on its own (a memo,
// or an entry about something already stored).
// kind: what kind of entry this is (LOG_KINDS in logic.js): Appendix A goes by it, not by the action's wording.
// targetLabel: what it is about, as named at the time (a row's title, a field); targetId: the record it is about (e.g. the
// trail entry a deletion removed). All three are optional and stored only when given.
// isMinorOp: an entry kept only when "log minor operations" is on (auditEntry returns null otherwise).
let lastLogTime = 0; // entries made in the same millisecond still keep their order (newest first in the trail)
/** @returns {any} */
function auditEntry({ category, action, detail = '', fromVal = '', toVal = '', rationale = '', reviewer = null, isMinorOp = false, clusterIds = null, kind = undefined, targetLabel = undefined, targetId = undefined }) {
  if (isMinorOp && !state.logMinorOps) return null;
  const now = lastLogTime = Math.max(Date.now(), lastLogTime + 1);
  const entry = {
    id: 'log_' + now + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: now,
    isoTime: new Date(now).toISOString(),
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
  return entry;
}

// The one way a change is stored: the records (ops, built as copies: { store, put: { ...rec, field } } or { store, del })
// and the audit entries about them (auditEntry(), one or a list; null entries are skipped) in ONE transaction (commitOps),
// then applied to `state`. A refused write changes nothing, in the database or in memory. Returns the entries written.
/** @param {DbOp[]} ops @param {any} [entries] */
async function saveChange(ops, entries = []) {
  const logs = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  await commitOps([...ops, ...logs.map(e => ({ store: 'logs', put: e }))]);
  if (logs.length) showNewAuditEntries(logs);
  return logs;
}
// Runs an operation worked out in logic.js (an op*() result: { ops, entries }, or null when nothing changes): the records and
// their entries are stored in one transaction (saveChange); memory and the trail follow once stored. With undo
// ({ label, undoLogs }), saves still pending are written first, the records the operation touches are copied as they are,
// and the change goes on the undo stack once stored (Ctrl+Z). `work` may be a function (project → result), worked out after
// those pending saves. Returns true if something was stored.
/** @param {any} work @param {{ undo?: { label: string, undoLogs?: any[], before?: Record<string, any> } | null }} [opts] */
async function runOperation(work, { undo = null } = {}) {
  if (undo || typeof work === 'function') await flushAllPendingSaves();
  const result = typeof work === 'function' ? work(state) : work;
  if (!result || (!result.ops.length && !(result.entries || []).length)) return false;
  const keys = result.ops.filter(o => o.store !== 'pdf_binaries').map(o => ({ store: o.store, id: 'del' in o ? o.del : o.put.id }));
  const change = undo ? beginChange(undo.label, keys, { undoLogs: undo.undoLogs || [], before: undo.before || {} }) : null;
  await saveChange(result.ops, (result.entries || []).map(e => auditEntry(e)));
  if (change) finishChange(change);
  return true;
}
// The names an operation's entries need (logic.js: OpNames)
const OP_NAMES = {
  docName: id => { const d = state.docs.find(x => x.id === id); return d ? getDisplayName(d) : null; },
  relLabel: rel => getCellRelationMeta(rel).label
};
// Writes one audit entry on its own. Returns it (null for a minor operation that is not logged).
async function recordAuditLog(args) {
  const [entry] = await saveChange([], auditEntry(args));
  return entry || null;
}
// After entries joined the trail: the count in the header, the rows' History buttons, the Audit Trail if it is open
function showNewAuditEntries(entries) {
  updateAuditBadge();
  const rowIds = entries.flatMap(e => e.clusterIds || []);
  if (rowIds.length && typeof refreshRowHistoryButtons === 'function') refreshRowHistoryButtons([...new Set(rowIds)]);
  if (!divAudit.classList.contains('hidden')) renderAuditView();
}

function updateAuditBadge() {
  document.getElementById('auditCountBadge').textContent = String(state.logs.length);
}
