// Smoke tests for Meta-Ethnography Canvas (Playwright + Chromium). Run: npm test
// First time on a machine: npx playwright install chromium
// Serves the repository folder on a local port and drives the ?demo project (its own IndexedDB, so nothing real is touched).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttc': 'application/octet-stream' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/me_canvas.html`;

const browser = await chromium.launch();
let failures = 0, passes = 0;
const check = (name, ok, extra = '') => { if (ok) { passes++; console.log(`  ok   ${name}`); } else { failures++; console.log(`  FAIL ${name} ${extra}`); } };

async function openDemo(url = BASE + '?demo') {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.pageErrors = [];
  page.on('pageerror', e => page.pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.docs && state.docs.length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  return page;
}
const tab = (p, t) => p.evaluate(x => setActiveTab(x), t);
const logCount = p => p.evaluate(() => state.logs.length);
// ONLY="part of a group name" npm test  — run just the matching groups
const group = async (name, fn) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  console.log(`\n${name}`);
  try { await fn(); } catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message.split('\n')[0]}`); }
};

await group('Text edits are saved AND audit-logged even without blur (tab switch)', async () => {
  const p = await openDemo();
  const cases = [
    ['3rd order title', async () => p.locator('.cluster-title').first().fill('Test title')],
    ['Step A', async () => p.locator('.cluster-trans').first().fill('Step A text')],
    ['Step B', async () => p.locator('.cluster-note').first().fill('Step B text')],
    ['2nd order label', async () => p.locator('.sec-label-input').first().fill('Test label')],
    ['reflexive note', async () => p.locator('.cluster-reflex').first().fill('My position shapes this.')],
    ['CERQual explanation', async () => { await p.locator('.cl-subtab-btn[data-subtab=cerqual]').first().click(); await p.locator('.cq-exp').first().fill('CQ text'); }],
    ['row team note', async () => { await p.locator('.cl-subtab-btn[data-subtab=concordance]').first().click(); await p.locator('.cl-conc-note').first().fill('team note'); }],
    ['cell note', async () => { await p.locator('.sec-comment-view').first().click(); await p.locator('.sec-comment-input:visible').fill('cell note'); }]
  ];
  for (const [name, act] of cases) {
    await tab(p, 'matrix'); await p.waitForTimeout(500);
    const before = await logCount(p);
    await act();
    await tab(p, 'audit'); await p.waitForTimeout(400);
    check(`${name} -> 1 log entry`, (await logCount(p)) - before === 1);
  }
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Row type is derived from cells; no per-row selector', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(500);
  check('no .cluster-type selector', (await p.locator('.cluster-type').count()) === 0);
  check('no translationType stored on rows', await p.evaluate(() => state.clusters.every(c => !('translationType' in c))));
  check('mixed row detected', await p.evaluate(() => state.clusters.some(c => clusterTranslationType(c) === 'mixed')));
  await p.context().close();
});

await group('Restore keeps PDFs out of memory-heavy paths and matches by id / file name', async () => {
  const p = await openDemo();
  await p.evaluate(() => { window.__pdfReads = 0; const o = dbGetAll; window.dbGetAll = async s => { if (s === 'pdf_binaries') window.__pdfReads++; return o(s); }; });
  const payload = renamed => p.evaluate(rn => {
    const d = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: state.logs, loa: state.loa, projectCode: state.projectCode, version: DB_VERSION }));
    if (rn) { const m = {}; d.docs.forEach((x, i) => { m[x.id] = 'nw_' + i; x.id = 'nw_' + i; }); d.annotations.forEach(a => { a.docId = m[a.docId] || a.docId; }); d.logs.push({ noKey: true }); }
    return JSON.stringify(d);
  }, renamed);
  const restore = async json => { await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await p.waitForTimeout(2500); };
  const keys = () => p.evaluate(async () => (await dbGetAllKeys('pdf_binaries')).sort());
  const orig = await keys();
  await restore(await payload(false));
  check('same-id restore keeps all PDFs', JSON.stringify(await keys()) === JSON.stringify(orig) && await p.evaluate(() => state.docs.every(d => d.hasBinary)));
  const before = await p.evaluate(() => ({ d: state.docs.length, a: state.annotations.length, l: state.logs.length }));
  await restore(await payload(true)); // contains a log without id: the restore must fail and roll back
  const after = await p.evaluate(() => ({ d: state.docs.length, a: state.annotations.length, l: state.logs.length }));
  check('failed restore rolls back', JSON.stringify(before) === JSON.stringify(after));
  check('rollback leaves the original PDFs only', JSON.stringify(await keys()) === JSON.stringify(orig));
  check('never reads all PDFs at once', (await p.evaluate(() => window.__pdfReads)) === 0);
  await p.context().close();
});

await group('Missing-PDF dialog after restore; unmatched files are reported', async () => {
  const p = await openDemo();
  const json = await p.evaluate(() => JSON.stringify({ docs: state.docs.map(d => ({ ...d, hasBinary: false })), annotations: state.annotations, clusters: state.clusters, logs: state.logs, loa: state.loa, projectCode: state.projectCode, version: DB_VERSION }));
  await p.evaluate(async () => { for (const k of await dbGetAllKeys('pdf_binaries')) await dbDelete('pdf_binaries', k); });
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await p.waitForTimeout(2500);
  check('dialog lists 4 missing PDFs', (await p.locator('#missingPdfList li').count()) === 4);
  const demoDir = path.join(ROOT, 'app', 'demo');
  const pdfs = fs.readdirSync(demoDir).filter(f => f.endsWith('.pdf')).map(f => path.join(demoDir, f));
  const wrong = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mec-')), 'wrong-name.pdf');
  fs.copyFileSync(pdfs[0], wrong);
  const docsBefore = await p.evaluate(() => state.docs.length);
  await p.setInputFiles('#pdfFileInput', [wrong, pdfs[1]]); await p.waitForTimeout(2000);
  check('unmatched file is listed', (await p.locator('#missingPdfUnmatchedList li').allInnerTexts()).join().includes('wrong-name.pdf'));
  check('unmatched file is not added as a study', (await p.evaluate(() => state.docs.length)) === docsBefore);
  check('one PDF reconnected', (await p.locator('#missingPdfList li').count()) === 3);
  const targetId = await p.evaluate(n => state.docs.find(d => d.name === n).id, path.basename(pdfs[0]));
  const options = await p.locator('.unmatched-assign option').allInnerTexts();
  check('picker lists the missing studies', options.length === 4, options.join('|'));
  await p.locator('.unmatched-assign').first().selectOption(targetId); await p.waitForTimeout(1500);
  check('file connected by hand to the chosen study', await p.evaluate(id => state.docs.find(d => d.id === id).hasBinary, targetId));
  check('connected file leaves the unmatched list', (await p.locator('#missingPdfUnmatchedList li').count()) === 0 && (await p.locator('#missingPdfList li').count()) === 2);
  await p.setInputFiles('#pdfFileInput', pdfs.filter(f => f !== pdfs[0] && f !== pdfs[1])); await p.waitForTimeout(2500);
  check('dialog closes when all are reconnected', await p.evaluate(() => document.getElementById('missingPdfModal').classList.contains('hidden')));
  await p.context().close();
});

await group('Rich★ sort: richness only, ties keep order, dialog for ties', async () => {
  const p = await openDemo();
  const order = () => p.evaluate(() => state.docs.map(d => d.id));
  await p.evaluate(() => { state.docs.forEach(d => { d.richness = 'Rich'; d.quality = 'Low'; }); state.docs[3].quality = 'High'; });
  const start = await order();
  await p.click('#sortStudiesRichBtn'); await p.waitForTimeout(500);
  check('quality does not change the order', JSON.stringify(await order()) === JSON.stringify(start));
  check('tie dialog opens', await p.evaluate(() => !document.getElementById('richTieModal').classList.contains('hidden')));
  await p.locator('.tie-down').first().click();
  await p.fill('#richTieReason', 'closest to the question');
  await p.click('#richTieApplyBtn'); await p.waitForTimeout(500);
  const manual = await order();
  check('manual order saved', JSON.stringify(manual) !== JSON.stringify(start));
  check('reason is reused in the Methods text', await p.evaluate(() => getMethodSections().some(s => (s.html || '').includes('closest to the question'))));
  await p.click('#sortStudiesRichBtn'); await p.waitForTimeout(500);
  await p.click('#richTieKeepBtn');
  check('next sort keeps the manual order', JSON.stringify(await order()) === JSON.stringify(manual));
  await p.evaluate(() => { state.docs.forEach(d => { d.richness = ''; d.quality = ''; }); });
  await p.click('#sortStudiesRichBtn'); await p.waitForTimeout(400);
  check('unrated studies are not offered as a tie', await p.evaluate(() => document.getElementById('richTieModal').classList.contains('hidden')));
  await p.context().close();
});

await group('Backup: timestamped file name and reminder badge', async () => {
  const p = await openDemo();
  await p.evaluate(async () => { await dbPut('meta', state.loa); });
  check('badge shows after a change', await p.evaluate(() => !document.getElementById('backupReminder').classList.contains('hidden')));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backupJsonBtn')]);
  check('file name ends with date_time to the second', /_\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await p.waitForTimeout(300);
  check('badge clears after a backup', await p.evaluate(() => document.getElementById('backupReminder').classList.contains('hidden')));
  await p.context().close();
});

await group('Matrix with many studies: lazy rows keep the scroll position', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(500);
  await p.evaluate(() => {
    const baseAnn = state.annotations.filter(a => a.type === 'second_order'), baseDocs = state.docs.slice(0, 4);
    const docs = [], anns = [], cls = [];
    for (let i = 0; i < 30; i++) cls.push(normalizeCluster({ id: 'c' + i, thirdOrderTitle: 'Theme ' + i }));
    for (let d = 0; d < 30; d++) {
      const doc = normalizeDoc({ ...baseDocs[d % 4], id: 'd' + d, name: 'S' + d + '.pdf' }); docs.push(doc);
      for (let k = 0; k < 20; k++) {
        const a = normalizeAnnotation({ ...JSON.parse(JSON.stringify(baseAnn[k % baseAnn.length])), id: `a${d}_${k}`, docId: doc.id, text: 'Lorem ipsum '.repeat(10 + (k * 7) % 40), note: '', parentIds: [] });
        a.clusterIds = [cls[(d * 3 + k) % 30].id]; a.clusterRelations = {}; a.clusterComments = {}; anns.push(a);
      }
    }
    Object.assign(state, { docs, annotations: anns, clusters: cls }); renderMatrixView();
  });
  await p.waitForTimeout(500);
  const built = await p.locator('#matrixTable .cluster-title').count();
  check('only some rows are built at first', built > 0 && built < 30, `built=${built}`);
  const drift = await p.evaluate(async () => {
    const c = document.getElementById('matrixTable').parentElement, wait = ms => new Promise(r => setTimeout(r, ms));
    let worst = 0;
    c.scrollTop = c.scrollHeight; await wait(400);
    for (let i = 0; i < 25; i++) { // creep upward: placeholders above become real rows
      const ptop = c.getBoundingClientRect().top;
      const ref = [...document.querySelectorAll('#matrixTable tbody > tr[data-cluster-id]')].find(r => r.querySelector('.cluster-title') && r.getBoundingClientRect().bottom > ptop + 120);
      if (!ref) break;
      const before = ref.getBoundingClientRect().top; c.scrollTop -= 150; await wait(160);
      worst = Math.max(worst, Math.abs((ref.getBoundingClientRect().top - before) - 150));
    }
    for (const frac of [0.3, 0.6, 1]) { // re-render at several positions
      c.scrollTop = (c.scrollHeight - c.clientHeight) * frac; await wait(400);
      const ptop = c.getBoundingClientRect().top;
      const ref = [...document.querySelectorAll('#matrixTable tbody > tr[data-cluster-id]')].find(r => r.getBoundingClientRect().bottom > ptop + 1);
      const id = ref.dataset.clusterId, off = ref.getBoundingClientRect().top - ptop;
      renderMatrixView(); await wait(500);
      const r2 = document.querySelector(`#matrixTable tr[data-cluster-id="${id}"]`);
      worst = Math.max(worst, Math.abs((r2.getBoundingClientRect().top - c.getBoundingClientRect().top) - off));
    }
    return worst;
  });
  check('scroll drift <= 5px', drift <= 5, `drift=${Math.round(drift)}`);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Line of Argument map supports encompasses / metaphor relations', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const ids = state.clusters.map(c => c.id);
    state.loa.links = [{ id: 'l1', from: ids[0], to: ids[1], type: 'encompasses', note: '' }, { id: 'l2', from: ids[1], to: ids[2], type: 'metaphor', note: '' }];
    const out = {};
    for (const lay of ['circle', 'flow']) { const s = buildConceptMapSvg('t', 640, 360, lay); out[lay] = { drawn: s.includes('encompasses') && s.includes('metaphor'), bothEnds: /marker-start="url\(#t-(ah|fl)-(encompasses|metaphor)\)"/.test(s) }; }
    out.key = teamLinkKey({ from: 'a', to: 'b', type: 'metaphor' }) !== teamLinkKey({ from: 'b', to: 'a', type: 'metaphor' });
    return out;
  });
  check('circle layout draws both', r.circle.drawn);
  check('flow layout draws both', r.flow.drawn);
  check('directed relations have a single arrow head', !r.circle.bothEnds && !r.flow.bothEnds);
  check('team comparison keeps the direction', r.key);
  await p.context().close();
});

