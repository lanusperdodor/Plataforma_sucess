-- 0022_homologacao: operação ponta a ponta testável sem misturar teste e produção.
--  * Teste isolado: estabelecimentos e pedidos de teste ficam marcados (is_test). Só contas de teste e a
--    equipe da plataforma enxergam estabelecimentos de teste; conta de teste não compra em loja real,
--    cliente real não compra em loja de teste; entregador real nunca recebe oferta de teste (e vice-versa);
--    pedidos de teste ficam fora do financeiro da plataforma.
--  * Despacho: oferta com prazo, recusa pelo entregador, expiração com nova rodada (redistribuição),
--    alerta para o estabelecimento e a equipe quando ninguém aceita ou o entregador não coleta, aceite
--    atômico já existente (0012) agora também respeita teste/produção. Localização do entregador só
--    quando ele compartilha, e só enquanto está disponível.
--  * Cozinha: aceite com tempo estimado de preparo; o papel "cozinha" só move aceito → em preparo → pronto.
--  * Master: lista de pedidos com alertas operacionais, detalhe com itens, eventos, entrega e valores,
--    cancelamento com motivo e redistribuição da entrega (permissão orders.manage), tudo auditado.
--  * Contas de homologação para os 9 perfis, reaproveitando o lote existente da cidade (sem duplicar).
--  * Tempo real: pedidos e notificações publicados no Supabase Realtime (as regras RLS valem para o canal).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('delivery.decline', 120, 600), ('dispatch.tick', 600, 600), ('admin.orders', 600, 600),
  ('admin.orders.manage', 60, 600), ('courier.location', 600, 600)
on conflict (action) do nothing;

insert into public.platform_permissions(code, description, sort_order) values
  ('orders.manage', 'Tratar ocorrências de pedidos: cancelar e redistribuir entregas', 75)
on conflict (code) do nothing;

-- ---------- quem é conta de teste ----------
create or replace function private.is_test_user(_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select _user is not null and exists (
    select 1 from private.test_data_runs where removed_at is null and _user = any(user_ids))
$$;

-- usado pela view pública (precisa de EXECUTE para anon); só responde sobre quem está consultando
create or replace function public.viewer_sees_tests() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    private.is_test_user(auth.uid()) or public.has_role('platform_master') or public.has_role('platform_operator'))
$$;

-- ---------- marcação de teste ----------
alter table public.businesses add column if not exists is_test boolean not null default false;
update public.businesses set is_test = true where id in (select private.test_business_ids()) and not is_test;

create or replace function private.businesses_is_test_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.is_test) or (tg_op = 'UPDATE' and new.is_test is distinct from old.is_test) then
    if coalesce(current_setting('tucai.internal', true), '') <> 'on' then
      raise exception 'A marcação de teste é controlada pela plataforma.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists businesses_is_test_guard on public.businesses;
create trigger businesses_is_test_guard before insert or update of is_test on public.businesses
  for each row execute function private.businesses_is_test_guard();

-- busca pública: estabelecimentos de teste só para contas de teste e equipe
create or replace view public.public_businesses with (security_barrier = true) as
  select b.id, b.name, b.slug, b.status, b.business_type, b.category_id, b.city_id,
         b.description, b.cover_url, b.logo_url, b.address_line, b.phone, b.whatsapp,
         b.lat, b.lng, b.distance_estimate_km,
         b.delivery_offer, b.own_delivery_fee_cents, b.accepts_pickup,
         b.estimated_min_minutes, b.estimated_max_minutes, b.min_order_cents, b.price_tier,
         b.rating_avg, b.rating_count, b.popularity_score, b.is_featured,
         b.created_at,
         public.business_is_open(b.id) as is_open
    from public.businesses b
   where b.status = 'active' and not b.is_demo and (not b.is_test or public.viewer_sees_tests());

-- vagas de estabelecimentos de teste também ficam fora do público
create or replace function public.job_is_public(_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs j join public.businesses b on b.id = j.business_id
                  where j.id = _job and j.status = 'open' and j.expires_at > now()
                    and public.is_active_business(j.business_id) and (not b.is_test or public.viewer_sees_tests()))
$$;

-- pedidos herdam a marcação; teste e produção não se cruzam
alter table public.orders
  add column if not exists is_test boolean not null default false,
  add column if not exists prep_minutes smallint check (prep_minutes is null or prep_minutes between 5 and 180),
  add column if not exists estimated_ready_at timestamptz;
update public.orders o set is_test = true from public.businesses b where b.id = o.business_id and b.is_test and not o.is_test;

create or replace function private.orders_test_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare biz_test boolean; cust_test boolean := private.is_test_user(new.customer_id);
begin
  select is_test into biz_test from public.businesses where id = new.business_id;
  if coalesce(biz_test, false) and not cust_test and not exists (
       select 1 from public.user_roles where user_id = new.customer_id and role in ('platform_master', 'platform_operator')) then
    raise exception 'Estabelecimento indisponível.' using errcode = 'P0001';
  end if;
  if cust_test and not coalesce(biz_test, false) then
    raise exception 'Contas de teste só fazem pedidos em estabelecimentos de teste.' using errcode = 'P0001';
  end if;
  new.is_test := coalesce(biz_test, false);
  return new;
end $$;
drop trigger if exists orders_test_guard on public.orders;
create trigger orders_test_guard before insert on public.orders for each row execute function private.orders_test_guard();

