// Meta-Ethnography Canvas — Extraction sidebar (Tab 1)
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// 1st / 2nd order cards, quote linking, additional passages, reviewer-wrapped constructs, manual entry and 1st <-> 2nd order switching.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// EXTRACTION SIDEBAR (With Clickable Reviewer Badge)
// ========================================================
// The sidebar is rebuilt after most changes: what the reviewer had open (folded sections) and where the cursor was are put back,
// so a link or a deletion elsewhere does not close what they were reading or move them out of a box.
// An element is identified by the chain of cards it sits in (a quote can appear under several constructs) and its position.
// A key for each box of the sidebar, stable across redraws (the cards it is nested in, its kind, its place among its kind in its
// card). One keyer per snapshot / restore: the boxes of each kind in each card are listed once, not once per box.
function sidebarKeyer(list) {
  const lists = new Map(); // scope element -> Map(selector -> boxes of that kind directly in that card)
  const scopeOf = el => { let s = el.parentElement; while (s && s !== list && !(s.dataset && s.dataset.sidebarAnno)) s = s.parentElement; return s || list; };
  return el => {
    const chain = [];
    for (let n = el.parentElement; n && n !== list; n = n.parentElement) if (n.dataset && n.dataset.sidebarAnno) chain.unshift(n.dataset.sidebarAnno);
    const scope = scopeOf(el);
    const sel = el.tagName === 'DETAILS' ? 'details' : (el.tagName.toLowerCase() + (el.classList[0] ? '.' + CSS.escape(el.classList[0]) : ''));
    if (!lists.has(scope)) lists.set(scope, new Map());
    const bySel = lists.get(scope);
    // only those whose nearest card is the same scope (not those of a nested card)
    if (!bySel.has(sel)) bySel.set(sel, [...scope.querySelectorAll(sel)].filter(x => scopeOf(x) === scope));
    return `${chain.join('>') || 'root'}|${sel}|${bySel.get(sel).indexOf(el)}`;
  };
}
let sidebarStateDocId = null;
function snapshotSidebarState(list) {
  const key = sidebarKeyer(list);
  const open = new Set(), closed = new Set();
  list.querySelectorAll('details').forEach(d => (d.open ? open : closed).add(key(d)));
  const a = document.activeElement;
  const focus = a && list.contains(a) && a !== list ? { key: key(a), start: a.selectionStart, end: a.selectionEnd, top: a.scrollTop } : null;
  return { docId: sidebarStateDocId, open, closed, focus };
}
function restoreSidebarState(list, snap) {
  if (!snap) return;
  const key = sidebarKeyer(list);
  const sameDoc = snap.docId === state.activeDocId;
  list.querySelectorAll('details').forEach(d => {
    const k = key(d);
    if (!sameDoc && !k.startsWith('root|')) return; // another study: only the study-wide boxes keep their state
    if (snap.open.has(k)) d.open = true; else if (snap.closed.has(k)) d.open = false;
  });
  if (sameDoc && snap.focus) {
    // Only boxes of the focused one's kind are candidates
    const kind = snap.focus.key.split('|')[1];
    let cands = [];
    try { cands = [...list.querySelectorAll(kind)]; } catch (e) { cands = []; }
    const el = cands.find(x => key(x) === snap.focus.key);
    if (el && el.offsetParent !== null) {
      el.focus({ preventScroll: true });
      try { if (typeof snap.focus.start === 'number' && el.setSelectionRange) el.setSelectionRange(snap.focus.start, snap.focus.end); } catch (e) { /* not a text box */ }
      if (snap.focus.top) el.scrollTop = snap.focus.top;
    }
  }
}

