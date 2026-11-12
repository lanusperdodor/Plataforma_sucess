-- Testes da 0034 (catálogo público sem Security Definer View). Tudo é revertido. Sucesso: NOTICE 'RLS_CATALOGO_OK'.
-- Tudo é revertido. Sucesso: NOTICE 'RLS_ENTREGA_CODIGO_OK'.
begin;
create schema tsct;
grant usage on schema tsct to public;
create function tsct.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tsct.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsct.blocked(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlerrm like '%em manutenção%' then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido bloqueado pela manutenção)', msg;
end $$;
create function tsct.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsct.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsct.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsct.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsct.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
create function tsct.step(msg text) returns void language plpgsql as $$ begin raise notice 'CHEESEBURGER: %', msg; end $$;
grant execute on all functions in schema tsct to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare
  city constant uuid := '14149000-0000-0000-0000-000000000001';
  dono uuid; outro uuid; cli uuid; op uuid; m uuid; ativo uuid; pendente uuid; teste uuid; r record;
begin
  insert into public.cities(id, name, state, slug) values (city, 'Cidade Catálogo', 'MG', 'tsct-cidade');
  dono := private.create_auth_user('ct-dono@teste.invalid', 'senha-dono-1', 'Dono Catálogo');
  outro := private.create_auth_user('ct-outro@teste.invalid', 'senha-outro-1', 'Outro Dono');
  cli := private.create_auth_user('ct-cliente@teste.invalid', 'senha-cli-1', 'Cliente Catálogo');
  op := private.create_auth_user('ct-op@teste.invalid', 'senha-op-1', 'Operador Catálogo');
  m := private.create_auth_user('ct-master@teste.invalid', 'senha-master-1', 'Master Catálogo');
  insert into public.user_roles(user_id, role) values (op, 'platform_operator'), (m, 'platform_master');
  insert into public.platform_staff_permissions(user_id, permission) values (op, 'businesses.review');
  insert into public.businesses(name, slug, owner_id, status, business_type, city_id, review_note) values
    ('Lanche Público', 'tsct-ativo', dono, 'active', 'restaurante', city, 'nota interna da análise') returning id into ativo;
  insert into public.businesses(name, slug, owner_id, status, business_type, city_id) values
    ('Loja Pendente', 'tsct-pendente', outro, 'pending', 'loja', city) returning id into pendente;
  insert into public.business_members(business_id, user_id, member_role) values (ativo, dono, 'owner'), (pendente, outro, 'owner') on conflict do nothing;
  perform set_config('tucai.internal', 'on', true);
  insert into public.businesses(name, slug, owner_id, status, business_type, city_id, is_test) values
    ('[Teste] Loja Teste', 'tsct-teste', outro, 'active', 'loja', city, true) returning id into teste;
  perform set_config('tucai.internal', 'off', true);

  -- equivalente ao Security Advisor: nenhuma visão pública roda com as permissões do dono
  perform tsct.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                               where n.nspname = 'public' and c.relkind = 'v'
                                 and not coalesce(c.reloptions @> array['security_invoker=true'], false)), 'nenhuma Security Definer View em public');
  perform tsct.ok((select relrowsecurity from pg_class where oid = 'public.business_catalog'::regclass), 'RLS ligada no catálogo');
  perform tsct.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('business_catalog', 'public_businesses')
                               and column_name in ('owner_id', 'review_note', 'reviewed_by', 'reviewed_at', 'submitted_at', 'updated_at')), 'colunas privadas fora do catálogo e da visão');
  perform tsct.ok(not has_table_privilege('anon', 'public.businesses', 'select'), 'visitante sem SELECT em businesses');
  perform tsct.ok(not has_table_privilege('anon', 'public.business_catalog', 'insert') and not has_table_privilege('authenticated', 'public.business_catalog', 'update'), 'catálogo só leitura pela API');

  -- visitante
  perform tsct.anon();
  perform tsct.ok(tsct.count(format('select 1 from public.public_businesses where city_id = %L', city)) = 1, 'visitante vê só o estabelecimento ativo e real');
  perform tsct.ok((select is_open is not null and name = 'Lanche Público' from public.public_businesses where id = ativo), 'consulta pública com is_open funcionando');
  perform tsct.ok(tsct.count(format('select 1 from public.business_catalog where city_id = %L', city)) = 1, 'catálogo direto respeita a RLS');
  perform tsct.denied('select owner_id from public.businesses', 'visitante lê businesses');
  perform tsct.denied('select owner_id from public.public_businesses', 'visitante pede owner_id na visão', array['42703']);
  perform tsct.denied(format($q$insert into public.business_catalog(id, name, slug, status, is_demo, is_test) values (gen_random_uuid(), 'x', 'x', 'active', false, false)$q$), 'visitante grava no catálogo');

  -- cliente logado
  perform tsct.login(cli);
  perform tsct.ok(tsct.count(format('select 1 from public.public_businesses where city_id = %L', city)) = 1, 'cliente vê a mesma listagem pública');
  perform tsct.ok(tsct.count(format('select 1 from public.businesses where city_id = %L', city)) = 0, 'cliente não lê businesses (owner_id, notas)');
  perform tsct.denied(format($q$update public.business_catalog set name = 'hack' where id = %L$q$, ativo), 'cliente altera o catálogo');

  -- empresário
  perform tsct.login(dono);
  perform tsct.ok((select review_note = 'nota interna da análise' and owner_id = dono from public.businesses where id = ativo), 'empresário lê o próprio estabelecimento completo');
  perform tsct.ok(tsct.count(format('select 1 from public.businesses where id = %L', pendente)) = 0, 'empresário não vê estabelecimento alheio');
  update public.businesses set name = 'Lanche Público Renomeado' where id = ativo;
  perform tsct.anon();
  perform tsct.ok((select name from public.public_businesses where id = ativo) = 'Lanche Público Renomeado', 'alteração do empresário aparece no catálogo');
  perform tsct.login(outro);
  perform tsct.ok(tsct.count(format('select 1 from public.businesses where id = %L and status = %L', pendente, 'pending')) = 1, 'empresário vê o próprio pendente');
  perform tsct.ok(tsct.count(format('select 1 from public.public_businesses where id = %L', pendente)) = 0, 'pendente fora da listagem pública');

  -- administrador
  perform tsct.login(op);
  perform tsct.ok(tsct.count(format('select 1 from public.businesses where city_id = %L', city)) = 3, 'equipe com businesses.review vê todos (inclui pendente e teste)');
  perform tsct.ok(tsct.count(format('select 1 from public.public_businesses where city_id = %L', city)) = 2, 'equipe vê o de teste na listagem (homologação)');
  perform tsct.login(m);
  perform tsct.ok(tsct.count(format('select 1 from public.public_businesses where city_id = %L', city)) = 2, 'Master vê o de teste na listagem');

  -- suspensão e exclusão refletem no catálogo
  perform tsct.su();
  update public.businesses set status = 'suspended' where id = ativo;
  perform tsct.anon();
  perform tsct.ok(tsct.count(format('select 1 from public.public_businesses where id = %L', ativo)) = 0, 'suspenso sai da listagem pública');
  perform tsct.su();
  delete from public.businesses where id = pendente;
  perform tsct.ok(not exists (select 1 from public.business_catalog where id = pendente), 'exclusão remove do catálogo');
  perform tsct.ok((select count(*) from public.business_catalog) = (select count(*) from public.businesses), 'catálogo sincronizado com businesses');
  raise notice 'RLS_CATALOGO_OK';
end $$;
rollback;