-- financeiro da plataforma ignora pedidos de teste
create or replace function private.platform_fees(_business uuid, _from timestamptz, _to timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(o.commission_cents + o.platform_delivery_fee_cents), 0)::int
    from public.orders o
   where (_business is null or o.business_id = _business) and o.status in ('delivered', 'picked_up') and not o.is_test
     and o.updated_at >= _from and o.updated_at < _to
$$;

create or replace function public.admin_finance_series(_months integer default 12)
returns table (month date, received_cents integer, fees_cents integer, new_subscriptions integer)
language plpgsql stable security definer set search_path = '' as $$
declare n int := least(greatest(coalesce(_months, 12), 1), 36);
        first_month date := (date_trunc('month', now() at time zone 'America/Sao_Paulo') - make_interval(months => n - 1))::date;
begin
  perform private.require_permission('finance.view');
  return query
    with months as (select generate_series(first_month, date_trunc('month', now() at time zone 'America/Sao_Paulo')::date, interval '1 month')::date as m)
    select ms.m,
           coalesce((select sum(ch.amount_cents)::int from public.platform_charges ch
                      where ch.status = 'paga' and date_trunc('month', ch.paid_at at time zone 'America/Sao_Paulo')::date = ms.m), 0),
           coalesce((select sum(o.commission_cents + o.platform_delivery_fee_cents)::int from public.orders o
                      where o.status in ('delivered', 'picked_up') and not o.is_test
                        and date_trunc('month', o.updated_at at time zone 'America/Sao_Paulo')::date = ms.m), 0),
           (select count(*)::int from public.business_subscriptions s where date_trunc('month', s.started_on)::date = ms.m)
      from months ms
     order by ms.m;
end $$;

-- ---------- notificações operacionais ----------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'like', 'comment', 'reply', 'follow', 'moderation',
  'friend_request', 'friend_accept', 'scrap', 'testimonial', 'community_request', 'community_accept', 'topic_reply',
  'order_new', 'order_update', 'delivery_offer', 'job_application', 'job_update', 'ops_alert'));
alter table public.notifications drop constraint notifications_link_check;
alter table public.notifications add constraint notifications_link_check
  check (link is null or link ~ '^/(conectuai|pedidos|painel|entregador|vagas|admin)/[A-Za-z0-9/_-]*$');