function updateSidebar() {
  flushAllPendingSaves(); // a label or note being typed is committed (saved + logged) before its box is rebuilt
  const list = document.getElementById('annotationsList');
  const prevScrollTop = list ? list.scrollTop : 0;
  const sidebarSnap = list ? snapshotSidebarState(list) : null;
  sidebarStateDocId = state.activeDocId;
  list.innerHTML = '';
  const annos = state.annotations.filter(a => a.docId === state.activeDocId).map(normalizeAnnotation);
  const firsts = annos.filter(a => a.type === 'first_order');
  const seconds = annos.filter(a => a.type === 'second_order');
  const activeDoc = state.docs.find(d => d.id === state.activeDocId);

  if (seconds.length === 0 && firsts.length === 0) {
    list.innerHTML = `
      <div class="text-xs text-slate-400 text-center py-8 px-4 space-y-2">
        <i class="ph ph-highlighter-circle text-2xl text-slate-300"></i>
        <div class="font-semibold text-slate-500">No quotes or concepts extracted from this study yet</div>
        <div class="text-[13px] leading-relaxed">Select any text in the PDF viewer to tag <span class="text-blue-700 font-semibold">🟦 1st Order (Participant Quotes)</span> or <span class="text-emerald-700 font-semibold">🟩 2nd Order (Author Interpretations)</span>.</div>
      </div>
    `;
    prependStudyOverviewNudge(list, activeDoc);
    restoreSidebarState(list, sidebarSnap);
    return;
  }


  seconds.forEach(sec => {
    const linked = firsts.filter(f => isQuoteLinkedTo(f, sec.id));
    const w = document.createElement('div');
    w.className = 'mb-3 bg-white border border-emerald-200 rounded-lg shadow-sm overflow-hidden transition';
    w.dataset.sidebarAnno = sec.id;

    w.ondragover = e => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('text/merge-sec-id')) w.classList.add('ring-2', 'ring-violet-500');
      else w.classList.add('ring-2', 'ring-emerald-400');
    };
    w.ondragleave = () => w.classList.remove('ring-2', 'ring-emerald-400', 'ring-violet-500');
    w.ondrop = async e => {
      e.preventDefault();
      w.classList.remove('ring-2', 'ring-emerald-400', 'ring-violet-500');
      const mergeId = e.dataTransfer.getData('text/merge-sec-id');
      if (mergeId) {
        const src = state.annotations.find(x => x.id === mergeId && x.type === 'second_order');
        if (src && src.id !== sec.id && src.docId === sec.docId) await absorbAsPassage(src, sec);
        return;
      }
      const id = e.dataTransfer.getData('text/anno-id');
      const f = state.annotations.find(x => x.id === id);
      if (f && f.type === 'first_order' && await linkQuoteToConstruct(f, sec)) updateSidebar();
    };

    const cBadge = getConcordanceBadgeMeta(sec.concordanceStatus);
    const showConcUI = state.teamMode || sec.concordanceStatus !== 'pending' || Boolean(sec.concordanceNote);

    w.innerHTML = `
      <div class="px-2.5 py-1.5 bg-emerald-50 border-b border-emerald-100 flex justify-between items-center">
        <span class="text-xs font-bold text-emerald-800 flex items-center flex-wrap gap-1">
          <span class="merge-drag-handle cursor-grab active:cursor-grabbing text-emerald-600 hover:text-violet-700" draggable="true" title="Drag onto another 2nd Order construct of this study if this is the SAME author interpretation stated elsewhere in the paper: it becomes an additional evidence passage of that construct (can be split off again)."><i class="ph ph-dots-six-vertical text-sm"></i></span>
          <span>🟩 2nd Order</span>
          ${sec.passages.length ? `<span class="text-[10.5px] px-1.5 py-px rounded border border-violet-300 bg-violet-50 text-violet-800 font-semibold" title="Stated in ${sec.passages.length + 1} places in the paper">📑 ${sec.passages.length + 1} passages</span>` : ''}
          ${sec.origin === 'wrapped_first_order' ? `<span class="text-[10.5px] px-1.5 py-px rounded border border-amber-400 bg-amber-100 text-amber-900 font-semibold" title="No author-stated interpretation was captured. The reviewer wrapped a 1st order quote (participant data) in a 2nd order construct and wrote the label themselves (@${escapeHtml(sec.by || '')}).">🏷 Reviewer-wrapped from 1st-order quote</span>` : ''}
          <button type="button" class="jump-pdf-btn text-xs bg-emerald-200/80 hover:bg-emerald-300 text-emerald-950 px-1.5 py-px rounded-full font-bold cursor-pointer transition flex items-center space-x-0.5" title="Jump to PDF page ${escapeHtml(sec.page)}"><i class="ph ph-crosshair"></i><span>p.${escapeHtml(sec.page)}</span></button>
          <button type="button" class="rev-badge-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 hover:text-indigo-800 px-1.5 py-px rounded font-mono cursor-pointer transition" title="Click to change reviewer for this construct">@${escapeHtml(sec.by || 'Unknown')}</button>
          <span class="text-xs bg-white border border-emerald-200 px-1.5 rounded-full">${linked.length} quotes</span>
          <span class="concordance-pill text-[11px] px-1.5 py-px rounded border font-semibold ${cBadge.cls} ${showConcUI ? '' : 'hidden'}">${cBadge.label}</span>
        </span>
        <div class="flex items-center space-x-1">
          <button type="button" class="toggle-order-btn text-[11px] text-blue-700 hover:bg-blue-100 border border-blue-200 bg-white px-1.5 py-0.5 rounded font-semibold cursor-pointer flex items-center space-x-0.5" title="Switch this construct to a 1st Order Participant Quote"><i class="ph ph-arrows-left-right"></i><span>To 1st</span></button>
          <button type="button" class="edit-quote-btn text-xs text-emerald-800 hover:bg-emerald-100 px-1.5 py-0.5 rounded font-semibold cursor-pointer flex items-center space-x-0.5" title="Edit extracted quote text (clean up 2-column PDF line breaks or headers)"><i class="ph ph-pencil-simple"></i><span>Edit Quote</span></button>
          <button data-action="delete" class="del text-slate-400 hover:text-rose-500 cursor-pointer" title="Delete 2nd Order Construct"><i class="ph ph-trash"></i></button>
        </div>
      </div>
      <div class="p-2.5 space-y-1.5">
        <label class="block text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-0.5 mt-1">${sec.origin === 'wrapped_first_order' ? "Reviewer's own label (wraps a participant quote — not the authors' interpretation)" : "Authors' own term for this concept (leave blank if they name none)"}</label>
        <textarea class="sec-note-input w-full text-[13px] font-bold text-slate-800 border border-emerald-300 p-2 rounded bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y min-h-[48px]" placeholder="${sec.origin === 'wrapped_first_order' ? 'Your label for this quote (a reviewer wording)…' : 'Use the authors\' own term. If you paraphrase, switch the source below to Reviewer wording.'}">${escapeHtml(sec.note)}</textarea>
        ${sec.origin === 'wrapped_first_order' ? '' : `<div class="flex items-center gap-1.5 text-[11px] text-slate-500"><span>Label source:</span><select data-action="label-source" class="sec-notesrc text-[11px] border border-slate-300 rounded px-1 py-0.5 bg-white"><option value="author" ${sec.noteSource === 'author' ? 'selected' : ''}>Authors\' own term</option><option value="reviewer" ${sec.noteSource === 'reviewer' ? 'selected' : ''}>Reviewer wording (paraphrase)</option></select></div>`}
        
        <div class="mt-2">
          <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Original Source Passage (Evidence)</label>
          ${sec.text ? `<div class="sec-quote-display text-[11.5px] text-slate-500 italic bg-slate-50 p-1.5 rounded border border-slate-200 leading-snug cursor-pointer hover:border-emerald-300" title="Double-click or click 'Edit Quote' to clean up original text">"${escapeHtml(sec.text)}"</div>` : `<div class="sec-quote-display text-[11.5px] text-slate-400 italic bg-slate-50 p-1.5 rounded border border-slate-200 cursor-pointer">(No evidence quote attached. Click 'Edit Quote' to add)</div>`}
          ${sec.passages.length ? `<div class="mt-1.5 space-y-1">
            <div class="text-[10px] font-bold text-violet-700 uppercase tracking-wider">Same interpretation stated elsewhere (${sec.passages.length})</div>
            ${sec.passages.map(p => `<div class="sec-passage text-[11.5px] text-slate-500 italic bg-violet-50/50 p-1.5 rounded border border-violet-200 leading-snug" data-pid="${escapeHtml(p.id)}">
              <div class="flex items-center justify-between not-italic mb-0.5 gap-1">
                <button type="button" class="passage-jump text-[11px] bg-violet-100 hover:bg-violet-200 text-violet-900 px-1.5 rounded-full font-bold cursor-pointer"><i class="ph ph-crosshair"></i> p.${escapeHtml(p.page)}</button>
                <span class="flex items-center gap-1">
                  <button type="button" data-action="passage-split" class="passage-split text-[11px] text-violet-700 hover:bg-violet-100 border border-violet-200 bg-white px-1.5 rounded cursor-pointer" title="This passage is actually a different interpretation: make it a separate 2nd Order construct again">↗ Split off</button>
                  <button type="button" data-action="passage-remove" class="passage-del text-slate-400 hover:text-rose-500 cursor-pointer" title="Remove this passage"><i class="ph ph-x"></i></button>
                </span>
              </div>"${escapeHtml(p.text)}"</div>`).join('')}
          </div>` : ''}
        </div>
        
        <div class="sec-quote-editor hidden space-y-1 bg-amber-50/50 p-1.5 rounded border border-amber-200 mt-1">
          <div class="flex items-center justify-between text-[11px] font-semibold text-amber-900">
            <span>✏️ Edit original source quote (Evidence)</span>
          </div>
          <textarea class="sec-quote-textarea w-full text-[13px] border border-amber-300 rounded p-1.5 bg-white focus:outline-none focus:border-indigo-500 resize-y h-20">${escapeHtml(sec.text)}</textarea>
          <div class="flex justify-end space-x-1">
            <button type="button" class="sec-quote-cancel px-2 py-0.5 text-xs bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-100 cursor-pointer">Cancel</button>
            <button type="button" class="sec-quote-save px-2.5 py-0.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded cursor-pointer">Save Text</button>
          </div>
        </div>
        
        <!-- Private Nuance / Translation Helper Memo (NOT logged in Audit Trail) -->
        <details class="bg-sky-50/60 border border-sky-200/80 rounded p-1.5" ${sec.nuanceNote ? 'open' : ''}>
          <summary class="text-xs font-semibold text-sky-800 cursor-pointer select-none flex items-center justify-between">
            <span>🌐 Reading & Nuance Notes</span>
            <span class="text-[11px] font-normal text-sky-600">(Private)</span>
          </summary>
          <textarea class="sec-nuance-input w-full mt-1 text-[13px] border border-sky-200 rounded p-1.5 bg-white focus:outline-none focus:border-sky-500 resize-y h-14" placeholder="Personal reading notes, key metaphors, or language nuances (saved privately, not added to the Audit Trail)...">${escapeHtml(sec.nuanceNote)}</textarea>
        </details>

        <!-- Team Concordance / Co-Reviewer Agreement (Shown in Team Mode or when non-pending) -->
        <details class="bg-indigo-50/40 border border-indigo-200/70 rounded p-1.5 ${showConcUI ? '' : 'hidden'}" ${(sec.concordanceStatus !== 'pending' || sec.concordanceNote) ? 'open' : ''}>
          <summary class="text-xs font-semibold text-indigo-900 cursor-pointer select-none flex items-center justify-between">
            <span>🤝 Team Perspectives</span>
            <span class="text-[11px] font-normal text-indigo-600">(Logs to Trail)</span>
          </summary>
          <div class="mt-1.5 space-y-1.5">
            <div class="flex items-center space-x-1.5">
              <label class="text-xs text-slate-600 font-medium shrink-0">Status:</label>
              <select data-action="construct-team" class="sec-conc-status flex-1 text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white font-semibold">
                <option value="pending" ${sec.concordanceStatus === 'pending' ? 'selected' : ''}>⏳ Pending Review</option>
                <option value="discuss" ${sec.concordanceStatus === 'discuss' ? 'selected' : ''}>💬 Needs Discussion</option>
                <option value="agreed" ${sec.concordanceStatus === 'agreed' ? 'selected' : ''}>✅ Agreed (for now)</option>
              </select>
            </div>
            <input type="text" class="sec-conc-note w-full text-xs border border-slate-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-indigo-500" placeholder="Team discussion note (press Enter to save to Audit Trail)..." value="${escapeHtml(sec.concordanceNote)}">
          </div>
        </details>

        <div class="mt-2 space-y-1.5 child-list"></div>
      </div>
    `;

    w.querySelector('.jump-pdf-btn').onclick = () => jumpToPdfAnnotation(sec.id);
    w.querySelectorAll('.sec-passage').forEach(el => {
      const pid = el.dataset.pid;
      const p = sec.passages.find(x => x.id === pid);
      if (!p) return;
      el.querySelector('.passage-jump').onclick = () => jumpToPdfAnnotation(sec.id, p.firstPage || parseInt(p.page, 10));
    });
    w.querySelector('.merge-drag-handle').ondragstart = e => {
      e.dataTransfer.setData('text/merge-sec-id', sec.id);
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    };
    w.querySelector('.rev-badge-btn').onclick = () => promptReassignItemReviewer(sec, 'annotations', updateSidebar);
    w.querySelector('.toggle-order-btn').onclick = () => toggleAnnotationOrderType(sec.id);

    const quoteDisplay = w.querySelector('.sec-quote-display');
    const quoteEditor = w.querySelector('.sec-quote-editor');
    const quoteTextarea = w.querySelector('.sec-quote-textarea');
    const toggleSecEditor = (open) => {
      quoteDisplay.classList.toggle('hidden', open);
      quoteEditor.classList.toggle('hidden', !open);
      if (open) { quoteTextarea.value = sec.text; quoteTextarea.focus(); }
    };
    w.querySelector('.edit-quote-btn').onclick = () => toggleSecEditor(quoteEditor.classList.contains('hidden'));
    quoteDisplay.ondblclick = () => toggleSecEditor(true);
    w.querySelector('.sec-quote-cancel').onclick = () => toggleSecEditor(false);
    w.querySelector('.sec-quote-save').onclick = async () => {
      if (await saveExtractedText(sec, cleanAnnotationText(sec, quoteTextarea.value))) {
        quoteDisplay.textContent = `"${sec.text}"`;
        renderHighlights();
      }
      toggleSecEditor(false);
    };

    bindTextField(w.querySelector('.sec-note-input'), {
      get: () => sec.note, set: v => { sec.note = v; }, record: () => ({ store: 'annotations', put: sec }),
      log: (oldNote, newNote) => auditEntry({
        kind: 'construct_label',
        clusterIds: liveClusterIds(sec), // rows that still exist; none for an unplaced construct
        category: 'matrix_mapping',
        action: `Updated 2nd Order Summary Label (${studyNameOf(sec)})`,
        fromVal: oldNote || '(None)',
        toVal: newNote
      })
    });
    // (label source, team status, deleting: SIDEBAR_ACTIONS)
    // The construct's private memo: saved while typed and when left (a working note, no audit entry)
    bindTextField(w.querySelector('.sec-nuance-input'), { get: () => sec.nuanceNote, set: v => { sec.nuanceNote = v; }, record: () => ({ store: 'annotations', put: sec }) });

    // The team note commits like the status menu (SIDEBAR_ACTIONS['construct-team'])
    bindPendingCommit(w.querySelector('.sec-conc-note'), () => SIDEBAR_ACTIONS['construct-team'](sidebarActionContext(w.querySelector('.sec-conc-status'))));

    const clist = w.querySelector('.child-list');
    linked.forEach(f => clist.appendChild(makeFirstCard(f, true, sec, seconds)));
    list.appendChild(w);
  });

  const secIdSet = new Set(seconds.map(s => s.id));
  // Only quotes not yet linked to any construct of this study (linked quotes are shown under their construct(s))
  const unlinked = firsts.filter(f => !quoteParentIds(f).some(id => secIdSet.has(id)));
  if (unlinked.length > 0) {
    const header = document.createElement('div');
    header.className = 'text-xs font-bold text-slate-500 mt-4 mb-2 uppercase tracking-wider flex items-center justify-between bg-blue-50/80 px-2 py-1 rounded border border-blue-200/60';
    header.innerHTML = `<span>🟦 Unlinked 1st Order Quotes (${unlinked.length})</span><span class="text-[11px] font-normal text-blue-700">Use Dropdown or Drag to Link</span>`;
    list.appendChild(header);
    unlinked.forEach(f => list.appendChild(makeFirstCard(f, false, null, seconds)));
  }
  const overviewBox = prependStudyOverviewNudge(list, activeDoc);
  const linksBox = buildStudyConceptLinksBox(activeDoc, seconds);
  if (linksBox && overviewBox) overviewBox.after(linksBox);
  restoreSidebarState(list, sidebarSnap);
  if (list) list.scrollTop = prevScrollTop;
}

// Phase 3–4 bridge: remind the reviewer to read the account as a whole before / while breaking it into constructs
function prependStudyOverviewNudge(list, doc) {
  if (!list || !doc) return;
  const box = document.createElement('div');
  if (doc.studyOverview) {
    box.className = 'mb-3 text-xs bg-violet-50/70 border border-violet-200 rounded-lg p-2';
    box.innerHTML = `<details><summary class="font-semibold text-violet-900 cursor-pointer select-none">📖 Study Overview / Key Metaphors</summary><div class="mt-1 text-slate-700 whitespace-pre-wrap leading-snug">${escapeHtml(doc.studyOverview)}</div></details>`;
  } else {
    box.className = 'mb-3 text-xs bg-violet-50 border border-dashed border-violet-300 rounded-lg p-2 text-violet-900 flex items-start gap-2';
    box.innerHTML = `<i class="ph ph-book-open-text text-base shrink-0"></i><div class="flex-1 leading-snug"><b>Read the whole account first.</b> Write this study's storyline and key metaphors (and how they relate) before splitting it into constructs. <button type="button" class="open-overview-btn underline font-semibold cursor-pointer">Write Study Overview</button></div>`;
    box.querySelector('.open-overview-btn').onclick = () => {
      state.isEditMetaMode = true;
      toggleMetaDockUI();
      const ta = document.getElementById('metaStudyOverview');
      if (ta) { ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); ta.focus(); }
    };
  }
  list.prepend(box);
  return box;
}

