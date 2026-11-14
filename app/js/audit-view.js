// Meta-Ethnography Canvas — Audit trail view (Tab 3)
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// Reflexive memos, audit timeline and per-row history.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// VIEW 3: AUDIT TRAIL & REFLEXIVE LOG RENDERER
// ========================================================
document.getElementById('auditFilterCategory').addEventListener('change', () => renderAuditTimeline());
document.getElementById('auditFilterRow').addEventListener('change', () => renderAuditTimeline());

// ---- 3rd Order row history: audit entries carry the id(s) of the row(s) they concern ----
function clusterTitleHistory(cluster) {
  const titles = [];
  const add = t => { t = (t || '').trim(); if (t && !/^\(untitled/i.test(t) && !titles.includes(t)) titles.push(t); };
  state.logs
    .filter(l => l.action === 'Refined 3rd Order Construct Title' && (l.clusterIds || []).includes(cluster.id))
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .forEach(l => { add(l.fromVal); add(l.toVal); });
  add(cluster.thirdOrderTitle);
  return titles;
}

document.getElementById('addMemoBtn').addEventListener('click', async () => {
  const subType = document.getElementById('memoSubType').value;
  const targetRef = document.getElementById('memoTargetRef').value;
  const content = document.getElementById('memoContentInput').value.trim();
  if (!content) return alert('Please enter memo content.');

  const cat = subType === 'Team Concordance Meeting' ? 'concordance' :
              subType === 'GRADE-CERQual Rationale' ? 'cerqual' :
              subType === 'Line of Argument' ? 'line_of_argument' : 'reflexive_memo';

  const refOpt = document.getElementById('memoTargetRef').selectedOptions[0];
  await recordAuditLog({
    category: cat,
    action: `[${subType}] ${targetRef ? '— ' + targetRef : ''}`,
    detail: content,
    clusterIds: refOpt && refOpt.dataset.clusterId ? [refOpt.dataset.clusterId] : null
  });
  document.getElementById('memoContentInput').value = '';
  renderAuditTimeline();
});

function renderAuditView() {
  const refSel = document.getElementById('memoTargetRef');
  const currentVal = refSel.value;
  refSel.innerHTML = '<option value="">General (Whole Synthesis)</option>';
  state.clusters.forEach(c => {
    const opt = document.createElement('option');
    opt.value = `Cluster: ${c.thirdOrderTitle || 'Untitled'}`;
    opt.textContent = `3rd Order: ${c.thirdOrderTitle || '(Untitled Row)'}`;
    opt.dataset.clusterId = c.id;
    refSel.appendChild(opt);
  });
  const rowSel = document.getElementById('auditFilterRow');
  const prevRow = rowSel.value;
  rowSel.innerHTML = '<option value="all">🟣 All 3rd Order rows</option>' + state.clusters.map((c, i) => `<option value="${escapeHtml(c.id)}">#${i + 1} ${escapeHtml(clusterLabel(c))}</option>`).join('');
  rowSel.value = state.clusters.some(c => c.id === prevRow) ? prevRow : 'all';
  state.docs.forEach(d => {
    const opt = document.createElement('option');
    opt.value = `Study: ${getDisplayName(d)}`;
    opt.textContent = `Study: ${getDisplayName(d)}`;
    refSel.appendChild(opt);
  });
  refSel.value = currentVal;

  renderAuditTimeline();
}

function getCategoryMeta(cat) {
  switch (cat) {
    case 'reflexive_memo': return { label: 'Reflexive / Analytic Memo', cls: 'bg-amber-100 text-amber-800 border-amber-300', icon: 'ph-notebook' };
    case 'concordance': return { label: 'Team Concordance', cls: 'bg-teal-100 text-teal-800 border-teal-300', icon: 'ph-users-three' };
    case 'cerqual': return { label: 'GRADE-CERQual', cls: 'bg-cyan-100 text-cyan-900 border-cyan-300', icon: 'ph-chart-bar' };
    case 'appraisal_policy': return { label: 'Appraisal Policy', cls: 'bg-teal-100 text-teal-800 border-teal-300', icon: 'ph-stethoscope' };
    case 'relating_studies': return { label: 'Phase 4: Relating Studies', cls: 'bg-violet-100 text-violet-800 border-violet-300', icon: 'ph-intersect' };
    case 'line_of_argument': return { label: 'Line of Argument', cls: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300', icon: 'ph-graph' };
    case 'third_order': return { label: '3rd Order Evolution', cls: 'bg-purple-100 text-purple-800 border-purple-300', icon: 'ph-sparkle' };
    case 'matrix_mapping': return { label: 'Matrix Mapping', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: 'ph-arrows-split' };
    case 'linking': return { label: '1st ➔ 2nd Order Link', cls: 'bg-blue-100 text-blue-800 border-blue-300', icon: 'ph-link' };
    case 'study_order': return { label: 'Study Order', cls: 'bg-indigo-100 text-indigo-800 border-indigo-300', icon: 'ph-list-numbers' };
    case 'context_appraisal': return { label: 'Context & Appraisal', cls: 'bg-slate-200 text-slate-800 border-slate-300', icon: 'ph-shield-check' };
    case 'reading_extraction': return { label: 'Phase 3: Reading & Extraction', cls: 'bg-sky-100 text-sky-800 border-sky-300', icon: 'ph-book-open' };
    case 'translation_process': return { label: 'Phase 5: Translation', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: 'ph-translate' };
    case 'team_model': return { label: 'Team Models (independent / merged)', cls: 'bg-orange-100 text-orange-800 border-orange-300', icon: 'ph-users' };
    case 'audit_edit': return { label: 'Audit Trail Edit', cls: 'bg-rose-50 text-rose-800 border-rose-200', icon: 'ph-eraser' };
    default: return { label: 'Event', cls: 'bg-slate-100 text-slate-700 border-slate-200', icon: 'ph-clock' };
  }
}

function renderAuditTimeline() {
  const container = document.getElementById('auditTimelineList');
  container.innerHTML = '';
  const filter = document.getElementById('auditFilterCategory').value;
  const rowFilter = document.getElementById('auditFilterRow')?.value || 'all';
  let list = filter === 'all' ? state.logs : state.logs.filter(l => l.category === filter);
  const rowCluster = rowFilter !== 'all' ? state.clusters.find(c => c.id === rowFilter) : null;
  if (rowCluster) {
    const titles = clusterTitleHistory(rowCluster);
    list = list.filter(l => (l.clusterIds || []).includes(rowCluster.id));
    // Oldest first: read the row's evolution top to bottom
    list = [...list].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const head = document.createElement('div');
    head.className = 'p-3 rounded-lg border border-purple-300 bg-purple-50 text-xs text-purple-950 space-y-1';
    head.innerHTML = `<div class="font-bold">🟣 History of 3rd Order row: ${escapeHtml(clusterLabel(rowCluster))} <span class="font-normal text-purple-700">(${list.length} entr${list.length === 1 ? 'y' : 'ies'}, oldest first)</span></div>
      ${titles.length > 1 ? `<div><b>Title evolution:</b> ${titles.map(t => escapeHtml(t)).join(' <span class="text-purple-500">→</span> ')}</div>` : ''}`;
    container.appendChild(head);
  }

  if (list.length === 0) {
    container.insertAdjacentHTML('beforeend', `<div class="text-xs text-slate-400 text-center py-12">${rowCluster ? 'No entries for this row with the current category filter.' : 'No audit trail events recorded yet.'}</div>`);
    return;
  }

  list.forEach(log => {
    const meta = getCategoryMeta(log.category);
    const dateStr = new Date(log.timestamp).toLocaleString();
    const revTag = log.reviewer || 'Unknown';
    const card = document.createElement('div');
    card.className = `p-3.5 rounded-lg border ${log.category === 'reflexive_memo' ? 'bg-amber-50/40 border-amber-200' : 'bg-white border-slate-200'} shadow-sm text-xs space-y-1.5`;

    let diffHtml = '';
    if (log.fromVal || log.toVal) {
      diffHtml = `
        <div class="flex flex-wrap items-center gap-1.5 text-[13px] bg-slate-50 p-2 rounded border border-slate-200/80 mt-1">
          ${log.fromVal ? `<span class="line-through text-slate-400">${escapeHtml(log.fromVal)}</span>` : ''}
          ${log.fromVal && log.toVal ? `<i class="ph ph-arrow-right text-slate-400"></i>` : ''}
          ${log.toVal ? `<span class="font-semibold text-indigo-900 bg-indigo-50 px-1.5 py-0.5 rounded">${escapeHtml(log.toVal)}</span>` : ''}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="text-xs font-bold px-2 py-0.5 rounded border flex items-center space-x-1 ${meta.cls}">
            <i class="ph ${meta.icon}"></i><span>${meta.label}</span>
          </span>
          <button type="button" class="log-rev-btn text-xs font-mono font-bold bg-slate-100 hover:bg-indigo-100 border border-slate-300 text-slate-700 px-1.5 py-0.2 rounded cursor-pointer" title="Click to change reviewer for this log entry">@${escapeHtml(revTag)}</button>
          <span class="font-bold text-slate-800">${escapeHtml(log.action)}</span>
        </div>
        <div class="flex items-center space-x-2">
          <span class="text-xs text-slate-400 font-mono">${escapeHtml(dateStr)}</span>
          <button class="del-log text-slate-300 hover:text-rose-500 cursor-pointer" title="Delete log entry"><i class="ph ph-trash"></i></button>
        </div>
      </div>
      ${log.detail ? `<div class="text-slate-700 leading-relaxed whitespace-pre-wrap">${escapeHtml(log.detail)}</div>` : ''}
      ${diffHtml}
      <div class="pt-1">
        <input type="text" class="rationale-input w-full text-[13px] border border-dashed border-slate-300 rounded px-2 py-1 bg-slate-50/50 focus:bg-white focus:border-indigo-500 focus:outline-none text-slate-700" placeholder="+ Add reason for this decision..." value="${escapeHtml(log.rationale || '')}">
      </div>
    `;

    card.querySelector('.log-rev-btn').onclick = () => promptReassignItemReviewer(log, 'logs', renderAuditTimeline);

    card.querySelector('.rationale-input').onchange = async e => {
      log.rationale = e.target.value.trim();
      await dbPut('logs', log);
    };

    card.querySelector('.del-log').onclick = async () => {
      if (!confirm('Delete this audit trail entry? (You can Undo with Ctrl+Z)')) return;
      pushUndoAction({
        type: 'delete_log',
        label: `Audit Log (${log.action.slice(0, 30)})`,
        log: { ...log }
      });
      await dbDelete('logs', log.id);
      state.logs = state.logs.filter(x => x.id !== log.id);
      // Keep the trail honest: the deletion itself is recorded (with the removed entry's content)
      await recordAuditLog({
        category: 'audit_edit',
        action: `Deleted an audit trail entry: ${log.action}`,
        detail: `Original entry (${new Date(log.timestamp).toLocaleString()}, @${log.reviewer || 'Unknown'}, ${getCategoryMeta(log.category).label})${log.detail ? ':\n' + log.detail : ''}`,
        fromVal: log.fromVal || '',
        toVal: log.toVal || ''
      });
      updateAuditBadge();
      renderAuditTimeline();
    };

    container.appendChild(card);
  });
}
