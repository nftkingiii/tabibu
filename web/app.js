const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const STAGES = {
  translate_in: { en: 'Translating question to English', sw: 'Kutafsiri swali' },
  screen: { en: 'Checking danger signs', sw: 'Kuangalia dalili za hatari' },
  search: { en: 'Searching the manual', sw: 'Kutafuta kwenye mwongozo' },
  generate: { en: 'Writing a grounded answer', sw: 'Kuandika jibu' },
  verify: { en: 'Checking every number against its page', sw: 'Kuhakiki namba na ukurasa' },
  translate_out: { en: 'Translating answer to Kiswahili', sw: 'Kutafsiri jibu kwa Kiswahili' }
}

const UI = {
  en: { steps: 'What the guideline says', refer: 'Danger sign found', removed: 'Removed by verification', sources: 'Pages searched', asked: 'Understood as' },
  sw: { steps: 'Mwongozo unasema', refer: 'Dalili ya hatari imeonekana', removed: 'Imeondolewa baada ya uhakiki', sources: 'Kurasa zilizotafutwa', asked: 'Swali kwa Kiingereza' }
}

/* Tabs */
const tabs = [...document.querySelectorAll('[role="tab"]')]
const loaders = { library: loadLibrary, evidence: loadEvidence, device: loadDevice }
function selectTab (tab) {
  for (const t of tabs) {
    const on = t === tab
    t.setAttribute('aria-selected', on)
    t.tabIndex = on ? 0 : -1
    document.getElementById(t.dataset.tab).hidden = !on
  }
  loaders[tab.dataset.tab]?.()
  history.replaceState(null, '', `#${tab.dataset.tab}`)
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t))
  t.addEventListener('keydown', e => {
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    if (!d) return
    e.preventDefault()
    const next = tabs[(i + d + tabs.length) % tabs.length]
    next.focus()
    selectTab(next)
  })
})
const initial = tabs.find(t => `#${t.dataset.tab}` === location.hash)
if (initial) selectTab(initial)

/* Connection check */
async function checkNet () {
  const chip = $('#net-chip')
  chip.dataset.state = 'checking'
  $('#net-text').textContent = 'Checking…'
  try {
    const s = await (await fetch('/api/status?check=1')).json()
    chip.dataset.state = s.internet ? 'online' : 'offline'
    $('#net-text').textContent = s.internet ? 'Internet is on' : 'No internet · running offline'
  } catch {
    chip.dataset.state = ''
    $('#net-text').textContent = 'Tabibu server not reachable'
  }
}
$('#net-chip').addEventListener('click', checkNet)
checkNet()

/* Ask */
const form = $('#ask-form')
const q = $('#question')
q.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    form.requestSubmit()
  }
})
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
  q.value = c.textContent
  form.requestSubmit()
}))

form.addEventListener('submit', async e => {
  e.preventDefault()
  const question = q.value.trim()
  if (!question) return
  const lang = new FormData(form).get('lang')
  const btn = $('#ask-btn')
  btn.disabled = true
  btn.textContent = 'Working…'
  $('#examples').hidden = true
  $('#result').innerHTML = ''
  const progress = $('#progress')
  progress.innerHTML = ''
  progress.hidden = false
  let current = null
  let started = performance.now()
  const uiLang = lang === 'sw' || (lang === 'auto' && /\b(mtoto|ana|nini|gani|homa|kwa|wangu)\b/i.test(question)) ? 'sw' : 'en'

  const mark = stage => {
    const now = performance.now()
    if (current) {
      current.classList.replace('active', 'done')
      current.querySelector('.ms').textContent = `${((now - started) / 1000).toFixed(1)} s`
    }
    started = now
    if (!stage) return
    current = document.createElement('li')
    current.className = 'active'
    current.innerHTML = `<span>${esc(STAGES[stage]?.[uiLang] || stage)}</span><span class="ms"></span>`
    progress.append(current)
  }

  try {
    const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, lang }) })
    if (!res.ok) throw new Error((await res.json()).error || res.statusText)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        if (msg.type === 'stage') mark(msg.stage)
        else if (msg.type === 'draft') render(msg.result, { pendingSw: true })
        else if (msg.type === 'result') { mark(null); render(msg.result, { memory: msg.memory }) }
        else if (msg.type === 'error') throw new Error(msg.error)
      }
    }
  } catch (err) {
    mark(null)
    $('#result').innerHTML = `<div class="card notcovered"><p>${esc(err.message)}</p></div>`
  } finally {
    btn.disabled = false
    btn.textContent = 'Ask'
  }
})