// ========================================================
// HOW THIS STUDY'S CONCEPTS RELATE (within one account)
// Noblit & Hare: keep each account whole; eMERGe criterion 13: describe how relationships between concepts WITHIN
// and across studies were preserved in translation. Stored on the study: doc.conceptLinks = [{ id, from, to, type, note }]
// between its own 2nd Order constructs, with the same relation types as the line-of-argument map.
// ========================================================
let conceptLinksOpen = false; // remembered while the page is open
function studyConceptLinks(doc) {
  if (!Array.isArray(doc.conceptLinks)) doc.conceptLinks = [];
  const live = new Set(state.annotations.filter(a => a.type === 'second_order' && a.docId === doc.id).map(a => a.id));
  return doc.conceptLinks.filter(l => live.has(l.from) && live.has(l.to));
}
function conceptLinkText(l) {
  const lab = id => { const s = state.annotations.find(a => a.id === id); return s ? secShortLabel(s) : '(removed)'; };
  const t = LINK_TYPES[l.type] || LINK_TYPES.leads;
  return `${lab(l.from)} ${t.sym} ${lab(l.to)}`;
}
function buildStudyConceptLinksBox(doc, seconds) {
  if (!doc || seconds.length < 2) return null;
  const links = studyConceptLinks(doc);
  const box = document.createElement('details');
  box.className = 'study-links mb-3 text-xs bg-white border border-violet-200 rounded-lg p-2';
  box.open = conceptLinksOpen;
  box.addEventListener('toggle', () => { conceptLinksOpen = box.open; });
  const opt = s => `<option value="${escapeHtml(s.id)}">${escapeHtml(secShortLabel(s).slice(0, 60))}</option>`;
  box.innerHTML = `
    <summary class="font-semibold text-violet-900 cursor-pointer select-none">🔗 How this study's concepts relate <span class="font-normal text-violet-700">(${links.length})</span></summary>
    <div class="mt-1 text-[11px] text-slate-500 leading-snug">Keep the account whole: record how the authors' concepts relate to one another in this study, so the relationships can be kept in view when you translate (eMERGe criterion 13). Reported in Appendix C.</div>
    <ul class="mt-1.5 space-y-1">${links.map(l => `<li class="flex items-start gap-1.5"><span class="flex-1 text-slate-700"><b style="color:${(LINK_TYPES[l.type] || LINK_TYPES.leads).color}">${escapeHtml(conceptLinkText(l))}</b>${l.note ? ` <span class="text-slate-500">— ${escapeHtml(l.note)}</span>` : ''}</span><button type="button" data-action="concept-unlink" class="del-link text-slate-400 hover:text-rose-500 cursor-pointer" data-id="${escapeHtml(l.id)}" title="Remove this relationship"><i class="ph ph-x"></i></button></li>`).join('') || '<li class="text-slate-400">None recorded yet.</li>'}</ul>
    <div class="mt-2 grid grid-cols-1 gap-1">
      <select class="cl-from border border-slate-300 rounded px-1 py-0.5 bg-white">${seconds.map(opt).join('')}</select>
      <select class="cl-type border border-slate-300 rounded px-1 py-0.5 bg-white">${Object.entries(LINK_TYPES).map(([k, t]) => `<option value="${k}">${t.sym} ${escapeHtml(t.label)}</option>`).join('')}</select>
      <select class="cl-to border border-slate-300 rounded px-1 py-0.5 bg-white">${seconds.map(opt).join('')}</select>
      <input type="text" class="cl-note border border-slate-300 rounded px-1.5 py-0.5" placeholder="In the authors' account… (optional; page or reason)">
      <button type="button" data-action="concept-link" class="cl-add px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded cursor-pointer">Add relationship</button>
    </div>`;
  if (seconds[1]) box.querySelector('.cl-to').value = seconds[1].id;
  // (adding and removing a relationship: SIDEBAR_ACTIONS)
  return box;
}

