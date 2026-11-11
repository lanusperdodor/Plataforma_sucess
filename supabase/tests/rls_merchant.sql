-- Testes da 0007 (painel do estabelecimento). Tudo é revertido. Sucesso: NOTICE 'RLS_MERCHANT_OK'.
begin;

create schema tstm;
grant usage on schema tstm to public;
create function tstm.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
create function tstm.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tstm.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstm.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstm.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tstm.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tstm.affected(stmt text) returns int language plpgsql as $$
declare n int; begin execute stmt; get diagnostics n = row_count; return n; end $$;

-- A: dono do ativo; M: gerente do ativo; T: atendente do ativo; B: dono de outro negócio; P: dono de pendente
insert into auth.users(id, email) values
  ('66660000-0000-0000-0000-0000000000a1', 'm-dono-a@teste.invalid'),
  ('66660000-0000-0000-0000-0000000000a2', 'm-gerente-a@teste.invalid'),
  ('66660000-0000-0000-0000-0000000000a3', 'm-atendente-a@teste.invalid'),
  ('66660000-0000-0000-0000-0000000000b1', 'm-dono-b@teste.invalid'),
  ('66660000-0000-0000-0000-0000000000c1', 'm-dono-pendente@teste.invalid');
insert into public.cities(id, name, state, slug) values ('66669000-0000-0000-0000-000000000001', 'Cidade M', 'TM', 'tstm-cidade');
insert into public.businesses(id, name, slug, owner_id, status, city_id) values
  ('66661000-0000-0000-0000-00000000000a', 'Lanchonete A', 'tstm-a', '66660000-0000-0000-0000-0000000000a1', 'active', '66669000-0000-0000-0000-000000000001'),
  ('66661000-0000-0000-0000-00000000000b', 'Pizzaria B', 'tstm-b', '66660000-0000-0000-0000-0000000000b1', 'active', '66669000-0000-0000-0000-000000000001'),
  ('66661000-0000-0000-0000-00000000000c', 'Açaí Pendente', 'tstm-c', '66660000-0000-0000-0000-0000000000c1', 'pending', '66669000-0000-0000-0000-000000000001');
insert into public.business_members(business_id, user_id, member_role) values
  ('66661000-0000-0000-0000-00000000000a', '66660000-0000-0000-0000-0000000000a1', 'owner'),
  ('66661000-0000-0000-0000-00000000000a', '66660000-0000-0000-0000-0000000000a2', 'manager'),
  ('66661000-0000-0000-0000-00000000000a', '66660000-0000-0000-0000-0000000000a3', 'attendant'),
  ('66661000-0000-0000-0000-00000000000b', '66660000-0000-0000-0000-0000000000b1', 'owner'),
  ('66661000-0000-0000-0000-00000000000c', '66660000-0000-0000-0000-0000000000c1', 'owner');
insert into public.menu_categories(id, business_id, name) values
  ('66662000-0000-0000-0000-00000000000b', '66661000-0000-0000-0000-00000000000b', 'Pizzas de B');

do $$
declare
  a constant uuid := '66661000-0000-0000-0000-00000000000a';
  bb constant uuid := '66661000-0000-0000-0000-00000000000b';
  pend constant uuid := '66661000-0000-0000-0000-00000000000c';
  cat_a uuid; cat_p uuid; prod uuid; cat_pizza uuid; cat_roupa uuid;
