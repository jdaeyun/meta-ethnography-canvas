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
  if (state.isLoaOpen && typeof commitLoaDrawer === 'function') commitLoaDrawer(); // closing the drawer saves what was typed
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
  // A value set from script fires no 'input': without this the drawer would not know it changed (and would not save it)
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// The map (state.loa.links) is the structured record; the text sketch can be written from it, then extended by hand
function flowTextFromMap() {
  const label = id => `[${clusterLabel(state.clusters.find(c => c.id === id))}]`;
  return getLoaLinks().map(l => `${label(l.from)} ${(LINK_TYPES[l.type] || LINK_TYPES.leads).sym} ${label(l.to)}`).join('\n');
}
document.getElementById('loaFlowFromMapBtn').addEventListener('click', async () => {
  const el = document.getElementById('loaFlowInput');
  const text = flowTextFromMap();
  if (!text) { showSnackbar('The map has no relations yet: add them under Concept relationship map first.'); return; }
  let next = text;
  if (el.value.trim()) {
    const how = await askChoice({
      title: 'Write the sketch from the map',
      body: 'The sketch already has text.',
      choices: [
        { value: 'add', tone: 'primary', label: 'Add the map\'s relations below it', hint: 'Keeps what you wrote.' },
        { value: 'replace', tone: 'danger', label: 'Replace it with the map\'s relations', hint: 'What is there now is removed from the field (the last saved version stays in the Audit Trail).' }
      ]
    });
    if (!how) return;
    next = how === 'add' ? el.value.replace(/\s+$/, '') + '\n' + text : text;
  }
  el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  showSnackbar('Written from the map. Saved when you leave the drawer.');
});

document.querySelectorAll('.loa-op-btn').forEach(btn => {
  btn.addEventListener('click', () => insertTextIntoLoaFlow(btn.dataset.op));
});

