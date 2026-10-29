// Deterministic danger-sign screen from the WHO/UNICEF community case management
// manual ("Any DANGER SIGN: Refer the child"). It runs on both the original
// question and its English translation, so it does not depend on the language
// model, and a wrong translation cannot hide a convulsion or blood in stool.
import { findPhrase } from './store.js'

const NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30,
  moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10, ishirini: 20, thelathini: 30
}
const UNIT_DAYS = { day: 1, days: 1, siku: 1, week: 7, weeks: 7, wiki: 7, month: 30, months: 30, mwezi: 30, miezi: 30 }

// Ages look like durations ("a 4 month old"), so they are removed first.
const AGE = /\b\d+[- ]?(day|week|month|year)s?[- ]old\b|\b(aged?|age of) \d+ (days?|weeks?|months?|years?)\b|\b(umri wa |wa |mwenye )(siku|wiki|miezi|mwezi|miaka|mwaka) \S+/gi

// Longest duration mentioned in the same sentence as a symptom, in days.
function durationDays (sentence) {
  sentence = sentence.replace(AGE, ' ')
  let best = 0
  const re = /(\d+|[a-z]+)\s+(days?|weeks?|months?)\b|\b(siku|wiki|mwezi|miezi)\s+(\d+|[a-z]+)/gi
  for (const m of sentence.matchAll(re)) {
    const n = m[1] ? toNum(m[1]) : toNum(m[4])
    const unit = (m[2] || m[3]).toLowerCase()
    if (n) best = Math.max(best, n * UNIT_DAYS[unit])
  }
  if (/\b(a|one|wiki) (week|nzima)\b/i.test(sentence)) best = Math.max(best, 7)
  return best
}

function toNum (s) {
  return /^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()] || 0
}

const durationRule = (symptom, minDays) => text =>
  text.split(/(?<=[.!?;])\s+|\n/).some(s => symptom.test(s) && durationDays(s) >= minDays)

const RULES = [
  { id: 'cough14', label: 'Cough for 14 days or more', labelSw: 'Kikohozi kwa siku 14 au zaidi', anchor: 'A child who has had cough for 14 days or more has a danger sign',
    test: durationRule(/cough|kikohozi|kukohoa|anakohoa/i, 14) },
  { id: 'diarrhoea14', label: 'Diarrhoea for 14 days or more', labelSw: 'Kuhara kwa siku 14 au zaidi', anchor: 'Diarrhoea for 14 days or more, however, is a danger sign',
    test: durationRule(/diarrh|loose stool|kuhara|kuharisha|anaharisha|choo laini/i, 14) },
  { id: 'blood', label: 'Blood in stool', labelSw: 'Damu kwenye kinyesi', anchor: 'Refer a child with blood in the stool',
    test: t => /blood[^.]{0,40}(stool|poo|faeces|feces|diarrh)|bloody (stool|diarrh)|damu[^.]{0,30}(kinyesi|choo|haja)|(kinyesi|choo)[^.]{0,30}damu|kuhara damu/i.test(t) },
  { id: 'fever7', label: 'Fever for last 7 days or more', labelSw: 'Homa kwa siku 7 au zaidi', anchor: 'Refer a child who has had fever for the last 7 days or more',
    test: durationRule(/fever|hot body|homa|joto/i, 7) },
  { id: 'convulsions', label: 'Convulsions', labelSw: 'Degedege', anchor: 'A convulsion during the child',
    test: t => /convuls|seizure|\bfits?\b|degedege|kifafa|anatetemeka/i.test(t) },
  { id: 'nodrink', label: 'Not able to drink or eat anything', labelSw: 'Hawezi kunywa wala kula chochote', anchor: 'Refer a child who is not able to drink or eat anything',
    test: t => /(cannot|can't|can not|unable to|not able to|won't|refuses to|does not|doesn't) (drink|eat|feed|breastfeed|swallow)|hawezi (kunywa|kula|kunyonya|kumeza)|hanywi|hali chochote/i.test(t) },
  { id: 'vomitsall', label: 'Vomits everything', labelSw: 'Anatapika kila kitu', anchor: 'When the child vomits everything',
    test: t => /vomit\w* (everything|all|anything)|throws up everything|anatapika (kila kitu|vyote)|kutapika kila/i.test(t) },
  { id: 'indrawing', label: 'Chest indrawing', labelSw: 'Kifua kuingia ndani (chest indrawing)', anchor: 'Chest indrawing is a sign of severe pneumonia',
    test: t => /chest indrawing|indrawing|chest (pulls|sucks|goes) in|kifua (kinavutika|kinabonyea|kinaingia)/i.test(t) },
  { id: 'sleepy', label: 'Unusually sleepy or unconscious', labelSw: 'Usingizi usio wa kawaida au hajitambui', anchor: 'A child who is unusually sleepy is not alert',
    test: t => /unconscious|unusually sleepy|very sleepy|cannot (be )?wake|can't (be )?wake|won't wake|lethargic|hajitambui|amepoteza fahamu|hawezi kuamka|usingizi mwingi/i.test(t) },
  { id: 'muacred', label: 'Red on MUAC strap', labelSw: 'Nyekundu kwenye utepe wa MUAC', anchor: 'Red on the MUAC strap indicates severe malnutrition',
    test: t => /muac[^.]{0,30}\bred\b|\bred\b[^.]{0,30}muac|muac[^.]{0,30}nyekundu|nyekundu[^.]{0,30}muac/i.test(t) },
  { id: 'feet', label: 'Swelling of both feet', labelSw: 'Kuvimba kwa miguu yote miwili', anchor: 'Swelling of both feet indicates severe malnutrition',
    test: t => /(swell\w*|swollen)[^.]{0,20}\bfeet\b|\bfeet\b[^.]{0,20}(swollen|swelling|puffy)|oedema|edema|miguu[^.]{0,20}(imevimba|kuvimba|kuvimba)|kuvimba[^.]{0,15}miguu|imevimba miguu/i.test(t) }
]

export function screenDanger (...texts) {
  const text = texts.filter(Boolean).join('\n')
  const found = RULES.filter(r => r.test(text)).map(r => ({ id: r.id, label: r.label, labelSw: r.labelSw, source: findPhrase(r.anchor) }))
  return { refer: found.length > 0, signs: found }
}

export const DANGER_RULES = RULES.map(({ id, label, labelSw, anchor }) => ({ id, label, labelSw, anchor }))
