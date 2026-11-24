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
const L = vm.runInContext(`({ LOG_KINDS, LOG_ACTION, appendixSeries, isMemoLog, isKeyDecisionLog, sanitizeProjectData, isEmptyValue, mergeFillEmpty,
  mergeFillTexts, MERGE_FILL_TEXT, stableJson, sameRecord, computeTextSimilarity, isDirectedLink, linkPairOffsets, flowColumnRanks,
  joinSeparator, joinTextItems, extractSurnameFromAuthorString, YEAR_RE, yearFromPdfDate, remapRowDocIds, checkInvariants,
  remapDocIds, remapDocRecord, purgeDocRefs, dropGoneDocRefs, purgeClusterRefs, moveRowLinks, liveRowLinks, takeOutOfRow, putIntoRow, rowFieldsOf })`, ctx);
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
  const lv = { links: [{ id: 'mine', from: 'a', to: 'b', type: 'leads' }, { id: 'm2', from: 'a', to: 'b', type: 'mutual' }] };
  L.mergeFillEmpty(lv, { links: [{ id: 'theirs', from: 'a', to: 'b', type: 'leads' }, { id: 't2', from: 'b', to: 'a', type: 'mutual' }, { id: 't3', from: 'b', to: 'a', type: 'leads' }] });
  assert.deepEqual(plain(lv.links.map(l => l.id)), ['mine', 'm2', 't3'], 'the same relation drawn on both sides (another id) is not added twice; B ➔ A is another relation');
  const lw = { links: [{ id: 'x', from: 'a', to: 'b', type: 'mutual', note: '' }] };
  const rw = L.mergeFillEmpty(lw, { links: [{ id: 'y', from: 'b', to: 'a', type: 'mutual', note: '' }, { id: 'z', from: 'c', to: 'd', type: 'leads' }, { id: 'z2', from: 'c', to: 'd', type: 'leads' }] });
  assert.deepEqual(plain(rw.conflicts), [], 'the same relation with another id or drawn the other way round is no conflict');
  assert.equal(lw.links.length, 2, 'a relation listed twice in the file is added once');
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

test('study ids from another file: every place a row names a study is turned into the local id', () => {
  const map = { p1: 'l1', p2: 'l2' };
  const toLocal = id => map[id];
  const row = { id: 'r', baseDocId: 'p1', cellStatus: { p2: { status: 'absent' }, p9: { status: 'other_aspect' } }, baselineChange: { fromDocId: 'p1', toDocId: 'p2', at: 1 } };
  const out = plain(L.remapRowDocIds(row, toLocal));
  assert.equal(out.baseDocId, 'l1');
  assert.deepEqual(Object.keys(out.cellStatus).sort(), ['l2', 'p9'], 'an id with no local counterpart stays');
  assert.deepEqual([out.baselineChange.fromDocId, out.baselineChange.toDocId, out.baselineChange.at], ['l1', 'l2', 1]);
  assert.equal(row.baseDocId, 'p1', 'the row given is not changed');
  assert.equal(L.remapRowDocIds({ baseDocId: null }, toLocal).baseDocId, null, '"No single base" stays');
  assert.equal(L.remapRowDocIds({ baseDocId: '' }, toLocal).baseDocId, '', 'a base not set yet stays');
});