-- alerta para a equipe do estabelecimento e para a equipe da plataforma com orders.view
create or replace function private.notify_ops(_order uuid, _message text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; m uuid;
begin
  select * into o from public.orders where id = _order;
  if not found then return; end if;
  perform private.notify_order_staff(o, 'ops_alert', _message);
  for m in select distinct r.user_id from public.user_roles r
            where r.role = 'platform_master'
               or (r.role = 'platform_operator' and exists (
                     select 1 from public.platform_staff_permissions sp where sp.user_id = r.user_id and sp.permission = 'orders.view')) loop
    perform private.notify_link(m, 'ops_alert', null, '/admin/pedidos', _message);
  end loop;
end $$;

-- ---------- despacho ----------
create or replace function private.offer_window() returns interval language sql immutable as $$ select interval '5 minutes' $$;
create or replace function private.offer_max_rounds() returns integer language sql immutable as $$ select 3 $$;
create or replace function private.pickup_deadline() returns interval language sql immutable as $$ select interval '40 minutes' $$;

alter table public.deliveries
  add column if not exists is_test boolean not null default false,
  add column if not exists offer_round smallint not null default 1,
  add column if not exists offer_expires_at timestamptz,
  add column if not exists attention_reason text check (attention_reason is null or char_length(attention_reason) <= 200),
  add column if not exists attention_at timestamptz;
update public.deliveries d set is_test = o.is_test from public.orders o where o.id = d.order_id and d.is_test <> o.is_test;
update public.deliveries set offer_expires_at = offered_at + private.offer_window() where offer_expires_at is null;
create index if not exists deliveries_expiry_idx on public.deliveries(status, offer_expires_at);
-- equipe do estabelecimento acompanha rodada e alerta (o código de confirmação continua fora)
grant select (is_test, offer_round, offer_expires_at, attention_reason, attention_at) on public.deliveries to authenticated;

create table if not exists public.delivery_declines (
  order_id uuid not null references public.deliveries(order_id) on delete cascade,
  courier_id uuid not null references auth.users(id) on delete cascade,
  offer_round smallint not null,
  created_at timestamptz not null default now(),
  primary key (order_id, courier_id, offer_round)
);
create index if not exists delivery_declines_courier_idx on public.delivery_declines(courier_id);
alter table public.delivery_declines enable row level security;
revoke all on public.delivery_declines from public, anon, authenticated;

alter table public.couriers
  add column if not exists last_lat numeric(9, 6) check (last_lat is null or last_lat between -90 and 90),
  add column if not exists last_lng numeric(9, 6) check (last_lng is null or last_lng between -180 and 180),
  add column if not exists last_location_at timestamptz;

-- entregadores aptos: aprovados, disponíveis, da cidade, e do mesmo "mundo" (teste x produção)
create or replace function private.eligible_couriers(_city uuid, _is_test boolean) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.user_id from public.couriers c
   where c.status = 'approved' and c.is_online and c.city_id = _city and private.is_test_user(c.user_id) = _is_test
$$;

create or replace function private.offer_to_couriers(_order uuid, _message text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; cour uuid;
begin
  select * into d from public.deliveries where order_id = _order;
  for cour in select private.eligible_couriers(d.city_id, d.is_test) loop
    perform private.notify_link(cour, 'delivery_offer', null, '/entregador/ofertas', _message);
  end loop;
end $$;

create or replace function private.orders_delivery_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
  if new.fulfillment = 'delivery_partner' and new.status = 'ready' and old.status <> 'ready' then
    select city_id into c from public.businesses where id = new.business_id;
    insert into public.deliveries(order_id, business_id, city_id, courier_pay_cents, is_test, offer_expires_at)
    values (new.id, new.business_id, c, new.courier_pay_cents, new.is_test, now() + private.offer_window())
    on conflict (order_id) do nothing;
    perform private.offer_to_couriers(new.id, 'Nova entrega disponível perto de você.');
  elsif new.status in ('cancelled', 'rejected') and old.status <> new.status then
    update public.deliveries set status = 'cancelled' where order_id = new.id and status in ('offered', 'accepted', 'picked_up');
  end if;
  return null;
end $$;

-- varredura: expira ofertas (nova rodada para todos de novo), e alerta quando ninguém aceita ou não coleta
create or replace function private.sweep_deliveries() returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; n int := 0; code text;
begin
  for d in select * from public.deliveries where status = 'offered' and offer_expires_at < now() for update skip locked loop
    if d.offer_round < private.offer_max_rounds() then
      update public.deliveries set offer_round = offer_round + 1, offer_expires_at = now() + private.offer_window() where order_id = d.order_id;
      perform private.offer_to_couriers(d.order_id, 'Entrega ainda aguardando entregador perto de você.');
    elsif d.attention_reason is null then
      select o.code into code from public.orders o where o.id = d.order_id;
      update public.deliveries set attention_reason = 'Sem entregador após ' || private.offer_max_rounds() || ' rodadas de oferta', attention_at = now()
       where order_id = d.order_id;
      perform private.notify_ops(d.order_id, 'Pedido #' || code || ': nenhum entregador aceitou a entrega.');
    else
      continue;
    end if;
    n := n + 1;
  end loop;
  for d in select * from public.deliveries
            where status = 'accepted' and accepted_at < now() - private.pickup_deadline() and attention_reason is null
            for update skip locked loop
    select o.code into code from public.orders o where o.id = d.order_id;
    update public.deliveries set attention_reason = 'Entregador não coletou em ' || extract(epoch from private.pickup_deadline())::int / 60 || ' min', attention_at = now()
     where order_id = d.order_id;
    perform private.notify_ops(d.order_id, 'Pedido #' || code || ': entregador ainda não coletou.');
    n := n + 1;
  end loop;
  return n;
end $$;

-- painéis chamam ao abrir/atualizar; com pg_cron a varredura também roda a cada minuto
create or replace function public.dispatch_tick() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('dispatch.tick');
  return private.sweep_deliveries();
end $$;

drop function if exists public.courier_list_offers();
create function public.courier_list_offers()
returns table (order_id uuid, business_name text, business_address text, courier_pay_cents integer, offered_at timestamptz,
               neighborhood_hint text, items_count bigint, offer_expires_at timestamptz, offer_round smallint)
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); me_test boolean := private.is_test_user(c.user_id);
begin
  if not c.is_online then return; end if;
  perform private.sweep_deliveries();
  return query
    select d.order_id, b.name, b.address_line, d.courier_pay_cents, d.offered_at,
           nullif(btrim(split_part(o.delivery_address, ',', -1)), ''),
           (select count(*) from public.order_items i where i.order_id = o.id),
           d.offer_expires_at, d.offer_round
      from public.deliveries d
      join public.orders o on o.id = d.order_id
      join public.businesses b on b.id = d.business_id
     where d.status = 'offered' and d.city_id = c.city_id and d.is_test = me_test
       and not exists (select 1 from public.delivery_declines x
                        where x.order_id = d.order_id and x.courier_id = c.user_id and x.offer_round = d.offer_round)
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
  -- aceite atômico: só um UPDATE condicional vence
  update public.deliveries set status = 'accepted', courier_id = c.user_id, accepted_at = now(), attention_reason = null, attention_at = null
   where order_id = _order and status = 'offered' and courier_id is null and city_id = c.city_id
     and is_test = private.is_test_user(c.user_id);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Esta entrega já foi aceita por outro entregador ou não está mais disponível.' using errcode = 'P0001'; end if;
  insert into public.order_events(order_id, status, actor_id, note)
  select _order, o.status, c.user_id, 'Entrega aceita pelo entregador parceiro' from public.orders o where o.id = _order;
  perform private.audit('delivery.accept', 'deliveries', _order::text, '{}'::jsonb);
end $$;

create or replace function public.courier_decline_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype; pending int;
begin
  perform private.limit_for('delivery.decline');
  select * into d from public.deliveries
   where order_id = _order and status = 'offered' and city_id = c.city_id and is_test = private.is_test_user(c.user_id) for update;
  if not found then raise exception 'Oferta não está mais disponível.' using errcode = 'P0001'; end if;
  insert into public.delivery_declines(order_id, courier_id, offer_round) values (_order, c.user_id, d.offer_round) on conflict do nothing;
  perform private.audit('delivery.decline', 'deliveries', _order::text, jsonb_build_object('round', d.offer_round));
  -- todos os aptos recusaram nesta rodada: encerra a rodada já (a varredura redistribui ou alerta)
  select count(*) into pending from private.eligible_couriers(d.city_id, d.is_test) e
   where not exists (select 1 from public.delivery_declines x where x.order_id = _order and x.courier_id = e and x.offer_round = d.offer_round);
  if pending = 0 then
    update public.deliveries set offer_expires_at = now() - interval '1 second' where order_id = _order;
    perform private.sweep_deliveries();
  end if;
end $$;

create or replace function public.courier_release_delivery(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier(); d public.deliveries%rowtype;
begin
  perform private.limit_for('delivery.action');
  select * into d from public.deliveries where order_id = _order and courier_id = c.user_id and status = 'accepted' for update;
  if not found then raise exception 'Só é possível liberar antes da coleta.' using errcode = 'P0001'; end if;
  update public.deliveries set status = 'offered', courier_id = null, accepted_at = null,
         offer_expires_at = now() + private.offer_window(), attention_reason = null, attention_at = null
   where order_id = _order;
  insert into public.delivery_declines(order_id, courier_id, offer_round) values (_order, c.user_id, d.offer_round) on conflict do nothing;
  insert into public.order_events(order_id, status, actor_id, note)
  select _order, o.status, c.user_id, 'Entregador liberou a entrega; oferta reaberta' from public.orders o where o.id = _order;
  perform private.offer_to_couriers(_order, 'Entrega disponível novamente perto de você.');
  perform private.audit('delivery.release', 'deliveries', _order::text, '{}'::jsonb);
end $$;

-- localização: só enquanto disponível; vista pela equipe da plataforma no detalhe do pedido
create or replace function public.courier_update_location(_lat numeric, _lng numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.couriers%rowtype := private.require_active_courier();
begin
  perform private.limit_for('courier.location');
  if not c.is_online then raise exception 'Fique disponível para compartilhar a localização.' using errcode = 'P0001'; end if;
  if _lat is null or _lng is null or _lat not between -90 and 90 or _lng not between -180 and 180 then
    raise exception 'Localização inválida.' using errcode = 'P0001';
  end if;
  update public.couriers set last_lat = round(_lat, 6), last_lng = round(_lng, 6), last_location_at = now() where user_id = c.user_id;
end $$;

-- ao ficar indisponível, a última localização é apagada
create or replace function private.couriers_offline_clear() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_online and old.is_online then new.last_lat := null; new.last_lng := null; new.last_location_at := null; end if;
  return new;
end $$;
drop trigger if exists couriers_offline_clear on public.couriers;
create trigger couriers_offline_clear before update of is_online on public.couriers
  for each row execute function private.couriers_offline_clear();

-- ---------- estabelecimento: cozinha e tempo de preparo ----------
create or replace function private.kitchen_only(_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members where business_id = _business and user_id = auth.uid() and member_role = 'kitchen')
$$;

create or replace function public.update_order_status(_order uuid, _status public.order_status, _note text default null)
returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; staff boolean; kitchen boolean; ok boolean := false; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('order.status');
  select * into o from public.orders where id = _order for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  staff := public.has_business_permission(o.business_id, 'orders.update_status');
  kitchen := staff and private.kitchen_only(o.business_id);
  if not staff and o.customer_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;

  if kitchen then
    -- cozinha: só preparo
    ok := (o.status = 'accepted' and _status = 'preparing') or (o.status = 'preparing' and _status = 'ready');
  elsif staff then
    ok := (o.status = 'placed' and _status in ('accepted', 'rejected'))
       or (o.status = 'accepted' and _status = 'preparing')
       or (o.status = 'preparing' and _status = 'ready')
       or (o.status = 'ready' and o.fulfillment = 'delivery_own' and _status = 'out_for_delivery')
       or (o.status = 'ready' and o.fulfillment = 'pickup' and _status = 'picked_up')
       or (o.status = 'out_for_delivery' and o.fulfillment = 'delivery_own' and _status = 'delivered')
       or (o.status in ('accepted', 'preparing') and _status = 'cancelled')
       -- entrega parceira: depois de pronto só cancela se nenhum entregador coletou
       or (o.status = 'ready' and _status = 'cancelled' and not exists (
             select 1 from public.deliveries d where d.order_id = o.id and d.status in ('picked_up', 'delivered')));
  end if;
  if not ok and o.customer_id = auth.uid() then
    ok := o.status = 'placed' and _status = 'cancelled';
  end if;
  if not ok then raise exception 'Mudança de status não permitida (% → %).', o.status, _status using errcode = 'P0001'; end if;
  if _status = 'rejected' and note is null then raise exception 'Informe o motivo da recusa.' using errcode = 'P0001'; end if;
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
  return 'accepted';
end $$;

-- ---------- Master: acompanhamento e ocorrências ----------
create or replace function private.order_attention(o public.orders, d public.deliveries) returns text
language sql stable set search_path = '' as $$
  select case
    when o.status = 'placed' and o.created_at < now() - interval '10 minutes'
      then 'Aguardando aceite há ' || (extract(epoch from now() - o.created_at)::int / 60) || ' min'
    when d.order_id is not null and d.status in ('offered', 'accepted') and d.attention_reason is not null then d.attention_reason
    when o.status = 'ready' and o.fulfillment = 'pickup' and o.updated_at < now() - interval '60 minutes' then 'Pronto para retirada há mais de 1 h'
    when o.status in ('accepted', 'preparing') and o.estimated_ready_at < now() - interval '20 minutes' then 'Preparo atrasado'
  end
$$;

create or replace function public.admin_list_orders(_scope text default 'abertos', _search text default null, _include_test boolean default true,
                                                    _limit integer default 50, _offset integer default 0)
returns table (id uuid, code text, created_at timestamptz, status public.order_status, fulfillment public.order_fulfillment,
               payment_method public.order_payment, business_name text, city_name text, customer_name text, courier_name text,
               total_cents integer, commission_cents integer, platform_fee_cents integer, delivery_status public.delivery_status,
               attention text, is_test boolean, total bigint)
language plpgsql security definer set search_path = '' as $$
declare s text := nullif(btrim(coalesce(_search, '')), '');
begin
  perform private.require_permission('orders.view');
  perform private.limit_for('admin.orders');
  if coalesce(_scope, '') not in ('abertos', 'atencao', 'concluidos', 'cancelados', 'todos') then
    raise exception 'Filtro inválido.' using errcode = 'P0001';
  end if;
  perform private.sweep_deliveries();
  return query
    with base as (
      select o.id, o.code, o.created_at, o.status, o.fulfillment, o.payment_method, b.name as business_name,
             c.name || ' - ' || c.state as city_name, o.customer_name, cr.full_name as courier_name,
             o.total_cents, o.commission_cents, o.platform_delivery_fee_cents, d.status as delivery_status,
             private.order_attention(o, d) as attention, o.is_test
        from public.orders o
        join public.businesses b on b.id = o.business_id
        left join public.cities c on c.id = b.city_id
        left join public.deliveries d on d.order_id = o.id
        left join public.couriers cr on cr.user_id = d.courier_id
       where (_include_test or not o.is_test)
         and (s is null or o.code ilike s || '%' or b.name ilike '%' || s || '%' or o.customer_name ilike '%' || s || '%')
    )
    select x.*, count(*) over () from base x
     where case _scope
             when 'abertos' then x.status not in ('delivered', 'picked_up', 'rejected', 'cancelled')
             when 'atencao' then x.attention is not null and x.status not in ('delivered', 'picked_up', 'rejected', 'cancelled')
             when 'concluidos' then x.status in ('delivered', 'picked_up')
             when 'cancelados' then x.status in ('rejected', 'cancelled')
             else true end
     order by (x.attention is not null) desc, x.created_at desc
     limit least(greatest(coalesce(_limit, 50), 1), 200) offset greatest(coalesce(_offset, 0), 0);
end $$;

create or replace function public.admin_order_detail(_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders%rowtype; d public.deliveries%rowtype; full_contact boolean;
begin
  perform private.require_permission('orders.view');
  select * into o from public.orders where id = _order;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  select * into d from public.deliveries where order_id = _order;
  full_contact := public.has_platform_permission('users.view');
  return jsonb_build_object(
    'id', o.id, 'code', o.code, 'status', o.status, 'fulfillment', o.fulfillment, 'payment_method', o.payment_method,
    'created_at', o.created_at, 'is_test', o.is_test, 'notes', o.notes, 'rejection_reason', o.rejection_reason,
    'prep_minutes', o.prep_minutes, 'estimated_ready_at', o.estimated_ready_at,
    'attention', private.order_attention(o, d),
    'customer', jsonb_build_object('name', o.customer_name,
        'phone', case when full_contact then o.customer_phone end,
        'address', case when full_contact then o.delivery_address end),
    'business', (select jsonb_build_object('id', b.id, 'name', b.name, 'phone', b.phone, 'address', b.address_line,
                                           'city', c.name || ' - ' || c.state)
                   from public.businesses b left join public.cities c on c.id = b.city_id where b.id = o.business_id),
    'values', jsonb_build_object('subtotal_cents', o.subtotal_cents, 'delivery_fee_cents', o.delivery_fee_cents,
        'total_cents', o.total_cents, 'commission_cents', o.commission_cents,
        'merchant_delivery_cents', o.merchant_delivery_contribution_cents, 'courier_pay_cents', o.courier_pay_cents,
        'platform_fee_cents', o.platform_delivery_fee_cents, 'pricing_version', o.pricing_snapshot->'version'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents,
                                                           'line_total_cents', i.line_total_cents, 'options', i.options, 'notes', i.notes) order by i.name)
                         from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'note', e.note, 'at', e.created_at,
                                                            'actor', case
                                                              when e.actor_id is null then 'sistema'
                                                              when e.actor_id = o.customer_id then 'cliente'
                                                              when e.actor_id = d.courier_id then 'entregador'
                                                              when exists (select 1 from public.business_members bm where bm.business_id = o.business_id and bm.user_id = e.actor_id) then 'estabelecimento'
                                                              else 'equipe Tucaí' end) order by e.created_at, e.id)
                          from public.order_events e where e.order_id = o.id), '[]'::jsonb),
    'delivery', case when d.order_id is null then null else jsonb_build_object(
        'status', d.status, 'offer_round', d.offer_round, 'offer_expires_at', d.offer_expires_at, 'offered_at', d.offered_at,
        'accepted_at', d.accepted_at, 'picked_up_at', d.picked_up_at, 'delivered_at', d.delivered_at,
        'attention_reason', d.attention_reason, 'failed_code_attempts', d.failed_code_attempts,
        'declines', (select count(*) from public.delivery_declines x where x.order_id = d.order_id),
        'courier', (select jsonb_build_object('name', cr.full_name, 'phone', case when full_contact then cr.phone end, 'vehicle', cr.vehicle,
                                              'last_lat', cr.last_lat, 'last_lng', cr.last_lng, 'last_location_at', cr.last_location_at)
                      from public.couriers cr where cr.user_id = d.courier_id)) end
  );
