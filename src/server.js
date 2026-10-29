// Local web server for Tabibu. Binds to 127.0.0.1 by default; set HOST=0.0.0.0
// to reach it from a phone on the same Wi-Fi (or hotspot).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns/promises'
import { ROOT, PORT, MODELS, EVAL_DIR, RETRIEVAL } from './config.js'
import { answer } from './pipeline.js'
import { loadIndex, pageText } from './store.js'
import { ensure, loadedModels, modelsPresent, unloadAll } from './qvac.js'
import { memorySnapshot } from './memory.js'
import { DANGER_RULES } from './danger.js'
import { findPhrase } from './store.js'

const HOST = process.env.HOST || '127.0.0.1'
const WEB = path.join(ROOT, 'web')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' }

let queue = Promise.resolve()
let warm = { state: 'idle' }

function json (res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody (req, limit = 4096) {
  let size = 0
  const parts = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('Question too long'), { status: 413 })
    parts.push(chunk)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')
}

// Resolving a public name only succeeds with a working internet connection.
// The demo uses this to show the device is offline; the answer path never calls it.
async function internetReachable () {
  try {
    await Promise.race([dns.lookup('example.com'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))])
    return true
  } catch {
    return false
  }
}

const routes = {
  'GET /api/status': async (req, res, url) => {
    let index = null
    try {
      const i = loadIndex()
      index = { chunks: i.chunks.length, builtAt: i.builtAt, docs: i.docs.map(d => ({ id: d.id, title: d.title, pages: d.pages.length })) }
    } catch {}
    json(res, 200, {
      models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { registry: m.registry, file: m.file, role: m.role, license: m.license, present: modelsPresent()[k], loaded: loadedModels()[k] || null }])),
      warm,
      index,
      memory: memorySnapshot(),
      retrieval: RETRIEVAL,
      internet: url.searchParams.get('check') === '1' ? await internetReachable() : null
    })
  },

  'GET /api/library': async (req, res) => {
    const i = loadIndex()
    json(res, 200, {
      docs: i.docs.map(d => ({
        id: d.id, title: d.title, publisher: d.publisher, landing: d.landing,
        pages: d.pages.map(p => ({ pdfPage: p.pdfPage, printedPage: p.printedPage, title: p.text.split('\n')[0].slice(0, 90) }))
      })),
      dangerRules: DANGER_RULES.map(r => ({ ...r, source: findPhrase(r.anchor) }))
    })
  },

  'GET /api/page': async (req, res, url) => {
    const pdf = Number(url.searchParams.get('pdf'))
    const page = Number.isInteger(pdf) ? pageText(String(url.searchParams.get('doc')), pdf) : null
    if (!page) return json(res, 404, { error: 'Page not found' })
    json(res, 200, page)
  },

  'GET /api/evidence': async (req, res) => {
    const file = path.join(EVAL_DIR, 'results', 'summary.json')
    if (!fs.existsSync(file)) return json(res, 200, { available: false })
    const ev = JSON.parse(fs.readFileSync(file, 'utf8'))
    // Show the light on-device configuration as a column next to the default.
    const lightFile = path.join(EVAL_DIR, 'results', 'summary-light.json')
    if (fs.existsSync(lightFile)) {
      const light = JSON.parse(fs.readFileSync(lightFile, 'utf8'))
      ev.backends = ['local', 'light', 'cloud']
      ev.backendLabels.light = 'Light option on device (Qwen3.5-2B)'
      for (const m of ev.metrics) m.values.light = light.metrics.find(x => x.key === m.key)?.values.local ?? null
    }
    json(res, 200, { available: true, ...ev })
  },

  'POST /api/ask': async (req, res) => {
    const body = await readBody(req)
    const question = String(body.question || '').trim()
    const lang = ['auto', 'en', 'sw'].includes(body.lang) ? body.lang : 'auto'
    if (!question) return json(res, 400, { error: 'Type a question first.' })
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' })
    const send = obj => res.write(JSON.stringify(obj) + '\n')
    send({ type: 'queued' })
    const job = queue.then(async () => {
      try {
        const result = await answer({ question, lang }, (stage, data) => {
          if (stage === 'draft') send({ type: 'draft', result: data })
          else send({ type: 'stage', stage })
        })
        send({ type: 'result', result, memory: memorySnapshot() })
      } catch (err) {
        send({ type: 'error', error: err.message })
      } finally {
        res.end()
      }
    })
    queue = job.catch(() => {})
    await job
  }
}

async function serveStatic (req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
  const file = path.resolve(WEB, rel)
  if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end('Not found')
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const route = routes[`${req.method} ${url.pathname}`]
  try {
    if (route) await route(req, res, url)
    else if (req.method === 'GET') await serveStatic(req, res, url)
    else json(res, 405, { error: 'Method not allowed' })
  } catch (err) {
    if (!res.headersSent) json(res, err.status || 500, { error: err.message })
    else res.end()
  }
})

// Load the models in the background so the first question is fast.
async function warmUp () {
  warm = { state: 'loading', started: Date.now() }
  try {
    loadIndex()
    // TABIBU_WARM=embed,chat skips preloading the 3 GB translator on small
    // devices; it then loads on the first Kiswahili question.
    for (const key of (process.env.TABIBU_WARM || 'embed,chat,translate').split(',')) {
      warm.current = key
      await ensure(key)
    }
    warm = { state: 'ready', ms: Date.now() - warm.started }
  } catch (err) {
    warm = { state: 'error', error: err.message }
  }
}

server.listen(PORT, HOST, () => {
  console.log(`Tabibu is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  warmUp()
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    server.close()
    await unloadAll().catch(() => {})
    process.exit(0)
  })
}
