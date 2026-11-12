-- 0026_painel_empresarial: central do lojista.
--  * Oferta antecipada: pedido com entregador parceiro já cria a demanda de entrega ao ser feito; entregadores
--    aptos veem a oferta (com a situação do preparo) e podem aceitar antes de ficar pronto. Endereço completo só
--    depois do aceite do estabelecimento; coleta só depois de "pronto"; recusa/cancelamento cancela a entrega.
--    O código de entrega fica disponível ao cliente desde a confirmação do pedido.
--  * Planos: Padrão = "delivery" (R$ 79) e Premium = "presencial_delivery" (R$ 99), já existentes. Recursos
--    Premium (gastos, custos, calculadora, Meu Lucro) bloqueados no banco. Concessão explícita e auditada de
--    Premium para estabelecimentos de homologação (sem cobrança e sem assinatura falsa).
--  * Calculadora de custos: ingredientes, ficha técnica por produto, embalagem e custo operacional, margem e preço
--    sugerido, histórico de cálculos.
--  * Equipe da loja: convite por e-mail para gerente, atendente/comandas, cozinha e entregador próprio, usando
--    business_members e o Supabase Auth (sem contas paralelas). Tudo auditado.
--  * Visão geral do estabelecimento com números reais; aviso de pedido novo traz os itens.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('merchant.team', 60, 3600), ('merchant.costing', 600, 600), ('admin.plan_grant', 60, 3600), ('merchant.plan_request', 10, 86400)
on conflict (action) do nothing;

update public.plans set name = 'Padrão' where code = 'delivery' and name = 'Delivery';
update public.plans set name = 'Premium' where code = 'presencial_delivery' and name = 'Presencial + Delivery';

-- ---------- oferta antecipada ----------
create or replace function private.orders_offer_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid; bname text;
begin
  if new.fulfillment = 'delivery_partner' then
    select city_id, name into c, bname from public.businesses where id = new.business_id;
    insert into public.deliveries(order_id, business_id, city_id, courier_pay_cents, is_test, offer_expires_at)
    values (new.id, new.business_id, c, new.courier_pay_cents, new.is_test, now() + private.offer_window())
    on conflict (order_id) do nothing;
    perform private.offer_to_couriers(new.id, 'Nova entrega disponível: ' || left(bname, 80) || '.');
  end if;
  return null;
end $$;
drop trigger if exists orders_offer_on_insert on public.orders;
create trigger orders_offer_on_insert after insert on public.orders for each row execute function private.orders_offer_on_insert();

create or replace function private.orders_delivery_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid; d public.deliveries%rowtype;
begin
  if new.fulfillment = 'delivery_partner' and new.status = 'ready' and old.status <> 'ready' then
    select * into d from public.deliveries where order_id = new.id;
    if not found then
      select city_id into c from public.businesses where id = new.business_id;
      insert into public.deliveries(order_id, business_id, city_id, courier_pay_cents, is_test, offer_expires_at)
      values (new.id, new.business_id, c, new.courier_pay_cents, new.is_test, now() + private.offer_window());
      perform private.offer_to_couriers(new.id, 'Nova entrega pronta para coleta perto de você.');
    elsif d.status = 'accepted' then
      perform private.notify_link(d.courier_id, 'order_update', null, '/entregador/entregas', 'Pedido #' || new.code || ' pronto para coleta.');
    elsif d.status = 'offered' then
      -- pronto e ainda sem entregador: as rodadas de oferta passam a contar a partir de agora
      update public.deliveries set offer_round = 1, offer_expires_at = now() + private.offer_window() where order_id = new.id;
      perform private.offer_to_couriers(new.id, 'Entrega pronta para coleta perto de você.');
    end if;
  elsif new.status in ('cancelled', 'rejected') and old.status <> new.status then
    select * into d from public.deliveries where order_id = new.id;
    update public.deliveries set status = 'cancelled' where order_id = new.id and status in ('offered', 'accepted', 'picked_up');
    if d.courier_id is not null and d.status in ('accepted', 'picked_up') then
      perform private.notify_link(d.courier_id, 'order_update', null, '/entregador/entregas',
        'Pedido #' || new.code || ' foi ' || case when new.status = 'rejected' then 'recusado' else 'cancelado' end || ' pelo estabelecimento. Entrega cancelada.');
    end if;
  end if;
  return null;
end $$;

