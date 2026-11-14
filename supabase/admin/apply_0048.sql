-- =====================================================================================
-- TUCAÍ — ATUALIZAÇÃO (migration 0048: meus dados do entregador) PARA O SQL EDITOR DO SUPABASE
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

-- ===================== supabase/migrations/0048_entregador_meus_dados.sql =====================
do $tucai_0048$
begin
  if exists (select 1 from private.tucai_migrations where version = '0048') then
    raise notice 'Tucaí 0048: já aplicada';
  else
    execute $tucai_sql$
-- 0048: "Meus dados" do entregador aprovado: celular e veículo (placa e CNH) sem voltar para análise.
-- Nome e cidade de atuação continuam travados (mudam só com a equipe Tucaí: afetam identidade e ofertas).
-- Cada alteração fica na auditoria.
insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('courier.profile', 20, 3600)
on conflict (action) do nothing;

create or replace function public.courier_update_profile(_phone text, _vehicle public.courier_vehicle, _vehicle_plate text default null, _cnh_category text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.couriers%rowtype;
  plate text := nullif(upper(regexp_replace(coalesce(_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g')), '');
  cnh text := nullif(upper(btrim(coalesce(_cnh_category, ''))), '');
  ph text := btrim(coalesce(_phone, ''));
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.profile');
  select * into c from public.couriers where user_id = auth.uid() for update;
  if not found then raise exception 'Faça o cadastro de entregador primeiro.' using errcode = 'P0001'; end if;
  if c.status = 'suspended' then raise exception 'Cadastro suspenso: fale com o suporte.' using errcode = 'P0001'; end if;
  if ph !~ '^[0-9+() -]{8,20}$' then raise exception 'Celular inválido.' using errcode = 'P0001'; end if;
  if _vehicle in ('bicicleta', 'a_pe') then plate := null; cnh := null; end if;
  if _vehicle in ('moto', 'carro') then
    if plate is null or plate !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then raise exception 'Placa inválida (ex.: ABC1D23).' using errcode = 'P0001'; end if;
    if cnh is null or cnh not in ('A', 'B', 'AB', 'AC', 'AD', 'AE') then raise exception 'Informe a categoria da CNH.' using errcode = 'P0001'; end if;
  end if;
  -- online com o veículo trocado no meio de uma entrega: só depois de concluir
  if c.vehicle is distinct from _vehicle and exists (select 1 from public.deliveries where courier_id = auth.uid() and status in ('accepted', 'picked_up')) then
    raise exception 'Conclua a entrega atual antes de trocar o veículo.' using errcode = 'P0001';
  end if;
  update public.couriers set phone = ph, vehicle = _vehicle, vehicle_plate = plate, cnh_category = cnh where user_id = auth.uid();
  perform private.audit('courier.profile_update', 'couriers', auth.uid()::text,
    jsonb_build_object('telefone_mudou', c.phone is distinct from ph, 'veiculo', _vehicle, 'veiculo_anterior', c.vehicle));
end $$;

do $$ begin
  revoke all on function public.courier_update_profile(text, public.courier_vehicle, text, text) from public, anon;
  grant execute on function public.courier_update_profile(text, public.courier_vehicle, text, text) to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0048', '0048_entregador_meus_dados.sql', 'applied');
    raise notice 'Tucaí 0048: aplicada agora';
  end if;
end $tucai_0048$;

select version, name, how, applied_at from private.tucai_migrations order by version;