await group('Long-text boxes grow while typing', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(600);
  const h = sel => p.locator(sel).first().evaluate(el => el.offsetHeight);
  const long = n => Array.from({ length: n }, (_, i) => 'line ' + i + ' of a long interpretation').join('\n');
  const stepB = '.cluster-note';
  const h0 = await h(stepB);
  await p.locator(stepB).first().fill(long(25)); await p.waitForTimeout(300);
  const h1 = await h(stepB);
  check('Step B grows with its text', h1 > h0 * 2, `from ${h0} to ${h1}`);
  await p.locator(stepB).first().fill(''); await p.waitForTimeout(300);
  check('Step B shrinks back when emptied', (await h(stepB)) <= h0 + 2);
  await p.locator(stepB).first().fill(long(400)); await p.waitForTimeout(300);
  const capped = await p.locator(stepB).first().evaluate(el => ({ h: el.offsetHeight, max: window.innerHeight * 0.6, scrolls: el.scrollHeight > el.clientHeight }));
  check('growth stops at 60% of the window, then scrolls', capped.h <= capped.max + 2 && capped.scrolls, JSON.stringify(capped));
  await p.locator('.sec-comment-view').first().click();
  const c0 = await h('.sec-comment-input:visible');
  await p.locator('.sec-comment-input:visible').fill(long(12)); await p.waitForTimeout(300);
  check('cell note editor grows', (await h('.sec-comment-input:visible')) > c0 + 40);
  // a box that was hidden while its text was set is sized when it becomes visible
  await p.evaluate(() => { const t = document.querySelector('.cq-exp'); if (t && t.tagName === 'TEXTAREA') t.value = Array(15).fill('hidden text').join('\n'); });
  await p.locator('.cl-subtab-btn[data-subtab=cerqual]').first().click(); await p.waitForTimeout(500);
  const hidden = await p.evaluate(() => { const t = document.querySelector('.cq-exp'); return t && t.tagName === 'TEXTAREA' ? t.scrollHeight <= t.clientHeight + 2 : true; });
  check('a box filled while hidden shows all its text once visible', hidden);
  await tab(p, 'audit'); await p.waitForTimeout(500);
  const r0 = await h('.rationale-input');
  await p.locator('.rationale-input').first().fill(long(6)); await p.waitForTimeout(300);
  check('audit-trail reason box grows', (await h('.rationale-input')) > r0 + 30);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Research Aim drawer scrolls; study storyline is visible; site version markers', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(600);
  await p.click('#toggleLoaDrawerBtn'); await p.waitForTimeout(500);
  const d = await p.evaluate(() => { const e = document.getElementById('loaDrawer'); return { h: e.clientHeight, sh: e.scrollHeight, win: window.innerHeight, overflowY: getComputedStyle(e).overflowY }; });
  check('drawer is capped at 60% of the window', d.h <= d.win * 0.6 + 2, JSON.stringify(d));
  check('drawer scrolls when its content is taller', d.overflowY === 'auto' && d.sh > d.h, JSON.stringify(d));
  const reachable = await p.evaluate(() => { const e = document.getElementById('loaDrawer'); e.scrollTop = e.scrollHeight; const last = Array.from(e.querySelectorAll('textarea')).pop(); const r = last.getBoundingClientRect(), er = e.getBoundingClientRect(); return r.bottom <= er.bottom + 1 && r.top >= er.top - 1; });
  check('the last field can be reached', reachable);
  check('matrix stays visible below the drawer', await p.evaluate(() => document.getElementById('matrixTable').getBoundingClientRect().height > 0));
  await tab(p, 'extract'); await p.waitForTimeout(500);
  await p.evaluate(() => { state.docs[0].studyOverview = 'A story of nights spent alone; key metaphor: the lone watch.'; updateDocHeaderUI(); });
  check('storyline box shows under the study header', await p.evaluate(() => !document.getElementById('docOverviewBox').classList.contains('hidden')) && (await p.locator('#docOverviewSummary').innerText()).includes('lone watch'));
  await p.click('#activeDocHeader'); await p.waitForTimeout(300);
  check('it steps aside while the edit dock is open', await p.evaluate(() => document.getElementById('docOverviewBox').classList.contains('hidden')));
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'sync-version.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  check('every version marker on the site matches version.js', r.status === 0, (r.stdout || '') + (r.stderr || ''));
  await p.context().close();
});

