// Verifica o tamanho do carregamento inicial (script de entrada + modulepreload).
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIMIT = 450_000
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const html = readFileSync(join(dist, 'index.html'), 'utf8')

const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? []
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}=["']([^"']+)["']`, 'i'))?.[1]

const js = new Set()
const css = new Set()
for (const tag of tags) {
  const isScript = /^<script/i.test(tag)
  const rel = attr(tag, 'rel')
  const href = isScript ? attr(tag, 'src') : attr(tag, 'href')
  if (!href || /^https?:\/\//.test(href)) continue
  if (isScript && /type=["']module["']/i.test(tag)) js.add(href)
  else if (rel === 'modulepreload') js.add(href)
  else if (rel === 'stylesheet') css.add(href)
}

const size = (href) => statSync(join(dist, href.replace(/^\//, ''))).size
const rows = (set) => [...set].map((href) => ({ href, bytes: size(href) }))
const jsRows = rows(js)
const cssRows = rows(css)
const jsTotal = jsRows.reduce((n, r) => n + r.bytes, 0)
const cssTotal = cssRows.reduce((n, r) => n + r.bytes, 0)

console.log('Carregamento inicial (JS: entrada + modulepreload)')
for (const r of jsRows) console.log(`  ${String(r.bytes).padStart(9)} B  ${r.href}`)
console.log(`  JS total: ${jsTotal} B (limite ${LIMIT} B)`)
console.log('CSS inicial (reportado separadamente, fora do limite)')
for (const r of cssRows) console.log(`  ${String(r.bytes).padStart(9)} B  ${r.href}`)
console.log(`  CSS total: ${cssTotal} B`)

if (jsRows.length === 0) {
  console.error('FALHA: nenhum script de entrada encontrado em dist/index.html')
  process.exit(1)
}
if (jsTotal > LIMIT) {
  console.error(`FALHA: ${jsTotal} B excede o limite de ${LIMIT} B (+${jsTotal - LIMIT} B)`)
  process.exit(1)
}
console.log('OK: dentro do limite')
