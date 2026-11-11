-- 0011_orders: pedidos reais (delivery e retirada) com preço calculado no servidor.
--  * O navegador envia só ids e quantidades; preços, adicionais, frete e comissão saem do banco
--    e da configuração de preços versionada (pricing_configs), gravados como snapshot imutável.
--  * Idempotência por chave do cliente (evita pedido duplicado em clique duplo ou rede instável).
--  * Verifica loja ativa e aberta, disponibilidade, grupos de adicionais, pedido mínimo e modalidade.
--  * Pagamento na entrega ou na retirada (dinheiro, Pix ou cartão na maquininha do estabelecimento):
--    nenhum pagamento online é simulado enquanto o provedor não for contratado.
--  * Transições de status autorizadas por papel, com histórico e notificações.
--  * Avaliação verificada: só quem recebeu o pedido avalia, uma vez por pedido; o estabelecimento responde.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('order.place', 10, 600), ('order.status', 300, 600), ('order.review', 10, 86400), ('order.reply', 60, 600);

create type public.order_status as enum
  ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up', 'rejected', 'cancelled');
create type public.order_fulfillment as enum ('delivery_own', 'delivery_partner', 'pickup');
create type public.order_payment as enum ('cash', 'pix_on_delivery', 'card_on_delivery');

-- notificações de pedidos
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'like', 'comment', 'reply', 'follow', 'moderation',
  'friend_request', 'friend_accept', 'scrap', 'testimonial', 'community_request', 'community_accept', 'topic_reply',
  'order_new', 'order_update', 'delivery_offer'));
alter table public.notifications drop constraint notifications_link_check;
alter table public.notifications add constraint notifications_link_check
  check (link is null or link ~ '^/(conectuai|pedidos|painel|entregador)/[A-Za-z0-9/_-]*$');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  customer_id uuid not null references auth.users(id),
  business_id uuid not null references public.businesses(id),
  status public.order_status not null default 'placed',
  fulfillment public.order_fulfillment not null,
  payment_method public.order_payment not null,
  change_for_cents integer check (change_for_cents is null or change_for_cents > 0),
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  customer_phone text not null check (customer_phone ~ '^[0-9+() -]{8,20}$'),
  delivery_address text check (delivery_address is null or char_length(delivery_address) between 5 and 300),
  delivery_reference text check (delivery_reference is null or char_length(delivery_reference) <= 200),
  notes text check (notes is null or char_length(notes) <= 500),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  commission_cents integer not null default 0 check (commission_cents >= 0),
  merchant_delivery_contribution_cents integer not null default 0 check (merchant_delivery_contribution_cents >= 0),
  courier_pay_cents integer not null default 0 check (courier_pay_cents >= 0),
  platform_delivery_fee_cents integer not null default 0 check (platform_delivery_fee_cents >= 0),
  pricing_config_id uuid not null references public.pricing_configs(id),
  pricing_snapshot jsonb not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, idempotency_key),
  check (total_cents = subtotal_cents + delivery_fee_cents - discount_cents),
  check ((fulfillment = 'pickup') = (delivery_address is null)),
  check (change_for_cents is null or payment_method = 'cash')
);
create index orders_customer_idx on public.orders(customer_id, created_at desc);
create index orders_business_idx on public.orders(business_id, status, created_at desc);
create index orders_pricing_idx on public.orders(pricing_config_id);
create trigger orders_updated before update on public.orders for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity smallint not null check (quantity between 1 and 50),
  options jsonb not null default '[]'::jsonb,
  line_total_cents integer not null check (line_total_cents >= 0),
  notes text check (notes is null or char_length(notes) <= 200)
);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  actor_id uuid references auth.users(id),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events(order_id, created_at);
create index order_events_actor_idx on public.order_events(actor_id);

-- quem pode ver um pedido (cliente, equipe do estabelecimento, equipe da plataforma; entregador na 0012)
create or replace function public.can_view_order(_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = _order and (
    o.customer_id = auth.uid()
    or public.has_business_permission(o.business_id, 'orders.view')
    or public.has_platform_permission('orders.view')))