await group('Theme column folds to a strip', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(600);
  const width = () => p.evaluate(() => document.querySelector('#matrixTable tbody tr[data-cluster-id] td:first-child').getBoundingClientRect().width);
  const wide = await width();
  await p.click('.theme-fold-btn'); await p.waitForTimeout(500);
  const narrow = await width();
  check('folded column is a narrow strip', wide >= 380 && narrow <= 60, `wide=${Math.round(wide)} narrow=${Math.round(narrow)}`);
  check('strip shows the row number and title', (await p.locator('.theme-strip-num').first().innerText()) === '#1' && (await p.locator('.theme-strip-title').first().innerText()).length > 0);
  check('full panel is hidden while folded', await p.evaluate(() => document.querySelector('#matrixTable .theme-full').offsetParent === null));
  const dropped = await p.evaluate(async () => {
    const target = state.clusters[state.clusters.length - 1];
    const sec = state.annotations.find(a => a.type === 'second_order' && !(a.clusterIds || []).includes(target.id));
    const tr = document.querySelector(`#matrixTable tr[data-cluster-id="${target.id}"]`);
    const dt = new DataTransfer(); dt.setData('text/sec-id', sec.id);
    tr.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    tr.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 800));
    return state.annotations.find(a => a.id === sec.id).clusterIds.includes(target.id);
  });
  check('cards can still be dropped on a folded row', dropped);
  check('folded state survives a re-render and is remembered', await p.evaluate(() => { renderMatrixView(); return document.getElementById('matrixTable').classList.contains('matrix-theme-folded') && lsGet('me_theme_folded') === 'true'; }));
  await p.click('.theme-unfold-btn'); await p.waitForTimeout(500);
  check('expands again', (await width()) >= 380);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Safety and accessibility', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  await p.goto(BASE + '?demo'); await p.waitForFunction(() => typeof state !== 'undefined' && state.docs.length > 0); await p.waitForTimeout(800);
  check('PDF.js eval and XFA are off', await p.evaluate(() => { const o = pdfjsDocumentOptions(); return o.isEvalSupported === false; }));
  check('single tab: no warning', await p.evaluate(() => document.getElementById('multiTabBanner').classList.contains('hidden')));
  const p2 = await ctx.newPage(); await p2.goto(BASE + '?demo'); await p2.waitForTimeout(2500);
  check('second tab: warning in both tabs', await p.evaluate(() => !document.getElementById('multiTabBanner').classList.contains('hidden')) && await p2.evaluate(() => !document.getElementById('multiTabBanner').classList.contains('hidden')));
  await p2.close(); await p.waitForTimeout(500);
  check('warning clears when the other tab closes', await p.evaluate(() => document.getElementById('multiTabBanner').classList.contains('hidden')));
  await p.focus('#backupJsonBtn');
  await p.evaluate(() => { const m = document.getElementById('richTieModal'); m.classList.remove('hidden'); m.classList.add('flex'); });
  await p.waitForTimeout(200);
  check('focus moves into a modal', await p.evaluate(() => document.getElementById('richTieModal').contains(document.activeElement)));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  check('Esc closes it and focus returns', await p.evaluate(() => document.getElementById('richTieModal').classList.contains('hidden') && document.activeElement.id === 'backupJsonBtn'));
  for (const t of ['extract', 'matrix', 'audit', 'pub']) {
    await tab(p, t); await p.waitForTimeout(500);
    const bad = await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => !(b.textContent || '').trim() && !b.getAttribute('aria-label')).length);
    check(`icon-only buttons have names (${t} tab)`, bad === 0, `missing=${bad}`);
  }
  await ctx.close();
});

