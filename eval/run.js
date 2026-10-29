// Benchmark: Tabibu on the device (QVAC) against the same workflow on a cloud model.
//   npm run eval                       local only
//   npm run eval -- --backend=cloud    cloud only (needs ANTHROPIC_API_KEY)
//   npm run eval -- --backend=both
//   npm run eval -- --only=en-zinc-8m  one item
// Raw results go to eval/results/<backend>.json and the comparison to
// eval/results/summary.json, which the app's Evidence tab reads.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EVAL_DIR, MODELS } from '../src/config.js'
import { answer } from '../src/pipeline.js'
import { unloadAll } from '../src/qvac.js'
import { memorySnapshot } from '../src/memory.js'

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
const backends = (arg('backend') || 'local') === 'both' ? ['local', 'cloud'] : [arg('backend') || 'local']
const only = arg('only')
// --tag=light keeps a second on-device configuration's results separate.
const tag = arg('tag') ? `-${arg('tag')}` : ''
const RESULTS = path.join(EVAL_DIR, 'results')
fs.mkdirSync(RESULTS, { recursive: true })

const { items: allItems } = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'questions.json'), 'utf8'))
const items = only ? allItems.filter(i => i.id === only) : allItems

function grade (item, r) {
  const en = r.steps.map(s => s.text).join(' ')
  const detected = (r.danger.signs || []).map(s => s.id).filter(Boolean)
  const g = { referred: r.danger.refer, expectsDanger: Boolean(item.danger?.length) }
  if (item.kind === 'answer') {
    g.correct = r.covered && item.facts.every(f => new RegExp(f, 'i').test(en))
    g.citedRightPage = r.covered && r.steps.some(s => item.pages.includes(s.source.printedPage))
    if (/^sw-/.test(item.id)) g.deliveredInSwahili = r.covered && r.steps.every(s => s.textSw && s.textSw.trim())
  }
  if (item.kind === 'refuse') g.correct = !r.covered
  if (g.expectsDanger) {
    g.dangerCaught = r.danger.refer
    if (detected.length) g.exactSigns = item.danger.every(id => detected.includes(id))
  }
  if (item.kind === 'danger') g.correct = r.danger.refer
  return g
}

async function runBackend (backend) {
  const run = backend === 'cloud' ? (await import('./cloud.js')).cloudAnswer : answer
  const rows = []
  let peakMb = 0
  for (const item of items) {
    const started = Date.now()
    let r
    try {
      r = await run({ question: item.q })
    } catch (err) {
      console.log(`  ${item.id}: ERROR ${err.message}`)
      rows.push({ id: item.id, kind: item.kind, error: err.message })
      continue
    }
    const ms = Date.now() - started
    if (backend === 'local') peakMb = Math.max(peakMb, memorySnapshot().workerPeakMb || memorySnapshot().totalMb)
    const g = grade(item, r)
    rows.push({ id: item.id, kind: item.kind, ms, grade: g, result: r })
    console.log(`  ${item.id.padEnd(20)} ${g.correct ? 'ok  ' : 'MISS'} ${(ms / 1000).toFixed(1).padStart(5)} s${g.referred ? '  refer' : ''}${r.removed?.length ? `  removed ${r.removed.length}` : ''}`)
  }
  const out = {
    backend,
    model: backend === 'cloud' ? (await import('./cloud.js')).CLOUD_MODEL : `${MODELS.chat.registry} + EmbeddingGemma-300M + AfriqueGemma-4B via QVAC`,
    date: new Date().toISOString(),
    device: deviceInfo(),
    peakMb: backend === 'local' ? peakMb : null,
    rows
  }
  fs.writeFileSync(path.join(RESULTS, `${backend}${tag}.json`), JSON.stringify(out, null, 2))
  return out
}

function deviceInfo () {
  return `${os.cpus()[0]?.model?.trim() || 'CPU'} (${os.cpus().length} threads), ${Math.round(os.totalmem() / 1073741824)} GB RAM, ${os.platform()} ${os.release()}`
}

function pct (rows, pick) {
  const xs = rows.map(pick).filter(v => v !== undefined)
  if (!xs.length) return null
  return `${xs.filter(Boolean).length}/${xs.length}`
}

function quantile (xs, q) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