$$;

create or replace function private.notify_order_staff(_order public.orders, _kind text, _message text)
returns void language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin
  for m in select bm.user_id from public.business_members bm
             join public.role_permissions rp on rp.member_role = bm.member_role and rp.permission = 'orders.view'
            where bm.business_id = _order.business_id loop
    perform private.notify_link(m, _kind, _order.customer_id, '/painel/' || _order.business_id || '/pedidos', _message);
  end loop;
end $$;

-- ---------- criar pedido ----------
create or replace function public.place_order(
  _business uuid,
  _items jsonb,
  _fulfillment public.order_fulfillment,
  _payment public.order_payment,
  _customer_name text,
  _customer_phone text,
  _delivery_address text default null,
  _delivery_reference text default null,
  _notes text default null,
  _change_for_cents integer default null,
  _idempotency_key text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  existing uuid;
  b public.businesses%rowtype;
  cfg public.pricing_configs%rowtype;
  item jsonb;
  p public.products%rowtype;
  qty int;
  opt_ids uuid[];
  opt record;
  grp record;
  unit int;
  sub int := 0;
  lines jsonb := '[]'::jsonb;
  opts jsonb;
  fee int := 0; merchant_contrib int := 0; courier_pay int := 0; platform_fee int := 0; commission int := 0;
  new_id uuid;
  o public.orders%rowtype;
begin
  if uid is null then raise exception 'Entre na sua conta para fazer o pedido.' using errcode = '42501'; end if;
  if _idempotency_key is null or char_length(_idempotency_key) not between 8 and 80 then
    raise exception 'Chave de pedido inválida.' using errcode = 'P0001';
  end if;
  select id into existing from public.orders where customer_id = uid and idempotency_key = _idempotency_key;
  if existing is not null then return existing; end if;  -- mesmo pedido reenviado
  perform private.limit_for('order.place');

  select * into b from public.businesses where id = _business;
  if not found or b.status <> 'active' or b.is_demo then raise exception 'Estabelecimento indisponível.' using errcode = 'P0001'; end if;
  if not private.is_open(b.id, now()) then raise exception 'O estabelecimento está fechado agora.' using errcode = 'P0001'; end if;
  if (_fulfillment = 'delivery_own' and b.delivery_offer <> 'own')
     or (_fulfillment = 'delivery_partner' and b.delivery_offer <> 'partner')
     or (_fulfillment = 'pickup' and not b.accepts_pickup) then
    raise exception 'Modalidade de entrega indisponível neste estabelecimento.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(_customer_name, ''))) < 2 or coalesce(_customer_phone, '') !~ '^[0-9+() -]{8,20}$' then
    raise exception 'Informe nome e telefone para contato.' using errcode = 'P0001';
  end if;
  if _fulfillment <> 'pickup' and char_length(btrim(coalesce(_delivery_address, ''))) < 5 then
    raise exception 'Informe o endereço de entrega.' using errcode = 'P0001';
  end if;
  if _change_for_cents is not null and _payment <> 'cash' then
    raise exception 'Troco só para pagamento em dinheiro.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) not between 1 and 50 then
    raise exception 'O pedido precisa ter de 1 a 50 itens.' using errcode = 'P0001';
  end if;

  for item in select * from jsonb_array_elements(_items) loop
    select * into p from public.products where id = (item->>'product_id')::uuid and business_id = b.id;
    if not found or p.is_demo then raise exception 'Produto indisponível.' using errcode = 'P0001'; end if;
    if not p.is_available or not exists (select 1 from public.menu_categories c where c.id = p.category_id and c.is_active) then
      raise exception '% está indisponível no momento.', p.name using errcode = 'P0001';
    end if;
    qty := coalesce((item->>'quantity')::int, 0);
    if qty not between 1 and 50 then raise exception 'Quantidade inválida para %.', p.name using errcode = 'P0001'; end if;
    select coalesce(array_agg(distinct x::uuid), '{}') into opt_ids
      from jsonb_array_elements_text(coalesce(item->'option_ids', '[]'::jsonb)) x;
    unit := p.price_cents;
    opts := '[]'::jsonb;
    -- cada adicional pertence a um grupo do produto e está disponível
    for opt in
      select o2.id, o2.name, o2.price_delta_cents, o2.is_available, g.id as group_id, g.name as group_name
        from public.options o2 join public.option_groups g on g.id = o2.group_id
       where o2.id = any(opt_ids) and g.product_id = p.id and o2.business_id = b.id loop
      if not opt.is_available then raise exception '% está indisponível.', opt.name using errcode = 'P0001'; end if;
      unit := unit + opt.price_delta_cents;
      opts := opts || jsonb_build_object('group', opt.group_name, 'option', opt.name, 'price_delta_cents', opt.price_delta_cents);
    end loop;
    if jsonb_array_length(opts) <> coalesce(array_length(opt_ids, 1), 0) then
      raise exception 'Adicional inválido para %.', p.name using errcode = 'P0001';
    end if;
    -- mínimos e máximos de cada grupo
    for grp in
      select g.name, g.min_select, g.max_select,
             (select count(*) from public.options o3 where o3.group_id = g.id and o3.id = any(opt_ids)) as chosen
        from public.option_groups g where g.product_id = p.id loop
      if grp.chosen < grp.min_select or grp.chosen > grp.max_select then
        raise exception 'Escolha entre % e % opção(ões) em "%".', grp.min_select, grp.max_select, grp.name using errcode = 'P0001';
      end if;
    end loop;
    sub := sub + unit * qty;
    lines := lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', unit, 'qty', qty, 'options', opts,
                                         'notes', nullif(left(btrim(coalesce(item->>'notes', '')), 200), ''));
  end loop;

  if sub < b.min_order_cents then
    raise exception 'Pedido mínimo deste estabelecimento: R$ %.', to_char(b.min_order_cents / 100.0, 'FM999990D00') using errcode = 'P0001';
  end if;

  select * into cfg from public.pricing_configs where is_current;
  if not found then raise exception 'Configuração de preços indisponível.' using errcode = 'P0001'; end if;
  if sub > (cfg.config->>'commissionThresholdCents')::int then
    commission := round(sub * (cfg.config->>'commissionBps')::numeric / 10000);
  end if;
  if _fulfillment = 'delivery_own' then
    fee := b.own_delivery_fee_cents;
    platform_fee := (cfg.config->'ownDelivery'->>'platformFeeCents')::int;
  elsif _fulfillment = 'delivery_partner' then
    fee := (cfg.config->'partnerDelivery'->>'customerFeeCents')::int;
    merchant_contrib := (cfg.config->'partnerDelivery'->>'merchantContributionCents')::int;
    courier_pay := (cfg.config->'partnerDelivery'->>'courierPayCents')::int;
    platform_fee := (cfg.config->'partnerDelivery'->>'platformFeeCents')::int;
  end if;
  if _change_for_cents is not null and _change_for_cents < sub + fee then
    raise exception 'O valor para troco precisa ser maior que o total.' using errcode = 'P0001';
  end if;

  insert into public.orders(customer_id, business_id, fulfillment, payment_method, change_for_cents, customer_name, customer_phone,
                            delivery_address, delivery_reference, notes, subtotal_cents, delivery_fee_cents, total_cents,
                            commission_cents, merchant_delivery_contribution_cents, courier_pay_cents, platform_delivery_fee_cents,
                            pricing_config_id, pricing_snapshot, idempotency_key)
  values (uid, b.id, _fulfillment, _payment, _change_for_cents, btrim(_customer_name), btrim(_customer_phone),
          case when _fulfillment = 'pickup' then null else btrim(_delivery_address) end,
          case when _fulfillment = 'pickup' then null else nullif(btrim(coalesce(_delivery_reference, '')), '') end,
          nullif(btrim(coalesce(_notes, '')), ''), sub, fee, sub + fee, commission, merchant_contrib, courier_pay, platform_fee,
          cfg.id, jsonb_build_object('version', cfg.version, 'config', cfg.config), _idempotency_key)
  returning * into o;
  new_id := o.id;
  insert into public.order_items(order_id, product_id, name, unit_price_cents, quantity, options, line_total_cents, notes)
  select new_id, (l->>'product_id')::uuid, l->>'name', (l->>'unit')::int, (l->>'qty')::int, l->'options',
         (l->>'unit')::int * (l->>'qty')::int, l->>'notes'
    from jsonb_array_elements(lines) l;
  insert into public.order_events(order_id, status, actor_id) values (new_id, 'placed', uid);
  perform private.mark_pricing_config_used(cfg.id);
  perform private.notify_order_staff(o, 'order_new', 'Novo pedido #' || o.code || '.');
  return new_id;
