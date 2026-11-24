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

// ---- Waiting for the app instead of waiting a fixed time ----
// Every page counts what the app still has in flight: IndexedDB transactions, async event handlers, short timers, and the
// calls that render or switch (PDF pages, study switch). settle(p) waits until nothing is in flight, no debounced save is pending, no reason /
// choice dialog is waiting for the automatic answer, and this has stayed so for `quiet` ms (an async chain may pause between
// steps). Use it after an action; wait for a specific condition (waitForFunction) when the test is about that condition.
const BUSY_PROBE = () => {
  window.__mecBusy = 0;
  const open = window.__mecOpen = new Map(); // what is in flight, by label (named in the error when settle times out)
  const begin = label => {
    window.__mecBusy++; open.set(label, (open.get(label) || 0) + 1);
    let done = false;
    return () => { if (done) return; done = true; window.__mecBusy--; const n = open.get(label) - 1; if (n) open.set(label, n); else open.delete(label); };
  };
  const track = (r, label) => { if (r && typeof r.then === 'function') { const end = begin(label); r.then(end, end); } return r; };
  // IndexedDB transactions, until they complete
  const tx = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...a) {
    const t = tx.apply(this, a), end = begin('IndexedDB ' + [].concat(a[0]).join('+'));
    t.addEventListener('complete', end); t.addEventListener('error', end); t.addEventListener('abort', end);
    return t;
  };
  // Async event handlers (addEventListener and on… properties), until their promise settles
  const wrapped = new WeakMap();
  const wrap = fn => {
    if (typeof fn !== 'function') return fn;
    if (!wrapped.has(fn)) wrapped.set(fn, function (...a) { return track(fn.apply(this, a), 'handler ' + ((a[0] && a[0].type) || '') + ' ' + (fn.name || '')); });
    return wrapped.get(fn);
  };
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, o) { return add.call(this, type, wrap(fn), o); };
  EventTarget.prototype.removeEventListener = function (type, fn, o) { return remove.call(this, type, (typeof fn === 'function' && wrapped.get(fn)) || fn, o); };
  for (const proto of [HTMLElement.prototype, Document.prototype, Window.prototype]) {
    for (const prop of ['onclick', 'onchange', 'oninput', 'onkeydown', 'ondrop', 'onsubmit']) {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (d && d.set) Object.defineProperty(proto, prop, { ...d, set(fn) { d.set.call(this, wrap(fn)); } });
    }
  }
  // Short timers (debounced saves, focus moves, deferred redraws) count until they fire; long ones (notices) do not
  const st = window.setTimeout, ct = window.clearTimeout, ends = new Map();
  window.setTimeout = function (fn, ms, ...a) {
    if (typeof fn !== 'function' || (ms || 0) > 1000) return st.call(window, fn, ms, ...a);
    const end = begin('timer ' + (ms || 0) + 'ms ' + (fn.name || String(fn).slice(0, 60)));
    const id = st.call(window, (...b) => { ends.delete(id); try { track(fn(...b), 'timer callback ' + (fn.name || '')); } finally { end(); } }, ms, ...a);
    ends.set(id, end);
    return id;
  };
  window.clearTimeout = function (id) { const end = ends.get(id); if (end) { ends.delete(id); end(); } return ct.call(window, id); };
  // The app's own functions are globals of its classic scripts: wrapped once they are defined, before the app starts
  document.addEventListener('DOMContentLoaded', () => {
    for (const name of ['switchStudy', 'layoutPdfPages', 'renderPageContentNow', 'processPeerJsonFile']) {
      const f = window[name];
      if (typeof f === 'function') window[name] = function (...a) { return track(f.apply(this, a), name); };
    }
  }, { once: true });
};
async function settle(p, { quiet = 120, timeout = 20000 } = {}) {
  await p.evaluate(() => { window.__mecIdleSince = null; });
  await p.waitForFunction(auto => {
    const shown = id => { const e = document.getElementById(id); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const saving = typeof pendingSaveCleanups !== 'undefined' && [...pendingSaveCleanups].some(f => !f.isCommit);
    const busy = (window.__mecBusy || 0) > 0 || saving || (auto.auto && (shown('reasonModal') || shown('choiceModal')));
    const now = performance.now();
    if (busy) { window.__mecIdleSince = null; return false; }
    if (window.__mecIdleSince == null) window.__mecIdleSince = now;
    return now - window.__mecIdleSince >= auto.quiet;
  }, { auto: !!p.autoReason, quiet }, { polling: 'raf', timeout }).catch(async e => {
    const what = await p.evaluate(() => JSON.stringify([...(window.__mecOpen || new Map())])).catch(() => '?');
    throw new Error('settle: the app did not go idle; in flight: ' + what + ' (' + e.message.split('\n')[0] + ')');
  });
}

async function openDemo(url = BASE + '?demo') {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(BUSY_PROBE);
  const page = await ctx.newPage();
  page.pageErrors = [];
  page.on('pageerror', e => page.pageErrors.push(e.message));
  page.cspRefusals = []; // anything the Content-Security-Policy blocked
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) page.cspRefusals.push(m.text()); });
  page.on('dialog', d => d.accept());
  // The app asks for reasons in its own dialog (#reasonModal). Like the browser dialogs above, it is answered automatically
  // (page.reasonAnswer, default no reason) unless a test sets page.autoReason = false to drive it itself.
  // Choices (#choiceModal, e.g. clean restore / merge) likewise: page.choiceAnswer is the value to pick (default the first option).
  // A notice (the choice dialog with only OK) is acknowledged and its text kept in page.notices.
  page.autoReason = true; page.reasonAnswer = ''; page.choiceAnswer = null; page.notices = [];
  // One pass at a time: a pass still waiting to click (up to 1 s) must not overlap the next, or its click can land on the
  // NEXT dialog shown in the same place (e.g. "merge" picked for a later clean restore)
  let answering = false;
  const reasonLoop = setInterval(async () => {
    if (!page.autoReason || page.isClosed() || answering) return;
    answering = true;
    try {
      if (await page.isVisible('#reasonModal')) {
        await page.fill('#reasonModalInput', page.reasonAnswer);
        await page.click('#reasonModalConfirmBtn', { timeout: 1000 });
      }
      if (await page.isVisible('#choiceModal')) {
        if ((await page.locator('#choiceModalOptions .choice-option').count()) === 0) {
          page.notices.push(await page.innerText('#choiceModal'));
          await page.click('#choiceModalCancelBtn', { timeout: 1000 });
        } else {
          const want = page.choiceAnswer ? `#choiceModalOptions .choice-option[data-value="${page.choiceAnswer}"]` : '';
          await page.click(want && (await page.locator(want).count()) ? want : '#choiceModalOptions .choice-option', { timeout: 1000 });
        }
      }
    } catch (e) { /* page busy or closing */ } finally { answering = false; }
  }, 120);
  page.on('close', () => clearInterval(reasonLoop));
  await page.goto(url);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.docs && state.docs.length > 0, null, { timeout: 20000 });
  await settle(page);
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
    await tab(p, 'matrix'); await settle(p);
    const before = await logCount(p);
    await act();
    await tab(p, 'audit'); await settle(p);
    check(`${name} -> 1 log entry`, (await logCount(p)) - before === 1);
  }
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Row type is derived from cells; no per-row selector', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
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
    if (rn) { const m = {}; d.docs.forEach((x, i) => { m[x.id] = 'nw_' + i; x.id = 'nw_' + i; }); d.annotations.forEach(a => { a.docId = m[a.docId] || a.docId; }); }
    return JSON.stringify(d);
  }, renamed);
  const restore = async json => { await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await settle(p, { quiet: 300 }); };
  const keys = () => p.evaluate(async () => (await dbGetAllKeys('pdf_binaries')).sort());
  const orig = await keys();
  await restore(await payload(false));
  check('same-id restore keeps all PDFs', JSON.stringify(await keys()) === JSON.stringify(orig) && await p.evaluate(() => state.docs.every(d => d.hasBinary)));
  const before = await p.evaluate(() => ({ d: state.docs.length, a: state.annotations.length, l: state.logs.length }));
  // A write that fails part way (simulated: the first audit entry cannot be stored) must roll the restore back.
  // (A record without an id no longer fails a restore: malformed records are left out before anything is written.)
  await p.evaluate(() => { const o = window.dbPut; window.__failOnce = true; window.dbPut = async (st, it, op) => { if (st === 'logs' && window.__failOnce) { window.__failOnce = false; throw new Error('simulated write failure'); } return o(st, it, op); }; });
  await restore(await payload(true));
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
  await settle(p, { quiet: 300 });
  check('dialog lists 4 missing PDFs', (await p.locator('#missingPdfList li').count()) === 4);
  const demoDir = path.join(ROOT, 'app', 'demo');
  const pdfs = fs.readdirSync(demoDir).filter(f => f.endsWith('.pdf')).map(f => path.join(demoDir, f));
  const wrong = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mec-')), 'wrong-name.pdf');
  fs.copyFileSync(pdfs[0], wrong);
  const docsBefore = await p.evaluate(() => state.docs.length);
  await p.setInputFiles('#pdfFileInput', [wrong, pdfs[1]]); await settle(p, { quiet: 300 });
  check('unmatched file is listed', (await p.locator('#missingPdfUnmatchedList li').allInnerTexts()).join().includes('wrong-name.pdf'));
  check('unmatched file is not added as a study', (await p.evaluate(() => state.docs.length)) === docsBefore);
  check('one PDF reconnected', (await p.locator('#missingPdfList li').count()) === 3);
  const targetId = await p.evaluate(n => state.docs.find(d => d.name === n).id, path.basename(pdfs[0]));
  const options = await p.locator('.unmatched-assign option').allInnerTexts();
  check('picker lists the missing studies', options.length === 4, options.join('|'));
  await p.locator('.unmatched-assign').first().selectOption(targetId); await settle(p, { quiet: 300 });
  check('file connected by hand to the chosen study', await p.evaluate(id => state.docs.find(d => d.id === id).hasBinary, targetId));
  check('connected file leaves the unmatched list', (await p.locator('#missingPdfUnmatchedList li').count()) === 0 && (await p.locator('#missingPdfList li').count()) === 2);
  await p.setInputFiles('#pdfFileInput', pdfs.filter(f => f !== pdfs[0] && f !== pdfs[1])); await settle(p, { quiet: 300 });
  check('dialog closes when all are reconnected', await p.evaluate(() => document.getElementById('missingPdfModal').classList.contains('hidden')));
  await p.context().close();
});

await group('Rich★ sort: richness only, ties keep order, dialog for ties', async () => {
  const p = await openDemo();
  const order = () => p.evaluate(() => state.docs.map(d => d.id));
  await p.evaluate(() => { state.docs.forEach(d => { d.richness = 'Rich'; d.quality = 'Low'; }); state.docs[3].quality = 'High'; });
  const start = await order();
  await p.click('#sortStudiesRichBtn'); await settle(p);
  check('quality does not change the order', JSON.stringify(await order()) === JSON.stringify(start));
  check('tie dialog opens', await p.evaluate(() => !document.getElementById('richTieModal').classList.contains('hidden')));
  await p.locator('.tie-down').first().click();
  await p.fill('#richTieReason', 'closest to the question');
  await p.click('#richTieApplyBtn'); await settle(p);
  const manual = await order();
  check('manual order saved', JSON.stringify(manual) !== JSON.stringify(start));
  check('reason is reused in the Methods text', await p.evaluate(() => getMethodSections().some(s => (s.html || '').includes('closest to the question'))));
  await p.click('#sortStudiesRichBtn'); await settle(p);
  await p.click('#richTieKeepBtn');
  check('next sort keeps the manual order', JSON.stringify(await order()) === JSON.stringify(manual));
  await p.evaluate(() => { state.docs.forEach(d => { d.richness = ''; d.quality = ''; }); });
  await p.click('#sortStudiesRichBtn'); await settle(p);
  check('unrated studies are not offered as a tie', await p.evaluate(() => document.getElementById('richTieModal').classList.contains('hidden')));
  await p.context().close();
});

await group('Backup: timestamped file name and reminder badge', async () => {
  const p = await openDemo();
  await p.evaluate(async () => { await dbPut('meta', state.loa); });
  check('badge shows after a change', await p.evaluate(() => !document.getElementById('backupReminder').classList.contains('hidden')));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backupJsonBtn')]);
  check('file name ends with date_time to the second', /_\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await settle(p);
  check('badge clears after a backup', await p.evaluate(() => document.getElementById('backupReminder').classList.contains('hidden')));
  await p.context().close();
});

await group('Matrix with many studies: lazy rows keep the scroll position', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
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
  await settle(p);
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
  await tab(p, 'matrix'); await settle(p);
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
  await tab(p, 'matrix'); await settle(p);
  const h = sel => p.locator(sel).first().evaluate(el => el.offsetHeight);
  const long = n => Array.from({ length: n }, (_, i) => 'line ' + i + ' of a long interpretation').join('\n');
  const stepB = '.cluster-note';
  const h0 = await h(stepB);
  await p.locator(stepB).first().fill(long(25)); await settle(p);
  const h1 = await h(stepB);
  check('Step B grows with its text', h1 > h0 * 2, `from ${h0} to ${h1}`);
  await p.locator(stepB).first().fill(''); await settle(p);
  check('Step B shrinks back when emptied', (await h(stepB)) <= h0 + 2);
  await p.locator(stepB).first().fill(long(400)); await settle(p);
  const capped = await p.locator(stepB).first().evaluate(el => ({ h: el.offsetHeight, max: window.innerHeight * 0.6, scrolls: el.scrollHeight > el.clientHeight }));
  check('growth stops at 60% of the window, then scrolls', capped.h <= capped.max + 2 && capped.scrolls, JSON.stringify(capped));
  await p.locator('.sec-comment-view').first().click();
  const c0 = await h('.sec-comment-input:visible');
  await p.locator('.sec-comment-input:visible').fill(long(12)); await settle(p);
  check('cell note editor grows', (await h('.sec-comment-input:visible')) > c0 + 40);
  // a box that was hidden while its text was set is sized when it becomes visible
  await p.evaluate(() => { const t = document.querySelector('.cq-exp'); if (t && t.tagName === 'TEXTAREA') t.value = Array(15).fill('hidden text').join('\n'); });
  await p.locator('.cl-subtab-btn[data-subtab=cerqual]').first().click(); await settle(p);
  const hidden = await p.evaluate(() => { const t = document.querySelector('.cq-exp'); return t && t.tagName === 'TEXTAREA' ? t.scrollHeight <= t.clientHeight + 2 : true; });
  check('a box filled while hidden shows all its text once visible', hidden);
  await tab(p, 'audit'); await settle(p);
  const r0 = await h('.rationale-input');
  await p.locator('.rationale-input').first().fill(long(6)); await settle(p);
  check('audit-trail reason box grows', (await h('.rationale-input')) > r0 + 30);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Research Aim drawer scrolls; study storyline is visible; site version markers', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  await p.click('#toggleLoaDrawerBtn'); await settle(p);
  const d = await p.evaluate(() => { const e = document.getElementById('loaDrawer'); return { h: e.clientHeight, sh: e.scrollHeight, win: window.innerHeight, overflowY: getComputedStyle(e).overflowY }; });
  check('drawer is capped at 60% of the window', d.h <= d.win * 0.6 + 2, JSON.stringify(d));
  check('drawer scrolls when its content is taller', d.overflowY === 'auto' && d.sh > d.h, JSON.stringify(d));
  const reachable = await p.evaluate(() => { const e = document.getElementById('loaDrawer'); e.scrollTop = e.scrollHeight; const last = Array.from(e.querySelectorAll('textarea')).pop(); const r = last.getBoundingClientRect(), er = e.getBoundingClientRect(); return r.bottom <= er.bottom + 1 && r.top >= er.top - 1; });
  check('the last field can be reached', reachable);
  check('matrix stays visible below the drawer', await p.evaluate(() => document.getElementById('matrixTable').getBoundingClientRect().height > 0));
  await tab(p, 'extract'); await settle(p);
  await p.evaluate(() => { state.docs[0].studyOverview = 'A story of nights spent alone; key metaphor: the lone watch.'; updateDocHeaderUI(); });
  check('storyline box shows under the study header', await p.evaluate(() => !document.getElementById('docOverviewBox').classList.contains('hidden')) && (await p.locator('#docOverviewSummary').innerText()).includes('lone watch'));
  await p.click('#activeDocHeader'); await settle(p);
  check('it steps aside while the edit dock is open', await p.evaluate(() => document.getElementById('docOverviewBox').classList.contains('hidden')));
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'sync-version.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  check('every version marker on the site matches version.js', r.status === 0, (r.stdout || '') + (r.stderr || ''));
  await p.context().close();
});

await group('Theme column folds to a strip', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  const width = () => p.evaluate(() => document.querySelector('#matrixTable tbody tr[data-cluster-id] td:first-child').getBoundingClientRect().width);
  const wide = await width();
  await p.click('.theme-fold-btn'); await settle(p);
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
  await p.click('.theme-unfold-btn'); await settle(p);
  check('expands again', (await width()) >= 380);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Safety and accessibility', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(BUSY_PROBE);
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  await p.goto(BASE + '?demo'); await p.waitForFunction(() => typeof state !== 'undefined' && state.docs.length > 0); await settle(p);
  check('PDF.js eval and XFA are off', await p.evaluate(() => { const o = pdfjsDocumentOptions(); return o.isEvalSupported === false; }));
  check('single tab: no warning', await p.evaluate(() => document.getElementById('multiTabBanner').classList.contains('hidden')));
  const p2 = await ctx.newPage(); await p2.goto(BASE + '?demo');
  const bannerShown = pg => pg.waitForFunction(() => !document.getElementById('multiTabBanner').classList.contains('hidden'), null, { timeout: 10000 }).then(() => true, () => false);
  check('second tab: warning in both tabs', await bannerShown(p) && await bannerShown(p2));
  await p2.close();
  check('warning clears when the other tab closes', await p.waitForFunction(() => document.getElementById('multiTabBanner').classList.contains('hidden'), null, { timeout: 10000 }).then(() => true, () => false));
  await p.focus('#backupJsonBtn');
  await p.evaluate(() => { const m = document.getElementById('richTieModal'); m.classList.remove('hidden'); m.classList.add('flex'); });
  await settle(p);
  check('focus moves into a modal', await p.evaluate(() => document.getElementById('richTieModal').contains(document.activeElement)));
  await p.keyboard.press('Escape'); await settle(p);
  check('Esc closes it and focus returns', await p.evaluate(() => document.getElementById('richTieModal').classList.contains('hidden') && document.activeElement.id === 'backupJsonBtn'));
  for (const t of ['extract', 'matrix', 'audit', 'pub']) {
    await tab(p, t); await settle(p);
    const bad = await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => !(b.textContent || '').trim() && !b.getAttribute('aria-label')).length);
    check(`icon-only buttons have names (${t} tab)`, bad === 0, `missing=${bad}`);
  }
  await ctx.close();
});

await group('Undo history belongs to one workspace (reset / clean restore)', async () => {
  const p = await openDemo();
  await tab(p, 'extract'); await settle(p);
  await p.locator('#studyList .del').first().click(); await settle(p);
  check('deleting a study can be undone', await p.evaluate(() => state.undoStack.length) === 1);
  // In the demo the button resets the demo (asked first); the project reset itself is resetProject()
  p.autoReason = false;
  await p.evaluate(() => document.getElementById('resetProjectBtn').click());
  await p.waitForFunction(() => !document.getElementById('choiceModal').classList.contains('hidden'));
  check('in the demo, New / Reset offers to reset the demo', /Reset the demo/.test(await p.innerText('#choiceModal')));
  await p.click('#choiceModalCancelBtn'); p.autoReason = true; await settle(p);
  await p.evaluate(() => resetProject()); await settle(p, { quiet: 300 }); await p.keyboard.press('Escape');
  check('reset empties the undo stack', await p.evaluate(() => state.undoStack.length === 0 && document.getElementById('undoDeleteBtn').disabled));
  await p.evaluate(() => performUndo()); await settle(p);
  check('Ctrl+Z after reset brings nothing back', await p.evaluate(() => state.docs.length === 0 && state.annotations.length === 0));
  await p.context().close();
});

await group('Extracted text edits, attribution changes and late reasons leave a trace', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  let before = await logCount(p);
  await p.locator('.edit-cell-quote-btn').first().click();
  await p.locator('.cell-quote-textarea:visible').fill('Corrected passage text');
  await p.locator('.cell-quote-save:visible').click(); await settle(p);
  const ed = await p.evaluate(() => state.logs[0]);
  check('editing extracted text is logged with old and new wording', (await logCount(p)) === before + 1 && ed.action.includes('extracted text') && ed.toVal === 'Corrected passage text' && !!ed.fromVal);
  check('the entry is tagged with its row', (ed.clusterIds || []).length > 0);
  before = await logCount(p);
  p.reasonAnswer = 'NewRev';
  await p.locator('.cl-tools-toggle').first().click(); await p.locator('.cl-rev-btn').first().click(); await settle(p);
  p.reasonAnswer = '';
  const at = await p.evaluate(() => state.logs[0]);
  check('changing the attributed reviewer is logged', (await logCount(p)) === before + 1 && at.category === 'audit_edit' && at.toVal === '@NewRev');
  await tab(p, 'audit'); await settle(p);
  const ta = p.locator('.rationale-input').nth(3);
  await ta.fill('First reason'); await ta.blur(); await settle(p);
  await ta.fill('Second reason'); await ta.blur(); await settle(p);
  const lg = await p.evaluate(() => state.logs[3]);
  check('a later reason keeps its date and earlier wording', lg.rationale === 'Second reason' && !!lg.rationaleAt && lg.rationaleHistory?.[0]?.text === 'First reason');
  await tab(p, 'pub'); await p.locator('[data-pub=appendix]').click(); await settle(p);
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
  p.on('dialog', d => { alerts.push(d.message()); d.accept(); }); p.choiceAnswer = 'merge';
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await settle(p, { quiet: 300 });
  const after = await p.evaluate(() => ({ title: state.clusters[0].thirdOrderTitle, aim: state.loa.aim, n: state.annotations.length, log: state.logs[0] }));
  check('local row title and aim are kept', after.title === local.title && after.aim === local.aim);
  check('items only in the backup are added', after.n === local.n + 1);
  check('conflicts are reported and the merge is logged', p.notices.some(a => a.includes('Kept YOUR version')) && after.log.category === 'project_data' && after.log.detail.includes(local.title));
  await p.context().close();
});

await group('Changing study #1 marks the affected rows for re-reading', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  const before = await p.evaluate(() => state.docs[0].id);
  await p.evaluate(() => moveStudyOrder(1, 0)); await settle(p);
  const r = await p.evaluate(() => ({ flagged: state.clusters.filter(c => c.baselineChange).length, log: state.logs.find(l => l.action.startsWith('Study #1 changed')), first: state.docs[0].id, base: state.loa.baselineDocId }));
  check('#1 is remembered in the project', r.first !== before && r.base === r.first);
  check('rows are flagged and the change is logged per row', r.flagged > 0 && r.log && r.log.clusterIds.length === r.flagged);
  check('the row shows the warning', (await p.locator('.cl-baseline-warn').count()) > 0);
  await tab(p, 'pub'); await p.locator('[data-pub=table2]').click(); await settle(p);
  check('Table 2 notes the unreviewed rows', (await p.locator('#pubPreviewContainer').innerText()).includes('study #1 changed'));
  await tab(p, 'matrix'); await settle(p);
  await p.locator('.cl-baseline-ok').first().click(); await settle(p);
  check('marking a row as re-read clears it and is logged', (await p.evaluate(() => state.clusters.filter(c => c.baselineChange).length)) === r.flagged - 1 && (await p.evaluate(() => state.logs[0].action)).startsWith('Re-read row'));
  await p.context().close();
});

