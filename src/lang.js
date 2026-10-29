// Lightweight English/Swahili detection by function-word frequency. The UI also
// lets the user pick the language explicitly.
const SW = new Set(('na ya wa kwa ni za la cha vya mtoto mwanangu wangu wake ana hana amekuwa kuna gani nini je ' +
  'nifanye afanye sana siku wiki homa kuhara kikohozi dawa mpe kunywa kula hawezi hajui baada kabla ' +
  'au lakini pia tu kama huyu yule mama baba umri miaka miezi tangu hadi anatapika anaharisha').split(' '))
const EN = new Set(('the a an is are was has have with for of to and or what how when should child my his her ' +
  'days weeks months give dose old can cannot does do').split(' '))

export function detectLanguage (text) {
  const words = text.toLowerCase().match(/[a-z']+/g) || []
  let sw = 0
  let en = 0
  for (const w of words) {
    if (SW.has(w)) sw++
    if (EN.has(w)) en++
  }
  return sw > en ? 'sw' : 'en'
}
