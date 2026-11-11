// Gera a base de referência de municípios (IBGE) de MG e SP usada pelo módulo multicidades.
//
// Fonte: base pública "municipios-brasileiros" (kelvins), que reúne os 5.570 municípios + DF com
// código IBGE e as coordenadas da sede municipal:
//   https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv
//
// Uso:
//   node scripts/ibge-municipios.mjs <caminho/municipios.csv>   -> valida e regenera os arquivos
//   node scripts/ibge-municipios.mjs --check                    -> confere se o SQL bate com o CSV versionado
//
// Saídas (versionadas):
//   supabase/reference/ibge_municipios_mg_sp.csv            recorte MG+SP (fonte de verdade no repositório)
//   supabase/migrations/0009_ibge_municipios_mg_sp.sql       carga em private.ibge_municipalities
//
// Nenhuma cidade é digitada à mão: tudo sai da base, depois de validado abaixo.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_CSV = resolve(root, 'supabase/reference/ibge_municipios_mg_sp.csv')
const OUT_SQL = resolve(root, 'supabase/migrations/0009_ibge_municipios_mg_sp.sql')
const SOURCE_URL = 'https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv'

/** UF do IBGE (2 primeiros dígitos do código) -> sigla e contagem oficial de municípios. */
const STATES = {
  31: { uf: 'MG', expected: 853, bbox: { lat: [-23.0, -14.2], lng: [-51.1, -39.8] } },
  35: { uf: 'SP', expected: 645, bbox: { lat: [-25.4, -19.7], lng: [-53.2, -44.1] } },
}
const HQ_CODE = 3133758 // Itaú de Minas/MG

/**
 * Códigos oficiais do IBGE que não seguem o dígito verificador (criados após a regra). Lista
 * pública e fechada; qualquer outro código com DV inválido reprova a base.
 */
const DV_EXCEPTIONS = new Set([2201919, 2201988, 2202251, 2611533, 3117836, 3152131, 4305871, 5203939, 5203962])