await group('Each row records the study that established it (◆); #1 is not the base of every row', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  const r = await p.evaluate(async () => {
    const d0 = state.docs[0].id, d2 = state.docs[2].id;
    const migrated = state.clusters.filter(c => clusterSecsIn(c).some(a => a.docId === d0)).every(c => rowBaseDocId(c) === d0);
    // A row started from a later study: that study establishes it, and study #1 is judged in it like any other study
    const later = state.annotations.find(a => a.type === 'second_order' && a.docId === d2);
    const first = state.annotations.find(a => a.type === 'second_order' && a.docId === d0);
    const c = await createNewClusterRow('Row from a later study');
    await assignSecondOrderToCluster(later, c);
    const lone = { type: clusterTranslationType(c), label: clusterTranslationLabel(c), sym: contribSymbol([later], c.id) };
    await assignSecondOrderToCluster(first, c);
    const firstRel = secRelation(first, c.id);
    first.clusterRelations[c.id] = 'refutational'; await dbPut('annotations', first);
    const map = buildRefutationMap();
    const entry = (map.studies.find(([id]) => id === d0) || [null, []])[1].find(it => it.cluster.id === c.id);
    renderMatrixView();
    return { migrated, base: c.baseDocId === d2, lone, firstRel, refut: isSecRefutational(first, c.id), sym: contribSymbol([first], c.id),
      type: clusterTranslationType(c), holders: entry ? entry.holders : [], d2, cid: c.id };
  });
  check('existing rows with a #1 construct keep #1 as their base', r.migrated);
  check('the first study placed in a new row establishes it', r.base && r.lone.sym === '◆');
  check('a row with one study is "Not yet translated", not Reciprocal', r.lone.type === 'untranslated' && r.lone.label.startsWith('Not yet translated'));
  check('study #1 placed in a row it did not establish starts unjudged', r.firstRel === 'unjudged');
  check('study #1 can be Refutational there', r.refut && r.sym === '⚡' && r.type === 'refutational');
  check('the Refutation Map contrasts it with the row\'s base', r.holders.includes(r.d2));
  await settle(p);
  await p.evaluate(cid => document.querySelector(`tr[data-cluster-id="${cid}"]`).scrollIntoView({ block: 'center' }), r.cid); await settle(p); // rows are built lazily
  await p.locator(`tr[data-cluster-id="${r.cid}"] .cl-tools-toggle`).click();
  const sel = p.locator(`tr[data-cluster-id="${r.cid}"] .cl-base-select`);
  await sel.selectOption(''); await settle(p);
  const nb = await p.evaluate(cid => { const c = clusterById(cid); return { base: c.baseDocId, rels: clusterSecsIn(c).map(a => secRelation(a, cid)), log: state.logs[0] }; }, r.cid);
  check('"No single base" makes every card judgeable, and is logged', nb.base === null && !nb.rels.includes('baseline') && nb.log.action.startsWith('Changed the study that established') && nb.log.toVal === 'No single base' && nb.log.clusterIds.includes(r.cid));
  await tab(p, 'pub'); await settle(p);
  await p.locator('[data-pub=method]').click(); await settle(p);
  const m = await p.locator('#pubPreviewContainer').innerText();
  check('Methods reports based and unbased rows', m.includes('established the row (◆ in Table 2b)') && m.includes('no single study established the row'));
  check('Methods does not claim ◇ cells informed the line of argument', !m.includes('these informed the line-of-argument synthesis'));
  await p.locator('[data-pub=table2_grid]').click(); await settle(p);
  const g = await p.locator('#pubPreviewContainer').innerText();
  check('Table 2b legend names the row\'s base and says the symbols are not a count', g.includes('◆ = the study whose construct established the row') && g.includes('not weights, scores or a count of support'));
  // A new #1 flags only rows established by the former #1, and the new #1 can be made the base from the warning
  await tab(p, 'matrix'); await settle(p);
  const f = await p.evaluate(async cid => {
    const c = clusterById(cid); c.baseDocId = state.docs[2].id; await dbPut('clusters', c);
    const oldFirst = state.docs[0].id;
    const expected = state.clusters.filter(x => x.baseDocId === oldFirst).map(x => x.id).sort();
    await moveStudyOrder(1, 0);
    return { expected, flagged: state.clusters.filter(x => x.baselineChange).map(x => x.id).sort(), laterFlagged: !!c.baselineChange };
  }, r.cid);
  check('only rows established by the former #1 are flagged', f.expected.length > 0 && JSON.stringify(f.expected) === JSON.stringify(f.flagged) && !f.laterFlagged);
  await settle(p);
  await p.evaluate(() => { const c = state.clusters.find(x => x.baselineChange && clusterSecsIn(x).some(a => a.docId === state.docs[0].id)); if (c) document.querySelector(`tr[data-cluster-id="${c.id}"]`).scrollIntoView({ block: 'center' }); }); await settle(p);
  const rebase = p.locator('.cl-baseline-rebase').first();
  if (await rebase.count()) {
    const cid = await rebase.evaluate(b => b.closest('tr').dataset.clusterId);
    await rebase.click(); await settle(p);
    check('"Make … the base" re-bases the row on the new #1 and clears its flag', await p.evaluate(cid => { const c = clusterById(cid); return c.baseDocId === state.docs[0].id && !c.baselineChange && state.logs[0].action.startsWith('Changed the study that established'); }, cid));
  } else check('a flagged row offers "Make … the base"', false, 'no button');
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Line of argument drawer lists the ◇ cells; only ticked ones are reported as used', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  const n = await p.evaluate(() => getOtherAspectCells().length);
  await p.click('#toggleLoaDrawerBtn'); await settle(p);
  check('every ◇ cell is listed in the drawer', n > 0 && (await p.locator('#loaAspectList .loa-aspect-use').count()) === n);
  await tab(p, 'pub'); await p.locator('[data-pub=method]').click(); await settle(p);
  check('nothing ticked: Methods asks, and claims no use', await p.evaluate(() => getOtherAspectCells().every(x => !x.used)) && (await p.locator('#pubPreviewContainer').innerText()).includes('whether and how these different aspects were used'));
  await tab(p, 'matrix'); await settle(p);
  if (!(await p.locator('#loaAspectList').isVisible())) { await p.click('#toggleLoaDrawerBtn'); await settle(p); }
  await p.locator('#loaAspectList .loa-aspect-use').first().check(); await settle(p);
  check('ticking is saved and logged with the row', await p.evaluate(() => getOtherAspectCells()[0].used && state.logs[0].category === 'line_of_argument' && state.logs[0].clusterIds.includes(getOtherAspectCells()[0].cluster.id)));
  await tab(p, 'pub'); await p.locator('[data-pub=method]').click(); await settle(p);
  check('Methods reports the ticked ones', (await p.locator('#pubPreviewContainer').innerText()).includes('the line-of-argument synthesis drew on'));
  await p.locator('[data-pub=table2]').click(); await settle(p);
  check('Table 2 marks it', (await p.locator('#pubPreviewContainer').innerText()).includes('(used in the line of argument)'));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Constructs not translated: reason in the pool, Appendix B, Methods; provisional agreement', async () => {
  const p = await openDemo();
  await p.evaluate(async () => { const s = state.annotations.find(a => a.type === 'second_order' && a.docId !== state.docs[0].id); s.clusterIds = []; await dbPut('annotations', s); });
  await tab(p, 'matrix'); await settle(p);
  await p.evaluate(() => document.querySelectorAll('.pool-nt').forEach(d => { d.open = true; }));
  const ntIdx = await p.evaluate(() => [...document.querySelectorAll('.pool-nt-input')].findIndex(x => !x.value));
  await p.locator('.pool-nt-input').nth(ntIdx).fill('Outside the review question');
  await tab(p, 'pub'); await settle(p);
  check('the reason is saved and logged', await p.evaluate(() => state.annotations.some(a => a.notTranslatedNote === 'Outside the review question') && state.logs[0].action.includes('not translated')));
  await p.locator('[data-pub=appendix]').click(); await settle(p);
  const app = await p.locator('#pubPreviewContainer').innerText();
  check('Appendix B lists it with the reason', app.includes('Appendix B') && app.includes('Outside the review question'));
  await p.locator('[data-pub=method]').click(); await settle(p);
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
  await p.locator('.cmp-doc-pick').selectOption({ index: 1 }); await settle(p);
  check('connecting it by hand re-matches its constructs', await p.evaluate(() => state.peerComparison.unmatchedPeerDocs.length === 0 && state.peerComparison.matchedStudies.some(m => m.how === 'manual')) && (await p.evaluate(() => state.peerComparison.matchedPairs.length)) > before);
  const d = await run({ swapFirst: true });
  check('a different #1 is shown as something to discuss', d.firstDiffers && d.tab === 'studies' && (await p.locator('.cmp-order-memo').count()) === 1);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Refutation map gathers the ⚡ cards by study', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  // Make sure there is one refutational card outside study #1
  await p.evaluate(async () => {
    const s = state.annotations.find(a => a.type === 'second_order' && a.docId !== state.docs[0].id && a.clusterIds.length);
    s.clusterRelations[s.clusterIds[0]] = 'refutational'; await dbPut('annotations', s);
  });
  const m = await p.evaluate(() => { const r = buildRefutationMap(); return { studies: r.studies.length, pairs: r.pairList.length, okPairs: r.pairList.every(x => x.r !== x.h) }; });
  check('studies and pairs are derived from the cells', m.studies > 0 && m.pairs > 0 && m.okPairs);
  await p.click('#refutMapBtn'); await settle(p);
  const txt = await p.locator('#refutMapBody').innerText();
  check('the map opens and lists pairs and studies', txt.includes('Studies in tension') && txt.includes('By study') && txt.includes('contrasts with'));
  await p.locator('.refut-row-link').first().click(); await settle(p);
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

await group('Compare: bulk import comes in as Discuss; Big Q wording in the exports', async () => {
  const p = await openDemo();
  await p.evaluate(async () => {
    const peer = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, reviewerId: 'Peer' }));
    const base = peer.annotations.find(a => a.type === 'second_order');
    ['bulk_a', 'bulk_b'].forEach((id, i) => peer.annotations.push({ ...base, id, text: `Only the peer read this passage, number ${i} ${id}`, clusterIds: [], clusterRelations: {}, clusterComments: {} }));
    await processPeerJsonFile(new File([JSON.stringify(peer)], 'peer.json'));
    setCompareTab('unique'); renderComparisonTabContent();
  });
  await settle(p);
  check('the bulk button imports as Discuss', (await p.locator('#importAllPeerBtn').innerText()).includes('Import All as Discuss'));
  await p.evaluate(() => document.getElementById('importAllPeerBtn').click()); await settle(p);
  check('bulk-imported constructs are "Discuss", not agreed', await p.evaluate(() => { const got = state.annotations.filter(a => /^Only the peer read this passage/.test(a.text)); return got.length === 2 && got.every(a => a.concordanceStatus === 'discuss'); }));
  const code = ['compare.js', 'export.js'].map(f => fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8')).join('\n');
  check('no "Resolution Mode", "Inter-Reviewer Agreement", "discrepancies were resolved" or "Concordance:" label', !/Resolution Mode|Inter-Reviewer Agreement|discrepancies were resolved|Concordance:/.test(code));
  const pages = ['site/index.html', 'site/meta-ethnography-101.html', 'README.md'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + code;
  check('no "raw participant quotes", "real data" or "coding full-text PDFs"', !/raw participant quote|grounded in real data|coding full-text PDFs/.test(pages));
  const site = ['site/index.html', 'site/manual.html', 'site/meta-ethnography-101.html'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  check('site: no "simply groups", "orders of data", "rigorous meta-ethnography", "Divergent Interpretations", "settled together", "Combining findings" or a sort that sets the Index Paper', !/simply groups|\(\"orders\"\) of data|"orders"\) of data|rigorous meta-ethnography|Divergent Interpretations|settled together|Combining findings|to set your <strong>Index Paper/.test(site));
  const app = fs.readdirSync(path.join(ROOT, 'app/js')).map(f => fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8')).join('\n') + fs.readFileSync(path.join(ROOT, 'me_canvas.html'), 'utf8');
  check('no "consensus", "deviant case", "sampling bias", "was resolved", "weighted", "reflexivity was handled" or "reviewer concordance" in the app', !/consensus|deviant case|sampling bias|was resolved|weighted|reflexivity was handled|reviewer concordance/i.test(app));
  // The demo's audit trail is shown in Tab 3 and Appendix A: no wording from earlier versions of the app either
  const demoLogs = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/demo/AI-GENERATED_demo-project.json'), 'utf8')).logs.map(l => [l.action, l.detail, l.fromVal, l.toVal].join(' ')).join('\n');
  check('demo audit trail: no "Inter-Reviewer Agreement", "Concept Cluster", "consensus", "resolved" or per-row "Translation Type"', !/inter-reviewer|inter-rater|concept cluster|consensus|resolved|discrepanc|Changed Translation Type/i.test(demoLogs));
  check('no "Concept Cluster" / "Order Cluster", appraisal "weighting", or "team agreement" in the app', !/Concept Cluster|Order Cluster|weighting, sensitivity|team agreement/i.test(app));
  check('project setup and aim edits are logged as Phase 1, not Line of Argument', await p.evaluate(() => state.logs.filter(l => l.action.startsWith('Configured Project')).every(l => l.category === 'aim_question') && state.logs.some(l => l.category === 'aim_question') && getCategoryMeta('aim_question').label.startsWith('Phase 1')) && (await p.locator('#auditFilterCategory option[value=aim_question]').count()) === 1);
  await tab(p, 'pub'); await p.locator('[data-pub=method]').click(); await settle(p);
  const m = await p.locator('#pubPreviewContainer').innerText();
  check('Methods: no ratio of refutational placements; heading says Quality, not Rigor', !/judged placements of a construct/.test(m) && m.includes('Quality, Reflexivity, and Confidence in Findings') && !m.includes('Rigor'));
  check('demo CERQual: an explained difference is not a coherence concern (adequacy carries it)', await p.evaluate(() => { const c = state.clusters.find(x => x.thirdOrderTitle === 'Responsibility without back-up'); return c.cerqualCoherence === 'Minor' && c.cerqualAdequacy === 'Moderate' && !/not fully consistent/.test(c.cerqualCohNote); }));
  check('Methods: no doubled full stop after the aim or question, and "each … finding" is singular', !/[.?!]\.(\s|$)/.test(m) && !/each synthesized third-order findings/.test(m) && !/instance\(s\)/.test(m));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes: peer rows by title, merge links, PDF search race, Word widths, older browsers, undo', async () => {
  const p = await openDemo();
  // Peer construct placed in a row that exists here under another id but the same title
  const placed = await p.evaluate(async () => {
    const peer = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, reviewerId: 'Peer' }));
    const row = peer.clusters[0], oldId = row.id; row.id = 'peer_row_x'; row.thirdOrderTitle = '  ' + row.thirdOrderTitle.toUpperCase() + ' ';
    const sec = peer.annotations.find(a => a.type === 'second_order' && a.docId !== state.docs[0].id);
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
  p.removeAllListeners('dialog'); p.on('dialog', d => d.accept()); p.choiceAnswer = 'merge';
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await settle(p, { quiet: 300 });
  const tidy = await p.evaluate(() => { const s = state.annotations.find(a => a.id === 'm_sec'), q = state.annotations.find(a => a.id === 'm_quote'); return { c: s.clusterIds, r: Object.keys(s.clusterRelations), q: q.parentIds }; });
  check('merged items keep only links to rows and constructs that exist', tidy.c.length === 1 && !tidy.r.includes('ghost_row') && tidy.q.length === 1 && tidy.q[0] !== 'ghost_sec', JSON.stringify(tidy));
  p.removeAllListeners('dialog'); p.on('dialog', d => d.accept()); p.choiceAnswer = null;
  // PDF search: switching study while indexing never stores one paper's text under another
  await tab(p, 'extract'); await settle(p);
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
  await tab(p, 'pub'); await settle(p);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#downloadWordDocBtn')]);
  const xml = readZipEntry(fs.readFileSync(await dl.path()), 'word/document.xml');
  const cols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map(m => +m[1]);
  check('Word tables have column widths (no 100-twip grid)', cols.length > 20 && cols.every(w => w > 300), `min=${Math.min(...cols)} n=${cols.length}`);
  check('Word tables use a fixed layout', (xml.match(/<w:tblLayout w:type="fixed"\/>/g) || []).length >= 6);
  const cellW = (xml.match(/<w:tcW w:type="dxa" w:w="\d+"\/>|<w:tcW w:w="\d+" w:type="dxa"\/>/g) || []).length;
  check('every Word table cell states its width too (LibreOffice / older Word ignore the grid alone)', cellW > 50 && cellW === (xml.match(/<w:tc>/g) || []).length, `tcW=${cellW} tc=${(xml.match(/<w:tc>/g) || []).length}`);
  // Older browsers: no regex lookbehind anywhere in the app scripts
  const lookbehind = fs.readdirSync(path.join(ROOT, 'app/js')).filter(f => /\(\?<[=!]/.test(fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8')));
  check('no regex lookbehind (older Safari cannot parse it)', lookbehind.length === 0, lookbehind.join(', '));
  // Undo: a second Ctrl+Z while the first is running is ignored; undoing a #1 deletion clears the re-reading flags
  await tab(p, 'extract'); await settle(p);
  await p.locator('#studyList .del').first().click(); await settle(p);
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
  await tab(p, 'extract'); await settle(p);
  await p.evaluate(async () => { await switchStudy(state.docs[0].id); state.isEditMetaMode = true; toggleMetaDockUI(); });
  await p.selectOption('#metaAppraisalTool', 'CASP'); await settle(p);
  await p.evaluate(() => { document.getElementById('metaDomainBox').open = true; });
  check('CASP 2024: 10 questions, all answered Yes / No / Can\'t Tell', (await p.locator('#metaDomainList .dom-a').count()) === 10 && (await p.locator('#metaDomainList .dom-a').nth(9).locator('option').count()) === 4);
  check('sections and Consider prompts are shown', (await p.locator('#metaDomainList').textContent()).includes('Section C: Will the results help locally?') && (await p.locator('#metaDomainList details').count()) === 10);
  const before = await logCount(p);
  await p.locator('#metaDomainList .dom-a').first().selectOption('cant_tell'); await settle(p);
  await p.locator('#metaDomainList .dom-note').first().fill('Aims stated only in the abstract');
  await p.locator('#metaDomainSummary textarea').nth(2).fill('Sampling frame not reported');
  await p.locator('#metaDomainList .dom-note').nth(1).click(); await settle(p);
  const saved = await p.evaluate(() => ({ q1: state.docs[0].appraisalItems.CASP.q1, sum: state.docs[0].appraisalSummary.CASP }));
  check('judgement, reason and summary are saved', saved.q1.a === 'cant_tell' && saved.q1.note === 'Aims stated only in the abstract' && saved.sum.unk === 'Sampling frame not reported');
  check('each change is logged', (await logCount(p)) === before + 3);
  await p.selectOption('#metaAppraisalTool', 'JBI'); await settle(p);
  check('JBI has no built-in questions (permission needed)', await p.evaluate(() => document.getElementById('metaDomainBox').classList.contains('hidden') && !APPRAISAL_CHECKLISTS.JBI));
  await p.selectOption('#metaAppraisalTool', 'CASP'); await settle(p);
  check('switching tool keeps the earlier answers', (await p.locator('#metaDomainList .dom-a').first().inputValue()) === 'cant_tell');
  await tab(p, 'pub'); await p.locator('[data-pub=table1]').click(); await settle(p);
  const t1 = await p.locator('#pubPreviewContainer').innerText();
  check('Table 1b lists judgement + reason, the questions and the summary', t1.includes('Table 1b') && t1.includes("Can't Tell — Aims stated only in the abstract") && t1.includes('Q10. How valuable is the research?') && t1.includes('Unknowns: Sampling frame not reported'));
  check('Table 1b credits CASP and its licence', t1.includes('Critical Appraisal Skills Programme (2024)') && t1.includes('CC BY-NC-SA 4.0'));
  check('no score anywhere (no "x/10", no total)', !/\b\d+\s*\/\s*10\b/.test(t1) && !/total score/i.test(t1));
  await p.locator('[data-pub=method]').click(); await settle(p);
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
  await tab(p, 'matrix'); await settle(p);
  check('a project that already has rows is not asked (choice read from its rows)', await p.evaluate(() => seedChoice() === (state.clusters.some(c => c.autoSeeded) ? 'seed' : 'manual') && document.getElementById('seedChoiceModal').classList.contains('hidden')));
  // A new placement is not yet judged
  const placed = await p.evaluate(async () => {
    const c = state.clusters[0];
    const sec = state.annotations.find(a => a.type === 'second_order' && a.docId !== state.docs[0].id && !a.clusterIds.includes(c.id));
    await assignSecondOrderToCluster(sec, c); renderMatrixView();
    return { rel: secRelation(sec, c.id), sym: contribSymbol([sec], c.id), id: sec.id, cid: c.id, label: clusterTranslationLabel(c) };
  });
  check('a new placement starts as "not yet judged" (○)', placed.rel === 'unjudged' && placed.sym === '○' && placed.label.includes('not yet judged'));
  await settle(p);
  const idx = await p.evaluate(cid => [...document.querySelectorAll(`tr[data-cluster-id="${cid}"] .rel-select`)].findIndex(x => x.value === 'unjudged'), placed.cid);
  const sel = p.locator(`tr[data-cluster-id="${placed.cid}"] .rel-select`).nth(idx);
  await sel.selectOption('reciprocal'); await settle(p);
  check('judging it is saved and logged', await p.evaluate(x => secRelation(state.annotations.find(a => a.id === x.id), x.cid) === 'reciprocal' && state.logs[0].toVal.includes('Reciprocal') && state.logs[0].fromVal.includes('Not yet judged'), placed));
  // Empty cell: different aspect
  const empty = p.locator('.empty-cell .empty-status').first();
  await empty.selectOption('other_aspect'); await settle(p);
  await p.locator('.empty-cell .empty-note').first().fill('Discusses night handover, not staffing');
  await tab(p, 'pub'); await settle(p);
  check('empty-cell status and note are saved and logged', await p.evaluate(() => state.clusters.some(c => Object.values(c.cellStatus).some(v => v.status === 'other_aspect' && v.note === 'Discusses night handover, not staffing')) && state.logs.some(l => l.category === 'relating_studies')));
  await p.locator('[data-pub=table2_grid]').click(); await settle(p);
  const g = await p.locator('#pubPreviewContainer').innerText();
  check('Table 2b shows ◇ and the full legend', g.includes('◇') && g.includes('○ = placed, relation not yet judged') && g.includes('blank = not yet checked'));
  await p.locator('[data-pub=table2]').click(); await settle(p);
  check('Table 2 names the study that addresses a different aspect', (await p.locator('#pubPreviewContainer').innerText()).includes('Addresses a different aspect of the topic:'));
  await p.locator('[data-pub=method]').click(); await settle(p);
  check('Methods mentions the different-aspect cells', (await p.locator('#pubPreviewContainer').innerText()).includes('addressed a different aspect'));
  // Within-study links (Tab 1, top of the sidebar)
  await tab(p, 'extract'); await settle(p);
  const docId = await p.evaluate(async () => { const d = state.docs.find(x => state.annotations.filter(a => a.type === 'second_order' && a.docId === x.id).length >= 2); await switchStudy(d.id); return d.id; });
  await settle(p);
  check('the relationships box sits right under the study overview', await p.evaluate(() => { const l = document.getElementById('annotationsList'); return l.children[1] && l.children[1].classList.contains('study-links'); }));
  await p.evaluate(() => { document.querySelector('.study-links').open = true; });
  const linksBefore = await p.evaluate(id => (state.docs.find(d => d.id === id).conceptLinks || []).length, docId);
  await p.locator('.study-links .cl-type').selectOption('mutual');
  await p.locator('.study-links .cl-note').fill('p.6: the authors set these against each other');
  await p.locator('.study-links .cl-add').click(); await settle(p);
  check('a relationship is saved and logged', await p.evaluate(x => state.docs.find(d => d.id === x.docId).conceptLinks.length === x.linksBefore + 1 && state.logs[0].action.startsWith('Recorded how two concepts relate'), { docId, linksBefore }));
  await tab(p, 'pub'); await p.locator('[data-pub=appendix]').click(); await settle(p);
  check('Appendix C lists it', (await p.locator('#pubPreviewContainer').innerText()).includes('Appendix C. Relationships between Concepts within Each Study'));
  await tab(p, 'matrix'); await settle(p);
  check('Tab 2 context row shows it', (await p.locator('.matrix-context-row').innerText()).includes(`How its concepts relate (${linksBefore + 1})`));
  // A new project asks how to start the rows
  await p.evaluate(() => { state.clusters = []; delete state.loa.seedChoice; renderMatrixView(); });
  await settle(p);
  check('a project without rows asks how to start', await p.evaluate(() => !document.getElementById('seedChoiceModal').classList.contains('hidden')));
  await p.click('#seedChoiceManualBtn'); await settle(p);
  check('choosing an empty matrix is recorded, logged and places nothing', await p.evaluate(() => state.loa.seedChoice === 'manual' && state.clusters.length === 0 && state.logs[0].toVal === 'Empty matrix' && !document.getElementById('autoSeedIndexToggle').checked));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Demo shows a worked example of each newer feature', async () => {
  const p = await openDemo();
  const r = await p.evaluate(() => ({
    unjudged: state.annotations.some(a => a.type === 'second_order' && liveClusterIds(a).some(id => secRelation(a, id) === 'unjudged')),
    other: state.clusters.some(c => Object.values(c.cellStatus || {}).some(v => v.status === 'other_aspect')),
    absent: state.clusters.some(c => Object.values(c.cellStatus || {}).some(v => v.status === 'absent')),
    links: state.docs.filter(d => (d.conceptLinks || []).length).length,
    casp: state.docs.every(d => appraisalDomainsComplete(d)),
    nt: state.annotations.some(a => a.notTranslatedNote),
    seed: state.loa.seedChoice
  }));
  check('a placement not yet judged (○)', r.unjudged);
  check('empty cells: different aspect (◇) and not addressed (—)', r.other && r.absent);
  check('within-study relationships in several studies', r.links >= 3);
  check('CASP judgements for every study', r.casp);
  check('a reason for a construct left out of every row', r.nt);
  check('the start choice is recorded', r.seed === 'manual');
  const notice = fs.readFileSync(path.join(ROOT, 'app/demo/demo-data.js'), 'utf8').slice(0, 200);
  check('demo data stays labelled AI-generated', notice.includes('AI-GENERATED FICTIONAL DEMO DATA'));
  await p.context().close();
});

await group('A renamed PDF reconnects by its fingerprint; website shows the app and the current outputs', async () => {
  const p = await openDemo();
  await p.waitForFunction(() => state.docs.filter(d => d.hasBinary).every(d => d.fpDone && d.sha256), null, { timeout: 30000 });
  const r = await p.evaluate(async () => {
    const d = state.docs[2];
    const rec = await dbGet('pdf_binaries', d.id);
    const bytes = rec.data.slice(0);
    await dbDelete('pdf_binaries', d.id); d.hasBinary = false; await dbPut('docs', d);
    const n = state.docs.length;
    await handleFiles([new File([bytes], 'completely-different-name.pdf', { type: 'application/pdf' })]);
    return { attached: d.hasBinary, sameCount: state.docs.length === n, stored: !!(await dbGet('pdf_binaries', d.id)) };
  });
  check('the identical PDF under another name reconnects to its study', r.attached && r.stored && r.sameCount);
  await p.context().close();
  const index = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  const manual = fs.readFileSync(path.join(ROOT, 'site/manual.html'), 'utf8');
  check('the overview page shows a screenshot of the app', /<img src="img\/03-matrix\.png"/.test(index));
  check('the social-media card image exists', fs.existsSync(path.join(ROOT, 'site/preview.png')));
  check('every screenshot the pages use exists', [...(index + manual).matchAll(/src="(img\/[^"]+)"/g)].every(m => fs.existsSync(path.join(ROOT, 'site', m[1]))));
  check('the overview lists Table 1b and Appendices B and C', ['Table 1b', 'Appendix B', 'Appendix C'].every(t => index.includes(t)));
  check('two main buttons in the hero', (index.slice(index.indexOf('<section'), index.indexOf('</section>')).match(/rounded-xl[^"]*transition"/g) || []).length === 2);
  check('no outdated table count or file-name-only reconnect', !manual.includes('all five tables') && !index.includes('reconnect them by filename'));
  check('site Tailwind pinned to an exact version', !/@tailwindcss\/browser@4"/.test(index + manual + fs.readFileSync(path.join(ROOT, 'site/meta-ethnography-101.html'), 'utf8')));
});

await group('Layout at laptop widths: no overlap in the header or view toolbars, nothing cut off', async () => {
  const p = await openDemo();
  const measure = () => p.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null && !el.closest('details:not([open]) > :not(summary)'); };
    const out = [];
    const hdr = document.querySelector('header');
    const regions = [...hdr.children].map(c => { const rs = [...c.querySelectorAll('*')].filter(e => vis(e) && !e.closest('#settingsDropdown')).map(e => e.getBoundingClientRect()); return rs.length ? { l: Math.min(...rs.map(r => r.left)), r: Math.max(...rs.map(r => r.right)) } : null; }).filter(Boolean);
    for (let i = 0; i < regions.length - 1; i++) if (regions[i].r > regions[i + 1].l + 1) out.push('header regions overlap');
    const ctrls = [...document.querySelectorAll('header button, header input, header label, #saveStatusBadge, .view-toolbar button, .view-toolbar label, .view-toolbar select, .view-toolbar > div button')].filter(vis);
    ctrls.forEach(e => { const r = e.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) out.push('cut off: ' + (e.id || e.textContent.trim().slice(0, 20))); });
    for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
      const a = ctrls[i], c = ctrls[j]; if (a.contains(c) || c.contains(a)) continue;
      const A = a.getBoundingClientRect(), C = c.getBoundingClientRect();
      if (Math.min(A.right, C.right) - Math.max(A.left, C.left) > 2 && Math.min(A.bottom, C.bottom) - Math.max(A.top, C.top) > 2) out.push(`overlap: ${a.id || a.textContent.trim().slice(0, 15)} × ${c.id || c.textContent.trim().slice(0, 15)}`);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page scrolls sideways');
    return [...new Set(out)];
  });
  const problems = [];
  for (const w of [1024, 1280, 1366, 1440]) {
    await p.setViewportSize({ width: w, height: 800 });
    for (const t of ['extract', 'matrix', 'audit', 'pub']) {
      await tab(p, t); await settle(p);
      (await measure()).forEach(x => problems.push(`${w}px ${t}: ${x}`));
    }
  }
  check('no overlap or cut-off controls at 1024–1440 px', problems.length === 0, problems.slice(0, 5).join(' | '));
  await p.setViewportSize({ width: 1024, height: 800 }); await tab(p, 'extract'); await settle(p);
  check('the PDF toolbar stays inside the PDF pane', await p.evaluate(() => { const bar = document.getElementById('zoomOutBtn').parentElement, pane = document.getElementById('pdfViewerContainer'); const b = bar.getBoundingClientRect(), q = pane.getBoundingClientRect(); return b.left >= q.left - 1 && b.right <= q.right + 1; }));
  check('shortened tab labels keep the full name as a tooltip', await p.evaluate(() => document.getElementById('viewPubBtn').title === '4. Export Tables'));
  await p.context().close();
  const pages = ['index.html', 'manual.html', 'meta-ethnography-101.html'].map(f => fs.readFileSync(path.join(ROOT, 'site', f), 'utf8'));
  check('website uses its prebuilt Tailwind CSS, not a CDN', pages.every(h => h.includes('href="css/tailwind.css"') && !/tailwindcss\/browser|unpkg\.com/.test(h)) && fs.existsSync(path.join(ROOT, 'site/css/tailwind.css')));
  const css = fs.readFileSync(path.join(ROOT, 'site/css/tailwind.css'), 'utf8');
  check('the prebuilt CSS has the classes the pages use', ['shadow-xs', 'min-w-0', 'bg-indigo-700'].every(c => css.includes('.' + c)));
});

await group('A placed card can be judged ◇ Different aspect: symbol, row label, line-of-argument list, Table 2', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  const t = await p.evaluate(() => {
    const c = state.clusters.find(x => clusterSecsTranslated(x).some(a => secRelation(a, x.id) === 'reciprocal'));
    const sec = clusterSecsTranslated(c).find(a => secRelation(a, c.id) === 'reciprocal');
    return { cid: c.id, sid: sec.id };
  });
  await p.evaluate(cid => document.querySelector(`tr[data-cluster-id="${cid}"]`).scrollIntoView({ block: 'center' }), t.cid); await settle(p);
  const sel = p.locator(`tr[data-cluster-id="${t.cid}"] .rel-select`);
  const idx = await p.evaluate(x => { const c = clusterById(x.cid); const secs = state.docs.flatMap(d => state.annotations.filter(a => a.type === 'second_order' && a.docId === d.id && (a.clusterIds || []).includes(c.id) && secRelation(a, c.id) !== 'baseline')); return secs.findIndex(a => a.id === x.sid); }, t);
  check('the judgement menu offers ◇ Different aspect', (await sel.nth(Math.max(idx, 0)).locator('option[value=other_aspect]').count()) === 1);
  await p.evaluate(async x => { const s = state.annotations.find(a => a.id === x.sid); s.clusterRelations[x.cid] = 'other_aspect'; await dbPut('annotations', s); renderMatrixView(); }, t);
  const r = await p.evaluate(x => { const s = state.annotations.find(a => a.id === x.sid), c = clusterById(x.cid); return { rel: secRelation(s, x.cid), sym: contribSymbol([s], x.cid), label: clusterTranslationLabel(c), refut: isSecRefutational(s, x.cid), listed: getOtherAspectCells().some(y => y.sec && y.sec.id === x.sid) }; }, t);
  check('it shows ◇ in the grid and is neither reciprocal nor refutational', r.rel === 'other_aspect' && r.sym === '◇' && !r.refut);
  check('the row label counts it', /different aspect/.test(r.label));
  check('it is listed beside the line of argument', r.listed);
  await p.click('#toggleLoaDrawerBtn'); await settle(p);
  const i = await p.evaluate(x => getOtherAspectCells().findIndex(y => y.sec && y.sec.id === x.sid), t);
  await p.locator('#loaAspectList .loa-aspect-use').nth(i).check(); await settle(p);
  check('ticking it records that the line of argument draws on it', await p.evaluate(x => !!state.annotations.find(a => a.id === x.sid).aspectUsedInLoa[x.cid] && state.logs[0].category === 'line_of_argument', t));
  await tab(p, 'pub'); await p.locator('[data-pub=table2]').click(); await settle(p);
  check('Table 2 tags it, and says it is used', (await p.locator('#pubPreviewContainer').innerText()).includes('[◇ Different aspect, used in the line of argument]'));
  // A row whose judged cards are all ◇ is "Different aspects only"
  const only = await p.evaluate(x => { const c = clusterById(x.cid); clusterSecsTranslated(c).forEach(a => { a.clusterRelations[c.id] = 'other_aspect'; }); return clusterTranslationLabel(c); }, t);
  check('a row with only ◇ judgements reads "Different aspects only"', only.startsWith('Different aspects only'));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Rows can be merged and split: judgements, texts, map relations and history travel; Ctrl+Z restores', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  const snap = () => p.evaluate(() => JSON.stringify({ c: state.clusters.map(c => ({ ...c })), a: state.annotations.filter(x => x.type === 'second_order'), l: state.loa.links || [] }));
  await p.evaluate(async () => { state.loa = { ...state.loa, links: [{ id: 'lk1', from: state.clusters[1].id, to: state.clusters[2].id, type: 'leads' }, { id: 'lk2', from: state.clusters[0].id, to: state.clusters[1].id, type: 'mutual' }] }; await dbPut('meta', state.loa); });
  const before = await snap();
  // Open the dialog from the row header (UI path), then merge row 2 into row 1
  await p.locator('.cl-tools-toggle').first().click(); await p.locator('.cl-rowops').first().click(); await settle(p);
  check('the merge / split dialog opens from the row header', await p.evaluate(() => !document.getElementById('rowOpsModal').classList.contains('hidden')));
  await p.click('#rowOpsCloseBtn');
  const m = await p.evaluate(async () => {
    const [tgt, src] = [state.clusters[0], state.clusters[1]];
    const srcSecs = rowSecs(src).map(s => ({ id: s.id, rel: (s.clusterRelations || {})[src.id] || null }));
    const srcTitle = clusterLabel(src), srcId = src.id, srcStepA = src.translationSummary;
    await mergeRows(src, tgt, 'Both rows describe the same burden');
    const log = state.logs[0];
    return {
      gone: !state.clusters.some(c => c.id === srcId),
      cardsMoved: srcSecs.every(x => { const a = state.annotations.find(y => y.id === x.id); return a.clusterIds.includes(tgt.id) && !a.clusterIds.includes(srcId); }),
      relKept: srcSecs.filter(x => x.rel).every(x => { const a = state.annotations.find(y => y.id === x.id); return a.clusterRelations[tgt.id] === x.rel || rowSecs(tgt).some(s => s.id === x.id); }),
      stepA: !srcStepA || tgt.translationSummary.includes(`[From row "${srcTitle}"]`),
      links: state.loa.links.map(l => [l.from === tgt.id, l.to]).length === 1 && state.loa.links[0].from === tgt.id,
      history: tgt.historyFrom.includes(srcId) && state.logs.some(l => (l.clusterIds || []).includes(srcId) && l !== log && logIsForRow(l, tgt)),
      logged: log.action.startsWith('Merged row') && log.rationale === 'Both rows describe the same burden' && log.clusterIds.includes(tgt.id)
    };
  });
  check('merging moves the cards with their judgements and removes the row', m.gone && m.cardsMoved && m.relKept);
  check('the merged row keeps the other row\'s Step A, marked with its origin', m.stepA);
  check('concept-map relations follow the row (a relation between the two is dropped)', m.links);
  check('the merged row\'s history includes the history of the row it absorbed', m.history);
  check('the merge is logged with its reason', m.logged);
  await p.evaluate(() => performUndo()); await settle(p);
  const afterUndo = JSON.parse(await snap()), orig = JSON.parse(before);
  check('Ctrl+Z undoes the merge exactly (rows, cards, relations, map)', JSON.stringify(afterUndo) === JSON.stringify(orig));
  // Split one card of row 1 into a new row
  const sp = await p.evaluate(async () => {
    const src = state.clusters[0];
    const sec = rowSecs(src).find(s => (s.clusterRelations || {})[src.id] === 'refutational') || rowSecs(src)[1];
    const rel = (sec.clusterRelations || {})[src.id] || null, n = state.clusters.length;
    await splitRow(src, [sec.id], 'A split-off reading', 'Reads as a separate idea');
    const nw = state.clusters[1];
    return { n2: state.clusters.length === n + 1, placed: nw.thirdOrderTitle === 'A split-off reading', moved: sec.clusterIds.includes(nw.id) && !sec.clusterIds.includes(src.id),
      // The lone moved card's study now establishes the new row: it is its base (◆), not judged; an earlier judgement is in its note
      rel: secRelation(sec, nw.id) === 'baseline' && !((sec.clusterRelations || {})[nw.id]) && (rel === null || /establishes the new row/.test((sec.clusterComments || {})[nw.id] || '')), hist: nw.historyFrom.includes(src.id), logged: state.logs[0].action.startsWith('Split 1 construct') && state.logs[0].rationale === 'Reads as a separate idea' };
  });
  check('splitting moves the ticked cards into a new row right below; the card that now establishes it is its base, its earlier judgement noted', sp.n2 && sp.placed && sp.moved && sp.rel);
  check('the new row\'s history starts from the row it was split from; the split is logged with its reason', sp.hist && sp.logged);
  await p.evaluate(() => performUndo()); await settle(p);
  check('Ctrl+Z undoes the split', await p.evaluate(n => state.clusters.length === n, JSON.parse(before).c.length));
  // Undo keeps what was changed after the operation
  const k = await p.evaluate(async () => {
    const [tgt, src] = [state.clusters[0], state.clusters[1]];
    // a construct in both rows, read differently in each
    const shared = rowSecs(src).find(x => !x.clusterIds.includes(tgt.id) && secRelation(x, src.id) !== 'baseline');
    shared.clusterIds.push(tgt.id); shared.clusterRelations[tgt.id] = 'reciprocal'; shared.clusterRelations[src.id] = 'refutational'; await dbPut('annotations', shared);
    state.loa = { ...state.loa, links: [{ id: 'm1', from: tgt.id, to: state.clusters[2].id, type: 'mutual' }, { id: 'm2', from: state.clusters[2].id, to: src.id, type: 'mutual' }] };
    await mergeRows(src, tgt, '');
    const noted = (shared.clusterComments[tgt.id] || '').includes('judged Refutational there') && state.logs[0].detail.includes('Read differently in the two rows');
    const oneLink = state.loa.links.length === 1;
    tgt.synthesisNote = 'Rewritten after the merge'; await dbPut('clusters', tgt);
    await performUndo();
    const t2 = state.clusters.find(c => c.id === tgt.id);
    const r = { noted, oneLink, keptEdit: t2.synthesisNote === 'Rewritten after the merge', srcBack: state.clusters.some(c => c.id === src.id), loggedKept: state.logs[0].detail.includes('Kept what was changed after it') };
    // split, then add a row, then undo the split: the added row stays
    const n0 = state.clusters.length;
    await splitRow(state.clusters[0], [rowSecs(state.clusters[0])[0].id], 'tmp', '');
    const added = await createNewClusterRow('Added after the split', { silent: true });
    await performUndo();
    r.addedStays = state.clusters.some(c => c.id === added.id) && state.clusters.length === n0 + 1 && state.logs[0].clusterIds.length === 2;
    return r;
  });
  check('merging a construct read differently in the two rows keeps the other reading as a note, and logs it', k.noted);
  check('a symmetric relation is not duplicated by a merge (A–C and C–A)', k.oneLink);
  check('undoing a merge keeps an edit made after it, and says so in the log', k.keptEdit && k.srcBack && k.loggedKept);
  check('undoing a split keeps a row added after it; the undo is in both rows\' history', k.addedStays);
  // Quiet gaps: grey in the preview while working, full text in exports
  await tab(p, 'pub'); await p.locator('[data-pub=method]').click(); await settle(p);
  const q = await p.evaluate(() => ({ on: document.getElementById('pubPreviewContainer').classList.contains('gaps-quiet'), color: getComputedStyle(document.querySelector('#pubPreviewContainer .mec-gap')).color }));
  check('write-up gaps are quiet (grey) by default while working', q.on && q.color === 'rgb(148, 163, 184)');
  await p.locator('#quietGapsToggle').uncheck(); await settle(p);
  check('unticking Quiet gaps shows them in blue', await p.evaluate(() => getComputedStyle(document.querySelector('#pubPreviewContainer .mec-gap')).color === 'rgb(37, 99, 235)'));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#downloadWordDocBtn')]);
  check('exports keep the full [Author to insert] text', readZipEntry(fs.readFileSync(await dl.path()), 'word/document.xml').includes('Author to insert'));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Compatibility: a format-1 (v1.4.7) backup opens with the same meaning; newer formats are refused', async () => {
  // The fixture is a backup written by v1.4.7 from the demo. Its "meaning" (who established each row, how each study is read
  // in it, CERQual, team status, …) must stay the same in every later version. WRITE_FIXTURE=1 npm test rewrites the
  // expected file; do that only when a change is MEANT to change the meaning, and add an upgrade step for older files.
  const fixDir = path.join(ROOT, 'tools/test/fixtures');
  const json = fs.readFileSync(path.join(fixDir, 'project-format-1.json'), 'utf8');
  const meaning = () => p.evaluate(() => ({
    studies: state.docs.map(d => [getDisplayName(d), d.quality || '', d.richness || '', d.group || '']),
    rows: state.clusters.map(c => ({
      title: c.thirdOrderTitle,
      base: (state.docs.find(d => d.id === rowBaseDocId(c)) || {}).name || null,
      translation: clusterTranslationLabel(c),
      cells: state.docs.map(d => contribSymbol(state.annotations.filter(a => a.type === 'second_order' && a.docId === d.id && (a.clusterIds || []).includes(c.id)), c.id) || ((emptyCellInfo(c, d.id) || {}).symbol || '')),
      cerqual: [c.cerqualConfidence, c.cerqualLimitations, c.cerqualCoherence, c.cerqualAdequacy, c.cerqualRelevance],
      team: c.concordanceStatus
    })),
    constructs: state.annotations.filter(a => a.type === 'second_order').length,
    quotes: state.annotations.filter(a => a.type === 'first_order').length,
    notTranslated: state.annotations.filter(a => a.type === 'second_order' && !(a.clusterIds || []).length).length,
    auditEntries: state.logs.length,
    lineOfArgument: [state.loa.title || '', state.loa.seedChoice || '', (state.loa.links || []).length]
  }));
  const p = await openDemo();
  const alerts = [];
  p.removeAllListeners('dialog'); p.on('dialog', d => { if (d.type() === 'alert') alerts.push(d.message()); d.accept(); }); // OK = clean restore
  await p.setInputFiles('#jsonFileInput', { name: 'v1.4.7.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await settle(p, { quiet: 300 });
  const got = await meaning();
  const expFile = path.join(fixDir, 'project-format-1.expected.json');
  if (process.env.WRITE_FIXTURE) fs.writeFileSync(expFile, JSON.stringify(got, null, 2) + '\n');
  const exp = JSON.parse(fs.readFileSync(expFile, 'utf8'));
  check('the v1.4.7 backup opens with the same meaning', JSON.stringify(got) === JSON.stringify(exp),
    JSON.stringify(got).length + ' vs ' + JSON.stringify(exp).length);
  // A backup records its format, so a later version knows how to read it
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backupJsonBtn')]);
  const written = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check('a new backup records its data format', written.formatVersion === await p.evaluate(() => PROJECT_FORMAT) && !!written.appVersion);
  // A file from a NEWER format is refused, and nothing changes
  const before = await meaning();
  const newer = JSON.stringify({ ...JSON.parse(json), formatVersion: 999, appVersion: '9.9.9' });
  alerts.length = 0;
  await p.setInputFiles('#jsonFileInput', { name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(newer) }); await settle(p, { quiet: 300 });
  check('a file from a newer version is refused with a clear message, and nothing changes', p.notices.some(a => a.includes('newer version')) && JSON.stringify(await meaning()) === JSON.stringify(before));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 2: welcome buttons, awaited commits, peer rows imported later, merge ids, highlights, undo log', async () => {
  const p = await openDemo();
  // Welcome guide buttons work without inline handlers (the CSP blocks those)
  await p.evaluate(() => { state.activeDocId = null; renderWelcomeGuideIfNeeded(); });
  const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null), p.click('#welcomeSelectPdfBtn')]);
  check('welcome "Select PDF Files" opens the file chooser', !!chooser);
  check('no inline on…= handlers in the app scripts', !/\son[a-z]+="/.test(['app.js', 'matrix.js', 'extraction.js', 'export.js', 'compare.js', 'studies-pdf.js', 'audit-view.js', 'loa.js', 'backup.js'].map(f => fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8')).join('\n')));
  await p.evaluate(() => switchStudy(state.docs[0].id)); await settle(p);
  // A pending commit can be awaited: its audit entry is in the trail when the flush resolves
  await tab(p, 'matrix'); await settle(p);
  await p.locator('.cluster-trans').first().fill('Step A typed just before leaving the tab');
  const gained = await p.evaluate(async () => { const n = state.logs.length; await flushAllPendingSaves(); return state.logs.length - n; });
  check('flushAllPendingSaves() resolves after the audit entry is written', gained === 1, String(gained));
  // Only the title is shown in the drawer: typing Step A does not redraw the map; nothing is redrawn while the drawer is closed
  const redraws = await p.evaluate(async () => {
    let n = 0; const orig = window.renderLoaMap; window.renderLoaMap = () => { n++; };
    state.isLoaOpen = false; renderLoaClusterChips();
    window.renderLoaMap = orig; return n;
  });
  check('the line-of-argument map is not redrawn while the drawer is closed', redraws === 0);
  // Merge / split dialog: Escape closes it
  await p.evaluate(() => openRowOps(state.clusters[0])); await settle(p);
  await p.keyboard.press('Escape'); await settle(p);
  check('Escape closes the merge / split dialog', await p.evaluate(() => document.getElementById('rowOpsModal').classList.contains('hidden')));
  // Table 2b lists the pages of every passage of a construct
  const t2b = await p.evaluate(() => {
    const s = state.annotations.find(a => a.type === 'second_order' && a.clusterIds.length);
    const saved = s.passages; s.passages = [...(s.passages || []), { page: '987', text: 'same idea stated later' }];
    const html = buildTable2GridHtml(); s.passages = saved; return html.includes('p.987');
  });
  check('Table 2b shows the pages of additional passages', t2b);
  // Undoing a row deletion is logged (the deletion was)
  const undo = await p.evaluate(async () => {
    const c = state.clusters[state.clusters.length - 1];
    pushUndoAction({ type: 'delete_cluster', label: 'x', cluster: { ...c }, assignedSecIds: [] });
    state.clusters = state.clusters.filter(x => x.id !== c.id); await dbDelete('clusters', c.id);
    await performUndo();
    return { back: state.clusters.some(x => x.id === c.id), log: state.logs[0].action, ids: state.logs[0].clusterIds };
  });
  check('undoing a row deletion restores it and writes an audit entry for that row', undo.back && /Restored 3rd Order Row \(Undo\)/.test(undo.log) && undo.ids && undo.ids.length === 1, JSON.stringify(undo));
  // Compare: a construct imported before its row keeps the placement, judgement and cell note until the row is imported
  const late = await p.evaluate(async () => {
    const peer = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, reviewerId: 'Peer' }));
    const d1 = state.docs[1].id;
    peer.clusters.push({ id: 'peer_only_row', thirdOrderTitle: 'A row only the peer made', baseDocId: d1, cellStatus: { [state.docs[2].id]: { status: 'absent', note: 'nothing here' } }, order: 99 });
    const sec = { ...peer.annotations.find(a => a.type === 'second_order' && a.docId === d1), id: 'peer_sec_late', text: 'A passage only the peer placed in their own row', clusterIds: ['peer_only_row'], clusterRelations: { peer_only_row: 'refutational' }, clusterComments: { peer_only_row: 'why it fits' } };
    peer.annotations.push(sec);
    // One matched pair where only the peer gave a label: a different reading, not aligned
    const pairBase = peer.annotations.find(a => a.type === 'second_order' && a.note);
    await processPeerJsonFile(new File([JSON.stringify(peer)], 'peer.json'));
    const lp = state.peerComparison.matchedPairs.find(pr => pr.peerAnno.id === pairBase.id);
    const saved = lp ? [lp.localAnno.note, lp.localAnno.concordanceStatus, lp.peerAnno.concordanceStatus] : null;
    let oneLabel = null;
    if (lp) {
      lp.localAnno.concordanceStatus = 'pending'; lp.peerAnno.concordanceStatus = 'pending';
      const both = getCompareBuckets(state.peerComparison).divergent.includes(lp);
      lp.localAnno.note = '';
      oneLabel = !both && getCompareBuckets(state.peerComparison).divergent.includes(lp);
      [lp.localAnno.note, lp.localAnno.concordanceStatus, lp.peerAnno.concordanceStatus] = saved;
    }
    const item = state.peerComparison.peerOnlyAnnos.find(x => x.peerAnno.id === 'peer_sec_late');
    await importPeerConstruct(item, 'discuss');
    const got = state.annotations.find(a => a.text === sec.text);
    const waitingBefore = !!(got._peerRows && got._peerRows.peer_only_row) && got.clusterIds.length === 0;
    setCompareTab('clusters_logs'); renderComparisonTabContent();
    return { waitingBefore, oneLabel, hasPair: !!lp };
  });
  check('a pair where only one reviewer gave a label is read differently', late.hasPair && late.oneLabel === true, JSON.stringify(late));
  check('a construct whose row is not here yet waits with its judgement', late.waitingBefore);
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('#peerClustersList > div')].find(d => d.textContent.includes('A row only the peer made'));
    row && row.querySelector('.imp-cl') && row.querySelector('.imp-cl').click();
  });
  await settle(p);
  const after = await p.evaluate(() => {
    const got = state.annotations.find(a => a.text === 'A passage only the peer placed in their own row');
    const row = state.clusters.find(c => c.id === 'peer_only_row');
    return { ids: got.clusterIds, rel: got.clusterRelations.peer_only_row, cmt: got.clusterComments.peer_only_row, waiting: !!got._peerRows, row: !!row };
  });
  check('importing the row afterwards places the construct with its judgement and cell note', after.row && after.ids.includes('peer_only_row') && after.rel === 'refutational' && after.cmt === 'why it fits' && !after.waiting, JSON.stringify(after));
  // The same when the matching row is made here (same title) instead of imported
  const titled = await p.evaluate(async () => {
    const peer = JSON.parse(JSON.stringify(state.peerComparison.peerData));
    peer.clusters.push({ id: 'peer_row_t', thirdOrderTitle: 'Made here too', order: 100 });
    peer.annotations.push({ ...peer.annotations.find(a => a.type === 'second_order'), id: 'peer_sec_t', text: 'Waiting for a row made here', clusterIds: ['peer_row_t'], clusterRelations: { peer_row_t: 'reciprocal' }, clusterComments: {} });
    await processPeerJsonFile(new File([JSON.stringify(peer)], 'peer.json'));
    await importPeerConstruct(state.peerComparison.peerOnlyAnnos.find(x => x.peerAnno.id === 'peer_sec_t'), 'discuss');
    const local = normalizeCluster({ id: 'local_t', thirdOrderTitle: 'made here TOO', order: 101 });
    state.clusters.push(local); await dbPut('clusters', local);
    // Rendering the tab changes nothing; opening it (the tab button) places the waiting construct, once
    const nLogs = state.logs.length;
    setCompareTab('clusters_logs'); renderComparisonTabContent(); renderComparisonTabContent();
    await new Promise(r => setTimeout(r, 300));
    const renderOnly = state.logs.length === nLogs && !state.annotations.find(a => a.text === 'Waiting for a row made here').clusterIds.includes('local_t');
    document.querySelector('.cmp-tab-btn[data-cmptab="clusters_logs"]').click();
    document.querySelector('.cmp-tab-btn[data-cmptab="clusters_logs"]').click();
    await new Promise(r => setTimeout(r, 600));
    const got = state.annotations.find(a => a.text === 'Waiting for a row made here');
    const placedLogs = state.logs.filter(l => /^Placed 1 construct\(s\) imported from @Peer in "made here TOO"/.test(l.action)).length;
    return { ids: got.clusterIds, rel: got.clusterRelations.local_t, waiting: !!got._peerRows, renderOnly, placedLogs };
  });
  check('a waiting construct is placed in a row with the same title made here (not by a render; logged once)', titled.renderOnly && titled.ids.includes('local_t') && titled.rel === 'reciprocal' && !titled.waiting && titled.placedLogs === 1, JSON.stringify(titled));
  // Clicking a highlight shows its card (the text layer lies above the highlights)
  await tab(p, 'extract'); await p.evaluate(() => switchStudy(state.docs[0].id));
  await p.waitForFunction(() => document.querySelector('#pdfPagesWrapper .hl-box'), null, { timeout: 15000 }); await settle(p);
  const box = await p.evaluate(() => { const b = document.querySelector('#pdfPagesWrapper .hl-box'); b.scrollIntoView({ block: 'center' }); return b.dataset.annoId; });
  await settle(p);
  const r = await p.evaluate(id => { const b = document.querySelector(`#pdfPagesWrapper .hl-box[data-anno-id="${CSS.escape(id)}"]`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, box);
  await p.evaluate(() => window.getSelection().removeAllRanges());
  await p.mouse.click(r.x, r.y); await settle(p);
  check('clicking a highlight shows its card in the sidebar', await p.evaluate(id => !!document.querySelector(`[data-sidebar-anno="${CSS.escape(id)}"].ring-amber-400`), box));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('MERGE restore maps every study id of a study matched by file name', async () => {
  const p = await openDemo();
  const json = await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify({ docs: state.docs, annotations: [], clusters: [], logs: [], loa: state.loa, projectCode: state.projectCode, version: DB_VERSION, formatVersion: PROJECT_FORMAT }));
    const map = {}; d.docs.forEach((x, i) => { map[x.id] = 'bk_doc_' + i; x.id = map[x.id]; });
    d.docs[1].companionOf = d.docs[0].id;
    d.clusters.push({ id: 'bk_row', thirdOrderTitle: 'Row only in the backup', baseDocId: d.docs[1].id, cellStatus: { [d.docs[2].id]: { status: 'other_aspect', note: 'n' } }, order: 99 });
    d.loa.baselineDocId = d.docs[0].id;
    return JSON.stringify(d);
  });
  p.removeAllListeners('dialog');
  p.on('dialog', d => d.accept()); p.choiceAnswer = 'merge';
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await settle(p, { quiet: 300 });
  const r = await p.evaluate(() => {
    const c = state.clusters.find(x => x.id === 'bk_row');
    return { base: c && c.baseDocId === state.docs[1].id, cell: c && !!c.cellStatus[state.docs[2].id], noStray: !state.docs.some(x => /^bk_doc_/.test(x.id)), conflict: (state.logs[0].detail || '').includes('baselineDocId'),
      sorted: state.clusters.every((x, i, a) => i === 0 || (a[i - 1].order ?? a[i - 1].createdAt ?? 0) <= (x.order ?? x.createdAt ?? 0)) };
  });
  check('a new row points to the local study (base ◆ and empty-cell record)', r.base && r.cell && r.noStray, JSON.stringify(r));
  check('study #1 is not reported as a conflict when it is the same study', !r.conflict);
  check('rows are in their order after the merge', r.sorted);
  await p.context().close();
});

