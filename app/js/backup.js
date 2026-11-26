// Meta-Ethnography Canvas — Backup, restore & reset
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// JSON backup / restore (clean or merge) and project reset.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// JSON BACKUP & RESTORE + CSV EXPORT
// ========================================================
// Local time down to the second, safe for file names: 2026-11-15_143207
function backupTimestamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

document.getElementById('backupJsonBtn').addEventListener('click', async () => {
  await flushAllPendingSaves(); // a text typed just now (and its audit entry) belongs in the backup
  const payload = {
    version: DB_VERSION,
    formatVersion: PROJECT_FORMAT,
    appVersion: (window.ME_CANVAS && window.ME_CANVAS.version) || '',
    projectCode: state.projectCode || 'UNSET',
    reviewerId: state.reviewerId,
    exportedAt: new Date().toISOString(),
    docs: state.docs,
    annotations: state.annotations,
    clusters: state.clusters,
    logs: state.logs,
    loa: { ...state.loa, projectCode: state.projectCode || '' }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const projSlug = fileNamePart(state.projectCode) ? `${fileNamePart(state.projectCode)}_` : '';
  a.download = `meta_ethnography_${projSlug}${fileNamePart(state.reviewerId) || 'Reviewer'}_${backupTimestamp()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markBackupDone();
});

// ---- MERGE helpers: local work is never overwritten ----
function mergeSummaryText(r) {
  let t = `Backup merged.\n\nAdded: ${r.docs} studies, ${r.annotations} constructs/quotes, ${r.clusters} 3rd Order rows, ${r.logs} audit entries.`
    + (r.filled ? `\nFilled empty fields (notes, texts) of ${r.filled} item(s) from the backup.` : '');
  if (r.conflicts.length) {
    t += `\n\nKept YOUR version of ${r.conflicts.length} item(s) that differ in the backup (also listed in the Audit Trail):\n`
      + r.conflicts.slice(0, 12).map(x => '• ' + x).join('\n') + (r.conflicts.length > 12 ? `\n… and ${r.conflicts.length - 12} more` : '')
      + '\n\nTo look at the backup\'s version of these items side by side and adopt parts of it, open the backup with Compare.';
  }
  return t;
}

document.getElementById('restoreJsonBtn').addEventListener('click', () => document.getElementById('jsonFileInput').click());
document.getElementById('jsonFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = upgradeProjectData(JSON.parse(text));
    if (!data.docs || !data.annotations) throw new Error('Invalid backup format');

    const incomingProjCode = sanitizeProjectCode(data.projectCode || data.loa?.projectCode || '');
    const currentProjCode = sanitizeProjectCode(state.projectCode || '');
    const hasExistingWork = state.docs.length > 0 || state.annotations.length > 0 || state.clusters.length > 0;

    let replaceCleanly = true;
    const mergeReport = { docs: 0, annotations: 0, clusters: 0, logs: 0, filled: 0, tidied: 0, conflicts: [] };
    const mergeDocIdMap = {}; // MERGE: backup study id -> local study id
    if (hasExistingWork) {
      // Every button names what it does; closing the dialog (Cancel, ×, Escape) changes nothing
      const otherProject = currentProjCode && incomingProjCode && currentProjCode !== incomingProjCode;
      const choice = otherProject
        ? await askChoice({
            title: 'This backup is from another project',
            body: `This workspace: [${currentProjCode}]\nBackup file: [${incomingProjCode}] (${file.name})\n\nMerging is not offered across projects, so that two projects never mix.`,
            choices: [{ value: 'clean', tone: 'danger', label: `Replace this workspace with project [${incomingProjCode}]`, hint: 'Clean restore: the studies, constructs, rows and audit trail here are replaced by the backup (make a Backup of this workspace first if you may need it). PDFs already stored for matching studies are kept.' }]
          })
        : await askChoice({
            title: `Restore from ${file.name}`,
            body: `Project: ${incomingProjCode || currentProjCode || 'this workspace'}. This workspace already has work in it.`,
            choices: [
              { value: 'clean', tone: 'primary', label: 'Clean restore (replace)', hint: 'Replaces the studies, constructs, rows and audit trail here with the backup. PDFs already stored for matching studies are kept.' },
              { value: 'merge', tone: 'plain', label: 'Merge into this workspace', hint: 'Keeps everything here and adds what is only in the backup. Where an item is in both with different content, your version is kept and the item is listed afterwards (and in the Audit Trail).' }
            ]
          });
      if (!choice) { e.target.value = ''; return; }
      replaceCleanly = choice === 'clean';
    }

    // Validate the backup BEFORE touching the current workspace (clean restore and merge alike)
    if (!Array.isArray(data.docs) || !Array.isArray(data.annotations) ||
        (data.clusters && !Array.isArray(data.clusters)) || (data.logs && !Array.isArray(data.logs)) ||
        (data.loa && typeof data.loa !== 'object')) {
      throw new Error('Backup file structure is invalid (docs / annotations / clusters / logs must be arrays). Nothing was changed.');
    }
    // A save still waiting (text typed a moment ago) is written now, into the project it belongs to: never later, into the
    // project that replaces it
    await flushAllPendingSaves();
    if (replaceCleanly) {
      // Snapshot the project data (NOT the PDFs) so a failed restore can be rolled back.
      // PDFs stay untouched in IndexedDB during the restore and are matched by id / file name below,
      // so memory use does not depend on how many PDFs are stored.
      const rollbackSnapshot = {};
      for (const st of ['docs', 'annotations', 'clusters', 'logs', 'meta']) {
        rollbackSnapshot[st] = await dbGetAll(st);
      }
      const rollbackState = { docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: state.logs, loa: state.loa, undoStack: state.undoStack };
      const oldDocs = state.docs.slice();
      const oldBinKeys = new Set(await dbGetAllKeys('pdf_binaries'));
      const addedBinKeys = [];
      try {
      await Promise.all([
        dbClear('docs'),
        dbClear('annotations'),
        dbClear('clusters'),
        dbClear('logs'),
        dbClear('meta')
      ]);

      state.docs = [];
      state.annotations = [];
      state.clusters = [];
      state.logs = [];
      clearUndoStack();
      state.loa = { id: 'loa_main', projectCode: incomingProjCode || '', aim: '', title: '', flow: '', narrative: '', relateProcess: '', relateOutcome: '', synthStudies: '', appraisalPolicy: '', appraisalUse: '', links: [], updatedAt: null };

      // The project is built in memory first, in the order startup reads it (studies in their order, then constructs, then
      // rows: a row from before rows recorded their base works its base out from study #1 and the constructs placed in it,
      // normalizeCluster), then made consistent (tidyRefsOps over every record: a hand-edited or damaged file can name rows,
      // constructs or studies it does not hold), then written in one transaction (commitOps)
      const docs = [];
      for (const rawD of data.docs) {
        const d = normalizeDoc(rawD);
        // Same id: the stored PDF is already attached. Otherwise match by file name and copy ONE PDF at a time under the new id.
        d.hasBinary = false;
        if (oldBinKeys.has(d.id)) {
          // Same id: keep the stored PDF unless the local study record already marked it as empty / missing
          const localDoc = oldDocs.find(o => o.id === d.id);
          d.hasBinary = !localDoc || localDoc.hasBinary !== false;
        } else if (d.name) {
          const oldMatch = oldDocs.find(o => o.name && o.name.toLowerCase() === d.name.toLowerCase() && oldBinKeys.has(o.id));
          const rec = oldMatch ? await dbGet('pdf_binaries', oldMatch.id) : null;
          if (rec && rec.data && rec.data.byteLength > 0) {
            await dbPut('pdf_binaries', { id: d.id, data: rec.data });
            addedBinKeys.push(d.id);
            d.hasBinary = true;
            d.fpDone = false; // another file under this id: fingerprint it again
            d.sha256 = ''; // until then, no fingerprint of the backup's file stands for this one (the DOI describes the study: it stays)
          }
        }
        docs.push(d);
      }
      state.docs = sortStudies(docs);
      state.annotations = data.annotations.map(normalizeAnnotation);
      state.clusters = sortRows((data.clusters || []).filter(Boolean).map(normalizeCluster));
      // The research aim, model and the other project fields (a file without them: an empty model, stored as such)
      if (data.loa) state.loa = { projectCode: incomingProjCode || '', aim: '', ...state.loa, ...data.loa, id: 'loa_main' };
      /** @type {DbOp[]} */
      const puts = [...state.docs.map(d => ({ store: 'docs', put: d })), ...state.annotations.map(x => ({ store: 'annotations', put: x })),
        ...state.clusters.map(c => ({ store: 'clusters', put: c })), { store: 'meta', put: state.loa }];
      const tidy = tidyRefsOps(state, puts);
      mergeReport.tidied += tidy.ops.filter(o => o.store !== 'meta' && ('del' in o || !puts.some(q => q.put === o.put))).length;
      // The project, its trail and the entry about the restore (after the restored entries) in one transaction
      const count = st => tidy.ops.filter(o => o.store === st && !('del' in o)).length;
      await saveChange([...tidy.ops, ...(data.logs || []).map(l => ({ store: 'logs', put: l }))], auditEntry({
        kind: 'restore', category: 'project_data', action: 'Restored the project from a JSON backup (clean restore)',
        detail: `Backup file: ${backupSource(file, data)}.${data._droppedRecords ? ` ${data._droppedRecords} malformed record(s) in the file were left out.` : ''} ${count('docs')} studies, ${count('annotations')} constructs/quotes, ${count('clusters')} 3rd Order rows.${mergeReport.tidied ? ` ${mergeReport.tidied} item(s) pointed to rows or constructs not in the file; those links were dropped.` : ''}`
      }));
      } catch (restoreErr) {
        // Roll back to the workspace as it was before the restore started
        console.error('Restore failed, rolling back:', restoreErr);
        try {
          for (const id of addedBinKeys) await dbDelete('pdf_binaries', id);
          for (const st of Object.keys(rollbackSnapshot)) {
            await dbClear(st);
            for (const item of rollbackSnapshot[st]) await dbPut(st, item);
          }
          Object.assign(state, rollbackState);
          updateUndoButtonUI();
        } catch (rbErr) {
          console.error('Rollback failed:', rbErr);
          throw new Error(`${restoreErr.message}\n\nRollback ALSO failed (${rbErr.message}). Please restore from your most recent JSON backup.`);
        }
        throw new Error(`${restoreErr.message}\n\nYour previous workspace has been restored unchanged.`);
      }
      // Another project's view settings do not carry over: open sub-tabs, a comparison in progress, hidden studies
      state.clusterActiveTabs = {};
      state.rowToolsOpen = new Set();
      state.peerComparison = null;
      state.hiddenStudyIds = new Set();
      lsRemove('me_hidden_studies');
      // Success: drop PDFs that no restored study refers to (id-based; one key at a time)
      try {
        const keep = new Set(state.docs.map(d => d.id));
        for (const key of await dbGetAllKeys('pdf_binaries')) if (!keep.has(key)) await dbDelete('pdf_binaries', key);
      } catch (cleanupErr) { console.warn('Could not remove unreferenced PDFs:', cleanupErr); }
    } else {
      // MERGE: add what is not here yet; never overwrite local work. Where the same item exists on both sides
      // with different content, the LOCAL version is kept and the item is listed (and logged) as a conflict.
      // Map backup doc IDs -> local doc IDs (a filename match keeps the LOCAL id, so PDF binaries and local constructs stay attached)
      // By id, file name, then (a PDF renamed on the other computer) the identical file or the same DOI, as Compare does
      const findLocalDoc = d => state.docs.find(x => x.id === d.id) ||
        state.docs.find(x => x.name && d.name && x.name.toLowerCase() === d.name.toLowerCase()) ||
        (d.sha256 ? state.docs.find(x => x.sha256 && x.sha256 === d.sha256) : null) ||
        (d.doi ? state.docs.find(x => x.doi && normalizeDoi(x.doi) === normalizeDoi(d.doi)) : null);
      // First the whole map (a study may refer to one listed after it), then every study id in the backup goes through it
      // (remapDocIds, logic.js: every field that names a study — annotations, the companion study, each row's base study,
      // empty-cell records and re-reading note, and study #1). The studies' own ids stay: the map is looked up by them.
      for (const rawD of data.docs) {
        if (!rawD || !rawD.id) continue;
        const existing = findLocalDoc(rawD);
        mergeDocIdMap[rawD.id] = existing ? existing.id : rawD.id;
      }
      Object.assign(data, remapDocIds({ docs: data.docs, annotations: data.annotations, clusters: data.clusters || [], loa: data.loa }, id => mergeDocIdMap[id]));
      // Everything is worked out on copies, then written in ONE transaction with the entry about the merge: a refused write
      // leaves the project as it was (no half-merged project). `merged` is the project as it will be (for the tidying below).
      const merged = { docs: state.docs.slice(), annotations: state.annotations.slice(), clusters: state.clusters.slice(), loa: state.loa };
      /** @type {DbOp[]} */
      const addedPuts = [];
      // A record of the backup: a new one is added; for one that is here, empty texts are filled in from it (on a copy) and a
      // difference is kept local and listed as a conflict. Returns nothing; collects the writes in addedPuts.
      const mergeRecord = (store, list, rec, fill, conflictLabel) => {
        const at = list.findIndex(x => x.id === rec.id);
        if (at < 0) { list.push(rec); addedPuts.push({ store, put: rec }); return true; }
        const copy = { ...list[at] };
        const r = fill(copy, rec);
        if (r.filled) { list[at] = copy; addedPuts.push({ store, put: copy }); mergeReport.filled++; }
        if (r.conflict(copy)) mergeReport.conflicts.push(conflictLabel(copy, r));
        return false;
      };
      for (const rawD of data.docs) {
        const d = normalizeDoc(rawD);
        // The study the map points to (not a new search: a second study of the same name in the backup would otherwise be
        // matched with the first one just added, while its constructs still point to its own id)
        const localId = mergeDocIdMap[rawD.id];
        const isNew = !merged.docs.some(x => x.id === localId);
        if (isNew) { d.hasBinary = false; d.order = merged.docs.length; }
        const added = mergeRecord('docs', merged.docs, isNew ? d : { ...d, id: localId }, (copy, inc) => {
          const r = mergeFillEmpty(copy, inc, ['id', 'hasBinary', 'order', 'fpDone']); // fpDone: bookkeeping, not content
          return { filled: r.filled.length > 0, conflict: () => r.conflicts.length > 0, conflicts: r.conflicts };
        }, (copy, r) => `Study ${getDisplayName(copy)}: ${r.conflicts.join(', ')}`);
        if (added) mergeReport.docs++;
      }
      const sameOrFill = fields => (copy, inc) => ({ filled: mergeFillTexts(copy, inc, fields).length > 0, conflict: c => !sameRecord(c, inc) });
      for (const rawA of data.annotations) {
        const a = normalizeAnnotation(rawA);
        const here = merged.annotations.find(x => x.id === a.id);
        if (here && sameRecord(here, a)) continue;
        if (mergeRecord('annotations', merged.annotations, a, sameOrFill(MERGE_FILL_TEXT.annotations),
          c => `${a.type === 'first_order' ? '1st Order Quote' : '2nd Order Construct'} (p.${c.page}): ${c.note || String(c.text || '').slice(0, 50)}`)) mergeReport.annotations++;
      }
      for (const rawC of (data.clusters || [])) {
        if (!rawC) continue;
        const c = normalizeCluster(rawC);
        const here = merged.clusters.find(x => x.id === c.id);
        if (here && sameRecord(here, c)) continue;
        if (mergeRecord('clusters', merged.clusters, c, sameOrFill(MERGE_FILL_TEXT.clusters),
          x => `3rd Order row: ${x.thirdOrderTitle || '(Untitled Row)'}`)) mergeReport.clusters++;
      }
      // What the backup added or filled in is made consistent with this project (tidyRefsOps, as for an Undo): a reference to a row, construct
      // or study that is not here is dropped (or, for a quote, to a construct of another study); an added construct in a row
      // does there what placing does (the row's base if not set yet, no empty-cell record for its study there)
      const tidy = tidyRefsOps(merged, addedPuts).ops;
      mergeReport.tidied += tidy.filter(o => o.store === 'annotations' && ('del' in o || !addedPuts.some(q => q.put === o.put))).length;
      const have = new Set(state.logs.map(l => l.id));
      const logOps = (data.logs || []).filter(l => !have.has(l.id)).map(l => ({ store: 'logs', put: l }));
      mergeReport.logs = logOps.length;
      // MERGE: the aim, model and narrative are only filled where they are empty here
      // (where the map's boxes were dragged to is layout, not a reading: it is neither merged nor a conflict)
      /** @type {DbOp[]} */
      const loaOps = [];
      if (data.loa) {
        const loa = /** @type {Record<string, any>} */ ({ ...state.loa, id: 'loa_main' });
        const r = mergeFillEmpty(loa, data.loa, ['id', 'projectCode', 'updatedAt', 'mapPositions', 'mapLayout']);
        if (r.conflicts.length) mergeReport.conflicts.push(`Research Aim & Overall Model: ${r.conflicts.join(', ')}`);
        // Concept-map relations taken from the backup between rows not in this project are dropped
        const links = Array.isArray(loa.links) ? liveRowLinks(loa.links, new Set(merged.clusters.map(c => c.id))) : loa.links;
        const droppedLinks = Array.isArray(loa.links) ? loa.links.length - links.length : 0;
        if (r.filled.length || droppedLinks) loaOps.push({ store: 'meta', put: { ...loa, links } });
      }
      await saveChange([...tidy, ...logOps, ...loaOps], auditEntry({
        kind: 'restore',
        category: 'project_data',
        action: 'Merged a JSON backup into the project',
        detail: `Backup file: ${backupSource(file, data)}.${data._droppedRecords ? ` ${data._droppedRecords} malformed record(s) in the file were left out.` : ''} Added ${mergeReport.docs} studies, ${mergeReport.annotations} constructs/quotes, ${mergeReport.clusters} 3rd Order rows, ${mergeReport.logs} audit entries.`
          + (mergeReport.filled ? ` Filled empty fields of ${mergeReport.filled} item(s) from the backup.` : '')
          + (mergeReport.tidied ? ` ${mergeReport.tidied} added item(s) pointed to rows or constructs not in this project; those links were dropped.` : '')
          + (mergeReport.conflicts.length ? `\nKept the local version of ${mergeReport.conflicts.length} item(s) that differ in the backup:\n` + mergeReport.conflicts.map(x => '• ' + x).join('\n') : '')
      }));
    }

    if (incomingProjCode) {
      state.projectCode = incomingProjCode;
      lsSet('me_project_code', incomingProjCode);
    } else if (replaceCleanly) {
      // A file without a project code (an older backup) replaces the project: the previous project's code does not stay with it
      state.projectCode = '';
      lsRemove('me_project_code');
    }
    populateLoaInputs();
    updateHeaderProjectUI();

    sortStudies(state.docs);
    sortRows(state.clusters); // same order as at startup
    if (!state.loa.baselineDocId) await checkBaselineChange();
    ensureDocFingerprints();

    updateAuditBadge();
    renderStudyList();
    if (replaceCleanly) await releaseWorkspaceView(); // the previous project's PDF and caches, even if no study is opened now
    state.activeDocId = state.docs[0]?.id || null;
    if (state.activeDocId) {
      await switchStudy(state.activeDocId);
    } else {
      renderWelcomeGuideIfNeeded();
      updateDocHeaderUI();
      updateSidebar();
    }
    renderMatrixView();
    if (replaceCleanly) markBackupDone();
    // One dialog at a time: the merge report first (worth reading), then the list of PDFs to reconnect
    if (!replaceCleanly) await showNotice('Backup merged', mergeSummaryText(mergeReport));
    else if (!state.docs.some(d => !d.hasBinary)) showSnackbar('Backup restored.');
    if (state.docs.some(d => !d.hasBinary)) showMissingPdfModal();
  } catch (err) {
    showNotice('The backup could not be restored', err.message);
  }
  e.target.value = '';
});

// The backup file as named in the trail: its name, and when and by whom it was exported
function backupSource(file, data) {
  return `${file.name}${data.exportedAt ? ' (exported ' + new Date(data.exportedAt).toLocaleString() + (data.reviewerId ? ' by @' + data.reviewerId : '') + ')' : ''}`;
}

// The workspace is being replaced (reset, clean restore): let go of the open PDF and of what was cached for the old project
// (PDF search index, matrix row heights), so nothing of it lingers when the new project has no study to open
async function releaseWorkspaceView() {
  await closeActivePdf();
  Object.keys(matrixRowHeights).forEach(k => delete matrixRowHeights[k]);
}

document.getElementById('resetProjectBtn').addEventListener('click', () => {
  // In the demo, starting blank would leave an empty "demo" (it is not filled again on reload): reset the demo instead
  if (DEMO_MODE && document.getElementById('demoResetBtn')) { document.getElementById('demoResetBtn').click(); return; }
  resetProject();
});
async function resetProject() {
  const ok = await askChoice({
    title: 'Reset the project (start blank)?',
    body: 'All studies, PDFs, constructs, matrix rows and audit trail entries in this browser are removed. This cannot be undone: use Backup first if you may need this project again.',
    choices: [{ value: 'reset', tone: 'danger', label: 'Remove everything and start blank' }]
  });
  if (!ok) return;

  await flushAllPendingSaves(); // a save still waiting must not land in the blank project afterwards
  await releaseWorkspaceView();

  await Promise.all([
    dbClear('docs'),
    dbClear('pdf_binaries'),
    dbClear('annotations'),
    dbClear('clusters'),
    dbClear('logs'),
    dbClear('meta')
  ]);

  state.docs = [];
  state.annotations = [];
  state.clusters = [];
  state.logs = [];
  state.projectCode = '';
  lsRemove('me_project_code');
  state.loa = { id: 'loa_main', projectCode: '', aim: '', title: '', flow: '', narrative: '', relateProcess: '', relateOutcome: '', synthStudies: '', appraisalPolicy: '', appraisalUse: '', links: [], updatedAt: null };
  state.activeDocId = null;
  state.clusterActiveTabs = {};
  state.rowToolsOpen = new Set();
  state.peerComparison = null;
  state.hiddenStudyIds = new Set();
  lsRemove('me_hidden_studies');
  clearUndoStack();

  populateLoaInputs();
  lsRemove('unbackedSince');
  updateBackupReminder();
  updateHeaderProjectUI();
  updateAuditBadge();
  renderStudyList();
  renderWelcomeGuideIfNeeded();
  document.getElementById('pdfPageCountLabel').textContent = '0 pages';
  updateDocHeaderUI();
  updateSidebar();
  renderMatrixView();
  setActiveTab('extract');

  openProjectSetupModal({
    isInitialOrReset: true,
    titleText: 'New Project Setup & Phase 1 (Getting Started)'
  });
}

// ---- After a restore: list the studies whose PDF is not stored in this browser and offer to import them ----
// How alike a file name and a study's file name are (shared words / numbers such as the year): used only to list the likeliest study first
function pdfNameScore(fileName, docName) {
  const tokens = n => new Set(String(n || '').toLowerCase().replace(/\.pdf$/, '').split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !['pdf', 'et', 'al', 'and', 'the'].includes(t)));
  const a = tokens(fileName), b = tokens(docName);
  let n = 0; a.forEach(t => { if (b.has(t)) n++; });
  return n;
}
let unmatchedPdfFiles = [];
function refreshMissingPdfModal(unmatched = null) {
  const modal = document.getElementById('missingPdfModal');
  if (!modal || modal.classList.contains('hidden')) return;
  if (Array.isArray(unmatched)) {
    unmatched.forEach(f => { if (!unmatchedPdfFiles.some(x => x.name === f.name && x.size === f.size)) unmatchedPdfFiles.push(f); });
  }
  const missing = state.docs.filter(d => !d.hasBinary);
  if (missing.length === 0) { unmatchedPdfFiles = []; closeMissingPdfModal(); showSnackbar('All PDFs reconnected.'); return; }
  document.getElementById('missingPdfList').innerHTML = missing
    .map(d => `<li class="truncate" title="${escapeHtml(d.name || '')}">• ${escapeHtml(d.name || getDisplayName(d))}</li>`).join('');

  const box = document.getElementById('missingPdfUnmatched');
  const list = document.getElementById('missingPdfUnmatchedList');
  box.classList.toggle('hidden', unmatchedPdfFiles.length === 0);
  list.innerHTML = '';
  unmatchedPdfFiles.forEach(file => {
    const ranked = missing.map(d => ({ d, score: pdfNameScore(file.name, d.name) })).sort((x, y) => y.score - x.score);
    const li = document.createElement('li');
    li.className = 'flex items-center gap-2';
    li.innerHTML = `<span class="truncate flex-1 font-mono" title="${escapeHtml(file.name)}">• ${escapeHtml(file.name)}</span>
      <select class="unmatched-assign max-w-[55%] text-xs border border-amber-300 rounded px-1 py-0.5 bg-white text-slate-700">
        <option value="">Connect to study…</option>
        ${ranked.map((r, i) => `<option value="${escapeHtml(r.d.id)}">${i === 0 && r.score > 0 ? '★ ' : ''}${escapeHtml(r.d.name || getDisplayName(r.d))}</option>`).join('')}
      </select>`;
    li.querySelector('select').onchange = async e => {
      const doc = state.docs.find(d => d.id === e.target.value);
      if (!doc) return;
      await attachPdfFileToDoc(doc, file);
      unmatchedPdfFiles = unmatchedPdfFiles.filter(f => f !== file);
      renderStudyList();
      refreshMissingPdfModal();
      switchStudy(doc.id); // show the PDF just connected (as when a file is matched by name)
    };
    list.appendChild(li);
  });
}
function showMissingPdfModal() {
  const modal = document.getElementById('missingPdfModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  unmatchedPdfFiles = [];
  refreshMissingPdfModal();
}
function closeMissingPdfModal() {
  unmatchedPdfFiles = []; // the files offered in it are let go (they can be chosen again next time)
  const modal = document.getElementById('missingPdfModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}
document.getElementById('missingPdfCloseBtn').addEventListener('click', closeMissingPdfModal);
document.getElementById('missingPdfLaterBtn').addEventListener('click', closeMissingPdfModal);
document.getElementById('missingPdfSelectBtn').addEventListener('click', () => document.getElementById('pdfFileInput').click());
