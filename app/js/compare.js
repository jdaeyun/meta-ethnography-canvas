// Meta-Ethnography Canvas — Compare & merge
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// Loading another reviewer's JSON, matching constructs, resolving differences, merging rows, models and logs.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// REVIEWER JSON DIFF & MERGE ENGINE (REVIEW & DISCUSSION)
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
  // What was imported (constructs, rows, models, map relations, trail entries) shows at once in whatever view is open
  refreshOpenViews({ loa: true });
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

// A reviewer-wrapped 1st-order quote stores '[Concept derived from 1st Order Quote, p.N]: "quote"'.
// Compare on the quote body only, so it can match another reviewer's direct 2nd-order extraction of the same passage.
function stripWrapPrefix(anno) {
  const t = String(anno.text || '');
  if (anno.origin !== 'wrapped_first_order') return t;
  return t.replace(/^\[Concept derived from 1st Order Quote[^\]]*\]:\s*/, '').replace(/^["“”]+|["“”]+$/g, '');
}

// ---- Which of the peer's studies is which of mine ----
// Certain: same id, identical file (sha256), same DOI, same file name, same title. Same first author + year is only a
// SUGGESTION (two papers by one author in one year are common) and is confirmed by hand in the Studies & Order tab.
function normTitle(t) { return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
const DOC_MATCH_LABEL = { id: 'same study record', sha256: 'identical PDF file', doi: 'same DOI', name: 'same file name', title: 'same title', manual: 'connected by hand', added: "added from the peer's file" };
function matchPeerDocs(peerData) {
  const docMapPeerToLocal = {}, matchedStudies = [], unmatchedPeerDocs = [];
  const used = new Set();
  const peerDocs = peerData.docs.slice();
  /** @type {[string, (l: any, p: any) => boolean][]} */
  const rules = [
    ['id', (l, p) => l.id === p.id],
    ['sha256', (l, p) => !!(l.sha256 && p.sha256 && l.sha256 === p.sha256)],
    ['doi', (l, p) => !!(l.doi && p.doi && normalizeDoi(l.doi) === normalizeDoi(p.doi))],
    ['name', (l, p) => !!(l.name && p.name && l.name.toLowerCase() === p.name.toLowerCase())],
    ['title', (l, p) => normTitle(l.title).length > 10 && normTitle(l.title) === normTitle(p.title)]
  ];
  // Rule by rule over ALL studies, so a strong match is never taken away by a weaker one found earlier
  const howOf = {};
  rules.forEach(([how, test]) => {
    peerDocs.forEach(pDoc => {
      if (docMapPeerToLocal[pDoc.id]) return;
      const l = state.docs.find(x => !used.has(x.id) && test(x, pDoc));
      if (l) { docMapPeerToLocal[pDoc.id] = l.id; used.add(l.id); howOf[pDoc.id] = how; }
    });
  });
  peerDocs.forEach(pDoc => {
    const lid = docMapPeerToLocal[pDoc.id];
    if (lid) matchedStudies.push({ localDoc: state.docs.find(d => d.id === lid), peerDoc: pDoc, how: howOf[pDoc.id] });
    else unmatchedPeerDocs.push(pDoc);
  });
  return { docMapPeerToLocal, matchedStudies, unmatchedPeerDocs };
}
function peerDocSuggestions(pDoc, cmp) {
  const taken = new Set(Object.values(cmp.docMapPeerToLocal));
  const sameAuthYear = l => l.author && pDoc.author && l.year && pDoc.year && l.author.toLowerCase() === pDoc.author.toLowerCase() && String(l.year) === String(pDoc.year);
  return state.docs.filter(l => !taken.has(l.id)).map(l => ({ l, score: (sameAuthYear(l) ? 2 : 0) + (pdfNameScore(pDoc.name, l.name) > 0 ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);
}

// ---- Which of the peer's constructs is which of mine: best pairs first, over the whole file ----
// (Taking the peer's items one by one would let an early item claim a local construct that fits a later one better,
// so the result would depend on the order of the peer's file.)
function computePeerAnnotationMatches(cmp) {
  const { peerData, docMapPeerToLocal } = cmp;
  const localBy = new Map();
  state.annotations.forEach(a => { const k = a.docId + '|' + a.type; if (!localBy.has(k)) localBy.set(k, []); localBy.get(k).push(a); });
  const cands = [];
  peerData.annotations.forEach((pAnno, pi) => {
    const ld = docMapPeerToLocal[pAnno.docId];
    if (!ld) return;
    (localBy.get(ld + '|' + pAnno.type) || []).forEach((cand, li) => {
      const score = cand.id === pAnno.id ? 2 : computeTextSimilarity(stripWrapPrefix(cand), stripWrapPrefix(pAnno)) + (cand.page === pAnno.page ? 0.1 : 0);
      if (score >= 0.55) cands.push({ pi, li, cand, score });
    });
  });
  cands.sort((a, b) => (b.score - a.score) || (a.pi - b.pi) || (a.li - b.li));
  const peerTaken = new Map(), localTaken = new Set();
  cands.forEach(c => {
    if (peerTaken.has(c.pi) || localTaken.has(c.cand.id)) return;
    peerTaken.set(c.pi, c); localTaken.add(c.cand.id);
  });
  cmp.matchedPairs = [];
  cmp.peerOnlyAnnos = [];
  peerData.annotations.forEach((pAnno, pi) => {
    const ld = docMapPeerToLocal[pAnno.docId];
    const m = peerTaken.get(pi);
    if (m) {
      cmp.matchedPairs.push({ pi, localAnno: m.cand, peerAnno: pAnno, similarity: Math.min(100, Math.round(m.score * 100)), doc: state.docs.find(d => d.id === ld) });
    } else {
      cmp.peerOnlyAnnos.push({ pi, peerAnno: pAnno, localDocId: ld || null, doc: ld ? state.docs.find(d => d.id === ld) : undefined, peerDoc: peerData.docs.find(d => d.id === pAnno.docId) });
    }
  });
  cmp.localOnlyAnnos = state.annotations.filter(a => !localTaken.has(a.id));
  cmp.peerToLocalAnnoId = null; // rebuilt from the new pairs (and the imports so far) on the next use: peerAnnoMap
  // Constructs set aside in an earlier comparison with this reviewer do not come back as new; they are listed apart
  cmp.setAsideAnnos = cmp.peerOnlyAnnos.filter(item => peerSetAsideRecord(cmp, item.peerAnno));
  cmp.peerOnlyAnnos = cmp.peerOnlyAnnos.filter(item => !peerSetAsideRecord(cmp, item.peerAnno));
}

// ---- Set aside: remembered in the project (state.loa.peerSetAside), so the next file from the same reviewer does not
// bring the same construct back as new. A construct whose text the reviewer has changed since is shown again. ----
function peerSetAsideKey(pAnno) { return String(pAnno.text || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 300); }
function peerSetAsideRecord(cmp, pAnno) {
  const list = Array.isArray(state.loa.peerSetAside) ? state.loa.peerSetAside : [];
  return list.find(r => r.peerId === pAnno.id && r.reviewer === cmp.peerReviewer && r.textKey === peerSetAsideKey(pAnno)) || null;
}



// ---- Translation order of both reviewers: a different #1 or order can lead to a different reading (to discuss, not an error) ----
function peerOrderInfo(cmp) {
  const peerDocs = sortStudies(cmp.peerData.docs.slice());
  const peerLoa = cmp.peerData.loa || {};
  const mine = state.docs.map(d => d.id);
  const theirs = peerDocs.map(p => cmp.docMapPeerToLocal[p.id] || null);
  const firstDiffers = !!(mine[0] && theirs[0] !== undefined && theirs[0] !== mine[0]);
  // Same order for the studies both reviewers have?
  const shared = mine.filter(id => theirs.includes(id));
  const sameOrder = shared.join('|') === theirs.filter(id => id && shared.includes(id)).join('|');
  return { peerDocs, peerLoa, firstDiffers, sameOrder };
}

function renderCompareStudiesTab(container, cmp) {
  const info = peerOrderInfo(cmp);
  const stratLabel = v => (ORDER_STRATEGIES[v] || ORDER_STRATEGIES.index).label;
  const nameOfPeer = p => peerDocNameHere(cmp, p);
  const orderBox = document.createElement('div');
  orderBox.className = `bg-white p-4 rounded-xl border ${info.firstDiffers || !info.sameOrder ? 'border-amber-300' : 'border-slate-200'} space-y-2`;
  orderBox.innerHTML = `
    <h4 class="text-xs font-bold text-slate-800">⭐ Translation order — mine vs @${escapeHtml(cmp.peerReviewer)}</h4>
    <p class="text-[13px] text-slate-500">${info.firstDiffers
      ? 'You started from different #1 studies. Each reviewer translated the others into a different starting point, so some differences in your readings may come from this. Worth discussing, not correcting.'
      : info.sameOrder ? 'Same #1 study and the same order for the studies you both have.' : 'Same #1 study, but the later studies were translated in a different order. Worth noting when you discuss differences.'}</p>
    <div class="grid grid-cols-2 gap-3 text-xs">
      <div class="rounded border border-slate-200 p-2 space-y-1">
        <div class="font-bold text-slate-700">Mine · ${escapeHtml(stratLabel(state.loa.orderStrategy))}</div>
        <ol class="list-decimal pl-5 text-slate-700">${state.docs.map(d => `<li>${escapeHtml(getDisplayName(d))}</li>`).join('')}</ol>
        ${state.loa.orderRationale ? `<div class="text-slate-500"><b>Why:</b> ${escapeHtml(state.loa.orderRationale)}</div>` : ''}
      </div>
      <div class="rounded border border-teal-200 p-2 space-y-1">
        <div class="font-bold text-teal-800">@${escapeHtml(cmp.peerReviewer)} · ${escapeHtml(stratLabel(info.peerLoa.orderStrategy))}</div>
        <ol class="list-decimal pl-5 text-slate-700">${info.peerDocs.map(p => `<li>${escapeHtml(nameOfPeer(p))}</li>`).join('')}</ol>
        ${info.peerLoa.orderRationale ? `<div class="text-slate-500"><b>Why:</b> ${escapeHtml(info.peerLoa.orderRationale)}</div>` : ''}
      </div>
    </div>
    ${info.firstDiffers || !info.sameOrder ? `<button type="button" data-action="order-memo" class="cmp-order-memo px-2.5 py-1 text-xs font-semibold rounded border border-amber-400 bg-amber-50 text-amber-900 cursor-pointer hover:bg-amber-100">Record this difference in the Audit Trail…</button>` : ''}`;
  // (recording the difference: COMPARE_ACTIONS['order-memo'])
  container.appendChild(orderBox);

  const matchBox = document.createElement('div');
  matchBox.className = 'bg-white p-4 rounded-xl border border-slate-200 space-y-2';
  matchBox.innerHTML = `
    <h4 class="text-xs font-bold text-slate-800">📚 Which study is which</h4>
    <p class="text-[13px] text-slate-500">Matched automatically by identical PDF file, DOI, file name or title. Same first author and year is only offered as a suggestion (★), because one author often publishes two papers in a year.</p>
    <ul class="text-xs space-y-1">${cmp.matchedStudies.map(m => `<li>✓ ${escapeHtml(getDisplayName(m.localDoc))} <span class="text-slate-400">— ${escapeHtml(DOC_MATCH_LABEL[m.how] || m.how)}</span></li>`).join('')}</ul>
    <div class="cmp-unmatched space-y-1.5"></div>`;
  const um = matchBox.querySelector('.cmp-unmatched');
  if (cmp.unmatchedPeerDocs.length) um.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-amber-800 pt-1">Not matched yet (${cmp.unmatchedPeerDocs.length})</div>`);
  cmp.unmatchedPeerDocs.forEach(pDoc => {
    const sugg = peerDocSuggestions(pDoc, cmp);
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 text-xs';
    row.dataset.peerDoc = String(cmp.peerData.docs.indexOf(pDoc));
    row.innerHTML = `<span class="flex-1 truncate" title="${escapeHtml(pDoc.name || '')}">• ${escapeHtml(getDisplayName(pDoc))}${pDoc.title ? ` <span class="text-slate-400">${escapeHtml(pDoc.title.slice(0, 60))}</span>` : ''}</span>
      <select data-action="doc-match" class="cmp-doc-pick max-w-[50%] text-xs border border-amber-300 rounded px-1 py-0.5 bg-white text-slate-700">
        <option value="">Not in my project</option>
        ${sugg.map((x, i) => `<option value="${escapeHtml(x.l.id)}">${i === 0 && x.score >= 2 ? '★ ' : ''}Same as: ${escapeHtml(getDisplayName(x.l))}</option>`).join('')}
      </select>`;
    // (connecting it: COMPARE_ACTIONS['doc-match'])
    um.appendChild(row);
  });
  container.appendChild(matchBox);
}

function setCompareTab(tab) {
  state.activeCompareTab = tab;
  document.querySelectorAll('.cmp-tab-btn').forEach(b => {
    b.className = b.dataset.cmptab === tab
      ? "cmp-tab-btn px-3 py-1 text-xs font-bold rounded bg-white text-teal-800 shadow-sm cursor-pointer"
      : "cmp-tab-btn px-3 py-1 text-xs font-medium rounded text-slate-600 hover:text-slate-900 cursor-pointer";
  });
}

async function processPeerJsonFile(file) {
  try {
    const text = await file.text();
    const peerData = upgradeProjectData(JSON.parse(text));
    if (!peerData.docs || !peerData.annotations) throw new Error('Invalid Reviewer JSON file.');

    const incomingProjCode = sanitizeProjectCode(peerData.projectCode || peerData.loa?.projectCode || '');
    const currentProjCode = sanitizeProjectCode(state.projectCode || '');
    if (currentProjCode && incomingProjCode && currentProjCode !== incomingProjCode) {
      const proceed = await askChoice({
        title: 'This file is from another project',
        body: `This workspace: [${currentProjCode}]\nOther reviewer's file: [${incomingProjCode}] (${file.name})\n\nCheck that you picked the file of this review.`,
        choices: [{ value: 'go', tone: 'danger', label: 'Compare these two projects anyway', hint: 'Nothing is changed until you import something.' }]
      });
      if (!proceed) return;
    } else if (currentProjCode && !incomingProjCode) {
      const proceed = await askChoice({
        title: 'This file has no project code',
        body: `This workspace is [${currentProjCode}]; the other reviewer's file (${file.name}) has no project code.`,
        choices: [{ value: 'go', tone: 'primary', label: 'Compare with this file' }]
      });
      if (!proceed) return;
    }

    const peerReviewer = peerData.reviewerId ||
      (peerData.annotations.find(a => a.by)?.by) ||
      (peerData.logs?.find(l => l.reviewer)?.reviewer) || 'Peer';

    const { docMapPeerToLocal, matchedStudies, unmatchedPeerDocs } = matchPeerDocs(peerData);
    state.peerComparison = { peerReviewer, peerData, docMapPeerToLocal, matchedStudies, unmatchedPeerDocs };
    computePeerAnnotationMatches(state.peerComparison);
    await reattachWaitingByTitle(state.peerComparison);
    // Start on the Studies & Order tab when there is something to settle or discuss there
    const firstDiffers = (peerData.docs[0] && state.docs[0]) && docMapPeerToLocal[(sortStudies(peerData.docs.slice())[0] || {}).id] !== state.docs[0].id;
    if (unmatchedPeerDocs.length || firstDiffers) setCompareTab('studies');

    state.teamMode = true;
    lsSet('me_team_mode', 'true');
    const teamToggle = document.getElementById('teamModeToggle');
    if (teamToggle) teamToggle.checked = true;
    updateSidebar();

    compareEmptyState.classList.add('hidden');
    compareWorkspace.classList.remove('hidden');
    compareWorkspace.classList.add('flex');
    renderComparisonDashboard();
  } catch (err) {
    showNotice('Could not compare with this file', err.message);
  }
}

document.querySelectorAll('.cmp-tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    setCompareTab(btn.dataset.cmptab);
    if (btn.dataset.cmptab === 'clusters_logs') await reattachWaitingByTitle(state.peerComparison);
    renderComparisonTabContent();
  });
});

// Two readings of the same passage are labelled differently when the labels differ, including when only one
// reviewer gave a label (the other left it empty): both are readings to discuss.
function pairLabelsDiffer(l, p) {
  const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(l.note) !== norm(p.note);
}
function getCompareBuckets(cmp) {
  const divergent = [];
  const aligned = [];
  cmp.matchedPairs.forEach(pair => {
    const l = pair.localAnno, p = pair.peerAnno;
    const labelsDiffer = pairLabelsDiffer(l, p);
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
  setDot('cntStudies', cmp.unmatchedPeerDocs.length > 0 || peerOrderInfo(cmp).firstDiffers);
  renderComparisonTabContent();
}

function renderComparisonTabContent() {
  const container = document.getElementById('compareTabContent');
  container.innerHTML = '';
  const cmp = state.peerComparison;
  if (!cmp) return;

  if (state.activeCompareTab === 'studies') { renderCompareStudiesTab(container, cmp); return; }

  // Constructs set aside earlier: listed apart (collapsed), each can be taken back into the list
  const renderSetAside = () => {
    const items = cmp.setAsideAnnos || [];
    if (!items.length) return;
    const box = document.createElement('details');
    box.className = 'set-aside-box bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-600';
    box.innerHTML = `<summary class="cursor-pointer font-semibold">Set aside earlier (${items.length}): not shown as new again</summary><div class="space-y-1.5 mt-2"></div>`;
    const list = box.querySelector('div');
    items.forEach(item => {
      const p = item.peerAnno, rec = peerSetAsideRecord(cmp, p);
      const row = document.createElement('div');
      row.className = 'flex items-start justify-between gap-3 bg-white border border-slate-200 rounded px-2.5 py-1.5';
      row.dataset.peerIndex = String(item.pi);
      const studyName = peerItemStudyName(item);
      row.innerHTML = `<div class="flex-1"><b>${escapeHtml(studyName)}</b> p.${escapeHtml(p.page)} — <i>"${escapeHtml(String(p.text || '').slice(0, 140))}${String(p.text || '').length > 140 ? '…' : ''}"</i>
          <div class="text-[11px] text-slate-400">Set aside ${rec && rec.at ? new Date(rec.at).toLocaleString() : ''}${rec && rec.by ? ' by @' + escapeHtml(rec.by) : ''}</div></div>
        <button type="button" data-action="reconsider" class="reconsider-btn shrink-0 px-2 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded cursor-pointer">Reconsider</button>`;
      list.appendChild(row);
    });
    container.appendChild(box);
  };

  const renderPeerOnly = () => {
    if (cmp.peerOnlyAnnos.length === 0) {
      container.innerHTML = `<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">🎉 Each of @${escapeHtml(cmp.peerReviewer)}'s extracted constructs is matched, imported or set aside.</div>`;
      renderSetAside();
      return;
    }

    const topAction = document.createElement('div');
    topAction.className = 'flex items-center justify-between bg-teal-50 border border-teal-200 px-4 py-2.5 rounded-xl';
    topAction.innerHTML = `
      <div class="text-xs text-teal-900">
        <b>Review &amp; discussion:</b> read the constructs extracted by <b>@${escapeHtml(cmp.peerReviewer)}</b> that are not in your project, one by one: Import & Agree (for now), Import as Discuss, or Set Aside (it stays in the other reviewer's file; nothing is deleted).
      </div>
      <button id="importAllPeerBtn" data-action="import-all" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer">
        + Import All as Discuss
      </button>
    `;
    container.appendChild(topAction);

    cmp.peerOnlyAnnos.forEach(item => {
      const p = item.peerAnno;
      const studyName = peerItemStudyName(item, true);
      const isSec = p.type === 'second_order';
      const card = document.createElement('div');
      card.className = 'bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between gap-4';
      card.dataset.peerIndex = String(item.pi);
      card.innerHTML = `
        <div class="space-y-1.5 flex-1">
          <div class="flex items-center space-x-2 text-xs">
            <span class="font-bold px-2 py-0.5 rounded ${isSec ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">${isSec ? '🟩 2nd Order' : '🟦 1st Order Quote'}</span>
            <span class="font-bold text-slate-800">${escapeHtml(studyName)}</span>
            <span class="text-slate-400">p.${escapeHtml(p.page)}</span>
            <span class="text-xs font-mono bg-teal-100 text-teal-800 px-1.5 py-px rounded">@${escapeHtml(p.by || cmp.peerReviewer)}</span>
          </div>
          ${p.note ? `<div class="text-xs font-bold text-slate-800">Summary Label: ${escapeHtml(p.note)}</div>` : ''}
          <div class="text-xs italic text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">"${escapeHtml(p.text)}"</div>
          ${p.concordanceNote ? `<div class="text-[13px] text-indigo-700">Peer Note: ${escapeHtml(p.concordanceNote)}</div>` : ''}
        </div>
        <div class="flex flex-col space-y-1.5 shrink-0">
          <button type="button" data-action="import-agree" class="imp-agree px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-md cursor-pointer flex items-center space-x-1">
            <i class="ph ph-download-simple"></i><span>Import & Agree</span>
          </button>
          <button type="button" data-action="import-discuss" class="imp-discuss px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-md cursor-pointer flex items-center space-x-1">
            <i class="ph ph-chats-circle"></i><span>Import as Discuss</span>
          </button>
          <button type="button" data-action="set-aside" class="imp-dismiss px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md cursor-pointer" title="Not imported; the construct stays in the other reviewer's file. Remembered in this project, so a later file from this reviewer does not show it as new again (unless its text has changed).">
            Set Aside
          </button>
        </div>
      `;
      container.appendChild(card);
    });
    renderSetAside();
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
      const labelDiff = pairLabelsDiffer(l, p);
      const flaggedDisc = l.concordanceStatus === 'discuss' || p.concordanceStatus === 'discuss';
      const differs = (labelDiff || flaggedDisc) && l.concordanceStatus !== 'agreed';
      const card = document.createElement('div');
      card.className = differs
        ? 'bg-amber-50/50 p-4 rounded-xl border-2 border-amber-300 shadow-sm space-y-2'
        : 'bg-white/70 p-2.5 rounded-lg border border-slate-200 space-y-1 text-slate-500';
      card.dataset.peerIndex = String(pair.pi);
      card.dataset.localId = l.id;
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2 text-xs">
            ${differs ? '<span class="bg-amber-500 text-white font-bold px-2 py-0.5 rounded">◇ Read differently</span>' : '<span class="text-slate-400 px-1">✓ Matched</span>'}
            <span class="font-bold text-slate-800">${escapeHtml(dName)} (p.${escapeHtml(l.page)})</span>
            <span class="text-xs text-slate-500">${l.type === 'second_order' ? '🟩 2nd Order' : '🟦 1st Order'}</span>
          </div>
          <div class="flex items-center space-x-2">
            <button type="button" data-action="mark-agreed" class="mark-agreed-btn px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded cursor-pointer">
              ${l.concordanceStatus === 'agreed' ? '✓ Already Agreed for now (Adopt Peer Note)' : '✅ Mark Agreed (for now) & Merge Note'}
            </button>
          </div>
        </div>
        ${differs ? '' : '<details class="text-xs"><summary class="cursor-pointer text-slate-400">Show both extractions</summary>'}
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div class="p-2.5 rounded bg-indigo-50/40 border border-indigo-200">
            <div class="font-bold text-indigo-900 mb-1">👤 My Extraction (@${escapeHtml(l.by || state.reviewerId)})</div>
            ${l.note ? `<div class="font-semibold mb-1 ${labelDiff ? 'text-amber-900 bg-amber-100 rounded px-1' : 'text-slate-800'}">Label: ${escapeHtml(l.note)}</div>` : (labelDiff ? '<div class="mb-1 text-amber-800 italic">(no label)</div>' : '')}
            <div class="italic text-slate-600">"${escapeHtml(l.text)}"</div>
          </div>
          <div class="p-2.5 rounded bg-teal-50/40 border border-teal-200">
            <div class="font-bold text-teal-900 mb-1">🤝 Peer Extraction (@${escapeHtml(p.by || cmp.peerReviewer)})</div>
            ${p.note ? `<div class="font-semibold mb-1 ${labelDiff ? 'text-amber-900 bg-amber-100 rounded px-1' : 'text-slate-800'}">Label: ${escapeHtml(p.note)}</div>` : (labelDiff ? '<div class="mb-1 text-amber-800 italic">(no label)</div>' : '')}
            <div class="italic text-slate-600">"${escapeHtml(p.text)}"</div>
          </div>
        </div>
        ${differs ? '' : '</details>'}
      `;
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
      card.dataset.localId = l.id;
      card.innerHTML = `
        <div>
          <div class="font-bold text-slate-800">${escapeHtml(getDisplayName(doc))} (p.${escapeHtml(l.page)}) — <span class="text-indigo-700">${l.type === 'second_order' ? '🟩 2nd Order' : '🟦 1st Order'}</span></div>
          ${l.note ? `<div class="font-semibold text-slate-700 mt-0.5">${escapeHtml(l.note)}</div>` : ''}
          <div class="italic text-slate-500 mt-0.5">"${escapeHtml(l.text)}"</div>
        </div>
        <button type="button" data-action="flag-discussion" class="flag-disc px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold rounded border border-amber-300 shrink-0 cursor-pointer">
          💬 Flag for Discussion
        </button>
      `;
      container.appendChild(card);
    });
  };

  const tab = state.activeCompareTab;
  const bk = getCompareBuckets(cmp);
  if (tab === 'divergent') {
    renderMatched(bk.divergent, 'Nothing read differently so far — matched constructs are aligned.');
  } else if (tab === 'unique') {
    if (cmp.peerOnlyAnnos.length === 0 && cmp.localOnlyAnnos.length === 0) {
      container.innerHTML = `<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">No unique extractions — both reviewers' constructs overlap.</div>`;
      renderSetAside();
    } else {
      if (cmp.peerOnlyAnnos.length > 0) renderPeerOnly(); else renderSetAside();
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
    const linkLine = (l, inOther) => `<div>${inOther ? '✓' : '<span class="text-slate-500 font-bold">◇</span>'} ${escapeHtml(l.from)} <b style="color:${(LINK_TYPES[l.type] || LINK_TYPES.leads).color}">${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym}</b> ${escapeHtml(l.to)}${l.note ? ` <span class="text-slate-400">— ${escapeHtml(l.note)}</span>` : ''}</div>`;
    const loaSection = document.createElement('div');
    loaSection.className = 'bg-white p-4 rounded-xl border border-orange-200 space-y-2.5';
    loaSection.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div>
          <h4 class="text-xs font-bold text-slate-800">🔗 Line of Argument / Overall Model — mine vs @${escapeHtml(cmp.peerReviewer)}</h4>
          <p class="text-[13px] text-slate-500">Compare the two models, keep the peer's as an independent model record, and bring over relations between rows you both have (matched by row title).</p>
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          <button type="button" data-action="keep-both-models" class="cmp-keep-both px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded cursor-pointer">📸 Record both as independent models</button>
          <button type="button" data-action="import-relations" class="cmp-import-rel px-3 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-bold rounded cursor-pointer">+ Import peer relations (rows matched by title)</button>
        </div>
      </div>
      ${fieldRows.length ? `<table class="w-full text-xs border border-slate-200"><thead><tr class="bg-slate-50"><th class="p-1.5 text-left w-1/5">Field</th><th class="p-1.5 text-left">👤 Mine (@${escapeHtml(state.reviewerId)})</th><th class="p-1.5 text-left">🤝 Peer (@${escapeHtml(cmp.peerReviewer)})</th></tr></thead><tbody>${fieldRows.map(r => `<tr class="border-t border-slate-200 align-top"><td class="p-1.5 font-semibold">${escapeHtml(r[0])}</td><td class="p-1.5 whitespace-pre-wrap ${String(r[1] || '').trim() !== String(r[2] || '').trim() ? 'bg-rose-50/50' : ''}">${escapeHtml(r[1] || '—')}</td><td class="p-1.5 whitespace-pre-wrap ${String(r[1] || '').trim() !== String(r[2] || '').trim() ? 'bg-rose-50/50' : ''}">${escapeHtml(r[2] || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="text-xs text-slate-400">Neither file has a line-of-argument model yet.</div>'}
      <div class="grid grid-cols-2 gap-3 text-xs">
        <div class="p-2 rounded bg-indigo-50/40 border border-indigo-200"><div class="font-bold text-indigo-900 mb-1">My relations (${myLinks.length})</div>${myLinks.map(l => linkLine(l, peerKeys.has(teamLinkKey(l)))).join('') || '<div class="text-slate-400">none</div>'}</div>
        <div class="p-2 rounded bg-teal-50/40 border border-teal-200"><div class="font-bold text-teal-900 mb-1">Peer relations (${peerModel.links.length})</div>${peerModel.links.map(l => linkLine(l, myKeys.has(teamLinkKey(l)))).join('') || '<div class="text-slate-400">none</div>'}</div>
      </div>
      <div class="text-[11px] text-slate-400">✓ = in both models · ◇ = only in this model</div>`;
    box.appendChild(loaSection);
    const restBox = document.createElement('div');
    restBox.className = 'space-y-4';
    box.appendChild(restBox);
    restBox.innerHTML = `
      <div class="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
        <div>
          <h4 class="text-xs font-bold text-slate-800">🕒 Merge Audit Trail Logs by Date</h4>
          <p class="text-[13px] text-slate-500">This happens automatically when you adopt anything from @${escapeHtml(cmp.peerReviewer)}. Use this button if you only compared. It merges @${escapeHtml(cmp.peerReviewer)}'s audit trail entries with yours (skipping duplicate IDs) so you have a unified multi-reviewer audit trail.</p>
        </div>
        <button type="button" id="mergePeerLogsBtn" data-action="merge-logs" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer shrink-0">
          Merge Audit Logs
        </button>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200 space-y-2.5">
        <h4 class="text-xs font-bold text-slate-800">🟣 Peer's 3rd Order Rows</h4>
        <div id="peerClustersList" class="space-y-2"></div>
      </div>
    `;

    const clList = restBox.querySelector('#peerClustersList');
    if (peerClusters.length === 0) {
      clList.innerHTML = `<div class="text-xs text-slate-400">No 3rd order rows in the other reviewer's file.</div>`;
    } else {
      peerClusters.forEach((pc, ci) => {
        const exists = state.clusters.find(c => c.id === pc.id || sameRowTitle(c.thirdOrderTitle, pc.thirdOrderTitle));
        const row = document.createElement('div');
        row.className = 'p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between text-xs';
        row.dataset.peerRow = String(ci);
        row.innerHTML = `
          <div>
            <div class="font-bold text-slate-800">${escapeHtml(pc.thirdOrderTitle || '(Untitled Row)')} <span class="text-xs font-normal text-slate-500">CERQual: ${escapeHtml(pc.cerqualConfidence || 'Not assessed')}</span></div>
            ${pc.translationSummary ? `<div class="text-[13px] text-emerald-800 mt-0.5"><b>A · Translation:</b> ${escapeHtml(pc.translationSummary)}</div>` : ''}
            <div class="text-[13px] text-slate-600 mt-0.5">${pc.translationSummary ? '<b>B · 3rd order:</b> ' : ''}${escapeHtml(pc.synthesisNote || '-')}</div>
          </div>
          ${exists
            ? `<span class="text-[13px] text-emerald-700 font-semibold px-2 py-1 bg-emerald-50 rounded border border-emerald-200">✓ Already in Matrix</span>`
            : `<button type="button" data-action="import-row" class="imp-cl px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded cursor-pointer">+ Import Row</button>`}
        `;
        clList.appendChild(row);
      });
    }

    container.appendChild(box);
  }
}

// How the study of a peer item is named: the study here it is matched to, else the peer's (stubNote: say that importing it
// adds the study)
function peerItemStudyName(item, stubNote = false) {
  return item.doc ? getDisplayName(item.doc) : (item.peerDoc ? getDisplayName(item.peerDoc) + (stubNote ? ' [Will create Study stub]' : '') : 'Unknown Study');
}
// A study of the peer's file, named as the study here it is matched to
function peerDocNameHere(cmp, p) {
  const lid = cmp.docMapPeerToLocal[p.id];
  const l = lid && state.docs.find(d => d.id === lid);
  return l ? getDisplayName(l) : getDisplayName(p) + ' (not matched)';
}

// ======================= What Compare's buttons and menus do =======================
// The tabs only draw: a button or menu carries data-action, and its card names what it belongs to (data-peer-index: the
// peer's construct by its place in their file; data-local-id: a construct here; data-peer-row / data-peer-doc: a row / study
// of the peer's file by its place there). One listener on #compareTabContent runs the action named here with that context.
function compareActionContext(el) {
  const cmp = state.peerComparison;
  const at = (attr, list) => { const c = el.closest(`[${attr}]`); const i = c ? Number(c.getAttribute(attr)) : -1; return (list && i >= 0 && list[i]) || null; };
  const localCard = el.closest('[data-local-id]');
  return {
    el, cmp,
    peerAnno: cmp ? at('data-peer-index', cmp.peerData.annotations) : null,
    local: localCard ? state.annotations.find(a => a.id === localCard.dataset.localId) || null : null,
    peerRow: cmp ? at('data-peer-row', cmp.peerData.clusters) : null,
    peerDoc: cmp ? at('data-peer-doc', cmp.peerData.docs) : null
  };
}
// The item of a list (peerOnlyAnnos / setAsideAnnos) that holds this peer construct
const peerItemIn = (list, peerAnno) => (peerAnno && (list || []).find(x => x.peerAnno === peerAnno)) || null;
async function importPeerItem({ cmp, peerAnno }, status) {
  const item = peerItemIn(cmp && cmp.peerOnlyAnnos, peerAnno);
  if (!item) return; // already handled (a second click)
  await importPeerConstruct(item, status);
  renderComparisonDashboard();
}
/** @type {Record<string, (ctx: any) => any>} */
const COMPARE_ACTIONS = {
  // ---- Studies & Order ----
  'order-memo': async ({ cmp }) => {
    if (!cmp) return;
    const info = peerOrderInfo(cmp);
    const nameOfPeer = p => peerDocNameHere(cmp, p);
    const note = await askReason({
      title: `A different translation order from @${cmp.peerReviewer}`,
      context: `Mine: ${state.docs.map(d => getDisplayName(d)).join(' ➔ ')}\n@${cmp.peerReviewer}: ${info.peerDocs.map(nameOfPeer).join(' ➔ ')}`,
      label: 'What does the different starting point / order mean for your readings? (optional)',
      confirmLabel: 'Record in the Audit Trail', draftKey: 'order-diff'
    });
    if (note === null) return;
    await recordAuditLog({
      kind: 'order_difference',
      category: 'concordance',
      action: `Noted a different translation order from @${cmp.peerReviewer}`,
      detail: `Mine: ${state.docs.map(d => getDisplayName(d)).join(' ➔ ')}\n@${cmp.peerReviewer}: ${info.peerDocs.map(nameOfPeer).join(' ➔ ')}${note ? '\n' + note : ''}`,
      fromVal: `#1: ${state.docs[0] ? getDisplayName(state.docs[0]) : '-'}`,
      toVal: `@${cmp.peerReviewer} #1: ${info.peerDocs[0] ? nameOfPeer(info.peerDocs[0]) : '-'}`
    });
    showSnackbar('Recorded in the Audit Trail.');
  },
  // Which study here a peer study is (only the comparison changes; nothing is stored)
  'doc-match': ({ cmp, peerDoc, el }) => {
    const lid = el.value;
    if (!cmp || !peerDoc || !lid || !cmp.unmatchedPeerDocs.includes(peerDoc)) return;
    cmp.docMapPeerToLocal[peerDoc.id] = lid;
    cmp.unmatchedPeerDocs = cmp.unmatchedPeerDocs.filter(x => x !== peerDoc);
    cmp.matchedStudies.push({ localDoc: state.docs.find(d => d.id === lid), peerDoc, how: 'manual' });
    computePeerAnnotationMatches(cmp);
    renderComparisonDashboard();
  },
  // ---- Unique extractions ----
  'import-agree': ctx => importPeerItem(ctx, 'agreed'),
  'import-discuss': ctx => importPeerItem(ctx, 'discuss'),
  // In bulk, constructs come in as "Discuss": agreement (for now) is reached by reading each one, not in one click.
  // The button is off while it runs, and the views are drawn once at the end.
  'import-all': async ({ cmp, el }) => {
    if (!cmp || el.disabled) return;
    el.disabled = true;
    try {
      for (const item of [...cmp.peerOnlyAnnos]) await importPeerConstruct(item, 'discuss', { redraw: false });
    } finally {
      el.disabled = false;
      renderHighlights();
      updateSidebar();
      renderComparisonDashboard();
    }
  },
  'set-aside': async ({ cmp, peerAnno }) => {
    const item = peerItemIn(cmp && cmp.peerOnlyAnnos, peerAnno);
    if (!item) return; // already handled (a second click)
    const p = item.peerAnno;
    cmp.peerOnlyAnnos.splice(cmp.peerOnlyAnnos.indexOf(item), 1);
    (cmp.setAsideAnnos = cmp.setAsideAnnos || []).push(item);
    await runOperation(opPeerSetAside(state, { add: { peerId: p.id, reviewer: cmp.peerReviewer, textKey: peerSetAsideKey(p), at: Date.now(), by: state.reviewerId || '' },
      action: `Set Aside Peer-Only Construct from @${cmp.peerReviewer}`, detail: `${peerItemStudyName(item, true)} (p.${p.page}): "${String(p.text || '').slice(0, 70)}..."` }));
    renderComparisonDashboard();
  },
  reconsider: async ({ cmp, peerAnno }) => {
    const item = peerItemIn(cmp && cmp.setAsideAnnos, peerAnno);
    if (!item) return;
    const p = item.peerAnno, rec = peerSetAsideRecord(cmp, p);
    await runOperation(opPeerSetAside(state, { remove: r => r === rec, action: `Reconsidered a construct from @${cmp.peerReviewer} set aside earlier`,
      detail: `${peerItemStudyName(item)} (p.${p.page}): "${String(p.text || '').slice(0, 70)}..."` }));
    cmp.setAsideAnnos = cmp.setAsideAnnos.filter(x => x !== item);
    cmp.peerOnlyAnnos.push(item);
    renderComparisonDashboard();
  },
  // The reason is added to the team note the construct has (the note is not replaced), and the change is logged
  'flag-discussion': async ({ cmp, local: l }) => {
    if (!cmp || !l) return;
    const doc = state.docs.find(d => d.id === l.docId);
    const reason = `Extracted only by @${state.reviewerId} (not in @${cmp.peerReviewer}'s JSON).`;
    const prevNote = l.concordanceNote || '';
    const note = prevNote.includes(reason) ? prevNote : [prevNote, reason].filter(Boolean).join('\n');
    await setConstructTeamStatus(l, 'discuss', note, {
      action: `Flagged for discussion: a construct only @${state.reviewerId} extracted, not in @${cmp.peerReviewer}'s file (${getDisplayName(doc)}, p.${l.page})`
    });
    updateSidebar();
    renderComparisonDashboard();
  },
  // ---- Read differently / aligned ----
  'mark-agreed': async ({ cmp, local: l, peerAnno: p }) => {
    if (!cmp || !l || !p) return;
    await mergePeerAuditLogs();
    await runOperation(opProvisionalAgreement(state, { secId: l.id, peerNote: p.note, peerReviewer: cmp.peerReviewer }, OP_NAMES));
    updateSidebar();
    renderComparisonDashboard();
  },
  // ---- 3rd Order, Model & Logs ----
  'keep-both-models': async ({ cmp }) => {
    if (!cmp) return;
    const peerLoa = cmp.peerData.loa || {};
    const peerModel = modelFromPeerLoa(peerLoa, cmp.peerData.clusters || [], cmp.peerReviewer);
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
    showSnackbar('Independent models recorded. Open "Research Aim & Overall Model" in Tab 2 to compare them side by side and write how they were merged.');
  },
  'import-relations': async ({ cmp }) => {
    if (!cmp) return;
    await mergePeerAuditLogs();
    const peerModel = modelFromPeerLoa(cmp.peerData.loa || {}, cmp.peerData.clusters || [], cmp.peerReviewer);
    const newId = () => 'lk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const before = (state.loa.links || []).length;
    const r = opImportPeerRelations(state, { peerLinks: peerModel.links, peerReviewer: cmp.peerReviewer, newId });
    if (await runOperation(r)) renderLoaMap();
    const added = (state.loa.links || []).length - before;
    const skipped = (peerModel.links || []).length - added;
    showSnackbar(`Imported ${added} relation(s).${skipped ? ` ${skipped} not added (already here, or rows not found here by title — import those rows first).` : ''}`);
    renderComparisonTabContent();
  },
  'merge-logs': async ({ cmp }) => {
    if (!cmp) return;
    const added = await mergePeerAuditLogs();
    showSnackbar(added ? `Merged ${added} new audit trail entries from @${cmp.peerReviewer}!` : `Nothing new to merge: @${cmp.peerReviewer}'s audit trail entries are already in your trail.`);
  },
  'import-row': async ({ cmp, peerRow: pc }) => {
    if (!cmp || !pc || state.clusters.some(c => c.id === pc.id || sameRowTitle(c.thirdOrderTitle, pc.thirdOrderTitle))) return; // here already (a second click)
    await mergePeerAuditLogs();
    // The peer's study ids become the local ones wherever the row names a study (remapRowDocIds: its base, empty-cell
    // records, re-reading note); an unmatched one stays as is, so it applies if that study is added later with that id
    const fromPeer = remapRowDocIds({ ...JSON.parse(JSON.stringify(pc)), baseDocId: ('baseDocId' in pc) ? pc.baseDocId : null }, id => cmp.docMapPeerToLocal[id]);
    // Its own id where that is safe and free (a foreign file may carry any characters); it goes below the rows here
    const safeId = pc.id && /^[\w.-]+$/.test(String(pc.id)) && !state.clusters.some(c => c.id === pc.id);
    // The construct a seeded row came from, by its id here; dropped rather than left pointing nowhere
    const seededFrom = pc.seededFromId ? peerAnnoMap(cmp)[pc.seededFromId] : undefined;
    const newCl = normalizeCluster({ ...fromPeer, id: safeId ? pc.id : 'cl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      by: cmp.peerReviewer, order: state.clusters.length, seededFromId: seededFrom });
    if (!newCl.baselineChange) delete newCl.baselineChange;
    if (!newCl.seededFromId) delete newCl.seededFromId;
    // The row, the constructs that were waiting for it (placed with their judgements) and the entry: one transaction
    await runOperation(opImportPeerRow(state, { row: newCl, peerRowId: pc.id, peerReviewer: cmp.peerReviewer }));
    renderComparisonTabContent();
  }
};
(() => {
  const content = document.getElementById('compareTabContent');
  if (!content) return;
  // Buttons on click, menus on change
  const run = (ev, wantChange) => {
    const el = ev.target && ev.target.closest && ev.target.closest('[data-action]');
    if (!el || !content.contains(el) || (el.tagName === 'SELECT') !== wantChange) return;
    const action = COMPARE_ACTIONS[el.dataset.action];
    if (!action) return;
    ev.stopPropagation();
    Promise.resolve(action(compareActionContext(el))).catch(err => console.error('Compare action failed:', err));
  };
  content.addEventListener('click', ev => run(ev, false));
  content.addEventListener('change', ev => run(ev, true));
})();

// Adds the other reviewer's audit trail entries (skipping ids we already have) so the shared trail shows both reviewers.
// Called automatically the first time something from that reviewer is adopted, and by the "Merge Audit Logs" button.
async function mergePeerAuditLogs() {
  const cmp = state.peerComparison;
  if (!cmp || !cmp.peerData) return 0;
  let added = 0;
  // Once merged, a comparison does not merge again (bulk import calls this per construct); ids looked up in a Set
  if (cmp.logsMerged) return 0;
  // All of them and the entry about them in one transaction (and in the trail, newest first)
  const r = opMergePeerLogs(state, { logs: cmp.peerData.logs || [], peerReviewer: cmp.peerReviewer });
  added = r ? r.ops.length : 0;
  await runOperation(r);
  cmp.logsMerged = true;
  if (added) updateAuditBadge();
  return added;
}

// (Peer row id -> local row id: peerRowMapOf, logic.js; two titles naming one row: sameRowTitle)
// Per-row values a 2nd Order construct carries for each row it is placed in (same list as merge / split in matrix.js)
// (peerRowPlacementOps: logic.js)

// Constructs waiting for a peer row that is now here under the same title (a row made here, not imported): placed when a
// file is compared and when the "3rd Order, Model & Logs" tab is opened. Never from inside a render; one run at a time.
async function reattachWaitingByTitle(cmp) {
  if (!cmp || cmp.reattaching) return 0;
  cmp.reattaching = true;
  let total = 0;
  try {
    for (const pc of (cmp.peerData.clusters || [])) {
      if (!state.annotations.some(a => a._peerRows && a._peerRows[pc.id])) continue;
      const local = state.clusters.find(c => c.id === pc.id || sameRowTitle(c.thirdOrderTitle, pc.thirdOrderTitle));
      if (!local) continue;
      const r = opPeerPlacement(state, { peerRowId: pc.id, rowId: local.id, peerReviewer: cmp.peerReviewer, peerTitle: pc.thirdOrderTitle });
      if (!r) continue;
      total += r.ops.filter(o => o.store === 'annotations').length;
      await runOperation(r);
    }
  } finally { cmp.reattaching = false; }
  if (total) showSnackbar(`Placed ${total} construct(s) from @${cmp.peerReviewer} in rows that are here now.`);
  return total;
}

// A row here now has the title of a peer row that constructs are waiting for (it was named or renamed): place them, also
// when Compare is closed. Called when a row title is committed.
async function reattachWaitingForRow(cluster) {
  if (!cluster || !cluster.thirdOrderTitle) return 0;
  const peerIds = new Set();
  state.annotations.forEach(a => Object.entries(a._peerRows || {}).forEach(([pid, w]) => { if (w && sameRowTitle(w._title, cluster.thirdOrderTitle)) peerIds.add(pid); }));
  // One peer row after the other (the next reads the constructs as the last left them); the entry goes with the last write
  const pids = [...peerIds];
  let total = 0;
  for (const [i, pid] of pids.entries()) {
    const r = peerRowPlacementOps(state, pid, cluster.id);
    total += r.count;
    await saveChange(r.ops, i === pids.length - 1 && total ? auditEntry({ kind: 'peer_placement', clusterIds: [cluster.id], category: 'concordance',
      action: `Placed ${total} construct(s) imported from another reviewer in "${cluster.thirdOrderTitle}"`,
      detail: 'They were imported in Compare before a row of this title was here; their judgements and cell notes came with them.' }) : []);
  }
  if (total) {
    showSnackbar(`Placed ${total} imported construct(s) waiting for a row called "${cluster.thirdOrderTitle}".`);
  }
  return total;
}

// Peer construct id -> local id: the matched pairs, and every construct imported in this comparison (an import may have been
// given a new id; matching studies by hand works the pairs out again, and an import must not lose its place in the map)
function peerAnnoMap(cmp) {
  if (!cmp.peerToLocalAnnoId) {
    cmp.peerToLocalAnnoId = {};
    cmp.matchedPairs.forEach(pr => { cmp.peerToLocalAnnoId[pr.peerAnno.id] = pr.localAnno.id; });
    Object.entries(cmp.importedPeerIds || {}).forEach(([p, l]) => { if (state.annotations.some(a => a.id === l)) cmp.peerToLocalAnnoId[p] = l; });
  }
  return cmp.peerToLocalAnnoId;
}
async function importPeerConstruct(item, status, { redraw = true } = {}) {
  const cmp = state.peerComparison;
  // Taken off the list at once, before any wait: a second click (or Import All running) finds it gone and adds nothing twice
  const at = cmp.peerOnlyAnnos.indexOf(item);
  if (at < 0) return;
  cmp.peerOnlyAnnos.splice(at, 1);
  try {
    await importPeerConstructNow(item, status, redraw);
  } catch (err) {
    cmp.peerOnlyAnnos.splice(Math.min(at, cmp.peerOnlyAnnos.length), 0, item); // not imported: it stays on the list
    throw err;
  }
}
// The study and the construct: worked out in logic.js (peerStudyStub, opImportPeerConstruct: id mapping, links waiting on
// both sides, what placing does in the rows), stored here
async function importPeerConstructNow(item, status, redraw) {
  await mergePeerAuditLogs();
  const cmp = state.peerComparison;
  // A study connected earlier in this session (by hand, or as a stub for an earlier import) is reused, never added twice
  let targetDocId = item.localDocId || (item.peerDoc && cmp.docMapPeerToLocal[item.peerDoc.id]) || null;
  if (!targetDocId && item.peerDoc) {
    const stub = peerStudyStub(state, { peerDoc: item.peerDoc, docMap: cmp.docMapPeerToLocal }, OP_NAMES);
    await commitOps([{ store: 'docs', put: stub }]); // (adds it to state.docs)
    targetDocId = stub.id;
    cmp.docMapPeerToLocal[item.peerDoc.id] = stub.id;
    cmp.unmatchedPeerDocs = cmp.unmatchedPeerDocs.filter(x => x.id !== item.peerDoc.id);
    cmp.matchedStudies.push({ localDoc: stub, peerDoc: item.peerDoc, how: 'added' });
    if (!state.loa.baselineDocId) await checkBaselineChange(); // into an empty project: the first study added becomes #1 (as in handleFiles)
    renderStudyList();
  }
  if (!targetDocId) return;

  const r = opImportPeerConstruct(state, { peerAnno: item.peerAnno, docId: targetDocId, status, peerReviewer: cmp.peerReviewer,
    annoMap: peerAnnoMap(cmp), peerClusters: cmp.peerData.clusters || [],
    newId: () => 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) }, OP_NAMES);
  if (!r) return;
  // (adds it to state.annotations; the rows, the waiting quotes and the study change as copies)
  await runOperation(r);
  peerAnnoMap(cmp)[r.peerId] = r.id;
  (cmp.importedPeerIds = cmp.importedPeerIds || {})[r.peerId] = r.id; // kept when the pairs are worked out again

  if (redraw && state.activeDocId === targetDocId) {
    renderHighlights();
    updateSidebar();
  }
}
