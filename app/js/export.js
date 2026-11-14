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
      const relTag = cellRelationTag(s, c.id);
      const refutBadge = relTag ? `<span style="color:${isSecRefutational(s, c.id) ? '#be123c' : '#64748b'}; font-weight:bold;">${escapeHtml(relTag.trim())}</span> ` : '';
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

    rowsHtml += `
      <tr>
        <td>
          <b>${escapeHtml(c.thirdOrderTitle || '(Untitled 3rd Order Construct)')}</b>${c.autoSeeded && !c.seedConfirmed ? ' <span style="font-size:10px; color:#b45309;">(provisional: seeded from Index Paper, not yet confirmed)</span>' : ''}
          <div style="font-size:10.5px; color:#475569; margin-top:4px;"><b>Relations:</b> ${escapeHtml(rowRelationText(c))}</div>
          <div style="font-size:10px; color:#64748b; margin-top:2px;"><b>Concordance:</b> ${escapeHtml(c.concordanceStatus.toUpperCase())}</div>
        </td>
        <td>${c.translationSummary ? `<div style="margin-bottom:6px;"><b>Translation:</b> ${escapeHtml(c.translationSummary)}</div>` : ''}${c.synthesisNote ? `<div><b>3rd order interpretation:</b> ${escapeHtml(c.synthesisNote)}</div>` : ''}${(!c.translationSummary && !c.synthesisNote) ? '-' : ''}</td>
        <td>${secondOrderListHtml || '-'}</td>
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
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">Illustrating how raw participant quotes (1st order) and primary author interpretations (2nd order) were translated into overarching 3rd order constructs with GRADE-CERQual confidence ratings.</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead>
        <tr>
          <th style="width:16%;">3rd Order Construct & How Studies Relate</th>
          <th style="width:20%;">Translation (A) & 3rd Order Interpretation (B)</th>
          <th style="width:24%;">2nd Order Constructs (Author Interpretations)</th>
          <th style="width:20%;">Illustrating 1st Order Quotes</th>
          <th style="width:10%;">Contributing Studies</th>
          <th style="width:10%;">GRADE-CERQual Confidence</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="6">No 3rd Order Concept Clusters created yet.</td></tr>'}
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
  const v = (() => { try { return localStorage.getItem('me_table3_mode'); } catch (e) { return null; } })();
  return TABLE3_MODES[v] ? v : 'combined';
}
const CERQUAL_CAVEAT = 'GRADE-CERQual was applied to the third-order constructs. Its developers note that further work is needed on applying the approach to more interpretive outputs such as those of meta-ethnography (Lewin et al., 2018).';
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
    widths: [18, 12, 12, 12, 12, 12, 8, 14],
    rows: rows.map(r => [{ title: r.finding.title }, r.studies, r.lim, r.coh, r.adeq, r.rel, { strong: r.conf }, r.expl])
  };
  const combined = {
    title: 'Table 3. GRADE-CERQual Summary of Qualitative Findings (SoQF) & Evidence Profile',
    caption: 'Assessment of confidence in each 3rd order review finding across Methodological Limitations, Coherence, Adequacy, and Relevance (Lewin et al., 2018). ' + CERQUAL_CAVEAT,
    headers: ['Summary of Review Finding (3rd Order Construct)', 'Studies Contributing to the Finding', 'Methodological Limitations', 'Coherence', 'Adequacy of Data', 'Relevance', 'Overall CERQual Confidence', 'Explanation of CERQual Assessment'],
    widths: [24, 12, 10, 10, 10, 10, 8, 16],
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
      : `<tr><td colspan="${spec.headers.length}">No 3rd Order Concept Clusters created yet.</td></tr>`;
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

function buildAppendixHtml() {
  let rowsHtml = '';
  const chronological = [...state.logs].reverse();
  chronological.forEach(l => {
    const meta = getCategoryMeta(l.category);
    const dateStr = new Date(l.timestamp).toLocaleString();
    const revStr = l.reviewer || 'Unknown';
    const changeStr = (l.fromVal || l.toVal)
      ? `${l.fromVal ? `From: ${escapeHtml(l.fromVal)} ` : ''}${l.toVal ? `➔ To: ${escapeHtml(l.toVal)}` : ''}`
      : '-';
    rowsHtml += `
      <tr>
        <td style="white-space:nowrap;">${escapeHtml(dateStr)}</td>
        <td><b>@${escapeHtml(revStr)}</b></td>
        <td><b>${escapeHtml(meta.label)}</b></td>
        <td><b>${escapeHtml(l.action)}</b>${l.detail ? `<br>${escapeHtml(l.detail)}` : ''}</td>
        <td>${changeStr}</td>
        <td>${escapeHtml(l.rationale || '-')}</td>
      </tr>
    `;
  });

  return `
    <div class="mb-3">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">Appendix A. Methodological Audit Trail, Team Concordance & Reflexive Synthesis Log</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">Chronological record of interpretive decisions, reviewer concordance, GRADE-CERQual judgements, and researcher reflexivity (eMERGe items 9, 11, 13, 15 and 18).</p>
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
  `;
}

// ---- Relations are judged per cell; rows only report what the cells say ----
function rowRelationText(c) {
  const od = rowOriginDoc(c);
  return rowRelationSummary(c) + (od ? ` · emerged in study #${state.docs.indexOf(od) + 1} (${getDisplayName(od)})` : '');
}
function cellRelationTag(s, cid) {
  const r = cellRelationOf(s, cid);
  return r === 'refutational' ? '[⚡Refutational] ' : r === 'unjudged' ? '[? relation not yet judged] ' : '';
}