await group('Undo history belongs to one workspace (reset / clean restore)', async () => {
  const p = await openDemo();
  await tab(p, 'extract'); await p.waitForTimeout(400);
  await p.locator('#studyList .del').first().click(); await p.waitForTimeout(800);
  check('deleting a study can be undone', await p.evaluate(() => state.undoStack.length) === 1);
  await p.evaluate(() => document.getElementById('resetProjectBtn').click()); await p.waitForTimeout(1500); await p.keyboard.press('Escape');
  check('reset empties the undo stack', await p.evaluate(() => state.undoStack.length === 0 && document.getElementById('undoDeleteBtn').disabled));
  await p.evaluate(() => performUndo()); await p.waitForTimeout(500);
  check('Ctrl+Z after reset brings nothing back', await p.evaluate(() => state.docs.length === 0 && state.annotations.length === 0));
  await p.context().close();
});

await group('Extracted text edits, attribution changes and late reasons leave a trace', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(600);
  let before = await logCount(p);
  await p.locator('.edit-cell-quote-btn').first().click();
  await p.locator('.cell-quote-textarea:visible').fill('Corrected passage text');
  await p.locator('.cell-quote-save:visible').click(); await p.waitForTimeout(400);
  const ed = await p.evaluate(() => state.logs[0]);
  check('editing extracted text is logged with old and new wording', (await logCount(p)) === before + 1 && ed.action.includes('extracted text') && ed.toVal === 'Corrected passage text' && !!ed.fromVal);
  check('the entry is tagged with its row', (ed.clusterIds || []).length > 0);
  before = await logCount(p);
  p.removeAllListeners('dialog'); p.on('dialog', d => d.type() === 'prompt' ? d.accept('NewRev') : d.accept());
  await p.locator('.cl-rev-btn').first().click(); await p.waitForTimeout(400);
  const at = await p.evaluate(() => state.logs[0]);
  check('changing the attributed reviewer is logged', (await logCount(p)) === before + 1 && at.category === 'audit_edit' && at.toVal === '@NewRev');
  await tab(p, 'audit'); await p.waitForTimeout(500);
  const ta = p.locator('.rationale-input').nth(3);
  await ta.fill('First reason'); await ta.blur(); await p.waitForTimeout(300);
  await ta.fill('Second reason'); await ta.blur(); await p.waitForTimeout(300);
  const lg = await p.evaluate(() => state.logs[3]);
  check('a later reason keeps its date and earlier wording', lg.rationale === 'Second reason' && !!lg.rationaleAt && lg.rationaleHistory?.[0]?.text === 'First reason');
  await tab(p, 'pub'); await p.locator('[data-pub=appendix]').click(); await p.waitForTimeout(400);
  check('Appendix A shows when the reason was written', (await p.locator('#pubPreviewContainer').innerText()).includes('Reason written'));
  await p.context().close();
});

await group('MERGE restore never overwrites local work', async () => {
  const p = await openDemo();
  const json = await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: state.logs, loa: state.loa, projectCode: state.projectCode, version: DB_VERSION }));
    d.clusters[0].thirdOrderTitle = 'Title from the backup';
    d.loa.aim = 'Aim from the backup';
    d.annotations.push({ ...d.annotations.find(a => a.type === 'second_order'), id: 'merge_new_1', clusterIds: [], text: 'Only in the backup' });
    return JSON.stringify(d);
  });
  const local = await p.evaluate(() => ({ title: state.clusters[0].thirdOrderTitle, aim: state.loa.aim, n: state.annotations.length }));
  const alerts = [];
  p.removeAllListeners('dialog');
  p.on('dialog', d => { if (d.type() === 'confirm') d.dismiss(); else { alerts.push(d.message()); d.accept(); } }); // Cancel = MERGE
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await p.waitForTimeout(2500);
  const after = await p.evaluate(() => ({ title: state.clusters[0].thirdOrderTitle, aim: state.loa.aim, n: state.annotations.length, log: state.logs[0] }));
  check('local row title and aim are kept', after.title === local.title && after.aim === local.aim);
  check('items only in the backup are added', after.n === local.n + 1);
  check('conflicts are reported and the merge is logged', alerts.some(a => a.includes('Kept YOUR version')) && after.log.category === 'project_data' && after.log.detail.includes(local.title));
  await p.context().close();
});

