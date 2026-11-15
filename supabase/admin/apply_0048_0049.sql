-- =====================================================================================
-- TUCAÍ — ATUALIZAÇÃO (migrations 0048 e 0049) PARA O SQL EDITOR DO SUPABASE
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

-- ===================== supabase/migrations/0049_assinatura_recorrente.sql =====================
do $tucai_0049$
begin
  if exists (select 1 from private.tucai_migrations where version = '0049') then
    raise notice 'Tucaí 0049: já aplicada';
  else
    execute $tucai_sql$
-- 0049: plano da empresa com DÉBITO AUTOMÁTICO mensal (Mercado Pago Assinaturas / preapproval).
--  * Ao cadastrar a empresa (ou no Plano), o dono escolhe Padrão (R$ 79) ou Premium (R$ 99) e autoriza a assinatura no
--    Mercado Pago; o Mercado Pago cobra todo mês sozinho.
--  * O Worker cria e cancela a assinatura (Access Token só no servidor) e recebe os avisos. Cada mensalidade paga vira uma
--    cobrança "paga" (sem duplicar: id do pagamento é único) e estende o plano por 1 mês.
--  * A aprovação do cadastro pelo Master continua igual; se o Master recusar, a assinatura é cancelada.
--  * Nada é cobrado sem o Mercado Pago confirmar; o valor vem da tabela de planos (nunca do navegador).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('payments.subscription', 20, 3600)
on conflict (action) do nothing;

