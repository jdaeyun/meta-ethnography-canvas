// Builds the merged demo project: Reviewer A extracts, merges Reviewer B's file (Compare), then does the synthesis.
import { chromium, openApp, loadPdfs, selectStudy, fillMeta, extractPaper, downloadBackup, verifyHighlights } from './extract-lib.mjs';
import { DOCS, ITEMS } from './project-spec.mjs';
import { ROWS, LOA, MEMOS } from './synthesis-spec.mjs';
const [,, url, pdfDir, peerJson, out, shotDir] = process.argv;
const b = await chromium.launch();
const p = await openApp(b, url, 'Reviewer A', 'AI-DEMO-NIGHTSHIFT',
  '[AI-GENERATED DEMO] To synthesise qualitative evidence on how nurses and nurse managers experience night shifts in hospitals.',
  'How do nurses and nurse managers experience night shifts in hospitals, and how do their accounts differ?');
await p.evaluate(() => { const t = document.getElementById('autoSeedIndexToggle'); if (t && t.checked) t.click(); });
await loadPdfs(p, pdfDir, DOCS.map(d => d.file));
for (let i = 0; i < DOCS.length; i++) { await selectStudy(p, i); await fillMeta(p, DOCS[i]); }
for (let i = 0; i < DOCS.length; i++) await extractPaper(p, i, ITEMS[i]);

// ---- Compare & merge Reviewer B ----
await p.click('#compareJsonModalBtn'); await p.waitForTimeout(500);
await p.setInputFiles('#peerJsonFileInput', peerJson); await p.waitForTimeout(1500);
if (shotDir) await p.screenshot({ path: shotDir + '/cmp1.png' });
// Divergent: agree and merge note (confirm dialogs are accepted)
await p.getByRole('button', { name: /Mark Agreed & Merge Note/ }).first().click(); await p.waitForTimeout(700);
// Unique extractions: import as agreed, except one item to discuss
await p.getByText('Unique Extractions').first().click(); await p.waitForTimeout(500);
while (await p.locator('#compareTabContent .imp-agree').count() > 0) {
  const btn = p.locator('#compareTabContent .imp-agree').first();
  const card = btn.locator('xpath=ancestor::div[contains(@class,"p-4")][1]');
  const txt = await card.innerText();
  if (/Exhaustion is part of nursing/.test(txt)) await card.locator('.imp-discuss').click(); else await btn.click();
  await p.waitForTimeout(500);
}
// (Reviewer B's audit trail is merged automatically when the first construct is adopted.)
if (shotDir) await p.screenshot({ path: shotDir + '/cmp2.png' });
await p.click('#closeCompareModalBtn'); await p.waitForTimeout(400);
console.log('annotations after merge:', await p.evaluate(() => state.annotations.length));

