// Records the Tabibu demo from the real app. Runs inside `unshare -n` together
// with the Tabibu server, so the browser and the app have no network either.
// Writes out/raw.webm plus out/marks.json (segments to keep, in seconds).
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, 'out')
const APP = 'http://127.0.0.1:4317'
const proof = JSON.parse(fs.readFileSync(path.join(__dirname, 'proof.json'), 'utf8'))
// Optional voice-over: VO_TIMINGS points at a timings.json of { timings: { id: seconds } }.
// Each scene then holds at least as long as its narration line, and the time
// each line starts is logged so the audio can be placed on the final cut.
const VO = process.env.VO_TIMINGS ? JSON.parse(fs.readFileSync(process.env.VO_TIMINGS, 'utf8')).timings : {}
const voMs = id => (VO[id] ? VO[id] * 1000 + 700 : 0)
const W = 1440
const H = 900

;(async () => {
  for (let i = 0; i < 300; i++) {
    try {
      const s = await (await fetch(`${APP}/api/status`)).json()
      if (s.warm.state === 'ready') break
      if (s.warm.state === 'error') throw new Error(s.warm.error)
    } catch (e) { if (i === 299) throw e }
    await new Promise(r => setTimeout(r, 1000))
  }

  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: 'light' })
  const page = await ctx.newPage()
  const t0 = Date.now()
  const now = () => (Date.now() - t0) / 1000
  const cuts = []
  const wait = ms => page.waitForTimeout(ms)
  const voCues = []
  const cue = id => voCues.push({ id, t: now() })
  const hold = (id, ms) => wait(Math.max(ms, voMs(id)))

  // Frame grabber: still JPEGs of the real page at about 10 fps. It pauses
  // while the models run, so recording takes no CPU away from QVAC.
  const FRAMES = path.join(OUT, 'frames')
  fs.mkdirSync(FRAMES, { recursive: true })
  const frames = []
  let grabbing = true
  let stop = false
  const grabber = (async () => {
    while (!stop) {
      if (grabbing) {
        const t = now()
        const file = path.join(FRAMES, String(frames.length).padStart(5, '0') + '.jpg')
        try { await page.screenshot({ path: file, type: 'jpeg', quality: 85 }); frames.push({ file, t }) } catch {}
      }
      await new Promise(r => setTimeout(r, 70))
    }
  })()

  async function caption (text, sub = '') {
    await page.evaluate(([text, sub]) => {
      let el = document.getElementById('__cap')
      if (!el) {
        el = document.createElement('div')
        el.id = '__cap'
        el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1100px;width:calc(100% - 120px);z-index:99999;background:rgba(24,22,19,.92);color:#fff;border-radius:14px;padding:16px 24px;font:500 22px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:none'
      }
      // Room below the content so answers can scroll clear of the caption.
      document.querySelector('main') && (document.querySelector('main').style.paddingBottom = '260px')
      // An open <dialog> sits in the top layer, so the caption must live inside it.
      ;(document.querySelector('dialog[open]') || document.body).appendChild(el)
      el.innerHTML = ''
      const a = document.createElement('div'); a.textContent = text; el.appendChild(a)
      if (sub) { const b = document.createElement('div'); b.textContent = sub; b.style.cssText = 'font-size:16px;opacity:.75;margin-top:4px'; el.appendChild(b) }
      el.style.display = text ? 'block' : 'none'
    }, [text, sub])
  }

  // Ask a question and cut the waiting from the final video, leaving a caption
  // that says how long it really took.
  async function ask (question, lang, voId) {
    if (lang) await page.check(`input[name="lang"][value="${lang}"]`, { force: true })
    await page.fill('#question', question)
    // Let the narration finish before the wait is cut (4.5 s of stages follow).
    await wait(Math.max(1200, voMs(voId) - 4500))
    await page.click('#ask-btn')
    const started = Date.now()
    await wait(4500) // show the stage list starting
    const cutFrom = now()
    grabbing = false
    await page.waitForSelector('#ask-btn:not([disabled])', { timeout: 600000 })
    const secs = Math.round((Date.now() - started) / 1000)
    cuts.push([cutFrom, now()])
    grabbing = true
    return secs
  }

  // 1. Proof the machine is offline: real output captured inside the same sandbox.
  await page.setContent(`<html><body style="margin:0;background:#16140f;color:#e9e4d8;font:20px/1.6 ui-monospace,Menlo,Consolas,monospace;padding:70px 90px">
    <div style="color:#9c9585;margin-bottom:24px">Same sandbox as the app, captured ${proof.when}</div>
    ${proof.lines.map(l => `<div style="white-space:pre-wrap;${l.cmd ? 'color:#7cc0a2;margin-top:18px' : ''}">${l.cmd ? '$ ' : ''}${l.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('')}
  </body></html>`)
  await caption('This machine has no network. Only the loopback interface exists, and reaching example.com fails.', 'Tabibu, its QVAC models and this browser all run inside it.')
  cue('proof')
  await hold('proof', 8000)

  // 2. The app, offline.
  await page.goto(APP)
  await wait(1500)
  await caption('Tabibu opens from this device. The connection check confirms: no internet.')
  cue('open')
  await page.click('#net-chip')
  await hold('open', 4500)

  // 3. Kiswahili question.
  await caption('A community health promoter asks in Kiswahili: "My 3-year-old has a cough and fast breathing. Which medicine?"')
  cue('ask_sw')
  const s1 = await ask('Mtoto wangu wa miaka 3 ana kikohozi na anapumua haraka. Nimpe dawa gani?', 'auto', 'ask_sw')
  await caption(`Answered in Kiswahili, every step citing its page. Took ${s1} s on this 4-thread CPU; the wait is cut.`, 'QVAC models: AfriqueGemma-4B translates, EmbeddingGemma searches, Qwen3-4B answers.')
  await page.evaluate(() => document.querySelector('.qline, .card')?.scrollIntoView({ block: 'start' }))
  cue('answer_sw')
  await hold('answer_sw', 9000)

  // 4. Open a citation.
  await page.click('.steps .cite')
  await page.waitForSelector('dialog[open]')
  await wait(300)
  await caption('Every citation opens the manual page it came from. Numbers on the page are highlighted.', 'A step whose numbers are not on its page, or whose dose row is for another age, is removed.')
  cue('cite')
  await hold('cite', 8000)
  await page.click('#page-close')
  await wait(800)

  // 5. Danger signs.
  await page.evaluate(() => window.scrollTo(0, 0))
  await caption('Danger signs are checked by fixed rules from the manual, not by the model.')
  cue('danger_ask')
  const s2 = await ask('A 2 year old has had fever for 8 days and now has convulsions.', 'en', 'danger_ask')
  await caption(`Urgent referral, citing the manual's danger-sign page. Took ${s2} s; the wait is cut.`)
  await page.evaluate(() => document.querySelector('.refer')?.scrollIntoView({ block: 'start' }))
  cue('danger_result')
  await hold('danger_result', 8000)

  // 6. Refusal.
  await page.evaluate(() => window.scrollTo(0, 0))
  await caption('Questions outside the loaded guideline are refused, not guessed.')
  cue('refuse')
  await page.fill('#question', 'How do I treat high blood pressure in an adult?')
  await wait(1200)
  await page.click('#ask-btn')
  await page.waitForSelector('#ask-btn:not([disabled])', { timeout: 300000 })
  await page.evaluate(() => document.querySelector('.notcovered')?.scrollIntoView({ block: 'center' }))
  await wait(5000)

  // 7. Evidence.
  await page.click('#tab-evidence')
  const ev = await (await fetch(`${APP}/api/evidence`)).json()
  const hasCloud = ev.metrics?.some(m => m.values.cloud)
  await caption(hasCloud ? 'Cloud to Pocket: the same 40 questions on the device and in the cloud.' : 'Measured on 40 questions, run with no network: accuracy, referrals, refusals, speed and memory.',
    hasCloud ? 'Accuracy, referrals, refusals, speed, data sent, cost and memory, from eval/results.' : 'The cloud comparison column is filled by a separate run with an API key.')
  cue('evidence')
  await hold('evidence', 11000)

  // 8. Device.
  await page.click('#tab-device')
  await caption('Three QVAC registry models, loaded from local files, and the memory they use.')
  cue('device')
  await hold('device', 8000)

  await caption('Tabibu. Guideline answers that never leave the device.', 'github.com/nftkingiii/tabibu · QVAC SDK 0.22.0')
  cue('end')
  await hold('end', 4500)

  stop = true
  await grabber
  await ctx.close()
  await browser.close()
  fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify({ total: now(), cuts, s1, s2, frames, voCues }, null, 2))
  console.log('recorded', JSON.stringify({ total: now(), cuts }))
})().catch(e => { console.error(e); process.exit(1) })
