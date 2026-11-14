// Meta-Ethnography Canvas — Line of argument
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// Research aim & overall model drawer (Phases 1, 3–6 fields), concept relationship map (SVG) and independent team models.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

// ========================================================
// LINE OF ARGUMENT (LoA) DRAWER LOGIC
// ========================================================
const loaDrawer = document.getElementById('loaDrawer');
const loaCaret = document.getElementById('loaCaretIcon');

document.getElementById('toggleLoaDrawerBtn').addEventListener('click', () => {
  state.isLoaOpen = !state.isLoaOpen;
  loaDrawer.classList.toggle('hidden', !state.isLoaOpen);
  loaCaret.className = state.isLoaOpen ? 'ph ph-caret-up text-xs' : 'ph ph-caret-down text-xs';
  if (state.isLoaOpen) renderLoaClusterChips();
});

function insertTextIntoLoaFlow(snippet) {
  const el = document.getElementById('loaFlowInput');
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + snippet + el.value.slice(end);
  el.focus();
  const nextPos = start + snippet.length;
  el.setSelectionRange(nextPos, nextPos);
}

document.querySelectorAll('.loa-op-btn').forEach(btn => {
  btn.addEventListener('click', () => insertTextIntoLoaFlow(btn.dataset.op));
});

const LINK_TYPES = {
  leads: { sym: '➔', label: 'leads to', color: '#6d28d9', dash: '' },
  mutual: { sym: '⇄', label: 'is mutually related to', color: '#0f766e', dash: '' },
  contradicts: { sym: '⚡', label: 'is in tension with', color: '#be123c', dash: '6 4' }
};
function getLoaLinks() {
  const ids = new Set(state.clusters.map(c => c.id));
  return (Array.isArray(state.loa.links) ? state.loa.links : []).filter(l => ids.has(l.from) && ids.has(l.to));
}
function clusterLabel(c) { return (c && c.thirdOrderTitle && c.thirdOrderTitle.trim()) || '(Untitled row)'; }
function getLoaMapLayout() { return state.loa && state.loa.mapLayout === 'flow' ? 'flow' : 'circle'; }
function buildConceptMapSvg(prefix, width, height, layout = getLoaMapLayout()) {
  if (layout === 'flow') return buildFlowMapSvg(prefix);
  const links = getLoaLinks();
  const usedIds = new Set();
  links.forEach(l => { usedIds.add(l.from); usedIds.add(l.to); });
  const nodes = state.clusters.filter(c => usedIds.has(c.id));
  if (nodes.length === 0) return '';
  const cx = width / 2, cy = height / 2;
  const rx = Math.max(60, width / 2 - 110), ry = Math.max(50, height / 2 - 40);
  const pos = {};
  nodes.forEach((c, i) => {
    const label = clusterLabel(c);
    const short = label.length > 26 ? label.slice(0, 25) + '…' : label;
    const ang = nodes.length === 1 ? 0 : (-Math.PI / 2 + (2 * Math.PI * i) / nodes.length);
    const w = Math.min(200, short.length * 6.4 + 18), h = 26;
    pos[c.id] = { x: nodes.length === 1 ? cx : cx + rx * Math.cos(ang), y: nodes.length === 1 ? cy : cy + ry * Math.sin(ang), w, h, short, label };
  });
  const edge = (a, b) => {
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const t = (n) => Math.min(Math.abs(dx) < 1e-6 ? Infinity : (n.w / 2 + 3) / Math.abs(dx), Math.abs(dy) < 1e-6 ? Infinity : (n.h / 2 + 3) / Math.abs(dy));
    return { x1: a.x + dx * t(a), y1: a.y + dy * t(a), x2: b.x - dx * t(b), y2: b.y - dy * t(b) };
  };
  let defs = '', lines = '';
  Object.entries(LINK_TYPES).forEach(([k, v]) => {
    defs += `<marker id="${prefix}-ah-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${v.color}"/></marker>`;
  });
  links.forEach(l => {
    const m = LINK_TYPES[l.type] || LINK_TYPES.leads;
    const e = edge(pos[l.from], pos[l.to]);
    const markers = l.type === 'mutual' ? `marker-start="url(#${prefix}-ah-${l.type})" marker-end="url(#${prefix}-ah-${l.type})"`
                  : l.type === 'contradicts' ? `marker-start="url(#${prefix}-ah-${l.type})" marker-end="url(#${prefix}-ah-${l.type})"`
                  : `marker-end="url(#${prefix}-ah-${l.type})"`;
    lines += `<line x1="${e.x1.toFixed(1)}" y1="${e.y1.toFixed(1)}" x2="${e.x2.toFixed(1)}" y2="${e.y2.toFixed(1)}" stroke="${m.color}" stroke-width="1.8" ${m.dash ? `stroke-dasharray="${m.dash}"` : ''} ${markers}><title>${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.from)))} ${m.label} ${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.to)))}${l.note ? ' — ' + escapeHtml(l.note) : ''}</title></line>`;
  });
  let boxes = '';
  nodes.forEach(c => {
    const p = pos[c.id];
    boxes += `<g><title>${escapeHtml(p.label)}</title><rect x="${(p.x - p.w / 2).toFixed(1)}" y="${(p.y - p.h / 2).toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.h}" rx="6" fill="#ffffff" stroke="#475569" stroke-width="1.2"/><text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-family="Georgia, serif" fill="#0f172a">${escapeHtml(p.short)}</text></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px; height:auto;" role="img" aria-label="Concept relationship map"><defs>${defs}</defs>${lines}${boxes}</svg>`;
}
// Left → right process layout: columns follow "leads to" relations (longest path from the starting constructs);
// "mutually related" and "in tension" relations do not create steps and are drawn as curved links.
function buildFlowMapSvg(prefix) {
  const links = getLoaLinks();
  const usedIds = new Set();
  links.forEach(l => { usedIds.add(l.from); usedIds.add(l.to); });
  const nodes = state.clusters.filter(c => usedIds.has(c.id));
  if (nodes.length === 0) return '';
  const ids = nodes.map(c => c.id);
  const leads = links.filter(l => l.type === 'leads');
  // Drop back-edges (cycles) for ranking only
  const out = {}; ids.forEach(id => out[id] = []);
  const state3 = {}; const forward = new Set();
  leads.forEach(l => out[l.from].push(l));
  const dfs = id => {
    state3[id] = 1;
    out[id].forEach(l => {
      if (state3[l.to] === 1) return;           // back-edge
      forward.add(l.id);
      if (!state3[l.to]) dfs(l.to);
    });
    state3[id] = 2;
  };
  const hasIncoming = new Set(leads.map(l => l.to));
  [...ids.filter(id => !hasIncoming.has(id)), ...ids].forEach(id => { if (!state3[id]) dfs(id); });
  const rank = {}; ids.forEach(id => rank[id] = 0);
  for (let i = 0; i < ids.length; i++) {
    let changed = false;
    leads.filter(l => forward.has(l.id)).forEach(l => { if (rank[l.to] < rank[l.from] + 1) { rank[l.to] = rank[l.from] + 1; changed = true; } });
    if (!changed) break;
  }
  // Constructs joined only by ⇄ / ⚡ sit in the same column as their partner
  const leadNodes = new Set(leads.flatMap(l => [l.from, l.to]));
  links.filter(l => l.type !== 'leads').forEach(l => {
    if (!leadNodes.has(l.from) && leadNodes.has(l.to)) rank[l.from] = rank[l.to];
    else if (!leadNodes.has(l.to) && leadNodes.has(l.from)) rank[l.to] = rank[l.from];
  });
  const nCols = Math.max(...ids.map(id => rank[id])) + 1;
  const cols = Array.from({ length: nCols }, () => []);
  nodes.forEach(c => cols[rank[c.id]].push(c.id));
  // Order within columns by the average position of predecessors (reduces crossings)
  const orderIdx = {};
  cols.forEach((col, ci) => {
    if (ci > 0) {
      const bary = id => {
        const preds = leads.filter(l => l.to === id && orderIdx[l.from] !== undefined).map(l => orderIdx[l.from]);
        return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : 1e3;
      };
      col.sort((a, b) => bary(a) - bary(b));
    }
    col.forEach((id, i) => orderIdx[id] = i);
  });
  const wrap = label => {
    const words = label.split(/\s+/), lines = [''];
    words.forEach(w => {
      const cur = lines[lines.length - 1];
      if ((cur + ' ' + w).trim().length > 22 && cur) lines.push(w); else lines[lines.length - 1] = (cur + ' ' + w).trim();
    });
    if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].slice(0, 20) + '…'; }
    return lines.map(l => l.length > 24 ? l.slice(0, 23) + '…' : l);
  };
  const boxW = 158, colGap = 70, rowGap = 26, padX = 24, padY = 24;
  const pos = {};
  const colHeights = cols.map(col => col.reduce((h, id) => h + (wrap(clusterLabel(state.clusters.find(c => c.id === id))).length * 14 + 14) + rowGap, -rowGap));
  const H = Math.max(160, Math.max(...colHeights) + padY * 2 + 20);
  const W = padX * 2 + nCols * boxW + (nCols - 1) * colGap;
  cols.forEach((col, ci) => {
    let y = (H - colHeights[ci]) / 2;
    col.forEach(id => {
      const label = clusterLabel(state.clusters.find(c => c.id === id));
      const lines = wrap(label);
      const h = lines.length * 14 + 14;
      pos[id] = { x: padX + ci * (boxW + colGap) + boxW / 2, y: y + h / 2, w: boxW, h, lines, label, col: ci };
      y += h + rowGap;
    });
  });
  let defs = '', paths = '';
  Object.entries(LINK_TYPES).forEach(([k, v]) => {
    defs += `<marker id="${prefix}-fl-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${v.color}"/></marker>`;
  });
  links.forEach(l => {
    const m = LINK_TYPES[l.type] || LINK_TYPES.leads;
    const a = pos[l.from], b = pos[l.to];
    let d;
    if (b.col > a.col) {                       // forward step: right edge → left edge
      const x1 = a.x + a.w / 2, x2 = b.x - b.w / 2 - 2, mx = (x1 + x2) / 2;
      d = `M${x1.toFixed(1)},${a.y.toFixed(1)} C${mx.toFixed(1)},${a.y.toFixed(1)} ${mx.toFixed(1)},${b.y.toFixed(1)} ${x2.toFixed(1)},${b.y.toFixed(1)}`;
    } else if (b.col < a.col) {                // feedback loop: arc below the boxes
      const x1 = a.x, x2 = b.x, y1 = a.y + a.h / 2, y2 = b.y + b.h / 2 + 2, low = Math.max(y1, y2) + 34;
      d = `M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${low.toFixed(1)} ${x2.toFixed(1)},${low.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    } else {                                   // same column: loop out to the right so boxes in between are not crossed
      const x1 = a.x + a.w / 2, x2 = b.x + b.w / 2 + 2;
      const cx = x1 + 22 + 10 * Math.abs(orderIdx[l.to] - orderIdx[l.from]);
      d = `M${x1.toFixed(1)},${a.y.toFixed(1)} C${cx.toFixed(1)},${a.y.toFixed(1)} ${cx.toFixed(1)},${b.y.toFixed(1)} ${x2.toFixed(1)},${b.y.toFixed(1)}`;
    }
    const markers = l.type === 'leads' ? `marker-end="url(#${prefix}-fl-${l.type})"` : `marker-start="url(#${prefix}-fl-${l.type})" marker-end="url(#${prefix}-fl-${l.type})"`;
    paths += `<path d="${d}" fill="none" stroke="${m.color}" stroke-width="1.8" ${m.dash ? `stroke-dasharray="${m.dash}"` : ''} ${markers}><title>${escapeHtml(a.label)} ${m.label} ${escapeHtml(b.label)}${l.note ? ' — ' + escapeHtml(l.note) : ''}</title></path>`;
  });
  let boxes = '';
  Object.values(pos).forEach(p => {
    const top = p.y - p.h / 2;
    boxes += `<g><title>${escapeHtml(p.label)}</title><rect x="${(p.x - p.w / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${p.w}" height="${p.h}" rx="6" fill="#ffffff" stroke="#475569" stroke-width="1.2"/>` +
      p.lines.map((ln, i) => `<text x="${p.x.toFixed(1)}" y="${(top + 17 + i * 14).toFixed(1)}" text-anchor="middle" font-size="11" font-family="Georgia, serif" fill="#0f172a">${escapeHtml(ln)}</text>`).join('') + `</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="100%" style="max-width:${W.toFixed(0)}px; height:auto;" role="img" aria-label="Concept relationship map (left to right flow)"><defs>${defs}</defs><rect x="0" y="0" width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#ffffff"/>${paths}${boxes}</svg>`;
}

function downloadConceptMapSvg() {
  let svg = buildConceptMapSvg('dl', 640, 360);
  if (!svg) return alert('Add at least one relation to draw the map first.');
  // Standalone file: fixed pixel size instead of the responsive width, plus a legend line
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const W = vb ? +vb[1] : 640, H = vb ? +vb[2] : 360;
  const legendH = 22;
  svg = svg.replace(/viewBox="0 0 [\d.]+ [\d.]+" width="100%" style="[^"]*"/, `viewBox="0 0 ${W} ${H + legendH}" width="${W}" height="${H + legendH}"`);
  const legend = `<g font-family="Georgia, serif" font-size="10" fill="#334155"><text x="8" y="${H + 15}">${escapeHtml(state.loa.title || 'Line of argument')} — ➔ leads to · ⇄ mutually related · ⚡ (dashed) in tension</text></g>`;
  svg = svg.replace('</svg>', legend + '</svg>');
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const projTag = state.projectCode ? state.projectCode.replace(/[^\w-]+/g, '_') + '_' : '';
  a.href = url;
  a.download = `line_of_argument_map_${projTag}${getLoaMapLayout()}_${new Date().toISOString().slice(0, 10)}.svg`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', async ev => {
  const lb = ev.target && ev.target.closest && ev.target.closest('.loa-layout-btn');
  if (lb) {
    const layout = lb.dataset.layout === 'flow' ? 'flow' : 'circle';
    if (getLoaMapLayout() !== layout) {
      state.loa.mapLayout = layout;
      await dbPut('meta', state.loa);
    }
    renderLoaMap();
    return;
  }
  if (ev.target && ev.target.closest && ev.target.closest('#loaMapSvgBtn')) downloadConceptMapSvg();
});
function renderLoaMap() {
  const from = document.getElementById('loaLinkFrom');
  if (!from) return;
  const to = document.getElementById('loaLinkTo');
  const prevF = from.value, prevT = to.value;
  const opts = state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(clusterLabel(c))}</option>`).join('');
  from.innerHTML = opts; to.innerHTML = opts;
  if (prevF && state.clusters.some(c => c.id === prevF)) from.value = prevF;
  if (prevT && state.clusters.some(c => c.id === prevT)) to.value = prevT;
  else if (state.clusters.length > 1) to.selectedIndex = 1;
  const list = document.getElementById('loaLinkList');
  const links = getLoaLinks();
  list.innerHTML = links.length === 0 ? '<div class="text-purple-400 italic">No relations yet. Pick two rows, a relation, and add.</div>' : '';
  links.forEach(l => {
    const m = LINK_TYPES[l.type] || LINK_TYPES.leads;
    const row = document.createElement('div');
    row.className = 'flex items-start justify-between gap-1 border border-slate-200 rounded px-1.5 py-1 bg-white';
    row.innerHTML = `<div><b>${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.from)))}</b> <span style="color:${m.color}; font-weight:bold;">${m.sym}</span> <b>${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.to)))}</b>${l.note ? `<div class="text-slate-500">${escapeHtml(l.note)}</div>` : ''}</div><button type="button" class="text-slate-400 hover:text-rose-600 cursor-pointer" title="Remove relation">✕</button>`;
    row.querySelector('button').onclick = async () => {
      state.loa.links = (state.loa.links || []).filter(x => x.id !== l.id);
      state.loa.updatedAt = Date.now();
      await dbPut('meta', state.loa);
      await recordAuditLog({
        clusterIds: [l.from, l.to],
        category: 'line_of_argument',
        action: `Removed relation: "${clusterLabel(state.clusters.find(c => c.id === l.from))}" ${m.sym} "${clusterLabel(state.clusters.find(c => c.id === l.to))}"`,
        detail: l.note || ''
      });
      renderLoaMap();
    };
    list.appendChild(row);
  });
  const svg = buildConceptMapSvg('drw', 640, 360);
  document.getElementById('loaMapBox').innerHTML = svg || '<div class="p-6 text-center text-[11px] text-purple-400 italic">The map appears here once you add a relation.</div>';
  const layout = getLoaMapLayout();
  document.querySelectorAll('.loa-layout-btn').forEach(b => {
    const on = b.dataset.layout === layout;
    b.className = `loa-layout-btn px-2 py-0.5 cursor-pointer ${b.dataset.layout === 'flow' ? 'border-l border-purple-200 ' : ''}${on ? 'bg-purple-600 text-white font-semibold' : 'bg-white text-purple-800 hover:bg-purple-50'}`;
  });
  const dlBtn = document.getElementById('loaMapSvgBtn');
  if (dlBtn) dlBtn.disabled = !svg;
}
document.addEventListener('click', async (ev) => {
  if (!ev.target || ev.target.id !== 'loaLinkAddBtn') return;
  const from = document.getElementById('loaLinkFrom').value, to = document.getElementById('loaLinkTo').value;
  const type = document.getElementById('loaLinkType').value;
  const note = document.getElementById('loaLinkNote').value.trim();
  if (!from || !to || from === to) { alert('Choose two different 3rd Order rows.'); return; }
  const dup = (state.loa.links || []).some(l => l.type === type && ((l.from === from && l.to === to) || (type !== 'leads' && l.from === to && l.to === from)));
  if (dup) { alert('This relation already exists.'); return; }
  const link = { id: 'lk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), from, to, type, note };
  state.loa.links = [...(state.loa.links || []), link];
  state.loa.updatedAt = Date.now();
  await dbPut('meta', state.loa);
  const m = LINK_TYPES[type];
  await recordAuditLog({
    clusterIds: [from, to],
    category: 'line_of_argument',
    action: `Added relation: "${clusterLabel(state.clusters.find(c => c.id === from))}" ${m.sym} "${clusterLabel(state.clusters.find(c => c.id === to))}"`,
    detail: `${m.label}${note ? ' — ' + note : ''}`
  });
  document.getElementById('loaLinkNote').value = '';
  renderLoaMap();
});

// ========================================================
// TEAM MODELS: independent models per reviewer, compared and merged (Atkins et al., 2008)
// ========================================================
function snapshotCurrentModel(reviewer, source = 'local') {
  const val = id => (document.getElementById(id)?.value || '').trim();
  // Use what is typed in the drawer (even if not yet saved), falling back to the saved model
  const title = val('loaTitleInput') || state.loa.title || '';
  const flow = val('loaFlowInput') || state.loa.flow || '';
  const narrative = val('loaNarrativeInput') || state.loa.narrative || '';
  return {
    id: 'tm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    reviewer, source, title, flow, narrative,
    links: getLoaLinks().map(l => ({
      from: clusterLabel(state.clusters.find(c => c.id === l.from)),
      to: clusterLabel(state.clusters.find(c => c.id === l.to)),
      type: l.type, note: l.note || ''
    })),
    capturedAt: Date.now()
  };
}
function modelFromPeerLoa(peerLoa, peerClusters, reviewer) {
  const titleOf = id => { const c = (peerClusters || []).find(x => x.id === id); return (c && c.thirdOrderTitle && c.thirdOrderTitle.trim()) || '(Untitled row)'; };
  return {
    id: 'tm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    reviewer, source: 'peer',
    title: peerLoa.title || '', flow: peerLoa.flow || '', narrative: peerLoa.narrative || '',
    links: (Array.isArray(peerLoa.links) ? peerLoa.links : []).map(l => ({ from: titleOf(l.from), to: titleOf(l.to), type: l.type, note: l.note || '' })),
    capturedAt: Date.now()
  };
}
function modelIsEmpty(m) { return !(m.title || m.flow || m.narrative || (m.links && m.links.length)); }
async function addTeamModel(model, how) {
  if (modelIsEmpty(model)) { alert('This model is empty (no title, flow, narrative or relations).'); return false; }
  state.loa.teamModels = [...(Array.isArray(state.loa.teamModels) ? state.loa.teamModels : []), model];
  state.loa.updatedAt = Date.now();
  await dbPut('meta', state.loa);
  await recordAuditLog({
    category: 'team_model',
    action: `Recorded independent model of @${model.reviewer}${model.title ? ': "' + model.title + '"' : ''}`,
    detail: `${how}\n${model.flow ? 'Flow: ' + model.flow + '\n' : ''}${model.links.length ? 'Relations: ' + model.links.map(l => `${l.from} ${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym} ${l.to}`).join('; ') + '\n' : ''}${model.narrative ? 'Narrative: ' + model.narrative : ''}`
  });
  renderTeamModels();
  return true;
}
function teamLinkKey(l) {
  const a = l.from.toLowerCase().trim(), b = l.to.toLowerCase().trim();
  return l.type === 'leads' ? `${a}>${b}>leads` : [a, b].sort().join('~') + '~' + l.type;
}
function renderTeamModels() {
  const box = document.getElementById('teamModelsBox');
  if (!box) return;
  const models = Array.isArray(state.loa.teamModels) ? state.loa.teamModels : [];
  if (models.length === 0) {
    box.innerHTML = '<div class="text-orange-400 italic">No independent models yet. Each reviewer: build a model below, then click "📸 Save current model…". A peer\'s model can be added from Compare → "3rd Order, Model & Logs".</div>';
    return;
  }
  // Relations shared by all models vs held by only some (to focus the merge discussion)
  const counts = {};
  models.forEach(m => new Set((m.links || []).map(teamLinkKey)).forEach(k => { counts[k] = (counts[k] || 0) + 1; }));
  const sharedN = Object.values(counts).filter(n => n === models.length).length;
  const partialN = Object.values(counts).filter(n => n < models.length).length;
  box.innerHTML = `<div class="text-slate-600">${models.length} model(s) from ${new Set(models.map(m => m.reviewer)).size} reviewer(s). Relations in <b>all</b> models: ${sharedN}; in <b>some</b> only: ${partialN} <span class="text-slate-400">(shared = ✓, partial = ◐ below)</span></div>`;
  const grid = document.createElement('div');
  grid.className = 'grid gap-1.5';
  grid.style.gridTemplateColumns = `repeat(${Math.min(models.length, 3)}, minmax(0, 1fr))`;
  models.forEach(m => {
    const card = document.createElement('div');
    card.className = 'border border-orange-200 bg-white rounded p-1.5 space-y-1';
    card.innerHTML = `
      <div class="flex items-center justify-between gap-1">
        <span class="font-bold text-orange-900">@${escapeHtml(m.reviewer)} <span class="font-normal text-slate-400">${m.source === 'peer' ? '(from peer JSON)' : ''} ${escapeHtml(new Date(m.capturedAt).toLocaleDateString())}</span></span>
        <span class="flex items-center gap-1 shrink-0">
          <button type="button" class="tm-adopt text-[10.5px] px-1.5 py-0.5 border border-purple-300 text-purple-800 rounded hover:bg-purple-50 cursor-pointer" title="Copy this model's title / flow / narrative into the working fields below (then edit and Save)">Use as draft</button>
          <button type="button" class="tm-del text-slate-400 hover:text-rose-600 cursor-pointer" title="Remove this model record">✕</button>
        </span>
      </div>
      <div class="font-semibold text-slate-800">${escapeHtml(m.title || '(untitled model)')}</div>
      ${m.flow ? `<div class="font-mono text-[11px] bg-slate-50 border border-slate-200 rounded px-1 py-0.5">${escapeHtml(m.flow)}</div>` : ''}
      ${(m.links || []).length ? `<div class="space-y-0.5">${m.links.map(l => `<div>${counts[teamLinkKey(l)] === models.length ? '✓' : '◐'} ${escapeHtml(l.from)} <b style="color:${(LINK_TYPES[l.type] || LINK_TYPES.leads).color}">${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym}</b> ${escapeHtml(l.to)}</div>`).join('')}</div>` : ''}
      ${m.narrative ? `<details><summary class="cursor-pointer text-slate-500">Narrative</summary><div class="whitespace-pre-wrap text-slate-700">${escapeHtml(m.narrative)}</div></details>` : ''}`;
    card.querySelector('.tm-adopt').onclick = () => {
      const cur = ['loaTitleInput', 'loaFlowInput', 'loaNarrativeInput'].some(id => document.getElementById(id).value.trim());
      if (cur && !confirm('Replace the title / flow / narrative currently in the fields with this model? (Nothing is saved until you click "Save & Log to Trail".)')) return;
      document.getElementById('loaTitleInput').value = m.title || '';
      document.getElementById('loaFlowInput').value = m.flow || '';
      document.getElementById('loaNarrativeInput').value = m.narrative || '';
      showSnackbar(`Loaded @${m.reviewer}'s model as a draft — edit, then Save & Log to Trail.`);
    };
    card.querySelector('.tm-del').onclick = async () => {
      if (!confirm(`Remove @${m.reviewer}'s model record? (The removal is logged.)`)) return;
      state.loa.teamModels = models.filter(x => x.id !== m.id);
      state.loa.updatedAt = Date.now();
      await dbPut('meta', state.loa);
      await recordAuditLog({ category: 'team_model', action: `Removed independent model record of @${m.reviewer}${m.title ? ': "' + m.title + '"' : ''}`, detail: '' });
      renderTeamModels();
    };
    grid.appendChild(card);
  });
  box.appendChild(grid);
}
document.getElementById('saveMyModelBtn')?.addEventListener('click', async () => {
  const m = snapshotCurrentModel(state.reviewerId || 'Reviewer', 'local');
  const ok = await addTeamModel(m, 'Snapshot of the model in the Line of Argument drawer.');
  if (ok) showSnackbar('Saved your current model as an independent model.');
});

