// Meta-Ethnography Canvas — App shell
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// Reviewer / project setup, startup (loads the project from IndexedDB), welcome guide, main tabs, settings menu, global PDF drag & drop.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// REVIEWER MANAGEMENT (Individual & Bulk Reassign)
// ========================================================
async function promptReassignItemReviewer(item, storeName, refreshFn) {
  const currentRev = item.by || item.reviewer || state.reviewerId || 'Reviewer';
  const nextRev = prompt(`Change Reviewer ID for this item (currently @${currentRev}):`, state.reviewerId || currentRev);
  if (nextRev === null) return;
  const clean = nextRev.trim();
  if (!clean || clean === currentRev) return;

  if (storeName === 'logs') {
    item.reviewer = clean;
  } else {
    item.by = clean;
  }
  await dbPut(storeName, item);
  // Attribution is part of the audit trail: a change of who made an entry is itself recorded
  const what = storeName === 'logs'
    ? `audit trail entry "${item.action || ''}" (${new Date(item.timestamp).toLocaleString()})`
    : storeName === 'clusters'
      ? `3rd Order row "${item.thirdOrderTitle || '(Untitled Row)'}"`
      : `${item.type === 'first_order' ? '1st Order Quote' : '2nd Order Construct'} in ${getDisplayName(state.docs.find(d => d.id === item.docId))} (p.${item.page}): ${item.note || '"' + String(item.text || '').slice(0, 60) + '…"'}`;
  await recordAuditLog({
    category: 'audit_edit',
    action: 'Changed the reviewer attributed to an item',
    detail: `The ${what} is now attributed to @${clean}.`,
    fromVal: '@' + currentRev,
    toVal: '@' + clean,
    clusterIds: storeName === 'clusters' ? [item.id] : (storeName === 'logs' ? item.clusterIds : (item.type === 'second_order' ? liveClusterIds(item) : null))
  });
  if (refreshFn) refreshFn();
}

function sanitizeProjectCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '-');
}

function updateHeaderProjectUI() {
  const codeLabel = document.getElementById('headerProjectCodeLabel');
  const setupBtn = document.getElementById('projectSetupBadgeBtn');
  if (codeLabel) {
    codeLabel.textContent = state.projectCode || 'SET-PROJECT';
  }
  if (setupBtn) {
    if (state.loa && state.loa.aim && state.loa.aim.trim()) {
      setupBtn.title = `Phase 1 Aim: ${state.loa.aim.trim()}\n(Click to edit Project Code & Aim)`;
    } else {
      setupBtn.title = `Phase 1 Aim not set\n(Click to edit Project Code & Aim)`;
    }
  }
}

