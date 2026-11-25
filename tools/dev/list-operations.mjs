// Lists every place in app/js that changes project data, grouped by the handler or function that does it.
// Reads the code only (TypeScript parser, no browser). Writes docs/operations-inventory.md (generated: do not edit by hand).
//   node tools/dev/list-operations.mjs            write the file
//   node tools/dev/list-operations.mjs --check    exit 1 when the file is out of date (nothing written)
// A "unit" is the innermost event handler (onclick / addEventListener / bindTextField commit …) around a call, or else the
// innermost named function. A unit is listed when it writes (dbPut / dbDelete / dbBatch / dbClear / commitOps), logs
// (recordAuditLog) or records an Undo step (beginChange / pushUndoAction). For each it shows what it writes, what it logs,
// how Ctrl+Z covers it, and the signs of the rules that are easy to forget (docs/ARCHITECTURE.md, "Known gaps").
// The flags are heuristics read from the code's shape: they point at places to look at, they do not prove a bug.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outFile = path.join(root, 'docs/operations-inventory.md');
// In load order (me_canvas.html); logic.js is pure and writes nothing
const FILES = ['core.js', 'app.js', 'undo-audit.js', 'loa.js', 'studies-pdf.js', 'extraction.js', 'matrix.js', 'audit-view.js', 'compare.js', 'export.js', 'backup.js', 'demo.js'];

const WRITE_FNS = new Set(['dbPut', 'dbDelete', 'dbBatch', 'dbClear', 'commitOps']);
const TRACKED = new Set([...WRITE_FNS, 'recordAuditLog', 'beginChange', 'finishChange', 'pushUndoAction', 'flushAllPendingSaves']);
// The helpers themselves (their own bodies are not operations)
const HELPERS = new Set([...TRACKED, 'trackSave', 'bindTextField', 'bindPendingCommit', 'logExtractedTextEdit', 'performUndoStep', 'dbGetAll']);
const EVENT_PROP = /^on[a-z]+$/;
const BIND_FNS = new Set(['bindTextField', 'bindPendingCommit']);

const callName = n => ts.isIdentifier(n.expression) ? n.expression.text
  : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : '';
const short = (s, n = 70) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const strOf = (sf, n) => {
  if (!n) return '';
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map(s => '…' + s.literal.text).join('');
  return n.getText(sf);
};
const propOf = (obj, name) => {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return null;
  const p = obj.properties.find(q => q.name && q.name.getText() === name);
  return p && ts.isPropertyAssignment(p) ? p.initializer : p ? p.name : null;
};
function namedFunction(fn) {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name.getText();
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}
// The trigger a function node is, or null: '<target>.onclick', '<target> on change', 'bindTextField(<el>).commit' …
function handlerLabel(sf, fn) {
  const p = fn.parent;
  if (!p) return null;
  if (ts.isBinaryExpression(p) && p.right === fn && ts.isPropertyAccessExpression(p.left) && EVENT_PROP.test(p.left.name.text)) {
    return `${short(p.left.expression.getText(sf), 48)}.${p.left.name.text}`;
  }
  if (ts.isCallExpression(p) && callName(p) === 'addEventListener' && p.arguments[1] === fn) {
    const target = ts.isPropertyAccessExpression(p.expression) ? short(p.expression.expression.getText(sf), 48) : '';
    return `${target} on '${strOf(sf, p.arguments[0])}'`;
  }
  if (ts.isCallExpression(p) && BIND_FNS.has(callName(p)) && p.arguments.includes(fn)) return `${callName(p)}(${short(p.arguments[0].getText(sf), 40)})`;
  if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent) && ts.isCallExpression(p.parent.parent) && BIND_FNS.has(callName(p.parent.parent))) {
    return `${callName(p.parent.parent)}(${short(p.parent.parent.arguments[0].getText(sf), 40)}).${p.name.getText(sf)}`;
  }
  return null;
}
// The unit a node belongs to: innermost handler, else innermost named function, else the file's top level
function ownerOf(sf, node) {
  let f = node.parent;
  while (f) {
    if (ts.isFunctionLike(f)) {
      const h = handlerLabel(sf, f);
      if (h) return { node: f, trigger: h };
      if (namedFunction(f)) return { node: f, trigger: null };
    }
    f = f.parent;
  }
  return { node: null, trigger: null };
}
function enclosingNamed(node) {
  let f = node && node.parent;
  while (f) { if (ts.isFunctionLike(f) && namedFunction(f)) return namedFunction(f); f = f.parent; }
  return null;
}

