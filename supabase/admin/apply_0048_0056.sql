-- =====================================================================================
-- TUCAÍ — ATUALIZAÇÃO (migrations 0048 a 0056) PARA O SQL EDITOR DO SUPABASE
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

-- ===================== supabase/migrations/0050_cadastro_por_tipo.sql =====================
do $tucai_0050$
begin
  if exists (select 1 from private.tucai_migrations where version = '0050') then
    raise notice 'Tucaí 0050: já aplicada';
  else
    execute $tucai_sql$
-- 0050: tipos de conta no cadastro (cliente, entregador, empresário) e liberação automática da empresa.
--  * Preços dos planos (aprovados): Padrão R$ 79,90 e Premium (completo) R$ 99,90. Assinaturas já existentes mantêm o
--    valor contratado; o novo valor vale para quem assinar daqui em diante.
--  * Empresário: escolhe o plano no cadastro e paga a 1ª mensalidade (débito automático, 0049). Com o pagamento
--    confirmado pelo Mercado Pago, a loja é ATIVADA AUTOMATICAMENTE. O Master vê as lojas ativadas assim e pode suspender.
--  * Cliente e entregador não pagam nada (entregador continua com a conferência do Master antes de receber entregas).

update public.plans set price_cents = 7990 where code = 'delivery' and price_cents = 7900;
update public.plans set price_cents = 9990 where code = 'presencial_delivery' and price_cents = 9900;

alter table public.businesses add column if not exists auto_activated_at timestamptz;

create or replace function public.worker_preapproval_payment(_key text, _preapproval_id text, _payment_id text, _amount_cents integer, _method text) returns text
language plpgsql security definer set search_path = '' as $$
declare g public.business_gateway_subscriptions%rowtype; s public.business_subscriptions%rowtype; b public.businesses%rowtype; ref date := date_trunc('month', current_date)::date;
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
  -- 0050: primeira mensalidade paga libera a loja na hora (sem esperar o Master); o Master confere depois e pode suspender
  select * into b from public.businesses where id = g.business_id for update;
  if b.status = 'pending' then
    perform set_config('tucai.internal', 'on', true);
    update public.businesses set status = 'active', reviewed_at = now(), reviewed_by = null,
           review_note = 'Ativado automaticamente pelo pagamento do plano', auto_activated_at = now()
     where id = b.id;
    insert into public.user_roles(user_id, role) values (b.owner_id, 'business_owner') on conflict do nothing;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (null, 'business.auto_activated', 'businesses', b.id::text, jsonb_build_object('motivo', 'primeira mensalidade paga', 'payment_id', _payment_id));
  end if;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (null, 'payments.subscription_paid', 'business_gateway_subscriptions', g.business_id::text, jsonb_build_object('payment_id', _payment_id, 'amount', _amount_cents));
  return 'confirmado';
exception when unique_violation then
  return 'ja_confirmado';
end $$;

do $$ begin
  revoke all on function public.worker_preapproval_payment(text, text, text, integer, text) from public;
  grant execute on function public.worker_preapproval_payment(text, text, text, integer, text) to anon, authenticated;
end $$;

-- ---------- entregador: liberado automaticamente no primeiro cadastro (não paga nada) ----------
-- Reenvio depois de recusa continua passando pelo Master (quem foi recusado não se libera sozinho).
create or replace function private.courier_auto_approve() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    new.status := 'approved';
    new.reviewed_at := now();
    new.review_note := 'Liberado automaticamente no cadastro';
  end if;
  return new;
end $$;
drop trigger if exists couriers_auto_approve on public.couriers;
create trigger couriers_auto_approve before insert on public.couriers for each row execute function private.courier_auto_approve();

create or replace function private.courier_auto_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' then
    insert into public.user_roles(user_id, role) values (new.user_id, 'courier_partner') on conflict do nothing;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (new.user_id, 'courier.auto_approved', 'couriers', new.user_id::text, '{}'::jsonb);
  end if;
  return null;
end $$;
drop trigger if exists couriers_auto_role on public.couriers;
create trigger couriers_auto_role after insert on public.couriers for each row execute function private.courier_auto_role();

do $$ begin
  revoke all on function private.courier_auto_approve() from public, anon, authenticated;
  revoke all on function private.courier_auto_role() from public, anon, authenticated;
end $$;

