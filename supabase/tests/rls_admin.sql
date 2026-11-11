-- Testes de segurança da 0005 (Painel Master, permissões da equipe, MFA, solicitação e análise
-- de estabelecimentos, cidades, auditoria). Tudo é revertido no final.
-- Sucesso termina com NOTICE 'RLS_ADMIN_OK'; qualquer falha levanta exceção.
begin;

create schema tsta;
grant usage on schema tsta to public;

create function tsta.login(uid uuid, aal text default 'aal1') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  set role authenticated;
end $$;
create function tsta.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set role anon;
end $$;
create function tsta.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsta.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsta.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsta.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tsta.val(q text) returns text language plpgsql as $$
declare v text; begin execute q into v; return v; end $$;

-- ---------- fixtures ----------
-- M master; O operador sem permissões; R operador revisor (businesses.review + cities.manage);
-- C e D clientes; o gatilho cria perfil e papel customer.
insert into auth.users(id, email) values
  ('88880000-0000-0000-0000-0000000000a1', 'master@teste.invalid'),
  ('88880000-0000-0000-0000-0000000000a2', 'operador@teste.invalid'),
  ('88880000-0000-0000-0000-0000000000a3', 'revisor@teste.invalid'),
  ('88880000-0000-0000-0000-0000000000c1', 'cliente-c@teste.invalid'),
  ('88880000-0000-0000-0000-0000000000d1', 'cliente-d@teste.invalid');
insert into public.user_roles(user_id, role) values
  ('88880000-0000-0000-0000-0000000000a1', 'platform_master'),
  ('88880000-0000-0000-0000-0000000000a2', 'platform_operator'),
  ('88880000-0000-0000-0000-0000000000a3', 'platform_operator');
insert into public.platform_staff_permissions(user_id, permission) values
  ('88880000-0000-0000-0000-0000000000a3', 'businesses.review'),
  ('88880000-0000-0000-0000-0000000000a3', 'cities.manage');
-- 0006 liga o MFA obrigatório por padrão; estes testes começam com ele desligado e o
-- religam na seção 10 (o teste de padrão está em rls_security.sql).
update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
insert into public.cities(id, name, state, slug, is_active) values
  ('88889000-0000-0000-0000-000000000001', 'Cidade Tsta', 'TA', 'tsta-cidade', true),
  ('88889000-0000-0000-0000-000000000002', 'Cidade Tsta Off', 'TA', 'tsta-off', false);

do $$
declare
  m constant uuid := '88880000-0000-0000-0000-0000000000a1';
  o constant uuid := '88880000-0000-0000-0000-0000000000a2';
  r constant uuid := '88880000-0000-0000-0000-0000000000a3';
  c constant uuid := '88880000-0000-0000-0000-0000000000c1';
  d constant uuid := '88880000-0000-0000-0000-0000000000d1';
  city constant uuid := '88889000-0000-0000-0000-000000000001';
  cat_pizza uuid;
  cat_roupa uuid;
  b1 uuid; b2 uuid; b_r uuid;
  new_city uuid;
  st text;
  access jsonb;
begin
  select id into cat_pizza from public.categories where slug = 'pizzas';
  select id into cat_roupa from public.categories where slug = 'roupas';
  perform tsta.ok(cat_pizza is not null and cat_roupa is not null, 'taxonomia oficial cadastrada pela 0003');

  -- 1. anon não chama nada administrativo nem envia solicitação
  perform tsta.anon();
  perform tsta.denied('select public.admin_dashboard()', 'anon chama admin_dashboard');
  perform tsta.denied('select public.admin_my_access()', 'anon chama admin_my_access');
  perform tsta.denied(format($q$select public.submit_business_application('X Y', 'restaurante', %L)$q$, city), 'anon envia solicitação');
  perform tsta.denied('select * from public.platform_settings', 'anon lê platform_settings');

  -- 2. cliente envia solicitação: pendente, dono vinculado, slug sem acento, auditoria
  perform tsta.login(c);
  b1 := public.submit_business_application('Pizzaria São João', 'restaurante', city, cat_pizza, '(35) 99999-0000', 'Forno a lenha', 'Rua A, 10');
  perform tsta.su();
  perform tsta.ok((select status::text from public.businesses where id = b1) = 'pending', 'solicitação nasce pendente');
  perform tsta.ok((select slug from public.businesses where id = b1) = 'pizzaria-sao-joao', 'slug sem acento');
  perform tsta.ok((select owner_id from public.businesses where id = b1) = c, 'dono é quem enviou');
  perform tsta.ok(exists (select 1 from public.business_members where business_id = b1 and user_id = c and member_role = 'owner'), 'dono vinculado como owner');