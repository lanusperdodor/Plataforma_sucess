-- Notificações: a consulta exata do app funciona e cada cliente vê/marca só as próprias. Tudo é revertido. Sucesso: 'RLS_NOTIFICACOES_OK'.
begin;
create schema tsnt;
grant usage on schema tsnt to public;
create function tsnt.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true); set role authenticated; end $$;
create function tsnt.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsnt.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsnt.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on all functions in schema tsnt to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare city constant uuid := '12129000-0000-0000-0000-000000000038'; m uuid; e1 uuid; c1 uuid; c2 uuid; lan uuid; cheese text; o1 uuid; n int; kinds text[];
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Avisos', 'MG', 'tsnt-cidade');
  m := private.create_auth_user('nt-master@teste.invalid', 'senha-master-1', 'Master NT');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tsnt.login(m);
  perform public.admin_create_test_data(city);
  perform tsnt.su();
  e1 := tsnt.uid('empresario1'); c1 := tsnt.uid('cliente1'); c2 := tsnt.uid('cliente2');
  select id into lan from public.businesses where owner_id = e1;
  select id::text into cheese from public.products where business_id = lan and name = 'Cheeseburger';

  -- Cliente 1 compra; a loja aceita: Cliente 1 recebe aviso de pedido (tipo que derrubava a tela antes da correção)
  perform tsnt.login(c1);
  o1 := public.place_order(lan, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'pickup', 'cash',
                           'Cliente 1', '(35) 99999-0001', null, null, null, null, 'nt-0000001');
  perform tsnt.login(e1);
  perform public.update_order_status(o1, 'accepted');
  -- amizade: Cliente 2 pede amizade ao Cliente 1 (gera friend_request)
  perform tsnt.login(c1);
  insert into public.social_profiles(user_id, handle, display_name, city_id) values (c1, 'cliente_um_nt', 'Cliente 1', city) on conflict (user_id) do nothing;
  perform tsnt.login(c2);
  insert into public.social_profiles(user_id, handle, display_name, city_id) values (c2, 'cliente_dois_nt', 'Cliente 2', city) on conflict (user_id) do nothing;
  insert into public.friendships(requester_id, addressee_id) values (c2, c1);

  -- a consulta EXATA do app (com link) funciona para o próprio usuário
  perform tsnt.login(c1);
  select count(*), array_agg(distinct kind) into n, kinds from (
    select id, kind, actor_id, post_id, comment_id, link, message, read_at, created_at from public.notifications
     where user_id = c1 order by created_at desc limit 50) x;
  perform tsnt.ok(n >= 2 and 'order_update' = any(kinds) and 'friend_request' = any(kinds), 'Cliente 1 lê aviso de pedido e pedido de amizade: ' || coalesce(kinds::text, '{}'));

  -- isolamento: Cliente 2 não vê nem marca as do Cliente 1
  perform tsnt.login(c2);
  perform tsnt.ok((select count(*) from public.notifications where user_id = c1) = 0, 'Cliente 2 não vê notificações do Cliente 1');
  update public.notifications set read_at = now() where user_id = c1;
  perform tsnt.su();
  perform tsnt.ok((select count(*) from public.notifications where user_id = c1 and read_at is not null) = 0, 'Cliente 2 não marca as do Cliente 1');

  -- Cliente 1 marca como lidas (só read_at pode mudar)
  perform tsnt.login(c1);
  update public.notifications set read_at = now() where user_id = c1 and read_at is null;
  perform tsnt.ok((select count(*) from public.notifications where user_id = c1 and read_at is null) = 0, 'Cliente 1 marca as próprias como lidas');
  begin
    update public.notifications set message = 'alterada' where user_id = c1;
    raise exception 'FALHOU: mensagem não deveria ser editável';
  exception when insufficient_privilege then null;
  end;
  perform tsnt.su();
  raise notice 'RLS_NOTIFICACOES_OK';
end $$;
rollback;
