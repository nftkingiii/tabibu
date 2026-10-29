// The "before" workflow for the Cloud to Pocket comparison: the same question,
// the same retrieved guideline excerpts and the same verification, but the
// language work (translation, answer, danger flag) is sent to a cloud model.
// Used only by eval/run.js; the Tabibu app never imports this file.
// Needs ANTHROPIC_API_KEY (or an `ant auth login` profile) in the environment.
import Anthropic from '@anthropic-ai/sdk'
import { RETRIEVAL } from '../src/config.js'
import { search } from '../src/store.js'
import { verifyStep, MESSAGES } from '../src/pipeline.js'
import { detectLanguage } from '../src/lang.js'

export const CLOUD_MODEL = process.env.TABIBU_CLOUD_MODEL || 'claude-opus-5-5'
// USD per million tokens (input, output) for claude-opus-5-5.
const PRICE = { input: 4, output: 20 }

const client = new Anthropic()

async function call ({ system, user, schema, maxTokens = 2000 }) {
  const body = {
    model: CLOUD_MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }]
  }
  const res = await client.beta.messages.create(body)
  if (res.stop_reason === 'refusal') throw new Error(`Cloud model declined: ${res.stop_details?.category ?? 'unknown'}`)
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return {
    value: JSON.parse(text),
    bytesSent: Buffer.byteLength(JSON.stringify(body)),
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    servedBy: res.model
  }
}

const SYSTEM = `You help community health workers by using only the WHO/UNICEF guideline excerpts provided.
Rules:
- Answer only from the excerpts. Never use outside knowledge.
- Give at most 4 steps. Each step is one complete instruction sentence taken from one excerpt, with that excerpt's number as source.
- Copy doses, ages, durations and numbers exactly as written in the excerpt.
- If the excerpts do not answer the question, set covered to false and return an empty steps list.
- Set refer to true if the question describes any danger sign that requires urgent referral, and list those signs.`

export async function cloudAnswer ({ question, lang = 'auto' }) {
  const started = Date.now()
  const usage = { bytesSent: 0, inputTokens: 0, outputTokens: 0, calls: 0, servedBy: new Set() }
  const track = r => {
    usage.bytesSent += r.bytesSent
    usage.inputTokens += r.inputTokens
    usage.outputTokens += r.outputTokens
    usage.calls++
    usage.servedBy.add(r.servedBy)
    return r.value
  }
  const language = lang === 'auto' ? detectLanguage(question) : lang

  const questionEn = language === 'sw'
    ? track(await call({
      system: 'Translate the Swahili text to English. Keep medicine and test names unchanged.',
      user: question,
      schema: { type: 'object', properties: { english: { type: 'string' } }, required: ['english'], additionalProperties: false },
      maxTokens: 500
    })).english
    : question

  const hits = await search(questionEn, RETRIEVAL.topK)
  const excerpts = hits.map((h, i) => `[${i + 1}] (p. ${h.printedPage ?? `pdf ${h.pdfPage}`})\n${h.text}`).join('\n\n')
  const value = track(await call({
    system: SYSTEM,
    user: `Excerpts:\n${excerpts}\n\nQuestion: ${questionEn}${language === 'sw' ? '\n\nAlso give each step in Swahili in steps_sw, in the same order.' : ''}`,
    schema: {
      type: 'object',
      properties: {
        refer: { type: 'boolean' },
        danger_signs: { type: 'array', items: { type: 'string' } },
        covered: { type: 'boolean' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, source: { type: 'integer', enum: hits.map((_, i) => i + 1) } },
            required: ['text', 'source'],
            additionalProperties: false
          }
        },
        steps_sw: { type: 'array', items: { type: 'string' } }
      },
      required: ['refer', 'danger_signs', 'covered', 'steps', 'steps_sw'],
      additionalProperties: false
    }
  }))

  const steps = []
  const removed = []
  ;(value.steps || []).slice(0, 4).forEach((s, i) => {
    const hit = hits[s.source - 1]
    const check = hit ? verifyStep(s.text, hit, questionEn) : { ok: false, why: 'cites an excerpt that was not retrieved' }
    const other = check.ok ? null : hits.find(h => h !== hit && verifyStep(s.text, h, questionEn).ok)
    const src = check.ok ? hit : other
    if (src) steps.push({ text: s.text, textSw: value.steps_sw?.[i], source: { doc: src.doc, pdfPage: src.pdfPage, printedPage: src.printedPage } })
    else removed.push({ text: s.text, why: check.why })
  })
  const covered = Boolean(value.covered) && steps.length > 0

  return {
    question,
    questionEn,
    language,
    covered,
    steps,
    removed,
    danger: { refer: Boolean(value.refer), signs: value.danger_signs.map(label => ({ label })) },
    message: value.refer ? MESSAGES[language].refer : covered ? null : MESSAGES[language].notCovered,
    timings: { total: Date.now() - started },
    usage: {
      ...usage,
      servedBy: [...usage.servedBy],
      costUsd: (usage.inputTokens * PRICE.input + usage.outputTokens * PRICE.output) / 1e6
    }
  }
}
