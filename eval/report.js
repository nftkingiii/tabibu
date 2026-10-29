// Writes eval/results/summary.json into the Results section of README.md, so the
// README always shows the measured numbers and nothing typed by hand.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, EVAL_DIR } from '../src/config.js'

const summary = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'results', 'summary.json'), 'utf8'))
const light = path.join(EVAL_DIR, 'results', 'summary-light.json')
const lightSummary = fs.existsSync(light) ? JSON.parse(fs.readFileSync(light, 'utf8')) : null

const run1File = path.join(EVAL_DIR, 'results', 'summary-run1.json')
const run1 = fs.existsSync(run1File) ? JSON.parse(fs.readFileSync(run1File, 'utf8')) : null

const cols = []
if (run1) cols.push(['run1', 'On device, run 1 (before fixes)'])
cols.push(['local', run1 ? 'On device, run 2 (Qwen3-4B)' : summary.backendLabels.local])
if (lightSummary) cols.push(['light', 'Light option on device (Qwen3.5-2B)'])
cols.push(['cloud', summary.backendLabels.cloud])

const value = (key, col) => {
  if (col === 'light') return lightSummary.metrics.find(m => m.key === key)?.values.local ?? '—'
  if (col === 'run1') return run1.metrics.find(m => m.key === key)?.values.local ?? '—'
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
  `${summary.method} Measured on ${summary.device}, ${summary.date}, inside a Linux network namespace with no network interface. Raw per-question results are in \`eval/results/\`. A dash means not measured.`,
  '',
  run1 ? 'Run 1 exposed two problems: the model sometimes quoted the dose row for the wrong age (the age check removed those rows, leaving the answer without a dose), and one phrasing of swollen feet was missed. Between runs, Tabibu began quoting the right-age row from the same page, the swollen-feet rule was widened, and the refusal threshold was set from run 1\'s score gap. These fixes were made after seeing run 1 on the same questions, so run 2 may overstate performance on new questions.' : ''
].join('\n')

const readme = path.join(ROOT, 'README.md')
const text = fs.readFileSync(readme, 'utf8')
const out = text.replace(/<!-- results:start -->[\s\S]*<!-- results:end -->/, `<!-- results:start -->\n${block}\n<!-- results:end -->`)
fs.writeFileSync(readme, out)
console.log(block)
