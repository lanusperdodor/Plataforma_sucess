-- 0032_perfis_simplificados: quatro perfis operacionais (Empresário, Funcionário, Entregador, Cliente) + Master.
--  * Nada é removido do esquema: enums, colunas e papéis internos continuam (owner/manager/attendant/kitchen/courier_own).
--    A simplificação é de experiência e de contas de teste.
--  * Funcionário (attendant) acumula atendimento e cozinha: pedidos, comandas, preparo e status. Sem financeiro,
--    configurações críticas nem permissões — só com permissão explícita do empresário (0027).
--  * Entregador próprio (courier_own): recebe só as entregas que o próprio comércio atribuir a ele. Não vê os demais
--    pedidos da loja e não recebe ofertas da rede de entregadores independentes (que exige courier_partner + cadastro).
--  * Contas de teste: exatamente sete (Empresário 1 — Lanchonete, Empresário 2 — Supermercado, Funcionário — Lanchonete,
--    Entregador 1 — Independente, Entregador 2 — Próprio do supermercado, Cliente 1, Cliente 2). Lotes antigos não são
--    apagados nem reaproveitados: continuam até o Master removê-los.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('own_courier.update', 300, 600), ('merchant.own_courier', 300, 600)
on conflict (action) do nothing;

-- ---------- entregador próprio ----------
-- antes: courier_own via todos os pedidos da loja (orders.view). Agora só os atribuídos a ele (funções abaixo).
delete from public.role_permissions where member_role = 'courier_own' and permission = 'orders.view';

alter table public.orders add column if not exists own_courier_id uuid references auth.users(id) on delete set null;
create index if not exists orders_own_courier_idx on public.orders(own_courier_id);

create or replace function private.is_own_courier(_business uuid, _user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_members where business_id = _business and user_id = _user and member_role = 'courier_own')
$$;

-- visibilidade do pedido: + entregador próprio atribuído (enquanto continuar na equipe)
create or replace function public.can_view_order(_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = _order and (
    o.customer_id = auth.uid()
    or public.has_business_permission(o.business_id, 'orders.view')
    or public.has_platform_permission('orders.view')
    or exists (select 1 from public.deliveries d where d.order_id = o.id and d.courier_id = auth.uid())
    or (o.own_courier_id = auth.uid() and private.is_own_courier(o.business_id, auth.uid()))))
$$;