function renderLoaClusterChips() {
  renderLoaMap();
  renderTeamModels();
  const chipBox = document.getElementById('loaClusterChips');
  if (!chipBox) return;
  chipBox.innerHTML = '';
  const validClusters = state.clusters.filter(c => c.thirdOrderTitle && c.thirdOrderTitle.trim());
  if (validClusters.length === 0) {
    chipBox.innerHTML = `<span class="text-[11px] text-purple-400 italic">Name your 3rd Order rows below to quick-insert them as chips here.</span>`;
    return;
  }
  validClusters.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'text-[11px] bg-white hover:bg-purple-100 text-purple-900 border border-purple-300 rounded px-1.5 py-0.5 font-semibold cursor-pointer transition shadow-2xs';
    btn.title = 'Click to insert into Conceptual Flow';
    btn.textContent = `+ [${c.thirdOrderTitle.trim()}]`;
    btn.onclick = () => insertTextIntoLoaFlow(`[${c.thirdOrderTitle.trim()}]`);
    chipBox.appendChild(btn);
  });
}

// eMERGe fields added for items 3, 9, 13 and 16: [loa key, input id, audit category]
const LOA_EXTRA_FIELDS = [
  ['reviewQuestion', 'loaQuestionInput', 'line_of_argument'],
  ['readingApproach', 'loaReadingInput', 'reading_extraction'],
  ['extractionScope', 'loaExtractionScopeInput', 'reading_extraction'],
  ['unitsTerminology', 'loaUnitsInput', 'reading_extraction'],
  ['translationDefinitions', 'loaTransDefInput', 'translation_process'],
  ['translationProcess', 'loaTransProcInput', 'translation_process'],
  ['alternativeInterpretations', 'loaAltInterpInput', 'translation_process'],
  ['modelContext', 'loaModelContextInput', 'line_of_argument'],
  ['teamMergeNote', 'loaTeamMergeInput', 'team_model']
];
const LOA_FIELD_LABELS = {
  reviewQuestion: 'Review question (Item 3)', readingApproach: 'Reading & extraction process (Item 9)', extractionScope: 'Extracted from (Item 9)',
  unitsTerminology: 'Units of synthesis (Item 9)', translationDefinitions: 'Working definitions (Item 13)', translationProcess: 'Translation process (Item 13)',
  alternativeInterpretations: 'Alternative interpretations (Items 13/15)', modelContext: 'Context where the model applies (Item 16)',
  teamMergeNote: 'How independent models were merged'
};

