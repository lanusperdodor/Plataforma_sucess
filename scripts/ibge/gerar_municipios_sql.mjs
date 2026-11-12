// Gera supabase/admin/municipios_ibge.sql (importação dos municípios brasileiros) a partir de um CSV com
// codigo_ibge,nome,latitude,longitude,capital,codigo_uf — formato da compilação pública dos dados do IBGE
// (github.com/kelvins/municipios-brasileiros: códigos e nomes do IBGE, coordenadas das sedes municipais).
//
// Uso:
//   node scripts/ibge/gerar_municipios_sql.mjs                 # baixa o CSV público
//   node scripts/ibge/gerar_municipios_sql.mjs caminho.csv     # usa um arquivo local
//   IBGE_VALIDAR=1 node scripts/ibge/gerar_municipios_sql.mjs  # confere códigos e nomes na API oficial do IBGE
//
// O arquivo gerado é aplicado no SQL Editor do Supabase (como postgres), DEPOIS da migration 0028. É idempotente
// (upsert): rodar de novo atualiza nomes/coordenadas e inclui municípios novos. Não apaga nada.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CSV_URL = 'https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv'
const IBGE_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado'

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/)
  const head = lines.shift().split(',')
  return lines.map((l) => {
    const cols = l.split(',')
    return Object.fromEntries(head.map((h, i) => [h.trim(), (cols[i] ?? '').trim()]))
  })
}

const arg = process.argv[2]
const text = arg ? readFileSync(arg, 'utf8') : await (await fetch(CSV_URL)).text()
const rows = parseCsv(text).map((r) => ({
  codigo_ibge: Number(r.codigo_ibge), nome: r.nome, latitude: r.latitude, longitude: r.longitude,
  capital: Number(r.capital) === 1 ? 1 : 0, codigo_uf: Number(r.codigo_uf),
}))
const bad = rows.filter((r) => !(r.codigo_ibge >= 1100000 && r.codigo_ibge <= 5399999) || Math.floor(r.codigo_ibge / 100000) !== r.codigo_uf || !r.nome)
if (bad.length) { console.error('Linhas inválidas:', bad.slice(0, 5)); process.exit(1) }

if (process.env.IBGE_VALIDAR === '1') {
  const oficial = await (await fetch(IBGE_URL)).json()
  const map = new Map(oficial.map((m) => [Number(m['municipio-id']), m['municipio-nome']]))
  const faltando = rows.filter((r) => !map.has(r.codigo_ibge))
  const novos = [...map.keys()].filter((k) => !rows.some((r) => r.codigo_ibge === k))
  const nomes = rows.filter((r) => map.has(r.codigo_ibge) && map.get(r.codigo_ibge) !== r.nome)
  console.log(`IBGE oficial: ${map.size} municípios; CSV: ${rows.length}; fora do IBGE: ${faltando.length}; ausentes no CSV: ${novos.length}; nomes diferentes: ${nomes.length}`)
  for (const r of nomes) r.nome = map.get(r.codigo_ibge) // o nome oficial prevalece
  if (novos.length) console.warn('Municípios do IBGE sem coordenadas no CSV (entram sem coordenadas → lacuna sinalizada):', novos.length)
  for (const k of novos) rows.push({ codigo_ibge: k, nome: map.get(k), latitude: '', longitude: '', capital: 0, codigo_uf: Math.floor(k / 100000) })
}

const fonte = process.env.IBGE_VALIDAR === '1' ? 'IBGE (códigos/nomes, API oficial) + coordenadas das sedes (kelvins/municipios-brasileiros)' : 'kelvins/municipios-brasileiros (dados do IBGE)'
const esc = (s) => s.replace(/'/g, "''")
const out = [
  '-- GERADO por scripts/ibge/gerar_municipios_sql.mjs — não editar à mão.',
  `-- ${rows.length} municípios. Fonte: ${fonte}. Gerado em ${new Date().toISOString().slice(0, 10)}.`,
  '-- Aplicar no SQL Editor do Supabase (como postgres) depois da migration 0028. Idempotente.',
  'begin;',
]
for (let i = 0; i < rows.length; i += 500) {
  out.push(`select private.import_municipalities('${esc(JSON.stringify(rows.slice(i, i + 500)))}'::jsonb, '${esc(fonte)}');`)
}
out.push('select private.link_cities_ibge() as cidades_ligadas;', 'select private.seed_initial_regions() as regioes_exemplo;', 'select private.assign_coverage();', 'commit;', '')
writeFileSync(resolve(root, 'supabase/admin/municipios_ibge.sql'), out.join('\n'))
console.log(`OK: supabase/admin/municipios_ibge.sql (${rows.length} municípios)`)