export function ibgeCheckDigit(code6) {
  let sum = 0
  for (let i = 0; i < 6; i++) {
    const p = Number(code6[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(p / 10) + (p % 10)
  }
  return (10 - (sum % 10)) % 10
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const header = lines[0].split(',')
  return lines.slice(1).map((l, i) => {
    if (l.includes('"')) throw new Error(`Linha ${i + 2}: aspas não suportadas`)
    const cols = l.split(',')
    if (cols.length !== header.length) throw new Error(`Linha ${i + 2}: ${cols.length} colunas (esperado ${header.length})`)
    return Object.fromEntries(header.map((h, j) => [h, cols[j]]))
  })
}

/** Valida a base completa e devolve o recorte MG+SP ordenado por código. */
function validateFull(rows) {
  const errors = []
  if (rows.length < 5570) errors.push(`base com ${rows.length} municípios (esperado >= 5570)`)
  const seen = new Set()
  for (const r of rows) {
    const code = r.codigo_ibge
    if (!/^\d{7}$/.test(code)) { errors.push(`código inválido: ${code}`); continue }
    if (seen.has(code)) errors.push(`código duplicado: ${code}`)
    seen.add(code)
    if (code.slice(0, 2) !== r.codigo_uf) errors.push(`${code}: UF ${r.codigo_uf} não confere com o código`)
    if (ibgeCheckDigit(code) !== Number(code[6]) && !DV_EXCEPTIONS.has(Number(code))) {
      errors.push(`${code} ${r.nome}: dígito verificador inválido`)
    }
  }
  const subset = rows
    .filter((r) => STATES[r.codigo_uf])
    .map((r) => ({ code: Number(r.codigo_ibge), name: r.nome.trim(), uf: STATES[r.codigo_uf].uf, lat: r.latitude, lng: r.longitude }))
    .sort((a, b) => a.code - b.code)
  return { errors: errors.concat(validateSubset(subset)), subset }
}

/** Regras do recorte (também usadas no --check sobre o CSV versionado). */
function validateSubset(subset) {
  const errors = []
  for (const [prefix, s] of Object.entries(STATES)) {
    const n = subset.filter((m) => String(m.code).startsWith(prefix)).length
    if (n !== s.expected) errors.push(`${s.uf}: ${n} municípios (oficial: ${s.expected})`)
  }
  const names = new Set()
  for (const m of subset) {
    const s = STATES[String(m.code).slice(0, 2)]
    if (!s || s.uf !== m.uf) errors.push(`${m.code}: UF ${m.uf} não confere`)
    if (m.name.length < 2 || m.name.length > 120 || !/^[\p{L}' .-]+$/u.test(m.name)) errors.push(`${m.code}: nome suspeito "${m.name}"`)
    const key = `${m.uf}|${m.name.toLocaleLowerCase('pt-BR')}`
    if (names.has(key)) errors.push(`${m.code}: nome repetido na UF (${m.name})`)
    names.add(key)
    for (const [k, [min, max]] of Object.entries(s?.bbox ?? {})) {
      if (!/^-?\d{1,3}\.\d{1,6}$/.test(m[k])) { errors.push(`${m.code}: ${k} mal formatada (${m[k]})`); continue }
      const v = Number(m[k])
      if (v < min || v > max) errors.push(`${m.code} ${m.name}: ${k} ${v} fora dos limites de ${m.uf}`)
    }
  }
  if (!subset.some((m) => m.code === HQ_CODE)) errors.push('sede (Itaú de Minas, 3133758) ausente')
  return errors
}

function toCsv(subset) {
  return 'codigo_ibge,nome,uf,latitude,longitude\n' + subset.map((m) => `${m.code},${m.name},${m.uf},${m.lat},${m.lng}`).join('\n') + '\n'
}

function toSql(subset, csvSha) {
  const values = subset.map((m) => `  (${m.code}, '${m.name.replaceAll("'", "''")}', '${m.uf}', ${m.lat}, ${m.lng})`).join(',\n')
  return `-- 0009_ibge_municipios_mg_sp: base de referência de municípios (IBGE) de MG e SP.
-- GERADO por scripts/ibge-municipios.mjs a partir de supabase/reference/ibge_municipios_mg_sp.csv
-- (sha256 ${csvSha}). NÃO editar à mão: regenere com o script.
-- Fonte: ${SOURCE_URL}
-- Coordenadas = sede municipal. Validações aplicadas: código de 7 dígitos com dígito verificador
-- do IBGE, prefixo da UF, contagem oficial (MG ${STATES[31].expected}, SP ${STATES[35].expected}), nomes únicos por UF e
-- coordenadas dentro dos limites do estado.
-- Tabela de referência no schema private (sem acesso pela API); lida por funções do painel Master.

create table private.ibge_municipalities (
  code integer primary key check (code between 1100000 and 5399999),
  name text not null check (char_length(name) between 2 and 120),
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  unique (uf, name)
);
comment on table private.ibge_municipalities is
  'Referência IBGE (código, nome, UF, coordenadas da sede). Origem: ${SOURCE_URL}';
revoke all on private.ibge_municipalities from public, anon, authenticated;

insert into private.ibge_municipalities (code, name, uf, lat, lng) values
${values};

do $$
begin
  if (select count(*) from private.ibge_municipalities where uf = 'MG') <> ${STATES[31].expected}
     or (select count(*) from private.ibge_municipalities where uf = 'SP') <> ${STATES[35].expected} then
    raise exception 'Base IBGE incompleta.';
  end if;
end $$;
`
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function fail(errors) {
  console.error('Base reprovada:\n - ' + errors.join('\n - '))
  process.exit(1)
}

const arg = process.argv[2]
if (!arg) {
  console.error('Uso: node scripts/ibge-municipios.mjs <municipios.csv> | --check')
  process.exit(2)
}

if (arg === '--check') {
  const csv = readFileSync(OUT_CSV, 'utf8')
  const subset = parseCsv(csv).map((r) => ({ code: Number(r.codigo_ibge), name: r.nome, uf: r.uf, lat: r.latitude, lng: r.longitude }))
  const errors = validateSubset(subset)
  if (errors.length) fail(errors)
  if (readFileSync(OUT_SQL, 'utf8') !== toSql(subset, sha256(csv))) fail(['0009_ibge_municipios_mg_sp.sql não corresponde ao CSV versionado'])
  console.log(`OK: ${subset.length} municípios (MG+SP), SQL consistente com o CSV.`)
} else {
  const raw = readFileSync(resolve(arg), 'utf8')
  const { errors, subset } = validateFull(parseCsv(raw))
  if (errors.length) fail(errors)
  const csv = toCsv(subset)
  writeFileSync(OUT_CSV, csv)
  writeFileSync(OUT_SQL, toSql(subset, sha256(csv)))
  console.log(`Fonte sha256 ${sha256(raw)}`)
  console.log(`OK: ${subset.length} municípios gravados (MG ${STATES[31].expected}, SP ${STATES[35].expected}).`)
}