-- equipe atribui (ou retira) o entregador próprio de um pedido de entrega própria
create or replace function public.merchant_assign_own_courier(_order uuid, _courier uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = _order for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0001'; end if;
  if not public.has_business_permission(o.business_id, 'orders.update_status') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.own_courier');
  if o.fulfillment <> 'delivery_own' then raise exception 'Só pedidos com entrega própria do estabelecimento.' using errcode = 'P0001'; end if;
  if o.status not in ('accepted', 'preparing', 'ready') then raise exception 'Atribua o entregador antes da saída para entrega.' using errcode = 'P0001'; end if;
  if _courier is not null and not private.is_own_courier(o.business_id, _courier) then
    raise exception 'Escolha um entregador próprio da equipe.' using errcode = 'P0001';
  end if;
  update public.orders set own_courier_id = _courier where id = _order;
  insert into public.order_events(order_id, status, actor_id, note)
  values (_order, o.status, auth.uid(), case when _courier is null then 'Entregador próprio retirado' else 'Entregador próprio atribuído' end);
  if _courier is not null then
    perform private.notify_link(_courier, 'delivery_offer', o.customer_id, '/entregador/entregas', left('Nova entrega da loja: pedido #' || o.code || '.', 280));
  end if;
  perform private.audit('orders.own_courier', 'orders', _order::text, jsonb_build_object('courier', _courier));
end $$;

create or replace function public.merchant_own_couriers(_business uuid) returns table (user_id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'orders.update_status') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.user_id, coalesce(p.full_name, 'Entregador') from public.business_members m left join public.profiles p on p.id = m.user_id
     where m.business_id = _business and m.member_role = 'courier_own' order by 2;
end $$;

-- painel do entregador próprio: só os pedidos atribuídos a ele
create or replace function public.own_courier_deliveries(_active boolean default true)
returns table (order_id uuid, order_code text, order_status public.order_status, business_id uuid, business_name text, business_address text,
               business_phone text, customer_name text, customer_phone text, delivery_address text, delivery_reference text,
               payment_method public.order_payment, total_cents integer, change_for_cents integer, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.code, o.status, b.id, b.name, b.address_line, b.phone, o.customer_name, o.customer_phone, o.delivery_address, o.delivery_reference,
         o.payment_method, o.total_cents, o.change_for_cents, o.created_at, o.updated_at
    from public.orders o join public.businesses b on b.id = o.business_id
   where auth.uid() is not null and o.own_courier_id = auth.uid() and private.is_own_courier(o.business_id, auth.uid())
     and o.fulfillment = 'delivery_own'
     and (case when _active then o.status in ('accepted', 'preparing', 'ready', 'out_for_delivery') else o.status in ('delivered', 'cancelled', 'rejected') end)
   order by o.created_at desc
   limit 100
$$;

-- saída e conclusão pelo entregador próprio atribuído
create or replace function public.own_courier_set_status(_order uuid, _status public.order_status) returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.orders where id = _order for update;
  if not found or o.own_courier_id is distinct from auth.uid() or not private.is_own_courier(o.business_id, auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.limit_for('own_courier.update');
  if not ((o.status = 'ready' and _status = 'out_for_delivery') or (o.status = 'out_for_delivery' and _status = 'delivered')) then
    raise exception 'Mudança de status não permitida (% → %).', o.status, _status using errcode = 'P0001';
  end if;
  update public.orders set status = _status where id = o.id;
  insert into public.order_events(order_id, status, actor_id, note) values (o.id, _status, auth.uid(), 'Entregador próprio');
  perform private.notify_link(o.customer_id, 'order_update', null, '/pedidos/' || o.id,
    'Pedido #' || o.code || ': ' || case _status when 'out_for_delivery' then 'saiu para entrega.' else 'entregue. Bom apetite!' end);
  return _status;
end $$;

-- ---------- contas de teste: sete perfis operacionais ----------
create or replace function private.test_login_key(l jsonb) returns text language sql immutable as $$
  select coalesce(l->>'key', case
    when l->>'role' = 'lojista' and l->>'label' like '%Lanchonete%' then 'restaurante'
    when l->>'role' = 'lojista' then 'lojista'
    when l->>'role' = 'entregador' then 'entregador'
    when l->>'label' = 'Cliente 2' then 'cliente2'
    when l->>'role' = 'cliente' then 'cliente1' end)
$$;

create or replace function private.admin_create_test_data_impl(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.cities%rowtype;
  r private.test_data_runs%rowtype;
  reuse boolean := false;
  sfx text := substr(md5(gen_random_uuid()::text), 1, 6);
  pwd text := 'Teste-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)) || '!';
  have text[] := '{}';
  created jsonb := '[]'::jsonb;
  new_users uuid[] := '{}';
  new_biz uuid[] := '{}';
  b_lan uuid; b_sup uuid;
  u uuid; cat uuid; mc uuid; p uuid; g uuid; run uuid;
  k text; nome text;
  keys constant text[] := array['empresario1', 'empresario2', 'funcionario', 'entregador', 'entregador2', 'cliente1', 'cliente2'];
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  select * into c from public.cities where id = _city and is_active;
  if not found then raise exception 'Cidade não encontrada ou inativa.' using errcode = 'P0001'; end if;

  -- só reaproveita lote no formato novo (sete perfis); lote antigo fica como está até o Master remover
  select * into r from private.test_data_runs
   where city_id = c.id and removed_at is null and logins @> '[{"key":"empresario1"}]'::jsonb
   order by created_at desc limit 1 for update;
  if found then
    reuse := true;
    select coalesce(array_agg(l->>'key'), '{}') into have from jsonb_array_elements(r.logins) l;
    select id into b_lan from public.businesses where id = any(r.business_ids) and business_type = 'restaurante' order by created_at limit 1;
    select id into b_sup from public.businesses where id = any(r.business_ids) and business_type = 'loja' order by created_at limit 1;
  end if;

  foreach k in array keys loop
    continue when k = any(have);
    if k = 'funcionario' and b_lan is null then continue; end if;
    if k = 'entregador2' and b_sup is null then continue; end if;
    nome := case k
      when 'empresario1' then 'Empresário 1 — Lanchonete' when 'empresario2' then 'Empresário 2 — Supermercado'
      when 'funcionario' then 'Funcionário — Lanchonete' when 'entregador' then 'Entregador 1 — Independente'
      when 'entregador2' then 'Entregador 2 — Próprio do supermercado' when 'cliente1' then 'Cliente 1' else 'Cliente 2' end;
    u := private.create_auth_user(k || '-' || sfx || '@teste.example.com', pwd, nome);
    update public.profiles set phone = '(35) 99999-0000' where id = u;
    new_users := new_users || u;

    if k = 'empresario1' then
      select id into cat from public.categories where kind = 'restaurante' and not is_demo
       order by (slug ilike '%lanch%' or slug ilike '%hamburg%') desc, sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
      values ('[Teste] Lanchonete do Tuca', private.unique_business_slug('teste lanchonete ' || sfx), u, 'active', 'restaurante', cat, c.id,
              'Estabelecimento de HOMOLOGAÇÃO: entregas com entregador parceiro independente. Não aparece para clientes reais.',
              'Rua de Teste, 100 - Centro', '(35) 99999-0001', '(35) 99999-0001', 'partner', true, 1000, 30, 45)
      returning id into b_lan;
      insert into public.business_members(business_id, user_id, member_role) values (b_lan, u, 'owner') on conflict do nothing;
      insert into public.menu_categories(business_id, name, sort_order) values (b_lan, 'Lanches', 10) returning id into mc;
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b_lan, mc, 'X-Burger', 'Pão, hambúrguer, queijo e molho da casa.', 2500, 10) returning id into p;
      insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
      values (b_lan, p, 'Ponto da carne', 1, 1, 10) returning id into g;
      insert into public.options(business_id, group_id, name, sort_order) values (b_lan, g, 'Ao ponto', 10), (b_lan, g, 'Bem passado', 20);
      insert into public.option_groups(business_id, product_id, name, min_select, max_select, sort_order)
      values (b_lan, p, 'Adicionais', 0, 2, 20) returning id into g;
      insert into public.options(business_id, group_id, name, price_delta_cents, sort_order) values (b_lan, g, 'Bacon', 500, 10), (b_lan, g, 'Ovo', 300, 20);
      insert into public.products(business_id, category_id, name, description, price_cents, sort_order)
      values (b_lan, mc, 'Cheeseburger', 'Pão, hambúrguer, queijo e molho. Produto de homologação.', 2200, 15),
             (b_lan, mc, 'X-Salada', 'Hambúrguer, queijo, alface e tomate.', 2800, 20);
      insert into public.menu_categories(business_id, name, sort_order) values (b_lan, 'Bebidas', 20) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order)
      values (b_lan, mc, 'Refrigerante lata', 600, 10), (b_lan, mc, 'Suco natural 500 ml', 900, 20);
      insert into public.business_hours(business_id, weekday, opens, closes) select b_lan, d, '00:00', '24:00' from generate_series(0, 6) d;
      insert into public.jobs(business_id, city_id, title, area, description, employment_type, created_by)
      values (b_lan, c.id, '[Teste] Atendente', 'atendimento', 'Vaga de TESTE para validar candidaturas: atendimento ao público no balcão.', 'clt', u);
      new_biz := new_biz || b_lan;
    elsif k = 'empresario2' then
      select id into cat from public.categories where kind = 'loja' and not is_demo
       order by (slug ilike '%mercad%' or slug ilike '%super%') desc, sort_order limit 1;
      insert into public.businesses(name, slug, owner_id, status, business_type, category_id, city_id, description, address_line, phone, whatsapp,
                                    delivery_offer, own_delivery_fee_cents, accepts_pickup, min_order_cents, estimated_min_minutes, estimated_max_minutes)
      values ('[Teste] Supermercado do Tuca', private.unique_business_slug('teste supermercado ' || sfx), u, 'active', 'loja', cat, c.id,
              'Estabelecimento de HOMOLOGAÇÃO: entregas com entregador próprio do supermercado. Não aparece para clientes reais.',
              'Avenida de Teste, 200 - Centro', '(35) 99999-0002', '(35) 99999-0002', 'own', 500, true, 0, 40, 60)
      returning id into b_sup;
      insert into public.business_members(business_id, user_id, member_role) values (b_sup, u, 'owner') on conflict do nothing;
      insert into public.menu_categories(business_id, name, sort_order) values (b_sup, 'Mercearia', 10) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order)
      values (b_sup, mc, 'Arroz 5 kg', 2990, 10), (b_sup, mc, 'Feijão 1 kg', 899, 20), (b_sup, mc, 'Café 500 g', 1690, 30);
      insert into public.menu_categories(business_id, name, sort_order) values (b_sup, 'Bebidas', 20) returning id into mc;
      insert into public.products(business_id, category_id, name, price_cents, sort_order) values (b_sup, mc, 'Refrigerante 2 L', 999, 10);
      insert into public.business_hours(business_id, weekday, opens, closes) select b_sup, d, '00:00', '24:00' from generate_series(0, 6) d;
      new_biz := new_biz || b_sup;
    elsif k = 'funcionario' then
      insert into public.business_members(business_id, user_id, member_role) values (b_lan, u, 'attendant');
    elsif k = 'entregador' then
      insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category, status,
                                  terms_version, terms_accepted_at, reviewed_by, reviewed_at, review_note)
      values (u, 'Entregador 1 — Independente', '(35) 99999-0003', c.id, 'moto', 'TST1A23', 'A', 'approved',
              'teste', now(), auth.uid(), now(), 'Cadastro de teste gerado pelo Painel Master.');
      insert into public.user_roles(user_id, role, granted_by) values (u, 'courier_partner', auth.uid()) on conflict do nothing;
    elsif k = 'entregador2' then
      -- vínculo com o supermercado; sem courier_partner e sem cadastro na rede independente
      insert into public.business_members(business_id, user_id, member_role) values (b_sup, u, 'courier_own');
    end if;
    created := created || jsonb_build_object('key', k, 'role', case when k like 'empresario%' then 'empresario' when k like 'entregador%' then 'entregador'
                                                                     when k like 'cliente%' then 'cliente' else 'funcionario' end,
                                             'label', nome, 'email', k || '-' || sfx || '@teste.example.com');
  end loop;

  if array_length(new_biz, 1) is not null then
    perform set_config('tucai.internal', 'on', true);
    update public.businesses set is_test = true where id = any(new_biz);
    perform set_config('tucai.internal', 'off', true);
  end if;

  if reuse then
    update private.test_data_runs set user_ids = user_ids || new_users, business_ids = business_ids || new_biz, logins = logins || created
     where id = r.id returning id into run;
  else
    insert into private.test_data_runs(city_id, created_by, user_ids, business_ids, logins)
    values (c.id, auth.uid(), new_users, new_biz, created) returning id into run;
  end if;
  perform private.audit('test_data.create', 'test_data_runs', run::text,
                        jsonb_build_object('city', c.id, 'reused', reuse, 'new_accounts', coalesce(array_length(new_users, 1), 0), 'formato', 'sete_perfis'));
  return jsonb_build_object('run_id', run, 'city', c.name || ' - ' || c.state, 'reused', reuse,
                            'password', case when array_length(new_users, 1) is null then null else pwd end, 'logins', created);
