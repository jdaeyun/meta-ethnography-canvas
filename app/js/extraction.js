// Meta-Ethnography Canvas — Extraction sidebar (Tab 1)
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// 1st / 2nd order cards, quote linking, additional passages, reviewer-wrapped constructs, manual entry and 1st <-> 2nd order switching.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// EXTRACTION SIDEBAR (With Clickable Reviewer Badge)
// ========================================================
function updateSidebar() {
  const list = document.getElementById('annotationsList');
  const prevScrollTop = list ? list.scrollTop : 0;
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
      if (f && f.type === 'first_order' && !isQuoteLinkedTo(f, sec.id)) {
        linkQuote(f, sec.id);
        await dbPut('annotations', f);
        await recordAuditLog({
          category: 'linking',
          action: `Linked 1st Order Quote to 2nd Order Construct (${getDisplayName(activeDoc)})`,
          detail: `Quote (p.${f.page}): "${f.text.slice(0, 80)}..."`,
          toVal: `2nd Order: ${sec.note || '"' + sec.text.slice(0, 60) + '..."'}`,
          isMinorOp: true
        });
        updateSidebar();
      }
    };

    const cBadge = getConcordanceBadgeMeta(sec.concordanceStatus);
    const showConcUI = state.teamMode || sec.concordanceStatus !== 'pending' || Boolean(sec.concordanceNote);

    w.innerHTML = `
      <div class="px-2.5 py-1.5 bg-emerald-50 border-b border-emerald-100 flex justify-between items-center">
        <span class="text-xs font-bold text-emerald-800 flex items-center flex-wrap gap-1">
          <span class="merge-drag-handle cursor-grab active:cursor-grabbing text-emerald-600 hover:text-violet-700" draggable="true" title="Drag onto another 2nd Order construct of this study if this is the SAME author interpretation stated elsewhere in the paper: it becomes an additional evidence passage of that construct (can be split off again)."><i class="ph ph-dots-six-vertical text-sm"></i></span>
          <span>🟩 2nd Order</span>
          ${sec.passages.length ? `<span class="text-[10.5px] px-1.5 py-0.2 rounded border border-violet-300 bg-violet-50 text-violet-800 font-semibold" title="Stated in ${sec.passages.length + 1} places in the paper">📑 ${sec.passages.length + 1} passages</span>` : ''}
          ${sec.origin === 'wrapped_first_order' ? `<span class="text-[10.5px] px-1.5 py-0.2 rounded border border-amber-400 bg-amber-100 text-amber-900 font-semibold" title="No author-stated interpretation was captured. The reviewer wrapped a 1st order quote (participant data) in a 2nd order construct and wrote the label themselves (@${escapeHtml(sec.by || '')}).">🏷 Reviewer-wrapped from 1st-order quote</span>` : ''}
          <button type="button" class="jump-pdf-btn text-xs bg-emerald-200/80 hover:bg-emerald-300 text-emerald-950 px-1.5 py-0.2 rounded-full font-bold cursor-pointer transition flex items-center space-x-0.5" title="Jump to PDF page ${sec.page}"><i class="ph ph-crosshair"></i><span>p.${sec.page}</span></button>
          <button type="button" class="rev-badge-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 hover:text-indigo-800 px-1.5 py-0.2 rounded font-mono cursor-pointer transition" title="Click to change reviewer for this construct">@${escapeHtml(sec.by || 'Unknown')}</button>
          <span class="text-xs bg-white border border-emerald-200 px-1.5 rounded-full">${linked.length} quotes</span>
          <span class="concordance-pill text-[11px] px-1.5 py-0.2 rounded border font-semibold ${cBadge.cls} ${showConcUI ? '' : 'hidden'}">${cBadge.label}</span>
        </span>
        <div class="flex items-center space-x-1">
          <button type="button" class="toggle-order-btn text-[11px] text-blue-700 hover:bg-blue-100 border border-blue-200 bg-white px-1.5 py-0.5 rounded font-semibold cursor-pointer flex items-center space-x-0.5" title="Switch this construct to a 1st Order Participant Quote"><i class="ph ph-arrows-left-right"></i><span>To 1st</span></button>
          <button type="button" class="edit-quote-btn text-xs text-emerald-800 hover:bg-emerald-100 px-1.5 py-0.5 rounded font-semibold cursor-pointer flex items-center space-x-0.5" title="Edit extracted quote text (clean up 2-column PDF line breaks or headers)"><i class="ph ph-pencil-simple"></i><span>Edit Quote</span></button>
          <button class="del text-slate-400 hover:text-rose-500 cursor-pointer" title="Delete 2nd Order Construct"><i class="ph ph-trash"></i></button>
        </div>
      </div>
      <div class="p-2.5 space-y-1.5">
        <label class="block text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-0.5 mt-1">${sec.origin === 'wrapped_first_order' ? "Reviewer's own label (wraps a participant quote — not the authors' interpretation)" : "Authors' own term for this concept (leave blank if they name none)"}</label>
        <textarea class="sec-note-input w-full text-[13px] font-bold text-slate-800 border border-emerald-300 p-2 rounded bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y min-h-[48px]" placeholder="${sec.origin === 'wrapped_first_order' ? 'Your label for this quote (a reviewer wording)…' : 'Use the authors\' own term. If you paraphrase, switch the source below to Reviewer wording.'}">${escapeHtml(sec.note)}</textarea>
        ${sec.origin === 'wrapped_first_order' ? '' : `<div class="flex items-center gap-1.5 text-[11px] text-slate-500"><span>Label source:</span><select class="sec-notesrc text-[11px] border border-slate-300 rounded px-1 py-0.5 bg-white"><option value="author" ${sec.noteSource === 'author' ? 'selected' : ''}>Authors\' own term</option><option value="reviewer" ${sec.noteSource === 'reviewer' ? 'selected' : ''}>Reviewer wording (paraphrase)</option></select></div>`}
        
        <div class="mt-2">
          <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Original Source Passage (Evidence)</label>
          ${sec.text ? `<div class="sec-quote-display text-[11.5px] text-slate-500 italic bg-slate-50 p-1.5 rounded border border-slate-200 leading-snug cursor-pointer hover:border-emerald-300" title="Double-click or click 'Edit Quote' to clean up original text">"${escapeHtml(sec.text)}"</div>` : `<div class="sec-quote-display text-[11.5px] text-slate-400 italic bg-slate-50 p-1.5 rounded border border-slate-200 cursor-pointer">(No evidence quote attached. Click 'Edit Quote' to add)</div>`}
          ${sec.passages.length ? `<div class="mt-1.5 space-y-1">
            <div class="text-[10px] font-bold text-violet-700 uppercase tracking-wider">Same interpretation stated elsewhere (${sec.passages.length})</div>
            ${sec.passages.map(p => `<div class="sec-passage text-[11.5px] text-slate-500 italic bg-violet-50/50 p-1.5 rounded border border-violet-200 leading-snug" data-pid="${escapeHtml(p.id)}">
              <div class="flex items-center justify-between not-italic mb-0.5 gap-1">
                <button type="button" class="passage-jump text-[11px] bg-violet-100 hover:bg-violet-200 text-violet-900 px-1.5 rounded-full font-bold cursor-pointer"><i class="ph ph-crosshair"></i> p.${escapeHtml(p.page)}</button>
                <span class="flex items-center gap-1">
                  <button type="button" class="passage-split text-[11px] text-violet-700 hover:bg-violet-100 border border-violet-200 bg-white px-1.5 rounded cursor-pointer" title="This passage is actually a different interpretation: make it a separate 2nd Order construct again">↗ Split off</button>
                  <button type="button" class="passage-del text-slate-400 hover:text-rose-500 cursor-pointer" title="Remove this passage"><i class="ph ph-x"></i></button>
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
            <span>🤝 Team Agreement</span>
            <span class="text-[11px] font-normal text-indigo-600">(Logs to Trail)</span>
          </summary>
          <div class="mt-1.5 space-y-1.5">
            <div class="flex items-center space-x-1.5">
              <label class="text-xs text-slate-600 font-medium shrink-0">Status:</label>
              <select class="sec-conc-status flex-1 text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white font-semibold">
                <option value="pending" ${sec.concordanceStatus === 'pending' ? 'selected' : ''}>⏳ Pending Review</option>
                <option value="discuss" ${sec.concordanceStatus === 'discuss' ? 'selected' : ''}>💬 Needs Discussion</option>
                <option value="agreed" ${sec.concordanceStatus === 'agreed' ? 'selected' : ''}>✅ Agreed / Verified</option>
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
      el.querySelector('.passage-split').onclick = () => splitOffPassage(sec, pid);
      el.querySelector('.passage-del').onclick = () => removePassage(sec, pid);
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
      const cleaned = stripOuterQuotes(quoteTextarea.value);
      if (cleaned && cleaned !== sec.text) {
        sec.text = cleaned;
        quoteDisplay.textContent = `"${cleaned}"`;
        await dbPut('annotations', sec);
        renderHighlights();
      }
      toggleSecEditor(false);
    };

    const debouncedSaveSec = createDebouncedSaver(async () => { await dbPut('annotations', sec); }, 350);
    w.querySelector('.sec-note-input').addEventListener('input', e => { sec.note = e.target.value; debouncedSaveSec(); });
    const noteSrcSel = w.querySelector('.sec-notesrc');
    if (noteSrcSel) noteSrcSel.onchange = async e => {
      const prev = sec.noteSource;
      sec.noteSource = e.target.value;
      await dbPut('annotations', sec);
      await recordAuditLog({
        category: 'linking',
        action: `Set 2nd Order label source to "${sec.noteSource === 'author' ? "Authors' own term" : 'Reviewer wording'}" (${getDisplayName(state.docs.find(d => d.id === sec.docId))}, p.${sec.page})`,
        detail: sec.note ? `Label: ${sec.note}` : '(no label)',
        fromVal: prev, toVal: sec.noteSource
      });
    };
    w.querySelector('.sec-nuance-input').addEventListener('input', e => { sec.nuanceNote = e.target.value; debouncedSaveSec(); });

    const updateSecConcordance = async () => {
      const oldStatus = sec.concordanceStatus;
      const oldNote = sec.concordanceNote;
      const newStatus = w.querySelector('.sec-conc-status').value;
      const newNote = w.querySelector('.sec-conc-note').value.trim();
      if (oldStatus === newStatus && oldNote === newNote) return;

      sec.concordanceStatus = newStatus;
      sec.concordanceNote = newNote;
      await dbPut('annotations', sec);

      const pill = w.querySelector('.concordance-pill');
      const meta = getConcordanceBadgeMeta(newStatus);
      pill.className = `concordance-pill text-[11px] px-1.5 py-0.2 rounded border font-semibold ${meta.cls}`;
      pill.textContent = meta.label;

      await recordAuditLog({
        category: 'concordance',
        action: `2nd Order Concordance Updated (${getDisplayName(activeDoc)}, p.${sec.page})`,
        detail: `Construct: ${sec.note || '"' + sec.text.slice(0, 60) + '..."'}${newNote ? '\nConsensus Note: ' + newNote : ''}`,
        fromVal: `${oldStatus.toUpperCase()}${oldNote ? ' (' + oldNote + ')' : ''}`,
        toVal: `${newStatus.toUpperCase()}${newNote ? ' (' + newNote + ')' : ''}`
      });
    };

    w.querySelector('.sec-conc-status').onchange = updateSecConcordance;
    w.querySelector('.sec-conc-note').onchange = updateSecConcordance;

    w.querySelector('.del').onclick = async () => {
      if (!confirm('Delete this 2nd Order Construct? (Linked 1st Order quotes will be unlinked, and you can Undo with Ctrl+Z)')) return;
      const unlinkedIds = linked.map(f => f.id);
      pushUndoAction({
        type: 'delete_annotation',
        label: `2nd Order Construct (${sec.note || sec.text.slice(0, 30)})`,
        annotations: [{ ...sec }],
        unlinkedChildrenIds: unlinkedIds,
        parentId: sec.id
      });
      for (let f of linked) { unlinkQuote(f, sec.id); await dbPut('annotations', f); }
      await dbDelete('annotations', sec.id);
      state.annotations = state.annotations.filter(x => x.id !== sec.id);
      updateSidebar();
      renderHighlights();
    };

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
  prependStudyOverviewNudge(list, activeDoc);
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
}