function openProjectSetupModal({ isInitialOrReset = false, titleText = 'Project Setup & Phase 1 (Getting Started)' } = {}) {
  const revInput = document.getElementById('reviewerIdInput');
  const modal = document.getElementById('reviewerLoginModal');
  const titleEl = document.getElementById('setupModalTitle');
  const closeBtn = document.getElementById('closeSetupModalBtn');
  const initRevInput = document.getElementById('initialReviewerInput');
  const initProjInput = document.getElementById('initialProjectCodeInput');
  const initAimInput = document.getElementById('initialPhase1AimInput');
  const errEl = document.getElementById('initialReviewerError');
  const confirmBtn = document.getElementById('confirmReviewerLoginBtn');

  titleEl.textContent = titleText;
  closeBtn.classList.toggle('hidden', isInitialOrReset);
  errEl.classList.add('hidden');

  initRevInput.value = state.reviewerId || '';
  initProjInput.value = state.projectCode || '';
  initAimInput.value = (state.loa && state.loa.aim) ? state.loa.aim : '';
  const initQInput = document.getElementById('initialReviewQuestionInput');
  if (initQInput) initQInput.value = (state.loa && state.loa.reviewQuestion) || '';

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => {
    if (!initRevInput.value) initRevInput.focus();
    else if (!initProjInput.value) initProjInput.focus();
    else initAimInput.focus();
  }, 50);

  closeBtn.onclick = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  };

  const submitSetup = async () => {
    const revVal = initRevInput.value.trim();
    const projVal = sanitizeProjectCode(initProjInput.value);
    const aimVal = initAimInput.value.trim();
    const qVal = (document.getElementById('initialReviewQuestionInput')?.value || '').trim();
    const prevQ = (state.loa && state.loa.reviewQuestion) || '';

    if (!revVal || !projVal) {
      errEl.classList.remove('hidden');
      if (!revVal) initRevInput.focus();
      else initProjInput.focus();
      return;
    }
    errEl.classList.add('hidden');

    const prevProj = state.projectCode;
    const prevAim = (state.loa && state.loa.aim) || '';

    state.reviewerId = revVal;
    state.projectCode = projVal;
    lsSet('me_reviewer_id', revVal);
    lsSet('me_project_code', projVal);
    if (revInput) revInput.value = revVal;

    state.loa = {
      ...state.loa,
      id: 'loa_main',
      projectCode: projVal,
      aim: aimVal,
      reviewQuestion: qVal,
      updatedAt: Date.now()
    };
    await dbPut('meta', state.loa);
    populateLoaInputs();
    updateHeaderProjectUI();

    if (prevAim !== aimVal || prevQ !== qVal || (prevProj && prevProj !== projVal)) {
      await recordAuditLog({
        category: 'aim_question',
        action: `Configured Project [${projVal}] & Phase 1 Research Aim`,
        detail: (aimVal ? `Phase 1 Aim: ${aimVal}` : 'Project code configured (Phase 1 Aim left blank).') + (qVal ? `\nReview question: ${qVal}` : ''),
        fromVal: prevProj ? `[${prevProj}] ${prevAim.slice(0, 60)}` : '(Initial Setup)',
        toVal: `[${projVal}] ${aimVal.slice(0, 60)}`
      });
    }

    modal.classList.add('hidden');
    modal.classList.remove('flex');
  };

  confirmBtn.onclick = submitSetup;
  const handleEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitSetup();
    }
  };
  initRevInput.onkeydown = handleEnter;
  initProjInput.onkeydown = handleEnter;
}

