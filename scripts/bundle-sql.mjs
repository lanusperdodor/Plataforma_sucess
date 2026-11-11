// Junta as migrations em supabase/admin/apply_all_migrations.sql (para colar no SQL Editor).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
const dir = 'supabase/migrations'
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
const head = [
  '-- =====================================================================================',
  `-- TUCAÍ — TODAS AS MIGRATIONS (${files[0].slice(0, 4)} a ${files.at(-1).slice(0, 4)}) PARA O SQL EDITOR DO SUPABASE`,
  '-- Gerado automaticamente a partir de supabase/migrations. NÃO editar aqui.',
  '-- Uso: copie TODO este conteúdo, cole no SQL Editor (banco vazio) e clique em Run UMA vez.',
  '-- Regenerar: npm run sql:bundle',
  '-- =====================================================================================',
]
const body = files.map((f) => `\n-- ===================== ${dir}/${f} =====================\n` + readFileSync(`${dir}/${f}`, 'utf8').replace(/^﻿/, ''))
writeFileSync('supabase/admin/apply_all_migrations.sql', head.join('\n') + '\n' + body.join('\n'))
console.log(`apply_all_migrations.sql: ${files.length} migrations`)