await group('Changing study #1 marks the affected rows for re-reading', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(600);
  const before = await p.evaluate(() => state.docs[0].id);
  await p.evaluate(() => moveStudyOrder(1, 0)); await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({ flagged: state.clusters.filter(c => c.baselineChange).length, log: state.logs.find(l => l.action.startsWith('Study #1 changed')), first: state.docs[0].id, base: state.loa.baselineDocId }));
  check('#1 is remembered in the project', r.first !== before && r.base === r.first);
  check('rows are flagged and the change is logged per row', r.flagged > 0 && r.log && r.log.clusterIds.length === r.flagged);
  check('the row shows the warning', (await p.locator('.cl-baseline-warn').count()) > 0);
  await tab(p, 'pub'); await p.locator('[data-pub=table2]').click(); await p.waitForTimeout(300);
  check('Table 2 notes the unreviewed rows', (await p.locator('#pubPreviewContainer').innerText()).includes('study #1 changed'));
  await tab(p, 'matrix'); await p.waitForTimeout(500);
  await p.locator('.cl-baseline-ok').first().click(); await p.waitForTimeout(500);
  check('marking a row as re-read clears it and is logged', (await p.evaluate(() => state.clusters.filter(c => c.baselineChange).length)) === r.flagged - 1 && (await p.evaluate(() => state.logs[0].action)).startsWith('Re-read row'));
  await p.context().close();
});

await group('Constructs not translated: reason in the pool, Appendix B, Methods; provisional agreement', async () => {
  const p = await openDemo();
  await p.evaluate(async () => { const s = state.annotations.find(a => a.type === 'second_order' && !isBaselineDocId(a.docId)); s.clusterIds = []; await dbPut('annotations', s); });
  await tab(p, 'matrix'); await p.waitForTimeout(600);
  await p.locator('.pool-nt summary').first().click();
  await p.locator('.pool-nt-input').first().fill('Outside the review question');
  await tab(p, 'pub'); await p.waitForTimeout(400);
  check('the reason is saved and logged', await p.evaluate(() => state.annotations.some(a => a.notTranslatedNote === 'Outside the review question') && state.logs[0].action.includes('not translated')));
  await p.locator('[data-pub=appendix]').click(); await p.waitForTimeout(300);
  const app = await p.locator('#pubPreviewContainer').innerText();
  check('Appendix B lists it with the reason', app.includes('Appendix B') && app.includes('Outside the review question'));
  await p.locator('[data-pub=method]').click(); await p.waitForTimeout(300);
  const m = await p.locator('#pubPreviewContainer').innerText();
  check('Methods mentions Appendix B', m.includes('not translated into any third-order construct'));
  check('Methods does not claim a comparison it cannot see', !m.includes('each study being compared with the synthesis'));
  const refut = await p.evaluate(() => state.annotations.some(a => a.type === 'second_order' && (a.clusterIds || []).some(id => isSecRefutational(a, id))));
  check('refutational wording follows the matrix', refut ? m.includes('reciprocal and refutational translation') : m.includes('no placement was judged refutational'));
  check('agreement is provisional in exports', await p.evaluate(() => concordanceLabel('agreed') === 'Agreed (for now)' && getConcordanceBadgeMeta('agreed').label.includes('for now')));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Comparing reviewers: studies by file / DOI, order-independent pairs, translation order', async () => {
  const p = await openDemo();
  await p.waitForFunction(() => state.docs.filter(d => d.hasBinary).every(d => d.fpDone && /^[0-9a-f]{64}$/.test(d.sha256 || '')), null, { timeout: 30000 });
  check('every stored PDF gets a fingerprint (in the background)', true);
  await p.click('#compareJsonModalBtn');
  check('DOI is read from text and tidied', await p.evaluate(() => normalizeDoi('https://doi.org/10.1177/1049732318ABC.') === '10.1177/1049732318abc'));
  const run = (opts) => p.evaluate(async o => {
    const peer = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, projectCode: state.projectCode, reviewerId: 'Peer' }));
    const idMap = {};
    peer.docs.forEach((d, i) => { idMap[d.id] = 'peer_doc_' + i; d.id = idMap[d.id]; d.name = 'renamed_' + i + '.pdf'; d.title = 'x'; });
    peer.annotations.forEach((a, i) => { a.docId = idMap[a.docId]; a.id = 'peer_a_' + i; });
    if (o.noHash) peer.docs[1].sha256 = '';
    if (o.reverse) peer.annotations.reverse();
    if (o.swapFirst) peer.docs.reverse().forEach((d, i) => { d.order = i; });
    await processPeerJsonFile(new File([JSON.stringify(peer)], 'peer.json'));
    const cmp = state.peerComparison;
    return {
      hows: cmp.matchedStudies.map(m => m.how), unmatched: cmp.unmatchedPeerDocs.length,
      pairs: cmp.matchedPairs.map(x => x.peerAnno.id + '>' + x.localAnno.id).sort().join(','),
      tab: state.activeCompareTab, firstDiffers: peerOrderInfo(cmp).firstDiffers
    };
  }, opts);
  const a = await run({});
  check('renamed files are matched as the identical PDF', a.unmatched === 0 && a.hows.every(h => h === 'sha256'));
  const b = await run({ reverse: true });
  check('pairs do not depend on the order of the peer file', a.pairs === b.pairs && a.pairs.length > 0);
  const c = await run({ noHash: true });
  check('same author + year is only a suggestion, not a match', c.unmatched === 1);
  check('unmatched studies open the Studies & Order tab', c.tab === 'studies' && (await p.locator('.cmp-doc-pick').count()) === 1);
  const before = await p.evaluate(() => state.peerComparison.matchedPairs.length);
  await p.locator('.cmp-doc-pick').selectOption({ index: 1 }); await p.waitForTimeout(300);
  check('connecting it by hand re-matches its constructs', await p.evaluate(() => state.peerComparison.unmatchedPeerDocs.length === 0 && state.peerComparison.matchedStudies.some(m => m.how === 'manual')) && (await p.evaluate(() => state.peerComparison.matchedPairs.length)) > before);
  const d = await run({ swapFirst: true });
  check('a different #1 is shown as something to discuss', d.firstDiffers && d.tab === 'studies' && (await p.locator('.cmp-order-memo').count()) === 1);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Refutation map gathers the ⚡ cards by study', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(600);
  // Make sure there is one refutational card outside study #1
  await p.evaluate(async () => {
    const s = state.annotations.find(a => a.type === 'second_order' && !isBaselineDocId(a.docId) && a.clusterIds.length);
    s.clusterRelations[s.clusterIds[0]] = 'refutational'; await dbPut('annotations', s);
  });
  const m = await p.evaluate(() => { const r = buildRefutationMap(); return { studies: r.studies.length, pairs: r.pairList.length, okPairs: r.pairList.every(x => x.r !== x.h) }; });
  check('studies and pairs are derived from the cells', m.studies > 0 && m.pairs > 0 && m.okPairs);
  await p.click('#refutMapBtn'); await p.waitForTimeout(300);
  const txt = await p.locator('#refutMapBody').innerText();
  check('the map opens and lists pairs and studies', txt.includes('Studies in tension') && txt.includes('By study') && txt.includes('contrasts with'));
  await p.locator('.refut-row-link').first().click(); await p.waitForTimeout(500);
  check('a row link closes the map and goes to the row', await p.evaluate(() => document.getElementById('refutMapModal').classList.contains('hidden')));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