function populateLoaInputs() {
  document.getElementById('loaAimInput').value = state.loa.aim || '';
  document.getElementById('loaTitleInput').value = state.loa.title || '';
  document.getElementById('loaFlowInput').value = state.loa.flow || '';
  document.getElementById('loaNarrativeInput').value = state.loa.narrative || '';
  document.getElementById('loaRelateProcessInput').value = state.loa.relateProcess || '';
  document.getElementById('loaRelateOutcomeInput').value = state.loa.relateOutcome || '';
  document.getElementById('loaSynthStudiesInput').value = state.loa.synthStudies || '';
  document.getElementById('loaAppraisalPolicyInput').value = state.loa.appraisalPolicy || '';
  document.getElementById('loaAppraisalUseInput').value = state.loa.appraisalUse || '';
  LOA_EXTRA_FIELDS.forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.value = state.loa[k] || ''; });
  const ordSel = document.getElementById('orderStrategySelect');
  if (ordSel) ordSel.value = getOrderStrategy();
  if (state.loa.updatedAt) {
    document.getElementById('loaSavedStatus').textContent = 'Last saved: ' + new Date(state.loa.updatedAt).toLocaleTimeString();
  }
  renderLoaClusterChips();
}

document.getElementById('saveLoaBtn').addEventListener('click', async () => {
  const ids = { aim: 'loaAimInput', title: 'loaTitleInput', flow: 'loaFlowInput', narrative: 'loaNarrativeInput', relateProcess: 'loaRelateProcessInput', relateOutcome: 'loaRelateOutcomeInput', synthStudies: 'loaSynthStudiesInput', appraisalPolicy: 'loaAppraisalPolicyInput', appraisalUse: 'loaAppraisalUseInput' };
  LOA_EXTRA_FIELDS.forEach(([k, id]) => { ids[k] = id; });
  const oldV = {}, newV = {};
  Object.keys(ids).forEach(k => { oldV[k] = state.loa[k] || ''; newV[k] = (document.getElementById(ids[k])?.value || '').trim(); });
  const loaChanged = ['aim', 'title', 'flow', 'narrative', 'synthStudies'].some(k => oldV[k] !== newV[k]);
  const relChanged = ['relateProcess', 'relateOutcome'].some(k => oldV[k] !== newV[k]);
  const apprChanged = ['appraisalPolicy', 'appraisalUse'].some(k => oldV[k] !== newV[k]);
  const extraChanged = LOA_EXTRA_FIELDS.filter(([k]) => oldV[k] !== newV[k]);

  if (!loaChanged && !relChanged && !apprChanged && extraChanged.length === 0) {
    alert('No changes in Aim / Phase 4 / Line of Argument to save.');
    return;
  }

  state.loa = { ...state.loa, id: 'loa_main', projectCode: state.projectCode || '', ...newV, updatedAt: Date.now() };
  await dbPut('meta', state.loa);
  populateLoaInputs();
  updateHeaderProjectUI();

  if (loaChanged) {
    await recordAuditLog({
      category: 'line_of_argument',
      action: `Updated Review Aim / Line of Argument Synthesis${newV.title ? ': "' + newV.title + '"' : ''}`,
      detail: `${newV.aim ? 'Aim: ' + newV.aim + '\n' : ''}${newV.flow ? 'Model Flow: ' + newV.flow + '\n' : ''}${newV.synthStudies ? 'Studies synthesized: ' + newV.synthStudies + '\n' : ''}${newV.narrative ? 'Narrative: ' + newV.narrative : ''}`,
      fromVal: oldV.title || oldV.flow || oldV.narrative ? `${oldV.title || '(Untitled)'} — ${(oldV.narrative || oldV.flow).slice(0, 70)}...` : '(Initial Draft)',
      toVal: `${newV.title || '(Untitled)'} — ${(newV.narrative || newV.flow).slice(0, 70)}...`
    });
  }
  if (apprChanged) {
    await recordAuditLog({
      category: 'appraisal_policy',
      action: 'Updated Quality Appraisal Policy / Use',
      detail: `${newV.appraisalPolicy ? 'Policy: ' + newV.appraisalPolicy + '\n' : ''}${newV.appraisalUse ? 'Use: ' + newV.appraisalUse : ''}`,
      fromVal: (oldV.appraisalPolicy || oldV.appraisalUse) ? `${(oldV.appraisalPolicy || oldV.appraisalUse).slice(0, 70)}...` : '(Initial Draft)',
      toVal: `${(newV.appraisalPolicy || newV.appraisalUse || '(cleared)').slice(0, 70)}...`
    });
  }
  // One audit entry per eMERGe section that changed (items 3/16, 9, 13)
  const byCat = {};
  extraChanged.forEach(([k, , cat]) => { (byCat[cat] = byCat[cat] || []).push(k); });
  for (const cat of Object.keys(byCat)) {
    const keys = byCat[cat];
    await recordAuditLog({
      category: cat,
      action: `Updated ${keys.map(k => LOA_FIELD_LABELS[k]).join(' / ')}`,
      detail: keys.map(k => `${LOA_FIELD_LABELS[k]}: ${newV[k] || '(cleared)'}`).join('\n'),
      fromVal: keys.map(k => oldV[k]).filter(Boolean).join(' | ').slice(0, 90) || '(Initial Draft)',
      toVal: keys.map(k => newV[k]).filter(Boolean).join(' | ').slice(0, 90) || '(cleared)'
    });
  }
  if (relChanged) {
    await recordAuditLog({
      category: 'relating_studies',
      action: 'Updated Phase 4: Process / Outcome of Relating Studies (eMERGe items 11–12)',
      detail: `${newV.relateProcess ? 'Process: ' + newV.relateProcess + '\n' : ''}${newV.relateOutcome ? 'Outcome: ' + newV.relateOutcome : ''}`,
      fromVal: (oldV.relateProcess || oldV.relateOutcome) ? `${(oldV.relateProcess || oldV.relateOutcome).slice(0, 70)}...` : '(Initial Draft)',
      toVal: `${(newV.relateProcess || newV.relateOutcome).slice(0, 70)}...`
    });
  }
});
