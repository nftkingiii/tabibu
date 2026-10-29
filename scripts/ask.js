// Ask Tabibu from the terminal: npm run ask -- "Mtoto ana homa kwa siku tatu"
import { answer } from '../src/pipeline.js'
import { unloadAll } from '../src/qvac.js'

const args = process.argv.slice(2)
const langFlag = args.find(a => a.startsWith('--lang='))
const question = args.filter(a => !a.startsWith('--')).join(' ')
if (!question) {
  console.log('Usage: npm run ask -- "your question" [--lang=en|sw]')
  process.exit(1)
}

const r = await answer({ question, lang: langFlag ? langFlag.split('=')[1] : 'auto' }, stage => process.stderr.write(`· ${stage}\n`))
const sw = r.language === 'sw'

console.log()
if (sw) console.log(`Question (English): ${r.questionEn}\n`)
if (r.danger.refer) {
  console.log(`!! ${r.message}`)
  for (const s of r.danger.signs) console.log(`   - ${sw ? s.labelSw : s.label} (${s.source ? `p. ${s.source.printedPage}` : 'manual'})`)
  console.log()
}
if (r.covered) {
  r.steps.forEach((s, i) => console.log(`${i + 1}. ${sw ? s.textSw : s.text}  [${s.source.label}]`))
} else if (!r.danger.refer) {
  console.log(r.message)
}
if (r.removed.length) {
  console.log('\nRemoved by verification:')
  for (const x of r.removed) console.log(`   - ${x.text} (${x.why})`)
}
console.log(`\n${(r.timings.total / 1000).toFixed(1)} s on this device, no network used`)
await unloadAll()
process.exit(0)
