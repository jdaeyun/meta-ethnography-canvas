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
  const projSlug = state.projectCode ? `${state.projectCode}_` : '';
  a.download = `meta_ethnography_${projSlug}${state.reviewerId || 'Reviewer'}_${backupTimestamp()}.json`;
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
      state.loa = { id: 'loa_main', aim: '', title: '', flow: '', narrative: '', relateProcess: '', relateOutcome: '', synthStudies: '', appraisalPolicy: '', appraisalUse: '', links: [], updatedAt: null };

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
            d.sha256 = ''; d.doi = ''; // until then, no fingerprint of the backup's file stands for this one (Compare matches on it)
          }
        }
        await dbPut('docs', d);
        state.docs.push(d);
      }
      // Rows first, so constructs can be checked against them: a reference to a row or a 2nd Order construct the file does not
      // hold (a hand-edited or damaged file) is dropped, as in a merge
      for (const rawC of (data.clusters || [])) {
        const c = normalizeCluster(rawC);
        await dbPut('clusters', c);
        state.clusters.push(c);
      }
      const fileSecIds = new Set(data.annotations.filter(a => a && a.type === 'second_order').map(a => a.id));
      for (const rawA of data.annotations) {
        const a = normalizeAnnotation(rawA);
        const was = JSON.stringify([a.clusterIds, a.clusterRelations, a.clusterComments, a.aspectUsedInLoa, a.parentIds]);
        dropGoneLinks(a, fileSecIds); // rows: those restored above; quotes' constructs: those in the file
        if (JSON.stringify([a.clusterIds, a.clusterRelations, a.clusterComments, a.aspectUsedInLoa, a.parentIds]) !== was) mergeReport.tidied++;
        await dbPut('annotations', a);
        state.annotations.push(a);
      }
      for (const l of (data.logs || [])) {
        await dbPut('logs', l);
        state.logs.push(l);
      }
      // The research aim, model and the other project fields are part of what a failed restore rolls back
      if (data.loa) {
        state.loa = { projectCode: incomingProjCode || state.projectCode || '', aim: '', ...state.loa, ...data.loa, id: 'loa_main' };
        dropGoneMapLinks();
        await dbPut('meta', state.loa);
      }
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
      const addedAnnoIds = new Set();
      const findLocalDoc = d => state.docs.find(x => x.id === d.id) ||
        state.docs.find(x => x.name && d.name && x.name.toLowerCase() === d.name.toLowerCase());
      // First the whole map (a study may refer to one listed after it), then every study id in the backup goes through it:
      // annotations, the companion study, each row's base study and empty-cell records, and study #1.
      for (const rawD of data.docs) {
        if (!rawD || !rawD.id) continue;
        const existing = findLocalDoc(rawD);
        mergeDocIdMap[rawD.id] = existing ? existing.id : rawD.id;
      }
      const toLocalDoc = id => (id && mergeDocIdMap[id]) || id;
      for (const rawD of data.docs) {
        const d = normalizeDoc(rawD);
        if (d.companionOf) d.companionOf = toLocalDoc(d.companionOf);
        const existing = findLocalDoc(d);
        if (existing) {
          const r = mergeFillEmpty(existing, d, ['id', 'hasBinary', 'order', 'fpDone']); // fpDone: bookkeeping, not content
          if (r.conflicts.length) mergeReport.conflicts.push(`Study ${getDisplayName(existing)}: ${r.conflicts.join(', ')}`);
          if (r.filled.length) { mergeReport.filled++; await dbPut('docs', existing); }
        } else {
          d.hasBinary = false;
          d.order = state.docs.length;
          await dbPut('docs', d);
          state.docs.push(d);
          mergeReport.docs++;
        }
      }
      for (const rawA of data.annotations) {
        if (rawA && mergeDocIdMap[rawA.docId]) rawA.docId = mergeDocIdMap[rawA.docId];
        const a = normalizeAnnotation(rawA);
        const local = state.annotations.find(x => x.id === a.id);
        if (local) {
          if (!sameRecord(local, a)) {
            if (mergeFillTexts(local, a, MERGE_FILL_TEXT.annotations).length) { mergeReport.filled++; await dbPut('annotations', local); }
            if (!sameRecord(local, a)) mergeReport.conflicts.push(`${a.type === 'first_order' ? '1st Order Quote' : '2nd Order Construct'} (p.${local.page}): ${local.note || String(local.text || '').slice(0, 50)}`);
          }
          continue;
        }
        await dbPut('annotations', a);
        state.annotations.push(a);
        addedAnnoIds.add(a.id);
        mergeReport.annotations++;
      }
      for (const rawC of (data.clusters || [])) {
        if (rawC && rawC.baseDocId) rawC.baseDocId = toLocalDoc(rawC.baseDocId);
        if (rawC && rawC.cellStatus && typeof rawC.cellStatus === 'object') {
          const cs = {};
          Object.keys(rawC.cellStatus).forEach(id => { cs[toLocalDoc(id)] = rawC.cellStatus[id]; });
          rawC.cellStatus = cs;
        }
        const c = normalizeCluster(rawC);
        const local = state.clusters.find(x => x.id === c.id);
        if (local) {
          if (!sameRecord(local, c)) {
            if (mergeFillTexts(local, c, MERGE_FILL_TEXT.clusters).length) { mergeReport.filled++; await dbPut('clusters', local); }
            if (!sameRecord(local, c)) mergeReport.conflicts.push(`3rd Order row: ${local.thirdOrderTitle || '(Untitled Row)'}`);
          }
          continue;
        }
        await dbPut('clusters', c);
        state.clusters.push(c);
        mergeReport.clusters++;
      }
      // Items added from the backup may point to rows or 2nd Order constructs that are not in this project: drop those references
      const liveRows = new Set(state.clusters.map(c => c.id));
      const liveSecs = new Set(state.annotations.filter(a => a.type === 'second_order').map(a => a.id));
      for (const a of state.annotations.filter(x => addedAnnoIds.has(x.id))) {
        let changed = false;
        if (a.type === 'second_order') {
          const keep = a.clusterIds.filter(id => liveRows.has(id));
          if (keep.length !== a.clusterIds.length) { a.clusterIds = keep; changed = true; }
          ['clusterRelations', 'clusterComments', 'aspectUsedInLoa'].forEach(k => Object.keys(a[k] || {}).forEach(id => { if (!liveRows.has(id)) { delete a[k][id]; changed = true; } }));
        } else if (a.type === 'first_order') {
          const keep = quoteParentIds(a).filter(id => liveSecs.has(id));
          if (keep.length !== a.parentIds.length) { a.parentIds = keep; changed = true; }
        }
        if (changed) { mergeReport.tidied++; await dbPut('annotations', a); }
      }
      for (const l of (data.logs || [])) {
        if (state.logs.find(x => x.id === l.id)) continue;
        await dbPut('logs', l);
        state.logs.push(l);
        mergeReport.logs++;
      }
    }

    if (incomingProjCode) {
      state.projectCode = incomingProjCode;
      lsSet('me_project_code', incomingProjCode);
    }
    if (data.loa && !replaceCleanly) {
      // MERGE: the aim, model and narrative are only filled where they are empty here
      if (data.loa.baselineDocId) data.loa.baselineDocId = mergeDocIdMap[data.loa.baselineDocId] || data.loa.baselineDocId;
      const r = mergeFillEmpty(state.loa, data.loa, ['id', 'projectCode', 'updatedAt']);
      if (r.conflicts.length) mergeReport.conflicts.push(`Research Aim & Overall Model: ${r.conflicts.join(', ')}`);
      const droppedLinks = dropGoneMapLinks(); // concept-map relations taken from the backup between rows not in this project
      if (r.filled.length || droppedLinks) { state.loa.id = 'loa_main'; await dbPut('meta', state.loa); }
    }
    populateLoaInputs();
    updateHeaderProjectUI();

    state.docs.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    state.clusters.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0)); // same order as at startup
    if (!state.loa.baselineDocId) await checkBaselineChange();
    ensureDocFingerprints();

    state.logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
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
    // The restore / merge itself belongs in the trail (after the restored logs, so a clean restore keeps it)
    const src = `${file.name}${data.exportedAt ? ' (exported ' + new Date(data.exportedAt).toLocaleString() + (data.reviewerId ? ' by @' + data.reviewerId : '') + ')' : ''}`;
    if (replaceCleanly) {
      await recordAuditLog({ category: 'project_data', action: 'Restored the project from a JSON backup (clean restore)', detail: `Backup file: ${src}.${data._droppedRecords ? ` ${data._droppedRecords} malformed record(s) in the file were left out.` : ''} ${state.docs.length} studies, ${state.annotations.length} constructs/quotes, ${state.clusters.length} 3rd Order rows.${mergeReport.tidied ? ` ${mergeReport.tidied} item(s) pointed to rows or constructs not in the file; those links were dropped.` : ''}` });
    } else {
      await recordAuditLog({
        category: 'project_data',
        action: 'Merged a JSON backup into the project',
        detail: `Backup file: ${src}.${data._droppedRecords ? ` ${data._droppedRecords} malformed record(s) in the file were left out.` : ''} Added ${mergeReport.docs} studies, ${mergeReport.annotations} constructs/quotes, ${mergeReport.clusters} 3rd Order rows, ${mergeReport.logs} audit entries.`
          + (mergeReport.filled ? ` Filled empty fields of ${mergeReport.filled} item(s) from the backup.` : '')
          + (mergeReport.tidied ? ` ${mergeReport.tidied} added item(s) pointed to rows or constructs not in this project; those links were dropped.` : '')
          + (mergeReport.conflicts.length ? `\nKept the local version of ${mergeReport.conflicts.length} item(s) that differ in the backup:\n` + mergeReport.conflicts.map(x => '• ' + x).join('\n') : '')
      });
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

// Concept-map relations whose rows are not in the project (restored or merged from a file) are dropped; returns how many
function dropGoneMapLinks() {
  if (!Array.isArray(state.loa.links)) return 0;
  const rows = new Set(state.clusters.map(c => c.id));
  const keep = state.loa.links.filter(l => l && rows.has(l.from) && rows.has(l.to));
  const n = state.loa.links.length - keep.length;
  if (n) state.loa = { ...state.loa, links: keep };
  return n;
}

// The workspace is being replaced (reset, clean restore): let go of the open PDF and of what was cached for the old project
// (PDF search index, matrix row heights), so nothing of it lingers when the new project has no study to open
async function releaseWorkspaceView() {
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }
  if (state.activePdfDoc) {
    try { await state.activePdfDoc.destroy(); } catch (e) {}
    state.activePdfDoc = null;
  }
  Object.assign(pdfSearchState, { docId: null, pageTexts: [], matches: [], activeIdx: -1, lastQuery: '' });
  Object.keys(matrixRowHeights).forEach(k => delete matrixRowHeights[k]);
}

document.getElementById('resetProjectBtn').addEventListener('click', async () => {
  const ok = await askChoice({
    title: 'Reset the project (start blank)?',
    body: 'All studies, PDFs, constructs, matrix rows and audit trail entries in this browser are removed. This cannot be undone: use Backup first if you may need this project again.',
    choices: [{ value: 'reset', tone: 'danger', label: 'Remove everything and start blank' }]
  });
  if (!ok) return;

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
});

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
  const modal = document.getElementById('missingPdfModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}
document.getElementById('missingPdfCloseBtn').addEventListener('click', closeMissingPdfModal);
document.getElementById('missingPdfLaterBtn').addEventListener('click', closeMissingPdfModal);
document.getElementById('missingPdfSelectBtn').addEventListener('click', () => document.getElementById('pdfFileInput').click());
