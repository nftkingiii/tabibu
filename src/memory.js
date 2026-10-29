// Memory used by Tabibu: this Node process plus the QVAC worker (a `bare` child
// process that holds the models). Peak RSS is only available on Linux.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

export function memorySnapshot () {
  const self = process.memoryUsage().rss
  let workers = []
  try {
    workers = childProcesses(process.pid)
  } catch {
    workers = []
  }
  const workerRss = workers.reduce((s, w) => s + w.rss, 0)
  const workerPeak = workers.every(w => w.peak) ? workers.reduce((s, w) => s + w.peak, 0) : null
  return {
    nodeMb: mb(self),
    workerMb: mb(workerRss),
    workerPeakMb: workerPeak ? mb(workerPeak) : null,
    totalMb: mb(self + workerRss)
  }
}

function childProcesses (ppid) {
  if (process.platform === 'linux') {
    const out = []
    for (const pid of fs.readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
        if (Number(field(status, 'PPid')) !== ppid) continue
        out.push({ pid: Number(pid), rss: kb(field(status, 'VmRSS')), peak: kb(field(status, 'VmHWM')) })
      } catch {}
    }
    return out
  }
  if (process.platform === 'win32') {
    const json = execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${ppid}" | Select-Object ProcessId,WorkingSetSize,PeakWorkingSetSize | ConvertTo-Json`],
    { encoding: 'utf8', timeout: 5000 })
    const rows = [].concat(JSON.parse(json || '[]'))
    // PeakWorkingSetSize is reported in KB.
    return rows.map(r => ({ pid: r.ProcessId, rss: Number(r.WorkingSetSize), peak: Number(r.PeakWorkingSetSize) * 1024 }))
  }
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8', timeout: 5000 })
  return out.trim().split('\n').map(l => l.trim().split(/\s+/).map(Number))
    .filter(([, p]) => p === ppid).map(([pid, , rss]) => ({ pid, rss: rss * 1024, peak: null }))
}

function field (status, name) {
  return (status.match(new RegExp(`^${name}:\\s+(.+)$`, 'm')) || [])[1]
}

function kb (s) {
  return s ? Number(s.replace(/\s*kB$/, '')) * 1024 : 0
}

function mb (bytes) {
  return Math.round(bytes / 1048576)
}
