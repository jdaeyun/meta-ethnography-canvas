// Unit tests of the pure logic in app/js/logic.js, in Node without a browser: `npm run test:unit` (also run by `npm test`).
// logic.js is a classic script (the app shares one global scope so that file:// works), so it is run in a fresh context here
// and its top-level names are read back from that context. Nothing else of the app is loaded: if logic.js starts to need the
// page or `state`, these tests fail at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/logic.js'), 'utf8'), ctx, { filename: 'app/js/logic.js' });
const L = vm.runInContext(`({ LOG_ACTION, appendixSeries, isMemoLog, isKeyDecisionLog, sanitizeProjectData, isEmptyValue, mergeFillEmpty,
  mergeFillTexts, MERGE_FILL_TEXT, stableJson, sameRecord, computeTextSimilarity, isDirectedLink, linkPairOffsets, flowColumnRanks,
  joinSeparator, joinTextItems, extractSurnameFromAuthorString, YEAR_RE, yearFromPdfDate })`, ctx);
// Objects made inside the context have that context's prototypes: compare them as plain JSON
const plain = v => JSON.parse(JSON.stringify(v));

test('similarity: identical, contained passages, short fragments, Japanese', () => {
  const S = L.computeTextSimilarity;
  assert.equal(S('Night work is lonely', 'night work is lonely!'), 1);
  assert.equal(S('', 'anything'), 0);
  const long = 'Nurses described night work as a place where they carried responsibility without the backing of senior staff on the ward';
  assert.ok(S(long.slice(0, 80), long) >= 0.78, 'a selection inside a longer one of the same passage pairs');
  assert.ok(S('moral distress', 'They spoke of moral distress when staffing was short and the ward was full of acutely ill patients') < 0.5,
    'a two-word fragment does not match every quote that contains both words');
  assert.ok(S('夜勤は孤独で、判断を一人で背負うことが多いと看護師は語った', '夜勤は孤独で、判断を一人で背負うことが多い') >= 0.78, 'Japanese: counted by characters');
  assert.ok(S('The family was present', 'Staff rotas changed every week') < 0.3);
});

test('merge: emptiness at every depth, union of records, nested answers, conflicts', () => {
  assert.ok(L.isEmptyValue({ CASP: {} }) && L.isEmptyValue([]) && L.isEmptyValue('') && !L.isEmptyValue(0) && !L.isEmptyValue({ a: 'x' }));
  const local = { note: '', links: [{ id: 'a' }], appraisalItems: { CASP: { q1: 'yes' } }, title: 'Mine' };
  const r = L.mergeFillEmpty(local, { note: 'theirs', links: [{ id: 'a' }, { id: 'b' }], appraisalItems: { CASP: { q1: 'no', q2: 'yes' } }, title: 'Theirs' });
  assert.equal(local.note, 'theirs', 'an empty field is filled');
  assert.deepEqual(plain(local.links).map(x => x.id), ['a', 'b'], 'record lists are joined, the local record kept');
  assert.deepEqual(plain(local.appraisalItems), { CASP: { q1: 'yes', q2: 'yes' } }, 'nested answers are filled question by question');
  assert.equal(local.title, 'Mine', 'local work is never overwritten');
  assert.deepEqual(plain(r.conflicts).sort(), ['appraisalItems.CASP.q1', 'title']);
  const keyOrder = { x: { a: 1, b: 2 } };
  assert.deepEqual(plain(L.mergeFillEmpty(keyOrder, { x: { b: 2, a: 1 } }).conflicts), [], 'the same content in another key order is no conflict');
  const polluted = JSON.parse('{"__proto__": {"bad": 1}, "note": "x"}');
  L.mergeFillEmpty({}, polluted);
  assert.equal(({}).bad, undefined);
  const t = { note: '', concordanceNote: 'kept' };
  assert.deepEqual(plain(L.mergeFillTexts(t, { note: 'filled', concordanceNote: 'other' }, L.MERGE_FILL_TEXT.annotations)), ['note']);
  assert.ok(L.sameRecord({ a: [1, { b: 2, c: 3 }] }, { a: [1, { c: 3, b: 2 }] }));
  assert.ok(L.sameRecord({ a: 1, gone: undefined }, { a: 1 }), 'a key whose value is undefined is not written to a file, so it is no difference');
  const lu = { links: [{ id: 'l1', from: 'a', to: 'b', type: 'leads', note: 'here' }] };
  const ru = L.mergeFillEmpty(lu, { links: [{ id: 'l1', from: 'a', to: 'b', type: 'leads', note: 'elsewhere' }, { id: 'l2', from: 'b', to: 'c', type: 'leads' }] });
  assert.deepEqual(plain(ru.conflicts), ['links'], 'the same relation with another note is a conflict');
  assert.equal(lu.links.length, 2);
  assert.equal(lu.links[0].note, 'here', 'the local relation stays');
});

test('project files are sanitised: prototype keys at every depth, records without an id', () => {
  const data = JSON.parse('{"docs":[{"id":"d1","x":{"__proto__":{"evil":1}}},{"name":"no id"},null],"annotations":[{"id":2,"constructor":{"prototype":{}}}],"loa":{"prototype":1}}');
  const out = L.sanitizeProjectData(data);
  assert.equal(out.docs.length, 1);
  assert.equal(out._droppedRecords, 2);
  assert.ok(!Object.prototype.hasOwnProperty.call(out.docs[0].x, '__proto__'));
  assert.ok(!Object.prototype.hasOwnProperty.call(out.annotations[0], 'constructor'));
  assert.ok(!Object.prototype.hasOwnProperty.call(out.loa, 'prototype'));
  const keys = L.sanitizeProjectData({ clusters: [{ id: '' }, { id: '  ' }, { id: NaN }, { id: Infinity }, { id: 0 }, { id: 'c1' }] });
  assert.deepEqual(plain(keys.clusters.map(c => c.id)), [0, 'c1'], 'an empty, blank or non-finite id is not a usable key');
  assert.equal(keys._droppedRecords, 4);
});

