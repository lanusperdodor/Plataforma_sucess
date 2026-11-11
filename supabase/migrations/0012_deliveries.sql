-- 0012_deliveries: distribuição de entregas para entregadores parceiros.
--  * Pedido com entrega parceira marcado "pronto" vira oferta para entregadores aprovados,
--    disponíveis e da mesma cidade do estabelecimento.
--  * Aceite atômico: um único UPDATE condicional garante que só um entregador fica com a entrega.
--  * Coleta e entrega confirmadas pelo entregador; a entrega exige o código de 4 dígitos que só o
--    cliente vê. Liberar a entrega antes da coleta devolve a oferta.
--  * Ganho do entregador = courier_pay_cents do snapshot do pedido (regra aprovada, sem valor fictício).
--  * Distância e tempo não são estimados: não há serviço de rotas contratado.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('delivery.action', 120, 600), ('delivery.code', 10, 600);

create type public.delivery_status as enum ('offered', 'accepted', 'picked_up', 'delivered', 'cancelled');

create table public.deliveries (
  order_id uuid primary key references public.orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id),
  city_id uuid references public.cities(id),
  status public.delivery_status not null default 'offered',
  -- referência à conta (não ao cadastro): a anonimização apaga o cadastro e mantém o histórico
  courier_id uuid references auth.users(id),
  courier_pay_cents integer not null check (courier_pay_cents >= 0),
  confirmation_code text not null default lpad((floor(random() * 10000))::int::text, 4, '0') check (confirmation_code ~ '^[0-9]{4}$'),
  failed_code_attempts smallint not null default 0,
  offered_at timestamptz not null default now(),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  check (status <> 'offered' or courier_id is null),
  check (status not in ('accepted', 'picked_up') or courier_id is not null)
);
create index deliveries_offer_idx on public.deliveries(city_id, status, offered_at);
create index deliveries_courier_idx on public.deliveries(courier_id, status);
create index deliveries_business_idx on public.deliveries(business_id);

-- pronto + entrega parceira -> oferta; cancelado/recusado -> cancela a entrega
create or replace function private.orders_delivery_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid; cour uuid;
begin
  if new.fulfillment = 'delivery_partner' and new.status = 'ready' and old.status <> 'ready' then
    select city_id into c from public.businesses where id = new.business_id;
    insert into public.deliveries(order_id, business_id, city_id, courier_pay_cents)
    values (new.id, new.business_id, c, new.courier_pay_cents) on conflict (order_id) do nothing;
    for cour in select user_id from public.couriers where status = 'approved' and is_online and city_id = c loop
      perform private.notify_link(cour, 'delivery_offer', null, '/entregador/ofertas', 'Nova entrega disponível perto de você.');
    end loop;
  elsif new.status in ('cancelled', 'rejected') and old.status <> new.status then
    update public.deliveries set status = 'cancelled' where order_id = new.id and status in ('offered', 'accepted');
  end if;
  return null;
end $$;
create trigger orders_delivery_sync after update of status on public.orders
  for each row execute function private.orders_delivery_sync();

-- entregador vê o pedido que está entregando
create or replace function public.can_view_order(_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = _order and (
    o.customer_id = auth.uid()
    or public.has_business_permission(o.business_id, 'orders.view')
    or public.has_platform_permission('orders.view')
    or exists (select 1 from public.deliveries d where d.order_id = o.id and d.courier_id = auth.uid())))
$$;

create or replace function private.require_active_courier() returns public.couriers
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype;
begin
  select * into c from public.couriers where user_id = auth.uid();
  if not found or c.status <> 'approved' then raise exception 'Cadastro de entregador não aprovado.' using errcode = '42501'; end if;
  return c;
end $$;

-- ofertas abertas na cidade do entregador (sem dados do cliente antes do aceite)
create or replace function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  if not c.is_online then return; end if;
  return query
    select d.order_id, b.name, b.address_line, d.courier_pay_cents, d.offered_at,
           -- só a parte final do endereço (bairro/cidade) antes do aceite
           nullif(btrim(split_part(o.delivery_address, ',', -1)), ''),
           (select count(*) from public.order_items i where i.order_id = o.id)
      from public.deliveries d
      join public.orders o on o.id = d.order_id
      join public.businesses b on b.id = d.business_id
     where d.status = 'offered' and d.city_id = c.city_id
     order by d.offered_at;
end $$;

create or replace function public.courier_accept_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); n int;
begin
  perform private.limit_for('delivery.action');
  if not c.is_online then raise exception 'Fique disponível para aceitar entregas.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.deliveries where courier_id = c.user_id and status in ('accepted', 'picked_up')) then
    raise exception 'Conclua a entrega atual antes de aceitar outra.' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'accepted', courier_id = c.user_id, accepted_at = now()
   where order_id = _order and status = 'offered' and courier_id is null and city_id = c.city_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Esta entrega já foi aceita por outro entregador ou não está mais disponível.' using errcode = 'P0001'; end if;
  perform private.audit('delivery.accept', 'deliveries', _order::text, '{}'::jsonb);
end $$;

create or replace function public.courier_release_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); n int;
begin
  perform private.limit_for('delivery.action');
  update public.deliveries set status = 'offered', courier_id = null, accepted_at = null
   where order_id = _order and courier_id = c.user_id and status = 'accepted';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Só é possível liberar antes da coleta.' using errcode = 'P0001'; end if;
  perform private.audit('delivery.release', 'deliveries', _order::text, '{}'::jsonb);
