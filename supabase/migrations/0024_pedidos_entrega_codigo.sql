-- 0024_pedidos_entrega_codigo: fluxo de pedido no estilo delivery, código de entrega seguro e finanças do lojista.
--  * Código de 4 dígitos sem texto aberto no banco: derivado por HMAC-SHA256 (segredo aleatório guardado no
--    schema private) do id da entrega + versão. Só o cliente do pedido consegue ver; o entregador nunca recebe.
--    Nova tentativa de entrega (liberação/redistribuição) gera nova versão e invalida o código anterior.
--  * Confirmação em duas etapas: courier_verify_code (bloqueio progressivo e auditoria sem o código) e
--    courier_finish_delivery (só com validação vigente; atômica e idempotente por identificador de operação).
--    Exceção: admin_force_complete_delivery (Master com MFA, justificativa e auditoria).
--  * Aceite do estabelecimento já coloca o pedido "em preparo"; cliente e loja são avisados quando um
--    entregador aceita ("Entregador encontrado!"). Entregas publicadas no Realtime para a loja.
--  * Homologação: o "[Teste] Mercadinho Teste" passa a usar entregador parceiro e vende Cheeseburger.
--  * Lojista: gastos (categorias, recorrência), custo por produto (privado) e painel/lucro estimado.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('delivery.verify', 30, 600), ('merchant.finance', 300, 600), ('admin.force_delivery', 10, 3600)
on conflict (action) do nothing;

-- ---------- código de entrega ----------
create table if not exists private.app_secrets (
  key text primary key,
  value bytea not null,
  created_at timestamptz not null default now()
);
revoke all on private.app_secrets from public, anon, authenticated;
insert into private.app_secrets(key, value) values ('delivery_code', extensions.gen_random_bytes(32)) on conflict (key) do nothing;

alter table public.deliveries
  add column if not exists code_version integer not null default 1,
  add column if not exists code_verified_at timestamptz,
  add column if not exists code_verified_version integer,
  add column if not exists code_locked_until timestamptz,
  add column if not exists finish_op_id uuid;
-- o código deixa de existir em texto aberto
alter table public.deliveries alter column confirmation_code drop not null;
alter table public.deliveries alter column confirmation_code drop default;
update public.deliveries set confirmation_code = null where confirmation_code is not null;

create or replace function private.delivery_code(_order uuid, _version integer) returns text
language sql stable security definer set search_path = '' as $$
  select lpad(((('x' || '00000000' || substr(encode(extensions.hmac(convert_to(_order::text || ':' || _version::text, 'UTF8'), s.value, 'sha256'), 'hex'), 1, 8))::bit(64)::bigint) % 10000)::text, 4, '0')
    from private.app_secrets s where s.key = 'delivery_code'
$$;

-- nova tentativa (entrega volta a ser oferecida): nova versão do código, tentativas zeradas
create or replace function private.deliveries_code_rotate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'offered' and old.status <> 'offered' then
    new.code_version := old.code_version + 1;
    new.code_verified_at := null; new.code_verified_version := null;
    new.code_locked_until := null; new.failed_code_attempts := 0;
  end if;
  return new;
end $$;
drop trigger if exists deliveries_code_rotate on public.deliveries;
create trigger deliveries_code_rotate before update of status on public.deliveries
  for each row execute function private.deliveries_code_rotate();

-- cliente: andamento, código (só dele, depois que um entregador aceitou) e dados permitidos do entregador
create or replace function public.my_delivery(_order uuid)
returns table (status public.delivery_status, confirmation_code text, courier_first_name text, courier_vehicle public.courier_vehicle)
language sql stable security definer set search_path = '' as $$
  select d.status,
         case when d.status in ('accepted', 'picked_up') then private.delivery_code(d.order_id, d.code_version) end,
         split_part(c.full_name, ' ', 1), c.vehicle
    from public.deliveries d join public.orders o on o.id = d.order_id left join public.couriers c on c.user_id = d.courier_id
   where d.order_id = _order and o.customer_id = auth.uid()
