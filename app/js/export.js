// Meta-Ethnography Canvas — Export tables (Tab 4)
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// Methods summary, eMERGe checklist, Tables 1 / 2 / 2b / 3, Appendix; rich copy, Markdown, Word (.docx) and CSV export.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// VIEW 4: PUBLICATION TABLES GENERATOR (Tables 1, 2, 3-SoQF, Appendix)
// ========================================================
document.querySelectorAll('.pub-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activePubTable = btn.dataset.pub;
    document.querySelectorAll('.pub-tab-btn').forEach(b => {
      b.className = b.dataset.pub === state.activePubTable
        ? "pub-tab-btn px-2.5 py-1 text-xs font-bold rounded bg-white text-indigo-700 shadow-sm cursor-pointer"
        : "pub-tab-btn px-2.5 py-1 text-xs font-medium rounded text-slate-600 hover:text-slate-900 cursor-pointer";
    });
    renderPublicationView();
  });
});

// ---- Table 1b (/1c): the judgement on each domain of the appraisal tool, per study (eMERGe Part 3) ----
// One table per checklist in use. Cells hold the judgement and the reviewer's reason; nothing is summed or ranked.
function getAppraisalDomainSpecs() {
  const tools = Object.keys(APPRAISAL_CHECKLISTS).filter(t => state.docs.some(d => normalizeDoc(d).appraisalTool === t && hasAppraisalDomains(d)));
  return tools.map((tool, ti) => {
    const c = APPRAISAL_CHECKLISTS[tool];
    const docs = state.docs.filter(d => d.appraisalTool === tool && hasAppraisalDomains(d));
    const letter = String.fromCharCode(98 + ti); // b, c
    return {
      title: `Table 1${letter}. Methodological Strengths and Limitations of Included Studies: ${c.name}`,
      caption: `Judgement on each question of the ${c.name}, with the reviewers' reasons. The answers are a record of judgements and were not added up into a score (eMERGe Part 3, France et al., 2019). Source: ${c.cite}`,
      headers: ['Study', ...c.items.map((_, i) => `Q${i + 1}`)],
      widths: [12, ...c.items.map(() => 88 / c.items.length)],
      rows: docs.map(d => {
        const items = appraisalItemsOf(d, tool);
        return [getDisplayName(d), ...c.items.map(it => {
          const v = items[it.id] || {};
          const label = appraisalAnswerLabel(tool, v.a);
          return [label, v.note].filter(Boolean).join(' — ') || '-';
        })];
      }),
      key: c.items.map((it, i) => `Q${i + 1}. ${it.text}`),
      // The checklist's own summary per study (CASP: positive / negative / unknowns), where written
      summaries: c.summary ? docs.map(d => {
        const sm = appraisalSummaryOf(d, tool);
        const parts = c.summary.fields.filter(([k]) => sm[k]).map(([k, label]) => `${label}: ${sm[k]}`);
        return parts.length ? `${getDisplayName(d)} — ${parts.join('; ')}` : '';
      }).filter(Boolean) : []
    };
  });
}
function buildAppraisalDomainsHtml() {
  return getAppraisalDomainSpecs().map(spec => `
    <div class="mb-3" style="margin-top:28px;">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">${escapeHtml(spec.title)}</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">${escapeHtml(spec.caption)}</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead><tr>${spec.headers.map((h, i) => `<th style="width:${spec.widths[i]}%;">${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${spec.rows.map(r => '<tr>' + r.map((c, i) => i === 0 ? `<td><b>${escapeHtml(c)}</b></td>` : `<td>${escapeHtml(c)}</td>`).join('') + '</tr>').join('')}</tbody>
    </table>
    <p style="font-family: Georgia, serif; font-size: 10.5px; color: #475569; margin-top:6px;">${spec.key.map(escapeHtml).join('<br>')}</p>
    ${spec.summaries.length ? `<p style="font-family: Georgia, serif; font-size: 11px; color: #334155; margin-top:8px;"><b>Appraisal summary</b><br>${spec.summaries.map(escapeHtml).join('<br>')}</p>` : ''}`).join('');
}

function buildTable1Html() {
  let rowsHtml = '';
  state.docs.forEach((d, idx) => {
    normalizeDoc(d);
    const isIdx = idx === 0;
    rowsHtml += `
      <tr>
        <td><b>${escapeHtml(getDisplayName(d))}</b>${isIdx ? ` <br><span style="font-size:10px; color:#b45309;">${escapeHtml(firstStudyMeta().short)}</span>` : ''}</td>
        <td>${escapeHtml(d.title || d.name)}</td>
        <td>${escapeHtml(d.setting || '-')}</td>
        <td>${escapeHtml(d.participants || '-')}</td>
        <td>${escapeHtml(d.methodology || '-')}</td>
        <td>${escapeHtml(getAppraisalDisplayString(d))}</td>
        <td>${escapeHtml(d.richness || '-')}</td>
        <td>${escapeHtml(d.contextNote || '-')}</td>
        <td>${escapeHtml(funderLinkedText(d))}</td>
      </tr>
    `;
  });

  return `
    <div class="mb-3">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">Table 1. Characteristics and Critical Appraisal of Included Studies (${state.docs.length} studies)</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">Ordered by translation sequence (${escapeHtml(getOrderStrategy() === 'index' ? '#1 denotes the index paper' : getOrderStrategy() === 'chronological' ? 'chronological order of publication' : 'order chosen by the review team')}). Appraisal tool per study as recorded (e.g., CASP, JBI, MMAT, ETQS, Dixon-Woods prompts).</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead>
        <tr>
          <th>Study (Author, Year)</th>
          <th>Full Title</th>
          <th>Country / Setting</th>
          <th>Participants / Sample</th>
          <th>Methodology & Analysis</th>
          <th>Methodological Quality (Tool / Rating)</th>
          <th>Conceptual Depth (Richness)</th>
          <th>Limitations / Contextual Notes</th>
          <th>Funder / Linked Accounts</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="9">No studies added yet.</td></tr>'}
      </tbody>
    </table>
    ${buildAppraisalDomainsHtml()}
  `;
}

function teamModelsHtml() {
  const models = Array.isArray(state.loa.teamModels) ? state.loa.teamModels : [];
  if (models.length === 0) return '';
  return `<div style="margin-top: 12px; padding-top: 8px; border-top: 1px dashed #94a3b8;">
    <div style="font-size: 12px; font-weight: bold; color: #0f172a; margin-bottom: 4px;">Independent models developed before merging (${models.length})</div>
    ${models.map(m => `<div style="font-size: 11.5px; color: #334155; margin-bottom: 6px;"><b>@${escapeHtml(m.reviewer)}${m.title ? ' — ' + escapeHtml(m.title) : ''}</b>${m.flow ? `<div style="font-family: monospace;">${escapeHtml(m.flow)}</div>` : ''}${(m.links || []).length ? `<div>${m.links.map(l => `${escapeHtml(l.from)} ${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym} ${escapeHtml(l.to)}`).join('; ')}</div>` : ''}${m.narrative ? `<div style="white-space: pre-wrap;">${escapeHtml(m.narrative)}</div>` : ''}</div>`).join('')}
    ${state.loa.teamMergeNote ? `<div style="font-size: 11.5px; color: #334155;"><b>How the models were merged:</b> ${escapeHtml(state.loa.teamMergeNote)}</div>` : ''}
  </div>`;
}

// Relation tag for a construct in a Table 2 row (the study that established the row has none)
function relTag(s, cid) {
  const r = secRelation(s, cid);
  if (r === 'other_aspect') return '[◇ Different aspect' + (s.aspectUsedInLoa && s.aspectUsedInLoa[cid] ? ', used in the line of argument' : '') + '] ';
  return r === 'refutational' ? '[⚡Refutational] ' : r === 'unjudged' ? '[○ Not yet judged] ' : '';
}
// Studies with nothing in the row but a recorded reason: "different aspect" (line of argument) and "checked, not addressed"
function cellStatusLines(c) {
  return state.docs.map(d => {
    const info = emptyCellInfo(c, d.id);
    return info ? `${info.symbol} ${info.label}: ${getDisplayName(d)}${info.note ? ' — ' + info.note : ''}${info.status === 'other_aspect' && info.usedInLoa ? ' (used in the line of argument)' : ''}` : '';
  }).filter(Boolean);
}

function buildTable2Html() {
  let rowsHtml = '';
  const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);

  state.clusters.forEach(c => {
    normalizeCluster(c);
    const mappedSecs = allSeconds.filter(s => s.clusterIds.includes(c.id));
    const contributingDocs = [...new Set(mappedSecs.map(s => {
      const doc = state.docs.find(d => d.id === s.docId);
      return doc ? getDisplayName(doc) : null;
    }).filter(Boolean))];

    const secondOrderListHtml = mappedSecs.map(s => {
      const doc = state.docs.find(d => d.id === s.docId);
      const dName = doc ? getDisplayName(doc) : 'Study';
      const rt = relTag(s, c.id);
      const refutBadge = rt ? `<span style="color:${rt.includes('⚡') ? '#be123c' : '#475569'}; font-weight:bold;">${escapeHtml(rt.trim())}</span> ` : '';
      const cellNuance = (s.clusterComments && s.clusterComments[c.id]) ? ` <i>[${escapeHtml(s.clusterComments[c.id])}]</i>` : '';
      const wrapTag = s.origin === 'wrapped_first_order' ? `<span style="color:#b45309; font-size:10px;">[reviewer-wrapped 1st-order quote]</span> ` : '';
      return `<div style="margin-bottom:6px;">• ${refutBadge}${wrapTag}<b>${escapeHtml(dName)} (p.${escapeHtml(secPagesLabel(s))}):</b> ${s.note ? `<b>${escapeHtml(s.note)}</b>${secLabelTag(s) ? ' <span style="color:#b45309; font-size:10px;">' + secLabelTag(s).trim() + '</span>' : ''} — ` : ''}"${escapeHtml(secEvidenceText(s))}"${cellNuance}</div>`;
    }).join('');

    const linkedQuotesList = [];
    const seenQ = new Set(); // a quote linked to two constructs in this row is listed once
    mappedSecs.forEach(s => {
      const doc = state.docs.find(d => d.id === s.docId);
      const dName = doc ? getDisplayName(doc) : 'Study';
      const firsts = quotesOf(s.id).filter(f => !seenQ.has(f.id) && seenQ.add(f.id));
      firsts.forEach(f => {
        const attrTag = f.note ? ` <b>[${escapeHtml(f.note)}]</b>` : '';
        linkedQuotesList.push(`<div style="margin-bottom:5px;">• <i>"${escapeHtml(f.text)}"</i>${attrTag} (${escapeHtml(dName)}, p.${f.page})</div>`);
      });
    });

    const transLabel = clusterTranslationLabel(c);

    rowsHtml += `
      <tr>
        <td>
          <b>${escapeHtml(c.thirdOrderTitle || '(Untitled 3rd Order Construct)')}</b>${c.autoSeeded && !c.seedConfirmed ? ' <span style="font-size:10px; color:#b45309;">(provisional: seeded from Index Paper, not yet confirmed)</span>' : ''}${c.baselineChange ? ' <span style="font-size:10px; color:#b45309;">(study #1 changed; translation not yet re-read)</span>' : ''}
          <div style="font-size:10.5px; color:#475569; margin-top:4px;"><b>Type:</b> ${escapeHtml(transLabel)}</div>
          <div style="font-size:10px; color:#64748b; margin-top:2px;"><b>Team status:</b> ${escapeHtml(concordanceLabel(c.concordanceStatus))}</div>
        </td>
        <td>${c.translationSummary ? `<div style="margin-bottom:6px;"><b>Translation:</b> ${escapeHtml(c.translationSummary)}</div>` : ''}${c.synthesisNote ? `<div><b>3rd order interpretation:</b> ${escapeHtml(c.synthesisNote)}</div>` : ''}${(!c.translationSummary && !c.synthesisNote) ? '-' : ''}</td>
        <td>${secondOrderListHtml || '-'}${cellStatusLines(c).map(l => `<div style="margin-top:4px; font-size:11px; color:#0369a1;">${escapeHtml(l)}</div>`).join('')}</td>
        <td>${linkedQuotesList.join('') || '-'}</td>
        <td>${escapeHtml(contributingDocs.join('; ') || '-')}</td>
        <td>
          <b>${escapeHtml(c.cerqualConfidence || 'Not assessed')}</b>
          ${c.cerqualExplanation ? `<div style="font-size:10px; color:#475569; margin-top:3px;">${escapeHtml(c.cerqualExplanation)}</div>` : ''}
        </td>
      </tr>
    `;
  });

  const loaBlockHtml = ((state.loa.teamModels || []).length || state.loa.aim || state.loa.title || state.loa.flow || state.loa.narrative || state.loa.relateProcess || state.loa.relateOutcome || state.loa.synthStudies || getLoaLinks().length) ? `
    <div style="margin-top: 22px; padding: 14px; border: 1.5px solid #0f172a; background-color: #f8fafc; font-family: Georgia, serif;">
      ${state.loa.aim ? `<div style="font-size: 11.5px; color: #334155; margin-bottom: 6px;"><b>Synthesis Aim / Review Question:</b> ${escapeHtml(state.loa.aim)}</div>` : ''}
      ${state.loa.relateProcess ? `<div style="font-size: 11.5px; color: #334155; margin-bottom: 6px;"><b>Phase 4 — Process of relating studies:</b> ${escapeHtml(state.loa.relateProcess)}</div>` : ''}
      ${state.loa.synthStudies ? `<div style="font-size: 11.5px; color: #334155; margin-bottom: 8px;"><b>Studies synthesized (Item 15):</b> ${escapeHtml(state.loa.synthStudies)}</div>` : ''}
      ${state.loa.relateOutcome ? `<div style="font-size: 11.5px; color: #334155; margin-bottom: 8px;"><b>Phase 4 — Outcome of relating studies:</b> ${escapeHtml(state.loa.relateOutcome)}</div>` : ''}
      <div style="font-size: 13px; font-weight: bold; color: #0f172a; margin-bottom: 6px;">
        Overarching Line of Argument Synthesis: ${escapeHtml(state.loa.title || '(Untitled Model)')}
      </div>
      ${(() => { const svg = buildConceptMapSvg('pub', 640, 360); return svg ? `<div style="margin-bottom:8px; text-align:center; background:#fff; border:1px solid #cbd5e1; padding:4px;"><div style="font-size:11px; font-weight:bold; text-align:left;">Concept relationship map (➔ leads to; ⇄ mutually related; dashed ⚡ in tension)</div>${svg}</div>` : ''; })()}
      ${state.loa.flow ? `<div style="font-size: 11.5px; font-family: monospace; background: #ffffff; padding: 6px 8px; border: 1px solid #cbd5e1; margin-bottom: 8px;"><b>Relational Flow:</b> ${escapeHtml(state.loa.flow)}</div>` : ''}
      ${state.loa.narrative ? `<div style="font-size: 13.5px; line-height: 1.55; color: #1e293b; white-space: pre-wrap;">${escapeHtml(state.loa.narrative)}</div>` : ''}
      ${state.loa.modelContext ? `<div style="font-size: 11.5px; color: #334155; margin-top: 8px;"><b>Where the model applies (Item 16):</b> ${escapeHtml(state.loa.modelContext)}</div>` : ''}
      ${teamModelsHtml()}
    </div>
  ` : '';

  return `
    <div class="mb-3">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">Table 2. Meta-Ethnographic Translation and Synthesis of 1st, 2nd, and 3rd Order Constructs</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">Illustrating how participant quotes (1st order, as reported in the primary studies) and primary author interpretations (2nd order) were translated into overarching 3rd order constructs with GRADE-CERQual confidence ratings.</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead>
        <tr>
          <th style="width:16%;">3rd Order Construct & Translation Type</th>
          <th style="width:20%;">Translation (A) & 3rd Order Interpretation (B)</th>
          <th style="width:24%;">2nd Order Constructs (Author Interpretations)</th>
          <th style="width:20%;">Illustrating 1st Order Quotes</th>
          <th style="width:10%;">Contributing Studies</th>
          <th style="width:10%;">GRADE-CERQual Confidence</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="6">No 3rd Order rows created yet.</td></tr>'}
      </tbody>
    </table>
    ${loaBlockHtml}
  `;
}

// ---- Table 3 (GRADE-CERQual): one spec, rendered to HTML / Markdown / Word ----
// Lewin et al. (2018): the SoQF table gives each finding's overall confidence + explanation; it is complemented by an
// Evidence Profile with the explicit judgement for each component. Mode lets the user choose how to present them.
const TABLE3_MODES = {
  combined: 'Combined (SoQF + Evidence Profile in one table)',
  soqf: 'Summary of Qualitative Findings only',
  profile: 'Evidence Profile only',
  both: 'Both, as two tables (3a SoQF, 3b Evidence Profile)'
};
function getTable3Mode() {
  const v = (() => { try { return lsGet('me_table3_mode'); } catch (e) { return null; } })();
  return TABLE3_MODES[v] ? v : 'combined';
}
// eMERGe Part 3 (France et al., 2019): CERQual can in principle be applied both to the synthesised themes / concepts of phases 3–5
// and to the broader concepts or theory of phase 6; guidance for the latter is still to be developed.
const CERQUAL_CAVEAT = 'GRADE-CERQual was applied to the third-order constructs, not to the line of argument. The eMERGe guidance notes that CERQual can in principle be applied both to the themes and concepts synthesised through translation and to the broader concepts or theory of a meta-ethnography, but that guidance for the latter is still to be developed (France et al., 2019); the CERQual developers likewise note that further work is needed for more interpretive outputs (Lewin et al., 2018).';
function getTable3Specs(mode = getTable3Mode()) {
  const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);
  const rows = state.clusters.map(c => {
    normalizeCluster(c);
    const mapped = allSeconds.filter(sx => sx.clusterIds.includes(c.id));
    const docs = [...new Set(mapped.map(sx => { const d = state.docs.find(x => x.id === sx.docId); return d ? getDisplayName(d) : null; }).filter(Boolean))];
    return {
      finding: { title: c.thirdOrderTitle || '(Untitled Finding)', note: c.synthesisNote || '' },
      studies: docs.join('; ') || '-',
      lim: cqDomainFull(c.cerqualLimitations, c.cerqualLimNote),
      coh: cqDomainFull(c.cerqualCoherence, c.cerqualCohNote),
      adeq: cqDomainFull(c.cerqualAdequacy, c.cerqualAdeqNote),
      rel: cqDomainFull(c.cerqualRelevance, c.cerqualRelNote),
      conf: c.cerqualConfidence || 'Not assessed',
      expl: cqExplainText(c)
    };
  });
  const soqf = {
    title: mode === 'both' ? 'Table 3a. GRADE-CERQual Summary of Qualitative Findings (SoQF)' : 'Table 3. GRADE-CERQual Summary of Qualitative Findings (SoQF)',
    caption: 'Overall confidence in each third-order review finding with its explanation (Lewin et al., 2018). ' + CERQUAL_CAVEAT,
    headers: ['Summary of Review Finding (3rd Order Construct)', 'GRADE-CERQual Assessment of Confidence', 'Explanation of GRADE-CERQual Assessment', 'Studies Contributing to the Review Finding'],
    widths: [34, 12, 34, 20],
    rows: rows.map(r => [r.finding, { strong: r.conf }, r.expl, r.studies])
  };
  const profile = {
    title: mode === 'both' ? 'Table 3b. GRADE-CERQual Evidence Profile' : 'Table 3. GRADE-CERQual Evidence Profile',
    caption: 'Judgement and explanation for each CERQual component behind the overall confidence in each finding (Lewin et al., 2018). ' + CERQUAL_CAVEAT,
    headers: ['Review Finding (3rd Order Construct)', 'Studies Contributing', 'Methodological Limitations', 'Coherence', 'Adequacy of Data', 'Relevance', 'Overall Confidence', 'Explanation'],
    widths: [17, 12, 12, 12, 12, 12, 10, 13],
    rows: rows.map(r => [{ title: r.finding.title }, r.studies, r.lim, r.coh, r.adeq, r.rel, { strong: r.conf }, r.expl])
  };
  const combined = {
    title: 'Table 3. GRADE-CERQual Summary of Qualitative Findings (SoQF) & Evidence Profile',
    caption: 'Assessment of confidence in each 3rd order review finding across Methodological Limitations, Coherence, Adequacy, and Relevance (Lewin et al., 2018). ' + CERQUAL_CAVEAT,
    headers: ['Summary of Review Finding (3rd Order Construct)', 'Studies Contributing to the Finding', 'Methodological Limitations', 'Coherence', 'Adequacy of Data', 'Relevance', 'Overall CERQual Confidence', 'Explanation of CERQual Assessment'],
    widths: [22, 12, 10, 10, 10, 10, 10, 16],
    rows: rows.map(r => [r.finding, r.studies, r.lim, r.coh, r.adeq, r.rel, { strong: r.conf }, r.expl])
  };
  if (mode === 'soqf') return [soqf];
  if (mode === 'profile') return [profile];
  if (mode === 'both') return [soqf, profile];
  return [combined];
}
function t3CellText(cell) {
  if (cell && typeof cell === 'object') {
    if ('strong' in cell) return cell.strong;
    return cell.title + (cell.note ? ': ' + cell.note : '');
  }
  return String(cell ?? '-');
}
function buildTable3SoQFHtml() {
  return getTable3Specs().map(spec => {
    const body = spec.rows.length
      ? spec.rows.map(r => '<tr>' + r.map(cell => {
          if (cell && typeof cell === 'object' && 'strong' in cell) return `<td><b>${escapeHtml(cell.strong)}</b></td>`;
          if (cell && typeof cell === 'object') return `<td><b>${escapeHtml(cell.title)}</b>${cell.note ? `<div style="margin-top:4px; font-size:11px; color:#334155;">${escapeHtml(cell.note)}</div>` : ''}</td>`;
          return `<td>${escapeHtml(cell)}</td>`;
        }).join('') + '</tr>').join('')
      : `<tr><td colspan="${spec.headers.length}">No 3rd Order rows created yet.</td></tr>`;
    return `
    <div class="mb-3" style="margin-top:8px;">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">${escapeHtml(spec.title)}</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">${escapeHtml(spec.caption)}</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%; margin-bottom:28px;">
      <thead><tr>${spec.headers.map((h, i) => `<th style="width:${spec.widths[i]}%;">${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }).join('');
}

// ---- Appendix B: 2nd order constructs that were not translated into any 3rd order row (one spec, three renderers) ----
// What did not fit is part of the synthesis: it can be a disconfirming case or an alternative reading (eMERGe items 12, 13).
function getNotTranslatedSpec() {
  const live = new Set(state.clusters.map(c => c.id));
  const secs = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation)
    .filter(s => !s.clusterIds.some(id => live.has(id)));
  const docIdx = id => { const i = state.docs.findIndex(d => d.id === id); return i < 0 ? 9999 : i; };
  secs.sort((a, b) => (docIdx(a.docId) - docIdx(b.docId)) || ((parseInt(a.page, 10) || 0) - (parseInt(b.page, 10) || 0)));
  const nStudies = new Set(secs.map(s => s.docId)).size;
  return {
    title: 'Appendix B. Second-Order Constructs Not Translated into a Third-Order Construct',
    caption: 'Constructs extracted from the primary studies that were not placed in any third-order construct, with the reviewers\' reasons where recorded. Reported for transparency: some may be disconfirming cases or alternative interpretations (eMERGe items 12 and 13).',
    headers: ['Study', 'Page(s)', 'Second-Order Construct (Authors\' Interpretation)', 'Why It Was Not Translated'],
    widths: [16, 8, 46, 30],
    count: secs.length,
    nStudies,
    rows: secs.map(s => {
      const d = state.docs.find(x => x.id === s.docId);
      return [d ? getDisplayName(d) : 'Study', secPagesLabel(s) || '-', (s.note ? s.note + secLabelTag(s) + ' — ' : '') + '"' + secEvidenceText(s) + '"', s.notTranslatedNote || '[Reason not recorded]'];
    })
  };
}
// ---- Appendix C: how the concepts within each study relate (eMERGe criterion 13: relationships within studies) ----
function getWithinStudyLinksSpec() {
  const rows = [];
  state.docs.forEach(d => studyConceptLinks(d).forEach(l => rows.push([getDisplayName(d), conceptLinkText(l), (LINK_TYPES[l.type] || LINK_TYPES.leads).label, l.note || '-'])));
  return {
    title: 'Appendix C. Relationships between Concepts within Each Study',
    caption: 'How the second-order constructs of each primary study relate to one another in that account, as recorded by the reviewers while reading, so that these relationships could be preserved in translation (eMERGe criterion 13).',
    headers: ['Study', 'Relationship', 'Type', 'Note'],
    widths: [16, 46, 16, 22],
    rows,
    nStudies: new Set(rows.map(r => r[0])).size
  };
}
function buildWithinStudyLinksHtml() {
  const spec = getWithinStudyLinksSpec();
  if (!spec.rows.length) return '';
  return `
    <div class="mb-3" style="margin-top:28px;">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">${escapeHtml(spec.title)}</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">${escapeHtml(spec.caption)}</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead><tr>${spec.headers.map((h, i) => `<th style="width:${spec.widths[i]}%;">${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${spec.rows.map(r => '<tr>' + r.map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>').join('')}</tbody>
    </table>`;
}

function buildNotTranslatedHtml() {
  const spec = getNotTranslatedSpec();
  const body = spec.rows.length
    ? spec.rows.map(r => '<tr>' + r.map((c, i) => `<td${i === 3 && c === '[Reason not recorded]' ? ' style="color:#2563eb;"' : ''}>${escapeHtml(c)}</td>`).join('') + '</tr>').join('')
    : `<tr><td colspan="4">Every extracted second-order construct was translated into at least one third-order construct.</td></tr>`;
  return `
    <div class="mb-3" style="margin-top:28px;">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">${escapeHtml(spec.title)}</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">${escapeHtml(spec.caption)}</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead><tr>${spec.headers.map((h, i) => `<th style="width:${spec.widths[i]}%;">${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// ---- Appendix A: the audit trail for the paper ----
// The trail itself always keeps everything (Tab 3; full trail as a supplementary .csv). Appendix A shows, by default, the
// key decisions: entries with a reason, memos, and decisions about the aim, the studies, the rows, the line of argument,
// the team and the data; routine bookkeeping (labels, links, placements, per-question appraisal, write-up wording) is left
// out, and repeated edits of one text (e.g. a row's Step B) become one line with the first and the last wording.
const APPENDIX_MODES = { key: 'Key decisions', full: 'Full audit trail' };
function getAppendixMode() { const m = lsGet('me_appendix_mode'); return APPENDIX_MODES[m] ? m : 'key'; }

// Edits of one text that are shown as one line in Appendix A (family name; same row for row texts)
const APPENDIX_EDIT_SERIES = [
  [/^Refined 3rd Order Construct Title$/, 'Row title refined'],
  [/^Updated Step A Translation Summary for /, 'Step A translation summary revised'],
  [/^Updated Step B 3rd Order Definition & Interpretation for /, 'Step B third-order interpretation revised'],
  [/^Reflexive note on /, 'Reflexive note on the row revised'],
  [/^3rd Order Team Perspective Updated /, 'Team perspective on the row revised'],
  [/^Updated GRADE-CERQual Assessment for /, 'GRADE-CERQual assessment revised'],
  [/^Updated Phase 1 Research Aim$/, 'Research aim revised'],
  [/^Updated Review question \(Item 3\)$/, 'Review question revised'],
  [/^Updated Line of Argument Synthesis/, 'Line of argument revised'],
  [/^Updated Phase 4: Outcome of Relating Studies/, 'Outcome of relating studies (Item 12) revised'],
  [/^Updated Alternative interpretations/, 'Alternative interpretations revised'],
  [/^Updated Context where the model applies/, 'Context where the model applies (Item 16) revised']
];
function appendixSeries(l) {
  const hit = APPENDIX_EDIT_SERIES.find(([re]) => re.test(l.action || ''));
  if (!hit) return null;
  // Same row by id; entries from older versions without row ids are kept apart by their action text (it names the row)
  return { label: hit[1], key: hit[1] + '|' + ((l.clusterIds || [])[0] || l.action || '') };
}
function isMemoLog(l) { return /^\[[^\]]+\]/.test(l.action || '') && !/^\[Reviewer-wrapped\]/.test(l.action || ''); }
// Routine bookkeeping: shown in the full trail; in Appendix A only when a reason was recorded with it
const APPENDIX_ROUTINE = [
  /^Linked 1st Order Quote/, /^Unlinked 1st Order Quote/, /^Switched (1st|2nd) Order/, /^\[Reviewer-wrapped\]/, /^Set 2nd Order label source/,
  /^Updated 2nd Order Summary Label/, /^Placed 2nd Order Construct/, /^Removed 2nd Order Construct from/,
  /^Added a further passage/, /^Recorded p\..* as a further passage/, /^Split p\..* off/, /^Recorded how two concepts relate within/, /^Removed a relationship between concepts within/,
  /^Edited the extracted text of/, /^Wrote Study Overview/, /^Revised Study Overview/,
  /^Imported Peer Construct from/, /^Merged \d+ audit trail entries from/, /^Recorded provisional agreement/, /^2nd Order Team Perspective Updated/,
  /^Reordered 3rd Order Theme Row/, /^Updated note on how a concept fits/, /^Noted why a 2nd Order construct was not translated/,
  /^Set subgroup for/, /^Appraisal \(/, /^Updated Critical Appraisal/, /^(Linked|Unlinked) .* companion paper/,
  /^Changed the reviewer attributed to an item/
];
// Write-up wording of the Methods (Tab 4 fields) is the Methods text itself, not a decision
const APPENDIX_WRITEUP = /^Updated (Reading & extraction process|Extracted from|Units of synthesis|Working definitions|Translation process|Quality appraisal policy|How appraisal was used|Process of relating studies|Studies synthesized into the line of argument)/;
function isKeyDecisionLog(l) {
  if ((l.rationale || '').trim()) return true;
  if (isMemoLog(l)) return true;
  const a = l.action || '';
  // Undoing a key decision (a row merge / split, a removed row or study) is itself key; undoing an extraction step is not
  if (/^Undid: /.test(a) && l.category === 'reading_extraction') return false;
  // Older trails logged several drawer fields in one entry ("Updated A / B / C"): leave it out only if every part is write-up wording
  if (/^Updated /.test(a) && a.slice(8).split(' / ').every(part => APPENDIX_WRITEUP.test('Updated ' + part))) return false;
  if (APPENDIX_ROUTINE.some(re => re.test(a))) return false;
  if (l.category === 'linking' || l.category === 'matrix_mapping' && !/^Auto-placed/.test(a)) return false;
  if (l.category === 'context_appraisal') return false; // reported per study in Table 1 / 1b
  // Empty-cell statuses are shown in Table 2b; a first judgement of a placement is shown in Tables 2 / 2b: only a CHANGED judgement is a decision here
  if (l.category === 'relating_studies' && !/^Updated Phase 4/.test(a)) return false;
  if (/^Judged construct as /.test(a)) return !/Not yet judged/.test(l.fromVal || '');
  return true;
}

function getAppendixASpec(mode = getAppendixMode()) {
  const all = [...state.logs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const fmt = t => new Date(t).toLocaleString();
  const rowOf = (l, extra = {}) => ({
    when: fmt(l.timestamp), reviewer: l.reviewer || 'Unknown', cat: l.category, category: getCategoryMeta(l.category).label,
    action: l.action || '', detail: l.detail || '', fromVal: l.fromVal || '', toVal: l.toVal || '', rationale: rationaleExportText(l), ...extra
  });
  const title = 'Appendix A. Methodological Audit Trail, Team Perspectives & Reflexive Synthesis Log';
  if (mode === 'full') {
    return { mode, title, caption: 'Chronological record of interpretive decisions, team perspectives, GRADE-CERQual judgements, and researcher reflexivity (eMERGe items 9, 11, 13, 15 and 18). Every entry of the audit trail is listed.', rows: all.map(l => rowOf(l)), total: all.length, shown: all.length };
  }
  // Key decisions, with repeated edits of one text folded into one line. A series is closed by any other key entry about the
  // same row (so the line stays in its place in the story), and an edit with a reason is never folded.
  const rows = [], open = new Map(); // series key -> row being built
  let nKey = 0;
  for (const l of all) {
    if (!isKeyDecisionLog(l)) continue;
    nKey++;
    const ser = !(l.rationale || '').trim() ? appendixSeries(l) : null;
    const rowIds = l.clusterIds || [];
    if (ser) {
      const g = open.get(ser.key);
      if (g) {
        g.n++; g.toVal = l.toVal || ''; g.lastT = l.timestamp; g.lastDetail = l.detail || '';
        const rv = l.reviewer || 'Unknown';
        if (g.reviewers.indexOf(rv) < 0) g.reviewers.push(rv);
        continue;
      }
      const r = rowOf(l, { n: 1, firstT: l.timestamp, lastT: l.timestamp, lastDetail: l.detail || '', reviewers: [l.reviewer || 'Unknown'], seriesLabel: ser.label, rowIds });
      rows.push(r); open.set(ser.key, r);
      continue;
    }
    // Another key entry about the same row(s), or a project-wide one for project-wide texts, closes their open series
    for (const [k, g] of open) {
      const sameRow = g.rowIds.length ? g.rowIds.some(id => rowIds.includes(id)) : (!rowIds.length && l.category === g.cat);
      if (sameRow) open.delete(k);
    }
    rows.push(rowOf(l));
  }
  rows.forEach(r => {
    if (!r.n || r.n < 2) return;
    r.when = `${fmt(r.firstT)} – ${fmt(r.lastT)}`;
    r.reviewer = r.reviewers.join(', ');
    r.action = `${r.seriesLabel} (${r.n} edits)${r.action.match(/ for "(.*)"$/) ? ': "' + r.action.match(/ for "(.*)"$/)[1] + '"' : ''}`;
    // The latest notes (e.g. the CERQual explanations) stay; Before ➔ After spans the first and the last edit
    r.detail = `${r.lastDetail ? r.lastDetail + '\n' : ''}(Before ➔ After: from the first to the last of these edits; each edit is in the full audit trail.)`;
  });
  return {
    mode, title, total: all.length, shown: rows.length,
    caption: `Key decisions from the audit trail: decisions about the aim and question, the studies and their order, the third-order constructs and their translation, the line of argument, the team's perspectives and the project data, every entry with a recorded reason, and the reflexive and analytic memos (eMERGe items 9, 11, 13, 15 and 18). Routine steps (labels, links, placements, per-question appraisal recorded in Table 1, wording of the Methods) are not listed, and repeated edits of one text are shown as one line with the first and the last wording. ${rows.length} line(s) from ${nKey} of ${all.length} audit trail entries; the full audit trail is available as a supplementary file.`,
    rows
  };
}
function appendixChangeText(r, arrow = '➔') {
  return (r.fromVal || r.toVal) ? `${r.fromVal ? 'From: ' + r.fromVal + ' ' : ''}${r.toVal ? arrow + ' To: ' + r.toVal : ''}` : '-';
}

function buildAppendixHtml() {
  const spec = getAppendixASpec();
  const rowsHtml = spec.rows.map(r => `
      <tr>
        <td style="white-space:nowrap;">${escapeHtml(r.when)}</td>
        <td><b>@${escapeHtml(r.reviewer)}</b></td>
        <td><b>${escapeHtml(r.category)}</b></td>
        <td><b>${escapeHtml(r.action)}</b>${r.detail ? `<br>${escapeHtml(r.detail)}` : ''}</td>
        <td>${escapeHtml(appendixChangeText(r))}</td>
        <td>${escapeHtml(r.rationale)}</td>
      </tr>`).join('');

  return `
    <div class="mb-3">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">${escapeHtml(spec.title)}</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">${escapeHtml(spec.caption)}</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Reviewer</th>
          <th>Phase / Category</th>
          <th>Action / Analytic Memo</th>
          <th>Conceptual Evolution (Before ➔ After)</th>
          <th>Methodological Rationale</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="6">No audit trail entries recorded yet.</td></tr>'}
      </tbody>
    </table>
    ${buildNotTranslatedHtml()}
    ${buildWithinStudyLinksHtml()}
  `;
}

function buildTable2GridHtml() {
  const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);
  const studyHeaders = state.docs.map((d, idx) =>
    `<th style="text-align:center; font-size:12px; min-width:70px;">${escapeHtml(getDisplayName(d))}${idx === 0 ? `<br><span style="font-size:9.5px; color:#b45309;">${escapeHtml(firstStudyMeta().short)}</span>` : ''}</th>`
  ).join('');

  let rowsHtml = '';
  state.clusters.forEach(c => {
    normalizeCluster(c);
    const mappedSecs = allSeconds.filter(s => s.clusterIds.includes(c.id));
    const studyCells = state.docs.map(d => {
      const docSecs = mappedSecs.filter(s => s.docId === d.id);
      if (docSecs.length === 0) {
        const info = emptyCellInfo(c, d.id);
        return `<td style="text-align:center; color:${info && info.status === 'other_aspect' ? '#0369a1' : '#64748b'};"${info && info.note ? ` title="${escapeHtml(info.note)}"` : ''}>${info ? info.symbol : ''}</td>`;
      }
      const hasRefut = docSecs.some(s => isSecRefutational(s, c.id));
      const symbol = contribSymbol(docSecs, c.id);
      const pages = [...new Set(docSecs.flatMap(s => secAllPassages(s).map(ps => String(ps.page)).filter(Boolean)))].map(pg => 'p.' + pg).join(', ');
      return `<td style="text-align:center; font-weight:bold; color:${hasRefut ? '#be123c' : '#0f172a'};">${symbol}<div style="font-size:9.5px; font-weight:normal; color:#64748b;">${escapeHtml(pages)}</div></td>`;
    }).join('');

    const transLabel = clusterTranslationLabel(c);

    rowsHtml += `
      <tr>
        <td>
          <b>${escapeHtml(c.thirdOrderTitle || '(Untitled 3rd Order Theme)')}</b>${c.autoSeeded && !c.seedConfirmed ? ' <span style="font-size:10px; color:#b45309;">(provisional)</span>' : ''}
          <div style="font-size:10.5px; color:#475569;">${escapeHtml(transLabel)}</div>
        </td>
        ${studyCells}
        <td style="text-align:center;"><b>${escapeHtml(c.cerqualConfidence || 'Not assessed')}</b></td>
      </tr>
    `;
  });

  return `
    <div class="mb-3">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">Table 2b. Concept-by-Study Contribution Matrix Across Included Studies</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">Showing which primary studies contributed 2nd order constructs to each 3rd order theme (${escapeHtml(TABLE2B_LEGEND)}). ${escapeHtml(TABLE2B_NOTE)}</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead>
        <tr>
          <th style="width:22%;">3rd Order Construct (Theme)</th>
          ${studyHeaders}
          <th style="text-align:center; width:10%;">CERQual Confidence</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="${state.docs.length + 2}">No 3rd Order rows created yet.</td></tr>`}
      </tbody>
    </table>
  `;
}

// ---- GRADE-CERQual display helpers ----
function cqDomainText(v) { return (!v || v === 'Not assessed') ? 'Not assessed' : v + ' concerns'; }
function cqDomainFull(v, note) { return cqDomainText(v) + (note ? ' — ' + note : ''); }
function cqExplainText(c) {
  if (c.cerqualExplanation) return c.cerqualExplanation;
  return (c.cerqualConfidence && c.cerqualConfidence !== 'Not assessed') ? '[Explanation not yet entered]' : '-';
}

// ---- eMERGe reporting guidance (France et al., 2019): 19 criteria in 7 phases ----
// level: 'app' = reported by the app's outputs, 'partial' = app supplies part of it, 'author' = author must write it
function getEmergeChecklist() {
  const nDocs = state.docs.length;
  const nCl = state.clusters.length;
  const loa = state.loa || {};
  const hasAim = !!(loa.aim && loa.aim.trim());
  const hasLoa = !!(loa.title || loa.flow || loa.narrative);
  const hasRelProc = !!(loa.relateProcess && loa.relateProcess.trim());
  const hasRelOut = !!(loa.relateOutcome && loa.relateOutcome.trim());
  const memoCount = state.logs.filter(l => l.category === 'reflexive_memo').length;
  const assessed = state.clusters.filter(c => c.cerqualConfidence && c.cerqualConfidence !== 'Not assessed').length;
  const A = (text) => ({ level: 'author', text });
  const P = (text) => ({ level: 'partial', text });
  const R = (text) => ({ level: 'app', text });
  const phases = [
    { name: 'Phase 1\nSelecting meta-ethnography and getting started', items: [
      [1, 'Rationale and context', 'Gap in knowledge to be filled and wider context of the review', A('Author to complete (Introduction)')],
      [2, 'Aim(s)', 'State the aim(s) of the meta-ethnography', hasAim ? R('Project Setup (Aim) → Methods Summary') : A('Not entered: set in Project Setup')],
      [3, 'Focus', 'State the review question(s) or objectives', (loa.reviewQuestion && loa.reviewQuestion.trim()) ? R('Review Question field → Methods Summary') : A('Not entered: use the Review Question field (Project Setup, or the write-up fields beside the Methods Summary)')],
      [4, 'Rationale for using meta-ethnography', 'Why meta-ethnography was the most appropriate synthesis methodology', A('Author to complete (Introduction / Methods)')] ] },
    { name: 'Phase 2\nDeciding what is relevant', items: [
      [5, 'Search strategy', 'Rationale for the literature search strategy', A('Author to complete (Methods; done outside the app)')],
      [6, 'Search processes', 'How the searching was carried out and by whom', A('Author to complete (Methods; done outside the app)')],
      [7, 'Selecting primary studies', 'Screening and selection process, and who was involved', A('Author to complete (Methods; done outside the app)')],
      [8, 'Outcome of study selection', 'Results of searches and screening (e.g., flow diagram)', A('Author to complete (Findings; PRISMA flow outside the app)')] ] },
    { name: 'Phase 3\nReading included studies', items: [
      [9, 'Reading and data extraction approach', 'Reading and extraction methods, who did them, independence, checking and discussion; full account vs findings only; units of synthesis',
        (loa.readingApproach && loa.extractionScope && loa.unitsTerminology) ? R('Phase 3 fields → Methods Summary')
          : (loa.readingApproach || loa.extractionScope || loa.unitsTerminology) ? P('Phase 3 fields partly filled (process / extracted from / units of synthesis)')
          : (nDocs > 0 ? A('Author to complete: use the Phase 3 write-up fields beside the Methods Summary') : A('No studies loaded yet'))],
      [10, 'Characteristics of included studies', 'Describe included studies, including context, funder and companion papers',
        nDocs === 0 ? A('No studies loaded yet')
          : (state.docs.every(d => d.setting && d.participants && d.methodology) && state.docs.some(d => d.funder)) ? R('Table 1 (incl. funder and linked accounts)')
          : P(`Table 1; ${state.docs.filter(d => !(d.setting && d.participants && d.methodology)).length} stud(ies) with missing context; ${state.docs.some(d => d.funder) ? '' : 'no funder recorded; '}link companion papers in Edit Study Info`)] ] },
    { name: 'Phase 4\nDetermining how studies are related', items: [
      [11, 'Process for determining how studies are related', 'Which aspects of studies were compared, and how', hasRelProc ? R('Item 11 field → Methods Summary / Table 2') : A('Author to complete: use the Item 11 write-up field beside the Methods Summary')],
      [12, 'Outcome of relating studies', 'How studies relate to each other, incl. disconfirming cases', hasRelOut ? R('Phase 4 outcome text → Table 2 / Table 2b; constructs not translated → Appendix B') : (nCl > 0 ? P('Table 2b (contribution grid); enter the outcome (Item 12) in Research Aim & Overall Model (Tab 2)') : A('Author to complete (Findings)'))] ] },
    { name: 'Phase 5\nTranslating studies into one another', items: [
      [13, 'Process of translating studies', 'Working definitions, preservation of context/meaning, reciprocal and refutational translation, alternative interpretations',
        (loa.translationDefinitions && loa.translationProcess && loa.alternativeInterpretations) ? R('Phase 5 fields → Methods Summary; Table 2, Appendix A')
          : (loa.translationDefinitions || loa.translationProcess || loa.alternativeInterpretations || nCl > 0) ? P('Complete the Phase 5 fields (definitions / process / alternative interpretations)')
          : A('Author to complete: use the Phase 5 write-up fields beside the Methods Summary and the alternative interpretations in Research Aim & Overall Model')],
      [14, 'Outcome of translation', 'Interpretive findings of the translation', nCl > 0 ? R('Table 2 / Table 2b') : A('No 3rd order constructs yet')] ] },
    { name: 'Phase 6\nSynthesizing translations', items: [
      [15, 'Synthesis process', 'Methods used to develop overarching concepts and the line of argument', hasLoa ? (loa.synthStudies && loa.synthStudies.trim() ? P('Line of Argument and synthesized-studies field → Methods Summary / Table 2; add who took part') : P('Line of Argument (Table 2); enter which studies were synthesized in the drawer and add who took part')) : A('Author to complete (Methods)')],
      [16, 'Outcome of synthesis process', 'New theory, framework, model or interpretation, and the context in which it applies (or not)',
        hasLoa ? ((loa.modelContext && loa.modelContext.trim()) ? R('Table 2 (Line of Argument model) + Item 16 context field') : P('Table 2 model; add where the model applies or not (Item 16 field)')) : A('Line of Argument not yet entered')] ] },
    { name: 'Phase 7\nExpressing the synthesis', items: [
      [17, 'Summary of findings', 'Main interpretive findings, compared with existing literature', A('Author to complete (Discussion)')],
      [18, 'Strengths, limitations and reflexivity', 'Methodological strengths/limits and impact of the research team', memoCount > 0 ? P('Appendix A (reflexive memos recorded); add funder and conflicts of interest') : A('Author to complete; record reflexive memos in the Audit Trail')],
      [19, 'Recommendations and conclusions', 'Implications for policy, practice and/or theory', A('Author to complete (Discussion)')] ] },
    { name: 'Part 3\nExtensions (not common to every meta-ethnography)', items: [
      ['Ext. 1', 'Format and content of the output', 'e.g., abstract and other output formats', A('Author to complete (supplementary eMERGe extension)')],
      ['Ext. 2', 'Methodological strengths and limitations of primary studies', 'Rationale for (not) appraising, the tool, the judgement on each domain for each study, and how the appraisal was used', (() => {
        const hasPolicy = !!(loa.appraisalPolicy || loa.appraisalUse);
        const appraised = state.docs.filter(d => d.quality || hasAppraisalDomains(d));
        if (!hasPolicy && appraised.length === 0) return A('Author to complete: use the appraisal write-up fields beside the Methods Summary');
        const noChecklist = appraised.filter(d => !APPRAISAL_CHECKLISTS[d.appraisalTool]);
        const incomplete = appraised.filter(d => APPRAISAL_CHECKLISTS[d.appraisalTool] && !appraisalDomainsComplete(d));
        const missing = [];
        if (!hasPolicy) missing.push('describe the appraisal policy and its use (write-up fields beside the Methods Summary)');
        if (appraised.length === 0) missing.push('no study appraised yet');
        if (incomplete.length) missing.push(`${incomplete.length} stud(ies) with domains not answered yet`);
        if (noChecklist.length) missing.push(`domain table for ${[...new Set(noChecklist.map(d => d.appraisalTool))].join(', ')} to add outside the app (no built-in checklist for this tool)`);
        return missing.length ? P('Appraisal policy / use → Methods Summary; domain judgements → Table 1b; still: ' + missing.join('; '))
          : R('Appraisal policy / use → Methods Summary; judgement on each domain → Table 1b');
      })()],
      ['Ext. 3', 'GRADE-CERQual confidence in review findings', 'Confidence in each finding, with all four components incl. methodological limitations, in a Summary of Qualitative Findings table (guidance for applying CERQual to a line of argument / theory is still to be developed)', nCl === 0 ? A('No 3rd order constructs yet') : (assessed === nCl ? R('Table 3') : (assessed > 0 ? P('Table 3 (some findings are still unrated)') : A('No finding assessed yet')))] ] }
  ];
  const rows = [];
  phases.forEach(ph => ph.items.forEach((it, i) => rows.push({
    phase: i === 0 ? ph.name : '', no: it[0], title: it[1], desc: it[2], level: it[3].level, text: it[3].text
  })));
  return rows;
}

// Version + DOI from app/version.js, e.g. " (version 1.1.0; https://doi.org/10.5281/zenodo.24200375)"
function appCitationHtml() {
  const M = window.ME_CANVAS;
  if (!M || !M.version) return '';
  return ` (version ${escapeHtml(M.version)}${M.conceptDoi ? '; https://doi.org/' + escapeHtml(M.conceptDoi) : ''})`;
}

// ---- Methods Summary: built ONCE as sections, rendered identically to HTML / Markdown / Word ----
// A sentence ending: no second full stop after a text that already ends with . ? or !
const endStop = t => /[.?!]\s*$/.test(String(t || '')) ? '' : '.';
// A gap for the write-up. With a field key (state.loa), clicking it in the preview goes to that field (Tab 4 panel or the drawer).
const PH = (t, field = '') => `<span class="mec-gap" style="color:#2563eb; font-weight:bold;"${field ? ` data-field="${field}" title="Click to go to this field" role="button" tabindex="0"` : ''}>[Author to insert: ${t}]</span>`;
function getMethodSections() {
  const docCount = state.docs.length;
  const tools = new Set();
  state.docs.forEach(d => { normalizeDoc(d); if (d.quality && d.appraisalTool) tools.add(d.appraisalTool); });
  const anyQuality = state.docs.some(d => d.quality);
  const anyRichness = state.docs.some(d => d.richness);
  const toolStr = tools.size > 0 ? Array.from(tools).join(', ') : '';
  const polHtml = state.loa.appraisalPolicy ? escapeHtml(state.loa.appraisalPolicy) + ' ' : '';
  const useHtml = state.loa.appraisalUse ? escapeHtml(state.loa.appraisalUse) : PH('how appraisal was used, e.g., whether any study was excluded, and whether it informed the reading of the studies or the CERQual judgements', 'appraisalUse');
  const qualityHtml = anyQuality
    ? polHtml + `The methodological quality of each included study was appraised${toolStr ? ' using <b>' + escapeHtml(toolStr) + '</b>' : ' ' + PH('appraisal tool')}; ${getAppraisalDomainSpecs().length ? ' the judgement on each domain of the tool, with reasons, is reported for each study in Table 1b' + (getAppraisalDomainSpecs().length > 1 ? '–1c' : '') + ', and the reviewers\' overall judgements in Table 1. The checklist answers were not added up into a score.' : ' the overall judgements are reported in Table 1.'}${anyRichness ? ' Conceptual richness of each study was also recorded (Table 1).' : ''} ${useHtml}`
    : (state.loa.appraisalPolicy ? polHtml + useHtml : PH('whether and how the quality of the included studies was appraised, and how appraisal was used', 'appraisalPolicy'));

  const synthHtml = state.loa.synthStudies ? ' Studies included in the line-of-argument synthesis: ' + escapeHtml(state.loa.synthStudies) + '.' : '';
  const hasLoaModel = !!(state.loa.title || state.loa.flow || state.loa.narrative);
  const nCl = state.clusters.length;
  const cqAnyAssessed = state.clusters.some(c => c.cerqualConfidence && c.cerqualConfidence !== 'Not assessed');
  const cqAllAssessed = nCl > 0 && state.clusters.every(c => c.cerqualConfidence && c.cerqualConfidence !== 'Not assessed');
  const cqCount = state.clusters.filter(c => c.cerqualConfidence && c.cerqualConfidence !== 'Not assessed').length;
  const seedCount = state.clusters.filter(c => c.autoSeeded).length;

  const reviewers = new Set();
  state.annotations.forEach(a => { if (a.by) reviewers.add(a.by); });
  state.clusters.forEach(c => { if (c.by) reviewers.add(c.by); });
  state.logs.forEach(l => { if (l.reviewer) reviewers.add(l.reviewer); });
  const isTeam = reviewers.size > 1;
  const memoCount = state.logs.filter(l => l.category === 'reflexive_memo').length;

  const firstName = docCount > 0 ? escapeHtml(getDisplayName(state.docs[0])) : '[first study]';
  const strategy = getOrderStrategy();
  const orderWhy = (state.loa.orderRationale || '').trim() ? escapeHtml(state.loa.orderRationale.trim()) : '';
  const orderHtml = strategy === 'index'
    ? `Studies were ordered for translation, designating <b>${firstName}</b> as the index paper. ${orderWhy || PH('why this study was chosen as the index paper')}`
    : strategy === 'chronological'
      ? `Studies were translated in chronological order of publication, beginning with <b>${firstName}</b>. ${orderWhy || PH('how each study was compared with the studies before it')}`
      : `Studies were translated in the order shown in Table 1, beginning with <b>${firstName}</b>. ${orderWhy || PH('rationale for this translation order')}`;
  // Only what the project data shows: how many rows were seeded, how many of them the reviewer confirmed, how many were added later
  const seedConfirmedCount = state.clusters.filter(c => c.autoSeeded && c.seedConfirmed).length;
  const laterRows = nCl - seedCount;
  const seedHtml = seedCount > 0
    ? ` The second-order constructs of the first study (${firstName}) were placed as ${seedCount} provisional third-order row${seedCount === 1 ? '' : 's'}`
      + ` (${seedConfirmedCount} of which ${seedConfirmedCount === 1 ? 'was' : 'were'} later confirmed by the reviewer)`
      + `${laterRows > 0 ? `; ${laterRows} further row${laterRows === 1 ? ' was' : 's were'} created during translation` : ''}.`
    : (state.loa.seedChoice === 'manual' && nCl > 0 ? ` The ${nCl === 1 ? 'third-order row was' : nCl + ' third-order rows were'} created by the reviewer as each concept was compared with those of the other studies; the constructs of the first study were not placed automatically.` : '');
  // Relations actually recorded in the matrix (the study that established a row has none of its own there)
  const live = new Set(state.clusters.map(c => c.id));
  let refutCells = 0, unjudgedCells = 0;
  state.annotations.forEach(a => {
    if (a.type !== 'second_order') return;
    (a.clusterIds || []).filter(id => live.has(id)).forEach(id => {
      const r = secRelation(a, id);
      if (r === 'baseline') return;
      if (r === 'unjudged') unjudgedCells++;
      if (r === 'refutational') refutCells++;
    });
  });
  const unjudgedHtml = unjudgedCells ? ` ${PH(`${unjudgedCells} placement(s) of a construct in a row have no reciprocal / refutational judgement yet (○ in Table 2b)`)}` : '';
  const aspectCells = getOtherAspectCells();
  // Counted per study and row (a study with two ◇ cards in one row is one instance)
  const byPair = new Map(); aspectCells.forEach(x => { const k = x.cluster.id + '|' + x.doc.id; byPair.set(k, (byPair.get(k) || false) || x.used); });
  const otherAspect = byPair.size, aspectUsed = [...byPair.values()].filter(Boolean).length;
  const otherAspectHtml = !otherAspect ? ''
    : ` In ${otherAspect} ${otherAspect === 1 ? 'instance' : 'instances'} a study addressed a different aspect of a theme rather than translating into it (◇ in Table 2b)`
      + (aspectUsed ? `; the line-of-argument synthesis drew on ${aspectUsed === otherAspect ? (otherAspect === 1 ? 'it' : 'all of them') : aspectUsed + ' of them'} (marked in Table 2). ${PH('how these different aspects were brought into the line of argument')}`
        : `. ${PH('whether and how these different aspects were used in the line-of-argument synthesis (none is marked as used in the Research Aim & Overall Model drawer)')}`);
  // How the rows were based: on the construct of one study (◆), or with no single base (every placement judged)
  const rowsWithCards = state.clusters.filter(c => clusterSecsIn(c).length);
  const nBased = rowsWithCards.filter(c => rowBaseDocId(c)).length, nNoBase = rowsWithCards.length - nBased;
  const BASED = 'the construct of one study established the row (◆ in Table 2b) and the constructs of the other studies were judged against it';
  const NOBASE = 'no single study established the row, and every placement was judged';
  const baseHtml = !rowsWithCards.length ? ''
    : !nNoBase ? ` In each third-order row, ${BASED}.`
    : !nBased ? ` In the third-order rows, ${NOBASE}.`
    : ` In ${nBased} of the ${rowsWithCards.length} third-order rows, ${BASED}; in the other ${nNoBase}, ${NOBASE}.`;
  const translationKindHtml = nCl === 0
    ? `${PH('how the extracted constructs were translated into third-order constructs')}`
    : refutCells > 0
      ? `Through reciprocal and refutational translation (refutational readings are marked ⚡ in Table 2b and explained in Table 2), the extracted constructs were synthesized into third-order constructs (Table 2; contribution of each study in Table 2b).${baseHtml}${otherAspectHtml}${unjudgedHtml}`
      : `Through reciprocal translation, the extracted constructs were synthesized into third-order constructs (Table 2; contribution of each study in Table 2b); no placement was judged refutational. ${PH('how refutational relations and disconfirming cases were looked for')}${baseHtml}${otherAspectHtml}${unjudgedHtml}`;
  const nt = getNotTranslatedSpec();
  const ntMissing = nt.rows.filter(r => r[3] === '[Reason not recorded]').length;
  const wl = getWithinStudyLinksSpec();
  const withinHtml = wl.rows.length
    ? ` How the concepts within each account relate to one another was recorded for ${wl.nStudies} stud${wl.nStudies === 1 ? 'y' : 'ies'} (${wl.rows.length} relationship${wl.rows.length === 1 ? '' : 's'}; Appendix C) and kept in view during translation.`
    : ` ${PH('how relationships between concepts within each study were preserved in translation (eMERGe item 13)')}`;
  const notTranslatedHtml = nt.count > 0
    ? ` ${nt.count} second-order construct${nt.count === 1 ? '' : 's'} from ${nt.nStudies} stud${nt.nStudies === 1 ? 'y was' : 'ies were'} not translated into any third-order construct; ${nt.count === 1 ? 'it is' : 'they are'} listed${ntMissing < nt.count ? ' with the reasons' : ''} in Appendix B.${ntMissing ? ' ' + PH(`reasons for the ${ntMissing} construct(s) without one`) : ''}`
    : (nCl > 0 ? ' Every extracted second-order construct was translated into at least one third-order construct.' : '');

  const aimText = state.loa.aim
    ? escapeHtml(state.loa.aim)
    : '<span style="color:#be123c; font-weight:bold;">[MISSING: Set Phase 1 Aim in Project Setup]</span>';

  const relProcHtml = state.loa.relateProcess
    ? escapeHtml(state.loa.relateProcess)
    : PH('aspects of the studies compared and how they were compared (eMERGe Item 11)', 'relateProcess');
  const relOutHtml = state.loa.relateOutcome ? ' ' + escapeHtml(state.loa.relateOutcome) : '';

  const cqHtml = cqAnyAssessed
    ? `Confidence in ${cqAllAssessed ? 'each' : cqCount + ' of the ' + nCl} synthesized third-order finding${cqAllAssessed || cqCount === 1 ? '' : 's'} was assessed using the GRADE-CERQual approach (Lewin et al., 2018) across four components (methodological limitations, coherence, adequacy of data, and relevance); each judgement is reported with its explanation in Table 3.${cqAllAssessed ? '' : ' The remaining findings were not assessed.'} CERQual was applied to the third-order constructs and not to the line of argument: the eMERGe guidance notes that guidance on applying CERQual to the broader concepts or theory of a meta-ethnography is still to be developed (France et al., 2019), and the CERQual developers likewise note that further work is needed for more interpretive outputs (Lewin et al., 2018). ${PH('how GRADE-CERQual was applied to the interpretive findings of this meta-ethnography')}`
    : PH('whether and how GRADE-CERQual was applied; no finding has been assessed yet');

  const linksHtml = getLoaLinks().length
    ? getLoaLinks().map(l => `${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.from)))} ${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym} ${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.to)))}${l.note ? ' (' + escapeHtml(l.note) + ')' : ''}`).join('; ')
    : '';

  const L = state.loa;
  const esc = v => escapeHtml(String(v || '').trim());
  const questionHtml = L.reviewQuestion && L.reviewQuestion.trim()
    ? ` The review question was: <i>${esc(L.reviewQuestion)}</i>${endStop(L.reviewQuestion)}`
    : ` ${PH('the review question(s) or objectives (eMERGe Item 3)', 'reviewQuestion')}`;

  // Phase 3 (Item 9) + Item 10 companion papers
  const scopeText = { full: 'Data were extracted from across the full primary study accounts, not only the findings sections.',
                      findings: 'Data were extracted from the findings sections of the primary study accounts.',
                      mixed: 'Data were extracted mainly from the findings sections, with other sections of each account read for context and concepts.' }[L.extractionScope] || '';
  const companionPairs = state.docs.filter(d => d.companionOf && state.docs.some(x => x.id === d.companionOf))
    .map(d => `${esc(getDisplayName(d))} and ${esc(getDisplayName(state.docs.find(x => x.id === d.companionOf)))}`);
  const companionHtml = companionPairs.length
    ? ` Some accounts derived from the same primary study (${companionPairs.join('; ')}); these are identified in Table 1.`
    : '';
  const readingHtml = `${L.readingApproach ? esc(L.readingApproach) : PH('how studies were read and data extracted, by whom, whether independently, whether extracted data were checked against the accounts and how differences were discussed (eMERGe Item 9)', 'readingApproach')} ${scopeText || PH('whether data were extracted from the full accounts or the findings sections only', 'extractionScope')} First-order constructs (participant quotations) and second-order constructs (the primary authors' interpretations) were extracted and recorded separately${L.unitsTerminology ? '; ' + esc(L.unitsTerminology) : ''}.${L.unitsTerminology ? '' : ' ' + PH('what is meant by the units of synthesis used, e.g., concept, theme, metaphor', 'unitsTerminology')}${companionHtml}`;

  // Phase 5 (Item 13)
  const translationHtml = `Data extraction and cross-study translation were managed using <i>Meta-Ethnography Canvas</i>${appCitationHtml()}. ${orderHtml}${seedHtml} ${L.translationDefinitions ? esc(L.translationDefinitions) : PH('working definitions of reciprocal and refutational translation (eMERGe Item 13)', 'translationDefinitions')} ${L.translationProcess ? esc(L.translationProcess) : PH('who translated, how meaning was translated from one study into another, and how context and relationships between concepts were preserved', 'translationProcess')} ${translationKindHtml}${withinHtml}${notTranslatedHtml} ${L.alternativeInterpretations ? esc(L.alternativeInterpretations) : PH('how alternative interpretations or explanations were considered (Items 13 and 15)', 'alternativeInterpretations')}`;

  // Phase 6 (Items 15-16) incl. independent team models (Atkins et al., 2008)
  const teamModels = Array.isArray(L.teamModels) ? L.teamModels : [];
  const tmReviewers = [...new Set(teamModels.map(m => m.reviewer))];
  const teamHtml = teamModels.length > 1
    ? ` ${tmReviewers.length} reviewer(s) (${tmReviewers.map(r => '@' + esc(r)).join(', ')}) first developed ${teamModels.length} overarching models independently; these were compared and merged into the line of argument${L.teamMergeNote ? ': ' + esc(L.teamMergeNote) : '. ' + PH('how the independent models were compared and merged', 'teamMergeNote')}`
    : '';
  const synthesisHtml = hasLoaModel
    ? `The third-order constructs were then synthesized into a line-of-argument model${L.title ? ', "<b>' + esc(L.title) + '</b>"' : ''} (Table 2).${synthHtml}${teamHtml} ${L.modelContext ? esc(L.modelContext) : PH('the context in which the model applies, or does not, given the characteristics of the included studies (eMERGe Item 16)', 'modelContext')}`
    : `${PH('how the line-of-argument synthesis was conducted, or why it was not (eMERGe Item 15)')}${teamHtml}`;

  const sections = [
    { title: 'Study Design and Reporting Guidelines',
      html: `We conducted a meta-ethnography following the seven-phase methodology originally developed by Noblit and Hare (1988). Its reporting follows the eMERGe meta-ethnography reporting guidance (France et al., 2019). The aim of this review was: <i>${aimText}</i>${state.loa.aim ? endStop(state.loa.aim) : '.'}${questionHtml}` },
    { title: 'Literature Search and Study Selection',
      html: PH('database search strategy, inclusion/exclusion criteria, and screening flow numbers (eMERGe Items 5–8)') },
    { title: 'Quality Appraisal and Conceptual Richness', html: qualityHtml },
    { title: 'Reading and Data Extraction (Phase 3)', html: readingHtml },
    { title: 'Relating the Studies (Phase 4)', html: relProcHtml + relOutHtml },
    { title: 'Translating the Studies (Phase 5)', html: translationHtml },
    { title: 'Synthesizing Translations (Phase 6)', html: synthesisHtml }
  ];
  if (linksHtml) sections.push({ title: 'Relationships between Third-Order Constructs', html: linksHtml });
  sections.push({ title: 'Quality, Reflexivity, and Confidence in Findings',
    html: `${isTeam
        ? `Records in the audit trail are attributed to more than one reviewer ID. ${PH('who read the studies and extracted constructs, whether independently, and how different readings were discussed and worked through (eMERGe items 9, 13)')}`
        : 'Records in the audit trail are attributed to a single reviewer ID.'} ${memoCount > 0 ? 'Reflexive and analytic memos were recorded chronologically in the audit trail (Appendix A).' : PH('how the reviewers reflected on the ways their own positions may have shaped the synthesis; no memos are recorded yet')} ${cqHtml}` });
  return sections;
}

function htmlToPlainText(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

function buildMethodHtml() {
  const body = getMethodSections().map(sec =>
    `<p style="margin-bottom: 12px;"><b>${escapeHtml(sec.title)}</b><br>${sec.html}</p>`).join('');
  return `
    <div class="mb-5">
      <h3 style="font-family: Georgia, serif; font-size: 16px; font-weight: bold; color: #0f172a; margin-bottom: 8px;">Methods Summary (structured around eMERGe)</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic; margin-bottom: 16px;">Compiled from your project data and audit trail. The [Author to insert] gaps are for when you write up: nothing here has to be filled while you are still reading and translating. Expand with your analytical rationale before submission.</p>
      <div style="font-family: Georgia, serif; font-size: 13.5px; color: #1e293b; line-height: 1.6;">${body}</div>
    </div>
    ${buildeMERGeTableHtml()}
  `;
}

function buildeMERGeTableHtml() {
  const rows = getEmergeChecklist().map(r => {
    const status = r.level === 'app' ? `<b>${escapeHtml(r.text)}</b>`
      : r.level === 'partial' ? `<span style="color:#b45309; font-weight:bold;">Partly: ${escapeHtml(r.text)}</span>`
      : `<span class="mec-gap" style="color:#2563eb; font-weight:bold;">[${escapeHtml(r.text)}]</span>`;
    const ph = r.phase ? `<b>${escapeHtml(r.phase).replace('\n', '<br>')}</b>` : '';
    return `<tr><td>${ph}</td><td>${escapeHtml(String(r.no))}. ${escapeHtml(r.title)}</td><td>${escapeHtml(r.desc)}</td><td>${status}</td></tr>`;
  }).join('');
  return `
    <div style="margin-top: 32px; margin-bottom: 12px;">
      <h3 style="font-family: Georgia, serif; font-size: 14px; font-weight: bold; color: #0f172a;">eMERGe Reporting Checklist Mapping (France et al., 2019)</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">Item numbers follow the 19 reporting criteria of France et al. (2019); titles and descriptions are short paraphrases, so see the paper for the full wording. Status is computed from your project data: bold = filled in from your project data; amber = partly supplied; blue = for the author to write.</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead>
        <tr>
          <th style="width:16%;">Phase</th>
          <th style="width:22%;">Item</th>
          <th style="width:32%;">What to report</th>
          <th style="width:30%;">Status in this project</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

(() => {
  const sel = document.getElementById('table3ModeSelect');
  if (!sel) return;
  sel.innerHTML = Object.entries(TABLE3_MODES).map(([k, v]) => `<option value="${k}">Table 3: ${escapeHtml(v)}</option>`).join('');
  sel.value = getTable3Mode();
  sel.addEventListener('change', () => {
    try { lsSet('me_table3_mode', sel.value); } catch (e) {}
    if (state.activePubTable !== 'table3') {
      state.activePubTable = 'table3';
      document.querySelectorAll('.pub-tab-btn').forEach(b => {
        b.className = b.dataset.pub === 'table3'
          ? "pub-tab-btn px-2.5 py-1 text-xs font-bold rounded bg-white text-indigo-700 shadow-sm cursor-pointer"
          : "pub-tab-btn px-2.5 py-1 text-xs font-medium rounded text-slate-600 hover:text-slate-900 cursor-pointer";
      });
    }
    renderPublicationView();
  });
})();

// Gaps for the write-up are shown quietly (grey) while working; exports always keep the full [Author to insert] text
function quietGaps() { try { return lsGet('me_quiet_gaps') !== '0'; } catch (e) { return true; } }
document.getElementById('appendixModeSelect').addEventListener('change', e => {
  lsSet('me_appendix_mode', e.target.value);
  renderPublicationView();
});
// The whole trail, oldest first, for a supplementary file (Appendix A in the paper may show only the key decisions)
document.getElementById('fullTrailCsvBtn').addEventListener('click', async () => {
  await flushAllPendingSaves();
  const logs = [...state.logs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const rows = [['Timestamp (ISO)', 'Timestamp', 'Reviewer', 'Category', 'Action', 'Detail', 'Before', 'After', 'Rationale', 'Key decision (Appendix A)', '3rd Order row ids', 'Entry id']];
  logs.forEach(l => {
    rows.push([l.isoTime || new Date(l.timestamp).toISOString(), new Date(l.timestamp).toLocaleString(), l.reviewer || 'Unknown', getCategoryMeta(l.category).label,
      l.action || '', l.detail || '', l.fromVal || '', l.toVal || '', rationaleExportText(l), isKeyDecisionLog(l) ? 'yes' : 'no', (l.clusterIds || []).join(' '), l.id]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit_trail_full_${state.projectCode ? state.projectCode.replace(/[^\w-]+/g, '_') + '_' : ''}${backupTimestamp()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showSnackbar(`Full audit trail saved (${logs.length} entries).`);
});

// Clicking a gap goes to its field: a write-up field beside the Methods Summary, or an analysis field in the drawer (Tab 2)
function goToProjectField(key) {
  const def = [...WRITEUP_FIELDS, ...LOA_EXTRA_FIELDS].find(f => f[0] === key);
  const el = def && document.getElementById(def[1]);
  if (!el) return;
  if (!document.getElementById('writeupPanel').contains(el)) {
    setActiveTab('matrix');
    if (!state.isLoaOpen) document.getElementById('toggleLoaDrawerBtn').click();
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
  el.classList.add('ring-2', 'ring-amber-400');
  setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 1600);
}
(() => {
  const c = document.getElementById('pubPreviewContainer');
  const go = e => { const gap = e.target.closest && e.target.closest('.mec-gap[data-field]'); if (gap) { e.preventDefault(); goToProjectField(gap.dataset.field); } };
  c.addEventListener('click', go);
  c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(e); });
})();

function renderPublicationView() {
  document.getElementById('writeupPanel').classList.toggle('hidden', state.activePubTable !== 'method');
  const onAppendix = state.activePubTable === 'appendix';
  const apSel = document.getElementById('appendixModeSelect');
  apSel.classList.toggle('hidden', !onAppendix); apSel.value = getAppendixMode();
  const csvBtn = document.getElementById('fullTrailCsvBtn');
  csvBtn.classList.toggle('hidden', !onAppendix); csvBtn.classList.toggle('inline-flex', onAppendix);
  const container = document.getElementById('pubPreviewContainer');
  container.classList.toggle('gaps-quiet', quietGaps());
  const qt = document.getElementById('quietGapsToggle'); if (qt) qt.checked = quietGaps();
  if (state.activePubTable === 'method') container.innerHTML = buildMethodHtml();
  else if (state.activePubTable === 'table1') container.innerHTML = buildTable1Html();
  else if (state.activePubTable === 'table2') container.innerHTML = buildTable2Html();
  else if (state.activePubTable === 'table2_grid') container.innerHTML = buildTable2GridHtml();
  else if (state.activePubTable === 'table3') container.innerHTML = buildTable3SoQFHtml();
  else container.innerHTML = buildAppendixHtml();
}

document.getElementById('copyRichTableBtn').addEventListener('click', async () => {
  await flushAllPendingSaves();
  const container = document.getElementById('pubPreviewContainer');
  // The gaps' links to app fields (data-field, role, tabindex, title) belong to the preview, not to the manuscript
  const copyEl = container.cloneNode(true);
  copyEl.querySelectorAll('.mec-gap[data-field]').forEach(g => ['data-field', 'role', 'tabindex', 'title'].forEach(at => g.removeAttribute(at)));
  const html = copyEl.innerHTML;
  const text = container.innerText;
  try {
    const blobHtml = new Blob([html], { type: 'text/html' });
    const blobText = new Blob([text], { type: 'text/plain' });
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })]);
    showSnackbar('Rich Table copied. Paste directly (Ctrl+V / Cmd+V) into Microsoft Word or Google Docs.');
  } catch (e) {
    const range = document.createRange();
    range.selectNodeContents(container);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    showSnackbar('Table copied to the clipboard.');
  }
});

document.getElementById('copyMarkdownBtn').addEventListener('click', async () => {
  await flushAllPendingSaves();
  let md = '';
  const cleanMd = s => String(s || '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

  if (state.activePubTable === 'method') {
    md += `### Methods Summary (structured around eMERGe)\n\n`;
    getMethodSections().forEach(sec => { md += `**${sec.title}**\n${htmlToPlainText(sec.html)}\n\n`; });

    md += `### eMERGe Reporting Checklist Mapping (France et al., 2019)\n\n`;
    md += `| Phase | Item | What to report | Status in this project |\n`;
    md += `|---|---|---|---|\n`;
    getEmergeChecklist().forEach(r => {
      const st = r.level === 'app' ? `**${r.text}**` : r.level === 'partial' ? `Partly: ${r.text}` : `[${r.text}]`;
      md += `| ${cleanMd(r.phase.replace('\n', ' — '))} | ${cleanMd(r.no + '. ' + r.title)} | ${cleanMd(r.desc)} | ${cleanMd(st)} |\n`;
    });
  } else if (state.activePubTable === 'table1') {
    md += `### Table 1. Characteristics and Critical Appraisal of Included Studies\n\n`;
    md += `| Study | Title | Setting | Participants | Methodology | Critical Appraisal (Tool / Rating) | Richness | Notes | Funder / Linked Accounts |\n`;
    md += `|---|---|---|---|---|---|---|---|---|\n`;
    state.docs.forEach((d, idx) => {
      const name = getDisplayName(d) + (idx === 0 ? ` *${firstStudyMeta().short}*` : '');
      md += `| **${cleanMd(name)}** | ${cleanMd(d.title || d.name)} | ${cleanMd(d.setting)} | ${cleanMd(d.participants)} | ${cleanMd(d.methodology)} | ${cleanMd(getAppraisalDisplayString(d))} | ${cleanMd(d.richness)} | ${cleanMd(d.contextNote)} | ${cleanMd(funderLinkedText(d))} |\n`;
    });
    getAppraisalDomainSpecs().forEach(spec => {
      md += `\n### ${spec.title}\n\n*${spec.caption}*\n\n`;
      md += `| ${spec.headers.map(cleanMd).join(' | ')} |\n|${spec.headers.map(() => '---').join('|')}|\n`;
      spec.rows.forEach(r => { md += `| **${cleanMd(r[0])}** | ${r.slice(1).map(cleanMd).join(' | ')} |\n`; });
      md += `\n${spec.key.join('  \n')}\n`;
      if (spec.summaries.length) md += `\n**Appraisal summary**  \n${spec.summaries.join('  \n')}\n`;
    });
  } else if (state.activePubTable === 'table2') {
    md += `### Table 2. Meta-Ethnographic Translation and Synthesis Table\n\n`;
    md += `| 3rd Order Construct | Translation Type | Team Status | Translation Summary (A) | 3rd Order Interpretation (B) | 2nd Order Constructs | 1st Order Quotes | Studies | CERQual Confidence |\n`;
    md += `|---|---|---|---|---|---|---|---|---|\n`;
    const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);
    state.clusters.forEach(c => {
      normalizeCluster(c);
      const mappedSecs = allSeconds.filter(s => s.clusterIds.includes(c.id));
      const docs = [...new Set(mappedSecs.map(s => getDisplayName(state.docs.find(d => d.id === s.docId))))];
      const secStr = mappedSecs.map(s => {
        const dName = getDisplayName(state.docs.find(d => d.id === s.docId));
        return `${relTag(s, c.id)}${s.origin === 'wrapped_first_order' ? '[reviewer-wrapped 1st-order quote] ' : ''}${dName} (p.${secPagesLabel(s)}): ${s.note ? `**${s.note}**${secLabelTag(s)} - ` : ''}"${secEvidenceText(s)}"`;
      }).concat(cellStatusLines(c)).join('; ');
      const quotes = [];
      const seenQ = new Set();
      mappedSecs.forEach(s => {
        const firsts = quotesOf(s.id).filter(f => !seenQ.has(f.id) && seenQ.add(f.id));
        firsts.forEach(f => quotes.push(`"${f.text}"${f.note ? ' [' + f.note + ']' : ''} (p.${f.page})`));
      });
      md += `| **${cleanMd(c.thirdOrderTitle || 'Untitled')}** | ${cleanMd(clusterTranslationLabel(c))} | ${cleanMd(concordanceLabel(c.concordanceStatus))} | ${cleanMd(c.translationSummary)} | ${cleanMd(c.synthesisNote)} | ${cleanMd(secStr)} | ${cleanMd(quotes.join('; '))} | ${cleanMd(docs.join(', '))} | **${cleanMd(c.cerqualConfidence)}** ${cleanMd(c.cerqualExplanation)} |\n`;
    });
    // Line of Argument block (same content as the HTML preview and the Word export)
    const L = state.loa || {};
    const line = (label, v) => v && String(v).trim() ? `**${label}** ${String(v).trim().replace(/\r?\n/g, ' ')}\n\n` : '';
    const linksTxt = getLoaLinks().map(l => `${clusterLabel(state.clusters.find(c => c.id === l.from))} ${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym} ${clusterLabel(state.clusters.find(c => c.id === l.to))}${l.note ? ' (' + l.note + ')' : ''}`).join('; ');
    const models = Array.isArray(L.teamModels) ? L.teamModels : [];
    if (L.aim || L.title || L.flow || L.narrative || L.relateProcess || L.relateOutcome || L.synthStudies || L.modelContext || linksTxt || models.length) {
      md += `\n#### Line of Argument / Overarching Model\n\n`;
      md += line('Synthesis aim / review question:', L.aim);
      md += line('Phase 4 — Process of relating studies:', L.relateProcess);
      md += line('Studies synthesized (Item 15):', L.synthStudies);
      md += line('Phase 4 — Outcome of relating studies:', L.relateOutcome);
      md += line('Concept relationships:', linksTxt);
      md += line(`Overarching Line of Argument${L.title ? ' (' + L.title + ')' : ''}${L.flow ? ' — relational flow: ' + L.flow : ''}:`, L.narrative || (L.title || L.flow ? '(narrative not entered)' : ''));
      md += line('Where the model applies (Item 16):', L.modelContext);
      if (models.length) {
        md += `**Independent models developed before merging (${models.length}):**\n\n`;
        models.forEach(m => {
          const links = (m.links || []).map(l => `${l.from} ${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym} ${l.to}`).join('; ');
          md += `- @${m.reviewer}${m.title ? ' — ' + m.title : ''}: ${[m.flow, links, m.narrative].filter(Boolean).join(' | ').replace(/\r?\n/g, ' ')}\n`;
        });
        md += `\n`;
        md += line('How the models were merged:', L.teamMergeNote);
      }
    }
  } else if (state.activePubTable === 'table2_grid') {
    md += `### Table 2b. Concept-by-Study Contribution Matrix\n\n*${TABLE2B_LEGEND}. ${TABLE2B_NOTE}*\n\n`;
    const studyCols = state.docs.map((d, idx) => cleanMd(getDisplayName(d) + (idx === 0 ? ' ' + firstStudyMeta().short : '')));
    md += `| 3rd Order Construct | ${studyCols.join(' | ')} | CERQual |\n`;
    md += `|---|${state.docs.map(() => ':---:').join('|')}|:---:|\n`;
    const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);
    state.clusters.forEach(c => {
      normalizeCluster(c);
      const mappedSecs = allSeconds.filter(s => s.clusterIds.includes(c.id));
      const cells = state.docs.map(d => {
        const docSecs = mappedSecs.filter(s => s.docId === d.id);
        if (!docSecs.length) { const info = emptyCellInfo(c, d.id); return info ? info.symbol : ' '; }
        return contribSymbol(docSecs, c.id).replace(/ \/ /g, '/');
      });
      md += `| **${cleanMd(c.thirdOrderTitle || 'Untitled')}** | ${cells.join(' | ')} | **${cleanMd(c.cerqualConfidence)}** |\n`;
    });
  } else if (state.activePubTable === 'table3') {
    getTable3Specs().forEach(spec => {
      md += `### ${spec.title}\n\n*${spec.caption}*\n\n`;
      md += `| ${spec.headers.map(cleanMd).join(' | ')} |\n|${spec.headers.map(() => '---').join('|')}|\n`;
      spec.rows.forEach(r => {
        md += `| ${r.map((cell, i) => (i === 0 || (cell && typeof cell === 'object' && 'strong' in cell)) ? `**${cleanMd(t3CellText(cell))}**` : cleanMd(t3CellText(cell))).join(' | ')} |\n`;
      });
      md += '\n';
    });
  } else {
    const ap = getAppendixASpec();
    md += `### ${ap.title}\n\n*${cleanMd(ap.caption)}*\n\n`;
    md += `| Timestamp | Reviewer | Category | Action / Memo | Before ➔ After | Rationale |\n`;
    md += `|---|---|---|---|---|---|\n`;
    ap.rows.forEach(r => {
      const diff = (r.fromVal || r.toVal) ? `${r.fromVal || ''} ➔ ${r.toVal || ''}` : '-';
      md += `| ${cleanMd(r.when)} | @${cleanMd(r.reviewer)} | ${cleanMd(r.category)} | **${cleanMd(r.action)}** ${cleanMd(r.detail)} | ${cleanMd(diff)} | ${cleanMd(r.rationale)} |\n`;
    });
    const nt = getNotTranslatedSpec();
    md += `\n### ${nt.title}\n\n*${nt.caption}*\n\n`;
    if (nt.rows.length) {
      md += `| ${nt.headers.map(cleanMd).join(' | ')} |\n|${nt.headers.map(() => '---').join('|')}|\n`;
      nt.rows.forEach(r => { md += `| ${r.map(cleanMd).join(' | ')} |\n`; });
    } else md += 'Every extracted second-order construct was translated into at least one third-order construct.\n';
    const wl = getWithinStudyLinksSpec();
    if (wl.rows.length) {
      md += `\n### ${wl.title}\n\n*${wl.caption}*\n\n| ${wl.headers.join(' | ')} |\n|${wl.headers.map(() => '---').join('|')}|\n`;
      wl.rows.forEach(r => { md += `| ${r.map(cleanMd).join(' | ')} |\n`; });
    }
  }

  await navigator.clipboard.writeText(md);
  showSnackbar('Markdown copied to the clipboard.');
});