test('reference graph: every study id of a project from another file becomes the local one', () => {
  const toLocal = id => ({ p1: 'l1', p2: 'l2' })[id];
  const project = {
    docs: [{ id: 'p1' }, { id: 'p2', companionOf: 'p1' }],
    annotations: [{ id: 'a', docId: 'p2' }, { id: 'b', docId: 'p9' }],
    clusters: [{ id: 'r', baseDocId: 'p1', cellStatus: { p2: 'x' }, baselineChange: { fromDocId: 'p1', toDocId: 'p2' } }],
    loa: { id: 'loa_main', baselineDocId: 'p1', aim: 'kept' }
  };
  const out = plain(L.remapDocIds(project, toLocal));
  assert.deepEqual(out.docs.map(d => d.id), ['p1', 'p2'], "a study's own id is not changed (the map is looked up by it)");
  assert.equal(out.docs[1].companionOf, 'l1');
  assert.deepEqual(out.annotations.map(a => a.docId), ['l2', 'p9'], 'an id with no local counterpart stays');
  assert.deepEqual([out.clusters[0].baseDocId, Object.keys(out.clusters[0].cellStatus)[0], out.clusters[0].baselineChange.toDocId], ['l1', 'l2', 'l2']);
  assert.deepEqual([out.loa.baselineDocId, out.loa.aim], ['l1', 'kept']);
  assert.equal(project.docs[1].companionOf, 'p1', 'the records given are not changed');
  assert.ok(!('loa' in plain(L.remapDocIds({ docs: [] }, toLocal))), 'an absent part stays absent');
  assert.equal(plain(L.remapDocRecord({ id: 'x', companionOf: '' }, toLocal)).companionOf, '');
  assert.equal(plain(L.dropGoneDocRefs({ id: 'x', companionOf: 'nowhere' }, new Set(['x']))).companionOf, '', '"same primary study as" a study not here goes');
  assert.equal(plain(L.dropGoneDocRefs({ id: 'x', companionOf: 'x' }, new Set(['x']))).companionOf, '', '…and as itself');
  assert.equal(plain(L.dropGoneDocRefs({ id: 'x', companionOf: 'y' }, new Set(['x', 'y']))).companionOf, 'y');
});

test('reference graph: removing a study or a row leaves nothing pointing at it, and returns what Undo needs', () => {
  const docs = [{ id: 'd1' }, { id: 'd2', companionOf: 'd1' }, { id: 'd3' }];
  const clusters = [{ id: 'r1', baseDocId: 'd1', cellStatus: { d1: { status: 'absent' }, d3: { status: 'absent' } } }, { id: 'r2', baseDocId: 'd2' }];
  const annotations = [
    { id: 's1', docId: 'd2', type: 'second_order', clusterIds: ['r1', 'r2'], clusterRelations: { r1: 'reciprocal', r2: 'refutational' }, clusterComments: { r1: 'note' }, aspectUsedInLoa: {} },
    { id: 's2', docId: 'd3', type: 'second_order', clusterIds: ['r2'] },
    { id: 'q1', docId: 'd2', type: 'first_order', parentIds: ['s1'] }
  ];
  const loa = { id: 'loa_main', links: [{ id: 'l1', from: 'r1', to: 'r2', type: 'supports' }] };
  // A study
  const d = L.purgeDocRefs({ docs, clusters }, 'd1');
  assert.deepEqual(plain(d.cellStatus), [{ id: 'r1', v: { status: 'absent' } }]);
  assert.deepEqual(plain(d.companions), ['d2']);
  assert.deepEqual(plain(d.ops).map(o => [o.store, o.put.id]), [['clusters', 'r1'], ['docs', 'd2']]);
  assert.deepEqual(Object.keys(plain(d.ops[0].put.cellStatus)), ['d3'], "another study's empty-cell record stays");
  assert.equal(d.ops[0].put.baseDocId, 'd1', "a row's base is kept (history of study #1)");
  assert.ok('d1' in clusters[0].cellStatus && docs[1].companionOf === 'd1', 'the records given are not changed');
  // A row
  const r = L.purgeClusterRefs({ annotations, loa }, 'r1');
  assert.deepEqual(plain(r.assignedSecIds), ['s1']);
  assert.deepEqual(plain(r.perRow), { s1: { clusterRelations: 'reciprocal', clusterComments: 'note' } });
  assert.deepEqual(plain(r.removedLinks).map(l => l.id), ['l1']);
  const s1 = r.ops.find(o => o.store === 'annotations').put;
  assert.deepEqual(plain(s1.clusterIds), ['r2']);
  assert.deepEqual(plain(s1.clusterRelations), { r2: 'refutational' }, 'its place in another row is untouched');
  assert.deepEqual(plain(r.loa.links), []);
  assert.deepEqual(plain(annotations[0].clusterIds), ['r1', 'r2'], 'the records given are not changed');
  assert.equal(annotations[0].clusterComments.r1, 'note');
  // What is left after applying the ops passes the consistency rules
  const after = annotations.map(a => (r.ops.find(o => o.put && o.put.id === a.id) || { put: a }).put);
  assert.deepEqual(plain(L.checkInvariants({ docs, annotations: after, clusters: clusters.filter(c => c.id !== 'r1'), loa: r.loa })), []);
  // A stale per-row field (no membership) is cleaned as well
  const stale = L.purgeClusterRefs({ annotations: [{ id: 's9', docId: 'd1', type: 'second_order', clusterIds: [], clusterComments: { r1: 'left over' } }] }, 'r1');
  assert.deepEqual(plain(stale.assignedSecIds), []);
  assert.deepEqual(plain(stale.ops[0].put.clusterComments), {});
});