-- devolve a situação real do cadastro (aprovado na hora, ou pendente no reenvio após recusa)
create or replace function public.submit_courier_application(
  _full_name text, _phone text, _city_id uuid, _vehicle public.courier_vehicle,
  _vehicle_plate text default null, _cnh_category text default null, _accept_terms boolean default false
) returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  plate text := nullif(upper(regexp_replace(coalesce(_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g')), '');
  cnh text := nullif(upper(btrim(coalesce(_cnh_category, ''))), '');
  current_status public.courier_status;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.submit');
  if not coalesce(_accept_terms, false) then
    raise exception 'É preciso aceitar os termos de parceria.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cities where id = _city_id and is_active and not is_demo) then
    raise exception 'Cidade indisponível.' using errcode = 'P0001';
  end if;
  if _vehicle in ('bicicleta', 'a_pe') then plate := null; cnh := null; end if;
  if _vehicle in ('moto', 'carro') and (plate is null or cnh is null) then
    raise exception 'Informe a placa e a categoria da CNH.' using errcode = 'P0001';
  end if;
  select status into current_status from public.couriers where user_id = uid for update;
  if current_status in ('approved', 'suspended') then
    raise exception 'Seu cadastro já foi analisado. Fale com o suporte para alterar dados.' using errcode = 'P0001';
  end if;
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category,
                              status, terms_version, terms_accepted_at, submitted_at, review_note, reviewed_by, reviewed_at)
  values (uid, btrim(_full_name), btrim(_phone), _city_id, _vehicle, plate, cnh, 'pending',
          private.courier_terms_version(), now(), now(), null, null, null)
  on conflict (user_id) do update set
    full_name = excluded.full_name, phone = excluded.phone, city_id = excluded.city_id, vehicle = excluded.vehicle,
    vehicle_plate = excluded.vehicle_plate, cnh_category = excluded.cnh_category, status = 'pending',
    terms_version = excluded.terms_version, terms_accepted_at = excluded.terms_accepted_at,
    submitted_at = now(), review_note = null, reviewed_by = null, reviewed_at = null;
  perform private.audit('courier.submit', 'couriers', uid::text, jsonb_build_object('vehicle', _vehicle));
  -- 0050: devolve a situação real (no primeiro cadastro o entregador já sai liberado)
  return (select c.status from public.couriers c where c.user_id = uid);
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0050', '0050_cadastro_por_tipo.sql', 'applied');
    raise notice 'Tucaí 0050: aplicada agora';
  end if;
end $tucai_0050$;

-- ===================== supabase/migrations/0051_equipe_funcoes_usuario.sql =====================
do $tucai_0051$
begin
  if exists (select 1 from private.tucai_migrations where version = '0051') then
    raise notice 'Tucaí 0051: já aplicada';
  else
    execute $tucai_sql$
-- 0051: equipe da loja — funções personalizadas e convite pelo NOME DE USUÁRIO.
--  * Função = nome escolhido pelo empresário (ex.: "Caixa", "Balconista", "Motoboy") + cargo base + permissões extras.
--    Atribuir a função a alguém aplica o cargo e as permissões; mudar a função atualiza todos que a usam.
--  * Permissões extras possíveis (nunca as de dono: equipe, configurações e dados da loja): ver e atualizar pedidos,
--    cardápio, comandas, caixa, relatórios, vagas e entregas próprias.
--  * Convite pelo nome de usuário (único em toda a Tucaí): a pessoa entra na equipe na hora; nome inexistente avisa.

-- permissões extras liberadas para funções (antes: só comandas, caixa e relatórios)
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'business_member_permissions_permission_check') then
    alter table public.business_member_permissions drop constraint business_member_permissions_permission_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_member_permissions_permission_ok') then
    alter table public.business_member_permissions add constraint business_member_permissions_permission_ok check (permission in
      ('orders.view', 'orders.update_status', 'menu.manage', 'tabs.manage', 'cash.manage', 'reports.view', 'jobs.manage', 'delivery.manage_own'));
  end if;
end $$;

create or replace function private.function_extra_ok(_p text) returns boolean
language sql immutable set search_path = '' as $$
  select _p in ('orders.view', 'orders.update_status', 'menu.manage', 'tabs.manage', 'cash.manage', 'reports.view', 'jobs.manage', 'delivery.manage_own')
$$;

create table if not exists public.business_functions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 40),
  base_role public.member_role not null check (base_role in ('manager', 'attendant', 'kitchen', 'courier_own')),
  extras text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists business_functions_name_idx on public.business_functions(business_id, lower(btrim(name)));
create index if not exists business_functions_created_by_idx on public.business_functions(created_by);
alter table public.business_functions enable row level security;
drop policy if exists business_functions_select on public.business_functions;
create policy business_functions_select on public.business_functions for select to authenticated
  using (public.has_business_permission(business_id, 'staff.manage'));
revoke all on public.business_functions from public, anon, authenticated;
grant select on public.business_functions to authenticated;

alter table public.business_members add column if not exists function_id uuid references public.business_functions(id) on delete set null;
create index if not exists business_members_function_idx on public.business_members(function_id);

-- aplica cargo + extras da função a um integrante (uso interno)
create or replace function private.apply_function(_business uuid, _user uuid, _fn uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.business_functions%rowtype; p text;
begin
  select * into f from public.business_functions where id = _fn and business_id = _business;
  if not found then raise exception 'Função não encontrada.' using errcode = 'P0001'; end if;
  update public.business_members set member_role = f.base_role, function_id = f.id where business_id = _business and user_id = _user and member_role <> 'owner';
  if not found then raise exception 'Integrante não encontrado (o proprietário não muda de função).' using errcode = 'P0001'; end if;
  delete from public.business_member_permissions where business_id = _business and user_id = _user;
  foreach p in array f.extras loop
    insert into public.business_member_permissions(business_id, user_id, permission, granted_by) values (_business, _user, p, auth.uid()) on conflict do nothing;
  end loop;
end $$;

-- cria ou altera uma função (e reaplica a quem já usa)
create or replace function public.merchant_save_function(_business uuid, _id uuid, _name text, _base_role public.member_role, _extras text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare fid uuid; p text; u uuid; ex text[] := coalesce(_extras, '{}');
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _base_role not in ('manager', 'attendant', 'kitchen', 'courier_own') then raise exception 'Cargo base inválido.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(_name, ''))) not between 2 and 40 then raise exception 'Dê um nome de 2 a 40 letras para a função.' using errcode = 'P0001'; end if;
  foreach p in array ex loop
    if not private.function_extra_ok(p) then raise exception 'Permissão não permitida para funções: %', p using errcode = 'P0001'; end if;
  end loop;
  ex := array(select distinct unnest(ex) order by 1);
  if _id is null then
    insert into public.business_functions(business_id, name, base_role, extras, created_by) values (_business, btrim(_name), _base_role, ex, auth.uid()) returning id into fid;
  else
    update public.business_functions set name = btrim(_name), base_role = _base_role, extras = ex where id = _id and business_id = _business returning id into fid;
    if fid is null then raise exception 'Função não encontrada.' using errcode = 'P0001'; end if;
    for u in select user_id from public.business_members where business_id = _business and function_id = fid loop
      perform private.apply_function(_business, u, fid);
    end loop;
  end if;
  perform private.audit('business.function_save', 'business_functions', fid::text, jsonb_build_object('nome', btrim(_name), 'cargo', _base_role, 'extras', ex));
  return fid;
exception when unique_violation then
  raise exception 'Já existe uma função com esse nome.' using errcode = 'P0001';
end $$;

create or replace function public.merchant_delete_function(_business uuid, _id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  delete from public.business_functions where id = _id and business_id = _business;
  if not found then raise exception 'Função não encontrada.' using errcode = 'P0001'; end if;
  perform private.audit('business.function_delete', 'business_functions', _id::text, '{}'::jsonb);
end $$;

create or replace function public.merchant_apply_function(_business uuid, _user uuid, _fn uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  perform private.apply_function(_business, _user, _fn);
  perform private.audit('business.member_function', 'business_members', _business::text, jsonb_build_object('user', _user, 'funcao', _fn));
end $$;

-- convite pelo nome de usuário: entra na equipe na hora (com a função ou o cargo escolhido)
create or replace function public.merchant_invite_by_username(_business uuid, _username text, _role public.member_role, _fn uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare un text := lower(btrim(coalesce(_username, ''))); u uuid; f public.business_functions%rowtype;
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  un := regexp_replace(un, '^@', '');
  if un !~ '^[a-z0-9._]{3,30}$' then raise exception 'Nome de usuário inválido.' using errcode = 'P0001'; end if;
  select id into u from public.profiles where username = un;
  if u is null then raise exception 'Nome de usuário não encontrado. Confira com a pessoa e tente novamente.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.business_members where business_id = _business and user_id = u) then
    raise exception 'Esta pessoa já faz parte da equipe.' using errcode = 'P0001';
  end if;
  if _fn is not null then
    select * into f from public.business_functions where id = _fn and business_id = _business;
    if not found then raise exception 'Função não encontrada.' using errcode = 'P0001'; end if;
    insert into public.business_members(business_id, user_id, member_role) values (_business, u, f.base_role);
    perform private.apply_function(_business, u, f.id);
  else
    if _role is null or _role = 'owner' then raise exception 'Escolha uma função ou um cargo.' using errcode = 'P0001'; end if;
    insert into public.business_members(business_id, user_id, member_role) values (_business, u, _role);
  end if;
  perform private.audit('business.member_add', 'business_members', _business::text, jsonb_build_object('user', u, 'via', 'usuario', 'funcao', _fn, 'role', _role));
  return 'vinculado';
end $$;

-- equipe: + nome de usuário e função
drop function if exists public.merchant_team(uuid);
create function public.merchant_team(_business uuid)
returns table (user_id uuid, name text, email text, member_role public.member_role, pending boolean, invite_id uuid, created_at timestamptz,
               username text, function_id uuid, function_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.user_id, p.full_name, u.email::text, m.member_role, false, null::uuid, m.created_at, p.username, m.function_id, f.name
      from public.business_members m left join public.profiles p on p.id = m.user_id left join auth.users u on u.id = m.user_id
      left join public.business_functions f on f.id = m.function_id
     where m.business_id = _business
    union all
    select null, null, i.email, i.member_role, true, i.id, i.created_at, null, null, null
      from private.business_invites i where i.business_id = _business and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     order by 7;
end $$;

-- extras avulsos continuam pela mesma função, agora com a lista ampliada
create or replace function public.merchant_set_member_permission(_business uuid, _user uuid, _permission text, _granted boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if not private.function_extra_ok(_permission) then raise exception 'Permissão inválida.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.business_members where business_id = _business and user_id = _user and member_role <> 'owner') then
    raise exception 'Integrante não encontrado.' using errcode = 'P0001';
  end if;
  if _granted then
    insert into public.business_member_permissions(business_id, user_id, permission, granted_by) values (_business, _user, _permission, auth.uid()) on conflict do nothing;
  else
    delete from public.business_member_permissions where business_id = _business and user_id = _user and permission = _permission;
  end if;
  perform private.audit(case when _granted then 'business.member_permission_grant' else 'business.member_permission_revoke' end,
                        'business_member_permissions', _business::text, jsonb_build_object('user', _user, 'permission', _permission));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.merchant_save_function(uuid, uuid, text, public.member_role, text[])', 'public.merchant_delete_function(uuid, uuid)',
                           'public.merchant_apply_function(uuid, uuid, uuid)', 'public.merchant_invite_by_username(uuid, text, public.member_role, uuid)',
                           'public.merchant_team(uuid)', 'public.merchant_set_member_permission(uuid, uuid, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function private.apply_function(uuid, uuid, uuid) from public, anon, authenticated;
  revoke all on function private.function_extra_ok(text) from public, anon, authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0051', '0051_equipe_funcoes_usuario.sql', 'applied');
    raise notice 'Tucaí 0051: aplicada agora';
  end if;
end $tucai_0051$;

-- ===================== supabase/migrations/0052_ofertas_para_todos.sql =====================
do $tucai_0052$
begin
  if exists (select 1 from private.tucai_migrations where version = '0052') then
    raise notice 'Tucaí 0052: já aplicada';
  else
    execute $tucai_sql$
-- 0052 — Pedido da rede para TODOS os entregadores cadastrados na Tucaí.
-- Antes (0044), quem era entregador próprio de uma loja nunca via as ofertas da rede, mesmo tendo cadastro aprovado
-- de entregador parceiro. Agora: o entregador próprio continua recebendo as entregas atribuídas pela loja dele e,
-- se também tiver cadastro aprovado de entregador parceiro (com cidade) e ficar Online, vê e aceita as ofertas da
-- rede como qualquer outro. Quem aceitar primeiro leva (a atualização continua atômica).
-- Regras financeiras inalteradas: a oferta aceita é paga como entrega da rede (valores do próprio pedido);
-- entregas próprias continuam sem valor da rede (trigger da 0044).

create or replace function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint, offer_expires_at timestamptz, offer_round smallint,
               order_status public.order_status, city_name text, delivery_distance_m integer, store_lat numeric, store_lng numeric)
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); me_test boolean := private.is_test_user(c.user_id);
begin
  if not c.is_online then return; end if;
  perform private.sweep_deliveries();
  return query
    select d.order_id, b.name, b.address_line, d.courier_pay_cents, d.offered_at,
           nullif(btrim(split_part(o.delivery_address, ',', -1)), ''),
           (select count(*) from public.order_items i where i.order_id = o.id),
           d.offer_expires_at, d.offer_round, o.status, ci.name,
           o.delivery_distance_m, round(b.lat, 3), round(b.lng, 3)
      from public.deliveries d
      join public.orders o on o.id = d.order_id
      join public.businesses b on b.id = d.business_id
      left join public.cities ci on ci.id = d.city_id
     where d.status = 'offered' and d.city_id = c.city_id and d.is_test = me_test
       and o.status not in ('rejected', 'cancelled')
       and not exists (select 1 from public.delivery_declines x
                        where x.order_id = d.order_id and x.courier_id = c.user_id and x.offer_round = d.offer_round)
     order by d.offered_at;
end $$;


create or replace function public.courier_accept_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); n int; o public.orders%rowtype;
begin
  perform private.limit_for('delivery.action');
  if not c.is_online then raise exception 'Fique disponível para aceitar entregas.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.deliveries where courier_id = c.user_id and status in ('accepted', 'picked_up')) then
    raise exception 'Conclua a entrega atual antes de aceitar outra.' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'accepted', courier_id = c.user_id, accepted_at = now(), attention_reason = null, attention_at = null
   where order_id = _order and status = 'offered' and courier_id is null and city_id = c.city_id
     and is_test = private.is_test_user(c.user_id);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Esta entrega já foi aceita por outro entregador ou não está mais disponível.' using errcode = 'P0001'; end if;
  select * into o from public.orders where id = _order;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, o.status, c.user_id, 'Entrega aceita pelo entregador parceiro');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id,
    'Pedido #' || o.code || ': entregador encontrado! ' || split_part(c.full_name, ' ', 1) || ' vai buscar seu pedido.');
  perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ': entregador ' || split_part(c.full_name, ' ', 1) || ' a caminho para coletar.');
  perform private.audit('delivery.accept', 'deliveries', _order::text, '{}'::jsonb);
end $$;


do $$ begin
  revoke all on function public.courier_list_offers() from public, anon;
  grant execute on function public.courier_list_offers() to authenticated;
  revoke all on function public.courier_accept_delivery(uuid) from public, anon;
  grant execute on function public.courier_accept_delivery(uuid) to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0052', '0052_ofertas_para_todos.sql', 'applied');
    raise notice 'Tucaí 0052: aplicada agora';
  end if;
end $tucai_0052$;

-- ===================== supabase/migrations/0053_aviso_corrida_push.sql =====================
do $tucai_0053$
begin
  if exists (select 1 from private.tucai_migrations where version = '0053') then
    raise notice 'Tucaí 0053: já aplicada';
  else
    execute $tucai_sql$
-- 0053 — Aviso de corrida nova com o app em segundo plano ou fechado (Web Push, gratuito).
-- Fluxo: o entregador ativa os avisos no celular (o navegador gera um endereço de entrega de push); a cada minuto o
-- Worker (Cron Trigger) chama worker_offer_pushes com a chave de integração, recebe os endereços de quem ainda não foi
-- avisado de cada oferta aberta e envia um push SEM conteúdo (nenhum dado do pedido passa pelo serviço de push).
-- O celular mostra "Nova corrida disponível" e, ao tocar, abre a Área do entregador.
-- Avisa somente quem veria a oferta em courier_list_offers: cadastro aprovado, Online, mesma cidade, mesmo ambiente
-- (teste/real), sem entrega em andamento e sem ter recusado a rodada. Cada entregador é avisado uma vez por rodada.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (
    char_length(endpoint) <= 1000
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select on public.push_subscriptions to authenticated;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

create table if not exists private.offer_push_log (
  order_id uuid not null,
  offer_round smallint not null,
  user_id uuid not null,
  sent_at timestamptz not null default now(),
  primary key (order_id, offer_round, user_id)
);
revoke all on private.offer_push_log from public, anon, authenticated;

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('push.subscribe', 30, 3600)
on conflict (action) do nothing;

-- ativar avisos neste aparelho (cada pessoa guarda até 5 aparelhos; o mais antigo sai)
create or replace function public.push_subscribe(_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  perform private.limit_for('push.subscribe');
  if _endpoint is null or char_length(_endpoint) > 1000
     or _endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/' then
    raise exception 'Este navegador não oferece avisos compatíveis.' using errcode = '22023';
  end if;
  insert into public.push_subscriptions(user_id, endpoint) values (me, _endpoint)
  on conflict (endpoint) do update set user_id = me, created_at = now();
  delete from public.push_subscriptions
   where user_id = me and id not in (select id from public.push_subscriptions where user_id = me order by created_at desc limit 5);
end $$;

create or replace function public.push_unsubscribe(_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint = _endpoint;
end $$;

-- Worker: endereços a avisar agora (registra o aviso; não repete na mesma rodada)
create or replace function public.worker_offer_pushes(_key text) returns table (endpoint text)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from private.offer_push_log where sent_at < now() - interval '2 days';
  return query
  with alvo as (
    select d.order_id, d.offer_round, c.user_id
      from public.deliveries d
      join public.orders o on o.id = d.order_id
      join public.couriers c on c.city_id = d.city_id and c.status = 'approved' and c.is_online
     where d.status = 'offered' and d.courier_id is null
       and d.offered_at > now() - interval '30 minutes'
       and (d.offer_expires_at is null or d.offer_expires_at > now())
       and o.status not in ('rejected', 'cancelled')
       and private.is_test_user(c.user_id) = d.is_test
       and not exists (select 1 from public.delivery_declines x
                        where x.order_id = d.order_id and x.courier_id = c.user_id and x.offer_round = d.offer_round)
       and not exists (select 1 from public.deliveries a where a.courier_id = c.user_id and a.status in ('accepted', 'picked_up'))
       and exists (select 1 from public.push_subscriptions s where s.user_id = c.user_id)
  ), novos as (
    insert into private.offer_push_log(order_id, offer_round, user_id)
    select order_id, offer_round, user_id from alvo
    on conflict do nothing
    returning user_id
  ), enviados as (
    update public.push_subscriptions s set last_sent_at = now()
     where s.user_id in (select user_id from novos)
    returning s.endpoint
  )
  select e.endpoint from enviados e;
end $$;

-- Worker: endereço que o serviço de push informou como inexistente (aparelho desinstalou ou revogou)
create or replace function public.worker_push_gone(_key text, _endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = _endpoint;
end $$;

do $$ begin
  revoke all on function public.push_subscribe(text) from public, anon;
  grant execute on function public.push_subscribe(text) to authenticated;
  revoke all on function public.push_unsubscribe(text) from public, anon;
  grant execute on function public.push_unsubscribe(text) to authenticated;
  revoke all on function public.worker_offer_pushes(text) from public;
  grant execute on function public.worker_offer_pushes(text) to anon, authenticated;
  revoke all on function public.worker_push_gone(text, text) from public;
  grant execute on function public.worker_push_gone(text, text) to anon, authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0053', '0053_aviso_corrida_push.sql', 'applied');
    raise notice 'Tucaí 0053: aplicada agora';
  end if;
end $tucai_0053$;

-- ===================== supabase/migrations/0054_rota_por_etapa.sql =====================
do $tucai_0054$
begin
  if exists (select 1 from private.tucai_migrations where version = '0054') then
    raise notice 'Tucaí 0054: já aplicada';
  else
    execute $tucai_sql$
-- 0054 — Rota por etapa, traçada pelo botão do entregador (sem cálculo automático em sequência).
--  * Coleta ("Traçar rota até o restaurante"): sai de onde o entregador está agora (GPS do aparelho; sem GPS, o endereço
--    cadastrado dele, localizado no mapa) e vai até o local cadastrado do estabelecimento.
--  * Entrega ("Traçar rota até o cliente", depois de "Peguei o pedido"): sai do local cadastrado do estabelecimento
--    e vai até o ponto do cliente.
-- A rota só serve para a tela de navegação (o frete continua calculado no servidor pela 0040). O ponto de partida
-- informado pelo aparelho é validado (Brasil e até 100 km da loja). Limites da 0037 mantidos (6 por pedido; 90 s por etapa).

create or replace function private.route_request_core(_order uuid, _leg text, _from jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_leg text := private.tracking_leg(_order, auth.uid()); o public.orders%rowtype; b record; l public.delivery_locations%rowtype;
        lim int; dest jsonb; orig jsonb; rid uuid; f_lat double precision; f_lng double precision;
begin
  if auth.uid() is null or v_leg is null or v_leg is distinct from _leg then raise exception 'Esta entrega não está atribuída a você nesta etapa.' using errcode = '42501'; end if;
  select * into o from public.orders where id = _order;
  select bc.lat, bc.lng into b from public.businesses bc where bc.id = o.business_id;

  if _from is not null then
    f_lat := (_from->>'lat')::double precision; f_lng := (_from->>'lng')::double precision;
    if f_lat is null or f_lng is null or f_lat not between -34 and 6 or f_lng not between -75 and -28 then
      raise exception 'Ponto de partida inválido.' using errcode = '22023';
    end if;
    if b.lat is not null and (abs(f_lat - b.lat) > 0.9 or abs(f_lng - b.lng) > 0.9) then
      raise exception 'Você está longe demais do estabelecimento para traçar a rota (mais de 100 km).' using errcode = 'P0001';
    end if;
  end if;

  if v_leg = 'coleta' then
    if b.lat is null then raise exception 'O restaurante ainda não marcou o endereço no mapa; use o endereço escrito.' using errcode = 'P0001'; end if;
    dest := jsonb_build_object('lat', b.lat, 'lng', b.lng);
    if _from is not null then
      orig := jsonb_build_object('lat', round(f_lat::numeric, 6), 'lng', round(f_lng::numeric, 6));
    else
      select * into l from public.delivery_locations where order_id = _order and courier_id = auth.uid();
      if l.order_id is null or l.received_at < now() - interval '2 minutes' then
        raise exception 'Ligue o GPS (ou cadastre seu endereço em Meus dados) para traçar a rota até o restaurante.' using errcode = 'P0001';
      end if;
      orig := jsonb_build_object('lat', l.lat, 'lng', l.lng);
    end if;
  else
    if o.delivery_lat is null then raise exception 'O endereço do cliente ainda não foi localizado no mapa; use o endereço escrito.' using errcode = 'P0001'; end if;
    dest := jsonb_build_object('lat', o.delivery_lat, 'lng', o.delivery_lng);
    if b.lat is not null then
      orig := jsonb_build_object('lat', b.lat, 'lng', b.lng);
    elsif _from is not null then
      orig := jsonb_build_object('lat', round(f_lat::numeric, 6), 'lng', round(f_lng::numeric, 6));
    else
      select * into l from public.delivery_locations where order_id = _order and courier_id = auth.uid();
      if l.order_id is null then raise exception 'O restaurante não marcou o endereço no mapa; ligue o GPS para traçar a rota.' using errcode = 'P0001'; end if;
      orig := jsonb_build_object('lat', l.lat, 'lng', l.lng);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('route:' || _order::text));
  if (select count(*) from private.route_requests where order_id = _order) >= 6 then
    raise exception 'Limite de rotas desta entrega atingido; use o endereço escrito.' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.route_requests r where r.order_id = _order and r.leg = _leg and r.created_at > now() - interval '90 seconds') then
    raise exception 'A rota acabou de ser traçada; aguarde um pouco para traçar de novo.' using errcode = 'P0001';
  end if;
  lim := private.routing_daily_limit();
  if (select count(*) from private.route_requests where created_at > now() - interval '1 day') >= lim then
    raise exception 'Cálculo de rotas indisponível no momento; use o endereço escrito.' using errcode = 'P0001';
  end if;
  insert into private.route_requests(order_id, leg, requested_by) values (_order, _leg, auth.uid()) returning id into rid;
  return jsonb_build_object('ticket', rid, 'origin', orig, 'destination', dest);
end $$;
revoke all on function private.route_request_core(uuid, text, jsonb) from public, anon, authenticated;

-- sem ponto de partida (usa a localização compartilhada); a entrega sai da loja
create or replace function public.route_request(_order uuid, _leg text) returns jsonb
language sql security definer set search_path = '' as $$ select private.route_request_core(_order, _leg, null) $$;

-- com ponto de partida do aparelho (GPS agora ou endereço cadastrado do entregador)
create or replace function public.route_request_from(_order uuid, _leg text, _lat double precision, _lng double precision) returns jsonb
language sql security definer set search_path = '' as $$
  select private.route_request_core(_order, _leg, jsonb_build_object('lat', _lat, 'lng', _lng))
$$;

do $$ begin
  revoke all on function public.route_request(uuid, text) from public, anon;
  grant execute on function public.route_request(uuid, text) to authenticated;
  revoke all on function public.route_request_from(uuid, text, double precision, double precision) from public, anon;
  grant execute on function public.route_request_from(uuid, text, double precision, double precision) to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0054', '0054_rota_por_etapa.sql', 'applied');
    raise notice 'Tucaí 0054: aplicada agora';
  end if;
end $tucai_0054$;

-- ===================== supabase/migrations/0055_proprio_fica_online.sql =====================
do $tucai_0055$
begin
  if exists (select 1 from private.tucai_migrations where version = '0055') then
    raise notice 'Tucaí 0055: já aplicada';
  else
    execute $tucai_sql$
-- 0055 — Entregador próprio já logado fica Online direto, sem ir à página de cadastro.
-- Na primeira vez, a Área do entregador pede só celular e veículo (pré-preenchidos) e o aceite dos termos; a cidade
-- é a da loja dele e o nome é o do perfil. O cadastro nasce liberado (0050) e já fica Online. Nas próximas vezes,
-- o botão "Ficar online" funciona como para qualquer entregador.

create or replace function public.own_courier_go_online(
  _phone text, _vehicle public.courier_vehicle, _vehicle_plate text default null, _cnh_category text default null, _accept_terms boolean default false
) returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.couriers%rowtype;
  v_city uuid; v_name text;
  plate text := nullif(upper(regexp_replace(coalesce(_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g')), '');
  cnh text := nullif(upper(btrim(coalesce(_cnh_category, ''))), '');
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.submit');
  if not private.is_any_own_courier(uid) then
    raise exception 'Somente entregador próprio de um estabelecimento usa esta opção.' using errcode = '42501';
  end if;
  select * into c from public.couriers where user_id = uid for update;
  if found then
    if c.status <> 'approved' then raise exception 'Seu cadastro de entregador está em análise ou suspenso. Fale com o suporte.' using errcode = 'P0001'; end if;
    update public.couriers set is_online = true where user_id = uid;
    return c.status;
  end if;
  if not coalesce(_accept_terms, false) then raise exception 'É preciso aceitar os termos de parceria.' using errcode = 'P0001'; end if;
  if _vehicle in ('bicicleta', 'a_pe') then plate := null; cnh := null; end if;
  if _vehicle in ('moto', 'carro') and (plate is null or cnh is null) then
    raise exception 'Informe a placa e a categoria da CNH.' using errcode = 'P0001';
  end if;
  select b.city_id into v_city
    from public.business_members m join public.businesses b on b.id = m.business_id
    join public.cities ci on ci.id = b.city_id and ci.is_active
   where m.user_id = uid and m.member_role = 'courier_own'
   order by m.created_at limit 1;
  if v_city is null then raise exception 'A loja ainda não tem cidade cadastrada.' using errcode = 'P0001'; end if;
  select nullif(btrim(p.full_name), '') into v_name from public.profiles p where p.id = uid;
  if v_name is null or char_length(v_name) < 3 then raise exception 'Complete seu nome em Minha conta antes de ficar online.' using errcode = 'P0001'; end if;
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category,
                              status, terms_version, terms_accepted_at, submitted_at)
  values (uid, v_name, btrim(_phone), v_city, _vehicle, plate, cnh, 'pending', private.courier_terms_version(), now(), now());
  -- o gatilho da 0050 libera o cadastro; só então pode ficar Online
  update public.couriers set is_online = true where user_id = uid and status = 'approved';
  perform private.audit('courier.own_join_network', 'couriers', uid::text, jsonb_build_object('vehicle', _vehicle));
  return (select x.status from public.couriers x where x.user_id = uid);
end $$;

do $$ begin
  revoke all on function public.own_courier_go_online(text, public.courier_vehicle, text, text, boolean) from public, anon;
  grant execute on function public.own_courier_go_online(text, public.courier_vehicle, text, text, boolean) to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0055', '0055_proprio_fica_online.sql', 'applied');
    raise notice 'Tucaí 0055: aplicada agora';
  end if;
end $tucai_0055$;

-- ===================== supabase/migrations/0056_online_um_clique.sql =====================
do $tucai_0056$
begin
  if exists (select 1 from private.tucai_migrations where version = '0056') then
    raise notice 'Tucaí 0056: já aplicada';
  else
    execute $tucai_sql$
-- 0056 — Entregador próprio já logado: "Ficar online" com UM clique, sem digitar nada.
-- O cadastro de parceiro é criado com o que já está na conta: nome (perfil; senão o nome do login; senão o usuário),
-- telefone do perfil (quando houver) e a cidade da loja. Veículo, placa e CNH ficam "não informados" (nada é
-- inventado) e podem ser completados depois em Meus dados. O clique em "Ficar online" registra o aceite dos termos
-- de parceria (aviso exibido junto ao botão).

alter table public.couriers alter column vehicle drop not null;
alter table public.couriers alter column phone drop not null;

drop function if exists public.own_courier_go_online(text, public.courier_vehicle, text, text, boolean);

create or replace function public.own_courier_go_online() returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.couriers%rowtype;
  v_city uuid; v_name text; v_phone text;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.submit');
  if not private.is_any_own_courier(uid) then
    raise exception 'Somente entregador próprio de um estabelecimento usa esta opção.' using errcode = '42501';
  end if;
  select * into c from public.couriers where user_id = uid for update;
  if found then
    if c.status <> 'approved' then raise exception 'Seu cadastro de entregador está em análise ou suspenso. Fale com o suporte.' using errcode = 'P0001'; end if;
    update public.couriers set is_online = true where user_id = uid;
    return c.status;
  end if;
  select b.city_id into v_city
    from public.business_members m join public.businesses b on b.id = m.business_id
    join public.cities ci on ci.id = b.city_id and ci.is_active
   where m.user_id = uid and m.member_role = 'courier_own'
   order by m.created_at limit 1;
  if v_city is null then raise exception 'A loja ainda não tem cidade cadastrada.' using errcode = 'P0001'; end if;
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), nullif(btrim(u.raw_user_meta_data->>'name'), ''), p.username),
         case when p.phone ~ '^[0-9+() -]{8,20}$' then p.phone end
    into v_name, v_phone
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = uid;
  if v_name is null or char_length(v_name) < 3 then raise exception 'Complete seu nome em Minha conta antes de ficar online.' using errcode = 'P0001'; end if;
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category,
                              status, terms_version, terms_accepted_at, submitted_at)
  values (uid, left(v_name, 120), v_phone, v_city, null, null, null, 'pending', private.courier_terms_version(), now(), now());
  -- o gatilho da 0050 libera o cadastro; só então pode ficar Online
  update public.couriers set is_online = true where user_id = uid and status = 'approved';
  perform private.audit('courier.own_join_network', 'couriers', uid::text, jsonb_build_object('um_clique', true));
  return (select x.status from public.couriers x where x.user_id = uid);
end $$;

do $$ begin
  revoke all on function public.own_courier_go_online() from public, anon;
  grant execute on function public.own_courier_go_online() to authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0056', '0056_online_um_clique.sql', 'applied');
    raise notice 'Tucaí 0056: aplicada agora';
  end if;
end $tucai_0056$;

select version, name, how, applied_at from private.tucai_migrations order by version;