-- antes de "pronto", ofertas vencidas só se renovam (sem alerta); rodadas e alertas contam depois de pronto
create or replace function private.sweep_deliveries() returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; n int := 0; code text; ost public.order_status; ready_at timestamptz;
begin
  for d in select * from public.deliveries where status = 'offered' and offer_expires_at < now() for update skip locked loop
    select o.code, o.status into code, ost from public.orders o where o.id = d.order_id;
    if ost in ('placed', 'accepted', 'preparing') then
      update public.deliveries set offer_expires_at = now() + private.offer_window() where order_id = d.order_id;
    elsif d.offer_round < private.offer_max_rounds() then
      update public.deliveries set offer_round = offer_round + 1, offer_expires_at = now() + private.offer_window() where order_id = d.order_id;
      perform private.offer_to_couriers(d.order_id, 'Entrega ainda aguardando entregador perto de você.');
    elsif d.attention_reason is null then
      update public.deliveries set attention_reason = 'Sem entregador após ' || private.offer_max_rounds() || ' rodadas de oferta', attention_at = now()
       where order_id = d.order_id;
      perform private.notify_ops(d.order_id, 'Pedido #' || code || ': nenhum entregador aceitou a entrega.');
    else
      continue;
    end if;
    n := n + 1;
  end loop;
  for d in select dd.* from public.deliveries dd join public.orders o on o.id = dd.order_id
            where dd.status = 'accepted' and dd.attention_reason is null and o.status = 'ready'
              and greatest(dd.accepted_at, o.updated_at) < now() - private.pickup_deadline()
            for update of dd skip locked loop
    select o.code into code from public.orders o where o.id = d.order_id;
    update public.deliveries set attention_reason = 'Entregador não coletou em ' || extract(epoch from private.pickup_deadline())::int / 60 || ' min', attention_at = now()
     where order_id = d.order_id;
    perform private.notify_ops(d.order_id, 'Pedido #' || code || ': entregador ainda não coletou.');
    n := n + 1;
  end loop;
  return n;
end $$;

drop function if exists public.courier_list_offers();
create function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint, offer_expires_at timestamptz, offer_round smallint,
               order_status public.order_status, city_name text)
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); me_test boolean := private.is_test_user(c.user_id);
begin
  if not c.is_online then return; end if;
  perform private.sweep_deliveries();
  return query
    select d.order_id, b.name, b.address_line, d.courier_pay_cents, d.offered_at,
           nullif(btrim(split_part(o.delivery_address, ',', -1)), ''),
           (select count(*) from public.order_items i where i.order_id = o.id),
           d.offer_expires_at, d.offer_round, o.status, ci.name
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

-- coleta só depois de o estabelecimento marcar "pronto"
create or replace function public.courier_pickup_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); o public.orders%rowtype;
begin
  perform private.limit_for('delivery.action');
  select * into o from public.orders where id = _order;
  if not exists (select 1 from public.deliveries where order_id = _order and courier_id = c.user_id and status = 'accepted') then
    raise exception 'Entrega não está aceita por você.' using errcode = 'P0001';
  end if;
  if o.status <> 'ready' then
    raise exception 'O estabelecimento ainda não marcou o pedido como pronto.' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'picked_up', picked_up_at = now() where order_id = _order and courier_id = c.user_id and status = 'accepted';
  update public.orders set status = 'out_for_delivery' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'out_for_delivery', c.user_id, 'Coletado pelo entregador parceiro');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' está a caminho.');
  perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ' coletado pelo entregador.');
end $$;

-- entrega do entregador: endereço e contato do cliente só depois do aceite do estabelecimento
drop function if exists public.courier_my_deliveries(boolean);
create function public.courier_my_deliveries(_active boolean default true)
returns table (order_id uuid, order_code text, status public.delivery_status, business_name text, business_address text,
               business_phone text, customer_name text, customer_phone text, delivery_address text, delivery_reference text,
               payment_method public.order_payment, total_cents integer, change_for_cents integer, courier_pay_cents integer,
               accepted_at timestamptz, delivered_at timestamptz, order_status public.order_status)
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  return query
    select d.order_id, o.code, d.status, b.name, b.address_line, b.phone,
           case when o.status = 'placed' then null else o.customer_name end,
           case when o.status = 'placed' then null else o.customer_phone end,
           case when o.status = 'placed' then nullif(btrim(split_part(o.delivery_address, ',', -1)), '') else o.delivery_address end,
           case when o.status = 'placed' then null else o.delivery_reference end,
           o.payment_method, o.total_cents, o.change_for_cents, d.courier_pay_cents, d.accepted_at, d.delivered_at, o.status
      from public.deliveries d join public.orders o on o.id = d.order_id join public.businesses b on b.id = d.business_id
     where d.courier_id = c.user_id
       and ((_active and d.status in ('accepted', 'picked_up')) or (not _active and d.status = 'delivered'))
     order by coalesce(d.delivered_at, d.accepted_at) desc
     limit 100;
