-- Testes de segurança/RLS da migration 0002 (catálogo) e demais da spec experiencia-cliente.
-- Roda depois das migrations, do seed e de rls_foundation.sql; o banco NÃO está vazio:
-- todas as contagens filtram pelas fixtures próprias (UUIDs 7777...). Tudo é revertido no final.
-- Qualquer falha levanta exceção. Sucesso termina com NOTICE 'RLS_EXPERIENCIA_OK'.
begin;

-- schema de helpers com nome distinto de tst (rls_foundation.sql usa tst)
create schema tstx;
grant usage on schema tstx to public;

create function tstx.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
create function tstx.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set role anon;
end $$;
create function tstx.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstx.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
-- exige erro com um dos SQLSTATE informados
create function tstx.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tstx.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tstx.affected(stmt text) returns int language plpgsql as $$
declare n int; begin execute stmt; get diagnostics n = row_count; return n; end $$;
-- comércios das fixtures de visibilidade: ativo, pendente, suspenso
create function tstx.fx() returns uuid[] language sql immutable as $$
  select array['77771000-0000-0000-0000-000000000001','77771000-0000-0000-0000-000000000002',
               '77771000-0000-0000-0000-000000000003']::uuid[]
$$;

-- ---------- fixtures (como superusuário) ----------
insert into auth.users(id, email) values
  ('77770000-0000-0000-0000-0000000000a1', 'x-a@teste.invalid'),   -- cliente autor de avaliações
  ('77770000-0000-0000-0000-0000000000b1', 'x-b@teste.invalid'),   -- cliente sem vínculo
  ('77770000-0000-0000-0000-0000000000c1', 'x-dono-ativo@teste.invalid'),
  ('77770000-0000-0000-0000-0000000000c2', 'x-dono-pendente@teste.invalid'),
  ('77770000-0000-0000-0000-0000000000c3', 'x-dono-suspenso@teste.invalid');

insert into public.cities(id, name, state, slug, is_active) values
  ('77779000-0000-0000-0000-000000000001', 'Cidade Tstx Ativa', 'TX', 'tstx-ativa', true),
  ('77779000-0000-0000-0000-000000000002', 'Cidade Tstx Inativa', 'TX', 'tstx-inativa', false);

insert into public.businesses(id, name, slug, owner_id, status, city_id) values
  ('77771000-0000-0000-0000-000000000001', 'Tstx Ativo', 'tstx-ativo', '77770000-0000-0000-0000-0000000000c1', 'active', '77779000-0000-0000-0000-000000000001'),
  ('77771000-0000-0000-0000-000000000002', 'Tstx Pendente', 'tstx-pendente', '77770000-0000-0000-0000-0000000000c2', 'pending', '77779000-0000-0000-0000-000000000001'),
  ('77771000-0000-0000-0000-000000000003', 'Tstx Suspenso', 'tstx-suspenso', '77770000-0000-0000-0000-0000000000c3', 'suspended', '77779000-0000-0000-0000-000000000001');
insert into public.business_members(business_id, user_id, member_role) values
  ('77771000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-0000000000c1', 'owner'),
  ('77771000-0000-0000-0000-000000000002', '77770000-0000-0000-0000-0000000000c2', 'owner'),
  ('77771000-0000-0000-0000-000000000003', '77770000-0000-0000-0000-0000000000c3', 'owner');

insert into public.business_hours(business_id, weekday, opens, closes)
select id, 1, '09:00', '18:00' from public.businesses where id = any(tstx.fx());

insert into public.menu_categories(id, business_id, name, is_active) values
  ('77773000-0000-0000-0000-000000000001', '77771000-0000-0000-0000-000000000001', 'Lanches', true),
  ('77773000-0000-0000-0000-000000000002', '77771000-0000-0000-0000-000000000002', 'Lanches', true),
  ('77773000-0000-0000-0000-000000000003', '77771000-0000-0000-0000-000000000003', 'Lanches', true),
  ('77773000-0000-0000-0000-000000000004', '77771000-0000-0000-0000-000000000001', 'Oculta', false);
insert into public.products(id, business_id, category_id, name, price_cents) values
  ('77774000-0000-0000-0000-000000000001', '77771000-0000-0000-0000-000000000001', '77773000-0000-0000-0000-000000000001', 'Prato Ativo', 1000),
  ('77774000-0000-0000-0000-000000000002', '77771000-0000-0000-0000-000000000002', '77773000-0000-0000-0000-000000000002', 'Prato Pendente', 1000),
  ('77774000-0000-0000-0000-000000000003', '77771000-0000-0000-0000-000000000003', '77773000-0000-0000-0000-000000000003', 'Prato Suspenso', 1000);
insert into public.option_groups(id, business_id, product_id, name) values
  ('77775000-0000-0000-0000-000000000001', '77771000-0000-0000-0000-000000000001', '77774000-0000-0000-0000-000000000001', 'Molho'),
  ('77775000-0000-0000-0000-000000000002', '77771000-0000-0000-0000-000000000002', '77774000-0000-0000-0000-000000000002', 'Molho'),
  ('77775000-0000-0000-0000-000000000003', '77771000-0000-0000-0000-000000000003', '77774000-0000-0000-0000-000000000003', 'Molho');
insert into public.options(id, business_id, group_id, name) values
  ('77776000-0000-0000-0000-000000000001', '77771000-0000-0000-0000-000000000001', '77775000-0000-0000-0000-000000000001', 'Barbecue'),
  ('77776000-0000-0000-0000-000000000002', '77771000-0000-0000-0000-000000000002', '77775000-0000-0000-0000-000000000002', 'Barbecue'),
  ('77776000-0000-0000-0000-000000000003', '77771000-0000-0000-0000-000000000003', '77775000-0000-0000-0000-000000000003', 'Barbecue');
insert into public.services(id, business_id, name, status) values
  ('77777000-0000-0000-0000-000000000001', '77771000-0000-0000-0000-000000000001', 'Serviço Publicado Ativo', 'published'),
  ('77777000-0000-0000-0000-000000000002', '77771000-0000-0000-0000-000000000002', 'Serviço Publicado Pendente', 'published'),
  ('77777000-0000-0000-0000-000000000003', '77771000-0000-0000-0000-000000000003', 'Serviço Publicado Suspenso', 'published'),
  ('77777000-0000-0000-0000-000000000004', '77771000-0000-0000-0000-000000000001', 'Serviço Oculto Ativo', 'hidden');
insert into public.reviews(id, business_id, user_id, rating, comment, author_name) values
  ('77778000-0000-0000-0000-000000000001', '77771000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-0000000000a1', 5, 'ótimo', 'Cliente A'),
  ('77778000-0000-0000-0000-000000000002', '77771000-0000-0000-0000-000000000002', '77770000-0000-0000-0000-0000000000a1', 5, 'ótimo', 'Cliente A'),
  ('77778000-0000-0000-0000-000000000003', '77771000-0000-0000-0000-000000000003', '77770000-0000-0000-0000-0000000000a1', 5, 'ótimo', 'Cliente A');