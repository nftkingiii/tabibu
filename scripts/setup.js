// One-time online setup. After this, Tabibu needs no network.
//   1. Download the three QVAC registry models and verify each file against the
//      sha256 pinned in @qvac/sdk.
//   2. Download the WHO/UNICEF manual from WHO.
//   3. Extract, chunk and embed it with QVAC into data/index.json.
// Flags: --skip-models, --skip-index, --registry (use the QVAC P2P registry
// through loadModel instead of HTTPS; slower on some networks).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as sdk from '@qvac/sdk'
import { MODELS, MODELS_DIR, DATA_DIR, SOURCES } from '../src/config.js'
import { buildIndex } from '../src/store.js'
import { unloadAll } from '../src/qvac.js'

const args = new Set(process.argv.slice(2))
fs.mkdirSync(MODELS_DIR, { recursive: true })
fs.mkdirSync(DATA_DIR, { recursive: true })

async function sha256 (file) {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

async function download (url, dest, expectedSize) {
  const tmp = `${dest}.part`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length')) || expectedSize || 0
  let done = 0
  let last = 0
  const body = Readable.fromWeb(res.body)
  body.on('data', chunk => {
    done += chunk.length
    if (total && Date.now() - last > 2000) {
      last = Date.now()
      process.stdout.write(`    ${(done / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB\n`)
    }
  })
  await pipeline(body, fs.createWriteStream(tmp))
  fs.renameSync(tmp, dest)
}

async function fetchModel (key) {
  const m = MODELS[key]
  const pinned = sdk[m.registry]
  const dest = path.join(MODELS_DIR, m.file)
  if (fs.existsSync(dest) && fs.statSync(dest).size === pinned.expectedSize) {
    console.log(`  ${m.registry}: already present`)
  } else if (args.has('--registry')) {
    console.log(`  ${m.registry}: downloading through the QVAC registry`)
    const id = await sdk.loadModel({ modelSrc: pinned, onProgress: p => process.stdout.write(`    ${p.percentage.toFixed(0)}%\r`) })
    await sdk.unloadModel({ modelId: id, clearStorage: false })
    console.log(`\n  ${m.registry}: cached by QVAC. Copy it to ${dest} or set TABIBU_MODELS_DIR.`)
    return
  } else {
    console.log(`  ${m.registry}: downloading ${(pinned.expectedSize / 1e9).toFixed(2)} GB`)
    await download(m.url, dest, pinned.expectedSize)
  }
  const digest = await sha256(dest)
  if (digest !== pinned.sha256Checksum) {
    fs.renameSync(dest, `${dest}.bad`)
    throw new Error(`${m.file}: sha256 ${digest} does not match the QVAC registry (${pinned.sha256Checksum})`)
  }
  console.log(`  ${m.registry}: sha256 matches the QVAC registry`)
}

console.log('Tabibu setup (needs internet once)\n')
if (!args.has('--skip-models')) {
  console.log('Models')
  for (const key of Object.keys(MODELS)) await fetchModel(key)
}

console.log('\nGuidelines')
for (const s of SOURCES) {
  const dest = path.join(DATA_DIR, s.file)
  if (fs.existsSync(dest)) {
    console.log(`  ${s.id}: already present`)
  } else {
    console.log(`  ${s.id}: downloading from ${new URL(s.url).host}`)
    await download(s.url, dest)
  }
}

if (!args.has('--skip-index')) {
  console.log('\nIndex')
  const built = await buildIndex(SOURCES, p => {
    if (p.stage === 'extracted') console.log(`  ${p.doc}: ${p.pages} pages extracted`)
    if (p.stage === 'embedded') console.log(`  embedded ${p.done}/${p.total} chunks`)
  })
  console.log(`  index ready: ${built.chunks.length} chunks in ${(built.embedMs / 1000).toFixed(0)} s`)
  await unloadAll()
}

console.log('\nDone. You can now switch off the internet and run: npm start')
process.exit(0)