end $$;

-- código disponível ao cliente desde a confirmação do pedido (só ele vê; o entregador nunca recebe)
create or replace function public.my_delivery(_order uuid)
returns table (status public.delivery_status, confirmation_code text, courier_first_name text, courier_vehicle public.courier_vehicle)
language sql stable security definer set search_path = '' as $$
  select d.status,
         case when d.status in ('offered', 'accepted', 'picked_up') then private.delivery_code(d.order_id, d.code_version) end,
         split_part(c.full_name, ' ', 1), c.vehicle
    from public.deliveries d join public.orders o on o.id = d.order_id left join public.couriers c on c.user_id = d.courier_id
   where d.order_id = _order and o.customer_id = auth.uid()
$$;

-- aviso de pedido novo para a equipe traz os itens ("Pedido #ABC — 1× Cheeseburger")
create or replace function private.notify_order_staff(_order public.orders, _kind text, _message text)
returns void language plpgsql security definer set search_path = '' as $$
declare m uuid; msg text := _message; items text;
begin
  if _kind = 'order_new' then
    select string_agg(i.quantity || '× ' || i.name, ', ' order by i.name) into items from public.order_items i where i.order_id = _order.id;
    if items is not null then msg := left('Novo pedido #' || _order.code || ' — ' || items, 280); end if;
  end if;
  for m in select bm.user_id from public.business_members bm
             join public.role_permissions rp on rp.member_role = bm.member_role and rp.permission = 'orders.view'
            where bm.business_id = _order.business_id loop
    perform private.notify_link(m, _kind, _order.customer_id, '/painel/' || _order.business_id || '/pedidos', msg);
  end loop;
end $$;

-- ---------- planos e Premium ----------
create table if not exists private.plan_grants (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  plan_code text not null references public.plans(code),
  reason text not null check (char_length(reason) between 5 and 200),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
revoke all on private.plan_grants from public, anon, authenticated;

-- plano vigente: assinatura ativa; senão concessão de homologação (só lojas de teste)
create or replace function private.business_plan_code(_business uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.plan_code from public.business_subscriptions s where s.business_id = _business and s.status = 'active' and s.current_period_end >= current_date limit 1),
    (select g.plan_code from private.plan_grants g join public.businesses b on b.id = g.business_id where g.business_id = _business and b.is_test))
$$;

create or replace function public.business_has_premium(_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.business_plan_code(_business) = 'presencial_delivery', false)
$$;