end $$;

-- ---------- mudar status ----------
-- Estabelecimento (orders.update_status): placed->accepted|rejected; accepted->preparing; preparing->ready;
--   ready->out_for_delivery (entrega própria) | picked_up (retirada); out_for_delivery->delivered (entrega própria);
--   accepted|preparing|ready -> cancelled (com motivo). Entrega parceira segue pelas funções do entregador (0012).
-- Cliente: placed -> cancelled (antes do aceite).
create or replace function public.update_order_status(_order uuid, _status public.order_status, _note text default null)
returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; staff boolean; ok boolean := false; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('order.status');
  select * into o from public.orders where id = _order for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  staff := public.has_business_permission(o.business_id, 'orders.update_status');
  if not staff and o.customer_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;

  if staff then
    ok := (o.status = 'placed' and _status in ('accepted', 'rejected'))
       or (o.status = 'accepted' and _status = 'preparing')
       or (o.status = 'preparing' and _status = 'ready')
       or (o.status = 'ready' and o.fulfillment = 'delivery_own' and _status = 'out_for_delivery')
       or (o.status = 'ready' and o.fulfillment = 'pickup' and _status = 'picked_up')
       or (o.status = 'out_for_delivery' and o.fulfillment = 'delivery_own' and _status = 'delivered')
       or (o.status in ('accepted', 'preparing', 'ready') and _status = 'cancelled');
  end if;
  if not ok and o.customer_id = auth.uid() then
    ok := o.status = 'placed' and _status = 'cancelled';
  end if;
  if not ok then raise exception 'Mudança de status não permitida (% → %).', o.status, _status using errcode = 'P0001'; end if;
  if _status in ('rejected') and note is null then raise exception 'Informe o motivo da recusa.' using errcode = 'P0001'; end if;
  if _status = 'cancelled' and staff and note is null then raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001'; end if;

  update public.orders set status = _status, rejection_reason = case when _status in ('rejected', 'cancelled') then note else rejection_reason end
   where id = o.id;
  insert into public.order_events(order_id, status, actor_id, note) values (o.id, _status, auth.uid(), note);
  if staff then
    perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id,
      'Pedido #' || o.code || ': ' || case _status
        when 'accepted' then 'aceito pelo estabelecimento.'
        when 'rejected' then 'recusado. ' || coalesce(note, '')
        when 'preparing' then 'em preparo.'
        when 'ready' then case when o.fulfillment = 'pickup' then 'pronto para retirada.' else 'pronto, aguardando entrega.' end
        when 'out_for_delivery' then 'saiu para entrega.'
        when 'delivered' then 'entregue. Bom apetite!'
        when 'picked_up' then 'retirado.'
        when 'cancelled' then 'cancelado pelo estabelecimento. ' || coalesce(note, '')
        else _status::text end);
  else
    perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ' cancelado pelo cliente.');
  end if;
  return _status;
