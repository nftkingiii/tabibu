// Extracts per-page text from a guideline PDF with pdf.js (pure JS, works offline
// on Windows, macOS and Linux). Lines are rebuilt from text item positions.
import fs from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export async function extractPages (file) {
  const data = new Uint8Array(fs.readFileSync(file))
  const doc = await getDocument({ data, verbosity: 0, useSystemFonts: false }).promise
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const rows = new Map()
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue
      const y = Math.round(item.transform[5] / 3)
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y).push({ x: item.transform[4], s: item.str })
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.s).join(' '))
      .map(cleanLine)
      .filter(Boolean)
    pages.push({ pdfPage: n, ...splitFooter(lines) })
  }
  return pages
}

function cleanLine (line) {
  return line
    .replace(/[-□▪☐•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// The printed page number sits at the end of the running footer, e.g.
// "Participant Manual: Caring for the sick child in the community 41".
function splitFooter (lines) {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    const m = lines[i].match(/^(.{10,}?)\s+(\d{1,3})$/)
    if (m && /manual|annex|community/i.test(m[1])) {
      return { printedPage: Number(m[2]), lines: lines.filter((_, j) => j !== i) }
    }
  }
  return { printedPage: null, lines }
}