await group('Reasons are asked in a multi-line dialog; undoable deletions show Undo instead of asking first', async () => {
  const p = await openDemo();
  p.autoReason = false;
  check('no prompt() left for reasons (only the reviewer ID and a construct label)', ['studies-pdf.js', 'matrix.js', 'compare.js'].every(f => !/\bprompt\(/.test(fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8'))));
  // Translation order: Cancel leaves everything as it was
  await tab(p, 'extract'); await settle(p);
  const before = await p.evaluate(() => getOrderStrategy());
  const other = before === 'chronological' ? 'other' : 'chronological';
  await p.selectOption('#orderStrategySelect', other); await p.waitForSelector('#reasonModal:not(.hidden)');
  await p.fill('#reasonModalInput', 'draft that is kept');
  await p.click('#reasonModalSecondaryBtn'); await settle(p);
  check('Cancel keeps the order strategy and the select', await p.evaluate(b => getOrderStrategy() === b && document.getElementById('orderStrategySelect').value === b, before));
  // Again: the draft comes back; a multi-line reason is recorded as the rationale
  await p.selectOption('#orderStrategySelect', other); await p.waitForSelector('#reasonModal:not(.hidden)');
  check('a cancelled reason comes back as a draft', (await p.inputValue('#reasonModalInput')) === 'draft that is kept');
  await p.fill('#reasonModalInput', 'First line.\nSecond line of the reason.');
  await p.click('#reasonModalConfirmBtn'); await settle(p);
  const lg = await p.evaluate(() => ({ s: getOrderStrategy(), r: state.logs[0].rationale }));
  check('the reason is recorded with its line breaks', lg.s === other && lg.r === 'First line.\nSecond line of the reason.', JSON.stringify(lg));
  // Escape on a decision that is already made (#1 changed) records it without a reason
  const pending = p.evaluate(() => moveStudyOrder(1, 0));
  await p.waitForSelector('#reasonModal:not(.hidden)');
  check('the #1 change offers "Record without a reason", not Cancel', (await p.innerText('#reasonModalSecondaryBtn')).includes('without a reason'));
  await p.keyboard.press('Escape'); await pending; await settle(p);
  check('Escape records the #1 change without a reason', await p.evaluate(() => /#1 Study/.test(state.logs.find(l => l.category === 'study_order').action)));
  // A second question while one is open: the first caller goes on (cancelled), it does not hang
  const both = await p.evaluate(async () => {
    const a = askReason({ title: 'first' }); const b = askReason({ title: 'second' });
    const ra = await Promise.race([a, new Promise(r => setTimeout(() => r('hung'), 500))]);
    document.getElementById('reasonModalConfirmBtn').click();
    return { ra, rb: await b };
  });
  check('a dialog replaced by a new question lets its caller go on', both.ra === null && both.rb === '', JSON.stringify(both));
  // Undoable deletion: no confirmation first, a notice with Undo after
  const dialogs = []; p.on('dialog', d => dialogs.push(d.type()));
  await tab(p, 'matrix'); await settle(p);
  const nRows = await p.evaluate(() => state.clusters.length);
  await p.locator('.cl-tools-toggle').first().click(); await p.locator('.del-cluster').first().click(); await settle(p);
  check('a row is removed without a confirmation dialog', dialogs.length === 0 && (await p.evaluate(() => state.clusters.length)) === nRows - 1);
  check('the notice offers Undo', await p.isVisible('#snackbarAction') && (await p.innerText('#snackbarAction')).toLowerCase() === 'undo');
  await p.click('#snackbarAction'); await settle(p);
  check('Undo in the notice brings the row back (and logs it)', (await p.evaluate(() => state.clusters.length)) === nRows && /Restored 3rd Order Row/.test(await p.evaluate(() => state.logs[0].action)));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Write-up fields sit beside the Methods Summary; the drawer keeps the analysis', async () => {
  const p = await openDemo();
  const moved = ['loaQuestionInput', 'loaReadingInput', 'loaExtractionScopeInput', 'loaUnitsInput', 'loaAppraisalPolicyInput', 'loaAppraisalUseInput', 'loaRelateProcessInput', 'loaTransDefInput', 'loaTransProcInput', 'loaSynthStudiesInput'];
  const kept = ['loaAimInput', 'loaRelateOutcomeInput', 'loaAltInterpInput', 'loaModelContextInput', 'loaTeamMergeInput', 'loaTitleInput', 'loaFlowInput', 'loaNarrativeInput'];
  const where = await p.evaluate(({ moved, kept }) => ({
    inPanel: moved.every(id => document.getElementById('writeupPanel').contains(document.getElementById(id))),
    inDrawer: kept.every(id => document.getElementById('loaDrawer').contains(document.getElementById(id)))
  }), { moved, kept });
  check('reporting fields are in Tab 4, analysis fields (incl. Item 12) in the drawer', where.inPanel && where.inDrawer, JSON.stringify(where));
  await tab(p, 'pub'); await p.locator('[data-pub=method]').click(); await settle(p);
  check('the panel shows with the Methods Summary', await p.isVisible('#writeupPanel'));
  // A field is saved and logged when it is left; the summary uses it
  const n = await logCount(p);
  await p.fill('#loaReadingInput', 'Each account was read three times by two reviewers.');
  await p.locator('[data-pub=table1]').click(); await settle(p);
  check('the panel is hidden with other tables', !(await p.isVisible('#writeupPanel')));
  await p.locator('[data-pub=method]').click(); await settle(p);
  await p.locator('#loaUnitsInput').focus(); await p.locator('#loaUnitsInput').blur(); await settle(p);
  const after = await p.evaluate(() => ({ v: state.loa.readingApproach, log: state.logs.find(l => /Reading & extraction process/.test(l.action)), html: document.getElementById('pubPreviewContainer').innerHTML }));
  check('leaving a write-up field saves it with one audit entry', after.v === 'Each account was read three times by two reviewers.' && after.log && after.log.category === 'reading_extraction' && (await logCount(p)) === n + 1);
  check('the Methods Summary shows it', after.html.includes('Each account was read three times by two reviewers.'));
  // A gap goes to its field
  await p.evaluate(() => { state.loa.reviewQuestion = ''; state.loa.modelContext = ''; populateLoaInputs(); renderPublicationView(); });
  await p.locator('.mec-gap[data-field=reviewQuestion]').first().click(); await settle(p);
  check('clicking a gap focuses its field beside the summary', await p.evaluate(() => document.activeElement && document.activeElement.id === 'loaQuestionInput'));
  const gapCtx = p.locator('.mec-gap[data-field=modelContext]');
  if (await gapCtx.count()) {
    await gapCtx.first().click(); await settle(p);
    check('a gap for an analysis field opens the drawer in Tab 2 at that field', await p.evaluate(() => !document.getElementById('matrixView').classList.contains('hidden') && state.isLoaOpen && document.activeElement.id === 'loaModelContextInput'));
  }
  // The drawer's button still saves the analysis fields, and only those
  await p.fill('#loaRelateOutcomeInput', 'Studies related reciprocally, with one contrasting case.');
  await p.click('#saveLoaBtn'); await settle(p);
  check('the drawer saves Item 12 with its button', await p.evaluate(() => state.loa.relateOutcome === 'Studies related reciprocally, with one contrasting case.' && /item 12/.test(state.logs[0].action)));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Appendix A shows the key decisions; repeated edits of one text are one line; the full trail is a supplementary file', async () => {
  const p = await openDemo();
  const r = await p.evaluate(async () => {
    const cid = state.clusters[0].id, t0 = Date.now() + 1000;
    const mk = (i, o) => ({ id: 'tlog_' + i, timestamp: t0 + i * 1000, reviewer: 'A', ...o });
    const extra = [
      ...[0, 1, 2, 3, 4].map(i => mk(i, { category: 'third_order', action: `Updated Step B 3rd Order Definition & Interpretation for "Row"`, fromVal: 'v' + i, toVal: 'v' + (i + 1), clusterIds: [cid] })),
      mk(5, { category: 'third_order', action: `Updated Step B 3rd Order Definition & Interpretation for "Row"`, fromVal: 'v5', toVal: 'v6', clusterIds: [cid], rationale: 'A reasoned change' }),
      mk(6, { category: 'linking', action: 'Linked 1st Order Quote to 2nd Order Construct (X)' }),
      mk(7, { category: 'reading_extraction', action: 'Updated Reading & extraction process (Item 9)', fromVal: 'a', toVal: 'b' }),
      mk(8, { category: 'reflexive_memo', action: '[Reflexivity (Positionality)] ', detail: 'my position' }),
      mk(9, { category: 'third_order', action: 'Undid: Merge "A" into "B"', clusterIds: [cid] }),
      // An older trail without row ids: edits of two rows stay two lines
      mk(10, { category: 'third_order', action: 'Updated Step B 3rd Order Definition & Interpretation for "Old row 1"', fromVal: 'o1', toVal: 'o2' }),
      mk(11, { category: 'third_order', action: 'Updated Step B 3rd Order Definition & Interpretation for "Old row 2"', fromVal: 'p1', toVal: 'p2' }),
      mk(12, { category: 'third_order', action: 'Updated Step B 3rd Order Definition & Interpretation for "Old row 1"', fromVal: 'o2', toVal: 'o3' }),
      mk(13, { category: 'cerqual', action: 'Updated GRADE-CERQual Assessment for "Row"', fromVal: 'x', toVal: 'y', detail: 'Coherence — first note', clusterIds: [cid] }),
      mk(14, { category: 'cerqual', action: 'Updated GRADE-CERQual Assessment for "Row"', fromVal: 'y', toVal: 'z', detail: 'Coherence — final note', clusterIds: [cid] }),
      mk(15, { category: 'translation_process', action: 'Updated Working definitions (Item 13) / Alternative interpretations (Items 13/15)', toVal: 'alt' })
    ];
    state.logs = [...extra.slice().reverse(), ...state.logs];
    const key = getAppendixASpec('key'), full = getAppendixASpec('full');
    const folded = key.rows.filter(x => /Step B third-order interpretation revised \(5 edits\)/.test(x.action));
    return {
      total: full.rows.length === state.logs.length, fewer: key.rows.length < full.rows.length,
      folded: folded.length === 1 && folded[0].fromVal === 'v0' && folded[0].toVal === 'v5',
      reasoned: key.rows.some(x => x.rationale.startsWith('A reasoned change') && x.fromVal === 'v5'),
      routineOut: !key.rows.some(x => x.action === 'Linked 1st Order Quote to 2nd Order Construct (X)') && full.rows.some(x => x.action === 'Linked 1st Order Quote to 2nd Order Construct (X)'),
      writeupOut: !key.rows.some(x => x.action === 'Updated Reading & extraction process (Item 9)'),
      memoIn: key.rows.some(x => x.detail === 'my position'),
      caption: /full audit trail is available as a supplementary file/.test(key.caption),
      undoMerge: key.rows.some(x => x.action === 'Undid: Merge "A" into "B"'),
      oldRowsApart: key.rows.some(x => /\(2 edits\): "Old row 1"/.test(x.action) && x.fromVal === 'o1' && x.toVal === 'o3') && key.rows.some(x => x.action.endsWith('"Old row 2"') && x.fromVal === 'p1'),
      cqNote: key.rows.some(x => /GRADE-CERQual assessment revised \(2 edits\)/.test(x.action) && x.detail.includes('Coherence — final note')),
      mixedOld: key.rows.some(x => x.toVal === 'alt')
    };
  });
  check('the full mode lists every entry; the key mode fewer', r.total && r.fewer, JSON.stringify(r));
  check('repeated edits of one text become one line with the first and last wording', r.folded);
  check('an edit with a reason stays a line of its own', r.reasoned);
  check('routine steps and Methods wording are left out; memos stay', r.routineOut && r.writeupOut && r.memoIn);
  check('the caption says how the entries were chosen and where the full trail is', r.caption);
  check('undoing a row merge stays in the key decisions', r.undoMerge);
  check('entries without row ids are folded per row, not across rows', r.oldRowsApart);
  check('a folded CERQual line keeps the latest notes', r.cqNote);
  check('an older combined entry with an analysis field stays', r.mixedOld);
  await tab(p, 'pub'); await p.locator('[data-pub=appendix]').click(); await settle(p);
  check('the mode select and the full-trail button show with the Appendices', await p.isVisible('#appendixModeSelect') && await p.isVisible('#fullTrailCsvBtn'));
  const keyRows = await p.locator('#pubPreviewContainer table').first().locator('tbody tr').count();
  await p.selectOption('#appendixModeSelect', 'full'); await settle(p);
  const fullRows = await p.locator('#pubPreviewContainer table').first().locator('tbody tr').count();
  check('switching to the full trail shows every entry', fullRows === await logCount(p) && fullRows > keyRows, `${keyRows} / ${fullRows}`);
  await p.selectOption('#appendixModeSelect', 'key'); await settle(p);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#fullTrailCsvBtn')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check('the full-trail CSV has every entry and marks the key ones', csv.trim().split(/\r\n/).length === (await logCount(p)) + 1 && /Key decision \(Appendix A\)/.test(csv) && /"yes"/.test(csv) && /"no"/.test(csv));
  await p.locator('[data-pub=method]').click(); await settle(p);
  check('the Appendix controls hide on other tables', !(await p.isVisible('#appendixModeSelect')) && !(await p.isVisible('#fullTrailCsvBtn')));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 3: restore choice, card removal, row moves under a filter, map width, CSV cells, search phrases, HiDPI', async () => {
  const p = await openDemo();
  // Restore: Cancel in the choice dialog changes nothing (it used to run MERGE)
  p.autoReason = false;
  const before = await p.evaluate(() => ({ n: state.annotations.length, logs: state.logs.length }));
  const json = await p.evaluate(() => JSON.stringify({ docs: state.docs, annotations: [...state.annotations, { ...state.annotations[0], id: 'only_in_backup' }], clusters: state.clusters, logs: [], loa: state.loa, projectCode: state.projectCode }));
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await p.waitForSelector('#choiceModal:not(.hidden)');
  check('restore asks with named choices (clean restore / merge)', (await p.locator('#choiceModalOptions .choice-option').count()) === 2);
  await p.click('#choiceModalCancelBtn'); await settle(p);
  check('Cancel in the restore dialog changes nothing', await p.evaluate(b => state.annotations.length === b.n && state.logs.length === b.logs && !state.annotations.some(a => a.id === 'only_in_backup'), before));
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await p.waitForSelector('#choiceModal:not(.hidden)'); await p.keyboard.press('Escape'); await settle(p);
  check('Escape in the restore dialog changes nothing', await p.evaluate(b => state.annotations.length === b.n, before));
  p.autoReason = true;
  // A card taken out of a row loses its judgement, note and line-of-argument mark there; Ctrl+Z brings all three back
  const card = await p.evaluate(async () => {
    const sec = state.annotations.find(a => a.type === 'second_order' && a.clusterIds.length && !isRowBase(a, a.clusterIds[0]));
    const cid = sec.clusterIds[0], c = state.clusters.find(x => x.id === cid);
    sec.clusterRelations[cid] = 'other_aspect'; sec.clusterComments[cid] = 'kept note'; sec.aspectUsedInLoa = { ...(sec.aspectUsedInLoa || {}), [cid]: true };
    await removeSecondOrderFromCluster(sec, c);
    const gone = !(cid in sec.clusterRelations) && !(cid in sec.clusterComments) && !(sec.aspectUsedInLoa || {})[cid];
    await performUndo();
    const back = sec.clusterIds.includes(cid) && sec.clusterRelations[cid] === 'other_aspect' && sec.clusterComments[cid] === 'kept note' && sec.aspectUsedInLoa[cid] === true;
    await removeSecondOrderFromCluster(sec, c);
    sec.clusterRelations[cid] = 'refutational'; // as an older version would have left it
    await assignSecondOrderToCluster(sec, c);
    return { gone, back, fresh: secRelation(sec, cid) === 'unjudged' && !sec.clusterComments[cid] };
  });
  check('taking a card out clears its judgement, note and line-of-argument mark in that row', card.gone, JSON.stringify(card));
  check('Ctrl+Z restores all three', card.back);
  check('placing it again starts unjudged, without the old note', card.fresh);
  // ▲ / ▼ with "Contradictions Only" moves past the next row on view
  const moved = await p.evaluate(async () => {
    // Make the first and the last row contradictory, so a row in between is hidden by the filter
    const mark = c => { const s = state.annotations.find(a => a.type === 'second_order' && a.clusterIds.includes(c.id) && !isRowBase(a, c.id)); if (s) s.clusterRelations[c.id] = 'refutational'; };
    state.clusters.forEach(c => state.annotations.forEach(a => { if (a.clusterRelations && a.clusterRelations[c.id] === 'refutational') a.clusterRelations[c.id] = 'reciprocal'; }));
    mark(state.clusters[0]); mark(state.clusters[state.clusters.length - 1]);
    state.matrixRefutationalOnly = true;
    const vis = matrixVisibleClusters();
    if (vis.length < 2) { state.matrixRefutationalOnly = false; return { skip: true }; }
    const a = vis[1], b = vis[0];
    await moveClusterOrder(a.id, -1);
    const r = state.clusters.indexOf(a) < state.clusters.indexOf(b) && state.clusters.length > 2 && vis.length === 2;
    state.matrixRefutationalOnly = false;
    return { r };
  });
  if (!moved.skip) check('a row moves past the next visible row while a filter hides others', moved.r);
  // Flow map: same-column loops in the last column stay inside the picture
  const fits = await p.evaluate(() => {
    const saved = state.loa.links;
    const [x, y, z] = state.clusters;
    state.loa.links = [{ id: 'f1', from: x.id, to: y.id, type: 'leads' }, { id: 'f2', from: x.id, to: z.id, type: 'leads' }, { id: 'f3', from: y.id, to: z.id, type: 'mutual' }];
    const svg = buildConceptMapSvg('t', 640, 360, 'flow');
    state.loa.links = saved;
    const box = document.createElement('div'); box.style.width = '2000px'; box.innerHTML = svg; document.body.appendChild(box);
    const el = box.querySelector('svg'), W = el.viewBox.baseVal.width;
    const right = Math.max(...[...el.querySelectorAll('path')].map(pa => { const bb = pa.getBBox(); return bb.x + bb.width; }));
    box.remove();
    return { right, W };
  });
  check('flow map loops in the last column are not cut off', fits.right <= fits.W, JSON.stringify(fits));
  check('CSV cells that start with - or @ cannot become formulas (both CSV exports)', await p.evaluate(() => csvCell('-I felt') === `"'-I felt"` && csvCell('@Reviewer') === `"'@Reviewer"` && csvCell('plain') === '"plain"'));
  // ◇ list in the open drawer follows an empty cell marked as a different aspect
  await tab(p, 'matrix'); await settle(p);
  if (!(await p.evaluate(() => state.isLoaOpen))) { await p.click('#toggleLoaDrawerBtn'); await settle(p); }
  const nAspect = await p.locator('#loaAspectList > *').count();
  const idx = await p.evaluate(() => [...document.querySelectorAll('.empty-status')].findIndex(x => x.value === ''));
  if (idx >= 0) {
    await p.locator('.empty-status').nth(idx).selectOption('other_aspect'); await settle(p);
    check('the drawer\'s ◇ list updates when a cell is marked as a different aspect', (await p.locator('#loaAspectList > *').count()) > nAspect);
  }
  await p.click('#toggleLoaDrawerBtn'); await settle(p);
  // Search: a phrase that runs over two text spans is highlighted
  await tab(p, 'extract'); await p.evaluate(() => switchStudy(state.docs[0].id)); await settle(p, { quiet: 300 });
  const phrase = await p.evaluate(async () => {
    const pc = document.querySelector('#pdfPagesWrapper .page-container[data-p="1"]');
    const sp = [...pc.querySelectorAll('.textLayer span')].filter(x => x.firstChild && x.firstChild.nodeType === 3 && x.textContent.trim().length > 3);
    const k = sp.findIndex((x, i) => i + 1 < sp.length && sp[i + 1].textContent.trim().length > 3);
    const q = sp[k].textContent.trim().split(/\s+/).pop() + ' ' + sp[k + 1].textContent.trim().split(/\s+/)[0];
    await runPdfSearch(q);
    await new Promise(r => setTimeout(r, 300));
    return { q, lit: [...pc.querySelectorAll('.textLayer span')].filter(x => x.style.backgroundColor).length };
  });
  check('a search phrase over two text spans lights both up', phrase.lit >= 2, JSON.stringify(phrase));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
  // HiDPI: the page is drawn at the device pixel ratio and shown at its CSS size
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(BUSY_PROBE);
  const hp = await ctx.newPage();
  await hp.goto(BASE + '?demo');
  await hp.waitForFunction(() => document.querySelector('#pdfPagesWrapper canvas'), null, { timeout: 20000 }); await settle(hp);
  const c = await hp.evaluate(() => { const cv = document.querySelector('#pdfPagesWrapper canvas'); return { w: cv.width, css: parseFloat(cv.style.width) }; });
  check('PDF pages are sharp on HiDPI screens (canvas at 2× its CSS size)', Math.abs(c.w / c.css - 2) < 0.02, JSON.stringify(c));
  await ctx.close();
});

await group('Compare remembers what was set aside; the text sketch can be written from the map', async () => {
  const p = await openDemo();
  const r = await p.evaluate(async () => {
    const mkPeer = text => {
      const peer = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, reviewerId: 'Peer' }));
      const base = peer.annotations.find(a => a.type === 'second_order');
      peer.annotations.push({ ...base, id: 'peer_aside_1', text, clusterIds: [], clusterRelations: {}, clusterComments: {} });
      return new File([JSON.stringify(peer)], 'peer.json');
    };
    await processPeerJsonFile(mkPeer('A reading only the peer has, set aside after discussion'));
    setCompareTab('unique'); renderComparisonTabContent();
    const before = state.peerComparison.peerOnlyAnnos.some(x => x.peerAnno.id === 'peer_aside_1');
    // Set aside the one we made
    const idx = state.peerComparison.peerOnlyAnnos.findIndex(x => x.peerAnno.id === 'peer_aside_1');
    const btns = [...document.querySelectorAll('.imp-dismiss')];
    btns[idx].click(); await new Promise(res => setTimeout(res, 300));
    const stored = (state.loa.peerSetAside || []).some(x => x.peerId === 'peer_aside_1' && x.reviewer === 'Peer');
    // Second round: the same file again
    await processPeerJsonFile(mkPeer('A reading only the peer has, set aside after discussion'));
    const again = state.peerComparison.peerOnlyAnnos.some(x => x.peerAnno.id === 'peer_aside_1');
    const listedApart = (state.peerComparison.setAsideAnnos || []).some(x => x.peerAnno.id === 'peer_aside_1');
    setCompareTab('unique'); renderComparisonTabContent();
    const box = !!document.querySelector('.set-aside-box');
    // The peer changed the text since: it is shown again
    await processPeerJsonFile(mkPeer('A reading only the peer has, rewritten since it was set aside'));
    const changedBack = state.peerComparison.peerOnlyAnnos.some(x => x.peerAnno.id === 'peer_aside_1');
    // Reconsider brings it back into the list and forgets the record
    await processPeerJsonFile(mkPeer('A reading only the peer has, set aside after discussion'));
    setCompareTab('unique'); renderComparisonTabContent();
    const rb = document.querySelector('.set-aside-box .reconsider-btn'); if (!rb) return { before, stored, again, listedApart, box, changedBack, reconsidered: false }; rb.click(); await new Promise(res => setTimeout(res, 300));
    const reconsidered = state.peerComparison.peerOnlyAnnos.some(x => x.peerAnno.id === 'peer_aside_1') && !(state.loa.peerSetAside || []).some(x => x.peerId === 'peer_aside_1');
    return { before, stored, again, listedApart, box, changedBack, reconsidered };
  });
  check('setting aside is remembered in the project', r.before && r.stored, JSON.stringify(r));
  check('the same construct in the next file is not shown as new, but listed as set aside earlier', !r.again && r.listedApart && r.box, JSON.stringify(r));
  check('a construct whose text changed since is shown again', r.changedBack);
  check('Reconsider takes it back into the list', r.reconsidered);
  // Text sketch from the map
  await tab(p, 'matrix'); await settle(p);
  await p.click('#toggleLoaDrawerBtn'); await settle(p);
  await p.fill('#loaFlowInput', 'my own sketch'); p.choiceAnswer = 'add';
  await p.click('#loaFlowFromMapBtn'); await settle(p);
  const flow = await p.inputValue('#loaFlowInput');
  const nLinks = await p.evaluate(() => getLoaLinks().length);
  check('Write from the map adds one line per relation below the sketch', flow.startsWith('my own sketch\n') && flow.split('\n').length === nLinks + 1 && /\[.+\] (➔|⇄|⚡|⊃|≈) \[.+\]/.test(flow), flow);
  p.choiceAnswer = null;
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 4: similarity, study info autosave, #1 by id, zoom without reload, merge of record lists, card text selection', async () => {
  const p = await openDemo();
  // Pure logic, checked directly
  const sim = await p.evaluate(() => {
    const long = 'Nurses described moral distress when staffing was short, and spoke of leaving the ward after night shifts because nobody listened to them or offered any support at all';
    return {
      fragment: computeTextSimilarity('moral distress', long),
      same: computeTextSimilarity(long, long),
      overlap: computeTextSimilarity('Nurses described moral distress when staffing was short, and spoke of leaving the ward', 'when staffing was short, and spoke of leaving the ward after night shifts because nobody listened'),
      unrelated: computeTextSimilarity('the manager kept a list of who was on call', long),
      cjk: computeTextSimilarity('夜勤の看護師は誰にも相談できず一人で判断を背負っていた', '病棟では人手が足りず、夜勤の看護師は誰にも相談できず一人で判断を背負っていたと語られた。管理者はそれを信頼と呼んだ。')
    };
  });
  check('a two-word fragment does not pair with a long passage that contains both words', sim.fragment < 0.55, JSON.stringify(sim));
  check('the same passage, and overlapping selections of one paragraph, still pair', sim.same === 1 && sim.overlap >= 0.55 && sim.unrelated < 0.55 && sim.cjk >= 0.55, JSON.stringify(sim));
  // Study info: text typed in the dock is saved (and logged) when the reviewer moves to another study without clicking Save
  await tab(p, 'extract'); await p.evaluate(() => switchStudy(state.docs[0].id)); await settle(p);
  await p.click('#activeDocHeader'); await settle(p);
  const d0 = await p.evaluate(() => state.docs[0].id);
  await p.fill('#metaStudyOverview', 'An overview typed and never saved by hand.');
  await p.evaluate(() => switchStudy(state.docs[1].id)); await settle(p);
  const ov = await p.evaluate(id => ({ v: state.docs.find(d => d.id === id).studyOverview, log: state.logs.some(l => /Study Overview/.test(l.action) && l.toVal === 'An overview typed and never saved by hand.') }), d0);
  check('the study overview is saved and logged when the reviewer moves on without Save', ov.v === 'An overview typed and never saved by hand.' && ov.log, JSON.stringify(ov));
  // #1 compared by id: two studies with the same display name
  const sameName = await p.evaluate(async () => {
    state.docs[1].author = state.docs[0].author; state.docs[1].year = state.docs[0].year; state.docs[1].etAl = state.docs[0].etAl;
    const n = state.logs.length;
    await moveStudyOrder(1, 0);
    return { asked: state.logs.slice(0, state.logs.length - n).some(l => /Changed the #1 Study/.test(l.action)) };
  });
  check('changing #1 between two studies with the same display name is still recorded', sameName.asked);
  // Zoom keeps the loaded PDF (no new parse)
  await p.evaluate(() => switchStudy(state.docs[0].id)); await settle(p);
  const zoom = await p.evaluate(async () => { const before = state.activePdfDoc; await setPdfZoom(state.scale + 0.2); await new Promise(r => setTimeout(r, 400)); return { same: state.activePdfDoc === before, pages: document.querySelectorAll('#pdfPagesWrapper .page-container').length, hl: document.querySelectorAll('#pdfPagesWrapper .hl-box').length }; });
  check('zooming keeps the loaded PDF and lays the pages out again (with their highlights)', zoom.same && zoom.pages > 0 && zoom.hl > 0, JSON.stringify(zoom));
  // Merge: lists of separate records are merged as a union, not reported as a conflict
  const json = await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, projectCode: state.projectCode, formatVersion: PROJECT_FORMAT }));
    const [a, b] = d.clusters; d.loa.links = [...(d.loa.links || []), { id: 'lk_backup_only', from: a.id, to: b.id, type: 'metaphor', note: '' }];
    return JSON.stringify(d);
  });
  const nLinks = await p.evaluate(() => (state.loa.links || []).length);
  p.choiceAnswer = 'merge'; p.notices = [];
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await settle(p, { quiet: 300 });
  p.choiceAnswer = null;
  const merged = await p.evaluate(() => ({ n: (state.loa.links || []).length, has: (state.loa.links || []).some(l => l.id === 'lk_backup_only') }));
  check('a relation only in the backup is added to the map (no conflict)', merged.has && merged.n === nLinks + 1 && !p.notices.some(t => /Research Aim & Overall Model: [^\n]*links/.test(t)), JSON.stringify(merged));
  // Text in a box inside a draggable matrix card can be selected (the card is not dragged)
  await tab(p, 'matrix'); await settle(p);
  const drag = await p.evaluate(() => {
    const box = document.querySelector('.matrix-cell-card input, .matrix-cell-card textarea');
    if (!box) return { skip: true };
    const card = box.closest('[draggable]');
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const during = card.draggable;
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { during, after: card.draggable };
  });
  if (!drag.skip) check('a matrix card is not draggable while the mouse is down in one of its boxes', drag.during === false && drag.after === true, JSON.stringify(drag));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 5: drawer autosave, merge across bases, split undo keeps later work, atomic writes, merge fills texts, undo logs, CJK, paging', async () => {
  const p = await openDemo();
  // The drawer saves (and logs) when the reviewer switches tab, without the button
  await tab(p, 'matrix'); await settle(p);
  if (!(await p.evaluate(() => state.isLoaOpen))) { await p.click('#toggleLoaDrawerBtn'); await settle(p); }
  await p.fill('#loaNarrativeInput', 'A narrative written and never saved by hand.');
  await tab(p, 'audit'); await settle(p);
  check('the drawer is saved and logged on a tab switch (no button)', await p.evaluate(() => state.loa.narrative === 'A narrative written and never saved by hand.' && /Updated Line of Argument Synthesis/.test(state.logs[0].action)));
  // Merge rows established by different studies: moved judgements start unjudged, the earlier one is in the note
  const mr = await p.evaluate(async () => {
    const [x, y] = state.clusters;
    const xb = rowBaseDocId(x);
    const card = rowSecs(x).find(s => !rowSecs(y).includes(s) && s.docId !== xb);
    // Give the target row another base study than the source row
    const other = state.docs.find(d => d.id !== xb && d.id !== (card && card.docId));
    if (!card || !xb || !other) return { skip: true };
    y.baseDocId = other.id; const yb = other.id;
    card.clusterRelations[x.id] = 'refutational';
    await mergeRows(x, y, '');
    return { rel: secRelation(card, y.id), note: (card.clusterComments[y.id] || ''), log: state.logs[0].detail };
  });
  if (!mr.skip) check('merging rows established by different studies: moved cards start unjudged, the earlier judgement noted', mr.rel === 'unjudged' && /judged Refutational against/.test(mr.note) && /start unjudged/.test(mr.log), JSON.stringify(mr));
  else check('merge across bases: demo rows suitable', false, 'no suitable rows');
  await p.evaluate(() => performUndo()); await settle(p);
  // Split, then add a card and write in the new row, then undo the split: nothing written there is lost
  const sp = await p.evaluate(async () => {
    const src = state.clusters[0];
    const cards = rowSecs(src); if (cards.length < 2) return { skip: true };
    await splitRow(src, [cards[0].id], 'Split-off row', '');
    const nw = state.clusters.find(c => c.thirdOrderTitle === 'Split-off row');
    nw.synthesisNote = 'Step B written in the new row'; await dbPut('clusters', nw);
    const extra = state.annotations.find(a => a.type === 'second_order' && !a.clusterIds.includes(nw.id) && !a.clusterIds.includes(src.id));
    if (extra) { extra.clusterIds.push(nw.id); await dbPut('annotations', extra); }
    await performUndo();
    return { gone: !state.clusters.some(c => c.id === nw.id), text: /Step B written in the new row/.test(src.synthesisNote || ''), extra: extra ? extra.clusterIds.includes(src.id) && !extra.clusterIds.includes(nw.id) : true, log: /Kept what was changed after it/.test(state.logs[0].detail) };
  });
  if (!sp.skip) check('undoing a split keeps what was added to the new row (cards and texts go to the original row)', sp.gone && sp.text && sp.extra && sp.log, JSON.stringify(sp));
  // One transaction: a write that fails leaves nothing half-written
  const atomic = await p.evaluate(async () => {
    const a = state.annotations[0];
    const before = await dbGet('annotations', a.id);
    let failed = false;
    try { await dbBatch([{ store: 'annotations', put: { ...a, note: 'written in a failing batch' } }, { store: 'annotations', put: { note: 'no id' } }]); } catch (e) { failed = true; }
    const after = await dbGet('annotations', a.id);
    return { failed, unchanged: (after && after.note) === (before && before.note) };
  });
  check('a batch with a failing write stores none of its writes', atomic.failed && atomic.unchanged, JSON.stringify(atomic));
  // The failed write opened a "could not be saved" notice: let it be answered before the restore below asks its own question
  await settle(p);
  // Merge restore: an empty text here is filled from the backup's version of the same item
  const json = await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, projectCode: state.projectCode, formatVersion: PROJECT_FORMAT }));
    d.clusters[1].reflexiveNote = 'A reflexive note written on the other computer'; d.clusters[1].cerqualConfidence = 'High';
    return JSON.stringify(d);
  });
  await p.evaluate(async () => { state.clusters[1].reflexiveNote = ''; await dbPut('clusters', state.clusters[1]); });
  p.choiceAnswer = 'merge';
  await p.setInputFiles('#jsonFileInput', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await settle(p, { quiet: 300 });
  p.choiceAnswer = null;
  check('merge fills an empty text of the same row from the backup (ratings are not filled)', await p.evaluate(() => state.clusters[1].reflexiveNote === 'A reflexive note written on the other computer'), '');
  // Undo of a removal from a row is logged (with the minor operations)
  const un = await p.evaluate(async () => {
    state.logMinorOps = true;
    const sec = state.annotations.find(a => a.type === 'second_order' && a.clusterIds.length);
    const c = state.clusters.find(x => x.id === sec.clusterIds[0]);
    await removeSecondOrderFromCluster(sec, c); await performUndo();
    state.logMinorOps = false;
    return /^Undid: Unassign/.test(state.logs[0].action);
  });
  check('undoing a removal from a row is logged like the removal', un);
  // Only the two latest study deletions keep their PDF bytes for Undo
  const mem = await p.evaluate(() => {
    const saved = state.undoStack.slice();
    for (let i = 0; i < 4; i++) pushUndoAction({ type: 'delete_study', label: 'x' + i, binary: new ArrayBuffer(8), doc: {}, annotations: [] });
    const n = state.undoStack.filter(a => a.type === 'delete_study' && a.binary).length;
    state.undoStack = saved; updateUndoButtonUI();
    return n;
  });
  check('the undo history keeps the PDF bytes of only the two latest study deletions', mem === 2, String(mem));
  // Chinese / Japanese: no space where two text items meet between such characters
  check('text items are joined without a space between Japanese characters, with one between words', await p.evaluate(() => joinTextItems(['夜勤の看護', '師は一人で', 'night', 'shift']) === '夜勤の看護師は一人で night shift'));
  // Audit trail: a page of entries, then "Show more"
  const pg = await p.evaluate(async () => {
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) state.logs.push({ id: 'pg_' + i, timestamp: t0 - 1e9 - i, category: 'linking', action: 'Linked 1st Order Quote to 2nd Order Construct (X)', reviewer: 'A' });
    setActiveTab('audit'); await new Promise(r => setTimeout(r, 300));
    const shown = document.querySelectorAll('#auditTimelineList > div').length;
    const more = document.querySelector('.audit-show-more'); const label = more && more.textContent;
    more && more.click(); await new Promise(r => setTimeout(r, 300));
    return { shown, label, after: document.querySelectorAll('#auditTimelineList > div').length, total: state.logs.length };
  });
  check('the audit timeline shows a page of entries and more on request', pg.shown === 150 && new RegExp(`Show ${Math.min(150, pg.total - 150)} more`).test(pg.label || '') && pg.after === Math.min(300, pg.total), JSON.stringify(pg));
  // A row made here with the title of a peer row takes in the constructs waiting for it (Compare closed)
  const wt = await p.evaluate(async () => {
    const sec = state.annotations.find(a => a.type === 'second_order');
    sec._peerRows = { peer_waiting: { _title: 'A row the peer had', clusterRelations: 'reciprocal' } };
    await dbPut('annotations', sec);
    const c = await createNewClusterRow('A ROW THE PEER HAD', { silent: true });
    const n = await reattachWaitingForRow(c);
    return { n, placed: sec.clusterIds.includes(c.id), rel: sec.clusterRelations[c.id], waiting: !!sec._peerRows };
  });
  check('a row named here like a peer row takes in the constructs waiting for it', wt.n === 1 && wt.placed && wt.rel === 'reciprocal' && !wt.waiting, JSON.stringify(wt));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 6: flow by every directed relation, row deletion leaves nothing, export parity, restore resets, undo edges, trail entries', async () => {
  const p = await openDemo();
  // Flow map: a model of ⊃ / ≈ relations only still runs left to right
  const cols = await p.evaluate(() => {
    const saved = state.loa.links; const [x, y, z] = state.clusters;
    state.loa.links = [{ id: 'e1', from: x.id, to: y.id, type: 'encompasses' }, { id: 'e2', from: y.id, to: z.id, type: 'metaphor' }];
    const svg = buildConceptMapSvg('t', 640, 360, 'flow'); state.loa.links = saved;
    return new Set([...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="158"/g)].map(m => m[1])).size;
  });
  check('a flow map of ⊃ / ≈ relations spreads over columns', cols === 3, String(cols));
  // Deleting a row leaves no judgement, note, mark or map relation of it behind; Ctrl+Z brings them back
  const del = await p.evaluate(async () => {
    const c = state.clusters[0], other = state.clusters[1];
    const sec = rowSecs(c).find(s => !isRowBase(s, c.id));
    sec.clusterRelations[c.id] = 'refutational'; sec.clusterComments[c.id] = 'why'; sec.aspectUsedInLoa = { ...(sec.aspectUsedInLoa || {}), [c.id]: true };
    state.loa.links = [...(state.loa.links || []), { id: 'lk_del', from: c.id, to: other.id, type: 'leads' }];
    await dbPut('annotations', sec); await dbPut('meta', state.loa);
    await tab_matrix();
    async function tab_matrix() { setActiveTab('matrix'); await new Promise(r => setTimeout(r, 400)); }
    document.querySelector(`#matrixTable tr[data-cluster-id="${c.id}"] .del-cluster`).click();
    await new Promise(r => setTimeout(r, 500));
    const gone = !(c.id in sec.clusterRelations) && !(c.id in sec.clusterComments) && !(sec.aspectUsedInLoa || {})[c.id] && !(state.loa.links || []).some(l => l.id === 'lk_del');
    await performUndo();
    const back = sec.clusterIds.includes(c.id) && sec.clusterRelations[c.id] === 'refutational' && sec.clusterComments[c.id] === 'why' && sec.aspectUsedInLoa[c.id] === true && state.loa.links.some(l => l.id === 'lk_del');
    return { gone, back };
  });
  check('deleting a row removes its judgements, notes, marks and map relations', del.gone, JSON.stringify(del));
  check('Ctrl+Z brings them all back', del.back);
  // Exports say what the preview says: row notes in Markdown, pages in Table 2b, no "Funder: not recorded" when none is recorded
  const ex = await p.evaluate(() => {
    const c = state.clusters[0]; c.baselineChange = { fromName: 'A', toName: 'B' };
    const notes = rowStatusNotes(c); delete c.baselineChange;
    const saved = state.docs.map(d => d.funder); state.docs.forEach(d => { d.funder = ''; });
    const t1 = funderLinkedText(state.docs[0]); state.docs.forEach((d, i) => { d.funder = saved[i]; });
    return { notes, t1, pages: cellPagesLabel(rowSecs(state.clusters[0]).slice(0, 1)) };
  }).catch(e => ({ err: e.message }));
  check('row notes are shared by every renderer; funder is not repeated as "not recorded" when none is recorded', ex.notes && ex.notes.some(n => /study #1 changed/.test(n)) && ex.t1 === '-' && /^p\./.test(ex.pages), JSON.stringify(ex));
  // Restore: a clean restore of another project resets the view of the previous one; a malformed merge changes nothing
  const before = await p.evaluate(() => { state.hiddenStudyIds.add(state.docs[1].id); state.peerComparison = { peerReviewer: 'X' }; return state.annotations.length; });
  const bad = JSON.stringify({ docs: [], annotations: {}, clusters: [] });
  p.choiceAnswer = 'merge';
  await p.setInputFiles('#jsonFileInput', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(bad) }); await settle(p);
  check('a malformed backup is refused before anything is merged', await p.evaluate(n => state.annotations.length === n, before) && p.notices.some(t => /structure is invalid/.test(t)));
  const json = await p.evaluate(() => JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: state.logs, loa: state.loa, projectCode: state.projectCode, formatVersion: PROJECT_FORMAT }));
  p.choiceAnswer = 'clean';
  await p.setInputFiles('#jsonFileInput', { name: 'clean.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await settle(p, { quiet: 300 });
  p.choiceAnswer = null;
  check('a clean restore resets hidden studies and a comparison in progress', await p.evaluate(() => state.hiddenStudyIds.size === 0 && state.peerComparison === null));
  // Undo of a study deletion does not bring back a placement in a row deleted meanwhile
  const st = await p.evaluate(async () => {
    const d = state.docs[2];
    const sec = state.annotations.find(a => a.docId === d.id && a.type === 'second_order' && a.clusterIds.length);
    if (!sec) return { skip: true };
    const rowId = sec.clusterIds[0];
    pushUndoAction({ type: 'delete_study', label: 'study', doc: JSON.parse(JSON.stringify(d)), binary: null, annotations: state.annotations.filter(a => a.docId === d.id).map(a => JSON.parse(JSON.stringify(a))), position: 2 });
    await dbBatch([{ store: 'docs', del: d.id }, ...state.annotations.filter(a => a.docId === d.id).map(a => ({ store: 'annotations', del: a.id }))]);
    state.docs = state.docs.filter(x => x.id !== d.id); state.annotations = state.annotations.filter(a => a.docId !== d.id);
    state.clusters = state.clusters.filter(c => c.id !== rowId); await dbDelete('clusters', rowId);
    await performUndo(); await new Promise(r => setTimeout(r, 400));
    const back = state.annotations.find(a => a.id === sec.id);
    return { back: !!back, dangling: back ? back.clusterIds.includes(rowId) : null };
  });
  if (!st.skip) check('undoing a study deletion does not bring back a placement in a row deleted meanwhile', st.back && st.dangling === false, JSON.stringify(st));
  // Trail: deleting a construct is logged; entries about the trail cannot be deleted; a deletion undone does not reach Appendix A
  const tr = await p.evaluate(async () => {
    setActiveTab('extract'); await switchStudy(state.docs[0].id); await new Promise(r => setTimeout(r, 600));
    const btn = document.querySelector('#annotationsList .del');
    if (btn) btn.click(); await new Promise(r => setTimeout(r, 500));
    const logged = /^Deleted a (1st Order quote|2nd Order construct)/.test(state.logs[0].action);
    await performUndo(); await new Promise(r => setTimeout(r, 300));
    const victim = state.logs.find(l => l.category === 'third_order');
    setActiveTab('audit'); await new Promise(r => setTimeout(r, 400));
    const card = [...document.querySelectorAll('#auditTimelineList .del-log')].find(b => b.closest('div').textContent.includes(victim.action)) || document.querySelector('#auditTimelineList .del-log');
    card.click(); await new Promise(r => setTimeout(r, 400));
    const delLog = state.logs[0];
    await performUndo(); await new Promise(r => setTimeout(r, 400));
    const editCards = [...document.querySelectorAll('#auditTimelineList > div')].filter(c => /Deleted an audit trail entry|Restored a deleted audit trail entry/.test(c.textContent));
    const noDelBtn = editCards.length > 0 && editCards.every(c => !c.querySelector('.del-log'));
    const key = getAppendixASpec('key').rows;
    const inAppendix = key.some(r => /audit trail entry/.test(r.action));
    return { logged, noDelBtn, inAppendix, delLog: delLog.action };
  });
  check('deleting a construct in Tab 1 is logged', tr.logged, JSON.stringify(tr));
  check('entries about the trail itself have no delete button', tr.noDelBtn);
  check('an audit entry deleted and restored with Ctrl+Z does not reach Appendix A (key decisions)', !tr.inAppendix);
  // A reason being typed in the timeline is not interrupted by a redraw
  const rs = await p.evaluate(async () => {
    const box = document.querySelector('#auditTimelineList .rationale-input');
    box.focus(); box.value = 'typing a reason'; box.dispatchEvent(new Event('input', { bubbles: true }));
    renderAuditTimeline();
    const same = document.activeElement === box && box.isConnected && box.value === 'typing a reason';
    box.blur(); await new Promise(r => setTimeout(r, 300));
    return { same };
  });
  check('a reason being typed stays in place while the timeline would redraw', rs.same);
  check('publication years from 1940 are recognised (classic studies of the 1960s)', await p.evaluate(() => '(1967) The discovery of grounded theory'.match(YEAR_RE)[1] === '1967'));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Row header: title and status always shown; row tools open with ⋯', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  const r = await p.evaluate(() => {
    const tr = document.querySelector('#matrixTable tbody tr[data-cluster-id]');
    const vis = sel => { const el = tr.querySelector(sel); return !!el && el.offsetParent !== null; };
    return { title: vis('.cluster-title'), pills: vis('.cl-conc-pill') && vis('.cl-cerqual-pill') && vis('.cl-base-pill'), move: vis('.move-cl-up'),
      toolsHidden: !vis('.cl-rev-btn') && !vis('.del-cluster') && !vis('.cl-rowops') && !vis('.cl-base-select'), id: tr.dataset.clusterId };
  });
  check('title, team / CERQual / ◆ badges and ▲ ▼ are shown; reviewer, history, ◆ selector, merge and delete are not', r.title && r.pills && r.move && r.toolsHidden, JSON.stringify(r));
  await p.locator(`tr[data-cluster-id="${r.id}"] .cl-tools-toggle`).click(); await settle(p);
  check('⋯ opens the row tools', await p.evaluate(id => { const tr = document.querySelector(`tr[data-cluster-id="${id}"]`); return tr.querySelector('.del-cluster').offsetParent !== null && tr.querySelector('.cl-tools-toggle').getAttribute('aria-expanded') === 'true'; }, r.id));
  await p.evaluate(() => renderMatrixTable()); await settle(p);
  check('open row tools stay open when the matrix is drawn again', await p.evaluate(id => { const tr = document.querySelector(`tr[data-cluster-id="${id}"]`); return !!tr && tr.querySelector('.del-cluster').offsetParent !== null; }, r.id));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Switching study quickly: the last click wins, also while a commit is pending', async () => {
  const p = await openDemo();
  await tab(p, 'extract'); await p.evaluate(() => switchStudy(state.docs[0].id)); await settle(p);
  await p.click('#activeDocHeader'); await p.fill('#metaContextNote', 'typed, not yet saved');
  const r = await p.evaluate(async () => {
    const x = state.docs[1].id, y = state.docs[2].id;
    const a = switchStudy(x); const b = switchStudy(y);
    await Promise.all([a, b]); await new Promise(res => setTimeout(res, 500));
    return { active: state.activeDocId === y, saved: state.docs[0].contextNote === 'typed, not yet saved' };
  });
  check('the study clicked last is the one open, and the text typed before is saved', r.active && r.saved, JSON.stringify(r));
  await p.context().close();
});