test('flow columns: a chain of ⇄ / ⚡ relations takes the column of the construct it hangs from', () => {
  const links = [{ id: '1', from: 'A', to: 'B', type: 'leads' }, { id: '2', from: 'B', to: 'C', type: 'mutual' }, { id: '3', from: 'C', to: 'D', type: 'contradicts' }];
  const { rank } = L.flowColumnRanks(['A', 'B', 'C', 'D'], links);
  assert.deepEqual(plain(rank), { A: 0, B: 1, C: 1, D: 1 });
});

test('Appendix A: key decisions, routine bookkeeping, edit series', () => {
  const K = L.isKeyDecisionLog;
  assert.ok(K({ action: 'Linked 1st Order Quote to …', rationale: 'because' }), 'a reason makes any entry a key decision');
  assert.ok(!K({ action: 'Linked 1st Order Quote to …', category: 'linking' }));
  assert.ok(K({ action: '[Memo] Thinking about night work' }) && L.isMemoLog({ action: '[Memo] x' }) && !L.isMemoLog({ action: '[Reviewer-wrapped] x' }));
  assert.ok(!K({ action: 'Judged construct as Reciprocal', category: 'x', fromVal: 'Not yet judged' }), 'a first judgement is shown in Tables 2 / 2b');
  assert.ok(K({ action: 'Judged construct as Refutational', category: 'x', fromVal: 'Reciprocal' }), 'a changed judgement is a decision');
  assert.ok(K({ action: 'Deleted a 2nd Order construct "x"', clusterIds: ['r1'] }) && !K({ action: 'Deleted a 2nd Order construct "x"', clusterIds: [] }));
  assert.ok(!K({ action: 'Updated Reading & extraction process / Units of synthesis' }), 'write-up wording is the Methods text itself');
  assert.ok(!K({ action: 'Undid: Added a further passage', category: 'reading_extraction' }));
  const a = L.appendixSeries({ action: L.LOG_ACTION.rowTitle, clusterIds: ['r1'] });
  const b = L.appendixSeries({ action: L.LOG_ACTION.rowTitle, clusterIds: ['r2'] });
  assert.equal(a.label, 'Row title refined');
  assert.notEqual(a.key, b.key, 'edits of different rows are separate series');
  assert.equal(L.appendixSeries({ action: 'Created a row' }), null);
});

test('map: direction, parallel relations, flow columns with cycles and undirected partners', () => {
  assert.ok(L.isDirectedLink('leads') && L.isDirectedLink('encompasses') && !L.isDirectedLink('mutual'));
  const off = L.linkPairOffsets([{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'a', to: 'b' }, { id: '3', from: 'b', to: 'c' }]);
  assert.equal(off['3'], 0, 'a single relation stays on the straight line');
  assert.equal(off['1'], -off['2'], 'two relations of one pair part to either side');
  const rev = L.linkPairOffsets([{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'b', to: 'a' }]);
  assert.notEqual(Math.sign(rev['1'] * 1), Math.sign(rev['2'] * -1), 'A→B and B→A also part');
  const { rank } = L.flowColumnRanks(['a', 'b', 'c', 'd', 'e'], [
    { id: '1', from: 'a', to: 'b', type: 'leads' }, { id: '2', from: 'b', to: 'c', type: 'encompasses' },
    { id: '3', from: 'c', to: 'a', type: 'leads' },   // a cycle: broken for the ranking only
    { id: '4', from: 'a', to: 'c', type: 'metaphor' }, // the longest chain sets the column
    { id: '5', from: 'd', to: 'b', type: 'mutual' }    // joined only by ⇄: sits in its partner's column
  ]);
  assert.deepEqual(plain(rank), { a: 0, b: 1, c: 2, d: 1, e: 0 });
});

test('PDF text and citations: CJK joins, author surnames, years', () => {
  assert.equal(L.joinTextItems(['夜勤は', '孤独だ', 'Night', 'work']), '夜勤は孤独だ Night work');
  assert.equal(L.joinSeparator('word', 'next'), ' ');
  const S = s => plain(L.extractSurnameFromAuthorString(s));
  assert.deepEqual(S('Hernandez, Maria; Lee, J'), { surname: 'Hernandez', hasEtAl: true });
  assert.deepEqual(S('Hamdan A'), { surname: 'Hamdan', hasEtAl: false });
  assert.deepEqual(S('Anna Smith PhD'), { surname: 'Smith', hasEtAl: false });
  assert.deepEqual(S('山田 太郎、佐藤 花子'), { surname: '山田', hasEtAl: true });
  assert.deepEqual(S(''), { surname: '', hasEtAl: true });
  const year = s => (String(s).match(L.YEAR_RE) || [])[1] || '';
  assert.equal(L.yearFromPdfDate('D:19680301120000'), '1968', 'PDF Info dates (more digits after the year); classic studies of the 1960s');
  assert.equal(L.yearFromPdfDate('2021-03-01T10:00:00Z'), '2021');
  assert.equal(L.yearFromPdfDate('D:18990101'), '');
  assert.equal(year('Smith_2021_nursing.pdf'), '2021');
  assert.equal(year('ID 12019 and 1939'), '', 'no year inside a longer number, none before 1940');
});
