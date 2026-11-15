// Copies the release info from app/version.js (the ONE place to edit) into the files that show it as plain text:
//   CITATION.cff (version, date-released), README.md (headline, APA and BibTeX citation),
//   site/*.html and me_canvas.html (the fallback text inside <span data-mec="version"> / <span data-mec="year">).
// The pages also fill these spans at run time from app/version.js; the fallback only shows when that file cannot load.
// Usage: node tools/sync-version.mjs          update the files
//        node tools/sync-version.mjs --check  only report (exit 1 if something is out of date)
import fs from 'node:fs'; import vm from 'node:vm';
const check = process.argv.includes('--check');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('app/version.js', 'utf8'), ctx);
const { version, released } = ctx.window.ME_CANVAS || {};
if (!version || !/^\d{4}-\d{2}-\d{2}$/.test(released || '')) { console.error('app/version.js needs version and released (YYYY-MM-DD).'); process.exit(2); }
const year = released.slice(0, 4);
const V = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?'; // 1.3.2 or 1.3.2-beta.1
const rules = {
  'CITATION.cff': [
    [new RegExp('^version: "' + V + '"', 'm'), `version: "${version}"`],
    [/^date-released: "[\d-]+"/m, `date-released: "${released}"`]],
  'README.md': [
    [new RegExp('\\*\\*Version ' + V + '\\*\\*'), `**Version ${version}**`],
    [new RegExp('\\(Version ' + V + '\\)'), `(Version ${version})`],
    [new RegExp('(version\\s*=\\s*\\{)' + V + '(\\})'), `$1${version}$2`]]
};
const spanRules = [
  [new RegExp('(<span data-mec="version">)' + V + '(</span>)', 'g'), `$1${version}$2`],
  [/(<span data-mec="year">)\d{4}(<\/span>)/g, `$1${year}$2`]];
for (const f of ['me_canvas.html', 'site/index.html', 'site/manual.html', 'site/meta-ethnography-101.html']) rules[f] = spanRules;
let stale = 0;
for (const [file, list] of Object.entries(rules)) {
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, 'utf8'); const before = text;
  for (const [re, rep] of list) text = text.replace(re, rep);
  if (text !== before) { stale++; console.log((check ? 'out of date: ' : 'updated: ') + file); if (!check) fs.writeFileSync(file, text); }
}
console.log(stale ? (check ? `${stale} file(s) out of date.` : `${stale} file(s) updated to ${version} (${released}).`) : `All files already show ${version} (${released}).`);
process.exit(check && stale ? 1 : 0);