await group('Review fixes 7: undo logs of constructs, manual entry kept on failure, peer logs once, project files sanitised, atomic split, Japanese authors', async () => {
  const p = await openDemo();
  // Undoing the deletion of a placed construct is logged with its rows, and is a key decision like the deletion
  await tab(p, 'extract'); await p.evaluate(() => switchStudy(state.docs[0].id)); await settle(p);
  const u = await p.evaluate(async () => {
    const sec = state.annotations.find(a => a.type === 'second_order' && a.docId === state.activeDocId && a.clusterIds.length);
    const card = document.querySelector(`[data-sidebar-anno="${sec.id}"]`);
    const del = card && (card.querySelector(':scope .del') || card.closest('div').querySelector('.del'));
    del.click(); await new Promise(r => setTimeout(r, 500));
    await performUndo(); await new Promise(r => setTimeout(r, 400));
    const log = state.logs[0];
    return { action: log.action, rows: (log.clusterIds || []).length, key: isKeyDecisionLog(log), back: state.annotations.some(a => a.id === sec.id) };
  });
  check('undoing the deletion of a placed construct is logged with its rows and reaches Appendix A', /^Restored a deleted 2nd Order construct \(Undo\)/.test(u.action) && u.rows > 0 && u.key && u.back, JSON.stringify(u));
  // A manual entry whose save fails is put back into the form
  const m = await p.evaluate(async () => {
    openManualAddDrawer('first_order');
    document.getElementById('manualAddPageInput').value = '3';
    document.getElementById('manualAddTextInput').value = 'A quote typed by hand from a scanned page';
    const orig = window.dbPut; window.dbPut = async (store, item, o) => { if (store === 'annotations') throw new Error('QuotaExceededError (simulated)'); return orig(store, item, o); };
    try { await submitManualAddForm(); } finally { window.dbPut = orig; }
    return { text: document.getElementById('manualAddTextInput').value, open: !document.getElementById('manualAddDrawer').classList.contains('hidden'), notice: !document.getElementById('choiceModal').classList.contains('hidden') || true };
  });
  check('a manual entry that could not be saved is back in the form', m.text === 'A quote typed by hand from a scanned page' && m.open, JSON.stringify(m));
  await p.evaluate(() => closeManualAddDrawer());
  // A project file: keys that would change a prototype are removed, records without an id are left out
  const sz = await p.evaluate(() => {
    const d = upgradeProjectData(JSON.parse('{"docs":[{"id":"d1","__proto__":{"polluted":true}},"not a record",{"name":"no id"}],"annotations":[],"clusters":[{"id":"c1","cellStatus":{"__proto__":{"polluted":true}}}]}'));
    return { docs: d.docs.length, dropped: d._droppedRecords, own: Object.prototype.hasOwnProperty.call(d.docs[0], '__proto__'), cs: Object.getPrototypeOf(d.clusters[0].cellStatus) === Object.prototype, polluted: ({}).polluted === undefined };
  });
  check('project files: prototype keys removed and malformed records left out', sz.docs === 1 && sz.dropped === 2 && !sz.own && sz.cs && sz.polluted, JSON.stringify(sz));
  // Compare: the peer's audit entries are merged once, however many constructs are imported
  const pl = await p.evaluate(async () => {
    const peer = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: state.logs.slice(0, 3).map((l, i) => ({ ...l, id: 'peerlog_' + i })), loa: state.loa, reviewerId: 'Peer' }));
    await processPeerJsonFile(new File([JSON.stringify(peer)], 'peer.json'));
    const a = await mergePeerAuditLogs(); const b = await mergePeerAuditLogs();
    return { a, b, merged: state.logs.filter(l => /^peerlog_/.test(l.id)).length };
  });
  check('the other reviewer\'s audit entries are merged once', pl.a === 3 && pl.b === 0 && pl.merged === 3, JSON.stringify(pl));
  // A split whose write fails leaves no empty row behind
  const sp = await p.evaluate(async () => {
    const src = state.clusters.find(c => rowSecs(c).length >= 2);
    const n = state.clusters.length, stored = (await dbGetAll('clusters')).length;
    const orig = window.dbBatch; window.dbBatch = async () => { throw new Error('simulated failure'); };
    let failed = false;
    try { await splitRow(src, [rowSecs(src)[0].id], 'Never stored', ''); } catch (e) { failed = true; } finally { window.dbBatch = orig; }
    return { failed, rows: state.clusters.length === n, db: (await dbGetAll('clusters')).length === stored };
  });
  check('a split that cannot be stored leaves no new row (in the project or in memory)', sp.failed && sp.rows && sp.db, JSON.stringify(sp));
  check('a Japanese author line gives the family name and et al.', await p.evaluate(() => { const r = extractSurnameFromAuthorString('山田 太郎、佐藤 花子'); return r.surname === '山田' && r.hasEtAl; }));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 8: merge of nested appraisal answers, deletions take their references, placing without dragging, waiting cards, storage errors, map pairs', async () => {
  const p = await openDemo();
  // Merge: a study whose appraisal was only opened here ({ CASP: {} }) takes the backup's answers, no conflict
  const ap = await p.evaluate(() => {
    const local = { appraisalItems: { CASP: {} } }, inc = { appraisalItems: { CASP: { q1: { a: 'yes', note: 'n' } } } };
    const r1 = mergeFillEmpty(local, inc);
    const l2 = { appraisalItems: { CASP: { q1: { a: 'yes' } } } }, i2 = { appraisalItems: { CASP: { q1: { a: 'yes' }, q2: { a: 'no' } } } };
    const r2 = mergeFillEmpty(l2, i2);
    return { filled1: r1.filled.includes('appraisalItems') && local.appraisalItems.CASP.q1.a === 'yes' && !r1.conflicts.length,
             nested: !!l2.appraisalItems.CASP.q2 && !r2.conflicts.length };
  });
  check('merge fills appraisal answers that are empty here, question by question, without a conflict', ap.filled1 && ap.nested, JSON.stringify(ap));
  // Deleting a construct takes its within-study relationships with it; Ctrl+Z brings them back
  await tab(p, 'extract'); await p.evaluate(() => switchStudy(state.docs[0].id)); await settle(p);
  const cl = await p.evaluate(async () => {
    const d = state.docs[0];
    const [s1, s2] = state.annotations.filter(a => a.docId === d.id && a.type === 'second_order');
    if (!s2) return { skip: true };
    d.conceptLinks = [...(d.conceptLinks || []), { id: 'cl_test', from: s1.id, to: s2.id, type: 'leads', note: '' }];
    await dbPut('docs', d); updateSidebar();
    document.querySelector(`[data-sidebar-anno="${s1.id}"]`).closest('div').querySelector('.del')?.click();
    await new Promise(r => setTimeout(r, 500));
    const gone = !(d.conceptLinks || []).some(l => l.id === 'cl_test');
    await performUndo(); await new Promise(r => setTimeout(r, 400));
    return { gone, back: (d.conceptLinks || []).some(l => l.id === 'cl_test') };
  });
  if (!cl.skip) check('deleting a construct removes its within-study relationships; Ctrl+Z restores them', cl.gone && cl.back, JSON.stringify(cl));
  // Deleting a study removes empty-cell records and "same study as" pointing to it; Ctrl+Z restores them
  const st = await p.evaluate(async () => {
    const victim = state.docs[3], other = state.docs[2], row = state.clusters[0];
    row.cellStatus = { ...(row.cellStatus || {}), [victim.id]: { status: 'absent', note: 'checked' } }; await dbPut('clusters', row);
    other.companionOf = victim.id; await dbPut('docs', other);
    renderStudyList(); await new Promise(r => setTimeout(r, 200));
    [...document.querySelectorAll('#studyList .del')][state.docs.indexOf(victim)].click();
    await new Promise(r => setTimeout(r, 600));
    const gone = !(victim.id in (row.cellStatus || {})) && other.companionOf === '';
    await performUndo(); await new Promise(r => setTimeout(r, 800));
    return { gone, back: (row.cellStatus || {})[victim.id] && other.companionOf === victim.id };
  });
  check('deleting a study removes references to it; Ctrl+Z restores them', st.gone && !!st.back, JSON.stringify(st));
  // Placing a construct without dragging; a card waiting for a peer row says so
  await tab(p, 'matrix'); await settle(p);
  const pl = await p.evaluate(async () => {
    const sec = state.annotations.find(a => a.type === 'second_order' && a.clusterIds.length < state.clusters.length);
    sec._peerRows = { pr_x: { _title: 'A row of the other reviewer' } }; renderSecondOrderPool();
    const card = [...document.querySelectorAll('#matrixLeftSidebar [draggable="true"]')].find(c => c.querySelector('.pool-waiting'));
    const waiting = !!card && /A row of the other reviewer/.test(card.querySelector('.pool-waiting').textContent);
    delete sec._peerRows;
    const target = state.clusters.find(c => !sec.clusterIds.includes(c.id));
    renderSecondOrderPool();
    const sel = [...document.querySelectorAll('.pool-place')].find(x => [...x.options].some(o => o.value === target.id));
    sel.value = target.id; sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 600));
    return { waiting, placed: sec.clusterIds.includes(target.id) };
  });
  check('a card waiting for a peer row says so', pl.waiting, JSON.stringify(pl));
  check('a construct can be placed in a row from the pool without dragging', pl.placed);
  // A write the browser refuses is said plainly
  await p.evaluate(() => { reportStorageError({ name: 'QuotaExceededError' }); });
  await settle(p);
  check('a refused write shows what happened and what to do', p.notices.some(t => /could not be saved[\s\S]*QuotaExceededError[\s\S]*Backup/.test(t)));
  // The drawer does not commit when focus moves into a dialog opened from it
  const dr = await p.evaluate(async () => {
    if (!state.isLoaOpen) document.getElementById('toggleLoaDrawerBtn').click();
    const n = state.logs.length;
    const el = document.getElementById('loaNarrativeInput'); el.focus(); el.value += ' (more)'; el.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('choiceModalCancelBtn').focus(); // as when a dialog opens from the drawer
    await new Promise(r => setTimeout(r, 300));
    return state.logs.length === n;
  });
  check('focus moving into a dialog does not commit the drawer', dr);
  // Two relations between the same constructs are drawn apart in the circular map
  const mp = await p.evaluate(() => {
    const saved = state.loa.links; const [x, y] = state.clusters;
    state.loa.links = [{ id: 'p1', from: x.id, to: y.id, type: 'leads' }, { id: 'p2', from: x.id, to: y.id, type: 'contradicts' }];
    const svg = buildConceptMapSvg('t', 640, 360, 'circle'); state.loa.links = saved;
    return (svg.match(/<path d="M[\d.]+,[\d.]+ Q/g) || []).length;
  });
  check('two relations between the same constructs are drawn as two curves, not one line over the other', mp === 2, String(mp));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Sidebar redraw keeps open sections, focus and caret', async () => {
  const p = await openDemo();
  await tab(p, 'extract'); await p.evaluate(() => switchStudy(state.docs[0].id)); await settle(p);
  const r = await p.evaluate(async () => {
    const list = document.getElementById('annotationsList');
    const card = [...list.querySelectorAll('[data-sidebar-anno]')].find(c => c.querySelector('.sec-note-input') && [...c.querySelectorAll('details')].some(d => !d.open));
    const det = card && [...card.querySelectorAll('details')].find(d => !d.open);
    if (!det) return { setup: false };
    det.open = true;
    const idx = [...card.querySelectorAll('details')].indexOf(det);
    const ta = card.querySelector('.sec-note-input');
    let caret = null;
    if (ta) { ta.focus(); caret = Math.min(3, ta.value.length); ta.setSelectionRange(caret, caret); }
    const id = card.dataset.sidebarAnno;
    updateSidebar();
    await new Promise(res => setTimeout(res, 200));
    const card2 = list.querySelector(`[data-sidebar-anno="${id}"]`);
    const det2 = card2 && card2.querySelectorAll('details')[idx];
    const ae = document.activeElement;
    return { setup: !!ta, open: !!det2 && det2.open, focus: (ae && ae.classList.contains('sec-note-input') && card2.contains(ae) && ae.selectionStart === caret) };
  });
  check('a section opened in a card stays open after the sidebar is drawn again', r.setup && r.open, JSON.stringify(r));
  check('the text box being edited keeps focus and caret', r.setup && r.focus, JSON.stringify(r));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Line-of-argument map: boxes can be moved, keep their place per layout and in the .svg; Reset layout and Ctrl+Z', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  await p.evaluate(async () => {
    const ids = state.clusters.map(c => c.id);
    state.loa.links = [{ id: 'm1', from: ids[0], to: ids[1], type: 'leads', note: '' }, { id: 'm2', from: ids[1], to: ids[2], type: 'contradicts', note: '' }];
    state.loa.mapLayout = 'circle'; delete state.loa.mapPositions;
    await dbPut('meta', state.loa);
  });
  await p.click('#toggleLoaDrawerBtn'); await settle(p);
  await p.evaluate(() => document.getElementById('loaMapBox').scrollIntoView());
  const node = p.locator('#loaMapBox .loa-map-node').first();
  const id = await node.getAttribute('data-node');
  const before = await p.evaluate(i => mapNodeCenter(document.querySelector(`#loaMapBox .loa-map-node[data-node="${CSS.escape(i)}"]`)), id);
  check('Reset layout is off while nothing was moved', await p.isDisabled('#loaMapResetBtn'));
  const b = await node.boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 40, { steps: 6 }); await p.mouse.up();
  await settle(p);
  const r = await p.evaluate(async ({ i, before }) => {
    const g = document.querySelector(`#loaMapBox .loa-map-node[data-node="${CSS.escape(i)}"]`);
    const now = mapNodeCenter(g);
    const stored = (await dbGetAll('meta')).find(m => m.id === 'loa_main');
    const svgDl = buildConceptMapSvg('dl', 640, 360);
    return { moved: now.x - before.x > 20 && now.y - before.y > 10, saved: !!(stored.mapPositions && stored.mapPositions.circle && stored.mapPositions.circle[i]),
      inExport: svgDl.includes(`x="${(now.x - +g.querySelector('rect').getAttribute('width') / 2).toFixed(1)}"`), exportPlain: !svgDl.includes('loa-map-node') && !svgDl.includes('data-node'),
      flowUntouched: !savedMapPos('flow', i), reset: !document.getElementById('loaMapResetBtn').disabled, now };
  }, { i: id, before });
  check('dragging a box moves it and saves its place', r.moved && r.saved, JSON.stringify(r));
  check('the downloaded .svg draws it there, without the editing attributes', r.inExport && r.exportPlain, JSON.stringify(r));
  check('the other layout keeps its own places; Reset layout is on', r.flowUntouched && r.reset);
  // Keyboard
  await p.locator(`#loaMapBox .loa-map-node[data-node="${id}"]`).focus();
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
  await settle(p);
  const k = await p.evaluate(i => ({ x: savedMapPos('circle', i).x, focused: document.activeElement && document.activeElement.dataset.node === i }), id);
  check('arrow keys move the focused box (and it keeps focus)', Math.abs(k.x - (Math.round(r.now.x) + 20)) <= 1 && k.focused, JSON.stringify(k));
  // Ctrl+Z undoes the key series in one step, Reset puts everything back, and Ctrl+Z undoes the reset
  await p.evaluate(() => performUndo()); await settle(p);
  const u = await p.evaluate(i => savedMapPos('circle', i).x, id);
  check('Ctrl+Z undoes the arrow-key move as one step', Math.abs(u - Math.round(r.now.x)) <= 1, String(u));
  await p.click('#loaMapResetBtn'); await settle(p);
  const z = await p.evaluate(i => ({ gone: !savedMapPos('circle', i), c: mapNodeCenter(document.querySelector(`#loaMapBox .loa-map-node[data-node="${CSS.escape(i)}"]`)) }), id);
  check('Reset layout puts the box back in its computed place', z.gone && Math.abs(z.c.x - before.x) < 1 && Math.abs(z.c.y - before.y) < 1, JSON.stringify(z));
  await p.evaluate(() => performUndo()); await settle(p);
  check('Ctrl+Z brings the moved places back', await p.evaluate(i => !!savedMapPos('circle', i), id));
  // Flow layout: a moved box stays where it was put and the map grows to hold it
  const f = await p.evaluate(i => {
    state.loa.mapLayout = 'flow'; setMapPos('flow', i, 900, 400);
    const svg = buildConceptMapSvg('t', 640, 360); const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    return { w: +vb[1], h: +vb[2], drawn: svg.includes('x="821.0"') };
  }, id);
  check('flow layout: the moved box is drawn there and the map grows', f.w >= 900 + 79 && f.h >= 400 && f.drawn, JSON.stringify(f));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Appendix A rules still match the audit entries the app writes', async () => {
  // Appendix A sorts entries by their action text (APPENDIX_EDIT_SERIES / APPENDIX_ROUTINE / APPENDIX_WRITEUP). If the wording of
  // an entry changes, its rule would stop matching without any error: every rule must match some action the app can write.
  const p = await openDemo();
  const rules = await p.evaluate(() => ({
    series: APPENDIX_EDIT_SERIES.map(x => x[0].source), routine: APPENDIX_ROUTINE.map(r => r.source), writeup: APPENDIX_WRITEUP.source,
    labels: Object.values(LOA_FIELD_LABELS), shared: Object.values(LOG_ACTION)
  }));
  await p.context().close();
  // The actions the app writes: the literals on each "action:" line, with ${a ? 'P' : 'Q'} read both ways and other ${…} as "1";
  // plus the drawer / write-up entries built from their labels
  const literals = [];
  const expand = t => {
    const m = t.match(/\$\{[^{}]*?\?\s*'([^']*)'\s*:\s*'([^']*)'\s*\}/);
    if (m) return [...expand(t.replace(m[0], m[1])), ...expand(t.replace(m[0], m[2]))];
    return [t.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '1')];
  };
  for (const f of fs.readdirSync(path.join(ROOT, 'app/js'))) {
    for (const line of fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8').split('\n')) {
      const at = line.indexOf('action:');
      if (at < 0) continue;
      for (const m of line.slice(at).matchAll(/`((?:[^`\\]|\\.)*)`|'((?:[^'\\]|\\.)*)'/g)) literals.push(...expand(m[1] ?? m[2]));
    }
  }
  rules.labels.forEach(l => literals.push('Updated ' + l));
  rules.shared.forEach(a => literals.push(a)); // actions written from LOG_ACTION (core.js)
  const dead = [];
  const test = (src, name) => { const re = new RegExp(src); if (!literals.some(t => re.test(t))) dead.push(`${name}: /${src}/`); };
  rules.series.forEach(r => test(r, 'series'));
  rules.routine.forEach(r => test(r, 'routine'));
  test(rules.writeup, 'writeup');
  check('every Appendix A rule matches an action the app writes', dead.length === 0, dead.join('; '));
});

await group('Review fixes 8: switch and undo tidy per-row marks and relationships, one transaction per change, demo not unbacked, Escape, tabs, parallel loops', async () => {
  const p = await openDemo();
  check('loading the demo leaves no "not backed up" mark', await p.evaluate(() => !lsGet('unbackedSince') && document.getElementById('backupReminder').classList.contains('hidden')));
  // Flow map: two relations between the same two rows of one column, and two feedback loops, do not draw on top of each other
  const fl = await p.evaluate(() => {
    const keep = state.loa.links;
    const ids = state.clusters.map(c => c.id);
    state.loa.links = [{ id: 't1', from: ids[0], to: ids[1], type: 'mutual' }, { id: 't2', from: ids[0], to: ids[1], type: 'contradicts' },
      { id: 't3', from: ids[0], to: ids[2], type: 'leads' }, { id: 't4', from: ids[2], to: ids[0], type: 'mutual' }, { id: 't5', from: ids[2], to: ids[0], type: 'contradicts' }];
    const svg = buildFlowMapSvg('t');
    state.loa.links = keep;
    const ds = [...svg.matchAll(/<path d="([^"]+)" fill="none"/g)].map(m => m[1]);
    return { n: ds.length, distinct: new Set(ds).size };
  });
  check('parallel relations in the left-to-right map are drawn apart (same column and feedback loops too)', fl.n === 5 && fl.distinct === 5, JSON.stringify(fl));
  // 2nd -> 1st switch: its line-of-argument marks and within-study relationships go; Ctrl+Z brings them back
  const sw = await p.evaluate(async () => {
    const sec = state.annotations.find(a => a.type === 'second_order' && !(a.passages || []).length && (a.clusterIds || []).length);
    const doc = state.docs.find(d => d.id === sec.docId);
    const other = state.annotations.find(a => a.type === 'second_order' && a.docId === doc.id && a.id !== sec.id);
    if (!other) return { skip: true };
    const rid = sec.clusterIds[0];
    sec.aspectUsedInLoa = { [rid]: true };
    doc.conceptLinks = [...(doc.conceptLinks || []), { id: 'cl_test', from: sec.id, to: other.id, type: 'leads', note: '' }];
    await dbPut('annotations', sec); await dbPut('docs', doc);
    await toggleAnnotationOrderType(sec.id);
    const a = await dbGet('annotations', sec.id), d = await dbGet('docs', doc.id);
    const switched = a.type === 'first_order' && !a.aspectUsedInLoa && !(d.conceptLinks || []).some(l => l.id === 'cl_test');
    await performUndo();
    const b = await dbGet('annotations', sec.id), d2 = await dbGet('docs', doc.id);
    return { switched, back: b.type === 'second_order' && !!(b.aspectUsedInLoa || {})[rid] && (d2.conceptLinks || []).some(l => l.id === 'cl_test') };
  });
  if (!sw.skip) check('switching a construct to a quote drops its line-of-argument marks and within-study relationships; Ctrl+Z restores them', sw.switched && sw.back, JSON.stringify(sw));
  await settle(p);
  // Absorb a construct as a passage and split it off again: its line-of-argument mark moves with it and back
  const ab = await p.evaluate(async () => {
    const secs = state.annotations.filter(a => a.type === 'second_order' && !(a.passages || []).length);
    let src, tgt;
    for (const s1 of secs) {
      const rid = (s1.clusterIds || [])[0];
      const t = rid && secs.find(x => x.id !== s1.id && x.docId === s1.docId && !(x.clusterIds || []).includes(rid));
      if (t) { src = s1; tgt = t; break; }
    }
    if (!src) return { skip: true };
    const rid = src.clusterIds[0];
    src.aspectUsedInLoa = { [rid]: true }; await dbPut('annotations', src);
    await absorbAsPassage(src, tgt);
    const t1 = await dbGet('annotations', tgt.id);
    const moved = !!(t1.aspectUsedInLoa || {})[rid] && !(await dbGet('annotations', src.id));
    const live = state.annotations.find(a => a.id === tgt.id);
    await splitOffPassage(live, live.passages.find(x => x.absorbed).id);
    const t2 = await dbGet('annotations', tgt.id), back = await dbGet('annotations', src.id);
    return { moved, back: !!back && !!(back.aspectUsedInLoa || {})[rid] && !((t2.aspectUsedInLoa || {})[rid]) };
  });
  if (!ab.skip) check('a construct made a passage takes its line-of-argument mark along, and gets it back when split off', ab.moved && ab.back, JSON.stringify(ab));
  else check('passage absorb: demo has suitable constructs', false, 'none');
  await settle(p);
  // Delete a construct, then its row, then undo the construct: it comes back without the row that is gone
  const ud = await p.evaluate(async () => {
    const sec = state.annotations.find(a => a.type === 'second_order' && (a.clusterIds || []).length);
    const rid = sec.clusterIds[0];
    sec.clusterRelations = { ...(sec.clusterRelations || {}), [rid]: 'reciprocal' }; sec.aspectUsedInLoa = { [rid]: true };
    await dbPut('annotations', sec);
    pushUndoAction({ type: 'delete_annotation', label: 'test', annotations: [JSON.parse(JSON.stringify(sec))], unlinkedChildrenIds: [], parentId: sec.id });
    await dbDelete('annotations', sec.id); state.annotations = state.annotations.filter(a => a.id !== sec.id);
    await dbDelete('clusters', rid); state.clusters = state.clusters.filter(c => c.id !== rid);
    await performUndo();
    const a = await dbGet('annotations', sec.id);
    return { back: !!a, noGoneRow: !!a && !a.clusterIds.includes(rid) && !(rid in (a.clusterRelations || {})) && !(rid in (a.aspectUsedInLoa || {})) };
  });
  check('undoing a construct deletion never brings back a placement in a row deleted since', ud.back && ud.noGoneRow, JSON.stringify(ud));
  await settle(p);
  // Tabs
  await tab(p, 'audit'); await settle(p);
  const tabs = await p.evaluate(() => ['viewExtractBtn', 'viewMatrixBtn', 'viewAuditBtn', 'viewPubBtn'].map(id => { const b = document.getElementById(id); return b.getAttribute('role') + ':' + b.getAttribute('aria-selected'); }).join(','));
  check('view buttons are tabs and say which one is selected', tabs === 'tab:false,tab:false,tab:true,tab:false', tabs);
  await tab(p, 'extract'); await settle(p);
  // Escape closes the project setup when it was opened to edit (it has a close button then), not at first start
  await p.evaluate(() => openProjectSetupModal({ isInitialOrReset: false })); await settle(p);
  await p.keyboard.press('Escape'); await settle(p);
  check('Escape closes the project setup opened from the header', await p.evaluate(() => document.getElementById('reviewerLoginModal').classList.contains('hidden')));
  await p.evaluate(() => openProjectSetupModal({ isInitialOrReset: true })); await settle(p);
  await p.keyboard.press('Escape'); await settle(p);
  check('Escape does not close the first-start project setup', await p.evaluate(() => !document.getElementById('reviewerLoginModal').classList.contains('hidden')));
  await p.evaluate(() => document.getElementById('reviewerLoginModal').classList.add('hidden'));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 9: flow sketch buttons save, row bases on merge / split, restore tidies links, undo order and parents, Appendix A series, search reset, focus', async () => {
  const p = await openDemo();
  // Text put into the flow sketch by a chip or an arrow button is saved like typed text
  await tab(p, 'matrix'); await settle(p);
  await p.click('#toggleLoaDrawerBtn'); await settle(p);
  const fl = await p.evaluate(() => { loaDrawerDirty = false; insertTextIntoLoaFlow(' ➔ '); return loaDrawerDirty; });
  check('a chip / arrow inserted into the flow sketch marks the drawer to be saved', fl);
  await p.click('#toggleLoaDrawerBtn'); await settle(p);
  // Merge: the source row's base card carries no old judgement into a row established by another study
  const mg = await p.evaluate(async () => {
    const src = state.clusters.find(c => rowBaseDocId(c) && rowSecs(c).some(s => s.docId === rowBaseDocId(c)));
    const baseCard = src && rowSecs(src).find(s => s.docId === rowBaseDocId(src));
    const tgt = baseCard && state.clusters.find(c => c !== src && !baseCard.clusterIds.includes(c.id));
    const other = tgt && state.docs.find(d => d.id !== rowBaseDocId(src));
    if (!other) return { skip: true };
    const tgtBase = tgt.baseDocId; tgt.baseDocId = other.id; await dbPut('clusters', tgt); // the target row is established by another study
    const card = rowSecs(src).find(s => s.docId === rowBaseDocId(src) && !s.clusterIds.includes(tgt.id));
    card.clusterRelations = { ...(card.clusterRelations || {}), [src.id]: 'refutational' }; // left from before it became the base
    await mergeRows(src, tgt, '');
    const r = { unjudged: secRelation(card, tgt.id) === 'unjudged', noted: /established that row/.test((card.clusterComments || {})[tgt.id] || '') };
    await performUndo();
    tgt.baseDocId = tgtBase; await dbPut('clusters', tgt);
    return r;
  });
  if (!mg.skip) check('merging into a row with another base: the source row\'s base card starts unjudged (no old judgement carried)', mg.unjudged && mg.noted, JSON.stringify(mg));
  else check('merge across bases: demo rows suitable', false, 'none');
  await settle(p);
  // Split of a "No single base" row stays without a single base; Ctrl+Z after a merge numbers the rows again
  const sp = await p.evaluate(async () => {
    const src = state.clusters.find(c => rowSecs(c).length >= 2);
    const prevBase = src.baseDocId; src.baseDocId = null; await dbPut('clusters', src);
    await splitRow(src, [rowSecs(src)[0].id], 'No-base split', '');
    const nw = state.clusters.find(c => c.thirdOrderTitle === 'No-base split');
    const kept = nw.baseDocId === null;
    await performUndo();
    src.baseDocId = prevBase; await dbPut('clusters', src);
    // Merge, move another row, undo the merge: every row has its own place, stored
    const [a, b] = [state.clusters[0], state.clusters[1]];
    await mergeRows(a, b, '');
    await moveClusterOrder(state.clusters[state.clusters.length - 1].id, -1);
    await performUndo();
    const stored = await dbGetAll('clusters');
    const orders = stored.map(c => c.order);
    return { kept, distinct: new Set(orders).size === orders.length, matches: state.clusters.every((c, i) => stored.find(x => x.id === c.id).order === i) };
  });
  check('splitting a row with no single base keeps the new row without one', sp.kept, JSON.stringify(sp));
  check('undoing a merge numbers every row again (no shared places)', sp.distinct && sp.matches, JSON.stringify(sp));
  await settle(p);
  // 1st -> 2nd switch, then delete the construct the quote belonged to, then undo the switch: no link to the deleted construct
  const tg = await p.evaluate(async () => {
    const q = state.annotations.find(a => a.type === 'first_order' && quoteParentIds(a).length);
    const parentId = q.parentIds[0];
    await toggleAnnotationOrderType(q.id);
    const parent = state.annotations.find(a => a.id === parentId);
    await dbDelete('annotations', parentId); state.annotations = state.annotations.filter(a => a.id !== parentId);
    await performUndo();
    const back = await dbGet('annotations', q.id);
    // put the construct back for the later checks
    await dbPut('annotations', parent); state.annotations.push(parent);
    return { type: back.type, noGone: !(back.parentIds || []).includes(parentId) };
  });
  check('undoing a 1st -> 2nd switch drops a link to a construct deleted since', tg.type === 'first_order' && tg.noGone, JSON.stringify(tg));
  await settle(p);
  // Appendix A: a project-wide text revised after other decisions gets its own line, in its place
  const ap = await p.evaluate(() => {
    const keep = state.logs; const t0 = Date.now();
    state.logs = [
      { id: 'x3', timestamp: t0 + 3, action: 'Updated Phase 1 Research Aim', category: 'phase1', toVal: 'v2' },
      { id: 'x2', timestamp: t0 + 2, action: 'Created a 3rd Order row', category: 'third_order', clusterIds: [state.clusters[0].id] },
      { id: 'x1', timestamp: t0 + 1, action: 'Updated Phase 1 Research Aim', category: 'phase1', toVal: 'v1' }
    ];
    const rows = getAppendixASpec('key').rows.map(r => r.action);
    state.logs = keep;
    return rows;
  });
  check('Appendix A does not fold a later revision of the aim back over other decisions', ap.length === 3 && /Aim/.test(ap[0]) && /row/.test(ap[1]) && /Aim/.test(ap[2]), JSON.stringify(ap));
  // A clean restore drops links to rows and constructs the file does not hold, and map relations between rows it does not hold
  const json = await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify({ docs: state.docs, annotations: state.annotations, clusters: state.clusters, logs: [], loa: state.loa, projectCode: state.projectCode, formatVersion: PROJECT_FORMAT }));
    const sec = d.annotations.find(a => a.type === 'second_order'); sec.clusterIds.push('row_gone'); sec.clusterRelations = { ...(sec.clusterRelations || {}), row_gone: 'reciprocal' };
    const q = d.annotations.find(a => a.type === 'first_order'); q.parentIds = [...(q.parentIds || []), 'sec_gone'];
    d.loa.links = [...(d.loa.links || []), { id: 'lk_gone', from: d.clusters[0].id, to: 'row_gone', type: 'leads' }];
    return JSON.stringify(d);
  });
  p.choiceAnswer = 'clean';
  await p.setInputFiles('#jsonFileInput', { name: 'dangling.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await settle(p, { quiet: 300 });
  p.choiceAnswer = null;
  const cr = await p.evaluate(async () => {
    const all = await dbGetAll('annotations'), meta = (await dbGetAll('meta')).find(m => m.id === 'loa_main');
    return { rows: !all.some(a => (a.clusterIds || []).includes('row_gone') || 'row_gone' in (a.clusterRelations || {})),
      parents: !all.some(a => (a.parentIds || []).includes('sec_gone')), links: !(meta.links || []).some(l => l.id === 'lk_gone'),
      logged: /links were dropped/.test(state.logs.find(l => /clean restore/.test(l.action)).detail) };
  });
  check('a clean restore drops links to rows / constructs / map rows the file does not hold, and says so', cr.rows && cr.parents && cr.links && cr.logged, JSON.stringify(cr));
  // PDF search: opening another study clears the hits shown for the previous one
  await tab(p, 'extract'); await settle(p);
  await p.fill('#pdfSearchInput', 'the'); await p.press('#pdfSearchInput', 'Enter'); await settle(p);
  const shown = await p.isVisible('#pdfSearchStatus');
  await p.evaluate(() => switchStudy(state.docs[1].id)); await settle(p);
  check('opening another study clears the search hits of the previous one', shown && !(await p.isVisible('#pdfSearchStatus')) && (await p.evaluate(() => pdfSearchState.matches.length === 0)));
  // The project setup opened to edit starts in the first box to fill, not on its close button
  await p.evaluate(() => openProjectSetupModal({ isInitialOrReset: false })); await settle(p);
  const foc = await p.evaluate(() => document.activeElement && document.activeElement.id);
  check('the project setup dialog starts in a text box, not on ×', /^initial/.test(foc || ''), String(foc));
  await p.keyboard.press('Escape'); await settle(p);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 10: setup after the project is read, no double entries, rebuilds commit typing, row bases, split undo, duplicate PDFs, passages, file names', async () => {
  const p = await openDemo();
  // 1 / 2 pressed twice: one annotation
  const dbl = await p.evaluate(async () => {
    const n = state.annotations.length;
    state.pendingSelection = { txt: 'A passage selected once', page: '1', firstPage: 1, rectsMap: {} };
    await Promise.all([addAnno('first_order'), addAnno('first_order')]);
    return state.annotations.length - n;
  });
  check('pressing 1 twice on one selection adds one quote', dbl === 1, String(dbl));
  await settle(p);
  // A memo button clicked twice: one memo
  await tab(p, 'audit'); await settle(p);
  await p.fill('#memoContentInput', 'One memo, clicked twice');
  await p.evaluate(() => { const b = document.getElementById('addMemoBtn'); b.click(); b.click(); });
  await settle(p);
  check('clicking Add memo twice adds it once', await p.evaluate(() => state.logs.filter(l => l.detail === 'One memo, clicked twice').length === 1));
  // A matrix rebuild (a toggle, not renderMatrixView) commits the text being typed, with its audit entry
  await tab(p, 'matrix'); await settle(p);
  const typed = await p.evaluate(async () => {
    const box = document.querySelector('#matrixTable .cl-conc-note, #matrixTable .cq-exp, #matrixTable textarea');
    if (!box) return { skip: true };
    box.value = (box.value || '') + ' typed before a rebuild';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    renderMatrixTable();
    return { cls: box.className.split(' ')[0] };
  });
  await settle(p);
  if (!typed.skip) check('a matrix rebuild commits the text being typed (saved and logged)', await p.evaluate(() => state.logs.some(l => /typed before a rebuild/.test((l.toVal || '') + (l.detail || '')))), JSON.stringify(typed));
  // Merging into a row set to "No single base" keeps it so
  const nb = await p.evaluate(async () => {
    const [src, tgt] = [state.clusters[0], state.clusters[1]];
    const was = tgt.baseDocId; tgt.baseDocId = null; await dbPut('clusters', tgt);
    await mergeRows(src, tgt, '');
    const kept = tgt.baseDocId === null;
    await performUndo();
    tgt.baseDocId = was; await dbPut('clusters', tgt);
    return kept;
  });
  check('merging into a row with no single base keeps it without one', nb);
  await settle(p);
  // Split, judge the moved card again in the new row, undo the split: the newer judgement is in the original row
  const su = await p.evaluate(async () => {
    const src = state.clusters.find(c => rowBaseDocId(c) && rowSecs(c).filter(s => s.docId === rowBaseDocId(c)).length && rowSecs(c).some(s => s.docId !== rowBaseDocId(c)));
    if (!src) return { skip: true };
    const baseCard = rowSecs(src).find(s => s.docId === rowBaseDocId(src)), other = rowSecs(src).find(s => s.docId !== rowBaseDocId(src));
    await splitRow(src, [baseCard.id, other.id], 'Split for undo', '');
    const nw = state.clusters.find(c => c.thirdOrderTitle === 'Split for undo');
    const next = secRelation(other, nw.id) === 'refutational' ? 'reciprocal' : 'refutational';
    other.clusterRelations = { ...other.clusterRelations, [nw.id]: next }; other.clusterComments = { ...other.clusterComments, [nw.id]: 'Read again after the split' };
    await dbPut('annotations', other);
    await performUndo();
    const a = await dbGet('annotations', other.id);
    return { back: a.clusterIds.includes(src.id), rel: (a.clusterRelations || {})[src.id] === next, note: (a.clusterComments || {})[src.id] === 'Read again after the split',
      noGarbage: !Object.keys(a.clusterRelations || {}).concat(Object.keys(a.clusterComments || {})).includes(nw.id), log: /now in the original row/.test(state.logs[0].detail) };
  });
  if (!su.skip) check('undoing a split keeps a judgement / note changed in the new row, in the original row', su.back && su.rel && su.note && su.noGarbage && su.log, JSON.stringify(su));
  await settle(p);
  // A construct with its own further passages, absorbed and split off again, takes them back
  const pa = await p.evaluate(async () => {
    const secs = state.annotations.filter(a => a.type === 'second_order' && !(a.passages || []).length);
    const src = secs.find(a => secs.some(b => b.id !== a.id && b.docId === a.docId));
    const tgt = secs.find(b => b.id !== src.id && b.docId === src.docId);
    src.passages = [{ id: 'p_own', text: 'Its own further passage', page: '2', firstPage: 2, rectsMap: null, by: 'R', addedAt: '' }];
    await dbPut('annotations', src);
    await absorbAsPassage(src, tgt);
    const live = state.annotations.find(a => a.id === tgt.id);
    await splitOffPassage(live, live.passages.find(x => x.absorbed).id);
    const back = state.annotations.find(a => a.id === src.id), t = state.annotations.find(a => a.id === tgt.id);
    return { back: (back.passages || []).some(x => x.id === 'p_own'), gone: !(t.passages || []).some(x => x.id === 'p_own') };
  });
  check('a construct split off again takes its own further passages back', pa.back && pa.gone, JSON.stringify(pa));
  await settle(p);
  // File names: characters that file systems refuse are replaced, letters of any script kept
  check('download names replace characters that file systems refuse', await p.evaluate(() => fileNamePart('A/B:C*D? 日本') === 'A_B_C_D_日本'));
  // The same PDF dropped again: asked first, and "Skip" adds nothing
  await tab(p, 'extract'); await settle(p);
  const name = await p.evaluate(() => state.docs[0].name);
  const nDocs = await p.evaluate(() => state.docs.length);
  p.autoReason = false;
  await p.setInputFiles('#pdfFileInput', path.join(ROOT, 'app', 'demo', name));
  await p.waitForFunction(() => !document.getElementById('choiceModal').classList.contains('hidden'));
  const asked = /already in the project/.test(await p.innerText('#choiceModal'));
  await p.click('#choiceModalCancelBtn');
  p.autoReason = true;
  await settle(p);
  check('dropping a PDF that is already in the project asks first; Skip adds nothing', asked && (await p.evaluate(n => state.docs.length === n, nDocs)));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Start-up: with the project code only in the database, the setup opens after it is read and shows it', async () => {
  const p = await openDemo();
  const code = await p.evaluate(async () => {
    state.loa = { ...state.loa, projectCode: state.projectCode }; await dbPut('meta', state.loa);
    lsRemove('me_project_code');
    return state.projectCode;
  });
  await p.reload();
  await p.waitForFunction(() => typeof state !== 'undefined' && state.docs && state.docs.length > 0);
  await settle(p);
  const r = await p.evaluate(() => ({ code: state.projectCode, modalOpen: !document.getElementById('reviewerLoginModal').classList.contains('hidden') }));
  check('a project code stored in the project is read before the setup is considered (no setup asked for it)', r.code === code && !r.modalOpen, JSON.stringify(r));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 11: history count without a second rebuild, peer rows, dialogs on top, wrapped text, map keys, author particles', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  // A note typed in a row, then a rebuild: the table is built once, and the row's History count follows the new entry
  const hc0 = await p.evaluate(() => {
    const tr = document.querySelector('#matrixTable tr[data-cluster-id]');
    const id = tr.dataset.clusterId, c = state.clusters.find(x => x.id === id);
    const box = tr.querySelector('.cl-conc-note');
    if (!box) return { skip: true };
    window.__hc = { id, before: rowHistoryCount(c), builds: 0, orig: window.renderMatrixTable };
    box.value = (box.value || '') + ' discussed again';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    window.renderMatrixTable = function () { window.__hc.builds++; return window.__hc.orig.apply(this, arguments); };
    renderMatrixView();
    return {};
  });
  await settle(p);
  const hc = hc0.skip ? hc0 : await p.evaluate(() => {
    const h = window.__hc; window.renderMatrixTable = h.orig;
    const c = state.clusters.find(x => x.id === h.id);
    const btn = document.querySelector(`#matrixTable tr[data-cluster-id="${CSS.escape(h.id)}"] .cl-history-btn`);
    return { builds: h.builds, before: h.before, after: rowHistoryCount(c), shown: btn && btn.textContent };
  });
  if (!hc.skip) check('a rebuild while typing builds the table once; the History count follows the new entry', hc.builds === 1 && hc.after === hc.before + 1 && hc.shown === `🕘 History (${hc.after})`, JSON.stringify(hc));
  await settle(p);
  // A construct waiting for a peer row: when the row arrives, it sets the row's base (if not set) and clears the empty-cell note
  const rp = await p.evaluate(async () => {
    const sec = state.annotations.find(a => a.type === 'second_order');
    const row = normalizeCluster({ id: 'cl_peer_test', thirdOrderTitle: 'Peer row', baseDocId: '', cellStatus: { [sec.docId]: { status: 'absent', note: '' } }, order: state.clusters.length });
    await dbPut('clusters', row); state.clusters.push(row);
    sec._peerRows = { peer_row: { clusterRelations: 'reciprocal' } }; await dbPut('annotations', sec);
    const n = await reattachPeerRowPlacements('peer_row', row.id);
    const stored = await dbGet('clusters', row.id);
    return { n, base: stored.baseDocId === sec.docId, cleared: !(stored.cellStatus || {})[sec.docId], placed: sec.clusterIds.includes(row.id) };
  });
  check('a peer row arriving later sets its base and clears the empty-cell note, as a placement here does', rp.n === 1 && rp.base && rp.cleared && rp.placed, JSON.stringify(rp));
  // Dialogs that must be answered sit above the project setup
  const z = await p.evaluate(() => { const zi = id => +getComputedStyle(document.getElementById(id)).zIndex; return { choice: zi('choiceModal'), reason: zi('reasonModal'), setup: zi('reviewerLoginModal') }; });
  check('choice and reason dialogs open above the project setup', z.choice > z.setup && z.reason > z.setup, JSON.stringify(z));
  // A reviewer-wrapped construct keeps its quotation marks when its text is edited
  check('editing a wrapped construct keeps its closing quotation mark', await p.evaluate(() => cleanAnnotationText({ origin: 'wrapped_first_order' }, ' [Concept derived from 1st Order Quote]: "nights alone" ') === '[Concept derived from 1st Order Quote]: "nights alone"' && cleanAnnotationText({}, '"quoted"') === 'quoted'));
  // A box moved with the arrow keys is saved on a tab switch, before its 600 ms timer
  await p.click('#toggleLoaDrawerBtn'); await settle(p);
  await p.evaluate(() => { state.loa.mapLayout = 'circle'; const ids = state.clusters.map(c => c.id); state.loa.links = [{ id: 'k1', from: ids[0], to: ids[1], type: 'leads', note: '' }]; renderLoaMap(); document.getElementById('loaMapBox').scrollIntoView(); });
  const node = p.locator('#loaMapBox .loa-map-node').first();
  const nid = await node.getAttribute('data-node');
  await node.focus(); await p.keyboard.press('ArrowRight');
  await p.evaluate(() => setActiveTab('audit'));
  await settle(p);
  check('a box moved with the arrow keys is saved when the tab is switched at once', await p.evaluate(async id => { const m = (await dbGetAll('meta')).find(x => x.id === 'loa_main'); return !!(m.mapPositions && m.mapPositions.circle && m.mapPositions.circle[id]); }, nid));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 12: memos on rows that share a title, the last study deleted, a row base not set yet', async () => {
  const p = await openDemo();
  // Two rows with the same title: a memo goes to the row chosen, not to the first of that title
  await tab(p, 'audit'); await settle(p);
  const memo = await p.evaluate(async () => {
    const [a, b] = state.clusters;
    const was = [a.thirdOrderTitle, b.thirdOrderTitle];
    a.thirdOrderTitle = b.thirdOrderTitle = 'Same title'; await dbPut('clusters', a); await dbPut('clusters', b);
    renderAuditView();
    const sel = document.getElementById('memoTargetRef');
    sel.value = 'row:' + b.id;
    document.getElementById('memoContentInput').value = 'A memo on the second row';
    document.getElementById('addMemoBtn').click();
    return { bId: b.id, was };
  });
  await settle(p);
  const m = await p.evaluate(async ({ bId, was }) => {
    const log = state.logs.find(l => l.detail === 'A memo on the second row');
    const [a, b] = state.clusters; a.thirdOrderTitle = was[0]; b.thirdOrderTitle = was[1]; await dbPut('clusters', a); await dbPut('clusters', b);
    return { rows: log && log.clusterIds, action: log && log.action };
  }, memo);
  check('a memo goes to the row chosen even when two rows share a title', JSON.stringify(m.rows) === JSON.stringify([memo.bId]) && /Same title/.test(m.action || ''), JSON.stringify(m));
  check('the memo type is worded as team perspectives', await p.evaluate(() => [...document.getElementById('memoSubType').options].every(o => !/concordance/i.test(o.value + o.textContent))));
  // A row whose base is not set yet: choosing "No single base" stores it, so the next construct placed does not set one
  await tab(p, 'matrix'); await settle(p);
  const nb = await p.evaluate(async () => {
    const c = state.clusters[0]; const was = c.baseDocId;
    c.baseDocId = ''; await dbPut('clusters', c); renderMatrixTable();
    return { id: c.id, was };
  });
  await settle(p);
  const sel = p.locator(`#matrixTable tr[data-cluster-id="${nb.id}"] .cl-base-select`);
  const shownUnset = await sel.evaluate(s => s.selectedOptions[0].value === '__unset');
  await sel.evaluate(s => { s.value = ''; s.dispatchEvent(new Event('change')); }); // (the selector sits in the row's ⋯ tools)
  await settle(p);
  const nbr = await p.evaluate(async ({ id, was }) => { const c = state.clusters.find(x => x.id === id); const r = c.baseDocId; c.baseDocId = was; await dbPut('clusters', c); return r; }, nb);
  check('a row whose base is not set yet says so, and "No single base" chosen there is stored', shownUnset && nbr === null, JSON.stringify({ shownUnset, nbr }));
  await settle(p);
  // The last study deleted: its PDF is closed, not only hidden
  await tab(p, 'extract'); await settle(p);
  const n = await p.evaluate(() => state.docs.length);
  for (let i = 0; i < n; i++) { await p.locator('#studyList .del').first().click(); await settle(p); }
  check('deleting the last study closes its PDF', await p.evaluate(() => state.docs.length === 0 && !state.activePdfDoc && !pageObserver && document.getElementById('pdfPageCountLabel').textContent === '0 pages'));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('Review fixes 13: no ghost after delete, undo clears empty-cell notes, merge bases, wrapped quotes, Reviewer ID cancel, dialog order, exports', async () => {
  const p = await openDemo();
  await tab(p, 'extract'); await settle(p);
  // A quote's note typed, then the quote deleted at once: it stays deleted (no save lands after the deletion)
  const ghost = await p.evaluate(async () => {
    const card = document.querySelector('#annotationsList .f-note-input');
    if (!card) return { skip: true };
    const id = card.closest('[data-sidebar-anno]').dataset.sidebarAnno;
    card.value = 'typed just before deleting'; card.dispatchEvent(new Event('input', { bubbles: true }));
    card.closest('[data-sidebar-anno]').querySelector('.del').click();
    return { id };
  });
  await settle(p);
  if (!ghost.skip) check('a quote deleted right after typing in it stays deleted', await p.evaluate(async id => !(await dbGet('annotations', id)) && !state.annotations.some(a => a.id === id), ghost.id), JSON.stringify(ghost));
  // Undo that brings a card back into a row clears the empty-cell note for its study there
  const uc = await p.evaluate(async () => {
    const sec = state.annotations.find(a => a.type === 'second_order' && liveClusterIds(a).length);
    const row = state.clusters.find(c => c.id === liveClusterIds(sec)[0]);
    await removeSecondOrderFromCluster(sec, row);
    row.cellStatus = { ...(row.cellStatus || {}), [sec.docId]: { status: 'other_aspect', note: 'set after the card was taken out' } };
    await dbPut('clusters', row);
    await performUndo();
    const stored = await dbGet('clusters', row.id);
    return { back: sec.clusterIds.includes(row.id), cleared: !(stored.cellStatus || {})[sec.docId] };
  });
  check('Ctrl+Z putting a card back in a row clears the empty-cell note for its study there', uc.back && uc.cleared, JSON.stringify(uc));
  await settle(p);
  // Merge across bases: a card of the target row's base study becomes its base (not "to judge again against itself")
  const mb = await p.evaluate(async () => {
    const [src, tgt] = state.clusters;
    const card = rowSecs(src).find(s => !s.clusterIds.includes(tgt.id));
    if (!card) return { skip: true };
    const was = [src.baseDocId, tgt.baseDocId];
    const other = state.docs.find(d => d.id !== card.docId);
    src.baseDocId = other.id; tgt.baseDocId = card.docId; await dbPut('clusters', src); await dbPut('clusters', tgt);
    card.clusterRelations = { ...card.clusterRelations, [src.id]: 'reciprocal' };
    card.aspectUsedInLoa = { [src.id]: true };
    await mergeRows(src, tgt, '');
    const r = { base: secRelation(card, tgt.id) === 'baseline', noSelf: !/to judge again against/.test((card.clusterComments || {})[tgt.id] || ''), noMark: !((card.aspectUsedInLoa || {})[tgt.id]) };
    await performUndo();
    src.baseDocId = was[0]; tgt.baseDocId = was[1]; await dbPut('clusters', src); await dbPut('clusters', tgt);
    return r;
  });
  if (!mb.skip) check('merging: a card of the target row\'s base study becomes its base, without an old judgement or mark', mb.base && mb.noSelf && mb.noMark, JSON.stringify(mb));
  await settle(p);
  // A reviewer-wrapped construct switched to a quote goes back to the quote text, without its 2nd Order fields
  const wq = await p.evaluate(async () => {
    const f = state.annotations.find(a => a.type === 'first_order');
    const w = await wrapFirstOrderInSecondOrder(f, '[Descriptive] Test wrap');
    if (!w) return { skip: true };
    await toggleAnnotationOrderType(w.id);
    const a = state.annotations.find(x => x.id === w.id);
    return { type: a.type, text: a.text === stripOuterQuotes(f.text), origin: a.origin === undefined };
  });
  if (!wq.skip) check('a wrapped construct switched to a quote is the quote again, without 2nd Order fields', wq.type === 'first_order' && wq.text && wq.origin, JSON.stringify(wq));
  await settle(p);
  // Reviewer ID change cancelled: nothing changes
  p.autoReason = false;
  const oldRev = await p.evaluate(() => state.reviewerId);
  await p.fill('#reviewerIdInput', 'SomeoneElse'); await p.press('#reviewerIdInput', 'Enter');
  await p.evaluate(() => document.getElementById('reviewerIdInput').dispatchEvent(new Event('change')));
  await p.waitForFunction(() => !document.getElementById('choiceModal').classList.contains('hidden'));
  await p.click('#choiceModalCancelBtn'); p.autoReason = true; await settle(p);
  check('cancelling the Reviewer ID question keeps the old ID', await p.evaluate(o => state.reviewerId === o && lsGet('me_reviewer_id') === o && document.getElementById('reviewerIdInput').value === o, oldRev));
  // A notice raised while a reason is asked comes in front, and Escape closes it first
  p.autoReason = false;
  await p.evaluate(() => { askReason({ title: 'Reason', label: 'Why' }); setTimeout(() => showNotice('A notice', 'In front'), 50); });
  await p.waitForFunction(() => !document.getElementById('choiceModal').classList.contains('hidden') && !document.getElementById('reasonModal').classList.contains('hidden'));
  const front = await p.evaluate(() => +getComputedStyle(document.getElementById('choiceModal')).zIndex > +getComputedStyle(document.getElementById('reasonModal')).zIndex);
  await p.keyboard.press('Escape');
  const order = await p.evaluate(() => ({ notice: document.getElementById('choiceModal').classList.contains('hidden'), reason: !document.getElementById('reasonModal').classList.contains('hidden') }));
  await p.keyboard.press('Escape'); p.autoReason = true; await settle(p);
  check('the dialog opened last is in front and Escape closes it first', front && order.notice && order.reason, JSON.stringify({ front, order }));
  // Raw CSV: CRLF line ends; Table 2 Markdown has the cards' row notes
  await tab(p, 'pub'); await settle(p);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportCsvBtn')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check('the synthesis CSV uses CRLF line ends', csv.includes('\r\n') && !/[^\r]\n/.test(csv.replace(/"[^"]*"/g, '')));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('One save path for text boxes (bindTextField): a draft while typing, one save and one entry when left', async () => {
  const p = await openDemo();
  await tab(p, 'matrix'); await settle(p);
  // Typing: the record gets the text and a draft save after the pause (settle waits for it)
  await p.evaluate(() => {
    const tr = document.querySelector('#matrixTable tr[data-cluster-id]');
    const c = state.clusters.find(x => x.id === tr.dataset.clusterId);
    const box = tr.querySelector('.cluster-trans');
    window.__sp = { id: c.id, before: state.logs.length, puts: [], orig: window.dbPut };
    window.dbPut = function (st, item) { if (st === 'clusters' && item && item.id === c.id) window.__sp.puts.push(item.translationSummary); return window.__sp.orig.apply(this, arguments); };
    box.value = (c.translationSummary || '') + ' read again  ';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(p);
  // More typing, then the box is left before the next pause: one save (the waiting draft is dropped) and one entry
  const draftSaved = await p.evaluate(async () => {
    const n = window.__sp.puts.length;
    const box = document.querySelector(`#matrixTable tr[data-cluster-id="${CSS.escape(window.__sp.id)}"] .cluster-trans`);
    box.value += 'and once more  ';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAllPendingSaves();
    return n === 1;
  });
  await settle(p);
  const r = await p.evaluate(async () => {
    const sp = window.__sp; window.dbPut = sp.orig;
    const stored = (await dbGet('clusters', sp.id)).translationSummary;
    return { draftSaved: true, putsAfterDraft: sp.puts.length - 1, trimmed: stored === stored.trim() && /and once more$/.test(stored), entries: state.logs.length - sp.before };
  });
  r.draftSaved = draftSaved;
  check('typing saves a draft after a pause', r.draftSaved, JSON.stringify(r));
  check('leaving the box saves once (the waiting draft is dropped), trimmed, with one audit entry', r.putsAfterDraft === 1 && r.trimmed && r.entries === 1, JSON.stringify(r));
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await group('No browser dialogs: alert(), confirm() and prompt() are not used', async () => {
  // A browser may suppress its own dialogs ("Don't allow this page to show more dialogs"): confirm() then returns false and
  // prompt() null without asking. The app asks in its own dialogs (askChoice, askReason, showNotice) and the snackbar.
  const offenders = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'app/js'))) {
    const code = fs.readFileSync(path.join(ROOT, 'app/js', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/(?<![\w.$])(alert|confirm|prompt)\s*\(/g)) offenders.push(`${f}: ${m[1]}()`);
  }
  check('no native dialog calls in app/js', offenders.length === 0, offenders.join(', '));
});

await group('Shared global scope: no top-level name is declared twice across the app scripts', async () => {
  // The app scripts are classic <script>s sharing one global scope (file:// cannot load ES modules). Two top-level
  // declarations of one name either stop the page (const / let / class) or silently replace a function: catch both here.
  const html = fs.readFileSync(path.join(ROOT, 'me_canvas.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="(app\/(?!vendor\/)[^"]+\.js)"/g)].map(m => m[1]);
  const seen = new Map(), dups = [];
  for (const rel of scripts) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/^(?:async\s+)?(?:function\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))/gm)) {
      const name = m[1] || m[2];
      if (seen.has(name)) dups.push(`${name} (${seen.get(name)} and ${rel})`); else seen.set(name, rel);
    }
  }
  check(`app scripts found in load order (${scripts.length})`, scripts.length >= 10 && scripts[0] === 'app/version.js' && scripts[1] === 'app/js/core.js' && scripts[2] === 'app/js/logic.js', scripts.join(', '));
  // logic.js is the DOM-free part that the unit tests load alone in Node
  const logic = fs.readFileSync(path.join(ROOT, 'app/js/logic.js'), 'utf8').replace(/\/\/.*$/gm, '');
  const pageUse = logic.match(/\b(document|window|localStorage|indexedDB|state|lsGet|lsSet|dbPut|dbGet\w*|showSnackbar)\b/g) || [];
  check('logic.js uses nothing of the page or the project state', pageUse.length === 0, [...new Set(pageUse)].join(', '));
  // The smoke tests wait for the app (settle) or for a condition, never a fixed time
  const fixedWaits = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => l.includes('.waitFor' + 'Timeout(')).length;
  check('no fixed waits in the smoke tests', fixedWaits === 0, `${fixedWaits} found`);
  check(`no top-level name declared twice (${seen.size} names)`, dups.length === 0, dups.join('; '));
});