function ensureInitialReviewerLogin() {
  const savedRev = (lsGet('me_reviewer_id') || '').trim();
  const savedProj = sanitizeProjectCode(lsGet('me_project_code') || '');
  const revInput = document.getElementById('reviewerIdInput');

  if (savedRev) {
    state.reviewerId = savedRev;
    if (revInput) revInput.value = savedRev;
  }
  if (savedProj) {
    state.projectCode = savedProj;
  }
  updateHeaderProjectUI();

  if (!savedRev || !savedProj) {
    openProjectSetupModal({
      isInitialOrReset: true,
      titleText: 'Welcome! Project Setup & Phase 1 (Getting Started)'
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-mec="version"]').forEach(el => { if (window.ME_CANVAS && window.ME_CANVAS.version) el.textContent = window.ME_CANVAS.version; });
  const revInput = document.getElementById('reviewerIdInput');
  // Ask the browser to keep IndexedDB data (prevents automatic eviction, e.g. Safari's 7-day rule)
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!already) {
        const granted = await navigator.storage.persist();
        if (!granted) console.warn('Persistent storage was not granted; keep regular JSON backups.');
      }
    }
  } catch (e) { console.warn('storage.persist() unavailable:', e); }
  if (DEMO_MODE) await seedDemoIfEmpty();
  ensureInitialReviewerLogin();

  const teamToggle = document.getElementById('teamModeToggle');
  teamToggle.checked = state.teamMode;
  teamToggle.addEventListener('change', () => {
    state.teamMode = teamToggle.checked;
    lsSet('me_team_mode', String(state.teamMode));
    updateSidebar();
    if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  });

  const minorOpsToggle = document.getElementById('logMinorOpsToggle');
  minorOpsToggle.checked = state.logMinorOps;
  minorOpsToggle.addEventListener('change', () => {
    state.logMinorOps = minorOpsToggle.checked;
    lsSet('me_log_minor_ops', String(state.logMinorOps));
  });

  // Smart Reviewer ID change: if changed on blur/change, offer to bulk-reassign previous reviewer's items
  revInput.addEventListener('change', async () => {
    const oldRev = state.reviewerId || 'Reviewer';
    const nextRev = revInput.value.trim() || oldRev;
    revInput.value = nextRev;
    if (nextRev === oldRev) return;

    state.reviewerId = nextRev;
    lsSet('me_reviewer_id', nextRev);

    const existingCount = state.annotations.filter(a => a.by === oldRev).length +
                          state.clusters.filter(c => c.by === oldRev).length;
    if (existingCount > 0) {
      const doBulk = confirm(
        `Reviewer ID changed from @${oldRev} to @${nextRev}.\n\n` +
        `Would you also like to bulk-update your ${existingCount} existing constructs and rows from @${oldRev} to @${nextRev}?\n` +
        `(Click [OK] to update all @${oldRev} items, or [Cancel] to only use @${nextRev} for new extractions)`
      );
      if (doBulk) {
        for (const a of state.annotations) {
          if (a.by === oldRev) { a.by = nextRev; await dbPut('annotations', a); }
        }
        for (const c of state.clusters) {
          if (c.by === oldRev) { c.by = nextRev; await dbPut('clusters', c); }
        }
        for (const l of state.logs) {
          if (l.reviewer === oldRev) { l.reviewer = nextRev; await dbPut('logs', l); }
        }
        updateSidebar();
        if (!divMatrix.classList.contains('hidden')) renderMatrixView();
        if (!divAudit.classList.contains('hidden')) renderAuditView();
      }
    }
  });

  const rawDocs = await dbGetAll('docs');
  state.docs = rawDocs.map(normalizeDoc).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const rawAnnos = await dbGetAll('annotations');
  state.annotations = rawAnnos.map(normalizeAnnotation);
  const rawClusters = await dbGetAll('clusters');
  state.clusters = rawClusters.map(normalizeCluster).sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
  state.logs = await dbGetAll('logs');
  state.logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const metaItems = await dbGetAll('meta');
  const savedLoa = metaItems.find(m => m.id === 'loa_main');
  if (savedLoa) {
    state.loa = { projectCode: '', aim: '', ...savedLoa };
    if (savedLoa.projectCode && !state.projectCode) {
      state.projectCode = sanitizeProjectCode(savedLoa.projectCode);
      lsSet('me_project_code', state.projectCode);
    }
  }
  populateLoaInputs();
  updateHeaderProjectUI();
  if (state.docs.length && !state.loa.baselineDocId) await checkBaselineChange(); // remember study #1 (projects made before it was stored)
  setTimeout(() => ensureDocFingerprints(), 4000); // projects made before fingerprints were stored: one PDF at a time, after start-up

  document.getElementById('projectSetupBadgeBtn')?.addEventListener('click', () => {
    openProjectSetupModal({
      isInitialOrReset: false,
      titleText: 'Edit Project Code & Phase 1 Research Aim'
    });
  });

  updateAuditBadge();
  updateBackupReminder();
  renderStudyList();
  if (state.docs.length > 0) {
    switchStudy(state.docs[0].id);
  } else {
    renderWelcomeGuideIfNeeded();
    updateSidebar();
  }
  flashSaveStatus('saved');
});

