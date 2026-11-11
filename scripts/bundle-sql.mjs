// Junta migrations em um arquivo para colar no SQL Editor do Supabase.
//   npm run sql:bundle               -> supabase/admin/apply_all_migrations.sql (banco vazio)
//   npm run sql:bundle -- 0009       -> supabase/admin/apply_from_0009.sql (só as novas, com trava)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
const dir = 'supabase/migrations'
const from = process.argv[2]
const all = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
const files = from ? all.filter((f) => f.slice(0, 4) >= from) : all
if (files.length === 0) throw new Error(`nenhuma migration a partir de ${from}`)
const prev = from ? all.filter((f) => f.slice(0, 4) < from).at(-1) : null
// Trava: tabela criada pela última migration anterior deve existir; a da primeira nova, não.
const firstTable = (f) => readFileSync(`${dir}/${f}`, 'utf8').match(/create table public\.(\w+)/)?.[1]
const guard = from
  ? `do $$ begin
  if to_regclass('public.${firstTable(prev) ?? 'profiles'}') is null then
    raise exception 'Aplique antes as migrations até ${prev} (tabela public.${firstTable(prev)} não existe).';
  end if;
  if to_regclass('public.${firstTable(files[0])}') is not null then
    raise exception 'A migration ${files[0]} já foi aplicada (public.${firstTable(files[0])} existe). Nada a fazer.';
  end if;
end $$;\n`
  : ''
const out = from ? `supabase/admin/apply_from_${from}.sql` : 'supabase/admin/apply_all_migrations.sql'
const head = [
  '-- =====================================================================================',
  `-- TUCAÍ — MIGRATIONS ${files[0].slice(0, 4)} a ${files.at(-1).slice(0, 4)} PARA O SQL EDITOR DO SUPABASE`,
  '-- Gerado automaticamente a partir de supabase/migrations. NÃO editar aqui.',
  from
    ? `-- Para bancos que já têm até ${prev?.slice(0, 4)}. Copie TODO o conteúdo, cole no SQL Editor e clique em Run UMA vez.`
    : '-- Para banco VAZIO. Copie TODO o conteúdo, cole no SQL Editor e clique em Run UMA vez.',
  `-- Regenerar: npm run sql:bundle${from ? ` -- ${from}` : ''}`,
  '-- =====================================================================================',
]
const body = files.map((f) => `\n-- ===================== ${dir}/${f} =====================\n` + readFileSync(`${dir}/${f}`, 'utf8').replace(/^﻿/, ''))
writeFileSync(out, head.join('\n') + '\n' + guard + body.join('\n'))
console.log(`${out}: ${files.length} migrations`)
