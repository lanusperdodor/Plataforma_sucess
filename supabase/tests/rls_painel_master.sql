-- Testes da 0023 (Painel Master). Tudo é revertido. Sucesso: NOTICE 'RLS_PAINEL_MASTER_OK'.
begin;
create schema tspm;
grant usage on schema tspm to public;
create function tspm.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tspm.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tspm.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tspm.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tspm.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tspm.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
grant execute on all functions in schema tspm to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '33339000-0000-0000-0000-000000000001';
  m uuid; m2 uuid; sup uuid; cli uuid; op uuid; res jsonb; tcli uuid; tk uuid; n int; b uuid; inv uuid; nu uuid; r record;
begin
  insert into public.cities(id, name, state, slug) values (city, 'São Sebastião do Paraíso Teste', 'MG', 'tspm-ssp');
  m := private.create_auth_user('pm-master@teste.invalid', 'senha-master-1', 'Master PM');
  sup := private.create_auth_user('pm-suporte@teste.invalid', 'senha-sup-1', 'Suporte PM');
  op := private.create_auth_user('pm-op@teste.invalid', 'senha-op-1', 'Operador PM');
  cli := private.create_auth_user('pm-cliente@teste.invalid', 'senha-cli-1', 'Cliente Real PM');
  insert into public.user_roles(user_id, role) values (m, 'platform_master'), (sup, 'platform_operator'), (op, 'platform_operator');
  insert into public.platform_staff_permissions(user_id, permission) values (sup, 'support.manage'), (sup, 'users.view'), (op, 'audit.view'), (op, 'couriers.review'), (op, 'finance.view');

  -- lotes de teste com código no nome e entregadores aprovados visíveis
  perform tspm.login(m);
  res := public.admin_create_test_data(city);
  perform tspm.su();
  perform tspm.ok((select count(*) from public.businesses where is_test and name like '[Teste]% · lote %') = 2, 'estabelecimentos de teste com código do lote');
  select id into tcli from auth.users where email like 'cliente1-%@teste.example.com';
  select id into tk from auth.users where email like 'entregador-%@teste.example.com';

  -- entregadores: aprovados aparecem em "todos" (antes a tela abria só com pendentes)
  perform tspm.login(op);
  perform tspm.ok(tspm.count($q$select 1 from public.admin_couriers_page('todos') where status = 'approved' and is_test$q$) = 1, 'entregador independente de teste aparece (o próprio não entra na rede)');
  perform tspm.ok(tspm.count($q$select 1 from public.admin_couriers_page('pending')$q$) = 0, 'filtro pendentes não traz aprovados');
  perform tspm.ok(tspm.count($q$select 1 from public.admin_couriers_page('todos', 'independente')$q$) = 1, 'busca por nome');
  perform tspm.ok(tspm.count(format('select 1 from public.admin_courier_history(%L)', tk)) = 0, 'histórico sem entregas');
  perform tspm.login(cli);
  perform tspm.denied($q$select * from public.admin_couriers_page()$q$, 'cliente lista entregadores');

  -- estabelecimentos em cards
  perform tspm.login(m);
  perform tspm.ok(tspm.count(format($q$select 1 from public.admin_businesses_page(null, null, %L)$q$, city)) = 2, 'filtro por cidade');
  perform tspm.ok(tspm.count(format($q$select 1 from public.admin_businesses_page(null, 'supermercado', %L, null, 'loja')$q$, city)) = 1, 'busca + tipo');
  perform tspm.login(op);
  perform tspm.denied($q$select * from public.admin_businesses_page()$q$, 'operador sem businesses.review');

  -- auditoria: 20 por página, mais recente primeiro, com total
  perform tspm.su();
  insert into public.audit_logs(actor_id, action, entity, entity_id, details, created_at)
  select m, 'teste.paginacao', 'x', g::text, '{}', now() - make_interval(secs => g) from generate_series(1, 45) g;
  perform tspm.login(op);
  perform tspm.ok(tspm.count($q$select 1 from public.admin_audit_page(1, 'teste.paginacao')$q$) = 20, 'página 1 com 20');
  perform tspm.ok(tspm.count($q$select 1 from public.admin_audit_page(3, 'teste.paginacao')$q$) = 5, 'última página com o resto');
  perform tspm.ok((select total from public.admin_audit_page(2, 'teste.paginacao') limit 1) = 45, 'total');
  perform tspm.ok((select entity_id from public.admin_audit_page(2, 'teste.paginacao') limit 1) = '21', 'página 2 começa no 21º mais recente');
  perform tspm.ok(tspm.count($q$select 1 from public.admin_audit_page(1, null, 'pm-master')$q$) = 20, 'filtro por usuário');
  perform tspm.ok(tspm.count($q$select 1 from public.admin_audit_page(1, 'teste.paginacao', null, current_date + 1)$q$) = 0, 'filtro por data');
  perform tspm.ok('teste.paginacao' in (select public.admin_audit_actions()), 'lista de ações');
  perform tspm.login(cli);
  perform tspm.denied($q$select * from public.admin_audit_page()$q$, 'cliente lê auditoria');

  -- senha: recuperação por e-mail e senha temporária com regras
  perform tspm.login(sup);
  perform tspm.ok(public.admin_password_recovery(cli) = 'pm-cliente@teste.invalid', 'recuperação devolve o e-mail para o Supabase Auth enviar o link');
  perform tspm.denied(format('select public.admin_set_account_password(%L, %L)', cli, 'Temporaria123'), 'suporte define senha de conta real');
  perform public.admin_set_account_password(tcli, 'Temporaria123');
  perform tspm.login(m);
  perform tspm.denied(format('select public.admin_set_account_password(%L, %L)', cli, 'Temporaria123'), 'Master sem MFA define senha de conta real');
  perform tspm.login(m, 'aal2');
  perform public.admin_set_account_password(cli, 'Temporaria123');
  perform tspm.ok((public.admin_account_detail(cli)->>'must_change_password')::boolean, 'troca obrigatória marcada');
  perform tspm.login(cli);
  perform tspm.ok(public.must_change_password(), 'a própria conta sabe que precisa trocar');
  perform tspm.su();
  update auth.users set encrypted_password = extensions.crypt('MinhaNova123', extensions.gen_salt('bf')) where id = cli; -- como o Supabase Auth faz
  perform tspm.login(cli);
  perform tspm.ok(not public.must_change_password(), 'trocou a senha: obrigação removida');
  perform tspm.su();
  perform tspm.ok(not exists (select 1 from public.audit_logs where details::text like '%Temporaria123%'), 'senha fora da auditoria');
  perform tspm.ok(exists (select 1 from public.audit_logs where action = 'accounts.password_recovery_email' and entity_id = cli::text), 'recuperação auditada');
  perform tspm.login(m);
  res := public.admin_account_detail(tcli);
  perform tspm.ok((res->>'is_test')::boolean and jsonb_array_length(res->'audit') >= 1 and res->'roles' ? 'customer', 'detalhe da conta com papéis e auditoria');

  -- equipe: convites
  perform tspm.login(m);
  perform tspm.ok(public.admin_invite_staff('PM-Cliente@teste.invalid', 'platform_operator', array['finance.view']) = 'vinculado', 'conta existente é vinculada, sem duplicar');
  perform tspm.su();
  perform tspm.ok(exists (select 1 from public.user_roles where user_id = cli and role = 'platform_operator')
                  and exists (select 1 from public.platform_staff_permissions where user_id = cli and permission = 'finance.view'), 'papel e permissão aplicados');
  perform tspm.ok((select count(*) from auth.users where lower(email) = 'pm-cliente@teste.invalid') = 1, 'nenhuma conta duplicada');
  perform tspm.login(m);
  perform tspm.ok(public.admin_invite_staff('nova.pessoa@teste.invalid', 'platform_operator', array['orders.view', 'audit.view']) = 'convidado', 'e-mail novo fica convidado');
  perform tspm.denied($q$select public.admin_invite_staff('x@teste.invalid', 'platform_operator', array['nao.existe'])$q$, 'permissão desconhecida', array['P0001']);
  perform tspm.denied($q$select public.admin_invite_staff('y@teste.invalid', 'platform_master', '{}', 'CONCEDER MASTER')$q$, 'Master sem MFA convida Master');
  perform tspm.login(m, 'aal2');
  perform tspm.denied($q$select public.admin_invite_staff('y@teste.invalid', 'platform_master')$q$, 'Master sem confirmação reforçada', array['P0001']);
  perform tspm.ok(public.admin_invite_staff('y@teste.invalid', 'platform_master', '{}', 'CONCEDER MASTER') = 'convidado', 'Master com MFA e confirmação');
  perform tspm.login(sup);
  perform tspm.denied($q$select public.admin_invite_staff('z@teste.invalid', 'platform_operator')$q$, 'operador convida');
  -- a pessoa ativa pelo link: conta criada e e-mail confirmado aplicam o convite
  perform tspm.su();
  nu := private.create_auth_user('nova.pessoa@teste.invalid', 'senha-nova-1', 'Nova Pessoa');
  perform tspm.ok(exists (select 1 from public.user_roles where user_id = nu and role = 'platform_operator')
                  and (select count(*) from public.platform_staff_permissions where user_id = nu) = 2, 'convite aplicado ao ativar');
  perform tspm.login(m);
  perform tspm.ok((select status from public.admin_list_invites() where email = 'nova.pessoa@teste.invalid') = 'aceito', 'convite aceito');
  -- papéis
  perform tspm.denied(format($q$select public.grant_role(%L, 'courier_partner')$q$, cli), 'entregador concedido pela Equipe', array['P0001']);
  perform tspm.denied(format($q$select public.grant_role(%L, 'platform_master')$q$, cli), 'Master concedido sem MFA');
  perform tspm.denied(format($q$select public.revoke_role(%L, 'platform_master')$q$, m), 'remove o último Master', array['P0001']);

  -- financeiro e pagamentos
  perform tspm.login(op);
  res := public.admin_finance_report(current_date - 30, current_date);
  perform tspm.ok((res->'confirmado'->>'pedidos')::int = 0 and (res->'repassado'->>'registrado')::boolean = false, 'relatório sem inventar valores');
  perform tspm.ok(tspm.count($q$select 1 from public.admin_finance_transactions(current_date - 30, current_date)$q$) = 0, 'histórico vazio sem movimento');
  perform tspm.ok(tspm.count($q$select 1 from public.admin_payments_page()$q$) = 0, 'pagamentos sem cobranças');
  perform tspm.denied($q$select public.admin_finance_report(current_date, current_date - 1)$q$, 'período invertido', array['P0001']);
  perform tspm.login(cli);
  perform tspm.ok(public.admin_finance_report(current_date - 30, current_date) is not null, 'conta vinculada pelo convite já usa a permissão concedida');
end $$;

-- busca de cidades: sem acento, sem maiúsculas, por estado e com limite
do $$
begin
  perform tspm.anon();
  perform tspm.ok((select name from public.search_cities('sao sebastiao') limit 1) like 'São Sebastião do Paraíso%', 'sao sebastiao → São Sebastião do Paraíso');
  perform tspm.ok(exists (select 1 from public.search_cities('pass') where name = 'Passos'), 'pass → Passos');
  perform tspm.ok(exists (select 1 from public.search_cities('CASSIA') where name = 'Cássia'), 'cassia → Cássia');
  perform tspm.ok(not exists (select 1 from public.search_cities('cassia', 'SP') where state <> 'SP' or name = 'Cássia'), 'filtro por estado');
  perform tspm.ok((select count(*) from public.search_cities('a', null, 5)) <= 5, 'limite de resultados');
  perform tspm.ok(not exists (select 1 from public.search_cities('zzzzzz')), 'sem resultados');
end $$;

do $$ begin raise notice 'RLS_PAINEL_MASTER_OK'; end $$;
rollback;