create table if not exists public.business_gateway_subscriptions (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  plan_code text not null references public.plans(code),
  price_cents integer not null check (price_cents > 0),
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  preapproval_id text unique check (preapproval_id is null or char_length(preapproval_id) <= 80),
  status text not null default 'pendente' check (status in ('pendente', 'autorizada', 'pausada', 'cancelada')),
  last_payment_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_gateway_subscriptions_created_by_idx on public.business_gateway_subscriptions(created_by);
create index if not exists business_gateway_subscriptions_plan_idx on public.business_gateway_subscriptions(plan_code);
alter table public.business_gateway_subscriptions enable row level security;
drop policy if exists bgs_select on public.business_gateway_subscriptions;
create policy bgs_select on public.business_gateway_subscriptions for select to authenticated
  using (public.has_business_permission(business_id, 'settings.manage') or public.has_platform_permission('finance.view'));
revoke all on public.business_gateway_subscriptions from public, anon, authenticated;
grant select on public.business_gateway_subscriptions to authenticated;

-- dono escolhe o plano: devolve o que o Worker precisa para criar a assinatura (e-mail do próprio dono)
create or replace function public.owner_start_subscription(_business uuid, _plan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.businesses%rowtype; p public.plans%rowtype; g public.business_gateway_subscriptions%rowtype; mail text;
begin
  if auth.uid() is null or not public.has_business_permission(_business, 'settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('payments.subscription');
  select * into b from public.businesses where id = _business;
  if b.status not in ('pending', 'active') then raise exception 'Estabelecimento indisponível para assinatura.' using errcode = 'P0001'; end if;
  select * into p from public.plans where code = _plan and is_active;
  if not found then raise exception 'Plano inválido.' using errcode = 'P0001'; end if;
  select * into g from public.business_gateway_subscriptions where business_id = _business;
  if g.status in ('autorizada', 'pausada') then raise exception 'A assinatura já está ativa. Cancele antes de trocar de plano.' using errcode = 'P0001'; end if;
  select u.email into mail from auth.users u where u.id = auth.uid();
  return jsonb_build_object('business_id', b.id, 'business_name', b.name, 'plan_code', p.code, 'plan_name', p.name, 'price_cents', p.price_cents, 'payer_email', mail);
end $$;

-- cancelar: dono (settings.manage) ou Master; devolve o id no Mercado Pago para o Worker cancelar lá
create or replace function public.subscription_to_cancel(_business uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.business_gateway_subscriptions%rowtype;
begin
  if auth.uid() is null or not (public.has_business_permission(_business, 'settings.manage') or private.is_master_ok()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.limit_for('payments.subscription');
  select * into g from public.business_gateway_subscriptions where business_id = _business;
  if not found or g.preapproval_id is null or g.status = 'cancelada' then raise exception 'Não há assinatura ativa.' using errcode = 'P0001'; end if;
  return jsonb_build_object('preapproval_id', g.preapproval_id);
end $$;

-- Worker: grava a assinatura criada no Mercado Pago
create or replace function public.worker_save_preapproval(_key text, _business uuid, _plan text, _preapproval_id text, _user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.plans%rowtype;
begin
  perform private.limit_for('worker.payments');
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.plans where code = _plan;
  if not found then raise exception 'Plano inválido.' using errcode = 'P0001'; end if;
  insert into public.business_gateway_subscriptions(business_id, plan_code, price_cents, preapproval_id, status, created_by)
  values (_business, p.code, p.price_cents, left(_preapproval_id, 80), 'pendente', _user)
  on conflict (business_id) do update set plan_code = excluded.plan_code, price_cents = excluded.price_cents,
         preapproval_id = excluded.preapproval_id, status = 'pendente', created_by = excluded.created_by, updated_at = now();
  perform private.audit('payments.subscription_created', 'business_gateway_subscriptions', _business::text, jsonb_build_object('plano', p.code, 'valor', p.price_cents));
end $$;

-- Worker: situação da assinatura (pelo aviso do Mercado Pago, conferida na API)
create or replace function public.worker_preapproval_status(_key text, _preapproval_id text, _status text) returns text
language plpgsql security definer set search_path = '' as $$
declare g public.business_gateway_subscriptions%rowtype; st text;
begin
  perform private.limit_for('worker.payments');
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  st := case _status when 'authorized' then 'autorizada' when 'paused' then 'pausada' when 'cancelled' then 'cancelada' else 'pendente' end;
  update public.business_gateway_subscriptions set status = st, updated_at = now() where preapproval_id = _preapproval_id returning * into g;
  if not found then return 'assinatura_inexistente'; end if;
  if st = 'cancelada' then
    update public.business_subscriptions set status = 'canceled' where business_id = g.business_id and status = 'active';
  end if;
  perform private.audit('payments.subscription_status', 'business_gateway_subscriptions', g.business_id::text, jsonb_build_object('status', st));
  return st;
end $$;

-- Worker: mensalidade paga pelo débito automático → cobrança paga + plano estendido (sem duplicar)
create or replace function public.worker_preapproval_payment(_key text, _preapproval_id text, _payment_id text, _amount_cents integer, _method text) returns text
language plpgsql security definer set search_path = '' as $$
declare g public.business_gateway_subscriptions%rowtype; s public.business_subscriptions%rowtype; ref date := date_trunc('month', current_date)::date;
begin
  perform private.limit_for('worker.payments');
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into g from public.business_gateway_subscriptions where preapproval_id = _preapproval_id for update;
  if not found then return 'assinatura_inexistente'; end if;
  if exists (select 1 from public.platform_charges where provider = 'mercadopago' and provider_payment_id = _payment_id) then return 'ja_confirmado'; end if;
  if _amount_cents <> g.price_cents then return 'valor_diferente'; end if;
  select * into s from public.business_subscriptions where business_id = g.business_id and status = 'active' for update;
  if not found then
    insert into public.business_subscriptions(business_id, plan_code, price_cents, status, started_on, current_period_end, notes)
    values (g.business_id, g.plan_code, g.price_cents, 'active', current_date, current_date, 'Débito automático (Mercado Pago)')
    returning * into s;
  end if;
  update public.business_subscriptions set current_period_end = (greatest(current_period_end, current_date) + interval '1 month')::date,
         plan_code = g.plan_code, price_cents = g.price_cents where id = s.id;
  insert into public.platform_charges(business_id, subscription_id, kind, description, amount_cents, due_on, status, paid_at, paid_method, provider, provider_payment_id)
  values (g.business_id, s.id, 'plano', 'Mensalidade ' || (select name from public.plans where code = g.plan_code) || ' — débito automático ' || to_char(ref, 'MM/YYYY'),
          g.price_cents, current_date, 'paga', now(), case when _method in ('pix', 'cartao', 'boleto') then _method else 'cartao' end, 'mercadopago', _payment_id);
  update public.business_gateway_subscriptions set status = 'autorizada', last_payment_at = now(), updated_at = now() where business_id = g.business_id;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (null, 'payments.subscription_paid', 'business_gateway_subscriptions', g.business_id::text, jsonb_build_object('payment_id', _payment_id, 'amount', _amount_cents));
  return 'confirmado';
exception when unique_violation then
  return 'ja_confirmado';
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.owner_start_subscription(uuid, text)', 'public.subscription_to_cancel(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.worker_save_preapproval(text, uuid, text, text, uuid)', 'public.worker_preapproval_status(text, text, text)',
                           'public.worker_preapproval_payment(text, text, text, integer, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0049', '0049_assinatura_recorrente.sql', 'applied');
    raise notice 'Tucaí 0049: aplicada agora';
  end if;
end $tucai_0049$;

select version, name, how, applied_at from private.tucai_migrations order by version;