end $$;

create or replace function public.admin_cancel_order(_order uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; r text := nullif(btrim(coalesce(_reason, '')), ''); cour uuid;
begin
  perform private.require_permission('orders.manage');
  perform private.limit_for('admin.orders.manage');
  if r is null or char_length(r) > 250 then raise exception 'Informe o motivo (até 250 caracteres).' using errcode = 'P0001'; end if;
  select * into o from public.orders where id = _order for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  if o.status in ('delivered', 'picked_up', 'rejected', 'cancelled') then
    raise exception 'Pedido já encerrado.' using errcode = 'P0001';
  end if;
  select courier_id into cour from public.deliveries where order_id = _order;
  update public.orders set status = 'cancelled', rejection_reason = 'Cancelado pela Tucaí: ' || r where id = _order;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, 'cancelled', auth.uid(), 'Cancelado pela Tucaí: ' || r);
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id, 'Pedido #' || o.code || ' cancelado pela Tucaí. ' || r);
  perform private.notify_order_staff(o, 'order_update', 'Pedido #' || o.code || ' cancelado pela Tucaí. ' || r);
  if cour is not null then
    perform private.notify_link(cour, 'order_update', null, '/entregador/entregas', 'Entrega do pedido #' || o.code || ' cancelada pela Tucaí.');
  end if;
  perform private.audit('orders.cancel', 'orders', _order::text, jsonb_build_object('reason', r, 'previous_status', o.status));