begin
  select id into cat_pizza from public.categories where slug = 'pizzas';
  select id into cat_roupa from public.categories where slug = 'roupas';

  -- 1. loja: dono edita dados permitidos; nunca status, slug, nota, destaque ou avaliação
  perform tstm.login('66660000-0000-0000-0000-0000000000a1');
  perform tstm.ok(tstm.affected(format($q$update public.businesses set description = 'Lanches na chapa', phone = '(35) 3000-0000',
                   delivery_offer = 'own', own_delivery_fee_cents = 500, accepts_pickup = true, category_id = %L where id = %L$q$, cat_pizza, a)) = 1,
                  'dono atualiza dados da loja');
  perform tstm.denied(format($q$update public.businesses set status = 'suspended' where id = %L$q$, a), 'dono muda status');
  perform tstm.denied(format($q$update public.businesses set slug = 'outro' where id = %L$q$, a), 'dono muda slug');
  perform tstm.denied(format($q$update public.businesses set is_featured = true where id = %L$q$, a), 'dono se destaca');
  perform tstm.denied(format($q$update public.businesses set rating_avg = 5, rating_count = 999 where id = %L$q$, a), 'dono inventa avaliação');
  perform tstm.denied(format($q$update public.businesses set popularity_score = 999 where id = %L$q$, a), 'dono inventa popularidade');
  perform tstm.denied(format($q$update public.businesses set category_id = %L where id = %L$q$, cat_roupa, a), 'categoria de outro tipo', array['P0001']);
  perform tstm.denied(format($q$update public.businesses set logo_url = 'javascript:alert(1)' where id = %L$q$, a), 'logo javascript:', array['23514']);
  perform tstm.ok(tstm.affected(format($q$update public.businesses set description = 'invasão' where id = %L$q$, bb)) = 0, 'dono A altera negócio B');

  -- gerente edita a loja; atendente não
  perform tstm.login('66660000-0000-0000-0000-0000000000a2');
  perform tstm.ok(tstm.affected(format($q$update public.businesses set whatsapp = '35999990000' where id = %L$q$, a)) = 1, 'gerente edita loja');
  perform tstm.login('66660000-0000-0000-0000-0000000000a3');
  perform tstm.ok(tstm.affected(format($q$update public.businesses set description = 'x' where id = %L$q$, a)) = 0, 'atendente edita loja');

  -- 2. horários
  perform tstm.login('66660000-0000-0000-0000-0000000000a1');
  execute format($q$insert into public.business_hours(business_id, weekday, opens, closes) values (%L, 1, '18:00', '23:30'), (%L, 5, '18:00', '02:00')$q$, a, a);
  perform tstm.ok(tstm.count(format($q$select 1 from public.business_hours where business_id = %L$q$, a)) = 2, 'dono cadastra horários');
  perform tstm.denied(format($q$insert into public.business_hours(business_id, weekday, opens, closes) values (%L, 1, '10:00', '11:00')$q$, bb), 'dono A cria horário em B');
  perform tstm.login('66660000-0000-0000-0000-0000000000a3');
  perform tstm.denied(format($q$insert into public.business_hours(business_id, weekday, opens, closes) values (%L, 2, '10:00', '11:00')$q$, a), 'atendente cria horário');

  -- 3. cardápio
  perform tstm.login('66660000-0000-0000-0000-0000000000a2');
  execute format($q$insert into public.menu_categories(business_id, name) values (%L, 'Lanches') returning id$q$, a) into cat_a;
  execute format($q$insert into public.products(business_id, category_id, name, price_cents) values (%L, %L, 'X-Burger', 2400) returning id$q$, a, cat_a) into prod;
  perform tstm.ok(prod is not null, 'gerente cadastra produto');
  perform tstm.ok(tstm.affected(format($q$update public.products set price_cents = 2600, is_available = false where id = %L$q$, prod)) = 1, 'gerente altera preço e disponibilidade');
  perform tstm.denied(format($q$update public.products set is_popular = true where id = %L$q$, prod), 'comerciante marca "mais pedido" sem dados');
  perform tstm.denied(format($q$update public.products set business_id = %L where id = %L$q$, bb, prod), 'mover produto para outro negócio');
  perform tstm.denied(format($q$insert into public.products(business_id, category_id, name, price_cents, is_demo) values (%L, %L, 'Fake', 1, true)$q$, a, cat_a), 'comerciante grava is_demo');
  perform tstm.denied(format($q$insert into public.products(business_id, category_id, name, price_cents) values (%L, %L, 'Invasão', 100)$q$, bb, '66662000-0000-0000-0000-00000000000b'), 'produto no negócio B');
  perform tstm.denied(format($q$insert into public.products(business_id, category_id, name, price_cents) values (%L, %L, 'Cruzado', 100)$q$, a, '66662000-0000-0000-0000-00000000000b'), 'categoria de outro negócio', array['23503']);
  perform tstm.denied(format($q$insert into public.products(business_id, category_id, name, price_cents) values (%L, %L, 'Negativo', -1)$q$, a, cat_a), 'preço negativo', array['23514']);
  perform tstm.denied(format($q$update public.products set image_url = 'http://x.example/a.png' where id = %L$q$, prod), 'imagem http', array['23514']);
  perform tstm.login('66660000-0000-0000-0000-0000000000a3');
  perform tstm.ok(tstm.affected(format($q$update public.products set price_cents = 1 where id = %L$q$, prod)) = 0, 'atendente altera preço');
  perform tstm.login('66660000-0000-0000-0000-0000000000b1');
  perform tstm.ok(tstm.affected(format($q$update public.products set price_cents = 1 where id = %L$q$, prod)) = 0, 'outro negócio altera preço');
  perform tstm.ok(tstm.affected(format($q$delete from public.products where id = %L$q$, prod)) = 0, 'outro negócio apaga produto');
  perform tstm.su();
  perform tstm.ok(tstm.count(format($q$select 1 from public.audit_logs where entity_id = %L and action = 'product.price'$q$, prod)) = 1, 'mudança de preço auditada');

  -- 4. negócio pendente prepara o cardápio, invisível ao público até a aprovação
  perform tstm.login('66660000-0000-0000-0000-0000000000c1');
  execute format($q$insert into public.menu_categories(business_id, name) values (%L, 'Copos') returning id$q$, pend) into cat_p;
  execute format($q$insert into public.products(business_id, category_id, name, price_cents) values (%L, %L, 'Açaí 500 ml', 1800)$q$, pend, cat_p);
  perform tstm.ok(tstm.count(format($q$select 1 from public.products where business_id = %L$q$, pend)) = 1, 'dono pendente vê o próprio cardápio');
  perform tstm.anon();
  perform tstm.ok(tstm.count(format($q$select 1 from public.products where business_id = %L$q$, pend)) = 0, 'anon vê cardápio de pendente');
  perform tstm.ok(tstm.count(format($q$select 1 from public.products where business_id = %L$q$, a)) = 1, 'anon vê cardápio do ativo');
  perform tstm.denied(format($q$insert into public.menu_categories(business_id, name) values (%L, 'x')$q$, a), 'anon escreve cardápio');

  perform tstm.su();
  raise notice 'RLS_MERCHANT_OK';
end $$;

rollback;