// ---- Synthesis matrix ----
await p.click('#viewMatrixBtn'); await p.waitForTimeout(600);
await p.evaluate(() => { const t = document.getElementById('autoSeedIndexToggle'); if (t.checked) t.click(); });
const find = (label) => p.evaluate((l) => { const a = state.annotations.filter(x => x.type === 'second_order' && x.note === l); return a.length ? a[0].id : null; }, label);
for (const row of ROWS) {
  await p.evaluate(async (t) => { await createNewClusterRow(t); }, row.title);
  await p.waitForTimeout(300);
  const cid = await p.evaluate((t) => state.clusters.find(c => c.thirdOrderTitle === t || c.order === undefined || true) && state.clusters[state.clusters.length - 1].id, row.title);
  row.cid = cid;
  for (const m of row.members) {
    const sid = await find(m);
    if (!sid) throw new Error('2nd order not found: ' + m);
    await p.evaluate(async ({ sid, cid }) => { const s = state.annotations.find(a => a.id === sid); const c = state.clusters.find(x => x.id === cid); await assignSecondOrderToCluster(s, c); }, { sid, cid });
  }
  await p.evaluate(() => renderMatrixView()); await p.waitForTimeout(500);
  const idx = await p.evaluate((cid) => state.clusters.findIndex(c => c.id === cid), row.cid);
  const tr = p.locator('tr:has(.cluster-title)').nth(idx);
  await tr.locator('.cluster-title').fill(row.title); await tr.locator('.cluster-title').blur();
  // (row type is derived from the per-cell relations set below; there is no per-row selector any more)
  await tr.locator('.cluster-trans').fill(row.stepA); await tr.locator('.cluster-trans').blur();
  await tr.locator('.cluster-note').fill(row.stepB); await tr.locator('.cluster-note').blur();
  await p.waitForTimeout(400);
  // cell-level relation + comments
  for (const [label, text] of Object.entries(row.refutational || {})) {
    const sid = await find(label);
    const card = tr.locator(`[data-sec-id="${sid}"], [data-id="${sid}"]`).first();
    await p.evaluate(async ({ sid, cid, text }) => { const s = state.annotations.find(a => a.id === sid); s.clusterRelations[cid] = 'refutational'; s.clusterComments[cid] = text; await dbPut('annotations', s); }, { sid, cid, text });
  }
  for (const [label, text] of Object.entries(row.comments || {})) {
    const sid = await find(label);
    await p.evaluate(async ({ sid, cid, text }) => { const s = state.annotations.find(a => a.id === sid); s.clusterComments[cid] = text; await dbPut('annotations', s); }, { sid, cid, text });
  }
  await p.evaluate(() => renderMatrixView()); await p.waitForTimeout(500);
  // CERQual (UI)
  const tr2 = p.locator('tr:has(.cluster-title)').nth(idx);
  await tr2.locator('.cl-subtab-btn[data-subtab="cerqual"]').click(); await p.waitForTimeout(300);
  const cq = row.cerqual;
  await tr2.locator('.cq-lim').selectOption(cq.lim); await tr2.locator('.cq-coh').selectOption(cq.coh);
  await tr2.locator('.cq-adeq').selectOption(cq.adeq); await tr2.locator('.cq-rel').selectOption(cq.rel);
  await tr2.locator('.cq-lim-note').fill(cq.notes.lim); await tr2.locator('.cq-coh-note').fill(cq.notes.coh);
  await tr2.locator('.cq-adeq-note').fill(cq.notes.adeq); await tr2.locator('.cq-rel-note').fill(cq.notes.rel);
  await tr2.locator('.cq-conf').selectOption(cq.conf); await tr2.locator('.cq-exp').fill(cq.explanation); await tr2.locator('.cq-exp').blur();
  await p.waitForTimeout(500);
  await tr2.locator('.cl-subtab-btn[data-subtab="synthesis"]').click(); await p.waitForTimeout(200);
}
// ---- Line of Argument drawer ----
await p.click('#toggleLoaDrawerBtn'); await p.waitForTimeout(500);
await p.fill('#loaTitleInput', LOA.title); await p.fill('#loaFlowInput', LOA.flow); await p.fill('#loaNarrativeInput', LOA.narrative);
await p.fill('#loaRelateOutcomeInput', LOA.relateOutcome); await p.fill('#loaAltInterpInput', LOA.altInterp);
await p.fill('#loaModelContextInput', LOA.modelContext); await p.fill('#loaTeamMergeInput', LOA.teamMerge);
const linkSel = async (id, title) => p.evaluate(({ id, title }) => { const s = document.getElementById(id); const o = [...s.options].find(o => o.textContent.includes(title)); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }, { id, title });
for (const [from, to, type] of [[2, 0, 'leads'], [2, 1, 'leads'], [0, 1, 'mutual']]) {
  await linkSel('loaLinkFrom', ROWS[from].title); await linkSel('loaLinkTo', ROWS[to].title);
  await p.selectOption('#loaLinkType', type); await p.click('#loaLinkAddBtn'); await p.waitForTimeout(300);
}
await p.click('#saveLoaBtn'); await p.waitForTimeout(600);
await p.click('#toggleLoaDrawerBtn'); await p.waitForTimeout(300);
// ---- Write-up fields beside the Methods Summary (Tab 4): each is saved and logged when it is left ----
await p.click('#viewPubBtn'); await p.waitForTimeout(500);
await p.fill('#loaRelateProcessInput', LOA.relateProcess); await p.fill('#loaTransDefInput', LOA.transDef); await p.fill('#loaTransProcInput', LOA.transProc);
await p.locator('#loaTransProcInput').blur(); await p.waitForTimeout(500);
await p.click('#viewMatrixBtn'); await p.waitForTimeout(500);

// ---- Memos (Tab 3) ----
await p.click('#viewAuditBtn'); await p.waitForTimeout(500);
for (const m of MEMOS) {
  await p.selectOption('#memoSubType', m.type);
  if (m.ref) await p.evaluate((t) => { const s = document.getElementById('memoTargetRef'); const o = [...s.options].find(o => o.textContent.includes(t)); if (o) s.value = o.value; }, m.ref);
  await p.fill('#memoContentInput', m.text); await p.click('#addMemoBtn'); await p.waitForTimeout(400);
}
await p.click('#viewExtractBtn'); await p.waitForTimeout(300);
const bad = await verifyHighlights(p, DOCS.length);
if (bad.length) { console.log('MISPLACED HIGHLIGHTS:', JSON.stringify(bad)); process.exit(1); }
await downloadBackup(p, out);
console.log('A done; errors:', p.errs.length ? p.errs : 'none');
await b.close();
