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

-- comércios para horário (sem vínculo com as contagens acima)
insert into public.businesses(id, name, slug, owner_id, status) values
  ('77771000-0000-0000-0000-000000000011', 'Tstx Horario Comercial', 'tstx-h-comercial', '77770000-0000-0000-0000-0000000000c1', 'active'),
  ('77771000-0000-0000-0000-000000000012', 'Tstx Horario Meia-noite', 'tstx-h-meianoite', '77770000-0000-0000-0000-0000000000c1', 'active'),
  ('77771000-0000-0000-0000-000000000013', 'Tstx Horario 24', 'tstx-h-24', '77770000-0000-0000-0000-0000000000c1', 'active'),
  ('77771000-0000-0000-0000-000000000014', 'Tstx Horario Dia Todo', 'tstx-h-diatodo', '77770000-0000-0000-0000-0000000000c1', 'active'),
  ('77771000-0000-0000-0000-000000000015', 'Tstx Sem Horario', 'tstx-h-nenhum', '77770000-0000-0000-0000-0000000000c1', 'active');
insert into public.business_hours(business_id, weekday, opens, closes) values
  ('77771000-0000-0000-0000-000000000011', 1, '09:00', '18:00'),   -- segunda
  ('77771000-0000-0000-0000-000000000012', 5, '22:00', '02:00'),   -- sexta -> sábado
  ('77771000-0000-0000-0000-000000000012', 0, '22:00', '02:00'),   -- domingo -> segunda
  ('77771000-0000-0000-0000-000000000013', 3, '18:00', '24:00'),   -- quarta até 24:00
  ('77771000-0000-0000-0000-000000000014', 4, '00:00', '24:00');   -- quinta o dia todo