end $$;

-- ---------- avaliação verificada ----------
alter table public.reviews
  add column reply text check (reply is null or char_length(reply) <= 1000),
  add column replied_at timestamptz;
create unique index reviews_order_unique_idx on public.reviews(order_id);
alter table public.reviews add constraint reviews_order_fk foreign key (order_id) references public.orders(id) on delete set null;
revoke select on public.reviews from anon, authenticated;
grant select (id, business_id, rating, comment, author_name, created_at, reply, replied_at) on public.reviews to anon, authenticated;

create or replace function public.submit_review(_order uuid, _rating integer, _comment text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; rid uuid; author text;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('order.review');
  select * into o from public.orders where id = _order and customer_id = auth.uid();
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  if o.status not in ('delivered', 'picked_up') then raise exception 'Avalie depois de receber o pedido.' using errcode = 'P0001'; end if;
  if _rating not between 1 and 5 then raise exception 'Nota de 1 a 5.' using errcode = 'P0001'; end if;
  if char_length(coalesce(_comment, '')) > 1000 then raise exception 'Comentário muito longo.' using errcode = 'P0001'; end if;
  select split_part(btrim(o.customer_name), ' ', 1) into author;
  insert into public.reviews(business_id, user_id, order_id, rating, comment, author_name)
  values (o.business_id, auth.uid(), o.id, _rating, nullif(btrim(coalesce(_comment, '')), ''), author)
  returning id into rid;
  return rid;
exception when unique_violation then
  raise exception 'Este pedido já foi avaliado.' using errcode = 'P0001';
end $$;

create or replace function public.reply_review(_review uuid, _reply text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reviews%rowtype;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('order.reply');
  select * into r from public.reviews where id = _review;
  if not found or not (public.has_business_permission(r.business_id, 'store.customize') or public.has_business_permission(r.business_id, 'settings.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(_reply, ''))) not between 1 and 1000 then raise exception 'Resposta de 1 a 1000 caracteres.' using errcode = 'P0001'; end if;
  update public.reviews set reply = btrim(_reply), replied_at = now() where id = r.id;
end $$;

create or replace function public.my_order_review(_order uuid) returns table (rating smallint, comment text, reply text)
language sql stable security definer set search_path = '' as $$
  select v.rating, v.comment, v.reply from public.reviews v join public.orders o on o.id = v.order_id
   where v.order_id = _order and o.customer_id = auth.uid()
$$;

-- ---------- painel: vendas ----------
create or replace function public.business_sales_summary(_business uuid, _days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    with o as (select * from public.orders where business_id = _business and created_at > now() - make_interval(days => least(greatest(coalesce(_days, 30), 1), 366)))
    select jsonb_build_object(
      'orders_total', (select count(*) from o),
      'orders_completed', (select count(*) from o where status in ('delivered', 'picked_up')),
      'orders_cancelled', (select count(*) from o where status in ('rejected', 'cancelled')),
      'gross_cents', coalesce((select sum(subtotal_cents) from o where status in ('delivered', 'picked_up')), 0),
      'commission_cents', coalesce((select sum(commission_cents) from o where status in ('delivered', 'picked_up')), 0),
      'delivery_costs_cents', coalesce((select sum(merchant_delivery_contribution_cents + platform_delivery_fee_cents) from o where status in ('delivered', 'picked_up')), 0),
      'top_products', coalesce((select jsonb_agg(t) from (
          select i.name, sum(i.quantity)::int as qty, sum(i.line_total_cents)::int as total_cents
            from public.order_items i join o on o.id = i.order_id where o.status in ('delivered', 'picked_up')
           group by i.name order by qty desc limit 5) t), '[]'::jsonb)));
end $$;

-- ---------- RLS ----------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
create policy orders_select on public.orders for select to authenticated using (public.can_view_order(id));
create policy order_items_select on public.order_items for select to authenticated using (public.can_view_order(order_id));
create policy order_events_select on public.order_events for select to authenticated using (public.can_view_order(order_id));
revoke all on public.orders, public.order_items, public.order_events from public, anon, authenticated;
grant select on public.orders, public.order_items, public.order_events to authenticated;

do $$
declare f text;
begin
  revoke all on function private.notify_order_staff(public.orders, text, text) from public, anon, authenticated;
  foreach f in array array[
    'public.can_view_order(uuid)',
    'public.place_order(uuid, jsonb, public.order_fulfillment, public.order_payment, text, text, text, text, text, integer, text)',
    'public.update_order_status(uuid, public.order_status, text)',
    'public.submit_review(uuid, integer, text)', 'public.reply_review(uuid, text)', 'public.my_order_review(uuid)',
    'public.business_sales_summary(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