end $$;

-- Lanchonete de teste com Premium de homologação (comandas, caixa, Insights) — sem cobrança; Supermercado no Padrão
create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; ids uuid[]; b uuid;
begin
  res := private.admin_create_test_data_impl(_city);
  select business_ids into ids from private.test_data_runs where id = (res->>'run_id')::uuid;
  perform private.label_test_businesses(ids);
  for b in select id from public.businesses where id = any(ids) and business_type = 'restaurante' and name like '[Teste] Lanchonete%'
             and not exists (select 1 from private.plan_grants g where g.business_id = businesses.id) loop
    perform public.admin_grant_test_plan(b, 'presencial_delivery', 'Homologação: Lanchonete de teste com todos os recursos');
  end loop;
  return res;
end $$;

do $$
declare f text;
begin
  revoke all on function private.is_own_courier(uuid, uuid) from public, anon, authenticated;
  revoke all on function private.admin_create_test_data_impl(uuid) from public, anon, authenticated;
  revoke all on function private.test_login_key(jsonb) from public, anon, authenticated;
  foreach f in array array['public.merchant_assign_own_courier(uuid, uuid)', 'public.merchant_own_couriers(uuid)',
                           'public.own_courier_deliveries(boolean)', 'public.own_courier_set_status(uuid, public.order_status)',
                           'public.admin_create_test_data(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
