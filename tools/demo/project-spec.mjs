// AI-GENERATED FICTIONAL CONTENT for the demo project (see papers.mjs). Describes what the two simulated
// reviewers extract from the four papers. Text snippets must match the PDF text exactly.
export const DOCS = [
  { file: 'AI-GENERATED_Hartwell-2018_staff-nurses-UK.pdf', author: 'Hartwell', year: '2018', group: "Nurses' views",
    title: "Alone on the ward: staff nurses' experiences of night shifts on acute medical wards",
    setting: 'UK, acute medical wards (one teaching hospital)', participants: '14 staff nurses',
    methodology: 'Semi-structured interviews; reflexive thematic analysis', quality: 'High', richness: 'Rich' },
  { file: 'AI-GENERATED_Sato-2020_staff-nurses-Japan.pdf', author: 'Sato', year: '2020', group: "Nurses' views",
    title: "The price of the job: nurses' accounts of fatigue and recovery after night shifts in a Japanese hospital",
    setting: 'Japan, university hospital', participants: '18 nurses in 3 focus groups',
    methodology: 'Focus groups; content analysis with interpretive synthesis', quality: 'Moderate', richness: 'Moderate' },
  { file: 'AI-GENERATED_Nguyen-2021_nurse-managers-Canada.pdf', author: 'Nguyen', year: '2021', group: "Managers' views",
    title: "Quiet hours, loose reins: nurse managers' views of night shifts and the support of night staff",
    setting: 'Canada, two large urban hospitals (night coordinator on every floor)', participants: '11 charge nurses and night coordinators',
    methodology: 'Semi-structured interviews; thematic analysis', quality: 'Moderate', richness: 'Rich' },
  { file: 'AI-GENERATED_Reyes-2022_unit-managers-Australia.pdf', author: 'Reyes', year: '2022', group: "Managers' views",
    title: 'Out of our line of sight: unit managers and after-hours coordinators on escalation and rostering at night',
    setting: 'Australia, two regional hospitals', participants: '10 unit managers and after-hours coordinators',
    methodology: 'Ethnography (60 h observation) and interviews', quality: 'Moderate', richness: 'Moderate' }
];
// Items per paper (index = DOCS order). s = 2nd order construct, q = 1st order quote linked to s[idx]
// start/end: first and last words of the passage to highlight.
export const ITEMS = [
  { s: [
      { id: 'h1', start: 'We interpret this as solitary accountability', end: 'judgement against.', label: 'Solitary accountability' },
      { id: 'h2', start: 'We interpret this as working against the body clock', end: 'rarely raise at work.', label: 'Working against the body clock' },
      { id: 'h3', start: 'We interpret this as invisibility to the day team', end: 'its own night work.', label: 'Invisibility to the day team' } ],
    q: [
      { s: 'h1', start: 'After midnight it’s me and one healthcare assistant', end: 'no one to ask.', who: 'Nurse 3' },
      { s: 'h1', start: 'You make the call, and you carry it home', end: 'carry it home with you.', who: 'Nurse 9' },
      { s: 'h2', start: 'Around four in the morning my brain just stops.', end: 'still don’t trust it.', who: 'Nurse 5' },
      { s: 'h3', start: 'Days see the tidy ward in the morning.', end: 'how it got that way.', who: 'Nurse 1' },
      { s: 'h3', start: 'Nobody from management has ever come on at night.', end: 'come on at night.', who: 'Nurse 8' } ] },
  { s: [
      { id: 'j1', start: 'We interpret this as fatigue as the price of the job', end: 'for the organisation to solve.', label: 'Fatigue as the price of the job' },
      { id: 'j2', start: 'We interpret this as owed recovery', end: 'absorbed by the rest of life.', label: 'Owed recovery' },
      { id: 'j3', start: 'We interpret this as a life out of step', end: 'daily life at home.', label: 'A life out of step' } ],
    q: [
      { s: 'j1', start: 'Everyone is tired. If you say it out loud', end: 'suited to the job.', who: 'Group 2, Nurse C' },
      { s: 'j2', start: 'After a night shift I tell myself I will sleep all day', end: 'and it is evening.', who: 'Group 3, Nurse B' },
      { s: 'j3', start: 'My children are going to school when I get home.', end: 'at the door.', who: 'Group 1, Nurse D' } ] },
  { s: [
      { id: 'n1', start: 'We interpret this as autonomy in the quiet hours', end: 'read as being trusted.', label: 'Autonomy in the quiet hours' },
      { id: 'n2', start: 'We interpret this as support at a distance', end: 'in the form of a phone call.', label: 'Support at a distance' },
      { id: 'n3', start: 'We interpret this as fatigue as an individual matter', end: 'to cope with the rest.', label: 'Fatigue as an individual matter' } ],
    q: [
      { s: 'n1', start: 'At night they run their own ship.', end: 'I trust them to.', who: 'Manager 2' },
      { s: 'n2', start: 'I’m on the phone from home if they need me', end: 'be on the ward.', who: 'Manager 6' },
      { s: 'n3', start: 'I can roster fairly, but I can’t roster away tiredness.', end: 'on them to manage.', who: 'Manager 4' } ] },
  { s: [
      { id: 'r1', start: 'We interpret this as escalation without back-up', end: 'someone to act with.', label: 'Escalation without back-up' },
      { id: 'r2', start: 'We interpret this as rostering as a hidden inequity', end: 'with the least say.', label: 'Rostering as a hidden inequity' },
      { id: 'r3', start: 'We interpret this as nights outside our line of sight', end: 'does not see.', label: 'Nights outside our line of sight' } ],
    q: [
      { s: 'r1', start: 'We say ‘just escalate’, but escalate to whom?', end: 'There is nobody.', who: 'Manager 5' },
      { s: 'r2', start: 'Nights go to whoever can’t say no.', end: 'and the casuals.', who: 'Manager 3' },
      { s: 'r3', start: 'I find out about a bad night from the incident report', end: 'report on Monday.', who: 'Manager 1' } ] }
];
// Reviewer B: a deliberately different extraction (partly overlapping) so the Compare step has something to show.
export const B_ITEMS = [
  { s: [
      { id: 'h1', start: 'responsibility that is not only heavy', end: 'judgement against.', label: 'Lone responsibility' },
      { id: 'h2', start: 'We interpret this as working against the body clock', end: 'rarely raise at work.', label: 'Working against the body clock' } ],
    q: [ { s: 'h1', start: 'After midnight it’s me and one healthcare assistant', end: 'no one to ask.', who: 'Nurse 3' } ] },
  { s: [
      { id: 'j1', start: 'We interpret this as fatigue as the price of the job', end: 'for the organisation to solve.', label: 'Fatigue as the price of the job' },
      { id: 'j2', start: 'We interpret this as owed recovery', end: 'absorbed by the rest of life.', label: 'Owed recovery' },
      { id: 'j3', start: 'We interpret this as a life out of step', end: 'daily life at home.', label: 'A life out of step' },
      { id: 'jx', start: 'Nurses spoke about exhaustion as something that simply comes with nursing.', end: 'came up in all three groups.', label: 'Exhaustion is part of nursing' } ],
    q: [] },
  { s: [
      { id: 'n1', start: 'We interpret this as autonomy in the quiet hours', end: 'read as being trusted.', label: 'Autonomy in the quiet hours' },
      { id: 'n2', start: 'We interpret this as support at a distance', end: 'in the form of a phone call.', label: 'Support at a distance' } ],
    q: [ { s: 'n1', start: 'The best nurses I have grow on nights.', end: 'over their shoulder.', who: 'Manager 8' } ] },
  { s: [
      { id: 'r1', start: 'We interpret this as escalation without back-up', end: 'someone to act with.', label: 'Escalation without back-up' },
      { id: 'r3', start: 'We interpret this as nights outside our line of sight', end: 'does not see.', label: 'Nights outside our line of sight' } ],
    q: [] }
];
