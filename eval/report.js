// Writes eval/results/summary.json into the Results section of README.md, so the
// README always shows the measured numbers and nothing typed by hand.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, EVAL_DIR } from '../src/config.js'

const summary = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'results', 'summary.json'), 'utf8'))
const light = path.join(EVAL_DIR, 'results', 'summary-light.json')
const lightSummary = fs.existsSync(light) ? JSON.parse(fs.readFileSync(light, 'utf8')) : null

const cols = [['local', summary.backendLabels.local]]
if (lightSummary) cols.push(['light', 'Light option on device (Qwen3.5-2B)'])
cols.push(['cloud', summary.backendLabels.cloud])

const value = (key, col) => {
  if (col === 'light') return lightSummary.metrics.find(m => m.key === key)?.values.local ?? '—'
  return summary.metrics.find(m => m.key === key)?.values[col] ?? '—'
}

const lines = [
  `| Measure | ${cols.map(c => c[1]).join(' | ')} |`,
  `|---|${cols.map(() => '---:').join('|')}|`,
  ...summary.metrics.map(m => `| ${m.label} | ${cols.map(([c]) => value(m.key, c) ?? '—').join(' | ')} |`)
]

const block = [
  summary.summary,
  '',
  ...lines,
  '',
  `${summary.method} Measured on ${summary.device}, ${summary.date}. Raw per-question results are in \`eval/results/\`. A dash means not measured.`
].join('\n')

const readme = path.join(ROOT, 'README.md')
const text = fs.readFileSync(readme, 'utf8')
const out = text.replace(/<!-- results:start -->[\s\S]*<!-- results:end -->/, `<!-- results:start -->\n${block}\n<!-- results:end -->`)
fs.writeFileSync(readme, out)
console.log(block)