await group('Content-Security-Policy: the app works under it, and no request can leave the site (http and file://)', async () => {
  for (const url of [BASE + '?demo', 'file://' + path.join(ROOT, 'me_canvas.html') + '?demo']) {
    const where = url.startsWith('file') ? 'file://' : 'http';
    const p = await openDemo(url);
    await p.waitForFunction(() => document.querySelector('#pdfPagesWrapper canvas'), null, { timeout: 20000 }).catch(() => {});
    check(`${where}: the policy is in place`, (await p.locator('meta[http-equiv="Content-Security-Policy"]').count()) === 1);
    check(`${where}: PDF pages render under it`, (await p.locator('#pdfPagesWrapper canvas').count()) > 0);
    await tab(p, 'pub'); await settle(p);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#downloadWordDocBtn')]);
    check(`${where}: Word export works under it`, (await dl.path()) !== null);
    check(`${where}: nothing the app needs is blocked`, p.cspRefusals.length === 0, p.cspRefusals.slice(0, 2).join(' | '));
    const sent = await p.evaluate(async () => {
      const r = [];
      try { await fetch('https://example.com/x'); r.push('fetch'); } catch (e) {}
      await new Promise(res => { const i = new Image(); i.onload = () => { r.push('img'); res(); }; i.onerror = res; i.src = 'https://example.com/x.png'; });
      return r;
    });
    check(`${where}: data cannot be sent out (fetch, image beacon)`, sent.length === 0, sent.join(','));
    check(`${where}: no page errors`, p.pageErrors.length === 0, p.pageErrors.join(' | '));
    await p.context().close();
  }
});

await group('Offline edition (file://) starts without errors and renders PDFs', async () => {
  const p = await openDemo('file://' + path.join(ROOT, 'me_canvas.html') + '?demo');
  await p.waitForFunction(() => document.querySelector('#pdfPagesWrapper canvas'), null, { timeout: 20000 }).catch(() => {});
  check('PDF pages rendered', (await p.locator('#pdfPagesWrapper canvas').count()) > 0);
  check('no page errors', p.pageErrors.length === 0, p.pageErrors.join(' | '));
  await p.context().close();
});

await browser.close();
server.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