/** @type {Map<string, any>} */
const units = new Map();
const draftSavers = new Set(); // named functions passed to bindTextField as save: (draft saves)
const topFns = new Map(); // top-level function name -> file

for (const file of FILES) {
  const src = fs.readFileSync(path.join(root, 'app/js', file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  sf.statements.forEach(s => { if (ts.isFunctionDeclaration(s) && s.name) topFns.set(s.name.text, file); });
  const unit = node => {
    const o = ownerOf(sf, node);
    const key = file + ':' + (o.node ? o.node.getStart(sf) : 'top');
    if (!units.has(key)) {
      const own = o.node && !o.trigger ? namedFunction(o.node) : null;
      units.set(key, {
        file, key,
        line: sf.getLineAndCharacterOfPosition((o.node || node).getStart(sf)).line + 1,
        name: own || (o.node ? enclosingNamed(o.node) : null) || '(top level)',
        own, trigger: o.trigger, writes: new Map(), logs: [], undo: [], flush: false,
        putVars: new Set(), assigned: new Set(), stateMut: new Set(), calls: new Set(), awaitsPut: false
      });
    }
    return units.get(key);
  };
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const name = callName(node);
      if (TRACKED.has(name) && ts.isIdentifier(node.expression)) {
        const owner = enclosingNamed(node);
        if (!((file === 'core.js' || file === 'undo-audit.js') && HELPERS.has(owner))) {
          const u = unit(node);
          const a0 = node.arguments[0];
          if (WRITE_FNS.has(name)) {
            const what = name === 'commitOps' || name === 'dbBatch' ? name : `${name}(${strOf(sf, a0)})`;
            u.writes.set(what, (u.writes.get(what) || 0) + 1);
            if (name === 'dbPut' && node.arguments[1] && ts.isIdentifier(node.arguments[1])) u.putVars.add(node.arguments[1].text);
            if (name === 'dbPut' || name === 'dbDelete') u.awaitsPut = true;
          } else if (name === 'recordAuditLog') {
            const kind = propOf(a0, 'kind'), cat = propOf(a0, 'category'), act = propOf(a0, 'action');
            u.logs.push({
              kind: kind ? strOf(sf, kind) : '', category: cat ? strOf(sf, cat) : '',
              action: act ? short(strOf(sf, act), 64) : '', rows: !!propOf(a0, 'clusterIds')
            });
          } else if (name === 'beginChange') u.undo.push('change');
          else if (name === 'pushUndoAction') { const t = propOf(a0, 'type'); u.undo.push(t ? strOf(sf, t) : 'own'); }
          else if (name === 'flushAllPendingSaves') u.flush = true;
        }
      } else if (name === 'logExtractedTextEdit' && ts.isIdentifier(node.expression)) {
        unit(node).logs.push({ kind: 'extract_edit', category: 'reading_extraction', action: '(logExtractedTextEdit: corrected extracted text)', rows: false });
      } else if (ts.isIdentifier(node.expression)) {
        const o = ownerOf(sf, node);
        const key = file + ':' + (o.node ? o.node.getStart(sf) : 'top');
        (pending[key] = pending[key] || []).push(node.expression.text);
      }
      if (ts.isPropertyAccessExpression(node.expression) && ['push', 'splice', 'unshift', 'sort', 'pop', 'shift'].includes(node.expression.name.text)) {
        const t = node.expression.expression.getText(sf);
        if (/^state\.(docs|annotations|clusters|logs)$/.test(t)) {
          const o = ownerOf(sf, node); const key = file + ':' + (o.node ? o.node.getStart(sf) : 'top');
          (pendingMut[key] = pendingMut[key] || []).push(`${t.slice(6)}.${node.expression.name.text}()`);
        }
      }
    }
    if (ts.isCallExpression(node) && callName(node) === 'bindTextField') {
      const sv = propOf(node.arguments[1], 'save');
      if (sv && ts.isIdentifier(sv)) draftSavers.add(sv.text);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const t = node.left.getText(sf);
      const o = ownerOf(sf, node); const key = file + ':' + (o.node ? o.node.getStart(sf) : 'top');
      if (/^state\.(docs|annotations|clusters|logs|loa)\b/.test(t)) (pendingMut[key] = pendingMut[key] || []).push(short(t.slice(6), 32) + ' =');
      else if (/^[A-Za-z_$][\w$]*[.[]/.test(t)) (pendingAssign[key] = pendingAssign[key] || []).push(t.split(/[.[]/)[0]);
    }
    if (ts.isDeleteExpression(node)) {
      const t = node.expression.getText(sf);
      const o = ownerOf(sf, node); const key = file + ':' + (o.node ? o.node.getStart(sf) : 'top');
      (pendingAssign[key] = pendingAssign[key] || []).push(t.split(/[.[]/)[0]);
    }
    ts.forEachChild(node, visit);
  };
  const pending = {}, pendingMut = {}, pendingAssign = {};
  visit(sf);
  for (const [key, u] of units) {
    if (u.file !== file) continue;
    (pending[key] || []).forEach(n => u.calls.add(n));
    (pendingMut[key] || []).forEach(m => u.stateMut.add(m));
    (pendingAssign[key] || []).forEach(v => { if (u.putVars.has(v)) u.assigned.add(v); });
  }
}

// Calls from a unit into named functions that are units themselves (an operation that does its work in a helper)
// (top-level functions by name; local helpers such as `const logChange = async () => …` by file and name)
const byName = new Map();
for (const u of units.values()) if (u.own && topFns.get(u.own) === u.file) byName.set(u.own, u);
for (const u of units.values()) if (u.own && !byName.has(u.own)) byName.set(u.file + '|' + u.own, u);
const resolve = (u, n) => byName.get(n) || byName.get(u.file + '|' + n);
const list = [...units.values()].filter(u => u.writes.size || u.logs.length || u.undo.length);
list.forEach(u => {
  u.via = [...u.calls].filter(n => { const v = n !== u.own && resolve(u, n); return v && v !== u && (v.writes.size || v.logs.length || v.undo.length); });
});
// What reaches a write through the units it calls (one level is enough for the flags below)
const reaches = (u, test, seen = new Set()) => {
  if (seen.has(u.key)) return false;
  seen.add(u.key);
  if (test(u)) return true;
  return u.via.some(n => reaches(resolve(u, n), test, seen));
};

// ---- Flags (see docs/ARCHITECTURE.md, "Known gaps") ----
const flagsOf = u => {
  const f = [];
  const writes = u.writes.size > 0, logs = u.logs.length > 0;
  const directPut = [...u.writes.keys()].some(k => /^db(Put|Delete)\((annotations|clusters|docs|meta)/.test(k));
  if (directPut && logs) f.push('split-write'); // record and its audit entry in two transactions
  if (u.assigned.size && directPut) f.push('mutate-first');  // the record is changed in memory, then written
  // A bindTextField draft save is logged by the same field's commit (its own unit), and is not flagged
  const draft = /^bindTextField\(.*\)\.save$/.test(u.trigger || '') || draftSavers.has(u.own);
  if (writes && !logs && !draft && !reaches(u, x => x.logs.length > 0) && !/backup|restore|seed|demo|fingerprint|pdf|binary|reset/i.test(u.name + ' ' + (u.trigger || '')) && [...u.writes.keys()].some(k => !/logs|pdf_binaries/.test(k))) f.push('no-log');
  if (u.logs.some(l => !l.kind)) f.push('no-kind');
  return f;
};

// ---- Markdown ----
const esc = s => String(s).replace(/\|/g, '\\|').replace(/`/g, "'");
const lines = [];
lines.push('# Operations inventory (generated)');
lines.push('');
lines.push('Generated by `node tools/dev/list-operations.mjs` from the code in `app/js/`. Do not edit by hand: re-run it after a change');
lines.push('(`--check` reports whether this file is out of date). What each column means and how to read the flags: `docs/ARCHITECTURE.md`,');
lines.push('section "Operations inventory".');
lines.push('');
const total = list.length;
const flagCount = {};
list.forEach(u => flagsOf(u).forEach(f => { flagCount[f] = (flagCount[f] || 0) + 1; }));
const undoCount = list.filter(u => u.undo.length || u.via.some(n => resolve(u, n).undo.length)).length;
lines.push(`**${total} units** that write, log or record an Undo step; ${undoCount} of them record an Undo step (themselves or through a function they call).`);
lines.push('');
lines.push('| Flag | Units | Meaning |');
lines.push('|---|---|---|');
const FLAG_TEXT = {
  'split-write': 'writes a record with `dbPut` / `dbDelete` and its audit entry with `recordAuditLog`: two transactions, so one can be saved without the other',
  'mutate-first': 'changes the record it then `dbPut`s in memory first (if the write is refused, memory and database differ)',
  'no-log': 'writes project data and logs nothing, here or in a unit it calls (a draft save of `bindTextField`, logged by its commit, is not flagged): check whether the change is interpretive',
  'no-kind': 'an audit entry without `kind` (Appendix A falls back to the action text)',
};
Object.keys(FLAG_TEXT).forEach(k => lines.push(`| \`${k}\` | ${flagCount[k] || 0} | ${FLAG_TEXT[k]} |`));
lines.push('');
for (const file of FILES) {
  const us = list.filter(u => u.file === file).sort((a, b) => a.line - b.line);
  if (!us.length) continue;
  lines.push(`## app/js/${file} (${us.length})`);
  lines.push('');
  lines.push('| Line | In | Trigger | Writes | Audit entries (kind · category · action) | Undo | Calls | Flags |');
  lines.push('|---|---|---|---|---|---|---|---|');
  us.forEach(u => {
    const writes = [...u.writes].map(([k, n]) => n > 1 ? `${k}×${n}` : k).join(', ');
    const logs = u.logs.map(l => `${l.kind ? '`' + l.kind + '`' : '—'} · ${l.category || '—'} · ${esc(l.action)}${l.rows ? ' [rows]' : ''}`).join('<br>');
    const viaUndo = u.undo.length ? [] : u.via.filter(n => resolve(u, n).undo.length);
    const undo = u.undo.length ? [...new Set(u.undo)].join(', ') : viaUndo.length ? `change (via ${viaUndo.join(', ')})` : '';
    const via = u.via.join(', ');
    lines.push(`| ${u.line} | \`${u.name}\` | ${u.trigger ? '`' + esc(u.trigger) + '`' : ''} | ${esc(writes)} | ${logs} | ${esc(undo)} | ${esc(via)} | ${flagsOf(u).map(f => '`' + f + '`').join(' ')} |`);
  });
  lines.push('');
}
const out = lines.join('\n') + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (cur !== out) { console.error('docs/operations-inventory.md is out of date: run node tools/dev/list-operations.mjs'); process.exit(1); }
  console.log('docs/operations-inventory.md is up to date');
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
  console.log(`wrote ${path.relative(root, outFile)}: ${total} units`, flagCount);
}
