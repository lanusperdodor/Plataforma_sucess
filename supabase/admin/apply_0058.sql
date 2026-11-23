-- =====================================================================================
-- TUCAÍ — ATUALIZAÇÃO (migration 0058) PARA O SQL EDITOR DO SUPABASE
-- Gerado automaticamente a partir de supabase/migrations por `npm run sql:bundle`. NÃO editar aqui.
-- Seguro para rodar quantas vezes quiser: aplica só o que falta e registra em private.tucai_migrations.
-- Uso: copie TODO o conteúdo, cole no SQL Editor e clique em Run.
-- =====================================================================================

create schema if not exists private;
revoke all on schema private from public;
create table if not exists private.tucai_migrations (
  version text primary key,
  name text not null,
  how text not null check (how in ('applied', 'detected')),
  applied_at timestamptz not null default now()
);
revoke all on private.tucai_migrations from public;

-- ===================== supabase/migrations/0058_cota_mapas.sql =====================
do $tucai_0058$
begin
  if exists (select 1 from private.tucai_migrations where version = '0058') then
    raise notice 'Tucaí 0058: já aplicada';
  else
    execute $tucai_sql$
-- 0058 — Proteção das cotas gratuitas do serviço de mapas (openrouteservice), achado da revisão de segurança 2026-11.
-- Antes: qualquer conta logada podia chamar a busca de endereço sem limite (e cada busca faz até 4 consultas), e o
-- diagnóstico público de frete calculava rotas a cada cache vazio. Esgotar a cota diária derrubava, para todos, a
-- localização das lojas, o frete por distância e as rotas dos entregadores.
-- Agora o Worker pede licença ao banco antes de consultar o serviço:
--   * geocode_allow(): por pessoa, 30 buscas/hora; no total, 700 buscas/dia (abaixo da cota de ~1000/dia);
--   * diagnostic_allow(): no total, 24 diagnósticos novos/dia (cada um calcula 4 rotas; o resto sai do cache).

create table if not exists private.daily_usage (
  name text not null,
  day date not null default current_date,
  n integer not null default 0,
  primary key (name, day)
);
revoke all on private.daily_usage from public, anon, authenticated;

create or replace function private.bump_daily(_name text, _max integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  delete from private.daily_usage where day < current_date - 7;
  insert into private.daily_usage as d (name, day, n) values (_name, current_date, 1)
  on conflict (name, day) do update set n = d.n + 1
  returning n into v;
  if v > _max then
    raise exception 'Limite diário do serviço de mapas atingido. Marque no mapa ou cole a coordenada.' using errcode = 'PT429';
  end if;
end $$;
revoke all on function private.bump_daily(text, integer) from public, anon, authenticated;

create or replace function public.geocode_allow() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  perform private.rate_limit('geocode', 30, 3600);
  perform private.bump_daily('geocode', 700);
end $$;

create or replace function public.diagnostic_allow() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bump_daily('diagnostico.frete', 24);
end $$;

do $$ begin
  revoke all on function public.geocode_allow() from public, anon;
  grant execute on function public.geocode_allow() to authenticated;
  revoke all on function public.diagnostic_allow() from public;
  grant execute on function public.diagnostic_allow() to anon, authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0058', '0058_cota_mapas.sql', 'applied');
    raise notice 'Tucaí 0058: aplicada agora';
  end if;
end $tucai_0058$;

select version, name, how, applied_at from private.tucai_migrations order by version;
