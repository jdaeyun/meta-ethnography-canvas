// Shared Playwright helpers that drive the real app to build the demo project (used by build-demo-project.mjs).
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
export { chromium };
export async function openApp(browser, url, reviewer, projectCode, aim, question) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(url); await p.waitForTimeout(800);
  await p.fill('#initialReviewerInput', reviewer); await p.fill('#initialProjectCodeInput', projectCode);
  await p.fill('#initialPhase1AimInput', aim); await p.fill('#initialReviewQuestionInput', question);
  await p.click('#confirmReviewerLoginBtn'); await p.waitForTimeout(400);
  return p;
}
export async function loadPdfs(p, dir, files) {
  await p.setInputFiles('#pdfFileInput', files.map(f => path.join(dir, f))); await p.waitForTimeout(3500);
}
export async function selectStudy(p, i) { await p.locator('#studyList > *').nth(i).click(); await p.waitForTimeout(900); }
export async function fillMeta(p, d) {
  await p.getByText('Edit Study Info').first().click(); await p.waitForTimeout(250);
  await p.fill('#metaAuthor', d.author); await p.fill('#metaYear', d.year); await p.fill('#metaTitle', d.title);
  await p.fill('#metaSetting', d.setting); await p.fill('#metaParticipants', d.participants); await p.fill('#metaGroup', d.group);
  await p.fill('#metaMethodology', d.methodology);
  await p.selectOption('#metaQuality', d.quality); await p.selectOption('#metaRichness', d.richness);
  await p.click('#saveMetaBtn'); await p.waitForTimeout(350);
}
// Select a passage in the PDF text layer (start..end text), then tag it with the popup button.
export async function tagPassage(p, start, end, btnId) {
  const ok = await p.evaluate(({ start, end }) => {
    const layers = [...document.querySelectorAll('#pdfPagesWrapper .textLayer')];
    const norm = s => s.replace(/\s+/g, ' ');
    for (const layer of layers) {
      const spans = [...layer.querySelectorAll('span')].filter(s => s.firstChild && s.firstChild.nodeType === 3);
      let text = ''; const map = [];
      spans.forEach((sp, si) => {
        const t = sp.firstChild.data;
        for (let k = 0; k < t.length; k++) { const c = /\s/.test(t[k]) ? ' ' : t[k]; if (c === ' ' && text.endsWith(' ')) continue; text += c; map.push([si, k]); }
        if (!text.endsWith(' ')) { text += ' '; map.push([si, -1]); }
      });
      const a = text.indexOf(norm(start)); if (a < 0) continue;
      const b = text.indexOf(norm(end), a); if (b < 0) continue;
      const e = b + norm(end).length - 1;
      const [s1, o1] = map[a]; const [s2, o2] = map[e];
      const r = document.createRange();
      r.setStart(spans[s1].firstChild, Math.max(0, o1)); r.setEnd(spans[s2].firstChild, o2 + 1);
      // Scroll the PDF viewer itself (scrollIntoView can also move outer containers and shift the measured rectangles)
      const vc = document.getElementById('pdfViewerContainer');
      vc.scrollTop += spans[s1].getBoundingClientRect().top - vc.getBoundingClientRect().top - vc.clientHeight / 2;
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      return true;
    }
    return false;
  }, { start, end });
  if (!ok) throw new Error('Passage not found: ' + start);
  await p.waitForTimeout(250);
  await p.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 })));
  await p.waitForTimeout(250);
  await p.click(btnId); await p.waitForTimeout(450);
}
export async function lastAnnoId(p, type) { return p.evaluate(t => { const a = state.annotations.filter(x => x.type === t); return a[a.length - 1].id; }, type); }
export async function extractPaper(p, docIdx, items) {
  await selectStudy(p, docIdx);
  const ids = {};
  for (const s of items.s) {
    await tagPassage(p, s.start, s.end, '#tagSecondOrderBtn');
    ids[s.id] = await lastAnnoId(p, 'second_order');
    await p.locator(`[data-sidebar-anno="${ids[s.id]}"] .sec-note-input`).fill(s.label); await p.waitForTimeout(500);
  }
  for (const q of items.q) {
    await tagPassage(p, q.start, q.end, '#tagFirstOrderBtn');
    const fid = await lastAnnoId(p, 'first_order');
    await p.locator(`[data-sidebar-anno="${fid}"] .f-note-input`).fill(q.who); await p.waitForTimeout(300);
    await p.locator(`[data-sidebar-anno="${fid}"] .quick-link-sec-sel`).selectOption(ids[q.s]); await p.waitForTimeout(450);
  }
  return ids;
}
export async function downloadBackup(p, outPath) {
  const dl = p.waitForEvent('download'); await p.click('#backupJsonBtn'); const d = await dl; await d.saveAs(outPath);
}

// Guard: every stored highlight must sit on the text it belongs to (stored top vs. text-layer span, page 1 only).
export async function verifyHighlights(p, nDocs) {
  const bad = [];
  for (let i = 0; i < nDocs; i++) {
    await selectStudy(p, i); await p.waitForTimeout(600);
    const res = await p.evaluate(() => {
      const pc = document.querySelector('#pdfPagesWrapper .page-container'); const pr = pc.getBoundingClientRect();
      const spans = [...pc.querySelectorAll('.textLayer span')];
      const out = [];
      for (const a of state.annotations.filter(x => x.docId === state.activeDocId)) {
        const m = (a.rectsMap || {})['1']; if (!m || !m.length) continue;
        const stored = Math.min(...m.map(r => r.top)) * pr.height;
        // spans whose whole text is part of the annotation; the first line may start mid-span, so allow one line of slack
        const inside = spans.filter(sp => { const t = sp.textContent.trim(); return t.length >= 15 && a.text.includes(t); });
        let exp;
        if (inside.length) exp = Math.min(...inside.map(sp => sp.getBoundingClientRect().top - pr.top));
        else { // short passage: use spans that contain its first words (any of them must be close to the stored position)
          const near = spans.filter(sp => sp.textContent.includes(a.text.slice(0, 12))).map(sp => sp.getBoundingClientRect().top - pr.top);
          if (!near.length) { out.push([a.text.slice(0, 30), 'no matching text']); continue; }
          exp = near.reduce((best, t) => Math.abs(t - stored) < Math.abs(best - stored) ? t : best, near[0]);
        }
        if (stored > exp + 6 || stored < exp - 25) out.push([a.text.slice(0, 30), 'stored ' + stored.toFixed(0) + ' vs text ' + exp.toFixed(0)]);
      }
      return out;
    });
    bad.push(...res);
  }
  return bad;
}