-- ======================================================================
-- 1. Catálogo de segurança (14.4, 14.5, 14.6, 14.11)
-- ======================================================================
do $$
declare bad text;
begin
  perform tstx.su();

  -- RLS ligado em toda tabela de public
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  perform tstx.ok(bad is null, 'RLS desligado em: ' || coalesce(bad, ''));

  -- nenhuma política using (true)/with check (true) fora da lista pública explícita.
  -- permissions/role_permissions (0001) são catálogos estáticos legíveis só por authenticated.
  -- ufs/municipalities (0028) são a base pública do IBGE (somente leitura).
  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and tablename not in ('cities', 'categories', 'permissions', 'role_permissions', 'ufs', 'municipalities')
     and (lower(regexp_replace(coalesce(qual, ''), '[()\s]', '', 'g')) = 'true'
          or lower(regexp_replace(coalesce(with_check, ''), '[()\s]', '', 'g')) = 'true');
  perform tstx.ok(bad is null, 'política aberta (true) em: ' || coalesce(bad, ''));

  -- toda tabela de negócio tem business_id (exceto catálogos globais, preços e tabelas da 0001)
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname not in ('cities', 'categories', 'pricing_configs',
                           'profiles', 'user_roles', 'businesses', 'business_members',
                           'permissions', 'role_permissions', 'audit_logs',
                           -- tabelas globais da plataforma (0005)
                           'platform_settings', 'platform_permissions', 'platform_staff_permissions',
                           -- solicitações LGPD são do titular, não de uma empresa (0006)
                           'privacy_requests',
                           -- Conecta (0008): conteúdo de pessoas; business_id é opcional em posts
                           'social_profiles', 'follows', 'user_blocks', 'post_comments', 'post_likes', 'post_saves',
                           'notifications', 'content_reports', 'moderation_appeals',
                           -- entregadores (0009) e Conectuaí (0010)
                           'couriers', 'friendships', 'scraps', 'testimonials', 'community_members', 'community_topics',
                           'topic_replies', 'community_polls', 'poll_options', 'poll_votes',
                           -- pedidos (0011): itens e eventos pertencem ao pedido, que tem business_id
                           'order_items', 'order_events', 'job_applications',
                           -- catálogo de planos da plataforma (0018)
                           'plans',
                           -- recusas de oferta (0022) pertencem à entrega, que tem business_id
                           'delivery_declines',
                           -- cobertura nacional (0028): base IBGE e regiões são da plataforma, não de um estabelecimento
                           'ufs', 'municipalities', 'commercial_regions', 'region_municipalities',
                           -- publicidade (0029): regiões e eventos pertencem à campanha, que tem business_id
                           'ad_campaign_regions', 'ad_events')
     and not exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped);
  perform tstx.ok(bad is null, 'tabela sem business_id: ' || coalesce(bad, ''));

  -- toda FK tem índice com a coluna líder (exceções: FKs de tabelas pequenas da 0001)
  select string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ') into bad
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'f' and n.nspname = 'public'
     and c.conname not in ('user_roles_granted_by_fkey', 'audit_logs_actor_id_fkey',
                           'role_permissions_permission_fkey')
     and not exists (select 1 from pg_index i
                      where i.indrelid = c.conrelid and i.indisvalid and i.indpred is null
                        and i.indkey[0] = c.conkey[1]);
  perform tstx.ok(bad is null, 'FK sem índice líder: ' || coalesce(bad, ''));

  -- toda função SECURITY DEFINER de public/private tem search_path vazio
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                      where cfg ~ '^search_path=("")?$');
  perform tstx.ok(bad is null, 'SECURITY DEFINER sem search_path vazio: ' || coalesce(bad, ''));

  -- anon não lê public.businesses (nem por coluna); a visão pública não expõe owner_id
  perform tstx.ok(not has_table_privilege('anon', 'public.businesses', 'select'), 'anon com SELECT em businesses');
  perform tstx.ok(not has_any_column_privilege('anon', 'public.businesses', 'select'), 'anon com SELECT por coluna em businesses');
  perform tstx.ok(not exists (select 1 from pg_attribute where attrelid = 'public.public_businesses'::regclass
                               and attname = 'owner_id' and not attisdropped), 'public_businesses expõe owner_id');
  perform tstx.ok(not exists (select 1 from pg_attribute where attrelid = 'public.public_businesses'::regclass
                               and attname = 'updated_at' and not attisdropped), 'public_businesses expõe updated_at');

  -- pricing_configs não é legível pela API
  perform tstx.ok(not has_table_privilege('anon', 'public.pricing_configs', 'select')
                  and not has_table_privilege('authenticated', 'public.pricing_configs', 'select')
                  and not has_any_column_privilege('anon', 'public.pricing_configs', 'select')
                  and not has_any_column_privilege('authenticated', 'public.pricing_configs', 'select'),
                  'pricing_configs com SELECT para anon/authenticated');
  perform tstx.anon();
  perform tstx.denied('select * from public.pricing_configs', 'anon lê pricing_configs');
  perform tstx.login('77770000-0000-0000-0000-0000000000a1');
  perform tstx.denied('select * from public.pricing_configs', 'authenticated lê pricing_configs');
  perform tstx.denied('update public.pricing_configs set is_current = false', 'authenticated altera pricing_configs');

  -- schema private e funções internas fora do alcance da API
  perform tstx.denied($q$select private.is_open('77771000-0000-0000-0000-000000000011', now())$q$, 'authenticated chama private.is_open');
  perform tstx.anon();
  perform tstx.denied($q$select private.is_open('77771000-0000-0000-0000-000000000011', now())$q$, 'anon chama private.is_open');
  perform tstx.denied($q$select private.mark_pricing_config_used(gen_random_uuid())$q$, 'anon chama mark_pricing_config_used');
  perform tstx.su();
end $$;

-- ======================================================================
-- 2. Visibilidade pública do catálogo (14.4, 14.5, 14.10)
-- ======================================================================
do $$
declare
  r text;
  uid uuid;
  pen constant uuid := '77771000-0000-0000-0000-000000000002';
  act constant uuid := '77771000-0000-0000-0000-000000000001';