$$;

-- etapa 1: validar o código informado pelo cliente (no banco; o entregador nunca recebe o código esperado)
create or replace function public.courier_verify_code(_order uuid, _code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype; fails int; lock_for interval;
begin
  perform private.limit_for('delivery.verify');
  select * into d from public.deliveries where order_id = _order and courier_id = c.user_id for update;
  if not found then raise exception 'Esta entrega não está com você.' using errcode = '42501'; end if;
  if d.status <> 'picked_up' then raise exception 'A entrega não está em rota.' using errcode = 'P0001'; end if;
  if d.code_locked_until is not null and d.code_locked_until > now() then
    return jsonb_build_object('ok', false, 'locked_until', d.code_locked_until, 'reason', 'bloqueado');
  end if;
  if coalesce(btrim(_code), '') ~ '^[0-9]{4}$' and btrim(_code) = private.delivery_code(d.order_id, d.code_version) then
    update public.deliveries set code_verified_at = now(), code_verified_version = d.code_version, failed_code_attempts = 0, code_locked_until = null
     where order_id = _order;
    perform private.audit('delivery.code_ok', 'deliveries', _order::text, jsonb_build_object('version', d.code_version));
    return jsonb_build_object('ok', true);
  end if;
  fails := d.failed_code_attempts + 1;
  -- bloqueio progressivo: 3 erros → 5 min, 6 → 30 min, 10 → só com o suporte
  lock_for := case when fails >= 10 then interval '100 years' when fails >= 6 then interval '30 minutes' when fails % 3 = 0 then interval '5 minutes' end;
  update public.deliveries set failed_code_attempts = fails, code_locked_until = case when lock_for is null then null else now() + lock_for end
   where order_id = _order;
  perform private.audit('delivery.code_fail', 'deliveries', _order::text, jsonb_build_object('attempt', fails)); -- nunca o código
  if fails = 10 then perform private.notify_ops(_order, 'Entrega com código bloqueado após 10 tentativas: confira com o cliente.'); end if;
  return jsonb_build_object('ok', false, 'reason', case when lock_for is null then 'invalido' else 'bloqueado' end,
                            'locked_until', case when lock_for is null then null else now() + lock_for end);
end $$;

-- etapa 2: finalizar (exige validação vigente). Atômica: só um UPDATE condicional vence; repetir com a mesma operação é seguro.
create or replace function public.courier_finish_delivery(_order uuid, _op uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype; o public.orders%rowtype; n int;
begin
  perform private.limit_for('delivery.action');
  if _op is null then raise exception 'Operação inválida.' using errcode = 'P0001'; end if;
  select * into d from public.deliveries where order_id = _order and courier_id = c.user_id;
  if not found then raise exception 'Esta entrega não está com você.' using errcode = '42501'; end if;
  if d.status = 'delivered' then
    if d.finish_op_id = _op then return 'ja_finalizada'; end if;
    raise exception 'Esta entrega já foi concluída.' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'delivered', delivered_at = now(), finish_op_id = _op
   where order_id = _order and courier_id = c.user_id and status = 'picked_up'
     and code_verified_at is not null and code_verified_version = code_version;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Confirme o código do cliente antes de finalizar.' using errcode = 'P0001'; end if;
  update public.orders set status = 'delivered' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'delivered', c.user_id, 'Entregue com código de confirmação');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' entregue. Bom apetite!');
  perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ' entregue ao cliente.');
  perform private.audit('delivery.complete', 'deliveries', _order::text, jsonb_build_object('pay_cents', d.courier_pay_cents, 'op', _op));
  return 'finalizada';
end $$;

-- compatibilidade com a tela anterior: valida e finaliza numa chamada (mesmas regras)
create or replace function public.courier_complete_delivery(_order uuid, _code text) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  r := public.courier_verify_code(_order, _code);
  if (r->>'ok')::boolean then perform public.courier_finish_delivery(_order, gen_random_uuid()); end if;
