-- Testes da 0033 (exatamente sete contas de teste em toda a Tucaí). Tudo é revertido. Sucesso: NOTICE 'RLS_SETE_CONTAS_OK'.
-- Tudo é revertido. Sucesso: NOTICE 'RLS_ENTREGA_CODIGO_OK'.
begin;
create schema tssc;
grant usage on schema tssc to public;
create function tssc.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tssc.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tssc.blocked(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm like '%em manutenção%' then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido bloqueado pela manutenção)', msg;
end $$;
create function tssc.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tssc.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tssc.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tssc.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tssc.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tssc.step(msg text) returns void language plpgsql as $$ begin raise notice 'CHEESEBURGER: %', msg; end $$;
grant execute on all functions in schema tssc to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  ca constant uuid := '13139000-0000-0000-0000-000000000001';
  cb constant uuid := '13139000-0000-0000-0000-000000000002';
  m uuid; op uuid; dono_real uuid; real_biz uuid; old_run uuid; old1 uuid; old2 uuid; res jsonb; e1 uuid;
begin
  insert into public.cities(id, name, state, slug) values (ca, 'Cidade Sete A', 'MG', 'tssc-a'), (cb, 'Cidade Sete B', 'SP', 'tssc-b');
  m := private.create_auth_user('sc-master@teste.invalid', 'senha-master-1', 'Master SC');
  op := private.create_auth_user('sc-op@teste.invalid', 'senha-op-1', 'Operador SC');
  dono_real := private.create_auth_user('sc-dono-real@teste.invalid', 'senha-real-1', 'Dono Real');
  insert into public.user_roles(user_id, role) values (m, 'platform_master'), (op, 'platform_operator');
  insert into public.businesses(name, slug, owner_id, status, business_type, city_id) values ('Mercado Real', 'tssc-mercado-real', dono_real, 'active', 'loja', ca) returning id into real_biz;

  -- lote antigo fora do padrão (formato de 10 contas): cozinha e operador de teste
  old1 := private.create_auth_user('cozinha-old111@teste.example.com', 'x-senha-1', 'Cozinha Antiga');
  old2 := private.create_auth_user('operador-old111@teste.example.com', 'x-senha-2', 'Operador Antigo');
  insert into public.user_roles(user_id, role) values (old2, 'platform_operator');
  insert into private.test_data_runs(city_id, created_by, user_ids, business_ids, logins)
  values (ca, m, array[old1, old2], '{}', '[{"key":"cozinha","label":"Cozinha","email":"cozinha-old111@teste.example.com"},{"key":"operador","label":"Operador","email":"operador-old111@teste.example.com"}]')
  returning id into old_run;

  perform tssc.login(m);
  res := public.admin_test_accounts_status();
  perform tssc.ok(not (res->>'padrao')::boolean and (res->>'contas')::int = 2 and jsonb_array_length(res->'excedentes') = 2, 'diagnóstico aponta contas fora do padrão');
  perform tssc.denied(format('select public.admin_create_test_data(%L)', ca), 'criar com lote antigo ativo', array['P0001']);

  -- dependência real impede a remoção (nada é apagado)
  perform tssc.su();
  insert into public.business_members(business_id, user_id, member_role) values (real_biz, old1, 'kitchen');
  perform tssc.login(m);
  perform tssc.ok(jsonb_array_length(public.admin_test_accounts_status()->'bloqueios') = 1, 'diagnóstico mostra o vínculo real');
  perform tssc.denied(format($q$select public.admin_standardize_test_accounts(%L, 'PADRONIZAR')$q$, ca), 'padronizar com vínculo real', array['P0001']);
  perform tssc.su();
  perform tssc.ok(exists (select 1 from auth.users where id = old1) and exists (select 1 from private.test_data_runs where id = old_run and removed_at is null), 'nada removido');
  delete from public.business_members where business_id = real_biz and user_id = old1;

  -- só Master, com confirmação
  perform tssc.login(op, 'aal2');
  perform tssc.denied(format($q$select public.admin_standardize_test_accounts(%L, 'PADRONIZAR')$q$, ca), 'operador padroniza');
  perform tssc.login(m);
  perform tssc.denied(format($q$select public.admin_standardize_test_accounts(%L, 'sim')$q$, ca), 'sem digitar PADRONIZAR', array['P0001']);
  res := public.admin_standardize_test_accounts(ca, 'padronizar');
  perform tssc.ok((res->>'lotes_removidos')::int = 1 and (res->>'contas_removidas')::int = 2 and jsonb_array_length(res->'criadas'->'logins') = 7, 'remove o excedente e cria as sete');
  res := public.admin_test_accounts_status();
  perform tssc.ok((res->>'padrao')::boolean and (res->>'contas')::int = 7 and jsonb_array_length(res->'excedentes') = 0 and jsonb_array_length(res->'faltando') = 0, 'exatamente sete contas, no padrão');

  -- um único conjunto global: outra cidade é recusada; padronizar muda de cidade sem duplicar
  perform tssc.denied(format('select public.admin_create_test_data(%L)', cb), 'segundo conjunto em outra cidade', array['P0001']);
  res := public.admin_create_test_data(ca);
  perform tssc.ok(jsonb_array_length(res->'logins') = 0, 'repetir na mesma cidade não duplica');
  res := public.admin_standardize_test_accounts(cb, 'PADRONIZAR');
  perform tssc.ok((res->>'lotes_removidos')::int = 1 and jsonb_array_length(res->'criadas'->'logins') = 7, 'conjunto levado para outra cidade');
  perform tssc.su();
  perform tssc.ok((select count(distinct u) from private.test_data_runs r, unnest(r.user_ids) u where r.removed_at is null) = 7, 'total global: 7 contas de teste');
  perform tssc.ok((select count(*) from private.test_data_runs where removed_at is null) = 1, 'um único lote ativo');
  perform tssc.ok(not exists (select 1 from public.user_roles r join private.test_data_runs t on r.user_id = any(t.user_ids) and t.removed_at is null
                               where r.role in ('platform_operator', 'platform_master')), 'nenhuma conta de teste administrativa');
  perform tssc.ok(not exists (select 1 from public.business_members m join private.test_data_runs t on m.user_id = any(t.user_ids) and t.removed_at is null
                               where m.member_role = 'kitchen'), 'nenhuma conta de cozinha');
  perform tssc.ok(exists (select 1 from auth.users where id = dono_real) and exists (select 1 from public.businesses where id = real_biz), 'usuário e estabelecimento reais intactos');
  perform tssc.ok(exists (select 1 from auth.users where id = m) and public.has_role('platform_master') is not null, 'Master preservado');
  perform tssc.ok(exists (select 1 from public.audit_logs where action = 'test_data.standardize'), 'padronização auditada');
  raise notice 'RLS_SETE_CONTAS_OK';
end $$;
rollback;
