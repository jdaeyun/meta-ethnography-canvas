// CASP Checklist: For Qualitative Research (2024) — question wording and "Consider" prompts.
//
// THIS FILE IS NOT COVERED BY THE MIT LICENCE OF META-ETHNOGRAPHY CANVAS.
// © Critical Appraisal Skills Programme (CASP). Licensed under Creative Commons
// Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0):
// https://creativecommons.org/licenses/by-nc-sa/4.0/
// Source: Critical Appraisal Skills Programme (2024). CASP Checklist: For Qualitative Research. https://casp-uk.net
// Reproduced unchanged (wording of questions, answer options, section headings and prompts); see LICENSE-CASP.md.
//
// Loaded as a classic <script> right after core.js, which defines APPRAISAL_CHECKLISTS.
APPRAISAL_CHECKLISTS.CASP = {
  name: 'CASP Checklist: For Qualitative Research (2024)',
  cite: 'Critical Appraisal Skills Programme (2024). CASP Checklist: For Qualitative Research. Available at: https://casp-uk.net. Licensed under CC BY-NC-SA 4.0.',
  answers: [['yes', 'Yes'], ['no', 'No'], ['cant_tell', "Can't Tell"]],
  guidance: 'During critical appraisal, never make assumptions about what the researchers have done. If it is not possible to tell, use the “Can’t tell” response box. If you can’t tell, at best it means the researchers have not been explicit or transparent, but at worst it could mean the researchers have not undertaken a particular task or process. Once you’ve finished the critical appraisal, if there are a large number of “Can’t tell” responses, consider whether the findings of the study are trustworthy and interpret the results with caution.',
  summary: {
    label: 'Appraisal summary: list key points from your critical appraisal that need to be considered when assessing the validity of the results and their usefulness in decision-making.',
    fields: [['pos', 'Positive / Methodologically sound'], ['neg', 'Negative / Relatively poor methodology'], ['unk', 'Unknowns']]
  },
  items: [
    { id: 'q1', section: 'Section A: Are the results valid?', text: 'Was there a clear statement of the aims of the research?',
      consider: ['what was the goal of the research?', 'why was it thought important?', 'its relevance'] },
    { id: 'q2', text: 'Is a qualitative methodology appropriate?',
      consider: ['If the research seeks to interpret or illuminate the actions and/or subjective experiences of research participants', 'Is qualitative research the right methodology for addressing the research goal?'] },
    { id: 'q3', text: 'Was the research design appropriate to address the aims of the research?',
      consider: ['if the researcher has justified the research design (e.g., have they discussed how they decided which method to use)'] },
    { id: 'q4', text: 'Was the recruitment strategy appropriate to the aims of the research?',
      consider: ['If the researcher has explained how the participants were selected', 'If they explained why the participants they selected were the most appropriate to provide access to the type of knowledge sought by the study', 'If there are any discussions around recruitment (e.g. why some people chose not to take part)'] },
    { id: 'q5', text: 'Was the data collected in a way that addressed the research issue?',
      consider: ['If the setting for the data collection was justified', 'If it is clear how data were collected (e.g. focus group, semi-structured interview etc.)', 'If the researcher has justified the methods chosen', 'If the researcher has made the methods explicit (e.g. for interview method, is there an indication of how interviews are conducted, or did they use a topic guide)', 'If methods were modified during the study. If so, has the researcher explained how and why', 'If the form of data is clear (e.g. tape recordings, video material, notes etc.)', 'If the researcher has discussed saturation of data'] },
    { id: 'q6', text: 'Has the relationship between researcher and participants been adequately considered?',
      consider: ['If the researcher critically examined their own role, potential bias and influence during (a) formulation of the research questions (b) data collection, including sample recruitment and choice of location', 'How the researcher responded to events during the study and whether they considered the implications of any changes in the research design'] },
    { id: 'q7', section: 'Section B: What are the results?', text: 'Have ethical issues been taken into consideration?',
      consider: ['If there are sufficient details of how the research was explained to participants for the reader to assess whether ethical standards were maintained', 'If the researcher has discussed issues raised by the study (e.g. issues around informed consent or confidentiality or how they have handled the effects of the study on the participants during and after the study)', 'If approval has been sought from the ethics committee'] },
    { id: 'q8', text: 'Was the data analysis sufficiently rigorous?',
      consider: ['If there is an in-depth description of the analysis process', 'If thematic analysis is used. If so, is it clear how the categories/themes were derived from the data', 'Whether the researcher explains how the data presented were selected from the original sample to demonstrate the analysis process', 'If sufficient data are presented to support the findings', 'To what extent contradictory data are taken into account', 'Whether the researcher critically examined their own role, potential bias and influence during analysis and selection of data for presentation'] },
    { id: 'q9', text: 'Is there a clear statement of findings?',
      consider: ['If the findings are explicit', 'If there is adequate discussion of the evidence both for and against the researcher’s arguments', 'If the researcher has discussed the credibility of their findings (e.g. triangulation, respondent validation, more than one analyst)', 'If the findings are discussed in relation to the original research question'] },
    { id: 'q10', section: 'Section C: Will the results help locally?', text: 'How valuable is the research?',
      consider: ['If the researcher discusses the contribution the study makes to existing knowledge or understanding (e.g., do they consider the findings in relation to current practice or policy, or relevant research-based literature', 'If they identify new areas where research is necessary', 'If the researchers have discussed whether or how the findings can be transferred to other populations or considered other ways the research may be used'] }
  ]
};
