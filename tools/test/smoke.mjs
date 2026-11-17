// Smoke tests for Meta-Ethnography Canvas (Playwright + Chromium). Run: npm test
// First time on a machine: npx playwright install chromium
// Serves the repository folder on a local port and drives the ?demo project (its own IndexedDB, so nothing real is touched).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const group = async (name, fn) => {
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
