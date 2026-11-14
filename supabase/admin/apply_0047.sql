-- =====================================================================================
-- TUCAÍ — ATUALIZAÇÃO (migration 0047: ponto de entrega pelo endereço) PARA O SQL EDITOR DO SUPABASE
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

-- ===================== supabase/migrations/0047_ponto_pelo_endereco.sql =====================
do $tucai_0047$
begin
  if exists (select 1 from private.tucai_migrations where version = '0047') then
    raise notice 'Tucaí 0047: já aplicada';
  else
    execute $tucai_sql$
-- 0047: ponto de entrega a partir do ENDEREÇO digitado (quando o cliente não marcou a localização no mapa).
-- O Worker converte o endereço em coordenadas (busca de endereços do openrouteservice, chave só no servidor).
--  * cliente: continua com customer_set_delivery_point (0037) — o app chama sozinho depois do pedido.
--  * entregador da entrega: pode gravar o ponto pelo endereço SÓ se o pedido ainda não tiver ponto, e só perto da loja
--    (até 60 km), para não trocar o destino que o cliente marcou. Fica registrado no histórico do pedido.
-- Nada disso muda valores (frete e ganho vêm da cotação do checkout, 0040).

alter table public.orders add column if not exists delivery_point_source text
  check (delivery_point_source is null or delivery_point_source in ('cliente', 'endereco'));

create or replace function public.courier_set_delivery_point_from_address(_order uuid, _lat numeric, _lng numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare v_leg text := private.tracking_leg(_order, auth.uid()); o public.orders%rowtype; b record;
begin
  if auth.uid() is null or v_leg is null then raise exception 'Esta entrega não está atribuída a você.' using errcode = '42501'; end if;
  perform private.rate_limit('order.delivery_point_address', 10, 600);
  if _lat is null or _lng is null or _lat not between -34 and 6 or _lng not between -74 and -34 then
    raise exception 'Localização fora do Brasil.' using errcode = 'P0001';
  end if;
  select * into o from public.orders where id = _order for update;
  if o.delivery_lat is not null then raise exception 'O ponto de entrega já está marcado.' using errcode = 'P0001'; end if;
  select bc.lat, bc.lng into b from public.businesses bc where bc.id = o.business_id;
  -- ~60 km da loja (grau de latitude ≈ 111 km): evita um endereço homônimo em outra cidade
  if b.lat is not null and (abs(b.lat - _lat) > 0.55 or abs(b.lng - _lng) > 0.6) then
    raise exception 'O endereço encontrado fica longe da loja; confirme com o cliente.' using errcode = 'P0001';
  end if;
  update public.orders set delivery_lat = round(_lat, 5), delivery_lng = round(_lng, 5), delivery_point_source = 'endereco' where id = _order;
  insert into public.order_events(order_id, status, actor_id, note) values (_order, o.status, auth.uid(), 'Ponto de entrega localizado pelo endereço');
  perform private.tracking_tick(_order);
end $$;

-- o cliente marcando pelo aparelho fica registrado como 'cliente' (o ponto pelo endereço pode ser corrigido pelo cliente)
create or replace function private.orders_point_source() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.delivery_lat is distinct from old.delivery_lat and new.delivery_point_source is not distinct from old.delivery_point_source then
    new.delivery_point_source := 'cliente';
  end if;
  return new;
end $$;
drop trigger if exists orders_point_source on public.orders;
create trigger orders_point_source before update of delivery_lat on public.orders
  for each row execute function private.orders_point_source();

do $$ begin
  revoke all on function public.courier_set_delivery_point_from_address(uuid, numeric, numeric) from public, anon;
  grant execute on function public.courier_set_delivery_point_from_address(uuid, numeric, numeric) to authenticated;
  revoke all on function private.orders_point_source() from public, anon, authenticated;
end $$;

$tucai_sql$;
    insert into private.tucai_migrations(version, name, how) values ('0047', '0047_ponto_pelo_endereco.sql', 'applied');
    raise notice 'Tucaí 0047: aplicada agora';
  end if;
end $tucai_0047$;

select version, name, how, applied_at from private.tucai_migrations order by version;
