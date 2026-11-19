// Screenshots for the website (site/img/*.png) and the social-media card (site/preview.png), taken from the
// AI-GENERATED demo project (?demo) so that they always show the current app. Run after a visible UI change:
//   node tools/site/make-screenshots.mjs
// Needs Playwright with Chromium (see npm test). Writes into site/ only.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'site', 'img');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
await page.goto(BASE + '/me_canvas.html?demo');
await page.waitForFunction(() => typeof state !== 'undefined' && state.docs.length > 0, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const settle = (ms = 900) => page.waitForTimeout(ms);
const shot = async (name, el) => { await (el || page).screenshot({ path: path.join(OUT, name) }); console.log('✔', name); };

// 01 · Tab 1: PDF with highlights and the extracted cards (study #1, with its within-study relationships open)
await page.evaluate(async () => { setActiveTab('extract'); await switchStudy(state.docs[0].id); });
await settle(1500);
await page.evaluate(() => { const b = document.querySelector('.study-links'); if (b) b.open = true; });
await settle(300);
await shot('01-extract.png');

// 02 · Edit Study Info, scrolled to the appraisal section with the CASP judgements
await page.evaluate(async () => { await switchStudy(state.docs[1].id); state.isEditMetaMode = true; toggleMetaDockUI(); });
await settle(800);
await page.evaluate(() => { const box = document.getElementById('metaDomainBox'); box.open = true; box.scrollIntoView({ block: 'start' }); });
await settle(300);
await shot('02-study-info.png');
await page.evaluate(() => { state.isEditMetaMode = false; toggleMetaDockUI(); });

// 03 · Tab 2: the synthesis matrix
await page.evaluate(() => setActiveTab('matrix'));
await settle(1200);
await shot('03-matrix.png');

// 03b · a Refutational card with its reason
const refut = page.locator('.matrix-cell-card').filter({ has: page.locator('select.rel-select option[value="refutational"]:checked') }).first();
await refut.scrollIntoViewIfNeeded(); await settle(300);
await shot('03b-refutational.png', refut);

// 04 · the Papers on view bar
await page.evaluate(() => document.querySelector('#matrixTable').parentElement.scrollTo(0, 0));
await shot('04-subgroup-bar.png', page.locator('#studyVisibilityBar'));

// 05 · Tab 4: Table 2b, the contribution grid with its legend
await page.evaluate(() => setActiveTab('pub'));
await settle(600);
await page.locator('[data-pub=table2_grid]').click();
await settle(600);
await shot('05-export.png');

// preview.png · 1200 x 630 card for links shared on social media / chat apps
const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const img = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, '03-matrix.png')).toString('base64');
await card.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; background: #eef2ff; }
  .head { position: absolute; left: 56px; top: 44px; right: 56px; }
  h1 { margin: 0; font-size: 50px; color: #1e1b4b; letter-spacing: -0.5px; }
  p { margin: 10px 0 0; font-size: 23px; color: #3730a3; }
  .shot { position: absolute; left: 56px; right: 56px; top: 190px; height: 470px; border-radius: 16px 16px 0 0; overflow: hidden;
          box-shadow: 0 20px 50px rgba(30, 27, 75, .25); border: 1px solid #c7d2fe; background: #fff; }
  .shot img { width: 100%; display: block; }
  .tag { position: absolute; right: 64px; bottom: 14px; font-size: 13px; color: #fff; background: rgba(30, 27, 75, .75); padding: 4px 10px; border-radius: 6px; }
</style></head><body>
  <div class="head"><h1>Meta-Ethnography Canvas</h1><p>A free, browser-based workspace for meta-ethnography · reporting structured around eMERGe</p></div>
  <div class="shot"><img src="${img}" alt=""></div>
  <div class="tag">Screen shows the AI-generated, fictional demo project</div>
</body></html>`);
await card.waitForTimeout(300);
await card.screenshot({ path: path.join(ROOT, 'site', 'preview.png') });
console.log('✔ preview.png');

await browser.close();
server.close();
