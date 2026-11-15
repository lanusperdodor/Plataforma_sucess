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
