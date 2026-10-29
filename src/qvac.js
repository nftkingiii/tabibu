// Thin wrapper around @qvac/sdk. Every AI call in Tabibu goes through here, and
// all three models are loaded from local files, so nothing here touches the network.
import path from 'node:path'
import fs from 'node:fs'
import { loadModel, unloadModel, completion, embed } from '@qvac/sdk'
import { MODELS, MODELS_DIR } from './config.js'

const loaded = {}
const loading = {}

export function modelPath (key) {
  return path.join(MODELS_DIR, MODELS[key].file)
}

export function modelsPresent () {
  return Object.fromEntries(Object.keys(MODELS).map(k => [k, fs.existsSync(modelPath(k))]))
}

const LOAD_OPTIONS = {
  embed: { modelType: 'embeddings', modelConfig: {} },
  chat: { modelType: 'llm', modelConfig: { ctx_size: 4096, temp: 0.1, load_mode: 'none' } },
  // AfriqueGemma is a base model, so it is driven with a few-shot prompt and
  // stops at the end of the translated line.
  translate: { modelType: 'llm', modelConfig: { ctx_size: 2048, temp: 0, stop_sequences: ['\n'], load_mode: 'none' } }
}

export async function ensure (key) {
  if (loaded[key]) return loaded[key]
  if (!loading[key]) {
    const file = modelPath(key)
    if (!fs.existsSync(file)) throw new Error(`Model file missing: ${file}. Run "npm run setup" while online.`)
    const started = Date.now()
    loading[key] = loadModel({ modelSrc: file, ...LOAD_OPTIONS[key] }).then(id => {
      loaded[key] = { id, loadMs: Date.now() - started }
      return loaded[key]
    }).finally(() => { delete loading[key] })
  }
  return loading[key]
}

export function loadedModels () {
  return Object.fromEntries(Object.entries(loaded).map(([k, v]) => [k, { loadMs: v.loadMs }]))
}

export async function unloadAll () {
  for (const [key, m] of Object.entries(loaded)) {
    await unloadModel({ modelId: m.id, clearStorage: false })
    delete loaded[key]
  }
}

// EmbeddingGemma expects task prefixes on queries and documents.
export async function embedDocuments (texts) {
  const { id } = await ensure('embed')
  const out = []
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16).map(t => `title: none | text: ${t}`)
    const { embedding } = await embed({ modelId: id, text: batch })
    out.push(...embedding)
  }
  return out
}

export async function embedQuery (text) {
  const { id } = await ensure('embed')
  const { embedding } = await embed({ modelId: id, text: `task: search result | query: ${text}` })
  return embedding
}

export async function generateJson ({ system, user, schema, maxTokens = 600 }) {
  const { id } = await ensure('chat')
  const run = completion({
    modelId: id,
    history: [
      { role: 'system', content: system },
      { role: 'user', content: `${user} /no_think` }
    ],
    stream: true,
    generationParams: { predict: maxTokens },
    responseFormat: { type: 'json_schema', json_schema: { name: 'answer', schema } }
  })
  const final = await run.final
  // Some chat templates open a <think> block even with thinking off; the JSON
  // object itself starts at the first brace after it.
  const text = final.contentText.replace(/<think>[\s\S]*?<\/think>/g, '')
  return { value: JSON.parse(text.slice(text.indexOf('{'))), stats: final.stats }
}

const SHOTS = [
  ['Wash your hands with soap and water.', 'Nawa mikono yako kwa sabuni na maji.'],
  ['The child has a fever.', 'Mtoto ana homa.'],
  ['Give ORS solution and zinc for 10 days.', 'Mpe mtoto ORS na zinc kwa siku 10.'],
  ['Give 2 tablets of amoxicillin twice daily for 5 days.', 'Mpe vidonge 2 vya amoxicillin mara mbili kwa siku kwa siku 5.'],
  ['Do an RDT and check the MUAC strap.', 'Fanya kipimo cha RDT na uangalie utepe wa MUAC.']
]

const LANG_NAME = { en: 'English', sw: 'Swahili' }

export async function translate (text, from, to) {
  const { id } = await ensure('translate')
  const shots = SHOTS.map(([en, sw]) => {
    const pair = { en, sw }
    return `${LANG_NAME[from]}: ${pair[from]}\n${LANG_NAME[to]}: ${pair[to]}\n`
  }).join('')
  const prompt = `Translate between English and Swahili. Keep medicine and test names (ORS, zinc, amoxicillin, AL, RDT, MUAC) unchanged.\n${shots}${LANG_NAME[from]}: ${text.replace(/\s+/g, ' ').trim()}\n${LANG_NAME[to]}:`
  const run = completion({
    modelId: id,
    history: [{ role: 'user', content: prompt }],
    stream: true,
    generationParams: { predict: 200 }
  })
  const final = await run.final
  return final.raw.fullText.split('\n')[0].trim()
}
