// Meta-Ethnography Canvas — Compare & merge
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// Loading another reviewer's JSON, matching constructs, resolving differences, merging rows, models and logs.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// REVIEWER JSON DIFF & MERGE ENGINE (RESOLUTION MODE)
// ========================================================
const compareModal = document.getElementById('compareModal');
const compareEmptyState = document.getElementById('compareEmptyState');
const compareWorkspace = document.getElementById('compareWorkspace');

document.getElementById('compareJsonModalBtn').addEventListener('click', () => {
  compareModal.classList.remove('hidden');
  compareModal.classList.add('flex');
});
document.getElementById('closeCompareModalBtn').addEventListener('click', () => {
  compareModal.classList.add('hidden');
  compareModal.classList.remove('flex');
});

document.getElementById('loadPeerJsonBtn').addEventListener('click', () => document.getElementById('peerJsonFileInput').click());
document.getElementById('peerDropArea').addEventListener('click', () => document.getElementById('peerJsonFileInput').click());

const peerDropArea = document.getElementById('peerDropArea');
peerDropArea.addEventListener('dragover', e => { e.preventDefault(); peerDropArea.classList.add('bg-teal-100'); });
peerDropArea.addEventListener('dragleave', () => peerDropArea.classList.remove('bg-teal-100'));
peerDropArea.addEventListener('drop', async e => {
  e.preventDefault();
  peerDropArea.classList.remove('bg-teal-100');
  if (e.dataTransfer.files.length > 0) await processPeerJsonFile(e.dataTransfer.files[0]);
});

document.getElementById('peerJsonFileInput').addEventListener('change', async e => {
  if (e.target.files.length > 0) await processPeerJsonFile(e.target.files[0]);
  e.target.value = '';
});

function computeTextSimilarity(strA, strB) {
  const clean = s => String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const a = clean(strA);
  const b = clean(strB);
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) {
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    if (minLen > 12) return Math.max(0.78, minLen / maxLen);
  }
  // Word token overlap (including 2-char clinical/regional abbreviations like GP, UK, IV, ED)
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length >= 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length >= 2));
  let wordScore = 0;
  if (wordsA.size > 0 && wordsB.size > 0) {
    let inter = 0;
    wordsA.forEach(w => { if (wordsB.has(w)) inter++; });
    wordScore = inter / Math.min(wordsA.size, wordsB.size);
  }
  // Character bigram overlap (handles CJK/Japanese text without spaces and minor OCR/hyphenation diffs)
  const noSpaceA = a.replace(/\s+/g, '');
  const noSpaceB = b.replace(/\s+/g, '');
  let bigramScore = 0;
  if (noSpaceA.length >= 2 && noSpaceB.length >= 2) {
    const bgA = new Set();
    const bgB = new Set();
    for (let i = 0; i < noSpaceA.length - 1; i++) bgA.add(noSpaceA.slice(i, i + 2));
    for (let i = 0; i < noSpaceB.length - 1; i++) bgB.add(noSpaceB.slice(i, i + 2));
    let bgInter = 0;
    bgA.forEach(g => { if (bgB.has(g)) bgInter++; });
    // Dice coefficient: normalising by the shorter string alone let short fragments "match" unrelated long quotes
    bigramScore = (2 * bgInter) / (bgA.size + bgB.size);
  }
  return Math.max(wordScore, bigramScore);
}