const LINK_TYPES = {
  leads: { sym: '➔', label: 'leads to', color: '#6d28d9', dash: '' },
  mutual: { sym: '⇄', label: 'is mutually related to', color: '#0f766e', dash: '' },
  contradicts: { sym: '⚡', label: 'is in tension with', color: '#be123c', dash: '6 4' },
  encompasses: { sym: '⊃', label: 'encompasses', color: '#b45309', dash: '' },
  metaphor: { sym: '≈', label: 'is understood through the metaphor of', color: '#0369a1', dash: '2 3' }
};
function getLoaLinks() {
  const ids = new Set(state.clusters.map(c => c.id));
  return (Array.isArray(state.loa.links) ? state.loa.links : []).filter(l => ids.has(l.from) && ids.has(l.to));
}
function clusterLabel(c) { return (c && c.thirdOrderTitle && c.thirdOrderTitle.trim()) || '(Untitled row)'; }
function getLoaMapLayout() { return state.loa && state.loa.mapLayout === 'flow' ? 'flow' : 'circle'; }
// Where the reviewer has dragged the boxes (optional, one set per layout, in map units):
// state.loa.mapPositions = { circle: { rowId: { x, y } }, flow: { ... } }. A box without one keeps its computed place;
// the downloaded .svg uses the same places. "Reset layout" removes the set of the current layout.
function savedMapPos(layout, id) {
  const m = state.loa && state.loa.mapPositions && state.loa.mapPositions[layout];
  const p = m && typeof m === 'object' && Object.prototype.hasOwnProperty.call(m, id) ? m[id] : null;
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}
function hasSavedMapPositions(layout = getLoaMapLayout()) {
  return getLoaLinks().some(l => savedMapPos(layout, l.from) || savedMapPos(layout, l.to));
}
// The attributes that make a box of the drawer's map movable (by pointer, or by Tab + arrow keys); none in the download
function mapNodeAttrs(prefix, id, label) {
  if (prefix !== 'drw') return '';
  return ` class="loa-map-node" data-node="${escapeHtml(id)}" tabindex="0" role="button" aria-label="${escapeHtml(label)}: drag, or use the arrow keys, to move" style="cursor:move; touch-action:none;"`;
}
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
    const sp = savedMapPos('circle', c.id); // moved by the reviewer: kept inside the map
    if (sp) { pos[c.id].x = Math.min(width - w / 2 - 2, Math.max(w / 2 + 2, sp.x)); pos[c.id].y = Math.min(height - h / 2 - 2, Math.max(h / 2 + 2, sp.y)); }
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
  const offsets = linkPairOffsets(links);
  links.forEach(l => {
    const m = LINK_TYPES[l.type] || LINK_TYPES.leads;
    const e = edge(pos[l.from], pos[l.to]);
    const markers = isDirectedLink(l.type) ? `marker-end="url(#${prefix}-ah-${l.type})"`
                  : `marker-start="url(#${prefix}-ah-${l.type})" marker-end="url(#${prefix}-ah-${l.type})"`;
    const title = `<title>${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.from)))} ${m.label} ${escapeHtml(clusterLabel(state.clusters.find(c => c.id === l.to)))}${l.note ? ' — ' + escapeHtml(l.note) : ''}</title>`;
    const style = `fill="none" stroke="${m.color}" stroke-width="1.8" ${m.dash ? `stroke-dasharray="${m.dash}"` : ''} ${markers}`;
    const o = offsets[l.id] || 0;
    if (!o) { lines += `<line x1="${e.x1.toFixed(1)}" y1="${e.y1.toFixed(1)}" x2="${e.x2.toFixed(1)}" y2="${e.y2.toFixed(1)}" ${style}>${title}</line>`; return; }
    // A curve bowed to one side of the straight line, by the offset of this relation in its pair
    const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2, len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1) || 1;
    const nx = -(e.y2 - e.y1) / len, ny = (e.x2 - e.x1) / len;
    const qx = mx + nx * o * 2, qy = my + ny * o * 2;
    lines += `<path d="M${e.x1.toFixed(1)},${e.y1.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${e.x2.toFixed(1)},${e.y2.toFixed(1)}" ${style}>${title}</path>`;
  });
  let boxes = '';
  nodes.forEach(c => {
    const p = pos[c.id];
    boxes += `<g${mapNodeAttrs(prefix, c.id, p.label)}><title>${escapeHtml(p.label)}</title><rect x="${(p.x - p.w / 2).toFixed(1)}" y="${(p.y - p.h / 2).toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.h}" rx="6" fill="#ffffff" stroke="#475569" stroke-width="1.2"/><text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-family="Georgia, serif" fill="#0f172a">${escapeHtml(p.short)}</text></g>`;
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
  const { rank, leads } = flowColumnRanks(ids, links);
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
  let H = Math.max(160, Math.max(...colHeights) + padY * 2 + 20);
  // Parallel relations of one pair part by these offsets. pairOff is measured along the link's own direction (for curves that
  // bend to one side of it); sideOff is the same spread independent of direction (for loops that always go one way)
  const flowOffsets = linkPairOffsets(links, 16);
  const sideOff = l => (flowOffsets[l.id] || 0) * ([l.from, l.to].sort()[0] === l.from ? 1 : -1);
  // Same-column relations loop out to the right of their column (see below): leave room for the loops of the last column
  const loopReach = l => 0.75 * (22 + 10 * Math.abs((orderIdx[l.to] || 0) - (orderIdx[l.from] || 0)) + Math.max(0, sideOff(l))) + 10;
  const lastColLoop = Math.max(0, ...links.filter(l => rank[l.from] === nCols - 1 && rank[l.to] === nCols - 1).map(loopReach));
  let W = padX * 2 + nCols * boxW + (nCols - 1) * colGap + Math.max(0, lastColLoop - padX);
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
  H += Math.max(0, ...links.map(sideOff)) * 0.75; // room below for the outer one of nested feedback loops
  // Boxes the reviewer moved keep their place (never off the top or left edge); the map grows to hold them and their links
  const moved = new Set();
  Object.entries(pos).forEach(([id, p]) => {
    const sp = savedMapPos('flow', id);
    if (!sp) return;
    p.x = Math.max(p.w / 2 + 4, sp.x); p.y = Math.max(p.h / 2 + 4, sp.y); moved.add(id);
  });
  if (moved.size) {
    W = Math.max(W, ...Object.values(pos).map(p => p.x + p.w / 2 + 70));
    H = Math.max(H, ...Object.values(pos).map(p => p.y + p.h / 2 + 50));
  }
  let defs = '', paths = '';
  Object.entries(LINK_TYPES).forEach(([k, v]) => {
    defs += `<marker id="${prefix}-fl-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${v.color}"/></marker>`;
  });
  links.forEach(l => {
    const m = LINK_TYPES[l.type] || LINK_TYPES.leads;
    const a = pos[l.from], b = pos[l.to];
    let d;
    const po = flowOffsets[l.id] || 0, so = sideOff(l); // parallel relations of one pair: their curves part by this much
    // Read from where the boxes are, so a moved box is joined the same way as one in its column
    const ahead = b.x - b.w / 2 >= a.x + a.w / 2 + 10, behind = b.x + b.w / 2 <= a.x - a.w / 2 - 10;
    if (ahead) {                               // forward step: right edge → left edge
      const x1 = a.x + a.w / 2, x2 = b.x - b.w / 2 - 2, mx = (x1 + x2) / 2;
      d = `M${x1.toFixed(1)},${(a.y + po / 3).toFixed(1)} C${mx.toFixed(1)},${(a.y + po).toFixed(1)} ${mx.toFixed(1)},${(b.y + po).toFixed(1)} ${x2.toFixed(1)},${(b.y + po / 3).toFixed(1)}`;
    } else if (behind) {                       // feedback loop: arc below the boxes (parallel ones nested)
      const x1 = a.x + so, x2 = b.x + so, y1 = a.y + a.h / 2, y2 = b.y + b.h / 2 + 2, low = Math.max(y1, y2) + 34 + so;
      d = `M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${low.toFixed(1)} ${x2.toFixed(1)},${low.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    } else {                                   // same column: loop out to the right so boxes in between are not crossed
      const x1 = a.x + a.w / 2, x2 = b.x + b.w / 2 + 2;
      const apart = moved.has(l.from) || moved.has(l.to) ? Math.round(Math.abs(b.y - a.y) / 50) : Math.abs(orderIdx[l.to] - orderIdx[l.from]);
      const cx = Math.max(x1, x2) + Math.max(10, 22 + 10 * apart + so); // parallel loops nested
      const ya = a.y + so / 4, yb = b.y + so / 4;
      d = `M${x1.toFixed(1)},${ya.toFixed(1)} C${cx.toFixed(1)},${ya.toFixed(1)} ${cx.toFixed(1)},${yb.toFixed(1)} ${x2.toFixed(1)},${yb.toFixed(1)}`;
    }
    const markers = isDirectedLink(l.type) ? `marker-end="url(#${prefix}-fl-${l.type})"` : `marker-start="url(#${prefix}-fl-${l.type})" marker-end="url(#${prefix}-fl-${l.type})"`;
    paths += `<path d="${d}" fill="none" stroke="${m.color}" stroke-width="1.8" ${m.dash ? `stroke-dasharray="${m.dash}"` : ''} ${markers}><title>${escapeHtml(a.label)} ${m.label} ${escapeHtml(b.label)}${l.note ? ' — ' + escapeHtml(l.note) : ''}</title></path>`;
  });
  let boxes = '';
  Object.entries(pos).forEach(([id, p]) => {
    const top = p.y - p.h / 2;
    boxes += `<g${mapNodeAttrs(prefix, id, p.label)}><title>${escapeHtml(p.label)}</title><rect x="${(p.x - p.w / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${p.w}" height="${p.h}" rx="6" fill="#ffffff" stroke="#475569" stroke-width="1.2"/>` +
      p.lines.map((ln, i) => `<text x="${p.x.toFixed(1)}" y="${(top + 17 + i * 14).toFixed(1)}" text-anchor="middle" font-size="11" font-family="Georgia, serif" fill="#0f172a">${escapeHtml(ln)}</text>`).join('') + `</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="100%" style="max-width:${W.toFixed(0)}px; height:auto;" role="img" aria-label="Concept relationship map (left to right flow)"><defs>${defs}</defs><rect x="0" y="0" width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#ffffff"/>${paths}${boxes}</svg>`;
}

function downloadConceptMapSvg() {
  let svg = buildConceptMapSvg('dl', 640, 360);
  if (!svg) { showSnackbar('Add at least one relation to draw the map first.'); return; }
  // Standalone file: fixed pixel size instead of the responsive width, plus a legend line
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const W = vb ? +vb[1] : 640, H = vb ? +vb[2] : 360;
  const legendH = 22;
  svg = svg.replace(/viewBox="0 0 [\d.]+ [\d.]+" width="100%" style="[^"]*"/, `viewBox="0 0 ${W} ${H + legendH}" width="${W}" height="${H + legendH}"`);
  const legend = `<g font-family="Georgia, serif" font-size="10" fill="#334155"><text x="8" y="${H + 15}">${escapeHtml(state.loa.title || 'Line of argument')} — ${[...new Set(getLoaLinks().map(l => l.type))].map(t => (LINK_TYPES[t] || LINK_TYPES.leads)).map(m => m.sym + ' ' + m.label).join(' · ')}</text></g>`;
  svg = svg.replace('</svg>', legend + '</svg>');
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const projTag = fileNamePart(state.projectCode) ? fileNamePart(state.projectCode) + '_' : '';
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
  if (ev.target && ev.target.closest && ev.target.closest('#loaMapResetBtn')) resetLoaMapLayout();
});
// ◇ cells of the matrix (a study addresses a different aspect of the topic): the material of a line of argument
// (Noblit & Hare). The reviewer ticks the ones the line of argument draws on; only those are reported as used.
function getOtherAspectCells() {
  const out = [];
  state.clusters.forEach(c => state.docs.forEach(d => {
    const v = c.cellStatus && c.cellStatus[d.id];
    if (v && v.status === 'other_aspect') out.push({ cluster: c, doc: d, note: v.note || '', used: !!v.usedInLoa });
    // A card placed in the row and judged "Different aspect"
    state.annotations.filter(a => a.type === 'second_order' && a.docId === d.id && (a.clusterIds || []).includes(c.id) && secRelation(a, c.id) === 'other_aspect')
      .forEach(a => out.push({ cluster: c, doc: d, sec: a, note: [a.note, (a.clusterComments || {})[c.id]].filter(Boolean).join(': '), used: !!(a.aspectUsedInLoa && a.aspectUsedInLoa[c.id]) }));
  }));
  return out;
}
function renderLoaAspects() {
  const box = document.getElementById('loaAspectList');
  if (!box) return;
  const cells = getOtherAspectCells();
  if (!cells.length) {
    box.innerHTML = '<div class="text-slate-500 italic">No ◇ yet. In Tab 2, judge a placed card <b>◇ Different aspect</b> when it speaks to another part of the phenomenon rather than agreeing or contrasting with the row, or choose <b>◇ Addresses a different aspect of the topic</b> in an empty cell (with a note); both are listed here.</div>';
    return;
  }
  box.innerHTML = cells.map((x, i) => `<label class="flex items-start gap-1.5 cursor-pointer">
      <input type="checkbox" class="loa-aspect-use mt-0.5 cursor-pointer" data-i="${i}" ${x.used ? 'checked' : ''} title="The line of argument draws on this">
      <span><b>◇ ${escapeHtml(getDisplayName(x.doc))}</b> — ${x.sec ? 'placed in row' : 'beside row'} <button type="button" class="loa-aspect-jump font-semibold text-sky-800 hover:underline cursor-pointer" data-cid="${escapeHtml(x.cluster.id)}">${escapeHtml(clusterLabel(x.cluster))}</button>${x.note ? `: <span class="text-slate-700">${escapeHtml(x.note)}</span>` : ' <span class="text-slate-400 italic">(no note)</span>'}</span>
    </label>`).join('');
  box.querySelectorAll('.loa-aspect-use').forEach(cb => cb.onchange = async () => {
    const x = cells[+cb.dataset.i];
    if (x.sec) {
      if (secRelation(x.sec, x.cluster.id) !== 'other_aspect') { renderLoaAspects(); return; }
      x.sec.aspectUsedInLoa = { ...(x.sec.aspectUsedInLoa || {}) };
      if (cb.checked) x.sec.aspectUsedInLoa[x.cluster.id] = true; else delete x.sec.aspectUsedInLoa[x.cluster.id];
      await dbPut('annotations', x.sec);
    } else {
      const v = x.cluster.cellStatus && x.cluster.cellStatus[x.doc.id];
      if (!v || v.status !== 'other_aspect') { renderLoaAspects(); return; }
      if (cb.checked) v.usedInLoa = true; else delete v.usedInLoa;
      await dbPut('clusters', x.cluster);
    }
    await recordAuditLog({
      clusterIds: [x.cluster.id],
      category: 'line_of_argument',
      // (a card placed in the row and judged ◇, or an empty cell marked ◇ beside it)
      action: cb.checked ? `Line of argument draws on a different aspect: ${getDisplayName(x.doc)} (${x.sec ? 'in' : 'beside'} "${clusterLabel(x.cluster)}")`
        : `Line of argument no longer draws on: ${getDisplayName(x.doc)} (${x.sec ? 'in' : 'beside'} "${clusterLabel(x.cluster)}")`,
      detail: x.note,
      fromVal: cb.checked ? 'Not used' : 'Used in the line of argument',
      toVal: cb.checked ? 'Used in the line of argument' : 'Not used'
    });
  });
  box.querySelectorAll('.loa-aspect-jump').forEach(btn => btn.onclick = e => {
    e.preventDefault();
    const tr = document.querySelector(`#matrixTable tr[data-cluster-id="${CSS.escape(btn.dataset.cid)}"]`);
    if (tr) { tr.scrollIntoView({ block: 'start', behavior: 'smooth' }); tr.classList.add('drag-over'); setTimeout(() => tr.classList.remove('drag-over'), 1500); }
  });
}
function renderLoaMap() {
  renderLoaAspects();
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
  const svg = drawLoaMapBox();
  const layout = getLoaMapLayout();
  document.querySelectorAll('.loa-layout-btn').forEach(b => {
    const on = b.dataset.layout === layout;
    b.className = `loa-layout-btn px-2 py-0.5 cursor-pointer ${b.dataset.layout === 'flow' ? 'border-l border-purple-200 ' : ''}${on ? 'bg-purple-600 text-white font-semibold' : 'bg-white text-purple-800 hover:bg-purple-50'}`;
  });
  const dlBtn = document.getElementById('loaMapSvgBtn');
  if (dlBtn) dlBtn.disabled = !svg;
}
// Only the drawing (while a box is dragged, the rest of the drawer stays as it is)
function drawLoaMapBox() {
  const box = document.getElementById('loaMapBox');
  if (!box) return '';
  const svg = buildConceptMapSvg('drw', 640, 360);
  box.innerHTML = svg || '<div class="p-6 text-center text-[11px] text-purple-400 italic">The map appears here once you add a relation.</div>';
  const resetBtn = document.getElementById('loaMapResetBtn');
  if (resetBtn) resetBtn.disabled = !svg || !hasSavedMapPositions();
  return svg;
}
// Moving the boxes: the places are layout, not interpretation (no audit entry), but each move can be undone with Ctrl+Z
function mapPositionsCopy(layout) {
  const m = state.loa.mapPositions && state.loa.mapPositions[layout];
  return m && typeof m === 'object' ? JSON.parse(JSON.stringify(m)) : null;
}
function setMapPos(layout, id, x, y) {
  state.loa.mapPositions = { ...(state.loa.mapPositions || {}) };
  state.loa.mapPositions[layout] = { ...(state.loa.mapPositions[layout] || {}), [id]: { x: Math.round(x), y: Math.round(y) } };
}
async function saveMapPositions(layout, before, label) {
  // Only boxes still in the map keep a place
  const inMap = new Set(getLoaLinks().flatMap(l => [l.from, l.to]));
  const m = state.loa.mapPositions && state.loa.mapPositions[layout];
  if (m) Object.keys(m).forEach(id => { if (!inMap.has(id)) delete m[id]; });
  await dbPut('meta', state.loa);
  pushUndoAction({ type: 'map_layout', layout, before, label });
  const resetBtn = document.getElementById('loaMapResetBtn');
  if (resetBtn) resetBtn.disabled = !hasSavedMapPositions();
}
function mapNodeCenter(g) {
  const r = g.querySelector('rect');
  return { x: +r.getAttribute('x') + +r.getAttribute('width') / 2, y: +r.getAttribute('y') + +r.getAttribute('height') / 2 };
}
(function bindLoaMapMoves() {
  const box = document.getElementById('loaMapBox');
  if (!box) return;
  const toSvg = ev => {
    const svg = box.querySelector('svg'), m = svg && svg.getScreenCTM();
    return m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()) : null;
  };
  let drag = null, frame = 0;
  box.addEventListener('pointerdown', ev => {
    const g = ev.button === 0 && ev.target.closest && ev.target.closest('.loa-map-node');
    const p = g && toSvg(ev);
    if (!p) return;
    const c = mapNodeCenter(g), layout = getLoaMapLayout();
    drag = { id: g.dataset.node, layout, dx: p.x - c.x, dy: p.y - c.y, sx: ev.clientX, sy: ev.clientY, moved: false, before: mapPositionsCopy(layout) };
    box.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  box.addEventListener('pointermove', ev => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 3) return;
    drag.moved = true;
    const p = toSvg(ev);
    if (!p) return;
    setMapPos(drag.layout, drag.id, p.x - drag.dx, p.y - drag.dy);
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; drawLoaMapBox(); });
  });
  const end = async () => {
    const d = drag; drag = null;
    if (!d || !d.moved) return;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    drawLoaMapBox();
    await saveMapPositions(d.layout, d.before, 'Moved a box in the map');
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  // Keyboard: Tab to a box, arrow keys move it (Shift: in small steps); a series of presses is one move
  let keyMove = null;
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  box.addEventListener('keydown', ev => {
    const g = ev.target.closest && ev.target.closest('.loa-map-node');
    const dir = ARROWS[ev.key];
    if (!g || !dir) return;
    ev.preventDefault();
    const layout = getLoaMapLayout(), id = g.dataset.node, step = ev.shiftKey ? 2 : 10, c = mapNodeCenter(g);
    if (!keyMove || keyMove.layout !== layout) keyMove = { layout, before: mapPositionsCopy(layout) };
    setMapPos(layout, id, c.x + dir[0] * step, c.y + dir[1] * step);
    drawLoaMapBox();
    box.querySelector(`.loa-map-node[data-node="${CSS.escape(id)}"]`)?.focus();
    clearTimeout(keyMove.timer);
    const km = keyMove;
    // Saved 600 ms after the last press, or at once on a tab switch / page leave (registered like any pending save)
    if (!km.save) km.save = () => {
      clearTimeout(km.timer);
      pendingSaveCleanups.delete(km.save);
      if (keyMove === km) keyMove = null;
      return saveMapPositions(km.layout, km.before, 'Moved a box in the map');
    };
    pendingSaveCleanups.add(km.save);
    km.timer = setTimeout(km.save, 600);
  });
})();
async function resetLoaMapLayout() {
  const layout = getLoaMapLayout();
  const before = mapPositionsCopy(layout);
  if (!before) return;
  state.loa.mapPositions = { ...(state.loa.mapPositions || {}) };
  delete state.loa.mapPositions[layout];
  await dbPut('meta', state.loa);
  pushUndoAction({ type: 'map_layout', layout, before, label: 'Reset the map layout' });
  drawLoaMapBox();
  showUndoSnackbar('The boxes are back in their computed places');
}
document.addEventListener('click', async (ev) => {
  if (!ev.target || ev.target.id !== 'loaLinkAddBtn') return;
  const from = document.getElementById('loaLinkFrom').value, to = document.getElementById('loaLinkTo').value;
  const type = document.getElementById('loaLinkType').value;
  const note = document.getElementById('loaLinkNote').value.trim();
  if (!from || !to || from === to) { showSnackbar('Choose two different 3rd Order rows.'); return; }
  const dup = (state.loa.links || []).some(l => l.type === type && ((l.from === from && l.to === to) || (!isDirectedLink(type) && l.from === to && l.to === from)));
  if (dup) { showSnackbar('This relation already exists.'); return; }
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
  if (modelIsEmpty(model)) { showSnackbar('This model is empty (no title, sketch, narrative or relations).'); return false; }
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
  return isDirectedLink(l.type) ? `${a}>${b}>${l.type}` : [a, b].sort().join('~') + '~' + l.type;
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
    card.querySelector('.tm-adopt').onclick = async () => {
      const cur = ['loaTitleInput', 'loaFlowInput', 'loaNarrativeInput'].some(id => document.getElementById(id).value.trim());
      if (cur && !(await askChoice({
        title: `Load @${m.reviewer}'s model as a draft?`,
        body: 'The title, text sketch and narrative now in the fields are replaced. They are saved (and logged) when you leave the drawer.',
        choices: [{ value: 'load', tone: 'primary', label: 'Replace the fields with this model' }]
      }))) return;
      document.getElementById('loaTitleInput').value = m.title || '';
      document.getElementById('loaFlowInput').value = m.flow || '';
      document.getElementById('loaNarrativeInput').value = m.narrative || '';
      markLoaDrawerDirty();
      showSnackbar(`Loaded @${m.reviewer}'s model as a draft. It is saved when you leave the drawer.`);
    };
    card.querySelector('.tm-del').onclick = async () => {
      if (!(await askChoice({ title: `Remove @${m.reviewer}'s model record?`, body: 'The removal is recorded in the Audit Trail; it cannot be undone with Ctrl+Z.', choices: [{ value: 'remove', tone: 'danger', label: 'Remove the model record' }] }))) return;
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
  // Everything below lives in the drawer, which renders it again when it opens: nothing to redraw while it is closed
  if (!state.isLoaOpen) return;
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

// The drawer holds what is thought out during the analysis (saved together: see commitLoaDrawer).
// [loa key, input id, audit category]
const LOA_EXTRA_FIELDS = [
  ['alternativeInterpretations', 'loaAltInterpInput', 'translation_process'],
  ['modelContext', 'loaModelContextInput', 'line_of_argument'],
  ['teamMergeNote', 'loaTeamMergeInput', 'team_model']
];
// The fields that describe the method for the write-up live in Tab 4, beside the Methods Summary. Each is saved,
// with one audit entry, when the reviewer leaves it (bindPendingCommit). Same project fields as before (state.loa).
const WRITEUP_FIELDS = [
  ['reviewQuestion', 'loaQuestionInput', 'aim_question'],
  ['readingApproach', 'loaReadingInput', 'reading_extraction'],
  ['extractionScope', 'loaExtractionScopeInput', 'reading_extraction'],
  ['unitsTerminology', 'loaUnitsInput', 'reading_extraction'],
  ['appraisalPolicy', 'loaAppraisalPolicyInput', 'appraisal_policy'],
  ['appraisalUse', 'loaAppraisalUseInput', 'appraisal_policy'],
  ['relateProcess', 'loaRelateProcessInput', 'relating_studies'],
  ['translationDefinitions', 'loaTransDefInput', 'translation_process'],
  ['translationProcess', 'loaTransProcInput', 'translation_process'],
  ['synthStudies', 'loaSynthStudiesInput', 'line_of_argument']
];
const LOA_FIELD_LABELS = {
  reviewQuestion: 'Review question (Item 3)', readingApproach: 'Reading & extraction process (Item 9)', extractionScope: 'Extracted from (Item 9)',
  unitsTerminology: 'Units of synthesis (Item 9)', translationDefinitions: 'Working definitions (Item 13)', translationProcess: 'Translation process (Item 13)',
  alternativeInterpretations: 'Alternative interpretations (Items 13/15)', modelContext: 'Context where the model applies (Item 16)',
  teamMergeNote: 'How independent models were merged',
  appraisalPolicy: 'Quality appraisal policy', appraisalUse: 'How appraisal was used', relateProcess: 'Process of relating studies (Item 11)',
  synthStudies: 'Studies synthesized into the line of argument (Item 15)'
};
const EXTRACTION_SCOPE_LABELS = { full: 'Full study accounts', findings: 'Findings sections only', mixed: 'Mainly findings, other sections for context' };
function writeupFieldText(key, v) { return key === 'extractionScope' ? (EXTRACTION_SCOPE_LABELS[v] || '(not stated)') : v; }
WRITEUP_FIELDS.forEach(([key, id, category]) => {
  const el = document.getElementById(id);
  if (!el) return;
  bindPendingCommit(el, async () => {
    const oldVal = state.loa[key] || '';
    const newVal = (el.value || '').trim();
    if (oldVal === newVal) return;
    state.loa = { ...state.loa, id: 'loa_main', [key]: newVal, updatedAt: Date.now() };
    await dbPut('meta', state.loa);
    await recordAuditLog({
      category,
      action: `Updated ${LOA_FIELD_LABELS[key]}`,
      fromVal: oldVal ? writeupFieldText(key, oldVal) : '(empty)',
      toVal: newVal ? writeupFieldText(key, newVal) : '(cleared)'
    });
    if (!divPub.classList.contains('hidden')) renderPublicationView();
  });
});

function populateLoaInputs() {
  document.getElementById('loaAimInput').value = state.loa.aim || '';
  document.getElementById('loaTitleInput').value = state.loa.title || '';
  document.getElementById('loaFlowInput').value = state.loa.flow || '';
  document.getElementById('loaNarrativeInput').value = state.loa.narrative || '';
  document.getElementById('loaRelateOutcomeInput').value = state.loa.relateOutcome || '';
  // A field being typed in keeps its text (its commit is still to come)
  [...LOA_EXTRA_FIELDS, ...WRITEUP_FIELDS].forEach(([k, id]) => { const el = document.getElementById(id); if (el && el !== document.activeElement) el.value = state.loa[k] || ''; });
  const ordSel = document.getElementById('orderStrategySelect');
  if (ordSel) ordSel.value = getOrderStrategy();
  if (state.loa.updatedAt) {
    document.getElementById('loaSavedStatus').textContent = 'Last saved: ' + new Date(state.loa.updatedAt).toLocaleTimeString();
  }
  renderLoaClusterChips();
}

// The drawer's fields are saved together (one audit entry per section that changed): when the reviewer leaves the drawer,
// closes it, switches tab or leaves the page (a pending commit, like every other text box), or clicks Save & Log now.
const LOA_DRAWER_FIELD_IDS = () => ['loaAimInput', 'loaTitleInput', 'loaFlowInput', 'loaNarrativeInput', 'loaRelateOutcomeInput', ...LOA_EXTRA_FIELDS.map(f => f[1])];
let loaDrawerDirty = false;
const commitLoaDrawer = async () => {
  if (!loaDrawerDirty) return;
  loaDrawerDirty = false;
  pendingSaveCleanups.delete(commitLoaDrawer);
  await saveLoaDrawer({ quiet: true });
};
commitLoaDrawer.isCommit = true;
function markLoaDrawerDirty() { loaDrawerDirty = true; pendingSaveCleanups.add(commitLoaDrawer); }
LOA_DRAWER_FIELD_IDS().forEach(id => document.getElementById(id)?.addEventListener('input', markLoaDrawerDirty));
// Focus leaving the drawer commits it; the window losing focus (another window or app) does not (see bindPendingCommit)
// A dialog opened from the drawer (From the map, Load a model) is part of working in it: focus moving there does not commit
// A click on a label or an empty part of the drawer also takes the focus from a box (relatedTarget is then null): that is still
// working in the drawer, so it does not commit
let loaDrawerPointerDown = false;
loaDrawer.addEventListener('mousedown', () => { loaDrawerPointerDown = true; setTimeout(() => { loaDrawerPointerDown = false; }, 0); }, true);
loaDrawer.addEventListener('focusout', e => {
  const to = e.relatedTarget;
  if (!document.hasFocus() || (to && (loaDrawer.contains(to) || to.closest('[role="dialog"]')))) return;
  if (!to && loaDrawerPointerDown) return;
  commitLoaDrawer();
});
document.getElementById('saveLoaBtn').addEventListener('click', async () => {
  loaDrawerDirty = false; pendingSaveCleanups.delete(commitLoaDrawer);
  await saveLoaDrawer();
});

async function saveLoaDrawer({ quiet = false } = {}) {
  const ids = { aim: 'loaAimInput', title: 'loaTitleInput', flow: 'loaFlowInput', narrative: 'loaNarrativeInput', relateOutcome: 'loaRelateOutcomeInput' };
  LOA_EXTRA_FIELDS.forEach(([k, id]) => { ids[k] = id; });
  const oldV = {}, newV = {};
  Object.keys(ids).forEach(k => { oldV[k] = state.loa[k] || ''; newV[k] = (document.getElementById(ids[k])?.value || '').trim(); });
  const aimChanged = oldV.aim !== newV.aim;
  const loaChanged = ['title', 'flow', 'narrative'].some(k => oldV[k] !== newV[k]);
  const relChanged = oldV.relateOutcome !== newV.relateOutcome;
  const extraChanged = LOA_EXTRA_FIELDS.filter(([k]) => oldV[k] !== newV[k]);

  if (!aimChanged && !loaChanged && !relChanged && extraChanged.length === 0) {
    if (!quiet) showSnackbar('No changes in the Aim, Item 12 or the line of argument to save.');
    return;
  }

  state.loa = { ...state.loa, id: 'loa_main', projectCode: state.projectCode || '', ...newV, updatedAt: Date.now() };
  await dbPut('meta', state.loa);
  populateLoaInputs();
  updateHeaderProjectUI();

  if (aimChanged) {
    await recordAuditLog({
      category: 'aim_question',
      action: 'Updated Phase 1 Research Aim',
      detail: newV.aim || '(cleared)',
      fromVal: oldV.aim ? oldV.aim.slice(0, 90) : '(none)',
      toVal: newV.aim ? newV.aim.slice(0, 90) : '(cleared)'
    });
  }
  if (loaChanged) {
    await recordAuditLog({
      category: 'line_of_argument',
      action: `Updated Line of Argument Synthesis${newV.title ? ': "' + newV.title + '"' : ''}`,
      detail: `${newV.flow ? 'Model Flow: ' + newV.flow + '\n' : ''}${newV.narrative ? 'Narrative: ' + newV.narrative : ''}`,
      fromVal: oldV.title || oldV.flow || oldV.narrative ? `${oldV.title || '(Untitled)'} — ${(oldV.narrative || oldV.flow).slice(0, 70)}...` : '(Initial Draft)',
      toVal: `${newV.title || '(Untitled)'} — ${(newV.narrative || newV.flow).slice(0, 70)}...`
    });
  }
  // One audit entry per section that changed (alternative interpretations, Item 16, team merge)
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
      action: 'Updated Phase 4: Outcome of Relating Studies (eMERGe item 12)',
      detail: newV.relateOutcome ? 'Outcome: ' + newV.relateOutcome : '(cleared)',
      fromVal: oldV.relateOutcome ? `${oldV.relateOutcome.slice(0, 70)}...` : '(Initial Draft)',
      toVal: newV.relateOutcome ? `${newV.relateOutcome.slice(0, 70)}...` : '(cleared)'
    });
  }
}