end $$;

create or replace function public.admin_redispatch(_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.deliveries%rowtype; code text;
begin
  perform private.require_permission('orders.manage');
  perform private.limit_for('admin.orders.manage');
  select * into d from public.deliveries where order_id = _order for update;
  if not found or d.status not in ('offered', 'accepted') then
    raise exception 'Só é possível redistribuir entregas ainda não coletadas.' using errcode = 'P0001';
  end if;
  select o.code into code from public.orders o where o.id = _order;
  if d.status = 'accepted' then
    perform private.notify_link(d.courier_id, 'order_update', null, '/entregador/entregas', 'A entrega do pedido #' || code || ' foi redistribuída pela Tucaí.');
  end if;
  delete from public.delivery_declines where order_id = _order;
  update public.deliveries set status = 'offered', courier_id = null, accepted_at = null, offer_round = 1,
         offer_expires_at = now() + private.offer_window(), attention_reason = null, attention_at = null
   where order_id = _order;
  insert into public.order_events(order_id, status, actor_id, note)
  select _order, o.status, auth.uid(), 'Entrega redistribuída pela Tucaí' from public.orders o where o.id = _order;
  perform private.offer_to_couriers(_order, 'Nova entrega disponível perto de você.');
  perform private.audit('orders.redispatch', 'deliveries', _order::text, jsonb_build_object('previous_status', d.status, 'previous_courier', d.courier_id));
end $$;

-- ---------- contas de homologação (9 perfis), sem duplicar ----------
create or replace function private.test_login_key(l jsonb) returns text language sql immutable as $$
  select coalesce(l->>'key', case
    when l->>'role' = 'lojista' and l->>'label' like '%Lanchonete%' then 'restaurante'
    when l->>'role' = 'lojista' then 'lojista'
    when l->>'role' = 'entregador' then 'entregador'
    when l->>'label' = 'Cliente 2' then 'cliente2'
    when l->>'role' = 'cliente' then 'cliente1' end)
$$;

create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cities%rowtype;
  r private.test_data_runs%rowtype;
  reuse boolean := false;
  sfx text := substr(md5(gen_random_uuid()::text), 1, 6);
  pwd text := 'Teste-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)) || '!';
  have text[] := '{}';
  created jsonb := '[]'::jsonb;
  new_users uuid[] := '{}';
  new_biz uuid[] := '{}';
  b_rest uuid; b_loja uuid; b_serv uuid;
  u uuid; cat uuid; mc uuid; p uuid; g uuid; run uuid;
  k text;
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  select * into c from public.cities where id = _city and is_active;
  if not found then raise exception 'Cidade não encontrada ou inativa.' using errcode = 'P0001'; end if;

  select * into r from private.test_data_runs where city_id = c.id and removed_at is null order by created_at desc limit 1 for update;
  if found then
    reuse := true;
    select coalesce(array_agg(private.test_login_key(l)), '{}') into have from jsonb_array_elements(r.logins) l;
    select id into b_rest from public.businesses where id = any(r.business_ids) and business_type = 'restaurante' order by created_at limit 1;
    select id into b_loja from public.businesses where id = any(r.business_ids) and business_type = 'loja' order by created_at limit 1;
    select id into b_serv from public.businesses where id = any(r.business_ids) and business_type = 'servico' order by created_at limit 1;
  end if;

  foreach k in array array['restaurante', 'funcionario', 'cozinha', 'lojista', 'prestador', 'entregador', 'entregador2', 'cliente1', 'cliente2', 'operador'] loop
    continue when k = any(have);
    if k = 'restaurante' and b_rest is not null then continue; end if;
    if k = 'lojista' and b_loja is not null then continue; end if;
    if k = 'prestador' and b_serv is not null then continue; end if;
    if k in ('funcionario', 'cozinha') and b_rest is null then continue; end if;  -- criado logo abaixo, na ordem

    u := private.create_auth_user(k || '-' || sfx || '@teste.example.com', pwd, case k
      when 'restaurante' then 'Dono Restaurante Teste' when 'funcionario' then 'Funcionário Teste' when 'cozinha' then 'Cozinha Teste'
      when 'lojista' then 'Lojista Teste' when 'prestador' then 'Prestador Teste' when 'entregador' then 'Entregador Teste'
      when 'entregador2' then 'Entregador Teste Dois' when 'cliente1' then 'Cliente Teste Um' when 'cliente2' then 'Cliente Teste Dois'
      else 'Operador Teste' end);
    update public.profiles set phone = '(35) 99999-0000' where id = u;
    new_users := new_users || u;

    if k = 'restaurante' then
      select id into cat from public.categories where kind = 'restaurante' and not is_demo order by sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
      values ('[Teste] Lanchonete do Tuca', private.unique_business_slug('teste lanchonete ' || sfx), u, 'active', 'restaurante', cat, c.id,
              'Estabelecimento de HOMOLOGAÇÃO: pedidos de teste com entregador parceiro. Não aparece para clientes reais.',
              'Rua de Teste, 100 - Centro', '(35) 99999-0001', '(35) 99999-0001', 'partner', true, 1000, 30, 45)
      returning id into b_rest;
      insert into public.business_members(business_id, user_id, member_role) values (b_rest, u, 'owner') on conflict do nothing;
      insert into public.menu_categories(business_id, name, sort_order) values (b_rest, 'Lanches', 10) returning id into mc;
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b_rest, mc, 'X-Burger', 'Pão, hambúrguer, queijo e molho da casa.', 2500, 10) returning id into p;
      insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
      values (b_rest, p, 'Ponto da carne', 1, 1, 10) returning id into g;
      insert into public.options(business_id, group_id, name, sort_order) values (b_rest, g, 'Ao ponto', 10), (b_rest, g, 'Bem passado', 20);
      insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
      values (b_rest, p, 'Adicionais', 0, 2, 20) returning id into g;
      insert into public.options(business_id, group_id, name, price_delta_cents, sort_order) values (b_rest, g, 'Bacon', 500, 10), (b_rest, g, 'Ovo', 300, 20);
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b_rest, mc, 'X-Salada', 'Hambúrguer, queijo, alface e tomate.', 2800, 20);
      insert into public.menu_categories(business_id, name, sort_order) values (b_rest, 'Bebidas', 20) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order)
      values (b_rest, mc, 'Refrigerante lata', 600, 10), (b_rest, mc, 'Suco natural 500 ml', 900, 20);
      insert into public.business_hours(business_id, weekday, opens, closes) select b_rest, d, '00:00', '24:00' from generate_series(0, 6) d;
      insert into public.jobs(business_id, city_id, title, area, description, employment_type, created_by)
      values (b_rest, c.id, '[Teste] Atendente', 'atendimento', 'Vaga de TESTE para validar candidaturas: atendimento ao público no balcão.', 'clt', u);
      new_biz := new_biz || b_rest;
      created := created || jsonb_build_object('key', k, 'role', 'restaurante', 'label', 'Dono do restaurante — [Teste] Lanchonete do Tuca', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'funcionario' then
      insert into public.business_members(business_id, user_id, member_role) values (b_rest, u, 'attendant');
      created := created || jsonb_build_object('key', k, 'role', 'funcionario', 'label', 'Funcionário (atendente) do restaurante de teste', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'cozinha' then
      insert into public.business_members(business_id, user_id, member_role) values (b_rest, u, 'kitchen');
      created := created || jsonb_build_object('key', k, 'role', 'cozinha', 'label', 'Operador da cozinha do restaurante de teste', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'lojista' then
      select id into cat from public.categories where kind = 'loja' and not is_demo order by sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, own_delivery_fee_cents, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
      values ('[Teste] Mercadinho Teste', private.unique_business_slug('teste mercadinho ' || sfx), u, 'active', 'loja', cat, c.id,
              'Estabelecimento de HOMOLOGAÇÃO: pedidos de teste com entrega própria. Não aparece para clientes reais.',
              'Avenida de Teste, 200 - Centro', '(35) 99999-0002', '(35) 99999-0002', 'own', 500, true, 0, 40, 60)
      returning id into b_loja;
      insert into public.business_members(business_id, user_id, member_role) values (b_loja, u, 'owner') on conflict do nothing;
      insert into public.menu_categories(business_id, name, sort_order) values (b_loja, 'Mercearia', 10) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order)
      values (b_loja, mc, 'Arroz 5 kg', 2990, 10), (b_loja, mc, 'Feijão 1 kg', 899, 20), (b_loja, mc, 'Café 500 g', 1690, 30);
      insert into public.business_hours(business_id, weekday, opens, closes) select b_loja, d, '00:00', '24:00' from generate_series(0, 6) d;
      new_biz := new_biz || b_loja;
      created := created || jsonb_build_object('key', k, 'role', 'lojista', 'label', 'Lojista — [Teste] Mercadinho Teste (entrega própria)', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'prestador' then
      select id into cat from public.categories where kind = 'servico' and not is_demo order by sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, accepts_pickup, min_order_cents)
      values ('[Teste] Serviços do Tuca', private.unique_business_slug('teste servicos ' || sfx), u, 'active', 'servico', cat, c.id,
              'Prestador de serviços de HOMOLOGAÇÃO. Não aparece para clientes reais.',
              'Rua de Teste, 300 - Centro', '(35) 99999-0004', '(35) 99999-0004', 'none', false, 0)
      returning id into b_serv;
      insert into public.business_members(business_id, user_id, member_role) values (b_serv, u, 'owner') on conflict do nothing;
      insert into public.services(business_id, name, category_id, city_id, description, phone, whatsapp)
      values (b_serv, '[Teste] Instalação elétrica residencial', cat, c.id, 'Serviço de teste para validar a vitrine de serviços.', '(35) 99999-0004', '(35) 99999-0004');
      new_biz := new_biz || b_serv;
      created := created || jsonb_build_object('key', k, 'role', 'prestador', 'label', 'Prestador de serviços — [Teste] Serviços do Tuca', 'email', k || '-' || sfx || '@teste.example.com');
    elsif k in ('entregador', 'entregador2') then
      insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category, status,
                                  terms_version, terms_accepted_at, reviewed_by, reviewed_at, review_note)
      values (u, case k when 'entregador' then 'Entregador Teste' else 'Entregador Teste Dois' end, '(35) 99999-0003', c.id, 'moto',
              case k when 'entregador' then 'TST1A23' else 'TST2B34' end, 'A', 'approved',
              'teste', now(), auth.uid(), now(), 'Cadastro de teste gerado pelo Painel Master.');
      insert into public.user_roles(user_id, role, granted_by) values (u, 'courier_partner', auth.uid()) on conflict do nothing;
      created := created || jsonb_build_object('key', k, 'role', 'entregador', 'label', case k when 'entregador' then 'Entregador independente 1' else 'Entregador independente 2 (concorrência)' end,
                                               'email', k || '-' || sfx || '@teste.example.com');
    elsif k in ('cliente1', 'cliente2') then
      created := created || jsonb_build_object('key', k, 'role', 'cliente', 'label', case k when 'cliente1' then 'Cliente 1' else 'Cliente 2' end, 'email', k || '-' || sfx || '@teste.example.com');
    elsif k = 'operador' then
      insert into public.user_roles(user_id, role, granted_by) values (u, 'platform_operator', auth.uid()) on conflict do nothing;
      insert into public.platform_staff_permissions(user_id, permission, granted_by)
      values (u, 'admin.dashboard', auth.uid()), (u, 'orders.view', auth.uid()), (u, 'users.view', auth.uid());
      created := created || jsonb_build_object('key', k, 'role', 'operador', 'label', 'Operador administrativo (painel, pedidos e usuários; exige MFA quando ativado)', 'email', k || '-' || sfx || '@teste.example.com');
    end if;
  end loop;

  if array_length(new_biz, 1) is not null then
    perform set_config('tucai.internal', 'on', true);
    update public.businesses set is_test = true where id = any(new_biz);
    perform set_config('tucai.internal', 'off', true);
  end if;

  if reuse then
    update private.test_data_runs set user_ids = user_ids || new_users, business_ids = business_ids || new_biz, logins = logins || created
     where id = r.id returning id into run;
  else
    insert into private.test_data_runs(city_id, created_by, user_ids, business_ids, logins)
    values (c.id, auth.uid(), new_users, new_biz, created) returning id into run;
  end if;
  perform private.audit('test_data.create', 'test_data_runs', run::text,
                        jsonb_build_object('city', c.id, 'reused', reuse, 'new_accounts', coalesce(array_length(new_users, 1), 0)));
  return jsonb_build_object('run_id', run, 'city', c.name || ' - ' || c.state, 'reused', reuse,
                            'password', case when array_length(new_users, 1) is null then null else pwd end, 'logins', created);
end $$;

-- ---------- tempo real ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
      alter publication supabase_realtime add table public.orders;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;

-- varredura a cada minuto quando o pg_cron estiver habilitado no projeto
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tucai-dispatch-sweep', '* * * * *', 'select private.sweep_deliveries()');
  end if;
end $$;

-- ---------- permissões ----------
do $$
declare f text;
begin
  foreach f in array array[
    'private.is_test_user(uuid)', 'private.businesses_is_test_guard()', 'private.orders_test_guard()', 'private.notify_ops(uuid, text)',
    'private.eligible_couriers(uuid, boolean)', 'private.offer_to_couriers(uuid, text)', 'private.orders_delivery_sync()',
    'private.sweep_deliveries()', 'private.couriers_offline_clear()', 'private.kitchen_only(uuid)',
    'private.order_attention(public.orders, public.deliveries)', 'private.platform_fees(uuid, timestamptz, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  revoke all on function public.viewer_sees_tests() from public;
  grant execute on function public.viewer_sees_tests() to anon, authenticated;
  foreach f in array array[
    'public.dispatch_tick()', 'public.courier_list_offers()', 'public.courier_accept_delivery(uuid)', 'public.courier_decline_delivery(uuid)',
    'public.courier_release_delivery(uuid)', 'public.courier_update_location(numeric, numeric)',
    'public.update_order_status(uuid, public.order_status, text)', 'public.merchant_accept_order(uuid, integer)',
    'public.admin_list_orders(text, text, boolean, integer, integer)', 'public.admin_order_detail(uuid)',
    'public.admin_cancel_order(uuid, text)', 'public.admin_redispatch(uuid)', 'public.admin_create_test_data(uuid)',
    'public.admin_finance_series(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