// ========================================================
// ONE AUTHOR INTERPRETATION, SEVERAL PASSAGES
// Authors often state the same interpretation in several places (abstract, findings, discussion).
// These are kept as additional evidence passages of ONE 2nd order construct — no concepts are merged.
// ========================================================
function newPassageId() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function pushAnnoSnapshotUndo(label, annos, createdIds = []) {
  pushUndoAction({ type: 'annotation_snapshots', label, snapshots: annos.map(a => JSON.parse(JSON.stringify(a))), createdIds });
}
function secShortLabel(s) { return s.note || ('"' + (s.text || '').slice(0, 40) + '…"'); }

// From a PDF selection: add the selected text as another passage of an existing construct
async function addSelectionAsPassage(secId) {
  const sec = state.annotations.find(a => a.id === secId && a.type === 'second_order');
  if (!sec || !state.pendingSelection?.txt) return;
  normalizeAnnotation(sec);
  pushAnnoSnapshotUndo(`Added passage to "${secShortLabel(sec)}"`, [sec]);
  const p = {
    id: newPassageId(),
    text: stripOuterQuotes(state.pendingSelection.txt),
    page: state.pendingSelection.page,
    firstPage: state.pendingSelection.firstPage,
    rectsMap: state.pendingSelection.rectsMap,
    by: state.reviewerId || 'Reviewer',
    addedAt: new Date().toISOString()
  };
  sec.passages.push(p);
  await dbPut('annotations', sec);
  await recordAuditLog({
    category: 'reading_extraction',
    action: `Added a further passage (p.${p.page}) to 2nd Order construct "${secShortLabel(sec)}" (${getDisplayName(state.docs.find(d => d.id === sec.docId))})`,
    detail: `Same author interpretation stated elsewhere in the paper: "${p.text.slice(0, 120)}${p.text.length > 120 ? '…' : ''}"`,
    isMinorOp: true
  });
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
  const ok = confirm(
    `Is this the SAME interpretation of the authors, stated in another place in ${getDisplayName(doc)}?\n\n` +
    `  • ${secShortLabel(source)} (p.${source.page})\n  → becomes a further passage of: ${secShortLabel(target)} (p.${target.page})\n\n` +
    `Use this only for repeated statements of one interpretation. Different interpretations — even closely related ones — should stay separate constructs; describe how they relate in the Study Overview.\n\n` +
    `Its quotes and matrix placements move with it, and it can be split off again (↗) at any time.`
  );
  if (!ok) return;
  const children = quotesOf(source.id);
  pushAnnoSnapshotUndo(`Passage attach: "${secShortLabel(source)}" → "${secShortLabel(target)}"`, [target, source, ...children]);

  const addedClusterIds = source.clusterIds.filter(cid => !target.clusterIds.includes(cid));
  const movedQuoteIds = children.filter(f => !isQuoteLinkedTo(f, target.id)).map(f => f.id);
  // The detached construct is kept whole inside the passage so that "Split off" can restore it exactly
  const sourceSnapshot = JSON.parse(JSON.stringify(source));
  const ownPassages = sourceSnapshot.passages || [];
  sourceSnapshot.passages = [];
  target.passages.push({
    id: newPassageId(),
    text: source.text, page: source.page,
    firstPage: source.firstPage || parseInt(source.page, 10) || null,
    rectsMap: source.rectsMap || null,
    by: source.by, addedAt: new Date().toISOString(),
    absorbed: { snapshot: sourceSnapshot, addedClusterIds, movedQuoteIds }
  }, ...ownPassages);

  addedClusterIds.forEach(cid => {
    target.clusterIds.push(cid);
    if (source.clusterRelations[cid]) target.clusterRelations[cid] = source.clusterRelations[cid];
    if (source.clusterComments[cid]) target.clusterComments[cid] = source.clusterComments[cid];
  });
  for (const f of children) { unlinkQuote(f, source.id); linkQuote(f, target.id); await dbPut('annotations', f); }
  await dbPut('annotations', target);
  await dbDelete('annotations', source.id);
  state.annotations = state.annotations.filter(a => a.id !== source.id);

  await recordAuditLog({
    category: 'reading_extraction',
    action: `Recorded p.${source.page} as a further passage of 2nd Order construct "${secShortLabel(target)}" (${getDisplayName(doc)})`,
    detail: `The authors state the same interpretation in several places. Former separate construct: ${secShortLabel(source)}. ` +
      `${children.length} linked quote(s) and ${addedClusterIds.length} matrix placement(s) moved with it.`,
    fromVal: `${secShortLabel(target)} + ${secShortLabel(source)}`,
    toVal: `${secShortLabel(target)} (${target.passages.length + 1} passages)`
  });
  updateSidebar();
  renderHighlights();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
  showSnackbar(`Now one construct with ${target.passages.length + 1} passages — Ctrl+Z to undo`);
}

