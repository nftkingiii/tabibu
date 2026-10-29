// The Tabibu answer pipeline. Every step runs on the device through QVAC:
//   1. Swahili question -> English (AfriqueGemma-4B)
//   2. Danger-sign screen (deterministic rules that cite the manual)
//   3. Guideline search (EmbeddingGemma vectors)
//   4. Grounded answer as JSON with one source per step (Qwen3-1.7B)
//   5. Verification: every step must cite a retrieved page, and every number in
//      it must appear on that page. Unsupported steps are removed, not shown.
//   6. English answer -> Swahili (AfriqueGemma-4B)
import { RETRIEVAL } from './config.js'
import { search, pageText } from './store.js'
import { generateJson, translate } from './qvac.js'
import { screenDanger } from './danger.js'
import { detectLanguage } from './lang.js'

const SYSTEM = `You help community health workers by using only the WHO/UNICEF guideline excerpts provided.
Rules:
- Answer only from the excerpts. Never use outside knowledge.
- Give at most 4 steps. Each step is one complete instruction sentence taken from one excerpt, with that excerpt's number as source.
- Copy doses, ages, durations and numbers exactly as written in the excerpt.
- If the excerpts do not answer the question, set covered to false and return an empty steps list.`

export const MESSAGES = {
  en: {
    refer: 'Refer urgently: take the child to the health facility now.',
    notCovered: 'This is not covered by the loaded guidelines. Tabibu will not guess. If the child is sick, refer to the health facility.'
  },
  sw: {
    refer: 'Rufaa ya haraka: mpeleke mtoto kituo cha afya sasa hivi.',
    notCovered: 'Swali hili halimo kwenye miongozo iliyopakiwa. Tabibu haibahatishi. Kama mtoto ni mgonjwa, mpe rufaa kwenda kituo cha afya.'
  }
}

export async function answer ({ question, lang = 'auto' }, onStage = () => {}) {
  const timings = {}
  const time = async (name, fn) => {
    onStage(name)
    const t = Date.now()
    try { return await fn() } finally { timings[name] = Date.now() - t }
  }
  const started = Date.now()
  const language = lang === 'auto' ? detectLanguage(question) : lang

  const questionEn = language === 'sw' ? await time('translate_in', () => translate(question, 'sw', 'en')) : question
  const danger = await time('screen', () => screenDanger(question, questionEn))
  const hits = await time('search', () => search(questionEn, RETRIEVAL.topK))
  const topScore = hits[0]?.score ?? 0

  let covered = topScore >= RETRIEVAL.minScore
  let reason = covered ? null : 'retrieval_below_threshold'
  let steps = []
  const removed = []

  if (covered) {
    const excerpts = hits.map((h, i) => `[${i + 1}] (${pageLabel(h)})\n${h.text}`).join('\n\n')
    const schema = {
      type: 'object',
      properties: {
        covered: { type: 'boolean' },
        steps: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              source: { type: 'integer', enum: hits.map((_, i) => i + 1) }
            },
            required: ['text', 'source']
          }
        }
      },
      required: ['covered', 'steps']
    }
    const { value } = await time('generate', () => generateJson({
      system: SYSTEM,
      user: `Excerpts:\n${excerpts}\n\nQuestion: ${questionEn}`,
      schema
    }))
    await time('verify', async () => {
      for (const step of value.steps || []) {
        const cited = hits[step.source - 1]
        const check = cited ? verifyStep(step.text, cited, questionEn) : { ok: false, why: 'cites an excerpt that was not retrieved' }
        if (check.ok) {
          steps.push({ text: step.text, source: cite(cited) })
          continue
        }
        // The numbers may be right but attributed to the wrong excerpt; move the
        // citation to a retrieved page that does contain them.
        const other = hits.find(h => h !== cited && verifyStep(step.text, h, questionEn).ok)
        if (other) steps.push({ text: step.text, source: cite(other), recited: true })
        else removed.push({ text: step.text, why: check.why })
      }
    })
    if (!value.covered || steps.length === 0) {
      covered = false
      reason = value.covered ? 'all_steps_failed_verification' : 'model_said_not_covered'
      steps = []
    }
  }

  if (language === 'sw' && steps.length) {
    await time('translate_out', async () => {
      for (const step of steps) step.textSw = await translate(step.text, 'en', 'sw')
    })
  }

  return {
    question,
    questionEn,
    language,
    covered,
    reason,
    steps,
    removed,
    danger,
    message: danger.refer ? MESSAGES[language].refer : covered ? null : MESSAGES[language].notCovered,
    sources: hits.map(h => ({ ...cite(h), score: round(h.score), title: h.title })),
    topScore: round(topScore),
    timings: { ...timings, total: Date.now() - started }
  }
}

// A step survives only if every number in it appears on the page it cites, or
// was stated in the question itself (such as the child's age). This stops a
// small model from inventing a dose.
export function verifyStep (text, hit, question = '') {
  const page = pageText(hit.doc, hit.pdfPage)?.text || hit.text
  const haystack = normalizeNumbers(page)
  const given = new Set(numbersIn(question))
  for (const n of numbersIn(text)) {
    if (given.has(n)) continue
    if (!new RegExp(`(^|[^\\d./])${n.replace('.', '\\.')}($|[^\\d])`).test(haystack)) {
      return { ok: false, why: `"${n}" does not appear on ${pageLabel(hit)}` }
    }
  }
  return { ok: true }
}

function numbersIn (s) {
  return normalizeNumbers(s).match(/\d+(?:[./]\d+)?/g) || []
}

function normalizeNumbers (s) {
  return s.replace(/½/g, '1/2').replace(/¼/g, '1/4').replace(/(\d),(\d{3})/g, '$1$2')
}

function cite (h) {
  return { doc: h.doc, pdfPage: h.pdfPage, printedPage: h.printedPage, label: pageLabel(h) }
}

function pageLabel (h) {
  return h.printedPage ? `p. ${h.printedPage}` : `PDF p. ${h.pdfPage}`
}

function round (x) {
  return Math.round(x * 1000) / 1000
}
