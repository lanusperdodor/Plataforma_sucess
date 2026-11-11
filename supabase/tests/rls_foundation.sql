-- Testes de autorização/RLS da migration 0001, em SQL puro (sem pgTAP).
-- Rodam em qualquer PostgreSQL com a migration aplicada (Supabase ou stub local em
-- local_auth_stub.sql). Executar como superusuário/postgres; tudo é revertido no final.
-- Qualquer falha levanta exceção. Sucesso termina com NOTICE 'RLS_FOUNDATION_OK'.
begin;

create schema tst;
grant usage on schema tst to public;

create function tst.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
create function tst.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set role anon;
end $$;
create function tst.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tst.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
-- exige erro com um dos SQLSTATE informados
create function tst.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tst.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tst.affected(stmt text) returns int language plpgsql as $$
declare n int; begin execute stmt; get diagnostics n = row_count; return n; end $$;

-- ---------- dados (como superusuário) ----------
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@teste.invalid'),   -- cliente
  ('00000000-0000-0000-0000-0000000000b1', 'b@teste.invalid'),   -- cliente
  ('00000000-0000-0000-0000-0000000000c1', 'dono1@teste.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'dono2@teste.invalid'),
  ('00000000-0000-0000-0000-0000000000d1', 'atendente@teste.invalid'),
  ('00000000-0000-0000-0000-0000000000d2', 'gerente@teste.invalid'),
  ('00000000-0000-0000-0000-0000000000e1', 'master@teste.invalid'),
  ('00000000-0000-0000-0000-0000000000e2', 'master2@teste.invalid');
insert into public.user_roles(user_id, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'platform_master');

insert into public.businesses(id, name, slug, owner_id, status) values
  ('10000000-0000-0000-0000-000000000001', 'Loja Um', 'loja-um', '00000000-0000-0000-0000-0000000000c1', 'active'),
  ('10000000-0000-0000-0000-000000000002', 'Loja Dois', 'loja-dois', '00000000-0000-0000-0000-0000000000c2', 'active'),
  ('10000000-0000-0000-0000-000000000003', 'Loja Pendente', 'loja-pendente', '00000000-0000-0000-0000-0000000000c2', 'pending');
insert into public.business_members(business_id, user_id, member_role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'attendant'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', 'manager'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', 'owner'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c2', 'owner');

do $$
declare
  a  constant uuid := '00000000-0000-0000-0000-0000000000a1';
  b  constant uuid := '00000000-0000-0000-0000-0000000000b1';
  o1 constant uuid := '00000000-0000-0000-0000-0000000000c1';
  o2 constant uuid := '00000000-0000-0000-0000-0000000000c2';
  at1 constant uuid := '00000000-0000-0000-0000-0000000000d1';
  mg1 constant uuid := '00000000-0000-0000-0000-0000000000d2';
  m1 constant uuid := '00000000-0000-0000-0000-0000000000e1';
  m2 constant uuid := '00000000-0000-0000-0000-0000000000e2';
  biz1 constant text := '10000000-0000-0000-0000-000000000001';
  biz2 constant text := '10000000-0000-0000-0000-000000000002';
  biz3 constant text := '10000000-0000-0000-0000-000000000003';
begin
  -- 1. gatilho de novo usuário
  perform tst.su();
  perform tst.ok((select count(*) from public.user_roles where user_id = a and role = 'customer') = 1, 'novo usuário recebe customer');
  perform tst.ok((select count(*) from public.profiles where id = a) = 1, 'novo usuário recebe profile');
  perform tst.ok((select count(*) from public.user_roles where user_id = a) = 1, 'novo usuário recebe só customer');

  -- 2. matriz de permissões populada com o tipo correto
  perform tst.ok((select count(*) from public.role_permissions where member_role = 'owner') = 8, 'owner tem todas as 8 permissões');
  perform tst.ok((select count(*) from public.role_permissions where member_role = 'attendant') = 2, 'attendant tem 2');
  perform tst.ok(not exists (select 1 from public.role_permissions where member_role = 'courier_own' and permission <> 'orders.view'), 'courier_own só orders.view');

  -- 3. escalada de papéis
  perform tst.login(a);
  perform tst.denied($q$insert into public.user_roles(user_id, role) values ('00000000-0000-0000-0000-0000000000a1','platform_master')$q$, 'autoatribuir master');
  perform tst.denied($q$update public.user_roles set role = 'platform_master' where user_id = '00000000-0000-0000-0000-0000000000a1'$q$, 'update de user_roles');
  perform tst.denied($q$delete from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000a1'$q$, 'delete de user_roles');
  perform tst.denied($q$select public.grant_role('00000000-0000-0000-0000-0000000000a1','platform_master')$q$, 'grant_role por cliente');
  perform tst.denied($q$select public.revoke_role('00000000-0000-0000-0000-0000000000e1','platform_master')$q$, 'revoke_role por cliente');
  perform tst.login(o1);
  perform tst.denied($q$select public.grant_role('00000000-0000-0000-0000-0000000000c1','platform_operator')$q$, 'grant_role por dono de loja');
  perform tst.anon();
  perform tst.denied($q$select public.grant_role('00000000-0000-0000-0000-0000000000a1','platform_master')$q$, 'grant_role anônimo');
  perform tst.denied($q$select public.handle_new_user()$q$, 'handle_new_user via API (anon)');
  perform tst.login(a);
  perform tst.denied($q$select public.handle_new_user()$q$, 'handle_new_user via API (authenticated)');

  -- 4. isolamento de perfis, papéis e auditoria
  perform tst.login(a);
  perform tst.ok(tst.count('select 1 from public.profiles') = 1, 'cliente vê só o próprio perfil');
  perform tst.ok(tst.count('select 1 from public.user_roles') = 1, 'cliente vê só os próprios papéis');
  perform tst.ok(tst.count('select 1 from public.audit_logs') = 0, 'cliente não lê auditoria');
  perform tst.denied($q$insert into public.audit_logs(action, entity) values ('x','y')$q$, 'cliente escreve auditoria');
  perform tst.ok(tst.affected($q$update public.profiles set full_name = 'Fulano' where id = '00000000-0000-0000-0000-0000000000a1'$q$) = 1, 'edita o próprio perfil');
  perform tst.ok(tst.affected($q$update public.profiles set full_name = 'Hack' where id = '00000000-0000-0000-0000-0000000000b1'$q$) = 0, 'não edita perfil alheio');
  perform tst.denied($q$update public.profiles set id = gen_random_uuid() where id = '00000000-0000-0000-0000-0000000000a1'$q$, 'alterar id do perfil');
  perform tst.denied($q$insert into public.profiles(id) values (gen_random_uuid())$q$, 'inserir perfil direto');
  perform tst.denied($q$delete from public.profiles$q$, 'apagar perfil');
  perform tst.denied($q$insert into public.permissions(code) values ('hack')$q$, 'escrever permissions');
  perform tst.denied($q$insert into public.role_permissions(member_role, permission) values ('attendant','staff.manage')$q$, 'escrever role_permissions');
  perform tst.ok(tst.count('select 1 from public.permissions') = 8, 'autenticado lê catálogo de permissões');

  -- 5. anon: só lojas ativas, nada mais
  perform tst.anon();
  perform tst.ok(tst.count($q$select 1 from public.public_businesses where id::text like '10000000-0000-0000-0000-00000000000%'$q$) = 2, 'anon vê só lojas ativas');
  perform tst.ok(tst.count($q$select 1 from public.public_businesses where status = 'pending'$q$) = 0, 'anon não vê loja pendente');
  perform tst.denied('select 1 from public.businesses', 'anon le a tabela businesses (so a visao publica; protege owner_id)');
  perform tst.denied('select owner_id from public.public_businesses', 'visao publica nao expoe owner_id', array['42703']);
  perform tst.denied('select 1 from public.profiles', 'anon lê profiles');
  perform tst.denied('select 1 from public.user_roles', 'anon lê user_roles');
  perform tst.denied('select 1 from public.business_members', 'anon lê membros');
  perform tst.denied('select 1 from public.audit_logs', 'anon lê auditoria');
  perform tst.denied($q$update public.businesses set name = 'x'$q$, 'anon atualiza loja');

  -- 6. isolamento entre empresas
  perform tst.login(b);
  perform tst.ok(tst.count($q$select 1 from public.public_businesses where id::text like '10000000-0000-0000-0000-00000000000%'$q$) = 2, 'cliente vê lojas ativas, não a pendente');
  perform tst.ok(tst.count('select owner_id from public.businesses') = 0, 'nao-membro nao le a tabela businesses (owner_id protegido)');
  perform tst.ok(tst.count('select 1 from public.business_members') = 0, 'não-membro não vê equipe');
  perform tst.login(o1);
  perform tst.ok(tst.count('select 1 from public.business_members') = 3, 'dono 1 vê só a equipe da loja 1');
  perform tst.ok(tst.count('select 1 from public.business_members where business_id = ' || quote_literal(biz2)) = 0, 'dono 1 não vê equipe da loja 2');
  perform tst.login(o2);
  perform tst.ok(tst.count($q$select 1 from public.businesses where status = 'pending'$q$) = 1, 'dono vê a própria loja pendente');
  perform tst.ok(tst.count('select 1 from public.businesses') = 2, 'dono 2 vê ativas + sua pendente');

  -- 7. escrita em businesses
  perform tst.login(o1);
  perform tst.ok(tst.affected('update public.businesses set name = ''Loja Um Renomeada'' where id = ' || quote_literal(biz1)) = 1, 'dono renomeia a própria loja');
  perform tst.ok(tst.affected('update public.businesses set name = ''Invasão'' where id = ' || quote_literal(biz2)) = 0, 'dono não renomeia loja alheia');
  perform tst.denied('update public.businesses set status = ''active'' where id = ' || quote_literal(biz3), 'dono altera status');
  perform tst.denied('update public.businesses set owner_id = ' || quote_literal(a) || ' where id = ' || quote_literal(biz1), 'dono altera owner_id');
  perform tst.denied('update public.businesses set slug = ''outro'' where id = ' || quote_literal(biz1), 'dono altera slug');
  perform tst.denied($q$insert into public.businesses(name, slug, owner_id) values ('Nova','nova','00000000-0000-0000-0000-0000000000c1')$q$, 'criar loja direto (sem fluxo de aprovação)');
  perform tst.denied('delete from public.businesses', 'apagar loja');
  perform tst.login(at1);
  perform tst.ok(tst.affected('update public.businesses set name = ''Atendente'' where id = ' || quote_literal(biz1)) = 0, 'atendente não edita loja (sem settings.manage)');
  perform tst.login(mg1);
  perform tst.ok(tst.affected('update public.businesses set name = ''Gerente'' where id = ' || quote_literal(biz1)) = 0, 'gerente não edita configurações (sem settings.manage)');

  -- 8. equipe por cargo
  perform tst.login(at1);
  perform tst.denied('insert into public.business_members values (' || quote_literal(biz1) || ',' || quote_literal(b) || ',''kitchen'')', 'atendente adiciona membro', array['42501']);
  perform tst.login(mg1);
  perform tst.denied('insert into public.business_members values (' || quote_literal(biz1) || ',' || quote_literal(b) || ',''kitchen'')', 'gerente adiciona membro (sem staff.manage)');
  perform tst.login(o1);
  perform tst.denied('insert into public.business_members values (' || quote_literal(biz1) || ',' || quote_literal(b) || ',''owner'')', 'dono cria outro owner');
  perform tst.denied('insert into public.business_members values (' || quote_literal(biz2) || ',' || quote_literal(b) || ',''kitchen'')', 'dono insere em loja alheia');
  perform tst.ok(tst.affected('insert into public.business_members values (' || quote_literal(biz1) || ',' || quote_literal(b) || ',''kitchen'')') = 1, 'dono adiciona cozinha');
  perform tst.denied('update public.business_members set member_role = ''owner''', 'promover membro por update');
  perform tst.ok(tst.affected('delete from public.business_members where business_id = ' || quote_literal(biz2)) = 0, 'dono 1 não remove equipe da loja 2');
  perform tst.ok(tst.affected('delete from public.business_members where business_id = ' || quote_literal(biz1) || ' and member_role = ''owner''') = 0, 'ninguém remove o owner');
  perform tst.ok(tst.affected('delete from public.business_members where business_id = ' || quote_literal(biz1) || ' and user_id = ' || quote_literal(b)) = 1, 'dono remove cozinha');
  perform tst.login(a);
  perform tst.denied('insert into public.business_members values (' || quote_literal(biz1) || ',' || quote_literal(a) || ',''manager'')', 'cliente se adiciona como gerente');

  -- 9. permissões efetivas (função usada por RLS)
  perform tst.login(at1);
  perform tst.ok(public.has_business_permission(biz1::uuid, 'orders.update_status'), 'atendente atualiza pedidos');
  perform tst.ok(not public.has_business_permission(biz1::uuid, 'staff.manage'), 'atendente não gerencia equipe');
  perform tst.ok(not public.has_business_permission(biz2::uuid, 'orders.view'), 'atendente sem acesso à loja 2');

  -- 10. master: concessão/revogação auditadas
  perform tst.login(m1);
  perform tst.ok(tst.count('select 1 from public.profiles') >= 8, 'master lê perfis');
  perform public.grant_role(m2, 'platform_master');
  perform public.grant_role(a, 'platform_operator');
  perform tst.ok(tst.count($q$select 1 from public.audit_logs where action = 'grant_role'$q$) = 2, 'concessões auditadas');
  perform tst.ok(tst.count($q$select 1 from public.user_roles where role = 'platform_operator'$q$) = 1, 'master vê papéis de terceiros');
  perform tst.denied($q$select public.revoke_role('00000000-0000-0000-0000-0000000000a1','customer')$q$, 'revogar customer', array['P0001']);
  perform public.revoke_role(a, 'platform_operator');
  perform tst.ok(tst.count($q$select 1 from public.audit_logs where action = 'revoke_role'$q$) = 1, 'revogação auditada');
  perform public.revoke_role(m2, 'platform_master');
  perform tst.denied($q$select public.revoke_role('00000000-0000-0000-0000-0000000000e1','platform_master')$q$, 'revogar o último master', array['P0001']);
  perform tst.denied($q$update public.audit_logs set action = 'x'$q$, 'master altera auditoria');
  perform tst.denied($q$delete from public.audit_logs$q$, 'master apaga auditoria');

  -- 11. operador só lê perfis com a permissão users.view (0005) e não concede papéis
  perform tst.su();
  insert into public.user_roles(user_id, role) values (b, 'platform_operator');
  perform tst.login(b);
  perform tst.ok(tst.count('select 1 from public.profiles') = 1, 'operador sem permissão lê só o próprio perfil');
  perform tst.su();
  insert into public.platform_staff_permissions(user_id, permission) values (b, 'users.view');
  perform tst.login(b);
  perform tst.ok(tst.count('select 1 from public.profiles') >= 8, 'operador com users.view lê perfis');
  perform tst.denied($q$select public.grant_role('00000000-0000-0000-0000-0000000000b1','platform_master')$q$, 'operador concede master');
  perform tst.ok(tst.count('select 1 from public.audit_logs') = 0, 'operador não lê auditoria');

  perform tst.su();
  raise notice 'RLS_FOUNDATION_OK';
end $$;

rollback;