end $$;

-- exceção administrativa (cliente sem acesso ao código, por exemplo): Master com MFA, justificativa e auditoria
create or replace function public.admin_force_complete_delivery(_order uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; o public.orders%rowtype; r text := nullif(btrim(coalesce(_reason, '')), '');
begin
  perform private.require_master_mfa();
  perform private.limit_for('admin.force_delivery');
  if r is null or char_length(r) < 10 or char_length(r) > 300 then
    raise exception 'Descreva a justificativa (10 a 300 caracteres).' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'delivered', delivered_at = now() where order_id = _order and status = 'picked_up' returning * into d;
  if not found then raise exception 'Só entregas em rota podem ser concluídas pelo suporte.' using errcode = 'P0001'; end if;
  update public.orders set status = 'delivered' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'delivered', auth.uid(), 'Concluída pelo suporte Tucaí: ' || r);
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' marcado como entregue pelo suporte.');
  perform private.audit('delivery.force_complete', 'deliveries', _order::text, jsonb_build_object('reason', r, 'courier', d.courier_id));
end $$;

-- ---------- aceite → em preparo; "Entregador encontrado!" ----------
create or replace function public.merchant_accept_order(_order uuid, _prep_minutes integer) returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  if _prep_minutes is null or _prep_minutes not between 5 and 180 then
    raise exception 'Informe o tempo de preparo entre 5 e 180 minutos.' using errcode = 'P0001';
  end if;
  select business_id into b from public.orders where id = _order;
  if b is null or not public.has_business_permission(b, 'orders.update_status') or private.kitchen_only(b) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.update_order_status(_order, 'accepted', 'Preparo estimado em ' || _prep_minutes || ' min');
  update public.orders set prep_minutes = _prep_minutes, estimated_ready_at = now() + make_interval(mins => _prep_minutes) where id = _order;
  perform public.update_order_status(_order, 'preparing');
  return 'preparing';
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

-- a loja recebe as mudanças das entregas em tempo real (RLS: só as do próprio estabelecimento)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deliveries') then
    alter publication supabase_realtime add table public.deliveries;
  end if;
end $$;

-- ---------- homologação: Mercadinho com entregador parceiro e Cheeseburger ----------
create or replace function private.prepare_test_mercadinho(_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare b uuid; mc uuid;
begin
  for b in select id from public.businesses where id = any(_ids) and is_test and business_type = 'loja' and name like '[Teste] Mercadinho%' loop
    update public.businesses set delivery_offer = 'partner' where id = b and delivery_offer <> 'partner';
    if not exists (select 1 from public.products where business_id = b and name = 'Cheeseburger') then
      select id into mc from public.menu_categories where business_id = b and name = 'Lanches';
      if mc is null then insert into public.menu_categories(business_id, name, sort_order) values (b, 'Lanches', 5) returning id into mc; end if;
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b, mc, 'Cheeseburger', 'Pão, hambúrguer, queijo e molho. Produto de homologação.', 2200, 10);
    end if;
  end loop;
end $$;
revoke all on function private.prepare_test_mercadinho(uuid[]) from public, anon, authenticated;
select private.prepare_test_mercadinho(coalesce((select array_agg(x) from private.test_data_runs r, unnest(r.business_ids) x where r.removed_at is null), '{}'));

create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; ids uuid[];
begin
  res := private.admin_create_test_data_impl(_city);
  select business_ids into ids from private.test_data_runs where id = (res->>'run_id')::uuid;
  perform private.label_test_businesses(ids);
  perform private.prepare_test_mercadinho(ids);
  return res;
end $$;