// Reads one file out of a .docx (zip) without extra tools: local file header -> raw deflate
function readZipEntry(buf, name) {
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8), csize = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const fname = buf.toString('utf8', i + 30, i + 30 + nlen);
    const start = i + 30 + nlen + xlen;
    if (fname === name) { const data = buf.subarray(start, start + csize); return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'); }
    i = start + csize - 1;
  }
  return '';
}

await group('Review fixes: peer rows by title, merge links, PDF search race, Word widths, older browsers, undo', async () => {
  const p = await openDemo();
  // Peer construct placed in a row that exists here under another id but the same title
  const placed = await p.evaluate(async () => {
    const peer = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, reviewerId: 'Peer' }));
    const row = peer.clusters[0], oldId = row.id; row.id = 'peer_row_x'; row.thirdOrderTitle = '  ' + row.thirdOrderTitle.toUpperCase() + ' ';
    const sec = peer.annotations.find(a => a.type === 'second_order' && !isBaselineDocId(a.docId));
    sec.id = 'peer_new_sec'; sec.text = 'A passage only the peer extracted, about something else entirely'; sec.clusterIds = ['peer_row_x'];
    sec.clusterRelations = { peer_row_x: 'refutational' }; sec.clusterComments = { peer_row_x: 'peer reason' };
    await processPeerJsonFile(new File([JSON.stringify(peer)], 'peer.json'));
    const item = state.peerComparison.peerOnlyAnnos.find(x => x.peerAnno.id === 'peer_new_sec');
    await importPeerConstruct(item, 'discuss');
    const got = state.annotations.find(a => a.text === sec.text);
    return { ids: got.clusterIds, rel: got.clusterRelations[oldId], cmt: got.clusterComments[oldId], oldId };
  });
  check('a peer construct keeps its row when the row exists here under the same title', placed.ids.length === 1 && placed.ids[0] === placed.oldId && placed.rel === 'refutational' && placed.cmt === 'peer reason');
  // MERGE: an added quote / construct pointing to things not in this project loses those links
  const json = await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, projectCode: state.projectCode }));
    const s = d.annotations.find(a => a.type === 'second_order' && a.clusterIds.length);
    d.annotations.push({ ...s, id: 'm_sec', clusterIds: [s.clusterIds[0], 'ghost_row'], clusterRelations: { ghost_row: 'refutational' }, clusterComments: { ghost_row: 'x' } });
    const f = d.annotations.find(a => a.type === 'first_order');
    d.annotations.push({ ...f, id: 'm_quote', parentIds: ['ghost_sec', s.id] });
    return JSON.stringify(d);
  });
  p.removeAllListeners('dialog'); p.on('dialog', d => d.type() === 'confirm' ? d.dismiss() : d.accept());
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await p.waitForTimeout(2500);
  const tidy = await p.evaluate(() => { const s = state.annotations.find(a => a.id === 'm_sec'), q = state.annotations.find(a => a.id === 'm_quote'); return { c: s.clusterIds, r: Object.keys(s.clusterRelations), q: q.parentIds }; });
  check('merged items keep only links to rows and constructs that exist', tidy.c.length === 1 && !tidy.r.includes('ghost_row') && tidy.q.length === 1 && tidy.q[0] !== 'ghost_sec', JSON.stringify(tidy));
  p.removeAllListeners('dialog'); p.on('dialog', d => d.accept());
  // PDF search: switching study while indexing never stores one paper's text under another
  await tab(p, 'extract'); await p.waitForTimeout(500);
  const race = await p.evaluate(async () => {
    const a = state.docs[0].id, b = state.docs[1].id;
    await switchStudy(a);
    pdfSearchState.docId = null; pdfSearchState.pageTexts = [];
    const pending = ensurePdfTextIndex();
    await switchStudy(b);
    // A page request on the destroyed PDF may never settle; that is harmless as long as nothing is stored
    const r = await Promise.race([pending.catch(e => 'threw: ' + e.message), new Promise(res => setTimeout(() => res('pending'), 3000))]);
    return { r: r === null || r === 'pending' ? null : (typeof r === 'string' ? r : 'array'), stored: pdfSearchState.docId };
  });
  check('switching study during PDF search indexing stops quietly', race.r === null || (race.r === 'array' && race.stored !== null), JSON.stringify(race));
  check('the index is never filed under the wrong study', race.stored === null || race.stored === (await p.evaluate(() => state.docs[0].id)));
  // Word export: every table has a real column grid
  await tab(p, 'pub'); await p.waitForTimeout(400);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#downloadWordDocBtn')]);
  const xml = readZipEntry(fs.readFileSync(await dl.path()), 'word/document.xml');
  const cols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map(m => +m[1]);
  check('Word tables have column widths (no 100-twip grid)', cols.length > 20 && cols.every(w => w > 300), `min=${Math.min(...cols)} n=${cols.length}`);
  check('Word tables use a fixed layout', (xml.match(/<w:tblLayout w:type="fixed"\/>/g) || []).length >= 6);
  // Older browsers: no regex lookbehind anywhere in the app scripts
  const lookbehind = fs.readdirSync(path.join(ROOT, 'app/js')).filter(f => /\(\?<[=!]/.test(fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8')));
  check('no regex lookbehind (older Safari cannot parse it)', lookbehind.length === 0, lookbehind.join(', '));
  // Undo: a second Ctrl+Z while the first is running is ignored; undoing a #1 deletion clears the re-reading flags
  await tab(p, 'extract'); await p.waitForTimeout(400);
  await p.locator('#studyList .del').first().click(); await p.waitForTimeout(1000);
  const flaggedAfterDelete = await p.evaluate(() => state.clusters.filter(c => c.baselineChange).length);
  const n = await p.evaluate(async () => { pushUndoAction({ type: 'delete_log', label: 'x', log: { id: 'log_dummy', action: 'x', timestamp: 1 } }); state.undoStack.reverse(); const a = performUndo(); const b = performUndo(); await Promise.all([a, b]); return state.undoStack.length; });
  check('a fast second undo is ignored while the first runs', n === 1);
  const flaggedAfterUndo = await p.evaluate(() => state.clusters.filter(c => c.baselineChange).length);
  check('undoing the deletion of #1 clears the re-reading flags it caused', flaggedAfterDelete > 0 && flaggedAfterUndo === 0, `${flaggedAfterDelete} -> ${flaggedAfterUndo}`);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('eMERGe wording: structured around, not endorsed by', async () => {
  for (const f of ['site/index.html', 'site/manual.html', 'site/meta-ethnography-101.html']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    check(`${f}: states it is independent of eMERGe`, t.includes('not affiliated with, or endorsed by, the eMERGe project'));
  }
  const all = ['README.md', 'me_canvas.html', 'site/index.html', 'site/manual.html', 'site/meta-ethnography-101.html', 'app/js/export.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  check('no "eMERGe Methods Summary" (reads as an official eMERGe product)', !all.includes('eMERGe Methods Summary'));
  check('no "eMERGe Phases" (the phases are Noblit and Hare\'s)', !/eMERGe<\/em> Phases|eMERGe Phases/.test(all));
});

await group('Appraisal: CASP 2024 judgement on each question, never a score; no JBI text', async () => {
  const p = await openDemo();
  await tab(p, 'extract'); await p.waitForTimeout(400);
  await p.evaluate(async () => { await switchStudy(state.docs[0].id); state.isEditMetaMode = true; toggleMetaDockUI(); });
  await p.selectOption('#metaAppraisalTool', 'CASP'); await p.waitForTimeout(300);
  await p.evaluate(() => { document.getElementById('metaDomainBox').open = true; });
  check('CASP 2024: 10 questions, all answered Yes / No / Can\'t Tell', (await p.locator('#metaDomainList .dom-a').count()) === 10 && (await p.locator('#metaDomainList .dom-a').nth(9).locator('option').count()) === 4);
  check('sections and Consider prompts are shown', (await p.locator('#metaDomainList').textContent()).includes('Section C: Will the results help locally?') && (await p.locator('#metaDomainList details').count()) === 10);
  const before = await logCount(p);
  await p.locator('#metaDomainList .dom-a').first().selectOption('cant_tell'); await p.waitForTimeout(300);
  await p.locator('#metaDomainList .dom-note').first().fill('Aims stated only in the abstract');
  await p.locator('#metaDomainSummary textarea').nth(2).fill('Sampling frame not reported');
  await p.locator('#metaDomainList .dom-note').nth(1).click(); await p.waitForTimeout(300);
  const saved = await p.evaluate(() => ({ q1: state.docs[0].appraisalItems.CASP.q1, sum: state.docs[0].appraisalSummary.CASP }));
  check('judgement, reason and summary are saved', saved.q1.a === 'cant_tell' && saved.q1.note === 'Aims stated only in the abstract' && saved.sum.unk === 'Sampling frame not reported');
  check('each change is logged', (await logCount(p)) === before + 3);
  await p.selectOption('#metaAppraisalTool', 'JBI'); await p.waitForTimeout(300);
  check('JBI has no built-in questions (permission needed)', await p.evaluate(() => document.getElementById('metaDomainBox').classList.contains('hidden') && !APPRAISAL_CHECKLISTS.JBI));
  await p.selectOption('#metaAppraisalTool', 'CASP'); await p.waitForTimeout(300);
  check('switching tool keeps the earlier answers', (await p.locator('#metaDomainList .dom-a').first().inputValue()) === 'cant_tell');
  await tab(p, 'pub'); await p.locator('[data-pub=table1]').click(); await p.waitForTimeout(300);
  const t1 = await p.locator('#pubPreviewContainer').innerText();
  check('Table 1b lists judgement + reason, the questions and the summary', t1.includes('Table 1b') && t1.includes("Can't Tell — Aims stated only in the abstract") && t1.includes('Q10. How valuable is the research?') && t1.includes('Unknowns: Sampling frame not reported'));
  check('Table 1b credits CASP and its licence', t1.includes('Critical Appraisal Skills Programme (2024)') && t1.includes('CC BY-NC-SA 4.0'));
  check('no score anywhere (no "x/10", no total)', !/\b\d+\s*\/\s*10\b/.test(t1) && !/total score/i.test(t1));
  await p.locator('[data-pub=method]').click(); await p.waitForTimeout(300);
  const m = await p.locator('#pubPreviewContainer').innerText();
  check('Methods says the answers were not added up', m.includes('not added up into a score') && m.includes('Table 1b'));
  check('eMERGe Ext. 2 is "partly" until every question is answered', await p.evaluate(() => getEmergeChecklist().find(r => r.no === 'Ext. 2').level === 'partial'));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#downloadWordDocBtn')]);
  check('Word export includes Table 1b', readZipEntry(fs.readFileSync(await dl.path()), 'word/document.xml').includes('Table 1b. Methodological Strengths'));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
  const lic = fs.readFileSync(path.join(ROOT, 'app/checklists/casp-qualitative-2024.js'), 'utf8');
  check('the CASP file states its own licence (not MIT)', lic.includes('NOT COVERED BY THE MIT LICENCE') && lic.includes('CC BY-NC-SA 4.0') && fs.existsSync(path.join(ROOT, 'app/checklists/LICENSE-CASP.md')));
  const appText = fs.readdirSync(path.join(ROOT, 'app/js')).map(f => fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8')).join('\n');
  check('no JBI checklist wording in the app', !appText.includes('congruity between the stated philosophical perspective'));
});

await group('Translation: placements start unjudged; empty cells can say why; rows start by an explicit choice; within-study links', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await p.waitForTimeout(600);
  check('a project that already has rows is not asked (choice read from its rows)', await p.evaluate(() => seedChoice() === (state.clusters.some(c => c.autoSeeded) ? 'seed' : 'manual') && document.getElementById('seedChoiceModal').classList.contains('hidden')));
  // A new placement is not yet judged
  const placed = await p.evaluate(async () => {
    const c = state.clusters[0];
    const sec = state.annotations.find(a => a.type === 'second_order' && !isBaselineDocId(a.docId) && !a.clusterIds.includes(c.id));
    await assignSecondOrderToCluster(sec, c); renderMatrixView();
    return { rel: secRelation(sec, c.id), sym: contribSymbol([sec], c.id), id: sec.id, cid: c.id, label: clusterTranslationLabel(c) };
  });
  check('a new placement starts as "not yet judged" (○)', placed.rel === 'unjudged' && placed.sym === '○' && placed.label.includes('not yet judged'));
  await p.waitForTimeout(500);
  const idx = await p.evaluate(cid => [...document.querySelectorAll(`tr[data-cluster-id="${cid}"] .rel-select`)].findIndex(x => x.value === 'unjudged'), placed.cid);
  const sel = p.locator(`tr[data-cluster-id="${placed.cid}"] .rel-select`).nth(idx);
  await sel.selectOption('reciprocal'); await p.waitForTimeout(300);
  check('judging it is saved and logged', await p.evaluate(x => secRelation(state.annotations.find(a => a.id === x.id), x.cid) === 'reciprocal' && state.logs[0].toVal.includes('Reciprocal') && state.logs[0].fromVal.includes('Not yet judged'), placed));
  // Empty cell: different aspect
  const empty = p.locator('.empty-cell .empty-status').first();
  await empty.selectOption('other_aspect'); await p.waitForTimeout(300);
  await p.locator('.empty-cell .empty-note').first().fill('Discusses night handover, not staffing');
  await tab(p, 'pub'); await p.waitForTimeout(300);
  check('empty-cell status and note are saved and logged', await p.evaluate(() => state.clusters.some(c => Object.values(c.cellStatus).some(v => v.status === 'other_aspect' && v.note === 'Discusses night handover, not staffing')) && state.logs.some(l => l.category === 'relating_studies')));
  await p.locator('[data-pub=table2_grid]').click(); await p.waitForTimeout(300);
  const g = await p.locator('#pubPreviewContainer').innerText();
  check('Table 2b shows ◇ and the full legend', g.includes('◇') && g.includes('○ = placed, relation not yet judged') && g.includes('blank = not yet checked'));
  await p.locator('[data-pub=table2]').click(); await p.waitForTimeout(300);
  check('Table 2 names the study that addresses a different aspect', (await p.locator('#pubPreviewContainer').innerText()).includes('Addresses a different aspect of the topic:'));
  await p.locator('[data-pub=method]').click(); await p.waitForTimeout(300);
  check('Methods mentions the different-aspect cells', (await p.locator('#pubPreviewContainer').innerText()).includes('addressed a different aspect'));
  // Within-study links (Tab 1, top of the sidebar)
  await tab(p, 'extract'); await p.waitForTimeout(400);
  const docId = await p.evaluate(async () => { const d = state.docs.find(x => state.annotations.filter(a => a.type === 'second_order' && a.docId === x.id).length >= 2); await switchStudy(d.id); return d.id; });
  await p.waitForTimeout(400);
  check('the relationships box sits right under the study overview', await p.evaluate(() => { const l = document.getElementById('annotationsList'); return l.children[1] && l.children[1].classList.contains('study-links'); }));
  await p.evaluate(() => { document.querySelector('.study-links').open = true; });
  await p.locator('.study-links .cl-type').selectOption('contradicts');
  await p.locator('.study-links .cl-note').fill('p.6: the authors set these against each other');
  await p.locator('.study-links .cl-add').click(); await p.waitForTimeout(400);
  check('a relationship is saved and logged', await p.evaluate(id => state.docs.find(d => d.id === id).conceptLinks.length === 1 && state.logs[0].action.startsWith('Recorded how two concepts relate'), docId));
  await tab(p, 'pub'); await p.locator('[data-pub=appendix]').click(); await p.waitForTimeout(300);
  check('Appendix C lists it', (await p.locator('#pubPreviewContainer').innerText()).includes('Appendix C. Relationships between Concepts within Each Study'));
  await tab(p, 'matrix'); await p.waitForTimeout(500);
  check('Tab 2 context row shows it', (await p.locator('.matrix-context-row').innerText()).includes('How its concepts relate (1)'));
  // A new project asks how to start the rows
  await p.evaluate(() => { state.clusters = []; delete state.loa.seedChoice; renderMatrixView(); });
  await p.waitForTimeout(300);
  check('a project without rows asks how to start', await p.evaluate(() => !document.getElementById('seedChoiceModal').classList.contains('hidden')));
  await p.click('#seedChoiceManualBtn'); await p.waitForTimeout(500);
  check('choosing an empty matrix is recorded, logged and places nothing', await p.evaluate(() => state.loa.seedChoice === 'manual' && state.clusters.length === 0 && state.logs[0].toVal === 'Empty matrix' && !document.getElementById('autoSeedIndexToggle').checked));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Offline edition (file://) starts without errors and renders PDFs', async () => {
  const p = await openDemo('file://' + path.join(ROOT, 'me_canvas.html') + '?demo');
  await p.waitForTimeout(2500);
  check('PDF pages rendered', (await p.locator('#pdfPagesWrapper canvas').count()) > 0);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await browser.close();
server.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
