// Meta-Ethnography Canvas — Backup, restore & reset
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// JSON backup / restore (clean or merge) and project reset.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// JSON BACKUP & RESTORE + CSV EXPORT
// ========================================================
document.getElementById('backupJsonBtn').addEventListener('click', () => {
  const payload = {
    version: DB_VERSION,
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
  a.download = `meta_ethnography_${projSlug}${state.reviewerId || 'Reviewer'}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById('restoreJsonBtn').addEventListener('click', () => document.getElementById('jsonFileInput').click());
document.getElementById('jsonFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.docs || !data.annotations) throw new Error('Invalid backup format');

    const incomingProjCode = sanitizeProjectCode(data.projectCode || data.loa?.projectCode || '');
    const currentProjCode = sanitizeProjectCode(state.projectCode || '');
    const hasExistingWork = state.docs.length > 0 || state.annotations.length > 0 || state.clusters.length > 0;

    if (hasExistingWork && currentProjCode && incomingProjCode && currentProjCode !== incomingProjCode) {
      const proceedMismatch = confirm(
        `⚠️ PROJECT CODE MISMATCH WARNING!\n\n` +
        `• Current Workspace Project Code: [${currentProjCode}]\n` +
        `• Backup File Project Code: [${incomingProjCode}]\n\n` +
        `You are attempting to load a JSON file from a DIFFERENT project [${incomingProjCode}] into [${currentProjCode}].\n` +
        `Click [Cancel] to abort safely, or [OK] ONLY if you intend to switch to or overwrite with [${incomingProjCode}].`
      );
      if (!proceedMismatch) {
        e.target.value = '';
        return;
      }
    }

    let replaceCleanly = true;
    if (hasExistingWork) {
      if (currentProjCode && incomingProjCode && currentProjCode !== incomingProjCode) {
        const confirmCleanSwitch = confirm(
          `Because the Project Codes differ ([${currentProjCode}] vs. [${incomingProjCode}]), MERGE mode is disabled to prevent cross-project contamination.\n\n` +
          `Click [OK] to perform a CLEAN RESTORE of project [${incomingProjCode}] (replacing current workspace data), or [Cancel] to abort.`
        );
        if (!confirmCleanSwitch) {
          e.target.value = '';
          return;
        }
        replaceCleanly = true;
      } else {
        replaceCleanly = confirm(
          `Restore Mode Selection (Project: ${incomingProjCode || currentProjCode || 'Current'}):\n\n` +
          '• Click [OK] for CLEAN RESTORE (Recommended): Replaces current annotations, clusters, and logs with the backup while preserving any matching PDF binaries already loaded in your browser.\n' +
          '• Click [Cancel] for MERGE: Keeps current data and merges the backup on top.'
        );
      }
    }

    if (replaceCleanly) {
      // Validate the backup BEFORE touching the current workspace
      if (!Array.isArray(data.docs) || !Array.isArray(data.annotations) ||
          (data.clusters && !Array.isArray(data.clusters)) || (data.logs && !Array.isArray(data.logs))) {
        throw new Error('Backup file structure is invalid (docs / annotations / clusters / logs must be arrays). Nothing was changed.');
      }
      // Snapshot every store so a failed restore can be rolled back
      const rollbackSnapshot = {};
      for (const st of ['docs', 'pdf_binaries', 'annotations', 'clusters', 'logs', 'meta']) {
        rollbackSnapshot[st] = await dbGetAll(st);
      }
      const rollbackState = { docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: state.logs, loa: state.loa };
      try {
      // Preserve existing PDF ArrayBuffers from pdf_binaries by id or filename
      const allBins = rollbackSnapshot['pdf_binaries'];
      const binaryCacheById = {};
      const binaryCacheByName = {};
      state.docs.forEach(oldDoc => {
        const foundBin = allBins.find(b => b.id === oldDoc.id);
        if (foundBin && foundBin.data && foundBin.data.byteLength > 0) {
          binaryCacheById[oldDoc.id] = foundBin.data;
          if (oldDoc.name) binaryCacheByName[oldDoc.name.toLowerCase()] = foundBin.data;
        }
      });

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
      state.loa = { id: 'loa_main', aim: '', title: '', flow: '', narrative: '', relateProcess: '', relateOutcome: '', synthStudies: '', appraisalPolicy: '', appraisalUse: '', links: [], updatedAt: null };

      for (const rawD of data.docs) {
        const d = normalizeDoc(rawD);
        const cachedBin = binaryCacheById[d.id] || (d.name ? binaryCacheByName[d.name.toLowerCase()] : null);
        if (cachedBin) {
          d.hasBinary = true;
          await dbPut('pdf_binaries', { id: d.id, data: cachedBin });
        } else {
          d.hasBinary = false;
        }
        await dbPut('docs', d);
        state.docs.push(d);
      }
      for (const rawA of data.annotations) {
        const a = normalizeAnnotation(rawA);
        await dbPut('annotations', a);
        state.annotations.push(a);
      }
      for (const rawC of (data.clusters || [])) {
        const c = normalizeCluster(rawC);
        await dbPut('clusters', c);
        state.clusters.push(c);
      }
      for (const l of (data.logs || [])) {
        await dbPut('logs', l);
        state.logs.push(l);
      }
      } catch (restoreErr) {
        // Roll back to the workspace as it was before the restore started
        console.error('Restore failed, rolling back:', restoreErr);
        try {
          for (const st of Object.keys(rollbackSnapshot)) {
            await dbClear(st);
            for (const item of rollbackSnapshot[st]) await dbPut(st, item);
          }
          Object.assign(state, rollbackState);
        } catch (rbErr) {
          console.error('Rollback failed:', rbErr);
          throw new Error(`${restoreErr.message}\n\nRollback ALSO failed (${rbErr.message}). Please restore from your most recent JSON backup.`);
        }
        throw new Error(`${restoreErr.message}\n\nYour previous workspace has been restored unchanged.`);
      }
    } else {
      // Map backup doc IDs -> local doc IDs (a filename match keeps the LOCAL id, so PDF binaries and local constructs stay attached)
      const mergeDocIdMap = {};
      for (const rawD of data.docs) {
        const d = normalizeDoc(rawD);
        const existing = state.docs.find(x => x.id === d.id) ||
          state.docs.find(x => x.name && d.name && x.name.toLowerCase() === d.name.toLowerCase());
        if (existing) {
          const keepId = existing.id;
          const keepBinary = existing.hasBinary;
          const keepOrder = existing.order;
          Object.assign(existing, d, { id: keepId, hasBinary: keepBinary, order: keepOrder });
          mergeDocIdMap[d.id] = keepId;
          await dbPut('docs', existing);
        } else {
          d.hasBinary = false;
          d.order = state.docs.length;
          mergeDocIdMap[d.id] = d.id;
          await dbPut('docs', d);
          state.docs.push(d);
        }
      }
      for (const rawA of data.annotations) {
        if (rawA && mergeDocIdMap[rawA.docId]) rawA.docId = mergeDocIdMap[rawA.docId];
        const a = normalizeAnnotation(rawA);
        await dbPut('annotations', a);
        const idx = state.annotations.findIndex(x => x.id === a.id);
        if (idx >= 0) state.annotations[idx] = a;
        else state.annotations.push(a);
      }
      for (const rawC of (data.clusters || [])) {
        const c = normalizeCluster(rawC);
        await dbPut('clusters', c);
        const idx = state.clusters.findIndex(x => x.id === c.id);
        if (idx >= 0) state.clusters[idx] = c;
        else state.clusters.push(c);
      }
      for (const l of (data.logs || [])) {
        await dbPut('logs', l);
        if (!state.logs.find(x => x.id === l.id)) state.logs.push(l);
      }
    }

    if (incomingProjCode) {
      state.projectCode = incomingProjCode;
      localStorage.setItem('me_project_code', incomingProjCode);
    }
    if (data.loa) {
      state.loa = { projectCode: state.projectCode || '', aim: '', ...state.loa, ...data.loa, id: 'loa_main' };
      await dbPut('meta', state.loa);
    }
    populateLoaInputs();
    updateHeaderProjectUI();

    state.docs.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    state.logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    updateAuditBadge();
    renderStudyList();
    state.activeDocId = state.docs[0]?.id || null;
    if (state.activeDocId) {
      await switchStudy(state.activeDocId);
    } else {
      renderWelcomeGuideIfNeeded();
      updateDocHeaderUI();
      updateSidebar();
    }
    renderMatrixView();
    alert(replaceCleanly ? 'Backup cleanly restored!' : 'Backup merged successfully!');
  } catch (err) {
    alert('Failed to restore JSON: ' + err.message);
  }
  e.target.value = '';
});

document.getElementById('resetProjectBtn').addEventListener('click', async () => {
  const ok = confirm(
    'Reset Project (Start Blank):\n\n' +
    'Are you sure you want to clear all studies, PDFs, constructs, matrix rows, and audit logs?\n' +
    '(Tip: Use "Backup" first if you want to save your current project as a JSON file.)'
  );
  if (!ok) return;

  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }
  if (state.activePdfDoc) {
    try { await state.activePdfDoc.destroy(); } catch (e) {}
    state.activePdfDoc = null;
  }

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
  localStorage.removeItem('me_project_code');
  state.loa = { id: 'loa_main', projectCode: '', aim: '', title: '', flow: '', narrative: '', relateProcess: '', relateOutcome: '', synthStudies: '', appraisalPolicy: '', appraisalUse: '', links: [], updatedAt: null };
  state.activeDocId = null;
  state.clusterActiveTabs = {};
  state.peerComparison = null;

  populateLoaInputs();
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