function renderWelcomeGuideIfNeeded() {
  const wrapper = document.getElementById('pdfPagesWrapper');
  if (!wrapper) return;
  if (state.docs.length > 0 && state.activeDocId) return;
  wrapper.innerHTML = `
    <div class="my-8 max-w-2xl w-full bg-white rounded-2xl shadow-md border border-slate-200 p-6 text-slate-800 select-none">
      <div class="flex items-center space-x-3 pb-4 border-b border-slate-100">
        <div class="bg-indigo-600 text-white p-2.5 rounded-xl shadow-sm"><i class="ph ph-book-open-text text-2xl"></i></div>
        <div>
          <h2 class="text-base font-bold text-slate-900">Welcome to Meta-Ethnography Canvas</h2>
          <p class="text-xs text-slate-500">Reporting outputs structured around the <b>eMERGe reporting guidance</b> (a reporting guide — not a guide to conducting the synthesis).</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 my-5">
        <div class="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold uppercase tracking-wider bg-indigo-600 text-white px-2 py-0.5 rounded">Step 1</span>
            <i class="ph ph-file-pdf text-lg text-indigo-600"></i>
          </div>
          <div class="text-xs font-bold text-slate-800">Add Primary Studies</div>
          <p class="text-[13px] text-slate-600 leading-relaxed">Click <b>"+ Add PDF"</b> or drop PDFs anywhere. <b>Study #1 is where translation starts</b> — an index paper, or the earliest study if you translate chronologically (set "Order" in the study list; drag to reorder).</p>
        </div>

        <div class="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-100 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold uppercase tracking-wider bg-emerald-600 text-white px-2 py-0.5 rounded">Step 2</span>
            <i class="ph ph-highlighter-circle text-lg text-emerald-600"></i>
          </div>
          <div class="text-xs font-bold text-slate-800">Extract 1st & 2nd Order</div>
          <p class="text-[13px] text-slate-600 leading-relaxed">Select text in the PDF and press <kbd class="px-1 py-0.2 bg-white border rounded text-xs font-mono">1</kbd> for Participant Quotes (🟦) or <kbd class="px-1 py-0.2 bg-white border rounded text-xs font-mono">2</kbd> for Author Interpretations (🟩).</p>
        </div>

        <div class="p-3.5 rounded-xl bg-purple-50/60 border border-purple-100 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold uppercase tracking-wider bg-purple-600 text-white px-2 py-0.5 rounded">Step 3</span>
            <i class="ph ph-table text-lg text-purple-600"></i>
          </div>
          <div class="text-xs font-bold text-slate-800">Translate & Synthesize</div>
          <p class="text-[13px] text-slate-600 leading-relaxed">Open Tab 2 (<b>Matrix</b>) to group 2nd Order concepts into <b>3rd Order Themes</b> across studies.</p>
        </div>
      </div>

      <div class="bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-[13px] text-slate-600 space-y-1">
        <div class="font-bold text-slate-700 flex items-center space-x-1"><i class="ph ph-sparkle text-indigo-600"></i><span>Quick Tips:</span></div>
        <div>• <b>Fix PDF Text & Line Breaks:</b> Click <span class="text-indigo-700 font-semibold">✏️ Edit Quote</span> (or double-click any quote) to clean up line breaks, headers, or insert <code>[...]</code>.</div>
        <div>• <b>Easy Quote Linking:</b> Link 1st Order quotes to 2nd Order constructs either by <b>dragging</b> OR by using the <b>🔗 Link to 2nd Order...</b> dropdown on each quote card.</div>
        <div>• <b>Bird's-Eye Matrix Overview:</b> Toggle <b>🔭 Compact View</b> in Tab 2 to collapse long quotes and view 15+ studies at a glance.</div>
      </div>

      <div class="mt-5 flex items-center justify-center space-x-3">
        <button type="button" id="welcomeSelectPdfBtn" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow cursor-pointer flex items-center space-x-1.5 transition">
          <i class="ph ph-plus-circle text-base"></i><span>Select PDF Files to Begin</span>
        </button>
        <button type="button" id="welcomeRestoreJsonBtn" class="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg cursor-pointer flex items-center space-x-1.5 transition">
          <i class="ph ph-upload-simple text-base"></i><span>Restore Project (.json)</span>
        </button>
      </div>
    </div>
  `;
  // No inline onclick: the Content-Security-Policy blocks inline handlers
  document.getElementById('welcomeSelectPdfBtn').addEventListener('click', () => document.getElementById('pdfFileInput').click());
  document.getElementById('welcomeRestoreJsonBtn').addEventListener('click', () => document.getElementById('jsonFileInput').click());
}

// ========================================================
// VIEW TOGGLES (4 Tabs)
// ========================================================
const vExtract = document.getElementById('viewExtractBtn');
const vMatrix = document.getElementById('viewMatrixBtn');
const vAudit = document.getElementById('viewAuditBtn');
const vPub = document.getElementById('viewPubBtn');

const divExtract = document.getElementById('extractView');
const divMatrix = document.getElementById('matrixView');
const divAudit = document.getElementById('auditView');
const divPub = document.getElementById('pubView');

function setActiveTab(tab) {
  // Pending text commits change the state at once, but their audit entries arrive a moment later:
  // render now, and once more when they are written, so the Audit Trail and Tab 4 never show the trail without them.
  const flushed = flushAllPendingSaves();
  if (flushed) flushed.then(() => {
    if (tab === 'audit' && !divAudit.classList.contains('hidden')) renderAuditView();
    if (tab === 'pub' && !divPub.classList.contains('hidden')) renderPublicationView();
  });
  const activeCls = "px-2.5 py-1.5 text-xs font-bold rounded-md bg-white text-indigo-700 shadow-sm cursor-pointer transition flex items-center space-x-1.5";
  const inactiveCls = "px-2.5 py-1.5 text-xs font-medium rounded-md text-slate-500 hover:text-slate-800 cursor-pointer transition flex items-center space-x-1.5";
  
  vExtract.className = tab === 'extract' ? activeCls : inactiveCls;
  vMatrix.className = tab === 'matrix' ? activeCls : inactiveCls;
  vAudit.className = tab === 'audit' ? activeCls : inactiveCls;
  vPub.className = tab === 'pub' ? activeCls : inactiveCls;

  divExtract.classList.toggle('hidden', tab !== 'extract');
  divMatrix.classList.toggle('hidden', tab !== 'matrix');
  divMatrix.classList.toggle('flex', tab === 'matrix');
  divAudit.classList.toggle('hidden', tab !== 'audit');
  divAudit.classList.toggle('flex', tab === 'audit');
  divPub.classList.toggle('hidden', tab !== 'pub');
  divPub.classList.toggle('flex', tab === 'pub');

  if (tab === 'matrix') renderMatrixView();
  if (tab === 'audit') renderAuditView();
  if (tab === 'pub') renderPublicationView();
}