document.getElementById('downloadWordDocBtn').addEventListener('click', async () => {
  await flushAllPendingSaves();
  if (typeof docx === 'undefined') {
    alert('The bundled Word library (app/vendor/docx/index.umd.js) failed to load. Check that the app/vendor folder is next to me_canvas.html (offline edition: extract the whole ZIP), then reload the page.');
    return;
  }

  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, BorderStyle, PageOrientation, PageBreak, TableLayoutType
  } = docx;

  const borderTopBottomThick = { style: BorderStyle.SINGLE, size: 12, color: "0F172A" };
  const borderHeaderBottom = { style: BorderStyle.SINGLE, size: 8, color: "0F172A" };
  const borderRowLight = { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" };
  const borderNone = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

  // Column widths: without them docx.js writes a 100-twip grid, which LibreOffice / Google Docs (and Word with
  // autofit off) show as hair-thin columns. Widths are percentages of the landscape A4 text width.
  const TEXT_WIDTH_TWIPS = 16838 - 2 * 1440;
  function widthTable(rows, pcts) {
    const total = pcts.reduce((a, b) => a + b, 0) || 1;
    const twips = pcts.map(p => Math.round(TEXT_WIDTH_TWIPS * p / total));
    return new Table({ width: { size: TEXT_WIDTH_TWIPS, type: WidthType.DXA }, columnWidths: twips, layout: TableLayoutType.FIXED, rows });
  }
  // Even widths for the study columns of Table 2b; the first and last columns keep a fixed share
  function gridPcts(nStudies) {
    const first = nStudies > 8 ? 18 : 24, last = 10;
    return [first, ...Array(nStudies).fill((100 - first - last) / Math.max(1, nStudies)), last];
  }

  function makeCell(childrenOrText, { isHeader = false, isLastRow = false, bold = false } = {}) {
    const paragraphs = Array.isArray(childrenOrText)
      ? childrenOrText
      : String(childrenOrText ?? '-').split('\n').map(line => new Paragraph({
          children: [new TextRun({ text: line, bold: isHeader || bold, font: "Times New Roman", size: 20 })],
          spacing: { after: 60 }
        }));

    return new TableCell({
      children: paragraphs,
      shading: isHeader ? { fill: "F8FAFC" } : undefined,
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      borders: {
        top: isHeader ? borderTopBottomThick : borderNone,
        bottom: isHeader ? borderHeaderBottom : (isLastRow ? borderTopBottomThick : borderRowLight),
        left: borderNone,
        right: borderNone
      }
    });
  }

  const t1Headers = [
    'Study (Author, Year)', 'Full Title', 'Country / Setting',
    'Participants / Sample', 'Methodology & Analysis',
    'Methodological Quality', 'Conceptual Depth', 'Limitations / Notes', 'Funder / Linked Accounts'
  ];
  const t1Rows = [
    new TableRow({ tableHeader: true, children: t1Headers.map(h => makeCell(h, { isHeader: true })) })
  ];

  if (state.docs.length === 0) {
    t1Rows.push(new TableRow({ children: [makeCell('No studies added yet.', { isLastRow: true }), ...Array(8).fill(0).map(() => makeCell('-', { isLastRow: true }))] }));
  } else {
    state.docs.forEach((d, idx) => {
      normalizeDoc(d);
      const isLast = idx === state.docs.length - 1;
      const studyLabel = getDisplayName(d) + (idx === 0 ? ' ' + firstStudyMeta().short : '');
      t1Rows.push(new TableRow({
        children: [
          makeCell(studyLabel, { isLastRow: isLast, bold: true }),
          makeCell(d.title || d.name, { isLastRow: isLast }),
          makeCell(d.setting || '-', { isLastRow: isLast }),
          makeCell(d.participants || '-', { isLastRow: isLast }),
          makeCell(d.methodology || '-', { isLastRow: isLast }),
          makeCell(getAppraisalDisplayString(d), { isLastRow: isLast }),
          makeCell(d.richness || '-', { isLastRow: isLast }),
          makeCell(d.contextNote || '-', { isLastRow: isLast }),
          makeCell(funderLinkedText(d), { isLastRow: isLast })
        ]
      }));
    });
  }

  const t2Headers = [
    '3rd Order Construct & Type', 'Translation (A) & 3rd Order Interpretation (B)',
    '2nd Order Constructs (Author Interpretations)', 'Illustrating 1st Order Quotes',
    'Contributing Studies', 'GRADE-CERQual Confidence'
  ];
  const t2Rows = [
    new TableRow({ tableHeader: true, children: t2Headers.map(h => makeCell(h, { isHeader: true })) })
  ];
  const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);

  if (state.clusters.length === 0) {
    t2Rows.push(new TableRow({ children: [makeCell('No 3rd Order rows created yet.', { isLastRow: true }), ...Array(5).fill(0).map(() => makeCell('-', { isLastRow: true }))] }));
  } else {
    state.clusters.forEach((c, idx) => {
      normalizeCluster(c);
      const isLast = idx === state.clusters.length - 1;
      const mappedSecs = allSeconds.filter(s => s.clusterIds.includes(c.id));
      const contributingDocs = [...new Set(mappedSecs.map(s => {
        const doc = state.docs.find(d => d.id === s.docId);
        return doc ? getDisplayName(doc) : null;
      }).filter(Boolean))];

      const secParagraphs = mappedSecs.length > 0 ? mappedSecs.map(s => {
        const doc = state.docs.find(d => d.id === s.docId);
        const dName = doc ? getDisplayName(doc) : 'Study';
        const cellNuance = (s.clusterComments && s.clusterComments[c.id]) ? ` [${s.clusterComments[c.id]}]` : '';
        return new Paragraph({
          children: [
            new TextRun({ text: `• ${relTag(s, c.id)}${s.origin === 'wrapped_first_order' ? '[reviewer-wrapped 1st-order quote] ' : ''}${dName} (p.${secPagesLabel(s)}): `, bold: true, font: "Times New Roman", size: 20 }),
            ...(s.note ? [new TextRun({ text: `${s.note}${secLabelTag(s)} — `, bold: true, font: "Times New Roman", size: 20 })] : []),
            new TextRun({ text: `"${secEvidenceText(s)}"${cellNuance}`, font: "Times New Roman", size: 20 })
          ],
          spacing: { after: 80 }
        });
      }) : [new Paragraph({ children: [new TextRun({ text: '-', font: "Times New Roman", size: 20 })] })];

      const quoteParagraphs = [];
      const seenQ = new Set();
      mappedSecs.forEach(s => {
        const doc = state.docs.find(d => d.id === s.docId);
        const dName = doc ? getDisplayName(doc) : 'Study';
        const firsts = quotesOf(s.id).filter(f => !seenQ.has(f.id) && seenQ.add(f.id));
        firsts.forEach(f => {
          quoteParagraphs.push(new Paragraph({
            children: [
              new TextRun({ text: `• "${f.text}" `, italics: true, font: "Times New Roman", size: 20 }),
              ...(f.note ? [new TextRun({ text: `[${f.note}] `, bold: true, font: "Times New Roman", size: 20 })] : []),
              new TextRun({ text: `(${dName}, p.${f.page})`, font: "Times New Roman", size: 20 })
            ],
            spacing: { after: 80 }
          }));
        });
      });
      if (quoteParagraphs.length === 0) {
        quoteParagraphs.push(new Paragraph({ children: [new TextRun({ text: '-', font: "Times New Roman", size: 20 })] }));
      }

      const transLabel = clusterTranslationLabel(c);

      t2Rows.push(new TableRow({
        children: [
          makeCell(`${c.thirdOrderTitle || '(Untitled)'}\n[Type: ${transLabel} | Team status: ${concordanceLabel(c.concordanceStatus)}]`, { isLastRow: isLast, bold: true }),
          makeCell([c.translationSummary ? 'Translation: ' + c.translationSummary : '', c.synthesisNote ? '3rd order interpretation: ' + c.synthesisNote : ''].filter(Boolean).join('\n\n') || '-', { isLastRow: isLast }),
          makeCell([...secParagraphs, ...cellStatusLines(c).map(l => new Paragraph({ children: [new TextRun({ text: l, italics: true, font: "Times New Roman", size: 18 })], spacing: { after: 60 } }))], { isLastRow: isLast }),
          makeCell(quoteParagraphs, { isLastRow: isLast }),
          makeCell(contributingDocs.join('; ') || '-', { isLastRow: isLast }),
          makeCell(`${c.cerqualConfidence || 'Not assessed'}${c.cerqualExplanation ? '\n' + c.cerqualExplanation : ''}`, { isLastRow: isLast })
        ]
      }));
    });
  }

  // Build Table 2b: Concept-by-Study Contribution Grid for Word (.docx)
  const t2bHeaders = [
    '3rd Order Construct (Theme)',
    ...state.docs.map((d, idx) => getDisplayName(d) + (idx === 0 ? ' ' + firstStudyMeta().short : '')),
    'CERQual'
  ];
  const t2bRows = [
    new TableRow({ tableHeader: true, children: t2bHeaders.map(h => makeCell(h, { isHeader: true })) })
  ];
  if (state.clusters.length === 0) {
    t2bRows.push(new TableRow({ children: [makeCell('No themes yet.', { isLastRow: true }), ...Array(state.docs.length + 1).fill(0).map(() => makeCell('-', { isLastRow: true }))] }));
  } else {
    state.clusters.forEach((c, idx) => {
      normalizeCluster(c);
      const isLast = idx === state.clusters.length - 1;
      const mappedSecs = allSeconds.filter(s => s.clusterIds.includes(c.id));
      const studyCells = state.docs.map(d => {
        const docSecs = mappedSecs.filter(s => s.docId === d.id);
        if (docSecs.length === 0) { const info = emptyCellInfo(c, d.id); return makeCell(info ? info.symbol : '', { isLastRow: isLast }); }
        const sym = contribSymbol(docSecs, c.id);
        return makeCell(sym, { isLastRow: isLast, bold: true });
      });
      t2bRows.push(new TableRow({
        children: [
          makeCell(c.thirdOrderTitle || '(Untitled)', { isLastRow: isLast, bold: true }),
          ...studyCells,
          makeCell(c.cerqualConfidence || 'Not assessed', { isLastRow: isLast, bold: true })
        ]
      }));
    });
  }

  // Table 3 blocks (one or two tables depending on the Table 3 layout option)
  const t3Blocks = getTable3Specs().flatMap((spec, si) => {
    const trs = [new TableRow({ tableHeader: true, children: spec.headers.map(h => makeCell(h, { isHeader: true })) })];
    if (spec.rows.length === 0) {
      trs.push(new TableRow({ children: [makeCell('No findings yet.', { isLastRow: true }), ...Array(spec.headers.length - 1).fill(0).map(() => makeCell('-', { isLastRow: true }))] }));
    } else {
      spec.rows.forEach((r, ri) => {
        const isLast = ri === spec.rows.length - 1;
        trs.push(new TableRow({ children: r.map((cell, ci) => makeCell(t3CellText(cell), { isLastRow: isLast, bold: ci === 0 || (cell && typeof cell === 'object' && 'strong' in cell) })) }));
      });
    }
    return [
      ...(si > 0 ? [new Paragraph({ children: [new PageBreak()] })] : []),
      new Paragraph({ children: [new TextRun({ text: spec.title, bold: true, font: "Times New Roman", size: 24 })], spacing: { after: 80 } }),
      new Paragraph({ children: [new TextRun({ text: spec.caption, italics: true, font: "Times New Roman", size: 18 })], spacing: { after: 140 } }),
      widthTable(trs, spec.widths)
    ];
  });

  const appHeaders = ['Timestamp', 'Reviewer', 'Phase / Category', 'Action / Analytic Memo', 'Conceptual Evolution', 'Methodological Rationale'];
  const appRows = [
    new TableRow({ tableHeader: true, children: appHeaders.map(h => makeCell(h, { isHeader: true })) })
  ];
  const appSpec = getAppendixASpec();
  if (appSpec.rows.length === 0) {
    appRows.push(new TableRow({ children: [makeCell('No audit trail entries recorded yet.', { isLastRow: true }), ...Array(5).fill(0).map(() => makeCell('-', { isLastRow: true }))] }));
  } else {
    appSpec.rows.forEach((r, idx) => {
      const isLast = idx === appSpec.rows.length - 1;
      appRows.push(new TableRow({
        children: [
          makeCell(r.when, { isLastRow: isLast }),
          makeCell(`@${r.reviewer}`, { isLastRow: isLast, bold: true }),
          makeCell(r.category, { isLastRow: isLast }),
          makeCell(`${r.action}${r.detail ? '\n' + r.detail : ''}`, { isLastRow: isLast }),
          makeCell(appendixChangeText(r, '->'), { isLastRow: isLast }),
          makeCell(r.rationale, { isLastRow: isLast })
        ]
      }));
    });
  }

  const ntSpec = getNotTranslatedSpec();
  const wlSpec = getWithinStudyLinksSpec();

  const projBannerParagraphs = [
    new Paragraph({
      children: [
        new TextRun({ text: `Meta-Ethnography Synthesis Manuscript Tables`, bold: true, font: "Times New Roman", size: 28 }),
        ...(state.projectCode ? [new TextRun({ text: `  [${state.projectCode}]`, bold: true, font: "Times New Roman", size: 24 })] : [])
      ],
      spacing: { after: 100 }
    }),
    ...(state.loa.aim ? [
      new Paragraph({
        children: [
          new TextRun({ text: "Phase 1 Research Aim / Review Question: ", bold: true, font: "Times New Roman", size: 22 }),
          new TextRun({ text: state.loa.aim, italics: true, font: "Times New Roman", size: 22 })
        ],
        spacing: { after: 200 }
      })
    ] : [])
  ];

  const docObj = new Document({
    sections: [{
      properties: {
        page: { size: { orientation: PageOrientation.LANDSCAPE } }
      },
      children: [
        ...projBannerParagraphs,

        new Paragraph({
          children: [new TextRun({ text: "Methods Summary (Auto-Generated from App Data)", bold: true, font: "Times New Roman", size: 28 })],
          spacing: { before: 200, after: 140 }
        }),
        ...getMethodSections().flatMap(sec => {
          // Placeholders ([Author to insert: ...] / [MISSING: ...]) are coloured so they are easy to find in Word
          const txt = htmlToPlainText(sec.html);
          const parts = txt.split(/(\[(?:Author to insert|MISSING)[^\]]*\])/);
          return [
            new Paragraph({ children: [new TextRun({ text: sec.title, bold: true, font: "Times New Roman", size: 22 })], spacing: { after: 40 } }),
            new Paragraph({
              children: parts.filter(Boolean).map(part => {
                const isPh = /^\[(?:Author to insert|MISSING)/.test(part);
                return new TextRun({ text: part, font: "Times New Roman", size: 22, bold: isPh, color: isPh ? (part.startsWith('[MISSING') ? "BE123C" : "2563EB") : "000000" });
              }),
              spacing: { after: 140 }
            })
          ];
        }),

        new Paragraph({
          children: [new TextRun({ text: "eMERGe Reporting Checklist Mapping", bold: true, font: "Times New Roman", size: 24 })],
          spacing: { before: 240, after: 140 }
        }),
        widthTable([
            new TableRow({ tableHeader: true, children: ['Phase', 'Item', 'What to report', 'Status in this project'].map(h => makeCell(h, { isHeader: true })) }),
            ...getEmergeChecklist().map((r, i, arr) => {
              const last = i === arr.length - 1;
              const st = r.level === 'app' ? r.text : r.level === 'partial' ? 'Partly: ' + r.text : '[' + r.text + ']';
              return new TableRow({ children: [
                makeCell(r.phase || '', { bold: true, isLastRow: last }),
                makeCell(r.no + '. ' + r.title, { isLastRow: last }),
                makeCell(r.desc, { isLastRow: last }),
                makeCell(st, { bold: r.level !== 'partial', isLastRow: last })
              ] });
            })
          ], [18, 22, 30, 30]),
        new Paragraph({ children: [new PageBreak()] }),

        new Paragraph({
          children: [new TextRun({ text: `Table 1. Characteristics and Critical Appraisal of Included Studies (${state.docs.length} studies)`, bold: true, font: "Times New Roman", size: 24 })],
          spacing: { after: 140 }
        }),
        widthTable(t1Rows, [11, 15, 10, 10, 13, 10, 9, 12, 10]),
        ...getAppraisalDomainSpecs().flatMap(spec => [
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ children: [new TextRun({ text: spec.title, bold: true, font: "Times New Roman", size: 24 })], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: spec.caption, italics: true, font: "Times New Roman", size: 18 })], spacing: { after: 140 } }),
          widthTable([
            new TableRow({ tableHeader: true, children: spec.headers.map(h => makeCell(h, { isHeader: true })) }),
            ...spec.rows.map((r, i) => new TableRow({ children: r.map((c, ci) => makeCell(c, { isLastRow: i === spec.rows.length - 1, bold: ci === 0 })) }))
          ], spec.widths),
          ...spec.key.map(k => new Paragraph({ children: [new TextRun({ text: k, font: "Times New Roman", size: 18 })], spacing: { before: 40 } })),
          ...(spec.summaries.length ? [new Paragraph({ children: [new TextRun({ text: 'Appraisal summary', bold: true, font: "Times New Roman", size: 20 })], spacing: { before: 160 } }),
            ...spec.summaries.map(t => new Paragraph({ children: [new TextRun({ text: t, font: "Times New Roman", size: 18 })], spacing: { before: 40 } }))] : [])
        ]),

        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          children: [new TextRun({ text: "Table 2. Meta-Ethnographic Translation and Synthesis of 1st, 2nd, and 3rd Order Constructs", bold: true, font: "Times New Roman", size: 24 })],
          spacing: { after: 140 }
        }),
        widthTable(t2Rows, [16, 20, 24, 20, 10, 10]),
        ...(state.loa.relateProcess || state.loa.relateOutcome ? [
          new Paragraph({
            children: [
              new TextRun({ text: "Phase 4 \u2014 Relating the studies: ", bold: true, font: "Times New Roman", size: 22 }),
              new TextRun({ text: `${state.loa.relateProcess ? 'Process: ' + state.loa.relateProcess + ' ' : ''}${state.loa.relateOutcome ? 'Outcome: ' + state.loa.relateOutcome : ''}`, font: "Times New Roman", size: 22 })
            ],
            spacing: { before: 220, after: 140 }
          })
        ] : []),
        ...(getLoaLinks().length ? [
          new Paragraph({
            children: [
              new TextRun({ text: "Concept relationships: ", bold: true, font: "Times New Roman", size: 22 }),
              new TextRun({ text: getLoaLinks().map(l => `${clusterLabel(state.clusters.find(c => c.id === l.from))} ${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym} ${clusterLabel(state.clusters.find(c => c.id === l.to))}${l.note ? ' (' + l.note + ')' : ''}`).join('; '), font: "Times New Roman", size: 22 })
            ],
            spacing: { before: 220, after: 140 }
          }),
          new Paragraph({
            children: [new TextRun({ text: "[Note: Export the visual Concept Relationship Map (.svg) from the Line of Argument drawer to insert as Figure 1 here]", italics: true, color: "2563EB", font: "Times New Roman", size: 20 })],
            spacing: { after: 140 }
          })
        ] : []),
        ...(state.loa.title || state.loa.flow || state.loa.narrative ? [
          new Paragraph({
            children: [
              new TextRun({ text: `Overarching Line of Argument Synthesis (${state.loa.title || 'Conceptual Model'}): `, bold: true, font: "Times New Roman", size: 22 }),
              new TextRun({ text: `${state.loa.flow ? '[' + state.loa.flow + '] ' : ''}${state.loa.narrative || ''}`, font: "Times New Roman", size: 22 })
            ],
            spacing: { before: 220, after: 140 }
          })
        ] : []),
        ...(state.loa.modelContext ? [new Paragraph({ children: [
            new TextRun({ text: "Where the model applies (eMERGe item 16): ", bold: true, font: "Times New Roman", size: 22 }),
            new TextRun({ text: state.loa.modelContext, font: "Times New Roman", size: 22 })
          ], spacing: { after: 140 } })] : []),
        ...((state.loa.teamModels || []).length ? [
          new Paragraph({ children: [new TextRun({ text: `Independent models developed before merging (${state.loa.teamModels.length})`, bold: true, font: "Times New Roman", size: 22 })], spacing: { before: 200, after: 80 } }),
          ...state.loa.teamModels.map(m => new Paragraph({ children: [
            new TextRun({ text: `@${m.reviewer}${m.title ? ' — ' + m.title : ''}: `, bold: true, font: "Times New Roman", size: 20 }),
            new TextRun({ text: [m.flow, (m.links || []).map(l => `${l.from} ${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym} ${l.to}`).join('; '), m.narrative].filter(Boolean).join(' | '), font: "Times New Roman", size: 20 })
          ], spacing: { after: 80 } })),
          ...(state.loa.teamMergeNote ? [new Paragraph({ children: [
            new TextRun({ text: 'How the models were merged: ', bold: true, font: "Times New Roman", size: 20 }),
            new TextRun({ text: state.loa.teamMergeNote, font: "Times New Roman", size: 20 })
          ], spacing: { after: 140 } })] : [])
        ] : []),

        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          children: [new TextRun({ text: "Table 2b. Concept-by-Study Contribution Matrix", bold: true, font: "Times New Roman", size: 24 })],
          spacing: { after: 60 }
        }),
        new Paragraph({
          children: [new TextRun({ text: TABLE2B_LEGEND + '. ' + TABLE2B_NOTE, italics: true, font: "Times New Roman", size: 18 })],
          spacing: { after: 140 }
        }),
        widthTable(t2bRows, gridPcts(state.docs.length)),

        new Paragraph({ children: [new PageBreak()] }),
        ...t3Blocks,

        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          children: [new TextRun({ text: appSpec.title, bold: true, font: "Times New Roman", size: 24 })],
          spacing: { after: 80 }
        }),
        new Paragraph({ children: [new TextRun({ text: appSpec.caption, italics: true, font: "Times New Roman", size: 20 })], spacing: { after: 140 } }),
        widthTable(appRows, [11, 8, 11, 32, 18, 20]),

        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          children: [new TextRun({ text: ntSpec.title, bold: true, font: "Times New Roman", size: 24 })],
          spacing: { after: 80 }
        }),
        new Paragraph({ children: [new TextRun({ text: ntSpec.caption, italics: true, font: "Times New Roman", size: 20 })], spacing: { after: 140 } }),
        ...(ntSpec.rows.length
          ? [widthTable([
              new TableRow({ tableHeader: true, children: ntSpec.headers.map(h => makeCell(h, { isHeader: true })) }),
              ...ntSpec.rows.map((r, i) => new TableRow({ children: r.map(c => makeCell(c, { isLastRow: i === ntSpec.rows.length - 1 })) }))
            ], ntSpec.widths)]
          : [new Paragraph({ children: [new TextRun({ text: 'Every extracted second-order construct was translated into at least one third-order construct.', font: "Times New Roman", size: 20 })] })]),
        ...(wlSpec.rows.length ? [
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ children: [new TextRun({ text: wlSpec.title, bold: true, font: "Times New Roman", size: 24 })], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: wlSpec.caption, italics: true, font: "Times New Roman", size: 20 })], spacing: { after: 140 } }),
          widthTable([
            new TableRow({ tableHeader: true, children: wlSpec.headers.map(h => makeCell(h, { isHeader: true })) }),
            ...wlSpec.rows.map((r, i) => new TableRow({ children: r.map((c, ci) => makeCell(c, { isLastRow: i === wlSpec.rows.length - 1, bold: ci === 0 })) }))
          ], wlSpec.widths)
        ] : [])
      ]
    }]
  });

  const blob = await Packer.toBlob(docObj);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const projTag = state.projectCode ? `${state.projectCode}_` : '';
  a.download = `meta_ethnography_tables_${projTag}${new Date().toISOString().slice(0, 10)}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById('exportCsvBtn').addEventListener('click', async () => {
  await flushAllPendingSaves();
  const rows = [
    ['3rd Order Construct', 'Translation Type', '3rd Order Team Status', 'CERQual Confidence', 'CERQual Explanation', 'Step A: Translation Summary', 'Step B: 3rd Order Interpretation', 'StudyOrder', 'Study', 'Title', 'Setting', 'Participants', 'Methodology', 'Appraisal Tool', 'Quality Rating', 'Conceptual Depth (Richness)', 'Study Context Note', 'Study Overview / Key Metaphors', 'Funder', 'Same Primary Study As', '2nd Order Reviewer', '2nd Order Summary', '2nd Order Raw Text', '2nd Order Nuance Memo (Private)', '2nd Order Team Status', 'Row-Specific Comment', 'Linked 1st Order Quotes', 'Page']
  ];

  const seconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);
  seconds.forEach(sec => {
    const docIdx = state.docs.findIndex(d => d.id === sec.docId);
    const doc = state.docs[docIdx] ? normalizeDoc(state.docs[docIdx]) : null;
    const firsts = quotesOf(sec.id);
    const targetClusterIds = sec.clusterIds.length > 0 ? sec.clusterIds : [null];

    targetClusterIds.forEach(cid => {
      const cluster = state.clusters.find(c => c.id === cid);
      if (cluster) normalizeCluster(cluster);
      const cellRelation = cid ? secRelation(sec, cid) : '';
      const cellComment = cid && sec.clusterComments ? `[${cellRelation}] ` + (sec.clusterComments[cid] || '') : (cellRelation ? `[${cellRelation}]` : (sec.notTranslatedNote ? `[not translated] ${sec.notTranslatedNote}` : ''));
      rows.push([
        cluster ? cluster.thirdOrderTitle : '(Unassigned)',
        cluster ? clusterTranslationLabel(cluster) : '',
        cluster ? `${concordanceLabel(cluster.concordanceStatus)}${cluster.concordanceNote ? ': ' + cluster.concordanceNote : ''}` : '',
        cluster ? cluster.cerqualConfidence : '',
        cluster ? cluster.cerqualExplanation : '',
        cluster ? (cluster.translationSummary || '') : '',
        cluster ? cluster.synthesisNote : '',
        docIdx === 0 ? `1 ${firstStudyMeta().short}` : String(docIdx + 1),
        doc ? getDisplayName(doc) : '',
        doc ? doc.title : '',
        doc ? doc.setting : '',
        doc ? doc.participants : '',
        doc ? doc.methodology : '',
        doc ? doc.appraisalTool : '',
        doc ? doc.quality : '',
        doc ? doc.richness : '',
        doc ? doc.contextNote : '',
        doc ? (doc.studyOverview || '') : '',
        doc ? (doc.funder || '') : '',
        doc ? companionText(doc) : '',
        sec.by || 'Unknown',
        sec.note || '',
        secEvidenceText(sec) || '',
        sec.nuanceNote || '',
        `${concordanceLabel(sec.concordanceStatus)}${sec.concordanceNote ? ': ' + sec.concordanceNote : ''}`,
        cellComment,
        firsts.map(f => `"${f.text}"${f.note ? ' [' + f.note + ']' : ''} (p.${f.page})`).join(' | '),
        secPagesLabel(sec)
      ]);
    });
  });

  // Spreadsheet-safe cells: text starting with = + - @ (common in quotes, e.g. "- I felt...") would otherwise be read as a formula by Excel
  const csvCell = c => {
    let v = String(c ?? '');
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return `"${v.replace(/"/g, '""')}"`;
  };
  const csvContent = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const projTag = state.projectCode ? `${state.projectCode}_` : '';
  a.download = `meta_ethnography_synthesis_${projTag}${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById('quietGapsToggle')?.addEventListener('change', e => {
  try { lsSet('me_quiet_gaps', e.target.checked ? '1' : '0'); } catch (err) {}
  renderPublicationView();
});