// ---- Table 2b (concept × study grid): one spec, rendered to HTML / Markdown / Word ----
const TABLE2B_LEGEND = '◆ = study #1, which establishes the rows; ● = reciprocal; ⚡ = refutational; ? = relation not yet judged; ○ = checked, concept not addressed (silence); – = outside the study\'s scope; blank = not yet checked.';
const TABLE2B_NOTE = 'The grid shows where each concept was found and how studies were judged to relate; it is not a frequency count. In meta-ethnography the weight of a third-order construct rests on the interpretive translation (Table 2), not on how many studies contribute to it.';
function getTable2bSpec() {
  const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);
  return {
    title: 'Table 2b. Concept-by-Study Contribution Matrix Across Included Studies',
    caption: `${TABLE2B_LEGEND} ${TABLE2B_NOTE}`,
    headers: ['3rd Order Construct', ...state.docs.map((d, idx) => getDisplayName(d) + (idx === 0 ? ' ' + firstStudyMeta().short : '')), 'CERQual Confidence'],
    rows: state.clusters.map(c => {
      normalizeCluster(c);
      const mappedSecs = allSeconds.filter(s => s.clusterIds.includes(c.id));
      return {
        title: c.thirdOrderTitle || '(Untitled 3rd Order Construct)',
        provisional: !!(c.autoSeeded && !c.seedConfirmed),
        relations: rowRelationText(c),
        cells: state.docs.map(d => {
          const docSecs = mappedSecs.filter(s => s.docId === d.id);
          if (docSecs.length === 0) {
            const ec = emptyCellStatus(c, d.id);
            return { sym: EMPTY_CELL_META[ec.status].sym, empty: true, note: ec.note || '' };
          }
          return {
            sym: contribSymbol(docSecs, c.id),
            refut: docSecs.some(s => isSecRefutational(s, c.id)),
            pages: [...new Set(docSecs.map(s => 'p.' + s.page))].join(', ')
          };
        }),
        cerqual: c.cerqualConfidence || 'Not assessed'
      };
    })
  };
}