begin
  -- anon e authenticated sem vínculo enxergam o mesmo: só o comércio ativo
  foreach r in array array['anon', 'stranger'] loop
    if r = 'anon' then perform tstx.anon(); else perform tstx.login('77770000-0000-0000-0000-0000000000b1'); end if;

    perform tstx.ok(tstx.count('select 1 from public.public_businesses where id = any(tstx.fx())') = 1, r || ': visão pública mostra só o ativo');
    perform tstx.ok(tstx.count($q$select 1 from public.public_businesses where id = any(tstx.fx()) and status <> 'active'$q$) = 0, r || ': visão sem pendente/suspenso');
    perform tstx.ok(tstx.count($q$select 1 from public.public_businesses where id = '77771000-0000-0000-0000-000000000001'$q$) = 1, r || ': ativo visível na visão');
    perform tstx.ok(tstx.count('select 1 from public.business_hours where business_id = any(tstx.fx())') = 1, r || ': horários só do ativo');
    perform tstx.ok(tstx.count('select 1 from public.menu_categories where business_id = any(tstx.fx())') = 1, r || ': categorias de cardápio ativas só do ativo');
    perform tstx.ok(tstx.count('select 1 from public.products where business_id = any(tstx.fx())') = 1, r || ': produtos só do ativo');
    perform tstx.ok(tstx.count('select 1 from public.option_groups where business_id = any(tstx.fx())') = 1, r || ': grupos de opções só do ativo');
    perform tstx.ok(tstx.count('select 1 from public.options where business_id = any(tstx.fx())') = 1, r || ': opções só do ativo');
    perform tstx.ok(tstx.count('select 1 from public.services where business_id = any(tstx.fx())') = 1, r || ': serviço publicado só do ativo (oculto não aparece)');
    perform tstx.ok(tstx.count('select 1 from public.reviews where business_id = any(tstx.fx())') = 1, r || ': avaliações só do ativo');
    perform tstx.ok(tstx.count($q$select 1 from public.cities where slug like 'tstx-%'$q$) = 1, r || ': só cidade ativa');
    perform tstx.ok(tstx.count('select 1 from public.categories') >= 0, r || ': categorias legíveis');

    -- tabela de comércios fechada; avaliações sem identificadores internos
    if r = 'anon' then
      perform tstx.denied('select * from public.businesses', 'anon lê businesses');
      perform tstx.denied('select owner_id from public.businesses', 'anon lê owner_id');
    else
      perform tstx.ok(tstx.count('select 1 from public.businesses where id = any(tstx.fx())') = 0, 'cliente sem vínculo não lê businesses diretamente');
    end if;
    perform tstx.denied('select user_id from public.reviews', r || ' lê reviews.user_id');
    perform tstx.denied('select order_id from public.reviews', r || ' lê reviews.order_id');
    perform tstx.denied('select * from public.reviews', r || ' lê reviews.*');
    perform tstx.ok(tstx.count('select id, business_id, rating, comment, author_name, created_at from public.reviews where business_id = any(tstx.fx())') = 1, r || ': colunas públicas de reviews legíveis');

    -- sem escrita no catálogo pela API
    perform tstx.denied($q$insert into public.products(business_id, category_id, name, price_cents) values ('77771000-0000-0000-0000-000000000001','77773000-0000-0000-0000-000000000001','x',1)$q$, r || ' insere produto');
    -- 0007: authenticated tem grant de coluna para o painel; sem vínculo a RLS filtra tudo (0 linhas)
    if r = 'anon' then
      perform tstx.denied($q$update public.products set price_cents = 1$q$, r || ' altera produto');
    else
      perform tstx.ok(tstx.affected($q$update public.products set price_cents = 1$q$) = 0, r || ' altera produto');
    end if;
    perform tstx.denied($q$delete from public.services$q$, r || ' apaga serviço');
    perform tstx.denied($q$insert into public.reviews(business_id, rating) values ('77771000-0000-0000-0000-000000000001', 5)$q$, r || ' insere avaliação');
    perform tstx.denied($q$insert into public.business_hours(business_id, weekday, opens, closes) values ('77771000-0000-0000-0000-000000000001', 2, '08:00', '09:00')$q$, r || ' insere horário');
    perform tstx.denied($q$insert into public.cities(name, state, slug) values ('Hack', 'XX', 'hack-city')$q$, r || ' insere cidade');
  end loop;

  -- membro vê o próprio comércio pendente na tabela, mas a visão pública continua escondendo
  perform tstx.login('77770000-0000-0000-0000-0000000000c2');
  perform tstx.ok(tstx.count('select 1 from public.businesses where id = any(tstx.fx())') = 1, 'dono vê só o próprio comércio (pendente) na tabela');
  perform tstx.ok(tstx.count('select 1 from public.public_businesses where id = any(tstx.fx())') = 1, 'visão pública continua só com o ativo para o dono do pendente');
  perform tstx.ok(tstx.count('select 1 from public.public_businesses where id = ''' || pen || '''') = 0, 'pendente fora da visão pública mesmo para o dono');
  -- 0007: o dono vê o próprio cardápio para prepará-lo antes da aprovação (o público continua sem ver)
  perform tstx.ok(tstx.count('select 1 from public.products where business_id = ''' || pen || '''') = 1, 'dono do pendente vê o próprio cardápio');

  -- mudança de status altera a visibilidade (pendente -> ativo aparece; ativo -> suspenso some)
  perform tstx.su();
  update public.businesses set status = 'active' where id = pen;
  perform tstx.anon();
  perform tstx.ok(tstx.count('select 1 from public.public_businesses where id = any(tstx.fx())') = 2, 'pendente aprovado aparece na visão');
  perform tstx.ok(tstx.count('select 1 from public.products where business_id = any(tstx.fx())') = 2, 'produtos do aprovado aparecem');
  perform tstx.ok(tstx.count('select 1 from public.reviews where business_id = any(tstx.fx())') = 2, 'avaliações do aprovado aparecem');
  perform tstx.su();
  update public.businesses set status = 'suspended' where id in (act, pen);
  perform tstx.anon();
  perform tstx.ok(tstx.count('select 1 from public.public_businesses where id = any(tstx.fx())') = 0, 'suspensos somem da visão');
  perform tstx.ok(tstx.count('select 1 from public.business_hours where business_id = any(tstx.fx())') = 0, 'horários de suspensos somem');
  perform tstx.ok(tstx.count('select 1 from public.menu_categories where business_id = any(tstx.fx())') = 0, 'categorias de suspensos somem');
  perform tstx.ok(tstx.count('select 1 from public.products where business_id = any(tstx.fx())') = 0, 'produtos de suspensos somem');
  perform tstx.ok(tstx.count('select 1 from public.option_groups where business_id = any(tstx.fx())') = 0, 'grupos de suspensos somem');
  perform tstx.ok(tstx.count('select 1 from public.options where business_id = any(tstx.fx())') = 0, 'opções de suspensos somem');
  perform tstx.ok(tstx.count('select 1 from public.services where business_id = any(tstx.fx())') = 0, 'serviços de suspensos somem');
  perform tstx.ok(tstx.count('select 1 from public.reviews where business_id = any(tstx.fx())') = 0, 'avaliações de suspensos somem');
  perform tstx.su();
  update public.businesses set status = 'active' where id = act;
  update public.businesses set status = 'pending' where id = pen;
  perform tstx.su();
end $$;

-- ======================================================================
-- 3. Horário de funcionamento: private.is_open no fuso America/Sao_Paulo (14.13, 14.14)
-- ======================================================================
do $$
declare
  comercial constant uuid := '77771000-0000-0000-0000-000000000011';
  noite     constant uuid := '77771000-0000-0000-0000-000000000012';
  h24       constant uuid := '77771000-0000-0000-0000-000000000013';
  dia       constant uuid := '77771000-0000-0000-0000-000000000014';
  nenhum    constant uuid := '77771000-0000-0000-0000-000000000015';
  tz text;
begin
  perform tstx.su();
  -- 2024-01-01 é segunda-feira; São Paulo = UTC-3 (sem horário de verão)
  foreach tz in array array['UTC', 'Asia/Tokyo', 'America/Sao_Paulo'] loop
    perform set_config('TimeZone', tz, true); -- o resultado não pode depender do fuso da sessão

    -- janela comercial seg 09:00-18:00
    perform tstx.ok(private.is_open(comercial, timestamptz '2024-01-01 12:00:00-03'), tz || ': seg 12:00 aberto');
    perform tstx.ok(private.is_open(comercial, timestamptz '2024-01-01 09:00:00-03'), tz || ': seg 09:00 aberto (abertura inclusiva)');
    perform tstx.ok(private.is_open(comercial, timestamptz '2024-01-01 17:59:59-03'), tz || ': seg 17:59:59 aberto');
    perform tstx.ok(not private.is_open(comercial, timestamptz '2024-01-01 18:00:00-03'), tz || ': seg 18:00 fechado (fechamento exclusivo)');
    perform tstx.ok(not private.is_open(comercial, timestamptz '2024-01-01 08:59:59-03'), tz || ': seg 08:59:59 fechado');
    perform tstx.ok(not private.is_open(comercial, timestamptz '2024-01-01 20:00:00-03'), tz || ': seg 20:00 fechado');
    perform tstx.ok(not private.is_open(comercial, timestamptz '2024-01-02 12:00:00-03'), tz || ': terça 12:00 fechado (sem janela)');
    -- o mesmo instante em UTC: 12:00 UTC = 09:00 SP (aberto); 11:59:59 UTC = 08:59:59 SP (fechado)
    perform tstx.ok(private.is_open(comercial, timestamptz '2024-01-01 12:00:00+00'), tz || ': 12:00 UTC = 09:00 SP aberto');
    perform tstx.ok(not private.is_open(comercial, timestamptz '2024-01-01 11:59:59+00'), tz || ': 11:59:59 UTC = 08:59:59 SP fechado');
    -- 00:30 UTC de terça = 21:30 de segunda em SP (fechado), mas dia local ainda é segunda
    perform tstx.ok(not private.is_open(comercial, timestamptz '2024-01-02 00:30:00+00'), tz || ': 00:30 UTC de terça = segunda 21:30 SP fechado');
    -- 20:00 UTC de segunda = 17:00 SP (aberto)
    perform tstx.ok(private.is_open(comercial, timestamptz '2024-01-01 20:00:00+00'), tz || ': 20:00 UTC = 17:00 SP aberto');

    -- janela que atravessa a meia-noite: sex 22:00-02:00 e dom 22:00-02:00
    perform tstx.ok(private.is_open(noite, timestamptz '2024-01-05 23:00:00-03'), tz || ': sex 23:00 aberto');
    perform tstx.ok(private.is_open(noite, timestamptz '2024-01-05 22:00:00-03'), tz || ': sex 22:00 aberto');
    perform tstx.ok(not private.is_open(noite, timestamptz '2024-01-05 21:59:59-03'), tz || ': sex 21:59:59 fechado');
    perform tstx.ok(private.is_open(noite, timestamptz '2024-01-06 00:00:00-03'), tz || ': sáb 00:00 aberto (janela de sexta)');
    perform tstx.ok(private.is_open(noite, timestamptz '2024-01-06 01:59:59-03'), tz || ': sáb 01:59:59 aberto');
    perform tstx.ok(not private.is_open(noite, timestamptz '2024-01-06 02:00:00-03'), tz || ': sáb 02:00 fechado');
    perform tstx.ok(not private.is_open(noite, timestamptz '2024-01-05 01:00:00-03'), tz || ': sex 01:00 fechado (quinta sem janela)');
    perform tstx.ok(not private.is_open(noite, timestamptz '2024-01-06 23:00:00-03'), tz || ': sáb 23:00 fechado (sem janela de sábado)');
    perform tstx.ok(private.is_open(noite, timestamptz '2024-01-07 23:30:00-03'), tz || ': dom 23:30 aberto');
    perform tstx.ok(private.is_open(noite, timestamptz '2024-01-08 01:00:00-03'), tz || ': seg 01:00 aberto (janela de domingo)');
    perform tstx.ok(not private.is_open(noite, timestamptz '2024-01-08 02:00:00-03'), tz || ': seg 02:00 fechado');

    -- fechamento '24:00' (quarta 18:00-24:00)
    perform tstx.ok(private.is_open(h24, timestamptz '2024-01-03 18:00:00-03'), tz || ': qua 18:00 aberto');
    perform tstx.ok(private.is_open(h24, timestamptz '2024-01-03 23:59:59-03'), tz || ': qua 23:59:59 aberto (24:00)');
    perform tstx.ok(not private.is_open(h24, timestamptz '2024-01-03 17:59:59-03'), tz || ': qua 17:59:59 fechado');
    perform tstx.ok(not private.is_open(h24, timestamptz '2024-01-04 00:00:00-03'), tz || ': qui 00:00 fechado (24:00 não vira a janela do dia seguinte)');
    -- dia todo 00:00-24:00 (quinta)
    perform tstx.ok(private.is_open(dia, timestamptz '2024-01-04 00:00:00-03'), tz || ': qui 00:00 aberto (dia todo)');
    perform tstx.ok(private.is_open(dia, timestamptz '2024-01-04 23:59:59-03'), tz || ': qui 23:59:59 aberto (dia todo)');
    perform tstx.ok(not private.is_open(dia, timestamptz '2024-01-05 00:00:00-03'), tz || ': sex 00:00 fechado (dia todo só na quinta)');

    -- sem horários cadastrados: fechado; comércio inexistente: fechado
    perform tstx.ok(not private.is_open(nenhum, timestamptz '2024-01-01 12:00:00-03'), tz || ': sem horários = fechado');
    perform tstx.ok(not private.is_open(gen_random_uuid(), timestamptz '2024-01-01 12:00:00-03'), tz || ': comércio inexistente = fechado');
  end loop;

  -- wrapper público: booleano não nulo para anon, sem expor private
  perform tstx.anon();
  perform tstx.ok(public.business_is_open('77771000-0000-0000-0000-000000000011') is not null, 'business_is_open acessível a anon');
  perform tstx.su();
end $$;

-- ======================================================================
-- 4. Dados is_demo nunca aparecem na experiência pública (0003)
do $$
begin
  perform tstx.su();
  insert into public.cities(id, name, state, slug, is_active, is_demo)
  values ('77779000-0000-0000-0000-0000000000d1', 'Cidade Demo Tstx', 'TX', 'tstx-demo', true, true);
  insert into public.categories(id, slug, label, kind, is_demo)
  values ('77778000-0000-0000-0000-0000000000d1', 'tstx-demo-cat', 'Demo', 'restaurante', true);
  insert into public.businesses(id, name, slug, owner_id, status, city_id, is_demo)
  values ('77771000-0000-0000-0000-0000000000d1', 'Tstx Demo', 'tstx-demo-b', '77770000-0000-0000-0000-0000000000c1',
          'active', '77779000-0000-0000-0000-000000000001', true);
  insert into public.menu_categories(id, business_id, name)
  values ('77772000-0000-0000-0000-0000000000d1', '77771000-0000-0000-0000-0000000000d1', 'Demo');
  insert into public.products(business_id, category_id, name, price_cents)
  values ('77771000-0000-0000-0000-0000000000d1', '77772000-0000-0000-0000-0000000000d1', 'Demo', 100);

  perform tstx.anon();
  perform tstx.ok(tstx.count($q$select 1 from public.cities where id = '77779000-0000-0000-0000-0000000000d1'$q$) = 0, 'anon vê cidade demo');
  perform tstx.ok(tstx.count($q$select 1 from public.categories where id = '77778000-0000-0000-0000-0000000000d1'$q$) = 0, 'anon vê categoria demo');
  perform tstx.ok(tstx.count($q$select 1 from public.public_businesses where id = '77771000-0000-0000-0000-0000000000d1'$q$) = 0, 'anon vê estabelecimento demo');
  perform tstx.ok(tstx.count($q$select 1 from public.products where business_id = '77771000-0000-0000-0000-0000000000d1'$q$) = 0, 'anon vê produto demo');
  perform tstx.ok(not exists (select 1 from pg_attribute where attrelid = 'public.public_businesses'::regclass
                               and attname = 'is_demo' and not attisdropped), 'public_businesses expõe is_demo');
  perform tstx.login('77770000-0000-0000-0000-0000000000b1');
  perform tstx.ok(tstx.count($q$select 1 from public.public_businesses where id = '77771000-0000-0000-0000-0000000000d1'$q$) = 0, 'cliente vê estabelecimento demo');
  perform tstx.su();
  raise notice 'RLS_EXPERIENCIA_OK';
end $$;

rollback;
