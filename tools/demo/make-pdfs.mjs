// Builds the four AI-generated demo PDFs from papers.mjs.
// Needs Playwright (not a dependency of this repo): `npm i -D playwright` then `node tools/demo/make-pdfs.mjs <outDir>`.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { papers } from './papers.mjs';
import path from 'node:path';
const outDir = path.resolve(process.argv[2] || 'app/demo');
const css = (cols) => `
  @page { size: A4; margin: 22mm 18mm 20mm 18mm; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 10.5pt; line-height: 1.38; color: #111; }
  .banner { border: 1.5px solid #b91c1c; background: #fef2f2; color: #7f1d1d; padding: 5px 8px; font: bold 8.5pt Arial, sans-serif; margin-bottom: 10px; }
  .journal { font: 8.5pt Arial, sans-serif; color: #444; margin: 0 0 6px; }
  h1 { font-size: 17pt; line-height: 1.2; margin: 0 0 6px; }
  .authors { font-style: italic; margin: 0 0 10px; }
  .abstract { border-top: 1px solid #999; border-bottom: 1px solid #999; padding: 6px 0; margin-bottom: 10px; font-size: 9.5pt; }
  .body { column-count: ${cols}; column-gap: 8mm; }
  h2 { font: bold 11pt Arial, sans-serif; margin: 12px 0 4px; break-after: avoid; }
  h3 { font: bold 10pt Arial, sans-serif; margin: 10px 0 3px; break-after: avoid; }
  p { margin: 0 0 6px; text-align: left; }
  p.quote { margin-left: 10px; font-style: italic; }
`;
const html = (p) => {
  let body = '';
  for (const [h, paras] of p.sections) {
    if (h === 'Findings' || /^Theme/.test(h) === false) body += `<h2>${h}</h2>`; else body += `<h3>${h}</h3>`;
    for (const t of paras) body += `<p class="${t.startsWith('“') ? 'quote' : ''}">${t}</p>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${p.title} [AI-GENERATED FICTIONAL SAMPLE]</title><style>${css(p.columns)}</style></head><body>
  <div class="banner">AI-GENERATED FICTIONAL SAMPLE — written by an AI for software demonstration. The study, authors, participants and quotations do not exist. Do not cite.</div>
  <div class="journal">${p.journal}</div><h1>${p.title}</h1><div class="authors">${p.authors}</div>
  <div class="abstract"><b>Abstract.</b> ${p.abstract}</div><div class="body">${body}</div></body></html>`;
};
const hdr = `<div style="font:bold 7pt Arial;color:#b91c1c;width:100%;text-align:center;">AI-GENERATED FICTIONAL SAMPLE · not a real study · do not cite</div>`;
const ftr = `<div style="font:7pt Arial;color:#666;width:100%;text-align:center;">Meta-Ethnography Canvas demo · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;
const b = await chromium.launch(); const pg = await b.newPage();
for (const p of papers) {
  await pg.setContent(html(p));
  await pg.pdf({ path: path.join(outDir, p.file), format: 'A4', displayHeaderFooter: true, headerTemplate: hdr, footerTemplate: ftr, printBackground: true, margin: { top: '22mm', bottom: '20mm', left: '18mm', right: '18mm' } });
  console.log('wrote', p.file);
}
await b.close();