test('reference graph: map relations follow a merged row; duplicates and self-relations go', () => {
  const links = [
    { id: 'a', from: 'src', to: 'c', type: 'reciprocal' },
    { id: 'b', from: 'c', to: 'tgt', type: 'reciprocal' }, // without direction: the same relation as a once moved
    { id: 'x', from: 'src', to: 'tgt', type: 'supports' }, // the two rows to each other
    { id: 'd', from: 'src', to: 'c', type: 'supports' }
  ];
  const out = plain(L.moveRowLinks(links, 'src', 'tgt'));
  assert.deepEqual(out.map(l => [l.id, l.from, l.to]), [['a', 'tgt', 'c'], ['d', 'tgt', 'c']]);
  assert.equal(links[0].from, 'src', 'the relations given are not changed');
  assert.deepEqual(plain(L.liveRowLinks(links, new Set(['src', 'c']))).map(l => l.id), ['a', 'd']);
});

test('a construct and a row: taking out returns what it had there; putting in brings nothing old back', () => {
  const a = { id: 's', clusterIds: ['r1'], clusterRelations: { r1: 'other_aspect' }, aspectUsedInLoa: { r1: true } };
  const had = plain(L.takeOutOfRow(a, 'r1'));
  assert.deepEqual(had, { clusterRelations: 'other_aspect', aspectUsedInLoa: true });
  assert.deepEqual(plain(a), { id: 's', clusterIds: [], clusterRelations: {}, aspectUsedInLoa: {} });
  L.putIntoRow(a, 'r1', { clusterComments: 'n' });
  assert.deepEqual(plain(L.rowFieldsOf(a, 'r1')), { clusterComments: 'n' });
});

test('every write of several records goes through commitOps (state and database together)', () => {
  // dbBatch writes only the database: called anywhere else, the records in memory would be changed separately (before or
  // after, by hand). The demo seeds the database before the project is read into memory, so it may call it.
  const dir = path.join(ROOT, 'app/js');
  const offenders = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !['core.js', 'demo.js'].includes(f))
    .filter(f => /\bdbBatch\s*\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(offenders, [], 'call commitOps(ops) instead of dbBatch(ops)');
});

test('consistency rules: a consistent project passes, each kind of stale link is named', () => {
  const docs = [{ id: 'd1', conceptLinks: [{ id: 'k', from: 's1', to: 's2' }] }, { id: 'd2', companionOf: 'd1' }];
  const clusters = [{ id: 'r1', cellStatus: { d2: { status: 'absent' } } }];
  const annotations = [
    { id: 's1', docId: 'd1', type: 'second_order', clusterIds: ['r1'], clusterRelations: { r1: 'reciprocal' } },
    { id: 's2', docId: 'd1', type: 'second_order', clusterIds: [] },
    { id: 'q1', docId: 'd1', type: 'first_order', parentIds: ['s1'] }
  ];
  const loa = { links: [] };
  assert.deepEqual(plain(L.checkInvariants({ docs, annotations, clusters, loa })), []);
  const rules = x => plain(L.checkInvariants(x)).map(v => v.rule).sort();
  assert.deepEqual(rules({ docs, clusters, loa, annotations: [...annotations, { id: 's3', docId: 'd2', type: 'second_order', clusterIds: ['r1', 'gone'], clusterComments: { r9: 'x' } }] }),
    ['cell-status-with-card', 'row-exists', 'row-fields-in-rows']);
  assert.deepEqual(rules({ docs, clusters, loa, annotations: [...annotations, { id: 'q2', docId: 'd2', type: 'first_order', parentIds: ['s1', 'gone'], clusterIds: ['r1'] }] }),
    ['quote-parent', 'quote-parent', 'quote-shape']);
  assert.deepEqual(rules({ docs: [...docs, { id: 'd3', companionOf: 'd3', conceptLinks: [{ from: 's1', to: 's2' }] }], clusters, annotations, loa: { links: [{ id: 'l', from: 'r1', to: 'gone' }] } }),
    ['companion', 'concept-link', 'map-link']);
  // A construct absorbed as a passage keeps its within-study relationships under its id: not a violation
  const absorbed = annotations.map(a => a.id === 's2' ? { ...a, passages: [{ id: 'p', absorbed: { snapshot: { id: 's9' } } }] } : a);
  assert.deepEqual(plain(L.checkInvariants({ docs: [{ id: 'd1', conceptLinks: [{ from: 's1', to: 's9' }] }], clusters: [], loa, annotations: absorbed.map(a => ({ ...a, clusterIds: [], clusterRelations: {} })) })), []);
});