function buildTable2GridHtml() {
  const spec = getTable2bSpec();
  const studyHeaders = spec.headers.slice(1, -1).map(h => `<th style="text-align:center; font-size:12px; min-width:70px;">${escapeHtml(h)}</th>`).join('');
  const rowsHtml = spec.rows.map(r => `
      <tr>
        <td>
          <b>${escapeHtml(r.title)}</b>${r.provisional ? ' <span style="font-size:10px; color:#b45309;">(provisional)</span>' : ''}
          <div style="font-size:10px; color:#475569;">${escapeHtml(r.relations)}</div>
        </td>
        ${r.cells.map(cell => cell.empty
          ? `<td style="text-align:center; color:#64748b;"${cell.note ? ` title="${escapeHtml(cell.note)}"` : ''}>${escapeHtml(cell.sym)}</td>`
          : `<td style="text-align:center; font-weight:bold; color:${cell.refut ? '#be123c' : '#0f172a'};">${escapeHtml(cell.sym)}<div style="font-size:9.5px; font-weight:normal; color:#64748b;">${escapeHtml(cell.pages)}</div></td>`).join('')}
        <td style="text-align:center;"><b>${escapeHtml(r.cerqual)}</b></td>
      </tr>`).join('');

  return `
    <div class="mb-3">
      <h3 style="font-family: Georgia, serif; font-size: 15px; font-weight: bold; color: #0f172a;">${escapeHtml(spec.title)}</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">${escapeHtml(TABLE2B_LEGEND)}</p>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">${escapeHtml(TABLE2B_NOTE)}</p>
    </div>
    <table class="pub-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; width:100%;">
      <thead>
        <tr>
          <th style="width:22%;">${escapeHtml(spec.headers[0])}</th>
          ${studyHeaders}
          <th style="text-align:center; width:10%;">${escapeHtml(spec.headers[spec.headers.length - 1])}</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="${spec.headers.length}">No 3rd Order Concept Clusters created yet.</td></tr>`}
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
      [3, 'Focus', 'State the review question(s) or objectives', (loa.reviewQuestion && loa.reviewQuestion.trim()) ? R('Review Question field → Methods Summary') : A('Not entered: use the Review Question field (Project Setup or the drawer)')],
      [4, 'Rationale for using meta-ethnography', 'Why meta-ethnography was the most appropriate synthesis methodology', A('Author to complete (Introduction / Methods)')] ] },
    { name: 'Phase 2\nDeciding what is relevant', items: [
      [5, 'Search strategy', 'Rationale for the literature search strategy', A('Author to complete (Methods; done outside the app)')],
      [6, 'Search processes', 'How the searching was carried out and by whom', A('Author to complete (Methods; done outside the app)')],
      [7, 'Selecting primary studies', 'Screening and selection process, and who was involved', A('Author to complete (Methods; done outside the app)')],
      [8, 'Outcome of study selection', 'Results of searches and screening (e.g., flow diagram)', A('Author to complete (Findings; PRISMA flow outside the app)')] ] },
    { name: 'Phase 3\nReading included studies', items: [
      [9, 'Reading and data extraction approach', 'Reading and extraction methods, who did them, independence and accuracy checks; full account vs findings only; units of synthesis',
        (loa.readingApproach && loa.extractionScope && loa.unitsTerminology) ? R('Phase 3 fields → Methods Summary')
          : (loa.readingApproach || loa.extractionScope || loa.unitsTerminology) ? P('Phase 3 fields partly filled (process / extracted from / units of synthesis)')
          : (nDocs > 0 ? A('Author to complete: use the Phase 3 fields in Research Aim & Overall Model') : A('No studies loaded yet'))],
      [10, 'Characteristics of included studies', 'Describe included studies, including context, funder and companion papers',
        nDocs === 0 ? A('No studies loaded yet')
          : (state.docs.every(d => d.setting && d.participants && d.methodology) && state.docs.some(d => d.funder)) ? R('Table 1 (incl. funder and linked accounts)')
          : P(`Table 1; ${state.docs.filter(d => !(d.setting && d.participants && d.methodology)).length} stud(ies) with missing context; ${state.docs.some(d => d.funder) ? '' : 'no funder recorded; '}link companion papers in Edit Study Info`)] ] },
    { name: 'Phase 4\nDetermining how studies are related', items: [
      [11, 'Process for determining how studies are related', 'Which aspects of studies were compared, and how', hasRelProc ? R('Phase 4 field → Methods Summary / Table 2') : A('Author to complete: use the Phase 4 field in Research Aim & Overall Model')],
      [12, 'Outcome of relating studies', 'How studies relate to each other, incl. disconfirming cases', hasRelOut ? R('Phase 4 outcome text → Table 2 / Table 2b') : (nCl > 0 ? P('Table 2b (contribution grid); enter the outcome in the Phase 4 field') : A('Author to complete (Findings)'))] ] },
    { name: 'Phase 5\nTranslating studies into one another', items: [
      [13, 'Process of translating studies', 'Working definitions, preservation of context/meaning, reciprocal and refutational translation, alternative interpretations',
        (loa.translationDefinitions && loa.translationProcess && loa.alternativeInterpretations) ? R('Phase 5 fields → Methods Summary; Table 2, Appendix A')
          : (loa.translationDefinitions || loa.translationProcess || loa.alternativeInterpretations || nCl > 0) ? P('Complete the Phase 5 fields (definitions / process / alternative interpretations)')
          : A('Author to complete: use the Phase 5 fields')],
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
      ['Ext. 2', 'Methodological strengths and limitations of primary studies', 'Whether/how included studies were appraised and how the appraisal was used', (loa.appraisalPolicy || loa.appraisalUse)
        ? (state.docs.some(d => d.quality) ? R('Appraisal policy / use → Methods Summary; ratings → Table 1') : P('Appraisal policy / use → Methods Summary; no per-study ratings recorded'))
        : (state.docs.some(d => d.quality) ? P('Ratings in Table 1; describe the appraisal policy and its use in the drawer') : A('Author to complete: use the Appraisal fields in Research Aim & Overall Model'))],
      ['Ext. 3', 'GRADE-CERQual confidence in review findings', 'GRADE-CERQual assessment of each finding (CERQual developers note further work is needed for interpretive outputs such as meta-ethnography)', nCl === 0 ? A('No 3rd order constructs yet') : (assessed === nCl ? R('Table 3') : (assessed > 0 ? P('Table 3 (some findings are still unrated)') : A('No finding assessed yet')))] ] }
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
const PH = (t) => `<span style="color:#2563eb; font-weight:bold;">[Author to insert: ${t}]</span>`;
function getMethodSections() {
  const docCount = state.docs.length;
  const tools = new Set();
  state.docs.forEach(d => { normalizeDoc(d); if (d.quality && d.appraisalTool) tools.add(d.appraisalTool); });
  const anyQuality = state.docs.some(d => d.quality);
  const anyRichness = state.docs.some(d => d.richness);
  const toolStr = tools.size > 0 ? Array.from(tools).join(', ') : '';
  const polHtml = state.loa.appraisalPolicy ? escapeHtml(state.loa.appraisalPolicy) + ' ' : '';
  const useHtml = state.loa.appraisalUse ? escapeHtml(state.loa.appraisalUse) : PH('how appraisal results were used, e.g., whether studies were excluded or weighted');
  const qualityHtml = anyQuality
    ? polHtml + `The methodological quality of each included study was appraised${toolStr ? ' using <b>' + escapeHtml(toolStr) + '</b>' : ' ' + PH('appraisal tool')}; the ratings are reported in Table 1.${anyRichness ? ' Conceptual richness of each study was also recorded (Table 1).' : ''} ${useHtml}`
    : (state.loa.appraisalPolicy ? polHtml + useHtml : PH('whether and how the quality of the included studies was appraised, and how appraisal was used'));

  const synthHtml = state.loa.synthStudies ? ' Studies included in the line-of-argument synthesis: ' + escapeHtml(state.loa.synthStudies) + '.' : '';
  const hasLoaModel = !!(state.loa.title || state.loa.flow || state.loa.narrative);
  const nCl = state.clusters.length;
  const cqAnyAssessed = state.clusters.some(c => c.cerqualConfidence && c.cerqualConfidence !== 'Not assessed');
  const cqAllAssessed = nCl > 0 && state.clusters.every(c => c.cerqualConfidence && c.cerqualConfidence !== 'Not assessed');
  const cqCount = state.clusters.filter(c => c.cerqualConfidence && c.cerqualConfidence !== 'Not assessed').length;
  const seedCount = state.clusters.filter(c => c.autoSeeded).length;
  const emergedRows = state.clusters.filter(c => rowOriginDoc(c));
  const relTotals = state.clusters.reduce((t, c) => {
    const k = rowRelationCounts(c);
    Object.keys(k).forEach(x => { t[x] = (t[x] || 0) + k[x]; });
    return t;
  }, {});

  const reviewers = new Set();
  state.annotations.forEach(a => { if (a.by) reviewers.add(a.by); });
  state.clusters.forEach(c => { if (c.by) reviewers.add(c.by); });
  state.logs.forEach(l => { if (l.reviewer) reviewers.add(l.reviewer); });
  const isTeam = reviewers.size > 1;
  const memoCount = state.logs.filter(l => l.category === 'reflexive_memo').length;

  const firstName = docCount > 0 ? escapeHtml(getDisplayName(state.docs[0])) : '[first study]';
  const strategy = getOrderStrategy();
  const orderHtml = strategy === 'index'
    ? `Studies were ordered for translation, designating <b>${firstName}</b> as the index paper. ${PH('why this study was chosen as the index paper')}`
    : strategy === 'chronological'
      ? `Studies were translated in chronological order of publication, beginning with <b>${firstName}</b>, each study being compared with the synthesis of the studies before it.`
      : `Studies were translated in the order shown in Table 1, beginning with <b>${firstName}</b>. ${PH('rationale for this translation order')}`;
  const emergedHtml = emergedRows.length > 0
    ? ` ${emergedRows.length} third-order construct${emergedRows.length === 1 ? ' was' : 's were'} opened by a concept from a later study that had no counterpart in ${firstName} (${emergedRows.map(c => { const od = rowOriginDoc(c); return '<i>' + escapeHtml(c.thirdOrderTitle || 'Untitled') + '</i> from study #' + (state.docs.indexOf(od) + 1); }).join('; ')}), so the synthesis was extended rather than fitted to the first study's concepts.`
    : '';
  const silenceHtml = (relTotals.silent || relTotals.na)
    ? ` Where a study did not contribute to a construct, its account was re-checked and the absence recorded as silence (${relTotals.silent || 0} cell${relTotals.silent === 1 ? '' : 's'}) or as outside the study's scope (${relTotals.na || 0}) (Table 2b).`
    : '';
  const unjudgedHtml = relTotals.unjudged ? ' ' + PH(`${relTotals.unjudged} study–construct relation(s) are still "not yet judged" in Tab 2; decide reciprocal or refutational before reporting`) : '';
  const seedHtml = seedCount > 0
    ? ` The second-order constructs of the first study (${firstName}) were used to seed the initial third-order rows, which were then refined as further studies were translated into them.`
    : '';

  const aimText = state.loa.aim
    ? escapeHtml(state.loa.aim)
    : '<span style="color:#be123c; font-weight:bold;">[MISSING: Set Phase 1 Aim in Project Setup]</span>';

  const relProcHtml = state.loa.relateProcess
    ? escapeHtml(state.loa.relateProcess)
    : PH('aspects of the studies compared and how they were compared (eMERGe Item 11); use the Phase 4 field in Research Aim &amp; Overall Model');
  const relOutHtml = state.loa.relateOutcome ? ' ' + escapeHtml(state.loa.relateOutcome) : '';

  const cqHtml = cqAnyAssessed
    ? `Confidence in ${cqAllAssessed ? 'each' : cqCount + ' of the ' + nCl} synthesized third-order finding${cqAllAssessed && nCl === 1 ? '' : 's'} was assessed using the GRADE-CERQual approach (Lewin et al., 2018) across four components (methodological limitations, coherence, adequacy of data, and relevance); each judgement is reported with its explanation in Table 3.${cqAllAssessed ? '' : ' The remaining findings were not assessed.'} The CERQual developers note that further work is needed on applying the approach to more interpretive synthesis outputs such as those of meta-ethnography (Lewin et al., 2018). ${PH('how GRADE-CERQual was adapted to, or applied to, the interpretive findings of this meta-ethnography')}`
    : PH('whether and how GRADE-CERQual was applied; no finding has been assessed yet');

  const linksHtml = getLoaLinks().length
    ? getLoaLinks().map(l => `${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.from)))} ${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym} ${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.to)))}${l.note ? ' (' + escapeHtml(l.note) + ')' : ''}`).join('; ')
    : '';

  const L = state.loa;
  const esc = v => escapeHtml(String(v || '').trim());
  const questionHtml = L.reviewQuestion && L.reviewQuestion.trim()
    ? ` The review question was: <i>${esc(L.reviewQuestion)}</i>.`
    : ` ${PH('the review question(s) or objectives (eMERGe Item 3); use the Review Question field')}`;

  // Phase 3 (Item 9) + Item 10 companion papers
  const scopeText = { full: 'Data were extracted from across the full primary study accounts, not only the findings sections.',
                      findings: 'Data were extracted from the findings sections of the primary study accounts.',
                      mixed: 'Data were extracted mainly from the findings sections, with other sections of each account read for context and concepts.' }[L.extractionScope] || '';
  const companionPairs = state.docs.filter(d => d.companionOf && state.docs.some(x => x.id === d.companionOf))
    .map(d => `${esc(getDisplayName(d))} and ${esc(getDisplayName(state.docs.find(x => x.id === d.companionOf)))}`);
  const companionHtml = companionPairs.length
    ? ` Some accounts derived from the same primary study (${companionPairs.join('; ')}); these are identified in Table 1.`
    : '';
  const readingHtml = `${L.readingApproach ? esc(L.readingApproach) : PH('how studies were read and data extracted, by whom, whether independently, and how accuracy was checked (eMERGe Item 9)')} ${scopeText || PH('whether data were extracted from the full accounts or the findings sections only')} First-order constructs (participant quotations) and second-order constructs (the primary authors' interpretations) were extracted and recorded separately${L.unitsTerminology ? '; ' + esc(L.unitsTerminology) : ''}.${L.unitsTerminology ? '' : ' ' + PH('what is meant by the units of synthesis used, e.g., concept, theme, metaphor')}${companionHtml}`;

  // Phase 5 (Item 13)
  const translationHtml = `Data extraction and cross-study translation were managed using <i>Meta-Ethnography Canvas</i>${appCitationHtml()}. ${orderHtml}${seedHtml}${emergedHtml} ${L.translationDefinitions ? esc(L.translationDefinitions) : PH('working definitions of reciprocal and refutational translation (eMERGe Item 13)')} ${L.translationProcess ? esc(L.translationProcess) : PH('who translated, how meaning was translated from one study into another, and how context and relationships between concepts were preserved')} Through reciprocal and refutational translation, the extracted constructs were synthesized into third-order constructs (Table 2; contribution of each study in Table 2b).${silenceHtml}${unjudgedHtml} ${L.alternativeInterpretations ? esc(L.alternativeInterpretations) : PH('how alternative interpretations or explanations were considered (Items 13 and 15)')}`;

  // Phase 6 (Items 15-16) incl. independent team models (Atkins et al., 2008)
  const teamModels = Array.isArray(L.teamModels) ? L.teamModels : [];
  const tmReviewers = [...new Set(teamModels.map(m => m.reviewer))];
  const teamHtml = teamModels.length > 1
    ? ` ${tmReviewers.length} reviewer(s) (${tmReviewers.map(r => '@' + esc(r)).join(', ')}) first developed ${teamModels.length} overarching models independently; these were compared and merged into the line of argument${L.teamMergeNote ? ': ' + esc(L.teamMergeNote) : '. ' + PH('how the independent models were compared and merged')}`
    : '';
  const synthesisHtml = hasLoaModel
    ? `The third-order constructs were then synthesized into a line-of-argument model${L.title ? ', "<b>' + esc(L.title) + '</b>"' : ''} (Table 2).${synthHtml}${teamHtml} ${L.modelContext ? esc(L.modelContext) : PH('the context in which the model applies, or does not, given the characteristics of the included studies (eMERGe Item 16)')}`
    : `${PH('how the line-of-argument synthesis was conducted, or why it was not (eMERGe Item 15)')}${teamHtml}`;

  const sections = [
    { title: 'Study Design and Reporting Guidelines',
      html: `We conducted a meta-ethnography following the seven-phase methodology originally developed by Noblit and Hare (1988). Its reporting follows the eMERGe meta-ethnography reporting guidance (France et al., 2019). The aim of this review was: <i>${aimText}</i>.${questionHtml}` },
    { title: 'Literature Search and Study Selection',
      html: PH('database search strategy, inclusion/exclusion criteria, and screening flow numbers (eMERGe Items 5–8)') },
    { title: 'Quality Appraisal and Conceptual Richness', html: qualityHtml },
    { title: 'Reading and Data Extraction (Phase 3)', html: readingHtml },
    { title: 'Relating the Studies (Phase 4)', html: relProcHtml + relOutHtml },
    { title: 'Translating the Studies (Phase 5)', html: translationHtml },
    { title: 'Synthesizing Translations (Phase 6)', html: synthesisHtml }
  ];
  if (linksHtml) sections.push({ title: 'Relationships between Third-Order Constructs', html: linksHtml });
  sections.push({ title: 'Rigor, Reflexivity, and Confidence in Findings',
    html: `${isTeam
        ? `Records in the audit trail are attributed to more than one reviewer ID. ${PH('who extracted and coded, whether independently, and how discrepancies were resolved (eMERGe items 9, 13)')}`
        : 'Records in the audit trail are attributed to a single reviewer ID.'} ${memoCount > 0 ? 'Reflexive and analytic memos were recorded chronologically in the audit trail (Appendix A).' : PH('how reflexivity was handled; no memos are recorded yet')} ${cqHtml}` });
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
      <h3 style="font-family: Georgia, serif; font-size: 16px; font-weight: bold; color: #0f172a; margin-bottom: 8px;">eMERGe Methods Summary</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic; margin-bottom: 16px;">Compiled from your project data and audit trail. Expand with your analytical rationale before submission.</p>
      <div style="font-family: Georgia, serif; font-size: 13.5px; color: #1e293b; line-height: 1.6;">${body}</div>
    </div>
    ${buildeMERGeTableHtml()}
  `;
}

function buildeMERGeTableHtml() {
  const rows = getEmergeChecklist().map(r => {
    const status = r.level === 'app' ? `<b>${escapeHtml(r.text)}</b>`
      : r.level === 'partial' ? `<span style="color:#b45309; font-weight:bold;">Partly: ${escapeHtml(r.text)}</span>`
      : `<span style="color:#2563eb; font-weight:bold;">[${escapeHtml(r.text)}]</span>`;
    const ph = r.phase ? `<b>${escapeHtml(r.phase).replace('\n', '<br>')}</b>` : '';
    return `<tr><td>${ph}</td><td>${escapeHtml(String(r.no))}. ${escapeHtml(r.title)}</td><td>${escapeHtml(r.desc)}</td><td>${status}</td></tr>`;
  }).join('');
  return `
    <div style="margin-top: 32px; margin-bottom: 12px;">
      <h3 style="font-family: Georgia, serif; font-size: 14px; font-weight: bold; color: #0f172a;">eMERGe Reporting Checklist Mapping (France et al., 2019)</h3>
      <p style="font-family: Georgia, serif; font-size: 11px; color: #475569; font-style: italic;">Item numbers follow the official 19 reporting criteria. Status is computed from your project data: bold = supplied by the app; amber = partly supplied; blue = for the author to write.</p>
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
    try { localStorage.setItem('me_table3_mode', sel.value); } catch (e) {}
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

function renderPublicationView() {
  const container = document.getElementById('pubPreviewContainer');
  if (state.activePubTable === 'method') container.innerHTML = buildMethodHtml();
  else if (state.activePubTable === 'table1') container.innerHTML = buildTable1Html();
  else if (state.activePubTable === 'table2') container.innerHTML = buildTable2Html();
  else if (state.activePubTable === 'table2_grid') container.innerHTML = buildTable2GridHtml();
  else if (state.activePubTable === 'table3') container.innerHTML = buildTable3SoQFHtml();
  else container.innerHTML = buildAppendixHtml();
}

document.getElementById('copyRichTableBtn').addEventListener('click', async () => {
  const container = document.getElementById('pubPreviewContainer');
  const html = container.innerHTML;
  const text = container.innerText;
  try {
    const blobHtml = new Blob([html], { type: 'text/html' });
    const blobText = new Blob([text], { type: 'text/plain' });
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })]);
    alert('Rich Table copied! Paste directly (Ctrl+V / Cmd+V) into Microsoft Word or Google Docs.');
  } catch (e) {
    const range = document.createRange();
    range.selectNodeContents(container);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    alert('Table copied to clipboard!');
  }
});