vExtract.addEventListener('click', () => setActiveTab('extract'));
vMatrix.addEventListener('click', () => setActiveTab('matrix'));
vAudit.addEventListener('click', () => setActiveTab('audit'));
vPub.addEventListener('click', () => setActiveTab('pub'));

// ========================================================
// SETTINGS DROPDOWN & SNACKBAR
// ========================================================
const settingsBtn = document.getElementById('settingsMenuBtn');
const settingsDropdown = document.getElementById('settingsDropdown');
if(settingsBtn && settingsDropdown) {
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsDropdown.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!settingsBtn.contains(e.target) && !settingsDropdown.contains(e.target)) {
      settingsDropdown.classList.add('hidden');
    }
  });
}

// ========================================================
// GLOBAL FILE DRAG & DROP OVERLAY
// ========================================================
const ov = document.getElementById('dropOverlay');
window.ondragenter = e => {
  if (!compareModal.classList.contains('hidden')) return;
  if (e.dataTransfer.types.includes('Files')) {
    e.preventDefault();
    ov.classList.add('active');
  }
};
window.ondragleave = e => {
  if (e.dataTransfer.types.includes('Files') && !e.relatedTarget) {
    e.preventDefault();
    ov.classList.remove('active');
  }
};
window.ondragover = e => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
};
window.ondrop = async e => {
  if (!compareModal.classList.contains('hidden')) return;
  if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length) {
    e.preventDefault();
    ov.classList.remove('active');
    const pdfs = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length > 0) await handleFiles(pdfs);
  }
};

// ========================================================
// SAFETY & ACCESSIBILITY HELPERS
// ========================================================
// ---- Same project open in two tabs: writes would silently overwrite each other, so warn in both tabs ----
(function watchOtherTabs() {
  if (!('BroadcastChannel' in window)) return;
  const banner = document.getElementById('multiTabBanner');
  if (!banner) return;
  const ch = new BroadcastChannel('mec-tabs-' + DB_NAME);
  const me = Math.random().toString(36).slice(2);
  const others = new Set();
  const refresh = () => { banner.classList.toggle('hidden', others.size === 0); banner.classList.toggle('flex', others.size > 0); };
  ch.onmessage = e => {
    const m = e.data;
    if (!m || m.from === me) return;
    if (m.type === 'hello') { others.add(m.from); ch.postMessage({ type: 'present', from: me }); }
    else if (m.type === 'present') others.add(m.from);
    else if (m.type === 'bye') others.delete(m.from);
    refresh();
  };
  ch.postMessage({ type: 'hello', from: me });
  window.addEventListener('pagehide', () => { try { ch.postMessage({ type: 'bye', from: me }); } catch (err) { /* channel closed */ } });
  document.getElementById('multiTabDismissBtn')?.addEventListener('click', () => { banner.classList.add('hidden'); banner.classList.remove('flex'); });
})();