// The passage turns out to be a different interpretation: make it its own construct again
async function splitOffPassage(sec, pid) {
  const p = sec.passages.find(x => x.id === pid);
  if (!p) return;
  const affectedQuotes = (p.absorbed?.movedQuoteIds || []).map(id => state.annotations.find(a => a.id === id)).filter(Boolean);
  pushAnnoSnapshotUndo(`Split off p.${p.page} from "${secShortLabel(sec)}"`, [sec, ...affectedQuotes], []);
  let restored;
  if (p.absorbed?.snapshot) {
    restored = normalizeAnnotation(JSON.parse(JSON.stringify(p.absorbed.snapshot)));
    if (state.annotations.some(a => a.id === restored.id)) restored.id = 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    // Give back the matrix rows it brought with it (only those the target did not have already)
    (p.absorbed.addedClusterIds || []).forEach(cid => {
      sec.clusterIds = sec.clusterIds.filter(x => x !== cid);
      delete sec.clusterRelations[cid]; delete sec.clusterComments[cid];
    });
    restored.clusterIds = restored.clusterIds.filter(cid => state.clusters.some(c => c.id === cid));
    for (const f of affectedQuotes) { unlinkQuote(f, sec.id); linkQuote(f, restored.id); await dbPut('annotations', f); }
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
  sec.passages = sec.passages.filter(x => x.id !== pid);
  // Patch the undo entry so that Undo also removes the re-created construct
  const top = state.undoStack[state.undoStack.length - 1];
  if (top && top.type === 'annotation_snapshots') top.createdIds = [restored.id];
  await dbPut('annotations', sec);
  await dbPut('annotations', restored);
  state.annotations.push(restored);
  await recordAuditLog({
    category: 'reading_extraction',
    action: `Split p.${p.page} off "${secShortLabel(sec)}" as a separate 2nd Order construct (${getDisplayName(state.docs.find(d => d.id === sec.docId))})`,
    detail: 'On re-reading, this passage expresses a different interpretation of the authors.'
  });
  updateSidebar();
  renderHighlights();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
}

async function removePassage(sec, pid) {
  const p = sec.passages.find(x => x.id === pid);
  if (!p) return;
  if (p.absorbed && !confirm('This passage was a separate construct before. Remove it entirely? (Use ↗ Split off to keep it as its own construct. Ctrl+Z to undo.)')) return;
  const affectedQuotes = (p.absorbed?.movedQuoteIds || []).map(id => state.annotations.find(a => a.id === id)).filter(Boolean);
  pushAnnoSnapshotUndo(`Removed passage p.${p.page} from "${secShortLabel(sec)}"`, [sec, ...affectedQuotes]);
  sec.passages = sec.passages.filter(x => x.id !== pid);
  await dbPut('annotations', sec);
  updateSidebar();
  renderHighlights();
  showSnackbar('Passage removed — Ctrl+Z to undo');
}
async function wrapFirstOrderInSecondOrder(f, initialConceptLabel = '') {
  const doc = state.docs.find(d => d.id === f.docId);
  const label = initialConceptLabel || f.note || prompt(
    'Enter a 2nd Order Construct / Conceptual Label for this descriptive quote (e.g., "[Descriptive Theme]Delayed Access"):',
    f.note ? f.note : '[Descriptive] '
  );
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
  await dbPut('annotations', wrapperSec);
  state.annotations.push(wrapperSec);

  linkQuote(f, wrapperSec.id);
  await dbPut('annotations', f);

  await recordAuditLog({
    category: 'linking',
    action: `[Reviewer-wrapped] Created 2nd Order Concept Wrapper from Unlinked 1st Order Quote (${getDisplayName(doc)}, p.${f.page})`,
    detail: `Quote: "${f.text.slice(0, 80)}..."`,
    toVal: `2nd Order Concept: ${wrapperSec.note}`
  });

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
      <select class="quick-link-sec-sel w-full text-xs border border-emerald-300 rounded px-1.5 py-1 bg-emerald-50/70 hover:bg-emerald-50 text-emerald-950 font-semibold focus:outline-none focus:border-emerald-600 cursor-pointer">
        <option value="">🔗 ${isLinked ? 'Also link to another' : 'Link to'} 2nd Order Construct in this study (${linkableSeconds.length})...</option>
        ${linkableSeconds.map(s => `<option value="${escapeHtml(s.id)}">🟩 p.${escapeHtml(s.page)}: ${escapeHtml(s.note || s.text.slice(0, 48) + '...')}</option>`).join('')}
      </select>
    </div>
  ` : '';

  c.innerHTML = `
    <div class="flex justify-between items-center text-blue-800 font-bold text-[13px]">
      <span class="flex items-center space-x-1">
        <span>🟦 1st Order</span>
        <button type="button" class="jump-pdf-btn font-bold text-xs bg-blue-100 hover:bg-blue-200 text-blue-900 px-1.5 py-0.2 rounded-full cursor-pointer transition flex items-center space-x-0.5" title="Jump to PDF page ${f.page}"><i class="ph ph-crosshair"></i><span>p.${f.page}</span></button>
        <button type="button" class="rev-badge-btn text-[11px] bg-slate-200 hover:bg-indigo-100 text-slate-700 hover:text-indigo-800 px-1 py-0.2 rounded font-mono cursor-pointer transition" title="Click to change reviewer">@${escapeHtml(f.by || 'Unknown')}</button>
      </span>
      <div class="flex items-center space-x-1">
        <button type="button" class="toggle-order-btn text-[11px] text-emerald-800 hover:bg-emerald-100 border border-emerald-300 bg-white px-1.5 py-0.2 rounded font-semibold cursor-pointer flex items-center space-x-0.5" title="Switch type directly to 2nd Order Construct"><i class="ph ph-arrows-left-right"></i><span>To 2nd</span></button>
        <button type="button" class="edit-f-quote-btn text-[11px] text-blue-700 hover:bg-blue-100 px-1 py-0.2 rounded font-semibold cursor-pointer flex items-center space-x-0.5" title="Edit quote text (clean up 2-column PDF artifacts)"><i class="ph ph-pencil-simple"></i><span>Edit</span></button>
        ${isLinked
          ? `<button class="unl mr-1 text-slate-400 hover:text-slate-700 cursor-pointer" title="Unlink from this 2nd Order Construct (other links are kept)"><i class="ph ph-link-break"></i></button>`
          : `<button class="promote-sec px-1.5 py-0.2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 rounded text-[11px] font-semibold cursor-pointer" title="Keep this 1st Order quote and wrap it in a new parent 2nd Order Concept">+ Wrap</button>`}
        <button class="del text-slate-400 hover:text-rose-500 cursor-pointer" title="Delete Quote"><i class="ph ph-trash"></i></button>
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
    <input type="text" class="f-note-input w-full text-xs border border-slate-200 p-1 rounded bg-white" placeholder="Participant attribution / context (e.g. Patient #4, Rural GP)..." value="${escapeHtml(f.note)}">
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
    const cleaned = stripOuterQuotes(fTextarea.value);
    if (cleaned && cleaned !== f.text) {
      f.text = cleaned;
      fDisplay.textContent = `"${cleaned}"`;
      await dbPut('annotations', f);
      renderHighlights();
    }
    toggleFirstEditor(false);
  };

  const debouncedSaveFirst = createDebouncedSaver(async () => { await dbPut('annotations', f); }, 350);
  c.querySelector('.f-note-input').addEventListener('input', e => { f.note = e.target.value; debouncedSaveFirst(); });
  c.querySelector('.f-nuance-input').addEventListener('input', e => { f.nuanceNote = e.target.value; debouncedSaveFirst(); });

  const quickLinkSel = c.querySelector('.quick-link-sec-sel');
  if (quickLinkSel) {
    quickLinkSel.onchange = async (e) => {
      const targetSecId = e.target.value;
      if (!targetSecId) return;
      const targetSec = state.annotations.find(x => x.id === targetSecId);
      linkQuote(f, targetSecId);
      await dbPut('annotations', f);
      await recordAuditLog({
        category: 'linking',
        action: `Linked 1st Order Quote to 2nd Order Construct (${getDisplayName(activeDoc)})`,
        detail: `Quote (p.${f.page}): "${f.text.slice(0, 80)}..."`,
        toVal: targetSec ? `2nd Order: ${targetSec.note || '"' + targetSec.text.slice(0, 60) + '..."'}` : '',
        isMinorOp: true
      });
      updateSidebar();
    };
  }

  c.querySelector('.del').onclick = async () => {
    if (!confirm('Delete this 1st Order Quote? (You can Undo with Ctrl+Z)')) return;
    pushUndoAction({ type: 'delete_annotation', label: `1st Order Quote (p.${f.page})`, annotations: [{ ...f }] });
    await dbDelete('annotations', f.id);
    state.annotations = state.annotations.filter(x => x.id !== f.id);
    updateSidebar();
    renderHighlights();
  };
  if (isLinked) {
    c.querySelector('.unl').onclick = async () => {
      if (parentSec) unlinkQuote(f, parentSec.id); else clearQuoteLinks(f);
      await dbPut('annotations', f);
      await recordAuditLog({
        category: 'linking',
        action: 'Unlinked 1st Order Quote from 2nd Order Construct',
        detail: `Quote (p.${f.page}): "${f.text.slice(0, 70)}..."`,
        fromVal: parentSec ? (parentSec.note || parentSec.text.slice(0, 50)) : '',
        isMinorOp: true
      });
      updateSidebar();
    };
  } else {
    c.querySelector('.promote-sec').onclick = async () => {
      const created = await wrapFirstOrderInSecondOrder(f);
      if (created) updateSidebar();
    };
  }
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
    submitBtn.className = 'px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-xs cursor-pointer transition';
  } else {
    badge.className = 'text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300';
    badge.textContent = '🟦 Add 1st Order Quote';
    noteInput.placeholder = 'Participant attribution / context, e.g. Patient #4, Rural GP (optional)...';
    textInput.placeholder = 'Paste or type 1st Order participant quote...';
    submitBtn.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs cursor-pointer transition';
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
  // Clear the form before the (async) save, so typing the next entry right away is never wiped
  closeManualAddDrawer();
  await dbPut('annotations', a);
  state.annotations.push(a);
  updateSidebar();
  showSnackbar(`Added manual ${activeManualAddType === 'second_order' ? '2nd Order Construct' : '1st Order Quote'} (p.${cleanPage})`);
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
  const snapshotBefore = JSON.parse(JSON.stringify(a));

  if (a.type === 'first_order') {
    pushUndoAction({
      type: 'toggle_order_type',
      label: `Switch 1st ➔ 2nd Order (p.${a.page})`,
      snapshot: snapshotBefore,
      unlinkedChildrenIds: []
    });
    a.type = 'second_order';
    clearQuoteLinks(a);
    // A 1st Order note is a participant attribution (e.g. "Patient #4"), not a concept label: keep it as a memo, not as the 2nd Order label
    if (a.note && a.note.trim()) {
      a.nuanceNote = `[Participant attribution (from 1st Order): ${a.note.trim()}]${a.nuanceNote ? '\n' + a.nuanceNote : ''}`;
    }
    a.note = '';
    a.origin = 'author_passage';
    a.noteSource = 'author';
    normalizeAnnotation(a);
    await dbPut('annotations', a);
    await recordAuditLog({
      category: 'linking',
      action: `Switched 1st Order Quote to 2nd Order Construct (${getDisplayName(doc)}, p.${a.page})`,
      detail: `"${a.text.slice(0, 80)}..."`,
      fromVal: '1st Order Quote',
      toVal: '2nd Order Construct',
      isMinorOp: true
    });
  } else {
    const linkedChildren = quotesOf(a.id);
    const hasClusters = Array.isArray(a.clusterIds) && a.clusterIds.length > 0;
    if ((a.passages || []).length) {
      alert(`This construct has ${a.passages.length} additional passage(s). Split them off (↗) before switching it to a 1st Order quote.`);
      return;
    }
    if (linkedChildren.length > 0 || hasClusters) {
      const ok = confirm(
        `Switch this 2nd Order construct to a 1st Order Quote?
` +
        (linkedChildren.length ? `• ${linkedChildren.length} linked quote(s) will be unlinked.
` : '') +
        (hasClusters ? `• It will be removed from ${a.clusterIds.length} Matrix row(s).` : '')
      );
      if (!ok) return;
    }
    pushUndoAction({
      type: 'toggle_order_type',
      label: `Switch 2nd ➔ 1st Order (p.${a.page})`,
      snapshot: snapshotBefore,
      unlinkedChildrenIds: linkedChildren.map(c => c.id)
    });
    for (const child of linkedChildren) {
      unlinkQuote(child, a.id);
      await dbPut('annotations', child);
    }
    a.type = 'first_order';
    clearQuoteLinks(a);
    delete a.passages;
    // The 2nd Order label is a concept name, not a participant attribution: keep it as a memo
    if (a.note && a.note.trim()) {
      a.nuanceNote = `[Former 2nd Order label: ${a.note.trim()}]${a.nuanceNote ? '\n' + a.nuanceNote : ''}`;
    }
    a.note = '';
    a.clusterIds = [];
    a.clusterComments = {};
    a.clusterRelations = {};
    await dbPut('annotations', a);
    await recordAuditLog({
      category: 'linking',
      action: `Switched 2nd Order Construct to 1st Order Quote (${getDisplayName(doc)}, p.${a.page})`,
      detail: `"${a.text.slice(0, 80)}..."`,
      fromVal: '2nd Order Construct',
      toVal: '1st Order Quote',
      isMinorOp: true
    });
  }

  renderHighlights();
  updateSidebar();
  if (!divMatrix.classList.contains('hidden')) renderMatrixView();
}