function citeButton (src) {
  return `<button type="button" class="cite" data-doc="${esc(src.doc)}" data-pdf="${src.pdfPage}">${esc(src.label)}</button>`
}

function render (r, { pendingSw = false, memory = null } = {}) {
  const sw = r.language === 'sw'
  const t = UI[r.language]
  const parts = []
  if (sw) parts.push(`<p class="qline">${t.asked}: “${esc(r.questionEn)}”</p>`)

  if (r.danger.refer) {
    parts.push(`<div class="card refer" role="alert">
      <h3>${esc(t.refer)}. ${esc(r.message)}</h3>
      <ul>${r.danger.signs.map(s => `<li>${esc(sw ? s.labelSw : s.label)}${s.source ? citeButton({ doc: s.source.doc, pdfPage: s.source.pdfPage, label: `p. ${s.source.printedPage}` }) : ''}</li>`).join('')}</ul>
    </div>`)
  }

  if (r.covered) {
    parts.push(`<div class="card">
      <h3>${esc(t.steps)}</h3>
      <ol class="steps">${r.steps.map(s => {
        const main = sw ? (s.textSw ? esc(s.textSw) : `<span class="pending">${esc(s.text)}</span>`) : esc(s.text)
        const en = sw && s.textSw ? `<span class="en">${esc(s.text)}</span>` : ''
        return `<li>${main}${citeButton(s.source)}${en}</li>`
      }).join('')}</ol>
      ${pendingSw ? '<p class="pending">Kutafsiri kwa Kiswahili…</p>' : ''}
    </div>`)
  } else if (!r.danger.refer) {
    parts.push(`<div class="card notcovered"><p>${esc(r.message)}</p></div>`)
  }

  if (r.removed?.length) {
    parts.push(`<details><summary>${esc(t.removed)} (${r.removed.length})</summary><ul>${r.removed.map(x => `<li>${esc(x.text)} <span class="muted">(${esc(x.why)})</span></li>`).join('')}</ul></details>`)
  }

  parts.push(`<details><summary>${esc(t.sources)}</summary><ul>${r.sources.map(s => `<li>${citeButton(s)} <span class="muted num">match ${s.score.toFixed(2)}</span> ${esc(s.title)}</li>`).join('')}</ul></details>`)

  if (r.timings?.total) {
    parts.push(`<div class="meta"><span class="num">${(r.timings.total / 1000).toFixed(1)} s on this device</span>${memory ? `<span class="num">${memory.totalMb} MB in use</span>` : ''}<span>Models: QVAC · Qwen3-4B · EmbeddingGemma · AfriqueGemma-4B</span></div>`)
  }
  $('#result').innerHTML = parts.join('')
}

/* Page viewer for citations */
document.addEventListener('click', async e => {
  const b = e.target.closest('.cite, .page-open')
  if (!b) return
  const page = await (await fetch(`/api/page?doc=${encodeURIComponent(b.dataset.doc)}&pdf=${b.dataset.pdf}`)).json()
  $('#page-title').textContent = page.printedPage ? `Manual page ${page.printedPage}` : `PDF page ${page.pdfPage}`
  $('#page-text').innerHTML = esc(page.text).replace(/(\d+(?:\/\d+)?|½)/g, '<mark>$1</mark>')
  $('#page-dialog').showModal()
})
$('#page-close').addEventListener('click', () => $('#page-dialog').close())

