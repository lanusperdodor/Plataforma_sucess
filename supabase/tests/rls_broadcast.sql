-- 0039: canal privado do rastreamento (Realtime Broadcast) sobre um esquema "realtime" simulado. Tudo é revertido. Sucesso: 'RLS_BROADCAST_OK'.
begin;
-- réplica mínima do Supabase Realtime: mensagens com RLS, tópico do canal da sessão e realtime.send
create schema realtime;
create table realtime.messages (id bigserial primary key, topic text not null, extension text not null, event text, payload jsonb, private boolean);
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated;
grant select, insert on realtime.messages to authenticated;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql security definer as $$
  insert into realtime.messages(topic, extension, event, payload, private) values (topic, 'broadcast', event, payload, private) $$;
grant execute on function realtime.topic() to authenticated;

-- reaplica a migration agora que o "realtime" existe
-- @include supabase/migrations/0039_rastreamento_broadcast.sql

create schema tsbr;
grant usage on schema tsbr to public;
create function tsbr.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true); set role authenticated; end $$;
create function tsbr.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsbr.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsbr.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tsbr.topic(t text) returns void language plpgsql as $$ begin perform set_config('realtime.topic', t, true); end $$;
create function tsbr.seen() returns int language sql as $$ select count(*)::int from realtime.messages $$;
grant execute on all functions in schema tsbr to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare city constant uuid := '12129000-0000-0000-0000-000000000039'; m uuid; e1 uuid; e2 uuid; k1 uuid; kp uuid; c1 uuid; c2 uuid; lan uuid; cheese text; o1 uuid;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Canal', 'MG', 'tsbr-cidade');
  m := private.create_auth_user('br-master@teste.invalid', 'senha-master-1', 'Master BR');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsbr.login(m);
  perform public.admin_create_test_data(city);
  perform tsbr.su();
  e1 := tsbr.uid('empresario1'); e2 := tsbr.uid('empresario2'); k1 := tsbr.uid('entregador'); kp := tsbr.uid('entregador2');
  c1 := tsbr.uid('cliente1'); c2 := tsbr.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';

  perform tsbr.login(c1);
  o1 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                           'Cliente 1', '(35) 99999-0001', 'Rua A, 1, Centro', null, null, null, 'br-0000001');
  perform tsbr.login(k1);
  perform public.set_courier_online(true);
  perform public.courier_accept_delivery(o1);
  perform public.courier_track_location(o1, -20.0712345, -44.5712345, 12);

  perform tsbr.su();
  perform tsbr.ok((select count(*) from realtime.messages where topic = 'rastreio:' || o1 and private and event = 'atualizado') >= 1, 'banco enviou o aviso no canal privado do pedido');
  perform tsbr.ok(not exists (select 1 from realtime.messages where payload ? 'lat' or payload ? 'lng' or payload::text ~ '-20\.07'), 'aviso sem coordenadas');

  -- quem pode ver o pedido recebe; os outros não
  perform tsbr.login(c1); perform tsbr.topic('rastreio:' || o1);
  perform tsbr.ok(tsbr.seen() >= 1, 'Cliente 1 recebe no canal do próprio pedido');
  perform tsbr.login(e1); perform tsbr.topic('rastreio:' || o1);
  perform tsbr.ok(tsbr.seen() >= 1, 'Empresário 1 (loja do pedido) recebe');
  perform tsbr.login(k1); perform tsbr.topic('rastreio:' || o1);
  perform tsbr.ok(tsbr.seen() >= 1, 'Entregador 1 (atribuído) recebe');
  perform tsbr.login(c2); perform tsbr.topic('rastreio:' || o1);
  perform tsbr.ok(tsbr.seen() = 0, 'Cliente 2 não recebe do pedido do Cliente 1');
  perform tsbr.login(e2); perform tsbr.topic('rastreio:' || o1);
  perform tsbr.ok(tsbr.seen() = 0, 'Empresário 2 não recebe pedido de outra loja');
  perform tsbr.login(kp); perform tsbr.topic('rastreio:' || o1);
  perform tsbr.ok(tsbr.seen() = 0, 'Entregador 2 (próprio de outra loja) não recebe');
  perform tsbr.login(c1); perform tsbr.topic('rastreio:qualquer-coisa');
  perform tsbr.ok(tsbr.seen() = 0, 'tópico inválido não abre nada');
  -- ninguém publica pelo navegador
  begin
    perform tsbr.login(c1);
    insert into realtime.messages(topic, extension, event, payload, private) values ('rastreio:' || o1, 'broadcast', 'atualizado', '{}', true);
    raise exception 'FALHOU: cliente não pode publicar no canal';
  exception when insufficient_privilege then null;
  end;
  perform tsbr.su();
  raise notice 'RLS_BROADCAST_OK';
end $$;
rollback;