// ========================================================
// CHANGES OF ONE QUOTE OR CONSTRUCT (used by Tab 1 and Tab 2 alike)
// Each saves the changed copy and its audit entry in one transaction (saveChange); `state` follows once stored.
// ========================================================
// The operations are worked out in logic.js (opLinkQuote …) and run by runOperation: the changed copy and its audit entry in
// one transaction; `state` follows once stored. Each returns false when there was nothing to change.
function linkQuoteToConstruct(f, sec) { return runOperation(opLinkQuote(state, { quoteId: f.id, secId: sec.id }, OP_NAMES)); }
function saveExtractedText(anno, text) { return runOperation(opExtractedText(state, { annoId: anno.id, text }, OP_NAMES)); }
// (entry: { action } for another wording of the entry, e.g. from Compare)
function setConstructTeamStatus(sec, status, note, entry = {}) {
  return runOperation(opConstructTeamStatus(state, { secId: sec.id, status, note, action: entry.action }, OP_NAMES));
}

// ======================= What the sidebar's buttons and menus do =======================
// The cards only draw: a button or menu carries data-action, and one listener on the list runs the action named here with
// the card it belongs to (the quote or construct; for a quote inside a construct's card, that construct too).
function sidebarActionContext(el) {
  const card = el.closest('[data-sidebar-anno]');
  const outer = card && card.parentElement ? card.parentElement.closest('[data-sidebar-anno]') : null;
  const anno = card ? state.annotations.find(a => a.id === card.dataset.sidebarAnno) || null : null;
  const parent = outer ? state.annotations.find(a => a.id === outer.dataset.sidebarAnno && a.type === 'second_order') || null : null;
  const passage = el.closest('.sec-passage');
  return { el, anno, parent, pid: passage ? passage.dataset.pid : null, doc: state.docs.find(d => d.id === state.activeDocId) || null };
}
/** @type {Record<string, (ctx: any) => any>} */
const SIDEBAR_ACTIONS = {
  delete: async ({ anno }) => {
    if (!anno) return;
    if (anno.type === 'second_order') { await deleteSecondOrder(anno); return; }
    const name = studyNameOf(anno);
    await runOperation(project => opDeleteQuote(project, { quoteId: anno.id }, OP_NAMES), { undo: { label: `1st Order Quote (p.${anno.page})`,
      undoLogs: [{ kind: 'quote_restore', category: 'reading_extraction', action: `Restored a deleted 1st Order quote (Undo): ${name}, p.${anno.page}`, detail: `"${String(anno.text || '').slice(0, 80)}..."` }] } });
    updateSidebar();
    renderHighlights();
    showUndoSnackbar('Deleted the 1st Order quote');
  },
  'quote-link': async ({ anno, el }) => {
    const target = state.annotations.find(x => x.id === el.value);
    if (anno && target && await linkQuoteToConstruct(anno, target)) updateSidebar();
  },
  'quote-unlink': async ({ anno, parent }) => { if (anno && await runOperation(opUnlinkQuote(state, { quoteId: anno.id, secId: parent ? parent.id : null }))) updateSidebar(); },
  'quote-wrap': async ({ anno }) => { if (anno && await wrapFirstOrderInSecondOrder(anno)) updateSidebar(); },
  'label-source': ({ anno, el }) => anno && runOperation(opLabelSource(state, { secId: anno.id, source: el.value }, OP_NAMES)),
  'construct-team': async ({ anno, el }) => {
    const w = el.closest('[data-sidebar-anno]');
    const status = el.value;
    if (!anno || !(await setConstructTeamStatus(anno, status, w.querySelector('.sec-conc-note').value.trim()))) return;
    const pill = w.querySelector('.concordance-pill');
    const meta = getConcordanceBadgeMeta(status);
    if (pill) { pill.className = `concordance-pill text-[11px] px-1.5 py-px rounded border font-semibold ${meta.cls}`; pill.textContent = meta.label; }
  },
  'passage-remove': ({ anno, pid }) => anno && pid && removePassage(anno, pid),
  'passage-split': ({ anno, pid }) => anno && pid && splitOffPassage(anno, pid),
  'concept-link': async ({ el, doc }) => {
    const box = el.closest('.study-links');
    if (!doc || !box) return;
    const from = box.querySelector('.cl-from').value, to = box.querySelector('.cl-to').value, type = box.querySelector('.cl-type').value;
    const note = box.querySelector('.cl-note').value.trim();
    if (!from || !to || from === to) { showSnackbar('Choose two different concepts.'); return; }
    // (for a relation without direction, B–A is the same as A–B: relationKey, as in the backup merge)
    const key = relationKey({ from, to, type });
    if (studyConceptLinks(doc).some(l => relationKey(l) === key)) { showSnackbar('This relationship is already recorded.'); return; }
    const link = { id: 'cl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), from, to, type, note };
    if (!(await runOperation(opAddConceptLink(state, { docId: doc.id, link, text: conceptLinkText(link) }, OP_NAMES)))) return;
    conceptLinksOpen = true;
    updateSidebar();
  },
  'concept-unlink': async ({ el, doc }) => {
    const link = doc && (doc.conceptLinks || []).find(l => l.id === el.dataset.id);
    if (!link) return;
    // Undoable (Ctrl+Z), so it does not ask first
    const text = conceptLinkText(link);
    const name = getDisplayName(doc);
    await runOperation(project => opRemoveConceptLink(project, { docId: doc.id, linkId: link.id, text }, OP_NAMES), { undo: { label: `Relationship within ${name}`,
      undoLogs: [{ kind: 'within_study_link', category: 'reading_extraction', action: `Restored a relationship between concepts within ${name} (Undo)`, toVal: text + (link.note ? ' — ' + link.note : '') }] } });
    updateSidebar();
    showUndoSnackbar('Relationship removed');
  }
};
(() => {
  const list = document.getElementById('annotationsList');
  if (!list) return;
  // Buttons on click, menus on change; dragging, text boxes and the editors' own buttons are not touched here
  const run = (ev, wantChange) => {
    const el = ev.target && ev.target.closest && ev.target.closest('[data-action]');
    if (!el || !list.contains(el) || (el.tagName === 'SELECT') !== wantChange) return;
    const action = SIDEBAR_ACTIONS[el.dataset.action];
    if (!action) return;
    ev.stopPropagation();
    Promise.resolve(action(sidebarActionContext(el))).catch(err => console.error('Sidebar action failed:', err));
  };
  list.addEventListener('click', ev => run(ev, false));
  list.addEventListener('change', ev => run(ev, true));
})();

// ========================================================
// ONE AUTHOR INTERPRETATION, SEVERAL PASSAGES
// Authors often state the same interpretation in several places (abstract, findings, discussion).
// These are kept as additional evidence passages of ONE 2nd order construct — no concepts are merged.
// ========================================================
function newPassageId() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
// Deleting a 2nd Order construct: its quotes' links to it and its within-study relationships (Appendix C) go with it;
// Ctrl+Z puts all of it back (a change: beginChange / finishChange)
async function deleteSecondOrder(sec) {
  const linked = quotesOf(sec.id);
  const docName = studyNameOf(sec);
  await runOperation(project => opDeleteConstruct(project, { secId: sec.id }, OP_NAMES), { undo: { label: `2nd Order Construct (${sec.note || sec.text.slice(0, 30)})`,
    undoLogs: [{ kind: 'construct_restore', category: 'reading_extraction', action: `Restored a deleted 2nd Order construct (Undo): ${docName}, p.${sec.page}`,
      detail: `${sec.note ? sec.note + ': ' : ''}"${String(sec.text || '').slice(0, 80)}..."`, clusterIds: [...(sec.clusterIds || [])] }] } });
  updateSidebar();
  renderHighlights();
  showUndoSnackbar(`Deleted the 2nd Order construct${linked.length ? ` (${linked.length} quote(s) unlinked)` : ''}`);
}
// An undoable change of constructs / quotes (passages): begun before they change, finished (finishChange) once written.
// Its undoing belongs to the history of the rows the constructs are placed in.
function annoUndo(label, annos) {
  const rows = [...new Set(annos.flatMap(a => (a.type === 'second_order' && a.clusterIds) || []))];
  return { label, undoLogs: [{ kind: 'undo_extraction', category: 'reading_extraction', action: `Undid: ${label}`, detail: '', clusterIds: rows }] };
}
function beginAnnoChange(label, annos) {
  const u = annoUndo(label, annos);
  return beginChange(label, annos.map(a => ({ store: 'annotations', id: a.id })), { undoLogs: u.undoLogs });
}
function secShortLabel(s) { return s.note || ('"' + (s.text || '').slice(0, 40) + '…"'); }

// From a PDF selection: add the selected text as another passage of an existing construct
async function addSelectionAsPassage(secId) {
  const sec = state.annotations.find(a => a.id === secId && a.type === 'second_order');
  if (!sec || !state.pendingSelection?.txt) return;
  normalizeAnnotation(sec);
  const p = {
    id: newPassageId(),
    text: stripOuterQuotes(state.pendingSelection.txt),
    page: state.pendingSelection.page,
    firstPage: state.pendingSelection.firstPage,
    rectsMap: state.pendingSelection.rectsMap,
    by: state.reviewerId || 'Reviewer',
    addedAt: new Date().toISOString()
  };
  await runOperation(project => opAddPassage(project, { secId: sec.id, passage: p }, OP_NAMES), { undo: annoUndo(`Added passage to "${secShortLabel(sec)}"`, [sec]) });
  document.getElementById('selectionTooltip').classList.add('hidden');
  window.getSelection().removeAllRanges();
  renderHighlights();
  updateSidebar();
  showSnackbar(`Added as passage of "${secShortLabel(sec)}"`);
}

// From an existing construct (tagged separately before): make it a passage of another construct of the same study
async function absorbAsPassage(source, target) {
  normalizeAnnotation(source); normalizeAnnotation(target);
  const doc = state.docs.find(d => d.id === target.docId);
  const ok = await askChoice({
    title: `The same interpretation, stated elsewhere in ${getDisplayName(doc)}?`,
    body: `${secShortLabel(source)} (p.${source.page})\n→ becomes a further passage of: ${secShortLabel(target)} (p.${target.page})\n\n` +
      `Use this only for repeated statements of one interpretation. Different interpretations — even closely related ones — should stay separate constructs; describe how they relate in the Study Overview.\n\n` +
      `Its quotes and matrix placements move with it, and it can be split off again (↗) at any time.`,
    choices: [{ value: 'yes', tone: 'primary', label: 'Yes, the same interpretation: make it a further passage' }],
    cancelLabel: 'No, keep them separate'
  });
  if (!ok) return;
  const children = quotesOf(source.id);
  const change = beginAnnoChange(`Passage attach: "${secShortLabel(source)}" → "${secShortLabel(target)}"`, [target, source, ...children]);

  const addedClusterIds = source.clusterIds.filter(cid => !target.clusterIds.includes(cid));
  const movedQuoteIds = children.filter(f => !isQuoteLinkedTo(f, target.id)).map(f => f.id);
  // The detached construct is kept whole inside the passage so that "Split off" can restore it exactly
  const sourceSnapshot = JSON.parse(JSON.stringify(source));
  const ownPassages = sourceSnapshot.passages || [];
  sourceSnapshot.passages = [];
  // Built on copies: the constructs and quotes in memory change once all of it is stored
  const tgt = { ...target, clusterIds: [...(target.clusterIds || [])], passages: [...(target.passages || [])] };
  tgt.passages.push({
    id: newPassageId(),
    text: source.text, page: source.page,
    firstPage: source.firstPage || parseInt(source.page, 10) || null,
    rectsMap: source.rectsMap || null,
    by: source.by, addedAt: new Date().toISOString(),
    // ownPassageIds: its own further passages, listed after it in the target; "Split off" takes them back with it
    absorbed: { snapshot: sourceSnapshot, addedClusterIds, movedQuoteIds, ownPassageIds: ownPassages.map(x => x.id) }
  }, ...ownPassages);

  addedClusterIds.forEach(cid => putIntoRow(tgt, cid, rowFieldsOf(source, cid))); // with the source's judgement, note and mark there
  // (Its within-study relationships (Appendix C) stay on the study under its id: hidden while it is a passage, back when split off)
  /** @type {DbOp[]} */
  const ops = children.map(f => { const q = { ...f, parentIds: [...quoteParentIds(f)] }; unlinkQuote(q, source.id); linkQuote(q, target.id); return { store: 'annotations', put: q }; });
  ops.push({ store: 'annotations', put: tgt }, { store: 'annotations', del: source.id });
  // Its quotes, both constructs and the entry in one transaction
  await saveChange(ops, auditEntry({
    kind: 'passage_absorb',
    category: 'reading_extraction',
    action: `Recorded p.${source.page} as a further passage of 2nd Order construct "${secShortLabel(target)}" (${getDisplayName(doc)})`,
    detail: `The authors state the same interpretation in several places. Former separate construct: ${secShortLabel(source)}. ` +
      `${children.length} linked quote(s) and ${addedClusterIds.length} matrix placement(s) moved with it.`,
    fromVal: `${secShortLabel(target)} + ${secShortLabel(source)}`,
    toVal: `${secShortLabel(target)} (${tgt.passages.length} passages)`
  }));
  finishChange(change);
  updateSidebar();
  renderHighlights();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  showSnackbar(`Now one construct with ${tgt.passages.length} passages — Ctrl+Z to undo`);
}

// The passage turns out to be a different interpretation: make it its own construct again
async function splitOffPassage(sec, pid) {
  const p = sec.passages.find(x => x.id === pid);
  if (!p) return;
  const affectedQuotes = (p.absorbed?.movedQuoteIds || []).map(id => state.annotations.find(a => a.id === id)).filter(Boolean);
  const change = beginAnnoChange(`Split off p.${p.page} from "${secShortLabel(sec)}"`, [sec, ...affectedQuotes]);
  // Built on copies: the constructs and quotes in memory change once all of it is stored
  const kept = { ...sec, passages: sec.passages.filter(x => x.id !== pid) };
  let restored;
  /** @type {any[]} */
  let quotes = [];
  if (p.absorbed?.snapshot) {
    restored = normalizeAnnotation(JSON.parse(JSON.stringify(p.absorbed.snapshot)));
    if (state.annotations.some(a => a.id === restored.id)) restored.id = 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    // Give back the matrix rows it brought with it (only those the target did not have already)
    (p.absorbed.addedClusterIds || []).forEach(cid => takeOutOfRow(kept, cid));
    dropGoneLinks(restored); // placements in rows deleted since it was absorbed do not come back
    // Its own further passages (absorbed with it) go back with it, if they are still there
    const own = new Set(p.absorbed.ownPassageIds || []);
    restored.passages = [...(restored.passages || []), ...kept.passages.filter(x => own.has(x.id))];
    kept.passages = kept.passages.filter(x => !own.has(x.id));
    quotes = affectedQuotes.map(f => ({ ...f, parentIds: [...new Set([...quoteParentIds(f).filter(id => id !== sec.id), restored.id])] }));
  } else {
    restored = normalizeAnnotation({
      id: 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      docId: sec.docId, type: 'second_order', origin: 'author_passage', noteSource: 'author',
      by: p.by || state.reviewerId || 'Reviewer',
      text: p.text, page: p.page, firstPage: p.firstPage, rectsMap: p.rectsMap,
      note: '', nuanceNote: '', concordanceStatus: 'pending', concordanceNote: '',
      clusterIds: [], clusterComments: {}, clusterRelations: {}, passages: []
    });
  }
  // Both constructs, the quotes that go back with it and the entry in one transaction; Undo also removes the re-created
  // construct. Back in its rows, it does there what placing does (an empty-cell record made for its study meanwhile goes)
  await saveChange([...[kept, restored, ...quotes].map(a => ({ store: 'annotations', put: a })), ...placementOpsFor(state, [restored])], auditEntry({
    kind: 'passage_split',
    category: 'reading_extraction',
    action: `Split p.${p.page} off "${secShortLabel(sec)}" as a separate 2nd Order construct (${studyNameOf(sec)})`,
    detail: 'On re-reading, this passage expresses a different interpretation of the authors.'
  }));
  finishChange(change, [{ store: 'annotations', id: restored.id }]);
  updateSidebar();
  renderHighlights();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
}

async function removePassage(sec, pid) {
  const p = sec.passages.find(x => x.id === pid);
  if (!p) return;
  // Only the construct changes (its quotes stay linked to it): Undo puts back the construct alone, so later edits of those
  // quotes are not undone with it
  await runOperation(project => opRemovePassage(project, { secId: sec.id, passageId: pid }, OP_NAMES), { undo: annoUndo(`Removed passage p.${p.page} from "${secShortLabel(sec)}"`, [sec]) });
  updateSidebar();
  renderHighlights();
  showUndoSnackbar(p.absorbed ? 'Passage removed (it was a separate construct before; ↗ Split off keeps it as its own)' : 'Passage removed');
}
async function wrapFirstOrderInSecondOrder(f, initialConceptLabel = '') {
  const doc = state.docs.find(d => d.id === f.docId);
  const label = initialConceptLabel || f.note || await askReason({
    title: 'Your label for this quote',
    context: `The quote becomes a reviewer-wrapped 2nd Order construct (${getDisplayName(doc)}, p.${f.page}): a reviewer wording, not the authors' term.`,
    label: 'Conceptual label (e.g., "[Descriptive] Delayed access")', confirmLabel: 'Wrap as 2nd Order', value: '[Descriptive] ', singleLine: true
  });
  if (label === null) return null;

  const wrapperSec = normalizeAnnotation({
    id: 'a_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    docId: f.docId,
    type: 'second_order',
    origin: 'wrapped_first_order',
    by: state.reviewerId || 'Reviewer',
    text: `[Concept derived from 1st Order Quote, p.${f.page}]: "${f.text}"`,
    page: f.page,
    rectsMap: {},
    note: label.trim() || 'Descriptive Theme (from 1st Order Quote)',
    nuanceNote: f.nuanceNote || '',
    concordanceStatus: 'pending',
    concordanceNote: '',
    clusterIds: [],
    clusterComments: {},
    clusterRelations: {}
  });
  // The new construct, the quote's link to it and the entry: one transaction
  await runOperation(opWrapQuote(state, { quoteId: f.id, construct: wrapperSec }, OP_NAMES));
  return wrapperSec;
}

function makeFirstCard(f, isLinked, parentSec, sameStudySeconds = []) {
  normalizeAnnotation(f);
  const activeDoc = state.docs.find(d => d.id === f.docId);
  const c = document.createElement('div');
  c.className = 'p-2 border border-blue-200 bg-blue-50/40 rounded text-xs cursor-grab active:cursor-grabbing space-y-1.5 transition';
  c.dataset.sidebarAnno = f.id;
  c.draggable = true;
  c.ondragstart = e => {
    e.dataTransfer.setData('text/anno-id', f.id);
    e.stopPropagation();
  };

  // Many-to-many: offer only the constructs this quote is NOT yet linked to
  const linkableSeconds = sameStudySeconds.filter(s => !isQuoteLinkedTo(f, s.id));
  const otherParents = sameStudySeconds.filter(s => isQuoteLinkedTo(f, s.id) && (!parentSec || s.id !== parentSec.id));
  const alsoHtml = (isLinked && otherParents.length) ? `<div class="text-[11px] text-violet-800 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">🔗 Also illustrates: ${otherParents.map(s => `<b>${escapeHtml(s.note || s.text.slice(0, 30) + '…')}</b>`).join(', ')}</div>` : '';
  const linkDropdownHtml = linkableSeconds.length > 0 ? `
    <div class="pt-0.5">
      <select data-action="quote-link" class="quick-link-sec-sel w-full text-xs border border-emerald-300 rounded px-1.5 py-1 bg-emerald-50/70 hover:bg-emerald-50 text-emerald-950 font-semibold focus:outline-none focus:border-emerald-600 cursor-pointer">
        <option value="">🔗 ${isLinked ? 'Also link to another' : 'Link to'} 2nd Order Construct in this study (${linkableSeconds.length})...</option>
        ${linkableSeconds.map(s => `<option value="${escapeHtml(s.id)}">🟩 p.${escapeHtml(s.page)}: ${escapeHtml(s.note || s.text.slice(0, 48) + '...')}</option>`).join('')}
      </select>
    </div>
  ` : '';

  c.innerHTML = `
    <div class="flex justify-between items-center text-blue-800 font-bold text-[13px]">
      <span class="flex items-center space-x-1">
        <span>🟦 1st Order</span>
        <button type="button" class="jump-pdf-btn font-bold text-xs bg-blue-100 hover:bg-blue-200 text-blue-900 px-1.5 py-px rounded-full cursor-pointer transition flex items-center space-x-0.5" title="Jump to PDF page ${escapeHtml(f.page)}"><i class="ph ph-crosshair"></i><span>p.${escapeHtml(f.page)}</span></button>
        <button type="button" class="rev-badge-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 hover:text-indigo-800 px-1 py-px rounded font-mono cursor-pointer transition" title="Click to change reviewer">@${escapeHtml(f.by || 'Unknown')}</button>
      </span>
      <div class="flex items-center space-x-1">
        <button type="button" class="toggle-order-btn text-[11px] text-emerald-800 hover:bg-emerald-100 border border-emerald-300 bg-white px-1.5 py-px rounded font-semibold cursor-pointer flex items-center space-x-0.5" title="Switch type directly to 2nd Order Construct"><i class="ph ph-arrows-left-right"></i><span>To 2nd</span></button>
        <button type="button" class="edit-f-quote-btn text-[11px] text-blue-700 hover:bg-blue-100 px-1 py-px rounded font-semibold cursor-pointer flex items-center space-x-0.5" title="Edit quote text (clean up 2-column PDF artifacts)"><i class="ph ph-pencil-simple"></i><span>Edit</span></button>
        ${isLinked
          ? `<button data-action="quote-unlink" class="unl mr-1 text-slate-400 hover:text-slate-700 cursor-pointer" title="Unlink from this 2nd Order Construct (other links are kept)"><i class="ph ph-link-break"></i></button>`
          : `<button data-action="quote-wrap" class="promote-sec px-1.5 py-px bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 rounded text-[11px] font-semibold cursor-pointer" title="Keep this 1st Order quote and wrap it in a new parent 2nd Order Concept">+ Wrap</button>`}
        <button data-action="delete" class="del text-slate-400 hover:text-rose-500 cursor-pointer" title="Delete Quote"><i class="ph ph-trash"></i></button>
      </div>
    </div>
    <div class="f-quote-display text-xs italic bg-white p-1.5 rounded border border-blue-100 text-slate-600 leading-snug cursor-pointer hover:border-blue-300" title="Double-click or click 'Edit' to clean up extracted quote text">"${escapeHtml(f.text)}"</div>
    <div class="f-quote-editor hidden space-y-1 bg-amber-50/60 p-1.5 rounded border border-amber-200">
      <textarea class="f-quote-textarea w-full text-xs border border-amber-300 rounded p-1 bg-white focus:outline-none focus:border-indigo-500 resize-y h-16">${escapeHtml(f.text)}</textarea>
      <div class="flex justify-end space-x-1">
        <button type="button" class="f-quote-cancel px-1.5 py-0.5 text-[11px] bg-white border border-slate-300 rounded text-slate-600 cursor-pointer">Cancel</button>
        <button type="button" class="f-quote-save px-2 py-0.5 text-[11px] bg-blue-600 hover:bg-blue-700 text-white font-bold rounded cursor-pointer">Save</button>
      </div>
    </div>
    ${alsoHtml}
    ${linkDropdownHtml}
    <input type="text" class="f-note-input w-full text-xs border border-slate-200 p-1 rounded bg-white" placeholder="Participant attribution / context (e.g. Patient #4, Night-shift nurse)..." value="${escapeHtml(f.note)}">
    <details class="bg-sky-50/70 border border-sky-200/70 rounded p-1" ${f.nuanceNote ? 'open' : ''}>
      <summary class="text-[11px] font-semibold text-sky-800 cursor-pointer select-none">🌐 Nuance / Translation Memo (Private)</summary>
      <textarea class="f-nuance-input w-full mt-1 text-xs border border-sky-200 rounded p-1 bg-white focus:outline-none focus:border-sky-500 resize-y h-12" placeholder="Notes on tone, wording, or context...">${escapeHtml(f.nuanceNote)}</textarea>
    </details>
  `;

  c.querySelector('.jump-pdf-btn').onclick = (e) => { e.stopPropagation(); jumpToPdfAnnotation(f.id); };
  c.querySelector('.rev-badge-btn').onclick = (e) => { e.stopPropagation(); promptReassignItemReviewer(f, 'annotations', updateSidebar); };
  c.querySelector('.toggle-order-btn').onclick = (e) => { e.stopPropagation(); toggleAnnotationOrderType(f.id); };

  const fDisplay = c.querySelector('.f-quote-display');
  const fEditor = c.querySelector('.f-quote-editor');
  const fTextarea = c.querySelector('.f-quote-textarea');
  const toggleFirstEditor = (open) => {
    fDisplay.classList.toggle('hidden', open);
    fEditor.classList.toggle('hidden', !open);
    if (open) { fTextarea.value = f.text; fTextarea.focus(); }
  };
  c.querySelector('.edit-f-quote-btn').onclick = (e) => { e.stopPropagation(); toggleFirstEditor(fEditor.classList.contains('hidden')); };
  fDisplay.ondblclick = (e) => { e.stopPropagation(); toggleFirstEditor(true); };
  c.querySelector('.f-quote-cancel').onclick = () => toggleFirstEditor(false);
  c.querySelector('.f-quote-save').onclick = async () => {
    if (await saveExtractedText(f, stripOuterQuotes(fTextarea.value))) {
      fDisplay.textContent = `"${f.text}"`;
      renderHighlights();
    }
    toggleFirstEditor(false);
  };

  // Attribution and memo of a quote: saved while typed and when left (no audit entry: they are working notes)
  bindTextField(c.querySelector('.f-note-input'), { get: () => f.note, set: v => { f.note = v; }, record: () => ({ store: 'annotations', put: f }) });
  bindTextField(c.querySelector('.f-nuance-input'), { get: () => f.nuanceNote, set: v => { f.nuanceNote = v; }, record: () => ({ store: 'annotations', put: f }) });

  // (linking, unlinking, wrapping and deleting the quote: SIDEBAR_ACTIONS)
  return c;
}

// --- A. Manual Construct Entry (for non-OCR / scanned PDFs) ---
function getCurrentVisiblePageNum() {
  const viewer = document.getElementById('pdfViewerContainer');
  const pages = document.querySelectorAll('#pdfPagesWrapper .page-container');
  if (!viewer || !pages.length) return 1;
  const viewerCenter = viewer.getBoundingClientRect().top + viewer.clientHeight / 2;
  let closestPage = 1;
  let minDist = Infinity;
  pages.forEach(p => {
    const rect = p.getBoundingClientRect();
    const dist = Math.abs((rect.top + rect.height / 2) - viewerCenter);
    if (dist < minDist) {
      minDist = dist;
      closestPage = parseInt(p.dataset.p, 10) || 1;
    }
  });
  return closestPage;
}

let activeManualAddType = 'first_order';

function openManualAddDrawer(type) {
  if (!state.activeDocId) {
    showSnackbar('Please select or add a PDF study first.');
    return;
  }
  const drawer = document.getElementById('manualAddDrawer');
  const badge = document.getElementById('manualAddTypeBadge');
  const pageInput = document.getElementById('manualAddPageInput');
  const noteInput = document.getElementById('manualAddNoteInput');
  const textInput = document.getElementById('manualAddTextInput');
  const submitBtn = document.getElementById('manualAddSubmitBtn');
  if (!drawer) return;

  // Pressing the same button again closes the drawer (only while nothing has been typed)
  if (!drawer.classList.contains('hidden') && activeManualAddType === type && !textInput.value.trim()) {
    drawer.classList.add('hidden');
    return;
  }

  activeManualAddType = type;
  const defaultPage = String(getCurrentVisiblePageNum());
  if (!pageInput.value.trim() || drawer.classList.contains('hidden')) {
    pageInput.value = defaultPage;
  }

  if (type === 'second_order') {
    badge.className = 'text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300';
    badge.textContent = '🟩 Add 2nd Order Construct';
    noteInput.placeholder = 'Short concept label for this author interpretation (optional)...';
    textInput.placeholder = 'Paste or type 2nd Order Construct (author interpretation / quote)...';
    submitBtn.className = 'px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-sm cursor-pointer transition';
  } else {
    badge.className = 'text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300';
    badge.textContent = '🟦 Add 1st Order Quote';
    noteInput.placeholder = 'Participant attribution / context, e.g. Patient #4, Night-shift nurse (optional)...';
    textInput.placeholder = 'Paste or type 1st Order participant quote...';
    submitBtn.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-sm cursor-pointer transition';
  }

  drawer.classList.remove('hidden');
  setTimeout(() => textInput.focus(), 30);
}

function closeManualAddDrawer() {
  const drawer = document.getElementById('manualAddDrawer');
  if (!drawer) return;
  drawer.classList.add('hidden');
  document.getElementById('manualAddNoteInput').value = '';
  document.getElementById('manualAddTextInput').value = '';
}

async function submitManualAddForm() {
  if (!state.activeDocId) return;
  const pageInput = document.getElementById('manualAddPageInput');
  const noteInput = document.getElementById('manualAddNoteInput');
  const textInput = document.getElementById('manualAddTextInput');

  const cleanedText = stripOuterQuotes(textInput.value);
  if (!cleanedText) {
    textInput.focus();
    showSnackbar('Please enter quote or construct text.');
    return;
  }

  const defaultPage = String(getCurrentVisiblePageNum());
  const cleanPage = sanitizePageLabel(pageInput.value) || defaultPage;
  const firstPage = parseInt(cleanPage, 10) || 1;
  const cleanNote = (noteInput.value || '').trim();

  const a = normalizeAnnotation({
    id: 'a_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    docId: state.activeDocId,
    type: activeManualAddType,
    by: state.reviewerId || 'Reviewer',
    text: cleanedText,
    page: cleanPage,
    firstPage,
    rectsMap: {},
    note: cleanNote,
    nuanceNote: '',
    concordanceStatus: 'pending',
    concordanceNote: '',
    clusterIds: [],
    clusterComments: {},
    clusterRelations: {}
  });
  // Clear the form before the (async) save, so typing the next entry right away is never wiped; if the save fails (e.g. the
  // browser's storage is full), what was typed is put back into the form, so nothing typed by hand is lost
  const typed = { text: textInput.value, note: document.getElementById('manualAddNoteInput').value, page: pageInput.value, type: activeManualAddType };
  closeManualAddDrawer();
  try {
    await commitOps([{ store: 'annotations', put: a }]);
  } catch (err) {
    openManualAddDrawer(typed.type);
    textInput.value = typed.text;
    document.getElementById('manualAddNoteInput').value = typed.note;
    pageInput.value = typed.page; // (opening the form again set it to the page on screen)
    showNotice('The entry was not saved', `${err && err.message ? err.message : err}\n\nWhat you typed is back in the form. Free some space (e.g. make a Backup and remove PDFs you no longer need), then add it again.`);
    return;
  }
  updateSidebar();
  showSnackbar(`Added manual ${a.type === 'second_order' ? '2nd Order Construct' : '1st Order Quote'} (p.${cleanPage})`);
}

document.getElementById('manualAddFirstBtn')?.addEventListener('click', () => openManualAddDrawer('first_order'));
document.getElementById('manualAddSecondBtn')?.addEventListener('click', () => openManualAddDrawer('second_order'));
document.getElementById('manualAddCancelBtn')?.addEventListener('click', closeManualAddDrawer);
document.getElementById('manualAddSubmitBtn')?.addEventListener('click', submitManualAddForm);
document.getElementById('manualAddDrawer')?.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    submitManualAddForm();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeManualAddDrawer();
  }
});

