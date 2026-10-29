// Builds out/tabibu-demo.mp4 from the grabbed frames. Each frame lasts until the
// next one; gaps where grabbing paused (model waits) collapse to one frame.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const OUT = path.join(__dirname, 'out')
const { frames, cuts } = JSON.parse(fs.readFileSync(path.join(OUT, 'marks.json'), 'utf8'))
const lines = []
let total = 0
frames.forEach((f, i) => {
  const next = frames[i + 1]
  const d = next ? Math.min(next.t - f.t, 0.25) : 1
  total += d
  lines.push(`file '${f.file}'`, `duration ${d.toFixed(3)}`)
})
lines.push(`file '${frames[frames.length - 1].file}'`)
fs.writeFileSync(path.join(OUT, 'frames.txt'), lines.join('\n'))
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', path.join(OUT, 'tabibu-demo.mp4')])
console.log(JSON.stringify({ frames: frames.length, seconds: Math.round(total), waitsCut: cuts.map(([a, b]) => Math.round(b - a)) }))
