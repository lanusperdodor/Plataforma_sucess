-- 0015_test_data: gerador de DADOS DE TESTE para o Master validar o sistema numa cidade.
--  * Só platform_master (com MFA quando exigido) cria ou remove.
--  * Cria, na cidade escolhida: 2 estabelecimentos ativos marcados "[Teste]" com horários,
--    cardápio e modalidades de entrega (um com entregador parceiro, outro com entrega própria),
--    1 vaga, 1 entregador aprovado e 5 logins (2 lojistas, 1 entregador, 2 clientes).
--  * A senha dos logins é gerada no servidor e devolvida UMA vez (não é guardada em texto).
--  * Tudo fica registrado em private.test_data_runs e pode ser removido por completo.
--  * E-mails em example.com (domínio reservado, RFC 2606): nenhum e-mail real é usado.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.test_data', 10, 3600);

create table private.test_data_runs (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references public.cities(id) on delete set null,
  created_by uuid,
  user_ids uuid[] not null default '{}',
  business_ids uuid[] not null default '{}',
  logins jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
revoke all on private.test_data_runs from public, anon, authenticated;

-- conta confirmada no Supabase Auth (mesmo formato do painel "Add user" com Auto Confirm)
create or replace function private.create_auth_user(_email text, _password text, _full_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                         raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
                         email_change, email_change_token_new, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', lower(_email),
          extensions.crypt(_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', _full_name),
          '', '', '', '', now(), now());
  insert into auth.identities(id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', lower(_email), 'email_verified', true),
          'email', uid::text, now(), now(), now());
  return uid;
end $$;
revoke all on function private.create_auth_user(text, text, text) from public, anon, authenticated;

create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cities%rowtype;
  sfx text := substr(md5(gen_random_uuid()::text), 1, 6);
  pwd text := 'Teste-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)) || '!';
  u_l1 uuid; u_l2 uuid; u_ent uuid; u_c1 uuid; u_c2 uuid;
  b1 uuid; b2 uuid; cat uuid; mc uuid; p uuid; g uuid;
  logins jsonb;
  run uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  select * into c from public.cities where id = _city and is_active;
  if not found then raise exception 'Cidade não encontrada ou inativa.' using errcode = 'P0001'; end if;

  u_l1 := private.create_auth_user('lojista1-' || sfx || '@teste.example.com', pwd, 'Lojista Teste 1');
  u_l2 := private.create_auth_user('lojista2-' || sfx || '@teste.example.com', pwd, 'Lojista Teste 2');
  u_ent := private.create_auth_user('entregador-' || sfx || '@teste.example.com', pwd, 'Entregador Teste');
  u_c1 := private.create_auth_user('cliente1-' || sfx || '@teste.example.com', pwd, 'Cliente Teste 1');
  u_c2 := private.create_auth_user('cliente2-' || sfx || '@teste.example.com', pwd, 'Cliente Teste 2');
  update public.profiles set phone = '(35) 99999-0000' where id in (u_c1, u_c2, u_l1, u_l2, u_ent);

  -- estabelecimento 1: restaurante com entregador parceiro e retirada
  select id into cat from public.categories where kind = 'restaurante' and not is_demo order by sort_order limit 1;
  insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                delivery_offer, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
  values ('[Teste] Lanchonete do Tuca', private.unique_business_slug('teste lanchonete ' || sfx), u_l1, 'active', 'restaurante', cat, c.id,
          'Estabelecimento de TESTE criado pelo Painel Master para validar pedidos com entregador parceiro.',
          'Rua de Teste, 100 - Centro', '(35) 99999-0001', '(35) 99999-0001', 'partner', true, 1000, 30, 45)
  returning id into b1;
  insert into public.business_members(business_id, user_id, member_role) values (b1, u_l1, 'owner') on conflict do nothing;

  insert into public.menu_categories(business_id, name, sort_order) values (b1, 'Lanches', 10) returning id into mc;
  insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
  values (b1, mc, 'X-Burger', 'Pão, hambúrguer, queijo e molho da casa.', 2500, 10) returning id into p;
  insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
  values (b1, p, 'Ponto da carne', 1, 1, 10) returning id into g;
  insert into public.options(business_id, group_id, name, sort_order) values (b1, g, 'Ao ponto', 10), (b1, g, 'Bem passado', 20);
  insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
  values (b1, p, 'Adicionais', 0, 2, 20) returning id into g;
  insert into public.options(business_id, group_id, name, price_delta_cents, sort_order) values (b1, g, 'Bacon', 500, 10), (b1, g, 'Ovo', 300, 20);
  insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
  values (b1, mc, 'X-Salada', 'Hambúrguer, queijo, alface e tomate.', 2800, 20);
  insert into public.menu_categories(business_id, name, sort_order) values (b1, 'Bebidas', 20) returning id into mc;
  insert into public.products(business_id, category_id, name, price_cents, sort_order)
  values (b1, mc, 'Refrigerante lata', 600, 10), (b1, mc, 'Suco natural 500 ml', 900, 20);

  -- estabelecimento 2: loja com entrega própria e retirada
  select id into cat from public.categories where kind = 'loja' and not is_demo order by sort_order limit 1;
  insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                delivery_offer, own_delivery_fee_cents, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
  values ('[Teste] Mercadinho Teste', private.unique_business_slug('teste mercadinho ' || sfx), u_l2, 'active', 'loja', cat, c.id,
          'Estabelecimento de TESTE criado pelo Painel Master para validar pedidos com entrega própria.',
          'Avenida de Teste, 200 - Centro', '(35) 99999-0002', '(35) 99999-0002', 'own', 500, true, 0, 40, 60)
  returning id into b2;
  insert into public.business_members(business_id, user_id, member_role) values (b2, u_l2, 'owner') on conflict do nothing;
  insert into public.menu_categories(business_id, name, sort_order) values (b2, 'Mercearia', 10) returning id into mc;
  insert into public.products(business_id, category_id, name, price_cents, sort_order)
  values (b2, mc, 'Arroz 5 kg', 2990, 10), (b2, mc, 'Feijão 1 kg', 899, 20), (b2, mc, 'Café 500 g', 1690, 30);
  insert into public.menu_categories(business_id, name, sort_order) values (b2, 'Hortifrúti', 20) returning id into mc;
  insert into public.products(business_id, category_id, name, price_cents, sort_order) values (b2, mc, 'Banana (dúzia)', 700, 10);

  -- abertos todos os dias, o dia inteiro, para testar a qualquer hora
  insert into public.business_hours(business_id, weekday, opens, closes)
  select b, d, '00:00', '24:00' from unnest(array[b1, b2]) b, generate_series(0, 6) d;

  -- entregador aprovado na cidade
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category, status,
                              terms_version, terms_accepted_at, reviewed_by, reviewed_at, review_note)
  values (u_ent, 'Entregador Teste', '(35) 99999-0003', c.id, 'moto', 'TST1A23', 'A', 'approved',
          'teste', now(), auth.uid(), now(), 'Cadastro de teste gerado pelo Painel Master.');
  insert into public.user_roles(user_id, role, granted_by) values (u_ent, 'courier_partner', auth.uid()) on conflict do nothing;

  -- vaga
  insert into public.jobs(business_id, city_id, title, area, description, employment_type, created_by)
  values (b1, c.id, '[Teste] Atendente', 'atendimento', 'Vaga de TESTE para validar candidaturas: atendimento ao público no balcão.', 'clt', u_l1);

  logins := jsonb_build_array(
    jsonb_build_object('role', 'lojista', 'label', 'Lojista — [Teste] Lanchonete do Tuca (entregador parceiro)', 'email', 'lojista1-' || sfx || '@teste.example.com'),
    jsonb_build_object('role', 'lojista', 'label', 'Lojista — [Teste] Mercadinho Teste (entrega própria)', 'email', 'lojista2-' || sfx || '@teste.example.com'),
    jsonb_build_object('role', 'entregador', 'label', 'Entregador aprovado', 'email', 'entregador-' || sfx || '@teste.example.com'),
    jsonb_build_object('role', 'cliente', 'label', 'Cliente 1', 'email', 'cliente1-' || sfx || '@teste.example.com'),
    jsonb_build_object('role', 'cliente', 'label', 'Cliente 2', 'email', 'cliente2-' || sfx || '@teste.example.com'));

  insert into private.test_data_runs(city_id, created_by, user_ids, business_ids, logins)
  values (c.id, auth.uid(), array[u_l1, u_l2, u_ent, u_c1, u_c2], array[b1, b2], logins)
  returning id into run;
  perform private.audit('test_data.create', 'test_data_runs', run::text, jsonb_build_object('city', c.id));
  return jsonb_build_object('run_id', run, 'city', c.name || ' - ' || c.state, 'password', pwd, 'logins', logins);
end $$;

create or replace function public.admin_list_test_data()
returns table (run_id uuid, city_name text, created_at timestamptz, logins jsonb, businesses bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_master();
  return query
    select r.id, c.name || ' - ' || c.state, r.created_at, r.logins,
           (select count(*) from public.businesses b where b.id = any(r.business_ids))
      from private.test_data_runs r left join public.cities c on c.id = r.city_id
     where r.removed_at is null
     order by r.created_at desc;
end $$;

create or replace function public.admin_remove_test_data(_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r private.test_data_runs%rowtype; u uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  select * into r from private.test_data_runs where id = _run and removed_at is null for update;
  if not found then raise exception 'Lote de teste não encontrado.' using errcode = 'P0001'; end if;
  perform set_config('tucai.internal', 'on', true);
  delete from public.orders where business_id = any(r.business_ids) or customer_id = any(r.user_ids);
  delete from public.businesses where id = any(r.business_ids);
  delete from public.couriers where user_id = any(r.user_ids);
  foreach u in array r.user_ids loop
    begin
      delete from auth.users where id = u;
    exception when foreign_key_violation then
      -- conta citada em registros que devem ser preservados (ex.: auditoria): bloqueia e anonimiza
      perform private.anonymize_user(u);
      update auth.users set banned_until = 'infinity', email = 'removido-' || u::text || '@teste.example.com' where id = u;
    end;
  end loop;
  update private.test_data_runs set removed_at = now() where id = r.id;
  perform private.audit('test_data.remove', 'test_data_runs', r.id::text, '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_create_test_data(uuid)', 'public.admin_list_test_data()', 'public.admin_remove_test_data(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
