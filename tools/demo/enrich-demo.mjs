// AI-GENERATED FICTIONAL CONTENT. Adds worked examples of the newer features to the demo project, so that a visitor
// sees each of them in use. Everything written here is invented, like the rest of the demo.
// Usage: node tools/demo/enrich-demo.mjs <merged-backup.json> <out.json>   (then: node tools/demo/build-demo-data.mjs <out.json>)
// Safe to run on an already enriched file: it sets the same values again.
import fs from 'node:fs';

const [,, src, out] = process.argv;
if (!src || !out) { console.error('Usage: node tools/demo/enrich-demo.mjs <in.json> <out.json>'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const A = 'Reviewer A';

const docBy = author => { const d = data.docs.find(x => x.author === author); if (!d) throw new Error('No study by ' + author); return d; };
const secBy = (author, label) => {
  const s = data.annotations.find(a => a.type === 'second_order' && a.docId === docBy(author).id && a.note === label);
  if (!s) throw new Error(`No construct "${label}" in ${author}`); return s;
};
const rowBy = title => { const c = data.clusters.find(x => x.thirdOrderTitle === title); if (!c) throw new Error('No row ' + title); return c; };
const name = d => `${d.author} et al. (${d.year})`;

// Audit entries for the examples, a few minutes after the last existing entry
let t = Math.max(...data.logs.map(l => l.timestamp || 0));
const logs = [];
const log = e => { t += 60000; logs.push({ id: 'log_demo_' + logs.length + '_' + t, timestamp: t, isoTime: new Date(t).toISOString(), reviewer: A, fromVal: '', toVal: '', rationale: '', detail: '', ...e }); };
data.logs = data.logs.filter(l => !String(l.id).startsWith('log_demo_')); // re-runs replace their own entries

// 1. How the rows started (asked once per project)
data.loa = { ...data.loa, seedChoice: 'manual' };
log({ category: 'translation_process', action: 'Rows are created by the reviewer: study #1 is not placed automatically', fromVal: '(not decided)', toVal: 'Empty matrix',
  rationale: 'Hartwell was the first account we read, not a chosen index paper; we wanted each concept compared with all the others before any row existed.' });

// 2. Placements whose relation has not been judged yet (○)
const unjudged = [['Sato', 'Owed recovery', 'Fatigue is normalised and left to the individual'], ['Reyes', 'Rostering as a hidden inequity', 'Night work sits outside the organisation’s view']];
for (const [au, label, row] of unjudged) {
  const s = secBy(au, label), c = rowBy(row);
  if (s.clusterRelations) delete s.clusterRelations[c.id];
}

// 3. Empty cells that say why
const empty = [
  ['Responsibility without back-up', 'Sato', 'other_aspect', 'Sato’s nurses describe the same nights through fatigue and recovery, not through who carries decisions: a different side of the topic for the line of argument.'],
  ['Fatigue is normalised and left to the individual', 'Reyes', 'absent', 'Read the whole account again: managers in Reyes do not speak about staff fatigue.']
];
for (const [row, au, status, note] of empty) {
  const c = rowBy(row), d = docBy(au);
  c.cellStatus = { ...(c.cellStatus || {}), [d.id]: { status, note } };
  log({ category: 'relating_studies', clusterIds: [c.id],
    action: `${name(d)} in "${row}": ${status === 'absent' ? 'Checked: not addressed in this study' : 'Addresses a different aspect of the topic'}`,
    fromVal: 'Not yet checked', toVal: status === 'absent' ? 'Checked: not addressed in this study' : 'Addresses a different aspect of the topic', detail: note });
}

// 4. How each study's own concepts relate (within one account)
const links = [
  ['Hartwell', 'Invisibility to the day team', 'leads', 'Solitary accountability', 'Discussion: because night work is not seen, its risks are left to the nurse on shift.'],
  ['Sato', 'Owed recovery', 'contradicts', 'Fatigue as the price of the job', 'Nurses accept tiredness as normal, yet feel a rest is owed to them that never comes.'],
  ['Reyes', 'Nights outside our line of sight', 'leads', 'Escalation without back-up', 'Managers link not seeing nights to staff having no one to escalate to.']
];
for (const d of data.docs) d.conceptLinks = [];
links.forEach(([au, from, type, to, note], i) => {
  const d = docBy(au);
  d.conceptLinks.push({ id: 'cl_demo_' + i, from: secBy(au, from).id, to: secBy(au, to).id, type, note });
  const sym = { leads: '➔', contradicts: '⚡' }[type];
  log({ category: 'reading_extraction', action: `Recorded how two concepts relate within ${name(d)}`, toVal: `${from} ${sym} ${to}`, detail: note });
});

// 5. The construct left out of every row, with the reason
const left = secBy('Sato', 'Exhaustion is part of nursing');
left.notTranslatedNote = 'Reviewer B’s reading of the same passage as “Fatigue as the price of the job”; kept for the team discussion rather than placed twice.';
log({ category: 'translation_process', action: 'Noted why a 2nd Order construct was not translated into any 3rd Order row', detail: `${name(docBy('Sato'))} (p.${left.page}): ${left.note}`, toVal: left.notTranslatedNote });

// 6. CASP 2024: judgement and reason for each question, and the CASP appraisal summary (never a score)
const Y = 'yes', N = 'no', C = 'cant_tell';
const casp = {
  Hartwell: {
    a: [[Y, 'Aim stated in the abstract and introduction.'], [Y, 'Asks how nurses experience nights.'], [Y, 'Interviews suit the experiential aim.'],
      [Y, 'Nurses working at least three nights a month; criterion explained.'], [Y, 'Recorded interviews, 40–70 min, transcribed.'],
      [C, 'A reflective diary is mentioned, but its influence is not discussed.'], [C, 'No ethics approval or consent process reported.'],
      [Y, 'Reflexive thematic analysis; themes shown with quotations.'], [Y, 'Three explicit themes linked in the discussion.'], [Y, 'Shows night work as a different job; limits stated.']],
    sum: { pos: 'Clear aim and design; rich quotations; limits stated.', neg: '', unk: 'Ethics and the effect of the researcher are not reported.' }
  },
  Sato: {
    a: [[Y, 'Aim stated.'], [Y, 'Seeks nurses’ own sense-making.'], [Y, 'Focus groups suit shared norms such as gaman.'],
      [C, 'How the 18 nurses were chosen is not described.'], [Y, 'Translated by two bilingual researchers.'],
      [C, 'No discussion of the researchers’ role.'], [C, 'No ethics approval or consent process reported.'],
      [C, 'Content analysis, then team interpretation; little detail on how themes were derived.'], [Y, 'Three explicit themes.'], [Y, 'Cultural framing of fatigue discussed as a limit.']],
    sum: { pos: 'Translation handled with care; culturally specific concept (gaman).', neg: 'Thin description of sampling and analysis.', unk: 'Researcher role; ethics.' }
  },
  Nguyen: {
    a: [[Y, 'Aim stated.'], [Y, 'Managers’ views are interpretive questions.'], [Y, 'Interviews suit the aim.'],
      [C, 'Volunteers only; the authors note they may be more confident in their staff.'], [Y, 'Phone or video interviews of about 45 min.'],
      [C, 'Not discussed.'], [C, 'No ethics approval or consent process reported.'],
      [C, 'Thematic analysis named but not described.'], [Y, 'Explicit themes; contrasts with staff accounts discussed.'], [Y, 'Points to the gap between manager and staff accounts.']],
    sum: { pos: 'Rare managers’ perspective; the authors reflect on their own setting (a coordinator on every floor).', neg: 'Analysis not described.', unk: 'Recruitment; ethics; researcher role.' }
  },
  Reyes: {
    a: [[Y, 'Aim stated.'], [Y, 'How managers understand escalation is interpretive.'], [Y, 'Ethnography plus interviews suits practice at night.'],
      [Y, 'Managers and coordinators across two sites, evenings and nights.'], [Y, '60 hours of observation, field notes and interviews.'],
      [C, 'Not discussed.'], [C, 'No ethics approval or consent process reported.'],
      [Y, 'Field notes and transcripts analysed together; participants checked a summary.'], [Y, 'Explicit themes; credibility supported by member checking.'], [Y, 'Limits stated: staff nurses not interviewed.']],
    sum: { pos: 'Observation at night; member checking.', neg: '', unk: 'Researcher role; ethics.' }
  }
};
for (const [au, v] of Object.entries(casp)) {
  const d = docBy(au);
  d.appraisalTool = 'CASP';
  d.appraisalItems = { CASP: Object.fromEntries(v.a.map(([a, note], i) => ['q' + (i + 1), { a, note }])) };
  d.appraisalSummary = { CASP: v.sum };
  log({ category: 'context_appraisal', action: `Appraisal (CASP) for ${name(d)}: judgement and reason recorded for each of the 10 questions`,
    detail: 'CASP Checklist: For Qualitative Research (2024). Judgements are recorded with reasons and not added up into a score.' });
}

data.logs = [...logs.reverse(), ...data.logs].sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
fs.writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`enriched demo written to ${out}: ${logs.length} audit entries added`);
