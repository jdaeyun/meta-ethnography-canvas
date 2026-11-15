import { chromium, openApp, loadPdfs, selectStudy, fillMeta, extractPaper, downloadBackup } from './extract-lib.mjs';
import { DOCS, B_ITEMS } from './project-spec.mjs';
const [,, url, pdfDir, out] = process.argv;
const b = await chromium.launch();
const p = await openApp(b, url, 'Reviewer B', 'AI-DEMO-NIGHTSHIFT', '[AI-GENERATED DEMO] To synthesise qualitative evidence on nurses and managers on night shifts in hospitals.', 'How do nurses and nurse managers experience night shifts in hospitals?');
await loadPdfs(p, pdfDir, DOCS.map(d => d.file));
for (let i = 0; i < DOCS.length; i++) { await selectStudy(p, i); await fillMeta(p, DOCS[i]); }
for (let i = 0; i < DOCS.length; i++) await extractPaper(p, i, B_ITEMS[i]);
await downloadBackup(p, out);
console.log('B done; errors:', p.errs.length ? p.errs : 'none');
await b.close();
