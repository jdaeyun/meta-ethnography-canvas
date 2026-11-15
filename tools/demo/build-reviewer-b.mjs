import { chromium, openApp, loadPdfs, selectStudy, fillMeta, extractPaper, downloadBackup, verifyHighlights } from './extract-lib.mjs';
import { DOCS, B_ITEMS } from './project-spec.mjs';
const [,, url, pdfDir, out] = process.argv;
const b = await chromium.launch();
const p = await openApp(b, url, 'Reviewer B', 'AI-DEMO-NIGHTSHIFT', '[AI-GENERATED DEMO] To synthesise qualitative evidence on nurses and managers on night shifts in hospitals.', 'How do nurses and nurse managers experience night shifts in hospitals?');
await loadPdfs(p, pdfDir, DOCS.map(d => d.file));
for (let i = 0; i < DOCS.length; i++) { await selectStudy(p, i); await fillMeta(p, DOCS[i]); }
for (let i = 0; i < DOCS.length; i++) await extractPaper(p, i, B_ITEMS[i]);
const bad = await verifyHighlights(p, DOCS.length);
if (bad.length) { console.log('MISPLACED HIGHLIGHTS:', JSON.stringify(bad)); process.exit(1); }
await downloadBackup(p, out);
console.log('B done; errors:', p.errs.length ? p.errs : 'none');
await b.close();