/* Guidelines */
let libraryLoaded = false
async function loadLibrary () {
  if (libraryLoaded) return
  const lib = await (await fetch('/api/library')).json()
  libraryLoaded = true
  const doc = lib.docs[0]
  $('#library-body').innerHTML = `
    <div class="stack">
      <div class="card">
        <h3>${esc(doc.title)}</h3>
        <p class="muted">${esc(doc.publisher)} · ${doc.pages.length} pages · downloaded from WHO during setup and stored only on this device · <a href="${esc(doc.landing)}">publisher page</a></p>
      </div>
      <h3>Danger signs Tabibu always checks</h3>
      <p class="muted">These rules run before the language model and do not depend on it. Each cites the manual.</p>
      <div class="table-wrap"><table><thead><tr><th>Sign</th><th>Ishara</th><th>Source</th></tr></thead><tbody>
        ${lib.dangerRules.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.labelSw)}</td><td>${r.source ? `<button type="button" class="cite" data-doc="${esc(r.source.doc)}" data-pdf="${r.source.pdfPage}">p. ${r.source.printedPage}</button>` : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <h3>Browse pages</h3>
      <input class="filter" id="page-filter" type="search" placeholder="Filter by heading" aria-label="Filter pages by heading">
      <div class="pages" id="page-list"></div>
    </div>`
  const list = $('#page-list')
  const draw = f => {
    list.innerHTML = doc.pages.filter(p => p.title.toLowerCase().includes(f)).map(p =>
      `<button type="button" class="page-open" data-doc="${esc(doc.id)}" data-pdf="${p.pdfPage}"><b>${p.printedPage ?? `pdf ${p.pdfPage}`}</b>${esc(p.title)}</button>`).join('')
  }
  draw('')
  $('#page-filter').addEventListener('input', e => draw(e.target.value.toLowerCase()))
}

/* Evidence */
async function loadEvidence () {
  const ev = await (await fetch('/api/evidence')).json()
  if (!ev.available) {
    $('#evidence-body').innerHTML = '<p class="muted">No benchmark results on this device yet. Run <code>npm run eval</code>.</p>'
    return
  }
  const rows = ev.metrics.map(m => {
    const cells = ev.backends.map(b => {
      const v = m.values[b]
      const cls = m.better && m.better === b ? 'better' : ''
      return `<td class="num ${cls}">${v == null ? '—' : esc(v)}</td>`
    }).join('')
    return `<tr><td>${esc(m.label)}</td>${cells}</tr>`
  }).join('')
  $('#evidence-body').innerHTML = `
    <div class="stack">
      <p class="lede">${esc(ev.summary)}</p>
      <div class="table-wrap"><table><thead><tr><th>Measure</th>${ev.backends.map(b => `<th class="num">${esc(ev.backendLabels[b])}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted">${esc(ev.method)} Run on ${esc(ev.device)} on ${esc(ev.date)}. Raw results: <code>eval/results/</code>.</p>
    </div>`
}

/* Device */
async function loadDevice () {
  const s = await (await fetch('/api/status')).json()
  const models = Object.values(s.models).map(m => `<tr>
      <td>${esc(m.role)}</td><td><code>${esc(m.registry)}</code></td>
      <td>${m.present ? 'On device' : '<span class="worse">Missing</span>'}</td>
      <td class="num">${m.loaded ? `${(m.loaded.loadMs / 1000).toFixed(1)} s` : '—'}</td>
      <td>${esc(m.license)}</td></tr>`).join('')
  $('#device-body').innerHTML = `
    <div class="stack">
      <div class="table-wrap"><table><thead><tr><th>Job</th><th>QVAC registry model</th><th>File</th><th class="num">Load</th><th>Licence</th></tr></thead><tbody>${models}</tbody></table></div>
      <div class="card">
        <p><b>Memory now:</b> <span class="num">${s.memory.totalMb} MB</span> (QVAC worker ${s.memory.workerMb} MB${s.memory.workerPeakMb ? `, peak ${s.memory.workerPeakMb} MB` : ''}; app ${s.memory.nodeMb} MB)</p>
        <p><b>Models:</b> ${s.warm.state === 'ready' ? `loaded in ${(s.warm.ms / 1000).toFixed(0)} s` : esc(s.warm.state)}${s.warm.error ? ` · ${esc(s.warm.error)}` : ''}</p>
        <p><b>Guideline index:</b> ${s.index ? `${s.index.chunks} passages, built ${esc(new Date(s.index.builtAt).toLocaleString())}` : 'missing — run npm run setup'}</p>
        <p><b>Refuses below match score:</b> <span class="num">${s.retrieval.minScore}</span></p>
      </div>
    </div>`
}