document.getElementById('copyMarkdownBtn').addEventListener('click', async () => {
  let md = '';
  const cleanMd = s => String(s || '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

  if (state.activePubTable === 'method') {
    md += `### eMERGe Methods Summary\n\n`;
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
  } else if (state.activePubTable === 'table2') {
    md += `### Table 2. Meta-Ethnographic Translation and Synthesis Table\n\n`;
    md += `| 3rd Order Construct | How Studies Relate | Concordance | Translation Summary (A) | 3rd Order Interpretation (B) | 2nd Order Constructs | 1st Order Quotes | Studies | CERQual Confidence |\n`;
    md += `|---|---|---|---|---|---|---|---|---|\n`;
    const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);
    state.clusters.forEach(c => {
      normalizeCluster(c);
      const mappedSecs = allSeconds.filter(s => s.clusterIds.includes(c.id));
      const docs = [...new Set(mappedSecs.map(s => getDisplayName(state.docs.find(d => d.id === s.docId))))];
      const secStr = mappedSecs.map(s => {
        const dName = getDisplayName(state.docs.find(d => d.id === s.docId));
        return `${cellRelationTag(s, c.id)}${s.origin === 'wrapped_first_order' ? '[reviewer-wrapped 1st-order quote] ' : ''}${dName} (p.${secPagesLabel(s)}): ${s.note ? `**${s.note}**${secLabelTag(s)} - ` : ''}"${secEvidenceText(s)}"`;
      }).join('; ');
      const quotes = [];
      const seenQ = new Set();
      mappedSecs.forEach(s => {
        const firsts = quotesOf(s.id).filter(f => !seenQ.has(f.id) && seenQ.add(f.id));
        firsts.forEach(f => quotes.push(`"${f.text}"${f.note ? ' [' + f.note + ']' : ''} (p.${f.page})`));
      });
      md += `| **${cleanMd(c.thirdOrderTitle || 'Untitled')}** | ${cleanMd(rowRelationText(c))} | ${cleanMd(c.concordanceStatus)} | ${cleanMd(c.translationSummary)} | ${cleanMd(c.synthesisNote)} | ${cleanMd(secStr)} | ${cleanMd(quotes.join('; '))} | ${cleanMd(docs.join(', '))} | **${cleanMd(c.cerqualConfidence)}** ${cleanMd(c.cerqualExplanation)} |\n`;
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
    const spec = getTable2bSpec();
    md += `### ${spec.title}\n\n*${spec.caption}*\n\n`;
    md += `| ${spec.headers.map(cleanMd).join(' | ')} |\n`;
    md += `|---|${state.docs.map(() => ':---:').join('|')}|:---:|\n`;
    spec.rows.forEach(r => {
      md += `| **${cleanMd(r.title)}**${r.provisional ? ' (provisional)' : ''} | ${r.cells.map(cell => cleanMd(cell.sym.replace(' / ', '/')) || ' ').join(' | ')} | **${cleanMd(r.cerqual)}** |\n`;
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
    md += `### Appendix A. Methodological Audit Trail & Reflexive Log\n\n`;
    md += `| Timestamp | Reviewer | Category | Action / Memo | Before ➔ After | Rationale |\n`;
    md += `|---|---|---|---|---|---|\n`;
    [...state.logs].reverse().forEach(l => {
      const meta = getCategoryMeta(l.category);
      const diff = (l.fromVal || l.toVal) ? `${l.fromVal || ''} ➔ ${l.toVal || ''}` : '-';
      md += `| ${cleanMd(new Date(l.timestamp).toLocaleString())} | @${cleanMd(l.reviewer || 'Unknown')} | ${cleanMd(meta.label)} | **${cleanMd(l.action)}** ${cleanMd(l.detail)} | ${cleanMd(diff)} | ${cleanMd(l.rationale)} |\n`;
    });
  }

  await navigator.clipboard.writeText(md);
  alert('Markdown table copied to clipboard!');
});

document.getElementById('downloadWordDocBtn').addEventListener('click', async () => {
  if (typeof docx === 'undefined') {
    alert('The docx library could not be loaded from CDN. Please check your internet connection.');
    return;
  }

  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, BorderStyle, PageOrientation, PageBreak
  } = docx;

  const borderTopBottomThick = { style: BorderStyle.SINGLE, size: 12, color: "0F172A" };
  const borderHeaderBottom = { style: BorderStyle.SINGLE, size: 8, color: "0F172A" };
  const borderRowLight = { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" };
  const borderNone = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

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
    '3rd Order Construct & How Studies Relate', 'Translation (A) & 3rd Order Interpretation (B)',
    '2nd Order Constructs (Author Interpretations)', 'Illustrating 1st Order Quotes',
    'Contributing Studies', 'GRADE-CERQual Confidence'
  ];
  const t2Rows = [
    new TableRow({ tableHeader: true, children: t2Headers.map(h => makeCell(h, { isHeader: true })) })
  ];
  const allSeconds = state.annotations.filter(a => a.type === 'second_order').map(normalizeAnnotation);

  if (state.clusters.length === 0) {
    t2Rows.push(new TableRow({ children: [makeCell('No 3rd Order Concept Clusters created yet.', { isLastRow: true }), ...Array(5).fill(0).map(() => makeCell('-', { isLastRow: true }))] }));
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
            new TextRun({ text: `• ${cellRelationTag(s, c.id)}${s.origin === 'wrapped_first_order' ? '[reviewer-wrapped 1st-order quote] ' : ''}${dName} (p.${secPagesLabel(s)}): `, bold: true, font: "Times New Roman", size: 20 }),
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

      t2Rows.push(new TableRow({
        children: [
          makeCell(`${c.thirdOrderTitle || '(Untitled)'}\n[Relations: ${rowRelationText(c)} | Concordance: ${c.concordanceStatus.toUpperCase()}]`, { isLastRow: isLast, bold: true }),
          makeCell([c.translationSummary ? 'Translation: ' + c.translationSummary : '', c.synthesisNote ? '3rd order interpretation: ' + c.synthesisNote : ''].filter(Boolean).join('\n\n') || '-', { isLastRow: isLast }),
          makeCell(secParagraphs, { isLastRow: isLast }),
          makeCell(quoteParagraphs, { isLastRow: isLast }),
          makeCell(contributingDocs.join('; ') || '-', { isLastRow: isLast }),
          makeCell(`${c.cerqualConfidence || 'Not assessed'}${c.cerqualExplanation ? '\n' + c.cerqualExplanation : ''}`, { isLastRow: isLast })
        ]
      }));
    });
  }

  // Build Table 2b: Concept-by-Study Contribution Grid for Word (.docx) from the shared spec
  const t2bSpec = getTable2bSpec();
  const t2bRows = [
    new TableRow({ tableHeader: true, children: t2bSpec.headers.map(h => makeCell(h, { isHeader: true })) })
  ];
  if (t2bSpec.rows.length === 0) {
    t2bRows.push(new TableRow({ children: [makeCell('No themes yet.', { isLastRow: true }), ...Array(state.docs.length + 1).fill(0).map(() => makeCell('-', { isLastRow: true }))] }));
  } else {
    t2bSpec.rows.forEach((r, idx) => {
      const isLast = idx === t2bSpec.rows.length - 1;
      t2bRows.push(new TableRow({
        children: [
          makeCell(r.title + (r.provisional ? ' (provisional)' : ''), { isLastRow: isLast, bold: true }),
          ...r.cells.map(cell => makeCell(cell.sym || ' ', { isLastRow: isLast, bold: !cell.empty })),
          makeCell(r.cerqual, { isLastRow: isLast, bold: true })
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
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: trs })
    ];
  });

  const appHeaders = ['Timestamp', 'Reviewer', 'Phase / Category', 'Action / Analytic Memo', 'Conceptual Evolution', 'Methodological Rationale'];
  const appRows = [
    new TableRow({ tableHeader: true, children: appHeaders.map(h => makeCell(h, { isHeader: true })) })
  ];
  const chronological = [...state.logs].reverse();
  if (chronological.length === 0) {
    appRows.push(new TableRow({ children: [makeCell('No audit trail entries recorded yet.', { isLastRow: true }), ...Array(5).fill(0).map(() => makeCell('-', { isLastRow: true }))] }));
  } else {
    chronological.forEach((l, idx) => {
      const isLast = idx === chronological.length - 1;
      const meta = getCategoryMeta(l.category);
      const changeStr = (l.fromVal || l.toVal) ? `${l.fromVal ? 'From: ' + l.fromVal + ' ' : ''}${l.toVal ? '-> To: ' + l.toVal : ''}` : '-';
      appRows.push(new TableRow({
        children: [
          makeCell(new Date(l.timestamp).toLocaleString(), { isLastRow: isLast }),
          makeCell(`@${l.reviewer || 'Reviewer'}`, { isLastRow: isLast, bold: true }),
          makeCell(meta.label, { isLastRow: isLast }),
          makeCell(`${l.action}${l.detail ? '\n' + l.detail : ''}`, { isLastRow: isLast }),
          makeCell(changeStr, { isLastRow: isLast }),
          makeCell(l.rationale || '-', { isLastRow: isLast })
        ]
      }));
    });
  }

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
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
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
          ]
        }),
        new Paragraph({ children: [new PageBreak()] }),

        new Paragraph({
          children: [new TextRun({ text: `Table 1. Characteristics and Critical Appraisal of Included Studies (${state.docs.length} studies)`, bold: true, font: "Times New Roman", size: 24 })],
          spacing: { after: 140 }
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: t1Rows }),

        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          children: [new TextRun({ text: "Table 2. Meta-Ethnographic Translation and Synthesis of 1st, 2nd, and 3rd Order Constructs", bold: true, font: "Times New Roman", size: 24 })],
          spacing: { after: 140 }
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: t2Rows }),
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
          children: [new TextRun({ text: t2bSpec.title, bold: true, font: "Times New Roman", size: 24 })],
          spacing: { after: 80 }
        }),
        new Paragraph({
          children: [new TextRun({ text: t2bSpec.caption, italics: true, font: "Times New Roman", size: 18 })],
          spacing: { after: 140 }
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: t2bRows }),

        new Paragraph({ children: [new PageBreak()] }),
        ...t3Blocks,

        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          children: [new TextRun({ text: "Appendix A. Methodological Audit Trail, Team Concordance & Reflexive Synthesis Log", bold: true, font: "Times New Roman", size: 24 })],
          spacing: { after: 140 }
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: appRows })
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

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const rows = [
    ['3rd Order Construct', 'How Studies Relate (from cells)', '3rd Order Concordance', 'CERQual Confidence', 'CERQual Explanation', 'Step A: Translation Summary', 'Step B: 3rd Order Interpretation', 'StudyOrder', 'Study', 'Title', 'Setting', 'Participants', 'Methodology', 'Appraisal Tool', 'Quality Rating', 'Conceptual Depth (Richness)', 'Study Context Note', 'Study Overview / Key Metaphors', 'Funder', 'Same Primary Study As', '2nd Order Reviewer', '2nd Order Summary', '2nd Order Raw Text', '2nd Order Nuance Memo (Private)', '2nd Order Concordance', 'Cluster-Specific Comment', 'Linked 1st Order Quotes', 'Page']
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
      const cellRelation = cid ? cellRelationOf(sec, cid) : '';
      const cellComment = cid && sec.clusterComments ? `[${cellRelation}] ` + (sec.clusterComments[cid] || '') : (cellRelation ? `[${cellRelation}]` : '');
      rows.push([
        cluster ? cluster.thirdOrderTitle : '(Unassigned)',
        cluster ? rowRelationText(cluster) : '',
        cluster ? `${cluster.concordanceStatus}${cluster.concordanceNote ? ': ' + cluster.concordanceNote : ''}` : '',
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
        `${sec.concordanceStatus}${sec.concordanceNote ? ': ' + sec.concordanceNote : ''}`,
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