// ---- Modals: Esc closes (except the required Reviewer ID dialog), focus moves in and returns, Tab stays inside ----
(function modalAccessibility() {
  const CLOSE_BTN = { compareModal: 'closeCompareModalBtn', richTieModal: 'richTieCloseBtn', missingPdfModal: 'missingPdfCloseBtn', refutMapModal: 'refutMapCloseBtn', seedChoiceModal: 'seedChoiceCloseBtn', rowOpsModal: 'rowOpsCloseBtn' };
  const MODALS = ['compareModal', 'richTieModal', 'missingPdfModal', 'refutMapModal', 'seedChoiceModal', 'rowOpsModal', 'reviewerLoginModal'];
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const returnTo = {};
  const visible = id => { const m = document.getElementById(id); return m && !m.classList.contains('hidden') ? m : null; };
  MODALS.forEach(id => {
    const m = document.getElementById(id);
    if (!m) return;
    let wasOpen = !m.classList.contains('hidden');
    new MutationObserver(() => {
      const open = !m.classList.contains('hidden');
      if (open && !wasOpen) {
        returnTo[id] = document.activeElement;
        const first = Array.from(m.querySelectorAll(FOCUSABLE)).find(el => el.offsetParent !== null);
        if (first) setTimeout(() => first.focus(), 0);
      } else if (!open && wasOpen && returnTo[id] && document.contains(returnTo[id])) {
        try { returnTo[id].focus(); } catch (err) { /* element gone */ }
      }
      wasOpen = open;
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
  });
  document.addEventListener('keydown', e => {
    const openId = MODALS.slice().reverse().find(visible);
    if (!openId) return;
    if (e.key === 'Escape' && CLOSE_BTN[openId]) { e.preventDefault(); document.getElementById(CLOSE_BTN[openId])?.click(); return; }
    if (e.key === 'Tab') {
      const items = Array.from(document.getElementById(openId).querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (!items.includes(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
})();

// ---- Icon-only buttons get an accessible name from their tooltip ----
(function labelIconButtons() {
  const label = root => {
    const btns = root.matches && root.matches('button') ? [root] : [];
    root.querySelectorAll && root.querySelectorAll('button:not([aria-label])').forEach(b => btns.push(b));
    btns.forEach(b => {
      if (b.hasAttribute('aria-label')) return;
      const hasText = (b.textContent || '').replace(/\s+/g, '').length > 0;
      if (!hasText && b.title) b.setAttribute('aria-label', b.title);
    });
  };
  label(document.body);
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) label(n); })))
    .observe(document.body, { childList: true, subtree: true });
})();

// ---- Long-text boxes grow with what is typed (up to 60% of the window height; then they scroll) ----
(function autoGrowTextareas() {
  const queue = new Set();
  let scheduled = false;
  // Sizes many boxes in 3 layout passes (read, write, read, write) instead of one pass per box
  const growMany = els => {
    const live = els.filter(el => el.isConnected && el.getClientRects().length > 0); // hidden boxes are measured when they become visible
    const fresh = live.filter(el => el._minH === undefined);
    fresh.forEach(el => { el._minH = el.offsetHeight; });                              // read
    fresh.forEach(el => { el.style.minHeight = el._minH + 'px'; el.classList.add('auto-grow'); }); // write
    live.forEach(el => { el.style.height = 'auto'; });                                   // write
    const sizes = live.map(el => el.scrollHeight + el.offsetHeight - el.clientHeight);   // read
    live.forEach((el, i) => { el.style.height = sizes[i] + 'px'; });                     // write
  };
  const flush = () => { scheduled = false; const els = Array.from(queue); queue.clear(); growMany(els); };
  const schedule = el => { queue.add(el); if (!scheduled) { scheduled = true; requestAnimationFrame(flush); } };
  const visibility = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) schedule(e.target); }));
  const widths = new ResizeObserver(entries => entries.forEach(e => { // only a change of width re-wraps the text
    const w = Math.round(e.contentRect.width);
    if (e.target._lastW !== w) { e.target._lastW = w; schedule(e.target); }
  }));
  const init = el => {
    if (el._autoGrow) return;
    el._autoGrow = true;
    visibility.observe(el);
    widths.observe(el);
    schedule(el);
  };
  const initIn = root => {
    if (root.nodeType !== 1) return;
    // .lazy-grow boxes (e.g. the many audit-trail reason boxes) start growing only once they are focused
    if (root.tagName === 'TEXTAREA' && !root.classList.contains('lazy-grow')) init(root);
    root.querySelectorAll && root.querySelectorAll('textarea:not(.lazy-grow)').forEach(init);
  };
  document.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') { init(e.target); schedule(e.target); } });
  document.addEventListener('focusin', e => { if (e.target.tagName === 'TEXTAREA') { init(e.target); schedule(e.target); } });
  initIn(document.body);
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(initIn))).observe(document.body, { childList: true, subtree: true });
  // Called by the matrix right after it builds rows, so row heights are final before the scroll position is fixed
  window.growTextareasNow = root => growMany(Array.from(root.querySelectorAll('textarea')));
})();
