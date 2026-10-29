// Builds out/tabibu-demo.mp4 from the grabbed frames. Each frame lasts until the
// next one; gaps where grabbing paused (model waits) collapse to one frame.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const OUT = path.join(__dirname, 'out')
const { frames, cuts, voCues = [] } = JSON.parse(fs.readFileSync(path.join(OUT, 'marks.json'), 'utf8'))
// Each frame lasts its real time, except across a cut wait, which collapses.
const spansCut = (a, b) => cuts.some(([c0, c1]) => a < c1 && b > c0)
const frameDur = i => {
  const next = frames[i + 1]
  if (!next) return 1
  const gap = next.t - frames[i].t
  return spansCut(frames[i].t, next.t) ? 0.1 : Math.min(gap, 2)
}
const lines = []
let total = 0
frames.forEach((f, i) => {
  const d = frameDur(i)
  total += d
  lines.push(`file '${f.file}'`, `duration ${d.toFixed(3)}`)
})
lines.push(`file '${frames[frames.length - 1].file}'`)
fs.writeFileSync(path.join(OUT, 'frames.txt'), lines.join('\n'))
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', path.join(OUT, 'tabibu-demo.mp4')])
console.log(JSON.stringify({ frames: frames.length, seconds: Math.round(total), waitsCut: cuts.map(([a, b]) => Math.round(b - a)) }))

// Optional voice-over: VO_DIR holds clips/<id>.wav from the narration script.
// Each clip starts where its scene starts in the cut video.
if (process.env.VO_DIR) {
  const finalTime = t => {
    let acc = 0
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].t >= t) return acc
      acc += frameDur(i)
    }
    return acc
  }
  const clips = voCues.map(c => ({ ...c, at: finalTime(c.t) + 0.3, file: path.join(process.env.VO_DIR, 'clips', `${c.id}.wav`) }))
    .filter(c => fs.existsSync(c.file))
  const inputs = ['-i', path.join(OUT, 'tabibu-demo.mp4')]
  clips.forEach(c => inputs.push('-i', c.file))
  const delays = clips.map((c, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(c.at * 1000)}:all=1[a${i}]`)
  const filter = `${delays.join(';')};${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[aout]`
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', path.join(OUT, 'tabibu-demo-vo.mp4')])
  console.log(JSON.stringify({ voiceover: clips.map(c => ({ id: c.id, at: Number(c.at.toFixed(1)) })) }))
}
