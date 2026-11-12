-- Testes da 0031 (excluir todos os dados de teste). Tudo é revertido. Sucesso: NOTICE 'RLS_EXCLUIR_TESTE_OK'.
-- Tudo é revertido. Sucesso: NOTICE 'RLS_ENTREGA_CODIGO_OK'.
begin;
create schema tsxt;
grant usage on schema tsxt to public;
create function tsxt.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tsxt.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsxt.blocked(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm like '%em manutenção%' then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido bloqueado pela manutenção)', msg;
end $$;
create function tsxt.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsxt.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsxt.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsxt.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsxt.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tsxt.step(msg text) returns void language plpgsql as $$ begin raise notice 'CHEESEBURGER: %', msg; end $$;
grant execute on all functions in schema tsxt to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  ca constant uuid := '88889000-0000-0000-0000-000000000001';
  cb constant uuid := '88889000-0000-0000-0000-000000000002';
  m uuid; op uuid; dono uuid; real_biz uuid; loj uuid; c1 uuid; bm uuid; cheese text; o uuid; tab uuid; res jsonb; test_users uuid[];
begin
  insert into public.cities(id, name, state, slug) values (ca, 'Cidade Teste A', 'MG', 'tsxt-a'), (cb, 'Cidade Teste B', 'SP', 'tsxt-b');
  m := private.create_auth_user('xt-master@teste.invalid', 'senha-master-1', 'Master XT');
  op := private.create_auth_user('xt-op@teste.invalid', 'senha-op-1', 'Operador XT');
  dono := private.create_auth_user('xt-dono-real@teste.invalid', 'senha-dono-1', 'Dono Real');
  insert into public.user_roles(user_id, role) values (m, 'platform_master'), (op, 'platform_operator');
  insert into public.businesses(name, slug, owner_id, status, business_type, city_id) values ('Padaria Real', 'tsxt-padaria-real', dono, 'active', 'loja', ca) returning id into real_biz;

  perform tsxt.login(m);
  perform public.admin_create_test_data(ca);
  perform public.admin_create_test_data(cb);
  perform tsxt.su();
  select array_agg(u) into test_users from private.test_data_runs r, unnest(r.user_ids) u where r.removed_at is null;
  loj := tsxt.uid('lojista'); c1 := tsxt.uid('cliente1');
  select id into bm from public.businesses where owner_id = loj limit 1;
  select id::text into cheese from public.products where business_id = bm and name = 'Cheeseburger';
  -- movimento de teste: pedido, comanda, caixa e cobrança
  perform tsxt.login(c1);
  o := public.place_order(bm, jsonb_build_array(jsonb_build_object('product_id', cheese, 'quantity', 1)), 'delivery_partner', 'cash',
                          'Cliente Teste Um', '(35) 99999-0000', 'Rua das Flores, 100', null, null, null, 'xt-000000001');
  perform tsxt.login(loj);
  perform public.gestao_open_cash(bm, 1000);
  tab := public.gestao_open_tab(bm, null, 'Balcão', 1);
  perform tsxt.login(m);
  perform public.admin_create_charge(bm, 'Mensalidade teste', 7900, current_date + 5);
  perform tsxt.su();
  perform tsxt.ok((select count(*) from public.businesses where is_test) >= 6, 'dois lotes com estabelecimentos de teste');

  -- só Master, com confirmação
  perform tsxt.login(op, 'aal2');
  perform tsxt.denied($q$select public.admin_remove_all_test_data('EXCLUIR')$q$, 'operador exclui tudo');
  perform tsxt.login(loj);
  perform tsxt.denied($q$select public.admin_remove_all_test_data('EXCLUIR')$q$, 'conta de teste exclui tudo');
  perform tsxt.login(m);
  perform tsxt.denied($q$select public.admin_remove_all_test_data('sim')$q$, 'sem digitar EXCLUIR', array['P0001']);
  res := public.admin_remove_all_test_data('excluir');
  perform tsxt.ok((res->>'lotes')::int = 2 and (res->>'pedidos')::int >= 1 and (res->>'estabelecimentos')::int >= 6, 'contagens: ' || res::text);

  perform tsxt.su();
  perform tsxt.ok(not exists (select 1 from private.test_data_runs where removed_at is null), 'nenhum lote ativo');
  perform tsxt.ok(not exists (select 1 from public.businesses where is_test), 'nenhum estabelecimento de teste');
  perform tsxt.ok(not exists (select 1 from public.orders where is_test or id = o), 'nenhum pedido de teste');
  perform tsxt.ok(not exists (select 1 from public.business_tabs where id = tab), 'comandas de teste removidas');
  perform tsxt.ok(not exists (select 1 from public.cash_sessions where business_id = bm), 'caixas de teste removidos');
  perform tsxt.ok(not exists (select 1 from public.platform_charges where business_id = bm), 'cobranças de teste removidas');
  perform tsxt.ok(not exists (select 1 from auth.users where id = any(test_users) and email not like 'removido-%'), 'logins de teste removidos ou anonimizados');
  perform tsxt.ok(exists (select 1 from public.businesses where id = real_biz and not is_test), 'estabelecimento real intacto');
  perform tsxt.ok(exists (select 1 from auth.users where id = dono), 'conta real intacta');
  perform tsxt.ok(exists (select 1 from public.audit_logs where action = 'test_data.remove_all'), 'auditado');
  perform tsxt.login(m);
  res := public.admin_remove_all_test_data('EXCLUIR');
  perform tsxt.ok((res->>'lotes')::int = 0 and (res->>'estabelecimentos')::int = 0, 'repetir não quebra nem apaga nada real');
  -- dá para criar dados de teste de novo depois
  perform public.admin_create_test_data(ca);
  raise notice 'RLS_EXCLUIR_TESTE_OK';
end $$;
rollback;