async function processPeerJsonFile(file) {
  try {
    const text = await file.text();
    const peerData = JSON.parse(text);
    if (!peerData.docs || !peerData.annotations) throw new Error('Invalid Reviewer JSON file.');

    const incomingProjCode = sanitizeProjectCode(peerData.projectCode || peerData.loa?.projectCode || '');
    const currentProjCode = sanitizeProjectCode(state.projectCode || '');
    if (currentProjCode && incomingProjCode && currentProjCode !== incomingProjCode) {
      const proceed = confirm(
        `⚠️ PROJECT CODE MISMATCH DETECTED!\n\n` +
        `• Current Workspace Project Code: [${currentProjCode}]\n` +
        `• Peer JSON File Project Code: [${incomingProjCode}]\n\n` +
        `Are you sure you didn't select a JSON file from a different systematic review project?\n` +
        `Click [OK] ONLY if you intentionally want to compare these two projects, or [Cancel] to abort safely.`
      );
      if (!proceed) return;
    } else if (currentProjCode && !incomingProjCode) {
      const proceed = confirm(
        `⚠️ Notice: The selected Peer JSON file does not have a Project Code tag, while your workspace is set to [${currentProjCode}].\n\n` +
        `Continue comparing with this file?`
      );
      if (!proceed) return;
    }

    const peerReviewer = peerData.reviewerId ||
      (peerData.annotations.find(a => a.by)?.by) ||
      (peerData.logs?.find(l => l.reviewer)?.reviewer) || 'Peer';

    // 1. Match Documents
    const docMapPeerToLocal = {};
    const matchedStudies = [];
    const unmatchedPeerDocs = [];

    peerData.docs.forEach(pDoc => {
      const localMatch = state.docs.find(lDoc =>
        lDoc.id === pDoc.id ||
        (lDoc.name && pDoc.name && lDoc.name.toLowerCase() === pDoc.name.toLowerCase()) ||
        (lDoc.title && pDoc.title && lDoc.title.toLowerCase().trim() === pDoc.title.toLowerCase().trim()) ||
        (lDoc.author && pDoc.author && lDoc.year && pDoc.year &&
         lDoc.author.toLowerCase() === pDoc.author.toLowerCase() && lDoc.year === pDoc.year)
      );
      if (localMatch) {
        docMapPeerToLocal[pDoc.id] = localMatch.id;
        matchedStudies.push({ localDoc: localMatch, peerDoc: pDoc });
      } else {
        unmatchedPeerDocs.push(pDoc);
      }
    });

    // 2. Match Annotations (1st & 2nd order)
    const matchedPairs = [];
    const peerOnlyAnnos = [];
    const usedLocalIds = new Set();

    peerData.annotations.forEach(pAnno => {
      const mappedLocalDocId = docMapPeerToLocal[pAnno.docId];
      if (!mappedLocalDocId) {
        peerOnlyAnnos.push({ peerAnno: pAnno, localDocId: null, peerDoc: peerData.docs.find(d => d.id === pAnno.docId) });
        return;
      }

      const candidates = state.annotations.filter(lAnno =>
        lAnno.docId === mappedLocalDocId &&
        lAnno.type === pAnno.type &&
        !usedLocalIds.has(lAnno.id)
      );

      let bestMatch = null;
      let bestScore = 0;

      candidates.forEach(cand => {
        if (cand.id === pAnno.id) {
          bestScore = 1.0;
          bestMatch = cand;
          return;
        }
        const pageBonus = (cand.page === pAnno.page) ? 0.1 : 0;
        const sim = computeTextSimilarity(cand.text, pAnno.text) + pageBonus;
        if (sim > bestScore) {
          bestScore = sim;
          bestMatch = cand;
        }
      });

      if (bestMatch && bestScore >= 0.55) {
        usedLocalIds.add(bestMatch.id);
        matchedPairs.push({
          localAnno: bestMatch,
          peerAnno: pAnno,
          similarity: Math.min(100, Math.round(bestScore * 100)),
          doc: state.docs.find(d => d.id === mappedLocalDocId)
        });
      } else {
        peerOnlyAnnos.push({
          peerAnno: pAnno,
          localDocId: mappedLocalDocId,
          doc: state.docs.find(d => d.id === mappedLocalDocId),
          peerDoc: peerData.docs.find(d => d.id === pAnno.docId)
        });
      }
    });

    const localOnlyAnnos = state.annotations.filter(lAnno => !usedLocalIds.has(lAnno.id));

    state.peerComparison = {
      peerReviewer,
      peerData,
      docMapPeerToLocal,
      matchedStudies,
      unmatchedPeerDocs,
      matchedPairs,
      peerOnlyAnnos,
      localOnlyAnnos
    };

    state.teamMode = true;
    localStorage.setItem('me_team_mode', 'true');
    const teamToggle = document.getElementById('teamModeToggle');
    if (teamToggle) teamToggle.checked = true;
    updateSidebar();

    compareEmptyState.classList.add('hidden');
    compareWorkspace.classList.remove('hidden');
    compareWorkspace.classList.add('flex');
    renderComparisonDashboard();
  } catch (err) {
    alert('Error comparing JSON: ' + err.message);
  }
}

document.querySelectorAll('.cmp-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeCompareTab = btn.dataset.cmptab;
    document.querySelectorAll('.cmp-tab-btn').forEach(b => {
      b.className = b.dataset.cmptab === state.activeCompareTab
        ? "cmp-tab-btn px-3 py-1 text-xs font-bold rounded bg-white text-teal-800 shadow-sm cursor-pointer"
        : "cmp-tab-btn px-3 py-1 text-xs font-medium rounded text-slate-600 hover:text-slate-900 cursor-pointer";
    });
    renderComparisonTabContent();
  });
});