end $$;

create or replace function public.courier_pickup_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); o public.orders%rowtype;
begin
  perform private.limit_for('delivery.action');
  update public.deliveries set status = 'picked_up', picked_up_at = now()
   where order_id = _order and courier_id = c.user_id and status = 'accepted';
  if not found then raise exception 'Entrega não está aceita por você.' using errcode = 'P0001'; end if;
  update public.orders set status = 'out_for_delivery' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'out_for_delivery', c.user_id, 'Coletado pelo entregador parceiro');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' saiu para entrega.');
end $$;

create or replace function public.courier_complete_delivery(_order uuid, _code text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype; o public.orders%rowtype;
begin
  perform private.limit_for('delivery.code');
  select * into d from public.deliveries where order_id = _order and courier_id = c.user_id and status = 'picked_up' for update;
  if not found then raise exception 'Entrega não está em rota com você.' using errcode = 'P0001'; end if;
  if d.failed_code_attempts >= 5 then raise exception 'Muitas tentativas de código. Fale com o suporte.' using errcode = 'P0001'; end if;
  if coalesce(btrim(_code), '') <> d.confirmation_code then
    update public.deliveries set failed_code_attempts = failed_code_attempts + 1 where order_id = _order;
    return;  -- registra a tentativa; a interface informa código incorreto
  end if;
  update public.deliveries set status = 'delivered', delivered_at = now() where order_id = _order;
  update public.orders set status = 'delivered' where id = _order returning * into o;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'delivered', c.user_id, 'Entregue com código de confirmação');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' entregue. Bom apetite!');
  perform private.audit('delivery.complete', 'deliveries', _order::text, jsonb_build_object('pay_cents', d.courier_pay_cents));
end $$;

-- entrega do próprio entregador (ativa e histórico) com o necessário para entregar
create or replace function public.courier_my_deliveries(_active boolean default true)
returns table (order_id uuid, order_code text, status public.delivery_status, business_name text, business_address text,
               business_phone text, customer_name text, customer_phone text, delivery_address text, delivery_reference text,
               payment_method public.order_payment, total_cents integer, change_for_cents integer, courier_pay_cents integer,
               accepted_at timestamptz, delivered_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  return query
    select d.order_id, o.code, d.status, b.name, b.address_line, b.phone,
           o.customer_name, o.customer_phone, o.delivery_address, o.delivery_reference,
           o.payment_method, o.total_cents, o.change_for_cents, d.courier_pay_cents, d.accepted_at, d.delivered_at
      from public.deliveries d join public.orders o on o.id = d.order_id join public.businesses b on b.id = d.business_id
     where d.courier_id = c.user_id
       and ((_active and d.status in ('accepted', 'picked_up')) or (not _active and d.status = 'delivered'))
     order by coalesce(d.delivered_at, d.accepted_at) desc
     limit 100;
end $$;

create or replace function public.courier_earnings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  return jsonb_build_object(
    'today_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered'
                               and delivered_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'), 0),
    'week_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered'
                              and delivered_at >= now() - interval '7 days'), 0),
    'total_cents', coalesce((select sum(courier_pay_cents) from public.deliveries where courier_id = c.user_id and status = 'delivered'), 0),
    'deliveries', (select count(*) from public.deliveries where courier_id = c.user_id and status = 'delivered'));
end $$;

-- cliente: andamento da entrega e código de confirmação
create or replace function public.my_delivery(_order uuid)
returns table (status public.delivery_status, confirmation_code text, courier_first_name text, courier_vehicle public.courier_vehicle)
language sql stable security definer set search_path = '' as $$
  select d.status, case when d.status in ('accepted', 'picked_up') then d.confirmation_code end,
         split_part(c.full_name, ' ', 1), c.vehicle
    from public.deliveries d join public.orders o on o.id = d.order_id left join public.couriers c on c.user_id = d.courier_id
   where d.order_id = _order and o.customer_id = auth.uid()
$$;

-- ---------- RLS ----------
alter table public.deliveries enable row level security;
-- leitura direta só pela equipe do estabelecimento (sem o código); entregador e cliente usam as funções
create policy deliveries_select on public.deliveries for select to authenticated
  using (public.has_business_permission(business_id, 'orders.view') or public.has_platform_permission('orders.view'));
revoke all on public.deliveries from public, anon, authenticated;
grant select (order_id, business_id, city_id, status, courier_id, courier_pay_cents, offered_at, accepted_at, picked_up_at, delivered_at)
  on public.deliveries to authenticated;

do $$
declare f text;
begin
  revoke all on function private.orders_delivery_sync() from public, anon, authenticated;
  revoke all on function private.require_active_courier() from public, anon, authenticated;
  foreach f in array array[
    'public.can_view_order(uuid)', 'public.courier_list_offers()', 'public.courier_accept_delivery(uuid)',
    'public.courier_release_delivery(uuid)', 'public.courier_pickup_delivery(uuid)', 'public.courier_complete_delivery(uuid, text)',
    'public.courier_my_deliveries(boolean)', 'public.courier_earnings()', 'public.my_delivery(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