create or replace function private.require_premium(_business uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.business_has_premium(_business) then
    raise exception 'Recurso do Plano Premium (R$ 99/mês). Fale com a Tucaí para mudar de plano.' using errcode = '42501';
  end if;
end $$;

create or replace function public.business_plan(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_code text; src text; s public.business_subscriptions%rowtype;
begin
  if not (public.is_business_member(_business) or public.has_platform_permission('finance.view')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into s from public.business_subscriptions where business_id = _business and status = 'active' and current_period_end >= current_date limit 1;
  if found then v_code := s.plan_code; src := 'assinatura';
  else
    select g.plan_code into v_code from private.plan_grants g join public.businesses b on b.id = g.business_id where g.business_id = _business and b.is_test;
    src := case when v_code is null then null else 'homologacao' end;
  end if;
  return jsonb_build_object('plan_code', v_code, 'plan_name', (select p.name from public.plans p where p.code = v_code),
                            'premium', coalesce(v_code = 'presencial_delivery', false), 'source', src,
                            'period_end', case when src = 'assinatura' then s.current_period_end end);
end $$;

create or replace function public.admin_grant_test_plan(_business uuid, _plan text, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  perform private.limit_for('admin.plan_grant');
  if not exists (select 1 from public.businesses where id = _business and is_test) then
    raise exception 'Concessão de plano sem cobrança só para estabelecimentos de homologação.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.plans where code = _plan) then raise exception 'Plano inválido.' using errcode = 'P0001'; end if;
  insert into private.plan_grants(business_id, plan_code, reason, granted_by) values (_business, _plan, btrim(_reason), auth.uid())
  on conflict (business_id) do update set plan_code = excluded.plan_code, reason = excluded.reason, granted_by = excluded.granted_by, created_at = now();
  perform private.audit('plan.test_grant', 'businesses', _business::text, jsonb_build_object('plan', _plan, 'reason', btrim(_reason)));
end $$;

create or replace function public.admin_revoke_test_plan(_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_master();
  delete from private.plan_grants where business_id = _business;
  if not found then raise exception 'Sem concessão para este estabelecimento.' using errcode = 'P0001'; end if;
  perform private.audit('plan.test_revoke', 'businesses', _business::text, '{}'::jsonb);
end $$;

create or replace function public.admin_plan_grants()
returns table (business_id uuid, business_name text, plan_code text, plan_name text, reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('finance.view');
  return query select g.business_id, b.name, g.plan_code, p.name, g.reason, g.created_at
    from private.plan_grants g join public.businesses b on b.id = g.business_id join public.plans p on p.code = g.plan_code
   order by g.created_at desc;
end $$;

-- lojista pede mudança de plano (upgrade/downgrade): a Tucaí é avisada; dados nunca são apagados no downgrade
create or replace function public.merchant_request_plan_change(_business uuid, _plan text) returns void
language plpgsql security definer set search_path = '' as $$
declare m uuid; bname text; pname text;
begin
  if not public.has_business_permission(_business, 'settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.plan_request');
  select name into pname from public.plans where code = _plan and is_active;
  if pname is null then raise exception 'Plano inválido.' using errcode = 'P0001'; end if;
  select name into bname from public.businesses where id = _business;
  for m in select user_id from public.user_roles where role = 'platform_master' loop
    perform private.notify_link(m, 'ops_alert', null, '/admin/financeiro', left(bname || ' pediu o plano ' || pname || '.', 280));
  end loop;
  perform private.audit('plan.change_request', 'businesses', _business::text, jsonb_build_object('plan', _plan));
end $$;

-- homologação: o Mercadinho de teste recebe Premium (concessão explícita, auditada, sem cobrança)
do $$
declare b uuid;
begin
  for b in select id from public.businesses where is_test and business_type = 'loja' and name like '[Teste] Mercadinho%' loop
    insert into private.plan_grants(business_id, plan_code, reason) values (b, 'presencial_delivery', 'Homologação: Mercadinho de teste com todos os recursos')
    on conflict (business_id) do nothing;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (null, 'plan.test_grant', 'businesses', b::text, '{"plan":"presencial_delivery","reason":"Homologação (migração 0026)"}'::jsonb);
  end loop;
end $$;

create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; ids uuid[]; b uuid;
begin
  res := private.admin_create_test_data_impl(_city);
  select business_ids into ids from private.test_data_runs where id = (res->>'run_id')::uuid;
  perform private.label_test_businesses(ids);
  perform private.prepare_test_mercadinho(ids);
  for b in select id from public.businesses where id = any(ids) and business_type = 'loja' and name like '[Teste] Mercadinho%'
             and not exists (select 1 from private.plan_grants g where g.business_id = businesses.id) loop
    perform public.admin_grant_test_plan(b, 'presencial_delivery', 'Homologação: Mercadinho de teste com todos os recursos');
  end loop;
  return res;
end $$;

-- recursos Premium bloqueados também na leitura/gravação direta das tabelas
drop policy if exists business_expenses_rw on public.business_expenses;
create policy business_expenses_rw on public.business_expenses for all to authenticated
  using (public.has_business_permission(business_id, 'reports.view') and public.business_has_premium(business_id))
  with check (public.has_business_permission(business_id, 'reports.view') and public.business_has_premium(business_id));
drop policy if exists business_product_costs_rw on public.business_product_costs;
create policy business_product_costs_rw on public.business_product_costs for all to authenticated
  using (public.has_business_permission(business_id, 'reports.view') and public.business_has_premium(business_id))
  with check (public.has_business_permission(business_id, 'reports.view') and public.business_has_premium(business_id)
              and exists (select 1 from public.products p where p.id = business_product_costs.product_id and p.business_id = business_product_costs.business_id));

-- ---------- calculadora de custos ----------
alter table public.business_product_costs
  add column if not exists packaging_cents integer not null default 0 check (packaging_cents between 0 and 10000000),
  add column if not exists operational_cents integer not null default 0 check (operational_cents between 0 and 10000000),
  add column if not exists target_margin_bps integer not null default 3000 check (target_margin_bps between 0 and 9000);
alter table public.business_product_costs alter column cost_cents set default 0;

create table if not exists public.business_ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  unit text not null check (unit in ('un', 'kg', 'g', 'l', 'ml')),
  purchase_cost_cents integer not null check (purchase_cost_cents > 0 and purchase_cost_cents <= 100000000),
  purchase_qty numeric(12, 3) not null check (purchase_qty > 0),
  updated_at timestamptz not null default now()
);
create index if not exists business_ingredients_business_idx on public.business_ingredients(business_id, name);

create table if not exists public.product_recipe_items (
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.business_ingredients(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  quantity numeric(12, 3) not null check (quantity > 0),
  primary key (product_id, ingredient_id)
);
create index if not exists product_recipe_items_ingredient_idx on public.product_recipe_items(ingredient_id);
create index if not exists product_recipe_items_business_idx on public.product_recipe_items(business_id);

create table if not exists public.business_costing_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  price_cents integer not null,
  cost_cents integer not null,
  fee_cents integer not null,
  margin_cents integer not null,
  margin_bps integer not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists business_costing_snapshots_business_idx on public.business_costing_snapshots(business_id, created_at desc);
create index if not exists business_costing_snapshots_product_idx on public.business_costing_snapshots(product_id);
create index if not exists business_costing_snapshots_created_by_idx on public.business_costing_snapshots(created_by);

do $$
declare t text;
begin
  foreach t in array array['business_ingredients', 'product_recipe_items', 'business_costing_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.has_business_permission(business_id, %L) and public.business_has_premium(business_id)) with check (public.has_business_permission(business_id, %L) and public.business_has_premium(business_id))',
                   t || '_rw', t, 'reports.view', 'reports.view');
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- custo unitário do produto: ficha técnica (se houver) senão custo informado; + embalagem + operacional
create or replace function private.product_unit_cost(_product uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (coalesce(
            (select round(sum(r.quantity * i.purchase_cost_cents / i.purchase_qty))::int
               from public.product_recipe_items r join public.business_ingredients i on i.id = r.ingredient_id where r.product_id = _product),
            (select c.cost_cents from public.business_product_costs c where c.product_id = _product))
          + coalesce((select c.packaging_cents + c.operational_cents from public.business_product_costs c where c.product_id = _product), 0))
$$;

create or replace function public.merchant_costing(_business uuid)
returns table (product_id uuid, name text, price_cents integer, recipe_cents integer, manual_cents integer, packaging_cents integer,
               operational_cents integer, unit_cost_cents integer, fee_cents integer, margin_cents integer, margin_bps integer,
               target_margin_bps integer, suggested_price_cents integer, has_cost boolean, ingredients bigint)
language plpgsql stable security definer set search_path = '' as $$
declare cfg jsonb; bps int; thr int;
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.require_premium(_business);
  select config into cfg from public.pricing_configs where is_current;
  bps := coalesce((cfg->>'commissionBps')::int, 200); thr := coalesce((cfg->>'commissionThresholdCents')::int, 5000);
  return query
    with base as (
      select p.id, p.name, p.price_cents,
             (select round(sum(r.quantity * i.purchase_cost_cents / i.purchase_qty))::int
                from public.product_recipe_items r join public.business_ingredients i on i.id = r.ingredient_id where r.product_id = p.id) as recipe,
             c.cost_cents as manual, coalesce(c.packaging_cents, 0) as pack, coalesce(c.operational_cents, 0) as op,
             coalesce(c.target_margin_bps, 3000) as target,
             (select count(*) from public.product_recipe_items r where r.product_id = p.id) as ing
        from public.products p left join public.business_product_costs c on c.product_id = p.id
       where p.business_id = _business and not p.is_demo)
    select b.id, b.name, b.price_cents, b.recipe, b.manual, b.pack, b.op,
           coalesce(b.recipe, b.manual, 0) + b.pack + b.op,
           -- comissão estimada: 2% quando o pedido passa de R$ 50 (aqui, se o próprio item já passa)
           case when b.price_cents > thr then round(b.price_cents * bps / 10000.0)::int else 0 end,
           b.price_cents - (coalesce(b.recipe, b.manual, 0) + b.pack + b.op) - case when b.price_cents > thr then round(b.price_cents * bps / 10000.0)::int else 0 end,
           case when b.price_cents > 0 then round((b.price_cents - (coalesce(b.recipe, b.manual, 0) + b.pack + b.op)
                                                   - case when b.price_cents > thr then round(b.price_cents * bps / 10000.0)::int else 0 end) * 10000.0 / b.price_cents)::int else 0 end,
           b.target,
           case when b.target < 10000 then ceil((coalesce(b.recipe, b.manual, 0) + b.pack + b.op) / (1 - b.target / 10000.0))::int end,
           (b.recipe is not null or b.manual is not null), b.ing
      from base b order by b.name;
end $$;

create or replace function public.merchant_save_costing_snapshot(_business uuid, _product uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r record; sid uuid;
begin
  perform private.limit_for('merchant.costing');
  select * into r from public.merchant_costing(_business) x where x.product_id = _product;
  if r.product_id is null then raise exception 'Produto não encontrado.' using errcode = 'P0001'; end if;
  insert into public.business_costing_snapshots(business_id, product_id, product_name, price_cents, cost_cents, fee_cents, margin_cents, margin_bps, created_by)
  values (_business, _product, r.name, r.price_cents, r.unit_cost_cents, r.fee_cents, r.margin_cents, r.margin_bps, auth.uid())
  returning id into sid;
  return sid;
end $$;

-- Meu Lucro (Premium): custo dos itens pela ficha técnica/custo informado
create or replace function public.merchant_finance(_business uuid, _from date, _to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
        today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        month timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.require_premium(_business);
  if _from is null or _to is null or _to < _from or _to - _from > 366 then raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001'; end if;
  return (
    with done as (select * from public.orders where business_id = _business and status in ('delivered', 'picked_up')),
    per as (select * from done where updated_at >= f and updated_at < t),
    items as (
      select i.quantity, i.line_total_cents, case when i.product_id is null then null else private.product_unit_cost(i.product_id) end as unit_cost
        from public.order_items i join per o on o.id = i.order_id),
    exp as (
      select e.*, case
               when e.recurrence = 'unica' then (case when e.spent_on between _from and _to then 1 else 0 end)
               when e.spent_on > _to then 0
               else ((extract(year from _to) * 12 + extract(month from _to))
                     - (extract(year from greatest(e.spent_on, _from)) * 12 + extract(month from greatest(e.spent_on, _from))) + 1)::int
             end as times
        from public.business_expenses e where e.business_id = _business)
    select jsonb_build_object(
      'hoje_cents', coalesce((select sum(subtotal_cents) from done where updated_at >= today), 0),
      'mes_cents', coalesce((select sum(subtotal_cents) from done where updated_at >= month), 0),
      'pedidos', (select count(*) from per),
      'ticket_medio_cents', coalesce((select round(avg(subtotal_cents)) from per), 0)::int,
      'cancelados', (select count(*) from public.orders where business_id = _business and status in ('rejected', 'cancelled') and updated_at >= f and updated_at < t),
      'faturamento_bruto_cents', coalesce((select sum(subtotal_cents + case when fulfillment = 'delivery_own' then delivery_fee_cents else 0 end) from per), 0),
      'comissao_cents', coalesce((select sum(commission_cents) from per), 0),
      'taxas_entrega_cents', coalesce((select sum(merchant_delivery_contribution_cents + platform_delivery_fee_cents) from per), 0),
      'custo_produtos_cents', coalesce((select sum(quantity * unit_cost) from items where unit_cost is not null), 0),
      'itens_sem_custo', (select count(*) from items where unit_cost is null),
      'vendas_itens_com_custo_cents', coalesce((select sum(line_total_cents) from items where unit_cost is not null), 0),
      'despesas_cents', coalesce((select sum(amount_cents * times) from exp), 0),
      'despesas_por_categoria', coalesce((select jsonb_object_agg(category, total) from (select category, sum(amount_cents * times) as total from exp where times > 0 group by category) x), '{}'::jsonb),
      'recebido_na_entrega_cents', coalesce((select sum(total_cents) from per where fulfillment <> 'delivery_partner'), 0),
      'caixa_hoje', coalesce((select jsonb_object_agg(payment_method, total) from (select payment_method, sum(total_cents) as total from done where updated_at >= today group by payment_method) x), '{}'::jsonb)));
end $$;

-- ---------- visão geral (todos os planos) ----------
create or replace function public.merchant_overview(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        month timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        premium boolean := public.business_has_premium(_business);
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    with o as (select * from public.orders where business_id = _business and created_at >= month - interval '14 days')
    select jsonb_build_object(
      'premium', premium,
      'recebidos_hoje', (select count(*) from o where created_at >= today),
      'concluidos_hoje', (select count(*) from o where status in ('delivered', 'picked_up') and updated_at >= today),
      'cancelados_hoje', (select count(*) from o where status in ('rejected', 'cancelled') and updated_at >= today),
      'em_andamento', (select count(*) from public.orders x where x.business_id = _business and x.status in ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery')),
      'faturamento_hoje_cents', coalesce((select sum(subtotal_cents) from o where status in ('delivered', 'picked_up') and updated_at >= today), 0),
      'faturamento_mes_cents', coalesce((select sum(subtotal_cents) from o where status in ('delivered', 'picked_up') and updated_at >= month), 0),
      'ticket_medio_cents', coalesce((select round(avg(subtotal_cents)) from o where status in ('delivered', 'picked_up') and updated_at >= month), 0)::int,
      'recebido_mes_cents', coalesce((select sum(total_cents) from o where status in ('delivered', 'picked_up') and updated_at >= month and fulfillment <> 'delivery_partner'), 0),
      'pendente_cents', coalesce((select sum(total_cents) from public.orders x where x.business_id = _business and x.status in ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery')), 0),
      'taxas_mes_cents', coalesce((select sum(commission_cents + merchant_delivery_contribution_cents + platform_delivery_fee_cents) from o where status in ('delivered', 'picked_up') and updated_at >= month), 0),
      'despesas_mes_cents', case when premium then coalesce((select sum(amount_cents) from public.business_expenses e where e.business_id = _business
                                   and (e.recurrence = 'mensal' and e.spent_on < (month + interval '1 month') or e.spent_on >= month::date)), 0) end,
      'serie', coalesce((select jsonb_agg(jsonb_build_object('dia', d::date, 'cents', coalesce((select sum(subtotal_cents) from o
                           where status in ('delivered', 'picked_up') and (updated_at at time zone 'America/Sao_Paulo')::date = d::date), 0)) order by d)
                          from generate_series((now() at time zone 'America/Sao_Paulo')::date - 13, (now() at time zone 'America/Sao_Paulo')::date, interval '1 day') d), '[]'::jsonb)));
end $$;

-- ---------- equipe da loja ----------
create table if not exists private.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  member_role public.member_role not null check (member_role <> 'owner'),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz
);
create unique index if not exists business_invites_open_idx on private.business_invites(business_id, email) where accepted_at is null and revoked_at is null;
revoke all on private.business_invites from public, anon, authenticated;

create or replace function public.merchant_invite_member(_business uuid, _email text, _role public.member_role) returns text
language plpgsql security definer set search_path = '' as $$
declare e text := lower(btrim(coalesce(_email, ''))); u uuid;
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _role = 'owner' then raise exception 'O proprietário não é convidado pela equipe.' using errcode = 'P0001'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.' using errcode = 'P0001'; end if;
  select id into u from auth.users where lower(email) = e;
  if u is not null then
    if exists (select 1 from public.business_members where business_id = _business and user_id = u) then
      raise exception 'Esta pessoa já faz parte da equipe.' using errcode = 'P0001';
    end if;
    insert into public.business_members(business_id, user_id, member_role) values (_business, u, _role);
    perform private.audit('business.member_add', 'business_members', _business::text, jsonb_build_object('user', u, 'role', _role));
    return 'vinculado';
  end if;
  update private.business_invites set revoked_at = now() where business_id = _business and email = e and accepted_at is null and revoked_at is null;
  insert into private.business_invites(business_id, email, member_role, invited_by) values (_business, e, _role, auth.uid());
  perform private.audit('business.member_invite', 'business_invites', _business::text, jsonb_build_object('email', e, 'role', _role));
  return 'convidado';
end $$;

create or replace function public.merchant_team(_business uuid)
returns table (user_id uuid, name text, email text, member_role public.member_role, pending boolean, invite_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.user_id, p.full_name, u.email::text, m.member_role, false, null::uuid, m.created_at
      from public.business_members m left join public.profiles p on p.id = m.user_id left join auth.users u on u.id = m.user_id
     where m.business_id = _business
    union all
    select null, null, i.email, i.member_role, true, i.id, i.created_at
      from private.business_invites i where i.business_id = _business and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     order by 7;
end $$;

create or replace function public.merchant_set_member_role(_business uuid, _user uuid, _role public.member_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _role = 'owner' then raise exception 'A propriedade não é transferida por aqui.' using errcode = 'P0001'; end if;
  update public.business_members set member_role = _role where business_id = _business and user_id = _user and member_role <> 'owner';
  if not found then raise exception 'Integrante não encontrado (o proprietário não pode ser alterado).' using errcode = 'P0001'; end if;
  perform private.audit('business.member_role', 'business_members', _business::text, jsonb_build_object('user', _user, 'role', _role));
end $$;

create or replace function public.merchant_remove_member(_business uuid, _user uuid, _invite uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _invite is not null then
    update private.business_invites set revoked_at = now() where id = _invite and business_id = _business and accepted_at is null and revoked_at is null;
    if not found then raise exception 'Convite não encontrado.' using errcode = 'P0001'; end if;
    perform private.audit('business.member_invite_revoke', 'business_invites', _business::text, jsonb_build_object('invite', _invite));
    return;
  end if;
  if _user = auth.uid() then raise exception 'Você não pode remover a si mesmo.' using errcode = 'P0001'; end if;
  delete from public.business_members where business_id = _business and user_id = _user and member_role <> 'owner';
  if not found then raise exception 'Integrante não encontrado (o proprietário não pode ser removido).' using errcode = 'P0001'; end if;
  perform private.audit('business.member_remove', 'business_members', _business::text, jsonb_build_object('user', _user));
end $$;

-- ao ativar a conta pelo link, o convite da loja é aplicado
create or replace function private.claim_business_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i private.business_invites%rowtype;
begin
  if new.email_confirmed_at is null or (tg_op = 'UPDATE' and old.email_confirmed_at is not null) then return new; end if;
  for i in select * from private.business_invites where email = lower(new.email) and accepted_at is null and revoked_at is null and expires_at > now() loop
    insert into public.business_members(business_id, user_id, member_role) values (i.business_id, new.id, i.member_role) on conflict do nothing;
    update private.business_invites set accepted_at = now() where id = i.id;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (new.id, 'business.member_invite_accept', 'business_members', i.business_id::text, jsonb_build_object('role', i.member_role));
  end loop;
  return new;
end $$;
drop trigger if exists claim_business_invites on auth.users;
create trigger claim_business_invites after insert or update of email_confirmed_at on auth.users
  for each row execute function private.claim_business_invites();

-- ---------- permissões ----------
do $$
declare f text;
begin
  foreach f in array array['private.orders_offer_on_insert()', 'private.orders_delivery_sync()', 'private.sweep_deliveries()',
                           'private.notify_order_staff(public.orders, text, text)',
                           'private.business_plan_code(uuid)', 'private.require_premium(uuid)', 'private.product_unit_cost(uuid)',
                           'private.claim_business_invites()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.courier_list_offers()', 'public.courier_pickup_delivery(uuid)', 'public.courier_my_deliveries(boolean)', 'public.my_delivery(uuid)',
    'public.business_has_premium(uuid)', 'public.business_plan(uuid)', 'public.admin_grant_test_plan(uuid, text, text)',
    'public.admin_revoke_test_plan(uuid)', 'public.admin_plan_grants()', 'public.merchant_request_plan_change(uuid, text)',
    'public.admin_create_test_data(uuid)', 'public.merchant_costing(uuid)', 'public.merchant_save_costing_snapshot(uuid, uuid)',
    'public.merchant_finance(uuid, date, date)', 'public.merchant_overview(uuid)', 'public.merchant_invite_member(uuid, text, public.member_role)',
    'public.merchant_team(uuid)', 'public.merchant_set_member_role(uuid, uuid, public.member_role)', 'public.merchant_remove_member(uuid, uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
