// A small on-disk vector index: guideline chunks plus EmbeddingGemma vectors from
// QVAC. Search is exact cosine similarity, which is fast enough for a few thousand
// chunks on a phone or laptop CPU.
import fs from 'node:fs'
import path from 'node:path'
import { INDEX_FILE, DATA_DIR, MODELS } from './config.js'
import { extractPages } from './pdf.js'
import { embedDocuments, embedQuery } from './qvac.js'

const CHUNK_WORDS = 170
const OVERLAP_WORDS = 40

let index = null

export function chunkPage (page) {
  const words = page.lines.join('\n').split(/(?<=\s)/)
  const chunks = []
  let start = 0
  while (start < words.length) {
    const end = Math.min(words.length, start + CHUNK_WORDS)
    const text = words.slice(start, end).join('').trim()
    if (text.split(/\s+/).length >= 12) chunks.push(text)
    if (end === words.length) break
    start = end - OVERLAP_WORDS
  }
  return chunks
}

export async function buildIndex (sources, onProgress = () => {}) {
  const docs = []
  const chunks = []
  for (const source of sources) {
    const pages = await extractPages(path.join(DATA_DIR, source.file))
    docs.push({ ...source, pages: pages.map(p => ({ pdfPage: p.pdfPage, printedPage: p.printedPage, text: p.lines.join('\n') })) })
    for (const page of pages) {
      for (const text of chunkPage(page)) {
        chunks.push({ id: chunks.length, doc: source.id, pdfPage: page.pdfPage, printedPage: page.printedPage, title: page.lines[0], text })
      }
    }
    onProgress({ stage: 'extracted', doc: source.id, pages: pages.length })
  }
  const started = Date.now()
  const vectors = []
  for (let i = 0; i < chunks.length; i += 64) {
    vectors.push(...await embedDocuments(chunks.slice(i, i + 64).map(c => c.text)))
    onProgress({ stage: 'embedded', done: Math.min(chunks.length, i + 64), total: chunks.length })
  }
  chunks.forEach((c, i) => { c.vector = encode(vectors[i]) })
  const built = {
    version: 1,
    builtAt: new Date().toISOString(),
    embedModel: MODELS.embed.registry,
    embedMs: Date.now() - started,
    docs,
    chunks
  }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(INDEX_FILE, JSON.stringify(built))
  index = null
  return built
}

export function loadIndex () {
  if (index) return index
  if (!fs.existsSync(INDEX_FILE)) throw new Error('No guideline index yet. Run "npm run setup" first.')
  const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
  for (const c of raw.chunks) c.vec = normalize(decode(c.vector))
  index = raw
  return index
}

export function pageText (docId, pdfPage) {
  const doc = loadIndex().docs.find(d => d.id === docId)
  return doc?.pages.find(p => p.pdfPage === pdfPage) || null
}

// Locate the printed page that contains a phrase, so fixed rules can cite the
// guideline instead of hard-coding page numbers.
export function findPhrase (phrase) {
  const needle = phrase.toLowerCase().replace(/\s+/g, ' ')
  for (const doc of loadIndex().docs) {
    for (const p of doc.pages) {
      if (/\.{6,}/.test(p.text)) continue // table of contents
      if (p.text.toLowerCase().replace(/\s+/g, ' ').includes(needle)) return { doc: doc.id, pdfPage: p.pdfPage, printedPage: p.printedPage }
    }
  }
  return null
}

// Training manuals mix guidance with practice material (exercises, role plays,
// blank recording forms, case studies) that asks questions instead of answering
// them. Those passages rank slightly lower so guidance wins close calls.
const PRACTICE = /^(exercise|role play|video|discuss|demonstration|part \d|child \d|sick child recording form|child.s name|referral note|for each child)/i
const PRACTICE_PENALTY = 0.05

// Top passages, at most two per page, so a page's dose table can sit next to
// the sentence that matched best.
export async function search (query, k) {
  const { chunks } = loadIndex()
  const q = normalize(await embedQuery(query))
  const scored = chunks.map(c => ({ c, score: dot(q, c.vec) - (PRACTICE.test(c.title) ? PRACTICE_PENALTY : 0) }))
  scored.sort((a, b) => b.score - a.score)
  const out = []
  const perPage = new Map()
  for (const { c, score } of scored) {
    const key = `${c.doc}:${c.pdfPage}`
    if ((perPage.get(key) || 0) >= 2) continue
    perPage.set(key, (perPage.get(key) || 0) + 1)
    out.push({ id: c.id, doc: c.doc, pdfPage: c.pdfPage, printedPage: c.printedPage, title: c.title, text: c.text, score })
    if (out.length === k) break
  }
  return out
}

function encode (vec) {
  return Buffer.from(new Float32Array(vec).buffer).toString('base64')
}

function decode (b64) {
  const buf = Buffer.from(b64, 'base64')
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
}

function normalize (v) {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n
  return out
}

function dot (a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