function getCompareBuckets(cmp) {
  const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const divergent = [];
  const aligned = [];
  cmp.matchedPairs.forEach(pair => {
    const l = pair.localAnno, p = pair.peerAnno;
    const labelsDiffer = norm(l.note) && norm(p.note) && norm(l.note) !== norm(p.note);
    const flagged = l.concordanceStatus === 'discuss' || p.concordanceStatus === 'discuss';
    const isAgreed = l.concordanceStatus === 'agreed';
    ((!isAgreed && (labelsDiffer || flagged)) ? divergent : aligned).push(pair);
  });
  return { divergent, aligned, uniqueCount: cmp.peerOnlyAnnos.length + cmp.localOnlyAnnos.length };
}

function setCmpText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderComparisonDashboard() {
  const cmp = state.peerComparison;
  if (!cmp) return;
  const bk = getCompareBuckets(cmp);
  const setDot = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !on); };
  setCmpText('cmpDiscussStat', (bk.divergent.length + bk.uniqueCount) > 0 ? 'Yes — see the marked tabs' : 'None');
  setDot('cntDivergent', bk.divergent.length > 0);
  setDot('cntUnique', bk.uniqueCount > 0);
  renderComparisonTabContent();
}

function renderComparisonTabContent() {
  const container = document.getElementById('compareTabContent');
  container.innerHTML = '';
  const cmp = state.peerComparison;
  if (!cmp) return;

  const renderPeerOnly = () => {
    if (cmp.peerOnlyAnnos.length === 0) {
      container.innerHTML = `<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">🎉 All of @${escapeHtml(cmp.peerReviewer)}'s extracted constructs are either matched or resolved!</div>`;
      return;
    }

    const topAction = document.createElement('div');
    topAction.className = 'flex items-center justify-between bg-teal-50 border border-teal-200 px-4 py-2.5 rounded-xl';
    topAction.innerHTML = `
      <div class="text-xs text-teal-900">
        <b>Resolution Mode:</b> Review constructs extracted by <b>@${escapeHtml(cmp.peerReviewer)}</b> that are not in your local project. Import & Agree, Import for Discussion, or Dismiss.
      </div>
      <button id="importAllPeerBtn" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer">
        + Import All as Agreed
      </button>
    `;
    topAction.querySelector('#importAllPeerBtn').onclick = async () => {
      for (const item of [...cmp.peerOnlyAnnos]) {
        await importPeerConstruct(item, 'agreed');
      }
      renderComparisonDashboard();
    };
    container.appendChild(topAction);

    cmp.peerOnlyAnnos.forEach((item, idx) => {
      const p = item.peerAnno;
      const studyName = item.doc ? getDisplayName(item.doc) : (item.peerDoc ? getDisplayName(item.peerDoc) + ' [Will create Study stub]' : 'Unknown Study');
      const isSec = p.type === 'second_order';
      const card = document.createElement('div');
      card.className = 'bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between gap-4';
      card.innerHTML = `
        <div class="space-y-1.5 flex-1">
          <div class="flex items-center space-x-2 text-xs">
            <span class="font-bold px-2 py-0.5 rounded ${isSec ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">${isSec ? '🟩 2nd Order' : '🟦 1st Order Quote'}</span>
            <span class="font-bold text-slate-800">${escapeHtml(studyName)}</span>
            <span class="text-slate-400">p.${escapeHtml(p.page)}</span>
            <span class="text-xs font-mono bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded">@${escapeHtml(p.by || cmp.peerReviewer)}</span>
          </div>
          ${p.note ? `<div class="text-xs font-bold text-slate-800">Summary Label: ${escapeHtml(p.note)}</div>` : ''}
          <div class="text-xs italic text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">"${escapeHtml(p.text)}"</div>
          ${p.concordanceNote ? `<div class="text-[13px] text-indigo-700">Peer Note: ${escapeHtml(p.concordanceNote)}</div>` : ''}
        </div>
        <div class="flex flex-col space-y-1.5 shrink-0">
          <button class="imp-agree px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-md cursor-pointer flex items-center space-x-1">
            <i class="ph ph-download-simple"></i><span>Import & Agree</span>
          </button>
          <button class="imp-discuss px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-md cursor-pointer flex items-center space-x-1">
            <i class="ph ph-chats-circle"></i><span>Import as Discuss</span>
          </button>
          <button class="imp-dismiss px-3 py-1 bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 text-xs rounded-md cursor-pointer">
            ✕ Dismiss
          </button>
        </div>
      `;
      card.querySelector('.imp-agree').onclick = async () => {
        await importPeerConstruct(item, 'agreed');
        renderComparisonDashboard();
      };
      card.querySelector('.imp-discuss').onclick = async () => {
        await importPeerConstruct(item, 'discuss');
        renderComparisonDashboard();
      };
      card.querySelector('.imp-dismiss').onclick = async () => {
        cmp.peerOnlyAnnos.splice(idx, 1);
        await recordAuditLog({
          category: 'concordance',
          action: `Dismissed Peer-Only Construct from @${cmp.peerReviewer}`,
          detail: `${studyName} (p.${p.page}): "${p.text.slice(0, 70)}..."`
        });
        renderComparisonDashboard();
      };
      container.appendChild(card);
    });
  };

  const renderMatched = (pairs, emptyMsg) => {
    if (pairs.length === 0) {
      container.innerHTML = `<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">${escapeHtml(emptyMsg)}</div>`;
      return;
    }
    pairs.forEach(pair => {
      const l = pair.localAnno;
      const p = pair.peerAnno;
      const dName = pair.doc ? getDisplayName(pair.doc) : 'Study';
      const nm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const labelDiff = !!(nm(l.note) && nm(p.note) && nm(l.note) !== nm(p.note));
      const flaggedDisc = l.concordanceStatus === 'discuss' || p.concordanceStatus === 'discuss';
      const differs = (labelDiff || flaggedDisc) && l.concordanceStatus !== 'agreed';
      const card = document.createElement('div');
      card.className = differs
        ? 'bg-rose-50/50 p-4 rounded-xl border-2 border-rose-300 shadow-sm space-y-2'
        : 'bg-white/70 p-2.5 rounded-lg border border-slate-200 space-y-1 text-slate-500';
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2 text-xs">
            ${differs ? '<span class="bg-rose-600 text-white font-bold px-2 py-0.5 rounded">⚡ Differs</span>' : '<span class="text-slate-400 px-1">✓ Matched</span>'}
            <span class="font-bold text-slate-800">${escapeHtml(dName)} (p.${l.page})</span>
            <span class="text-xs text-slate-500">${l.type === 'second_order' ? '🟩 2nd Order' : '🟦 1st Order'}</span>
          </div>
          <div class="flex items-center space-x-2">
            <button class="mark-agreed-btn px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded cursor-pointer">
              ${l.concordanceStatus === 'agreed' ? '✓ Already Agreed (Adopt Peer Note)' : '✅ Mark Agreed & Merge Note'}
            </button>
          </div>
        </div>
        ${differs ? '' : '<details class="text-xs"><summary class="cursor-pointer text-slate-400">Show both extractions</summary>'}
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div class="p-2.5 rounded bg-indigo-50/40 border border-indigo-200">
            <div class="font-bold text-indigo-900 mb-1">👤 My Extraction (@${escapeHtml(l.by || state.reviewerId)})</div>
            ${l.note ? `<div class="font-semibold mb-1 ${labelDiff ? 'text-rose-800 bg-rose-100 rounded px-1' : 'text-slate-800'}">Label: ${escapeHtml(l.note)}</div>` : ''}
            <div class="italic text-slate-600">"${escapeHtml(l.text)}"</div>
          </div>
          <div class="p-2.5 rounded bg-teal-50/40 border border-teal-200">
            <div class="font-bold text-teal-900 mb-1">🤝 Peer Extraction (@${escapeHtml(p.by || cmp.peerReviewer)})</div>
            ${p.note ? `<div class="font-semibold mb-1 ${labelDiff ? 'text-rose-800 bg-rose-100 rounded px-1' : 'text-slate-800'}">Label: ${escapeHtml(p.note)}</div>` : ''}
            <div class="italic text-slate-600">"${escapeHtml(p.text)}"</div>
          </div>
        </div>
        ${differs ? '' : '</details>'}
      `;
      card.querySelector('.mark-agreed-btn').onclick = async () => {
        l.concordanceStatus = 'agreed';
        if (p.note && !l.note) l.note = p.note;
        else if (p.note && p.note !== l.note && !l.concordanceNote.includes(p.note)) {
          l.concordanceNote = `[Peer @${cmp.peerReviewer} label: ${p.note}] ${l.concordanceNote}`.trim();
        }
        await dbPut('annotations', l);
        await recordAuditLog({
          category: 'concordance',
          action: `Confirmed Inter-Reviewer Agreement with @${cmp.peerReviewer} (${dName}, p.${l.page})`,
          detail: `"${l.text.slice(0, 75)}..."`,
          toVal: 'AGREED'
        });
        updateSidebar();
        renderComparisonDashboard();
      };
      container.appendChild(card);
    });
  };

  const renderLocalOnly = () => {
    if (cmp.localOnlyAnnos.length === 0) {
      container.innerHTML = `<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">No Local-Only constructs!</div>`;
      return;
    }
    cmp.localOnlyAnnos.forEach(l => {
      const doc = state.docs.find(d => d.id === l.docId);
      const card = document.createElement('div');
      card.className = 'bg-white p-3.5 rounded-xl border border-slate-200 flex items-center justify-between gap-4 text-xs';
      card.innerHTML = `
        <div>
          <div class="font-bold text-slate-800">${escapeHtml(getDisplayName(doc))} (p.${l.page}) — <span class="text-indigo-700">${l.type === 'second_order' ? '🟩 2nd Order' : '🟦 1st Order'}</span></div>
          ${l.note ? `<div class="font-semibold text-slate-700 mt-0.5">${escapeHtml(l.note)}</div>` : ''}
          <div class="italic text-slate-500 mt-0.5">"${escapeHtml(l.text)}"</div>
        </div>
        <button class="flag-disc px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold rounded border border-amber-300 shrink-0 cursor-pointer">
          💬 Flag for Discussion
        </button>
      `;
      card.querySelector('.flag-disc').onclick = async () => {
        l.concordanceStatus = 'discuss';
        l.concordanceNote = `Extracted only by @${state.reviewerId} (not in @${cmp.peerReviewer}'s JSON).`;
        await dbPut('annotations', l);
        updateSidebar();
        renderComparisonDashboard();
      };
      container.appendChild(card);
    });
  };

  const tab = state.activeCompareTab;
  const bk = getCompareBuckets(cmp);
  if (tab === 'divergent') {
    renderMatched(bk.divergent, 'No divergent interpretations — matched constructs are aligned.');
  } else if (tab === 'unique') {
    if (cmp.peerOnlyAnnos.length === 0 && cmp.localOnlyAnnos.length === 0) {
      container.innerHTML = `<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">No unique extractions — both reviewers' constructs overlap.</div>`;
    } else {
      if (cmp.peerOnlyAnnos.length > 0) renderPeerOnly();
      if (cmp.localOnlyAnnos.length > 0) renderLocalOnly();
    }
  } else if (tab === 'aligned') {
    renderMatched(bk.aligned, 'No aligned constructs yet.');
  } else if (tab === 'clusters_logs') {
    const peerClusters = cmp.peerData.clusters || [];
    const peerLogs = cmp.peerData.logs || [];

    const box = document.createElement('div');
    box.className = 'space-y-4';
    const peerLoa = cmp.peerData.loa || {};
    const myLinks = getLoaLinks().map(l => ({ from: clusterLabel(state.clusters.find(c => c.id === l.from)), to: clusterLabel(state.clusters.find(c => c.id === l.to)), type: l.type, note: l.note || '' }));
    const peerModel = modelFromPeerLoa(peerLoa, peerClusters, cmp.peerReviewer);
    const myKeys = new Set(myLinks.map(teamLinkKey));
    const peerKeys = new Set(peerModel.links.map(teamLinkKey));
    const fieldRows = [
      ['Model title', state.loa.title, peerLoa.title], ['Flow', state.loa.flow, peerLoa.flow], ['Narrative', state.loa.narrative, peerLoa.narrative],
      ['Outcome of relating studies (Item 12)', state.loa.relateOutcome, peerLoa.relateOutcome], ['Studies synthesized (Item 15)', state.loa.synthStudies, peerLoa.synthStudies],
      ['Where the model applies (Item 16)', state.loa.modelContext, peerLoa.modelContext]
    ].filter(r => (r[1] || r[2]));
    const linkLine = (l, inOther) => `<div>${inOther ? '✓' : '<span class="text-rose-600 font-bold">≠</span>'} ${escapeHtml(l.from)} <b style="color:${(LINK_TYPES[l.type] || LINK_TYPES.leads).color}">${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym}</b> ${escapeHtml(l.to)}${l.note ? ` <span class="text-slate-400">— ${escapeHtml(l.note)}</span>` : ''}</div>`;
    const loaSection = document.createElement('div');
    loaSection.className = 'bg-white p-4 rounded-xl border border-orange-200 space-y-2.5';
    loaSection.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div>
          <h4 class="text-xs font-bold text-slate-800">🔗 Line of Argument / Overall Model — mine vs @${escapeHtml(cmp.peerReviewer)}</h4>
          <p class="text-[13px] text-slate-500">Compare the two models, keep the peer's as an independent model record, and bring over relations between rows you both have (matched by row title).</p>
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          <button type="button" class="cmp-keep-both px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded cursor-pointer">📸 Record both as independent models</button>
          <button type="button" class="cmp-import-rel px-3 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-bold rounded cursor-pointer">+ Import peer relations (rows matched by title)</button>
        </div>
      </div>
      ${fieldRows.length ? `<table class="w-full text-xs border border-slate-200"><thead><tr class="bg-slate-50"><th class="p-1.5 text-left w-1/5">Field</th><th class="p-1.5 text-left">👤 Mine (@${escapeHtml(state.reviewerId)})</th><th class="p-1.5 text-left">🤝 Peer (@${escapeHtml(cmp.peerReviewer)})</th></tr></thead><tbody>${fieldRows.map(r => `<tr class="border-t border-slate-200 align-top"><td class="p-1.5 font-semibold">${escapeHtml(r[0])}</td><td class="p-1.5 whitespace-pre-wrap ${String(r[1] || '').trim() !== String(r[2] || '').trim() ? 'bg-rose-50/50' : ''}">${escapeHtml(r[1] || '—')}</td><td class="p-1.5 whitespace-pre-wrap ${String(r[1] || '').trim() !== String(r[2] || '').trim() ? 'bg-rose-50/50' : ''}">${escapeHtml(r[2] || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="text-xs text-slate-400">Neither file has a line-of-argument model yet.</div>'}
      <div class="grid grid-cols-2 gap-3 text-xs">
        <div class="p-2 rounded bg-indigo-50/40 border border-indigo-200"><div class="font-bold text-indigo-900 mb-1">My relations (${myLinks.length})</div>${myLinks.map(l => linkLine(l, peerKeys.has(teamLinkKey(l)))).join('') || '<div class="text-slate-400">none</div>'}</div>
        <div class="p-2 rounded bg-teal-50/40 border border-teal-200"><div class="font-bold text-teal-900 mb-1">Peer relations (${peerModel.links.length})</div>${peerModel.links.map(l => linkLine(l, myKeys.has(teamLinkKey(l)))).join('') || '<div class="text-slate-400">none</div>'}</div>
      </div>
      <div class="text-[11px] text-slate-400">✓ = in both models · ≠ = only in this model</div>`;
    loaSection.querySelector('.cmp-keep-both').onclick = async () => {
      const models = Array.isArray(state.loa.teamModels) ? state.loa.teamModels : [];
      const mine = snapshotCurrentModel(state.reviewerId || 'Reviewer', 'local');
      if (!modelIsEmpty(mine) && !models.some(m => m.reviewer === mine.reviewer && m.title === mine.title && m.narrative === mine.narrative && m.flow === mine.flow)) {
        await addTeamModel(mine, 'Snapshot of my model at the time of comparison with @' + cmp.peerReviewer + '.');
      }
      if (!modelIsEmpty(peerModel) && !(state.loa.teamModels || []).some(m => m.reviewer === peerModel.reviewer && m.title === peerModel.title && m.narrative === peerModel.narrative && m.flow === peerModel.flow)) {
        await addTeamModel({ ...peerModel, id: 'tm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }, `Imported from @${cmp.peerReviewer}'s project file via Compare.`);
      }
      // Peer files may already hold their own team-model records
      for (const pm of (Array.isArray(peerLoa.teamModels) ? peerLoa.teamModels : [])) {
        if (!(state.loa.teamModels || []).some(m => m.id === pm.id)) await addTeamModel({ ...pm }, `Carried over from @${cmp.peerReviewer}'s team-model records.`);
      }
      alert('Independent models recorded. Open "Research Aim & Overall Model" in Tab 2 to compare them side by side and write how they were merged.');
    };
    loaSection.querySelector('.cmp-import-rel').onclick = async () => {
      const byTitle = t => state.clusters.find(c => (c.thirdOrderTitle || '').trim().toLowerCase() === String(t || '').trim().toLowerCase());
      let added = 0, skipped = 0;
      for (const l of peerModel.links) {
        const f = byTitle(l.from), t = byTitle(l.to);
        if (!f || !t || f.id === t.id) { skipped++; continue; }
        const dup = (state.loa.links || []).some(x => x.type === l.type && ((x.from === f.id && x.to === t.id) || (l.type !== 'leads' && x.from === t.id && x.to === f.id)));
        if (dup) continue;
        state.loa.links = [...(state.loa.links || []), { id: 'lk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), from: f.id, to: t.id, type: l.type, note: (l.note ? l.note + ' ' : '') + `[from @${cmp.peerReviewer}]` }];
        added++;
      }
      if (added) {
        state.loa.updatedAt = Date.now();
        await dbPut('meta', state.loa);
        await recordAuditLog({ category: 'team_model', action: `Imported ${added} concept relation(s) from @${cmp.peerReviewer}'s model`, detail: skipped ? `${skipped} relation(s) skipped: the rows were not found here by title (import those rows first).` : '' });
        renderLoaMap();
      }
      alert(`Imported ${added} relation(s).${skipped ? ` ${skipped} skipped (rows not found here by title — import those rows first).` : ''}`);
      renderComparisonTabContent();
    };
    box.appendChild(loaSection);
    const restBox = document.createElement('div');
    restBox.className = 'space-y-4';
    box.appendChild(restBox);
    restBox.innerHTML = `
      <div class="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
        <div>
          <h4 class="text-xs font-bold text-slate-800">🕒 Interleave & Merge Audit Trail Logs</h4>
          <p class="text-[13px] text-slate-500">Chronologically merges @${escapeHtml(cmp.peerReviewer)}'s audit trail entries with yours (skipping duplicate IDs) so you have a unified multi-reviewer audit trail.</p>
        </div>
        <button id="mergePeerLogsBtn" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer shrink-0">
          Interleave Audit Logs
        </button>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200 space-y-2.5">
        <h4 class="text-xs font-bold text-slate-800">🟣 Peer's 3rd Order Concept Clusters</h4>
        <div id="peerClustersList" class="space-y-2"></div>
      </div>
    `;

    restBox.querySelector('#mergePeerLogsBtn').onclick = async () => {
      let added = 0;
      for (const pl of peerLogs) {
        if (!state.logs.find(x => x.id === pl.id)) {
          const entry = { ...pl, reviewer: pl.reviewer || cmp.peerReviewer };
          await dbPut('logs', entry);
          state.logs.push(entry);
          added++;
        }
      }
      state.logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      updateAuditBadge();
      alert(`Merged ${added} new audit trail entries from @${cmp.peerReviewer}!`);
    };

    const clList = restBox.querySelector('#peerClustersList');
    if (peerClusters.length === 0) {
      clList.innerHTML = `<div class="text-xs text-slate-400">No 3rd order clusters in peer JSON.</div>`;
    } else {
      peerClusters.forEach(pc => {
        const exists = state.clusters.find(c => c.id === pc.id || (c.thirdOrderTitle && pc.thirdOrderTitle && c.thirdOrderTitle.toLowerCase() === pc.thirdOrderTitle.toLowerCase()));
        const row = document.createElement('div');
        row.className = 'p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between text-xs';
        row.innerHTML = `
          <div>
            <div class="font-bold text-slate-800">${escapeHtml(pc.thirdOrderTitle || '(Untitled Cluster)')} <span class="text-xs font-normal text-slate-500">(${escapeHtml(pc.translationType)}) • CERQual: ${escapeHtml(pc.cerqualConfidence || 'Not assessed')}</span></div>
            ${pc.translationSummary ? `<div class="text-[13px] text-emerald-800 mt-0.5"><b>A · Translation:</b> ${escapeHtml(pc.translationSummary)}</div>` : ''}
            <div class="text-[13px] text-slate-600 mt-0.5">${pc.translationSummary ? '<b>B · 3rd order:</b> ' : ''}${escapeHtml(pc.synthesisNote || '-')}</div>
          </div>
          ${exists
            ? `<span class="text-[13px] text-emerald-700 font-semibold px-2 py-1 bg-emerald-50 rounded border border-emerald-200">✓ Already in Matrix</span>`
            : `<button class="imp-cl px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded cursor-pointer">+ Import Row</button>`}
        `;
        row.querySelector('.imp-cl')?.addEventListener('click', async () => {
          const newCl = normalizeCluster({ ...pc, by: cmp.peerReviewer });
          await dbPut('clusters', newCl);
          state.clusters.push(newCl);
          await recordAuditLog({
            clusterIds: [newCl.id],
            category: 'concordance',
            action: `Imported 3rd Order Cluster from @${cmp.peerReviewer}`,
            toVal: newCl.thirdOrderTitle || '(Untitled)'
          });
          renderComparisonTabContent();
        });
        clList.appendChild(row);
      });
    }

    container.appendChild(box);
  }
}

async function importPeerConstruct(item, status) {
  const cmp = state.peerComparison;
  let targetDocId = item.localDocId;
  if (!targetDocId && item.peerDoc) {
    const stub = normalizeDoc({ ...item.peerDoc, hasBinary: false, order: state.docs.length });
    await dbPut('docs', stub);
    state.docs.push(stub);
    targetDocId = stub.id;
    cmp.docMapPeerToLocal[item.peerDoc.id] = stub.id;
    renderStudyList();
  }
  if (!targetDocId) return;

  // Peer annotation id -> local annotation id (matched pairs + items already imported in this session)
  if (!cmp.peerToLocalAnnoId) {
    cmp.peerToLocalAnnoId = {};
    cmp.matchedPairs.forEach(pr => { cmp.peerToLocalAnnoId[pr.peerAnno.id] = pr.localAnno.id; });
  }
  const raw = JSON.parse(JSON.stringify(item.peerAnno));
  const peerId = raw.id;
  // Avoid id collisions with local items (and unsafe characters from foreign files)
  if (!raw.id || !/^[\w.-]+$/.test(String(raw.id)) || state.annotations.some(a => a.id === raw.id)) {
    raw.id = 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }
  // Re-point 1st Order parent links to the LOCAL 2nd Order construct; drop links that would dangle
  if (raw.type === 'first_order') {
    const peerParents = Array.isArray(raw.parentIds) ? raw.parentIds : [];
    const okParents = [], waiting = [];
    peerParents.forEach(pid => {
      const mappedParent = cmp.peerToLocalAnnoId[pid] || pid;
      if (state.annotations.some(a => a.id === mappedParent && a.type === 'second_order' && a.docId === targetDocId)) okParents.push(mappedParent);
      else waiting.push(pid);
    });
    raw.parentIds = [...new Set(okParents)];
    if (waiting.length) raw._peerParentIds = waiting;
  }
  // Keep only matrix rows that exist locally (peer rows can be imported separately in the "3rd Order & Logs" tab)
  if (Array.isArray(raw.clusterIds)) {
    const localIds = new Set(state.clusters.map(c => c.id));
    raw.clusterIds = raw.clusterIds.filter(id => localIds.has(id));
    ['clusterRelations', 'clusterComments'].forEach(k => {
      if (raw[k] && typeof raw[k] === 'object') Object.keys(raw[k]).forEach(id => { if (!localIds.has(id)) delete raw[k][id]; });
    });
  }
  if (raw.type === 'second_order' && targetDocId === state.docs[0]?.id) raw.indexSeeded = true;

  const imported = normalizeAnnotation({
    ...raw,
    docId: targetDocId,
    by: item.peerAnno.by || cmp.peerReviewer,
    concordanceStatus: status,
    concordanceNote: `Imported from @${cmp.peerReviewer} via JSON Diff/Merge.`
  });
  cmp.peerToLocalAnnoId[peerId] = imported.id;
  // If this is a 2nd Order construct, re-attach any previously imported peer quotes that were waiting for it
  if (imported.type === 'second_order') {
    for (const a of state.annotations) {
      const waiting = a._peerParentIds || [];
      if (a.type === 'first_order' && waiting.includes(peerId)) {
        linkQuote(a, imported.id);
        a._peerParentIds = waiting.filter(x => x !== peerId);
        if (!a._peerParentIds.length) delete a._peerParentIds;
        await dbPut('annotations', a);
      }
    }
  }

  await dbPut('annotations', imported);
  state.annotations.push(imported);

  const idx = cmp.peerOnlyAnnos.indexOf(item);
  if (idx >= 0) cmp.peerOnlyAnnos.splice(idx, 1);

  const doc = state.docs.find(d => d.id === targetDocId);
  await recordAuditLog({
    category: 'concordance',
    action: `Imported Peer Construct from @${cmp.peerReviewer} as ${status.toUpperCase()} (${getDisplayName(doc)}, p.${imported.page})`,
    detail: `"${imported.text.slice(0, 80)}..."`,
    toVal: `${imported.type === 'second_order' ? '2nd Order' : '1st Order'} [${status.toUpperCase()}]`
  });

  if (state.activeDocId === targetDocId) {
    renderHighlights();
    updateSidebar();
  }
}