test('Appendix A goes by the kind of an entry, so rewording an action changes nothing; old entries are read by their text', () => {
  const K = L.isKeyDecisionLog;
  // Reworded actions, same kinds
  const ser = L.appendixSeries({ kind: 'step_a', action: 'Revised the translation summary', clusterIds: ['r1'] });
  assert.equal(ser.label, 'Step A translation summary revised');
  assert.equal(L.appendixSeries({ kind: 'step_a', action: 'x', clusterIds: ['r1'] }).key, ser.key, 'one series per row');
  assert.ok(!K({ kind: 'quote_link', action: 'Joined a quote and a construct', category: 'x' }), 'routine by kind');
  assert.ok(!K({ kind: 'writeup', action: 'Rewrote the reading process', category: 'reading_extraction' }));
  assert.ok(K({ kind: 'construct_delete', action: 'Removed a concept', clusterIds: ['r1'] }) && !K({ kind: 'construct_delete', action: 'Removed a concept', clusterIds: [] }));
  assert.ok(!K({ kind: 'judgement', action: 'Read as reciprocal', category: 'third_order', fromVal: '○ Not yet judged' }));
  assert.ok(K({ kind: 'auto_place', action: 'Seeded rows', category: 'matrix_mapping' }), 'auto-placement is the one key matrix entry');
  assert.ok(K({ kind: 'memo', action: 'A note without brackets' }));
  // An action text that an old pattern matches, but with a kind that says otherwise: the kind wins
  assert.ok(K({ kind: 'auto_place', action: 'Linked 1st Order Quote to …', category: 'matrix_mapping' }));
  // Entries without a kind (older trails): by their text, as before
  assert.equal(L.appendixSeries({ action: 'Updated Step A Translation Summary for "R"', clusterIds: ['r1'] }).label, 'Step A translation summary revised');
  assert.ok(!K({ action: 'Linked 1st Order Quote to …', category: 'linking' }));
  assert.ok(Object.values(L.LOG_KINDS).every(k => Object.keys(k).length > 0), 'every kind says how Appendix A treats it');
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
  assert.deepEqual(S('De la Cruz M'), { surname: 'De la Cruz', hasEtAl: false }, 'Vancouver: every word before the initials');
  assert.deepEqual(S('Van der Berg JK'), { surname: 'Van der Berg', hasEtAl: false });
  assert.deepEqual(S('Juan de la Cruz'), { surname: 'de la Cruz', hasEtAl: false }, 'lower-case particles belong to the surname');
  assert.deepEqual(S('Ludwig van Beethoven'), { surname: 'van Beethoven', hasEtAl: false });
  assert.deepEqual(S('Smith'), { surname: 'Smith', hasEtAl: false });
  assert.deepEqual(S('Smith, John'), { surname: 'Smith', hasEtAl: false }, 'one author written surname first');
  assert.deepEqual(S('Smith, J, Lee, K'), { surname: 'Smith', hasEtAl: true });
  assert.deepEqual(S('山田 太郎、佐藤 花子'), { surname: '山田', hasEtAl: true });
  assert.deepEqual(S(''), { surname: '', hasEtAl: true });
  const year = s => (String(s).match(L.YEAR_RE) || [])[1] || '';
  assert.equal(L.yearFromPdfDate('D:19680301120000'), '1968', 'PDF Info dates (more digits after the year); classic studies of the 1960s');
  assert.equal(L.yearFromPdfDate('2021-03-01T10:00:00Z'), '2021');
  assert.equal(L.yearFromPdfDate('D:18990101'), '');
  assert.equal(year('Smith_2021_nursing.pdf'), '2021');
  assert.equal(year('ID 12019 and 1939'), '', 'no year inside a longer number, none before 1940');
});
