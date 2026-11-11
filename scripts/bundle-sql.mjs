// Gera supabase/admin/apply_all_migrations.sql: TODAS as migrations num único script
// idempotente para o SQL Editor do Supabase. Pode rodar quantas vezes quiser:
//  * registra o que aplicou em private.tucai_migrations;
//  * em bancos antigos (sem registro), detecta pelo objeto que cada migration cria;
//  * aplica só o que falta, em ordem, e informa cada passo (NOTICE).
//   npm run sql:bundle
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const dir = 'supabase/migrations'
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()

// Como reconhecer, em banco sem registro, que a migration já foi aplicada.
// Migrations novas não precisam de entrada aqui: o registro passa a valer a partir de agora.
const DETECT = {
  '0001': `to_regclass('public.profiles') is not null`,
  '0002': `to_regclass('public.cities') is not null`,
  '0003': `to_regclass('public.public_businesses') is not null and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'public_businesses' and column_name = 'is_demo')`,
  '0004': `exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'business_status' and e.enumlabel = 'rejected')`,
  '0005': `to_regclass('public.platform_settings') is not null`,
  '0006': `to_regclass('public.privacy_requests') is not null`,
  '0007': `exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'businesses' and policyname = 'businesses_member_update')`,
  '0008': `to_regclass('public.social_profiles') is not null`,
  '0009': `to_regclass('public.couriers') is not null`,
  '0010': `to_regclass('public.communities') is not null`,
}

const TAG = 'tucai_sql'
const parts = [
  '-- =====================================================================================',
  `-- TUCAÍ — BANCO COMPLETO (migrations ${files[0].slice(0, 4)} a ${files.at(-1).slice(0, 4)}) PARA O SQL EDITOR DO SUPABASE`,
  '-- Gerado automaticamente a partir de supabase/migrations por `npm run sql:bundle`. NÃO editar aqui.',
  '-- Seguro para rodar quantas vezes quiser: aplica só o que falta e registra em private.tucai_migrations.',
  '-- Uso: copie TODO o conteúdo, cole no SQL Editor e clique em Run.',
  '-- =====================================================================================',
  '',
  'create schema if not exists private;',
  'revoke all on schema private from public;',
  'create table if not exists private.tucai_migrations (',
  '  version text primary key,',
  '  name text not null,',
  "  how text not null check (how in ('applied', 'detected')),",
  '  applied_at timestamptz not null default now()',
  ');',
  'revoke all on private.tucai_migrations from public;',
  '',
]
for (const f of files) {
  const v = f.slice(0, 4)
  const sql = readFileSync(`${dir}/${f}`, 'utf8').replace(/^﻿/, '')
  if (sql.includes(`$${TAG}$`) || sql.includes(`$tucai_${v}$`)) throw new Error(`${f} contém um marcador reservado`)
  const detect = DETECT[v]
  parts.push(
    `-- ===================== ${dir}/${f} =====================`,
    `do $tucai_${v}$`,
    'begin',
    `  if exists (select 1 from private.tucai_migrations where version = '${v}') then`,
    `    raise notice 'Tucaí ${v}: já aplicada';`,
    ...(detect
      ? [
          `  elsif ${detect} then`,
          `    insert into private.tucai_migrations(version, name, how) values ('${v}', '${f}', 'detected');`,
          `    raise notice 'Tucaí ${v}: já existia no banco (registrada)';`,
        ]
      : []),
    '  else',
    `    execute $${TAG}$`,
    sql,
    `$${TAG}$;`,
    `    insert into private.tucai_migrations(version, name, how) values ('${v}', '${f}', 'applied');`,
    `    raise notice 'Tucaí ${v}: aplicada agora';`,
    '  end if;',
    `end $tucai_${v}$;`,
    '',
  )
}
parts.push('select version, name, how, applied_at from private.tucai_migrations order by version;')
writeFileSync('supabase/admin/apply_all_migrations.sql', parts.join('\n') + '\n')
console.log(`apply_all_migrations.sql: ${files.length} migrations (idempotente)`)