-- ---------- finanças do lojista ----------
create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category text not null check (category in ('mercadorias', 'ingredientes', 'embalagens', 'aluguel', 'energia', 'agua', 'internet',
                                             'funcionarios', 'marketing', 'outros')),
  description text check (description is null or char_length(description) <= 200),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  spent_on date not null,
  recurrence text not null default 'unica' check (recurrence in ('unica', 'mensal')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists business_expenses_business_idx on public.business_expenses(business_id, spent_on desc);
create index if not exists business_expenses_created_by_idx on public.business_expenses(created_by);
alter table public.business_expenses enable row level security;
drop policy if exists business_expenses_rw on public.business_expenses;
create policy business_expenses_rw on public.business_expenses for all to authenticated
  using (public.has_business_permission(business_id, 'reports.view'))
  with check (public.has_business_permission(business_id, 'reports.view'));
revoke all on public.business_expenses from public, anon, authenticated;
grant select, insert, update, delete on public.business_expenses to authenticated;

-- custo de cada produto: separado do cardápio público (cliente nunca vê)
create table if not exists public.business_product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  cost_cents integer not null check (cost_cents >= 0 and cost_cents <= 10000000),
  updated_at timestamptz not null default now()
);
create index if not exists business_product_costs_business_idx on public.business_product_costs(business_id);
alter table public.business_product_costs enable row level security;
drop policy if exists business_product_costs_rw on public.business_product_costs;
create policy business_product_costs_rw on public.business_product_costs for all to authenticated
  using (public.has_business_permission(business_id, 'reports.view'))
  with check (public.has_business_permission(business_id, 'reports.view')
              and exists (select 1 from public.products p where p.id = business_product_costs.product_id and p.business_id = business_product_costs.business_id));
revoke all on public.business_product_costs from public, anon, authenticated;
grant select, insert, update, delete on public.business_product_costs to authenticated;

-- painel, caixa e lucro estimado (pedidos de teste contam só em lojas de teste, que só têm pedidos de teste)
create or replace function public.merchant_finance(_business uuid, _from date, _to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
        today timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
        month timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  if _from is null or _to is null or _to < _from or _to - _from > 366 then raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001'; end if;
  return (
    with done as (select * from public.orders where business_id = _business and status in ('delivered', 'picked_up')),
    per as (select * from done where updated_at >= f and updated_at < t),
    items as (
      select i.quantity, i.line_total_cents, c.cost_cents
        from public.order_items i join per o on o.id = i.order_id left join public.business_product_costs c on c.product_id = i.product_id),
    exp as (
      -- despesa única conta se cair no período; mensal conta uma vez por mês do período, a partir do mês em que começou
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
      'custo_produtos_cents', coalesce((select sum(quantity * cost_cents) from items where cost_cents is not null), 0),
      'itens_sem_custo', (select count(*) from items where cost_cents is null),
      'vendas_itens_com_custo_cents', coalesce((select sum(line_total_cents) from items where cost_cents is not null), 0),
      'despesas_cents', coalesce((select sum(amount_cents * times) from exp), 0),
      'despesas_por_categoria', coalesce((select jsonb_object_agg(category, total) from (select category, sum(amount_cents * times) as total from exp where times > 0 group by category) x), '{}'::jsonb),
      'recebido_na_entrega_cents', coalesce((select sum(total_cents) from per where fulfillment <> 'delivery_partner'), 0),
      'caixa_hoje', coalesce((select jsonb_object_agg(payment_method, total) from (select payment_method, sum(total_cents) as total from done where updated_at >= today group by payment_method) x), '{}'::jsonb)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.delivery_code(uuid, integer)', 'private.deliveries_code_rotate()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.my_delivery(uuid)', 'public.courier_verify_code(uuid, text)', 'public.courier_finish_delivery(uuid, uuid)',
    'public.courier_complete_delivery(uuid, text)', 'public.admin_force_complete_delivery(uuid, text)',
    'public.merchant_accept_order(uuid, integer)', 'public.courier_accept_delivery(uuid)', 'public.admin_create_test_data(uuid)',
    'public.merchant_finance(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