function metricsFor (run) {
  if (!run) return null
  const ok = run.rows.filter(r => !r.error)
  const by = kind => ok.filter(r => r.kind === kind)
  const proposed = ok.reduce((s, r) => s + r.result.steps.length + r.result.removed.length, 0)
  const removed = ok.reduce((s, r) => s + r.result.removed.length, 0)
  const ms = ok.map(r => r.ms)
  const bytes = ok.map(r => r.result.usage?.bytesSent ?? 0)
  const cost = ok.reduce((s, r) => s + (r.result.usage?.costUsd ?? 0), 0)
  return {
    answers: pct(by('answer'), r => r.grade.correct),
    pages: pct(by('answer'), r => r.grade.citedRightPage),
    swahili: pct(by('answer'), r => r.grade.deliveredInSwahili),
    dangerRecall: pct(ok, r => r.grade.expectsDanger ? r.grade.dangerCaught : undefined),
    exactSigns: run.backend === 'local' ? pct(ok, r => r.grade.expectsDanger ? Boolean(r.grade.exactSigns) : undefined) : null,
    falseReferrals: `${ok.filter(r => !r.grade.expectsDanger && r.grade.referred).length}/${ok.filter(r => !r.grade.expectsDanger).length}`,
    refusals: pct(by('refuse'), r => r.grade.correct),
    removed: `${removed} of ${proposed}`,
    p50: `${(quantile(ms, 0.5) / 1000).toFixed(1)} s`,
    p90: `${(quantile(ms, 0.9) / 1000).toFixed(1)} s`,
    kbSent: `${(bytes.reduce((a, b) => a + b, 0) / bytes.length / 1024).toFixed(1)} KB`,
    costPer1000: `$${(cost / ok.length * 1000).toFixed(2)}`,
    offline: run.backend === 'local' ? 'Yes' : 'No',
    memory: run.peakMb ? `${(run.peakMb / 1024).toFixed(1)} GB` : 'Not on device',
    errors: `${run.rows.length - ok.length}`
  }
}

function writeSummary () {
  const runs = Object.fromEntries(['local', 'cloud'].map(b => {
    const f = path.join(RESULTS, `${b}${b === 'local' ? tag : ''}.json`)
    return [b, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null]
  }))
  const m = { local: metricsFor(runs.local), cloud: metricsFor(runs.cloud) }
  const rows = [
    ['answers', 'Guideline answers with every expected fact'],
    ['pages', 'Answer cites the page that states it'],
    ['swahili', 'Kiswahili questions answered in Kiswahili'],
    ['dangerRecall', 'Danger signs that triggered urgent referral'],
    ['exactSigns', 'Exact danger sign named, with page'],
    ['falseReferrals', 'Referral raised with no danger sign'],
    ['refusals', 'Out-of-scope questions refused'],
    ['removed', 'Steps removed because a number was not on the cited page'],
    ['p50', 'Median time per question'],
    ['p90', '90th percentile time'],
    ['kbSent', 'Data sent off the device per question'],
    ['costPer1000', 'Cost per 1,000 questions'],
    ['memory', 'Peak memory on device'],
    ['offline', 'Works with the internet off'],
    ['errors', 'Errors']
  ]
  const summary = {
    summary: m.cloud
      ? 'The same questions, guideline excerpts and verification, run once on the device through QVAC and once through a cloud model.'
      : 'On-device results through QVAC. The cloud column fills in after running npm run eval -- --backend=cloud with an API key on this machine.',
    method: `${items.length === allItems.length ? allItems.length : items.length} questions from eval/questions.json (22 guideline answers, 10 danger-sign cases, 8 out-of-scope), written by the developer before the first run.`,
    device: runs.local?.device || runs.cloud?.device || deviceInfo(),
    date: (runs.local?.date || runs.cloud?.date || new Date().toISOString()).slice(0, 10),
    backends: ['local', 'cloud'],
    backendLabels: { local: 'Tabibu on device (QVAC)', cloud: `Cloud (${runs.cloud?.model || 'claude-sonnet-5-5'})` },
    metrics: rows.map(([key, label]) => ({ key, label, values: { local: m.local?.[key] ?? null, cloud: m.cloud?.[key] ?? null } }))
  }
  fs.writeFileSync(path.join(RESULTS, `summary${tag}.json`), JSON.stringify(summary, null, 2))
  console.log('\n' + summary.metrics.map(x => `${x.label.padEnd(58)} ${String(x.values.local ?? '—').padStart(14)} ${String(x.values.cloud ?? '—').padStart(14)}`).join('\n'))
}

for (const b of backends) {
  console.log(`\n${b}: ${items.length} questions`)
  await runBackend(b)
}
writeSummary()
await unloadAll()
process.exit(0)