// --- B. Direct 1st <-> 2nd Order Type Switching ---
async function toggleAnnotationOrderType(annoId) {
  const a = state.annotations.find(x => x.id === annoId);
  if (!a) return;
  normalizeAnnotation(a);
  const doc = state.docs.find(d => d.id === a.docId);
  // Ctrl+Z: back to its type with its links, row placements (only rows that still exist) and within-study relationships

  if (a.type === 'first_order') {
    const label = `Switch 1st ➔ 2nd Order (p.${a.page})`;
    const change = beginChange(label, [{ store: 'annotations', id: a.id }], { undoLogs: [{ kind: 'undo_extraction', category: 'linking', action: `Undid: ${label}`,
      detail: 'Back to its type before the switch, with its links.', isMinorOp: true }] });
    // A 1st Order note is a participant attribution (e.g. "Patient #4"), not a concept label: keep it as a memo, not as the 2nd Order label
    const attribution = (a.note || '').trim();
    const next = normalizeAnnotation({ ...a, type: 'second_order', parentIds: [], note: '', origin: 'author_passage', noteSource: 'author',
      nuanceNote: attribution ? `[Participant attribution (from 1st Order): ${attribution}]${a.nuanceNote ? '\n' + a.nuanceNote : ''}` : a.nuanceNote });
    await saveChange([{ store: 'annotations', put: next }], auditEntry({
      kind: 'order_switch',
      category: 'linking',
      action: `Switched 1st Order Quote to 2nd Order Construct (${getDisplayName(doc)}, p.${a.page})`,
      detail: `"${a.text.slice(0, 80)}..."`,
      fromVal: '1st Order Quote',
      toVal: '2nd Order Construct',
      isMinorOp: true
    }));
    finishChange(change);
  } else {
    const linkedChildren = quotesOf(a.id);
    const hasClusters = Array.isArray(a.clusterIds) && a.clusterIds.length > 0;
    if ((a.passages || []).length) {
      showSnackbar(`This construct has ${a.passages.length} additional passage(s). Split them off (↗) before switching it to a 1st Order quote.`);
      return;
    }
    // Undoable (Ctrl+Z): no question first; the notice says what changed and offers Undo
    // Its within-study relationships (Appendix C) are between constructs: they go with it, and Ctrl+Z puts them back
    const removedConceptLinks = ((doc && doc.conceptLinks) || []).filter(l => l.from === a.id || l.to === a.id);
    const switchNotice = [linkedChildren.length ? `${linkedChildren.length} linked quote(s) unlinked` : '', hasClusters ? `removed from ${a.clusterIds.length} matrix row(s)` : '', removedConceptLinks.length ? `${removedConceptLinks.length} within-study relationship(s) removed` : ''].filter(Boolean).join(', ');
    const label = `Switch 2nd ➔ 1st Order (p.${a.page})`;
    const change = beginChange(label, [{ store: 'annotations', id: a.id }, ...linkedChildren.map(c => ({ store: 'annotations', id: c.id })), ...(doc ? [{ store: 'docs', id: doc.id }] : [])],
      { undoLogs: [{ kind: 'undo_extraction', category: 'linking', action: `Undid: ${label}`, detail: 'Back to its type before the switch, with its links and row placements.',
        clusterIds: [...(a.clusterIds || [])], isMinorOp: true }] });
    /** @type {DbOp[]} */
    const ops = linkedChildren.map(child => ({ store: 'annotations', put: { ...child, parentIds: quoteParentIds(child).filter(id => id !== a.id) } }));
    if (removedConceptLinks.length) ops.push({ store: 'docs', put: { ...doc, conceptLinks: doc.conceptLinks.filter(l => !removedConceptLinks.includes(l)) } });
    const label2 = (a.note || '').trim();
    const next = {
      ...a, type: 'first_order', parentIds: [], note: '', clusterIds: [],
      // A reviewer-wrapped construct goes back to the quote it was made from ('[Concept derived from …]: "…"' -> the quote)
      text: a.origin === 'wrapped_first_order' ? stripOuterQuotes(String(a.text || '').replace(/^\[Concept derived from 1st Order Quote[^\]]*\]:\s*/, '')) : a.text,
      // The 2nd Order label is a concept name, not a participant attribution: keep it as a memo
      nuanceNote: label2 ? `[Former 2nd Order label: ${label2}]${a.nuanceNote ? '\n' + a.nuanceNote : ''}` : a.nuanceNote
    };
    // What only a 2nd Order construct has (Ctrl+Z restores them from the snapshot); out of every row, with everything it had
    // there (a quote has no place in rows)
    ['passages', 'origin', 'noteSource', 'indexSeeded', 'notTranslatedNote', ...ANNOTATION_ROW_FIELDS].forEach(k => { delete next[k]; });
    ops.push({ store: 'annotations', put: next });
    // The quote, its former quotes' links, its study's relationships and the entry in one transaction
    await saveChange(ops, auditEntry({
      kind: 'order_switch',
      category: 'linking',
      action: `Switched 2nd Order Construct to 1st Order Quote (${getDisplayName(doc)}, p.${a.page})`,
      detail: `"${next.text.slice(0, 80)}..."`,
      fromVal: '2nd Order Construct',
      toVal: '1st Order Quote',
      isMinorOp: true
    }));
    finishChange(change);
    showUndoSnackbar(`Switched to a 1st Order quote${switchNotice ? ' (' + switchNotice + ')' : ''}`);
  }

  renderHighlights();
  updateSidebar();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
}
