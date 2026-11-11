-- Testes da 0017 (SEO: sitemap e metadados públicos). Tudo é revertido. Sucesso: NOTICE 'RLS_SEO_OK'.
begin;
create schema tsts;
grant usage on schema tsts to public;
create function tsts.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
grant execute on all functions in schema tsts to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
insert into auth.users(id, email) values ('77770000-0000-0000-0000-00000000005e', 'seo-dono@teste.invalid'), ('77770000-0000-0000-0000-00000000005f', 'seo-master@teste.invalid');
insert into public.user_roles(user_id, role) values ('77770000-0000-0000-0000-00000000005f', 'platform_master');
insert into public.cities(id, name, state, slug) values
  ('77779000-0000-0000-0000-0000000000a1', 'Cidade Com Loja', 'TS', 'tsts-com-loja-ts'),
  ('77779000-0000-0000-0000-0000000000a2', 'Cidade Vazia', 'TS', 'tsts-vazia-ts');
insert into public.businesses(id, name, slug, owner_id, status, business_type, city_id) values
  ('77771000-0000-0000-0000-0000000000b1', 'Restaurante Real', 'tsts-real', '77770000-0000-0000-0000-00000000005e', 'active', 'restaurante', '77779000-0000-0000-0000-0000000000a1'),
  ('77771000-0000-0000-0000-0000000000b2', 'Loja Pendente', 'tsts-pendente', '77770000-0000-0000-0000-00000000005e', 'pending', 'loja', '77779000-0000-0000-0000-0000000000a1');
insert into public.businesses(id, name, slug, owner_id, status, business_type, city_id, is_demo) values
  ('77771000-0000-0000-0000-0000000000b3', 'Demo', 'tsts-demo', '77770000-0000-0000-0000-00000000005e', 'active', 'loja', '77779000-0000-0000-0000-0000000000a2', true);
insert into public.jobs(id, business_id, city_id, title, area, description, employment_type) values
  ('77772000-0000-0000-0000-0000000000c1', '77771000-0000-0000-0000-0000000000b1', '77779000-0000-0000-0000-0000000000a1', 'Garçom', 'atendimento', 'Atendimento no salão do restaurante à noite.', 'clt');

do $$
declare paths text[]; run jsonb; test_slug text;
begin
  -- dados de teste do Master na cidade vazia
  perform set_config('request.jwt.claims', json_build_object('sub', '77770000-0000-0000-0000-00000000005f', 'role', 'authenticated')::text, true);
  run := public.admin_create_test_data('77779000-0000-0000-0000-0000000000a2');
  perform set_config('request.jwt.claims', '{}', true);
  select b.slug into test_slug from public.businesses b
   where b.id = (select (r.business_ids)[1] from private.test_data_runs r where r.id = (run->>'run_id')::uuid);
  set role anon;
  select array_agg(path order by path) into paths from public.sitemap_entries();
  perform tsts.ok('/restaurantes/tsts-real' = any(paths) and '/restaurantes' = any(paths), 'estabelecimento real e seção no sitemap');
  perform tsts.ok('/cidades/tsts-com-loja-ts' = any(paths) and '/cidades/tsts-com-loja-ts/restaurantes' = any(paths), 'cidade com operação e sua seção');
  perform tsts.ok('/vagas/77772000-0000-0000-0000-0000000000c1' = any(paths) and '/cidades/tsts-com-loja-ts/vagas' = any(paths), 'vaga aberta no sitemap');
  perform tsts.ok(not ('/lojas/tsts-pendente' = any(paths)) and not ('/lojas/tsts-demo' = any(paths)), 'pendente e demonstração fora');
  perform tsts.ok(not exists (select 1 from unnest(paths) p where p like '/cidades/tsts-vazia-ts%' or p like '%teste-%'), 'cidade só com dados de teste fica fora; teste fora');
  perform tsts.ok(not exists (select 1 from public.sitemap_entries() where lastmod is null and path like '/restaurantes/%'), 'lastmod real');
  perform tsts.ok((select indexable and name = 'Restaurante Real' and city_slug = 'tsts-com-loja-ts' from public.seo_business('tsts-real')), 'metadados do estabelecimento');
  perform tsts.ok(not exists (select 1 from public.seo_business('tsts-pendente')), 'pendente sem metadados');
  perform tsts.ok((select bool_and(not indexable) from public.seo_business(test_slug)), 'teste marcado como não indexável');
  perform tsts.ok((select restaurantes = 1 and vagas = 1 and lojas = 0 from public.seo_city('tsts-com-loja-ts')), 'contagens da cidade');
  perform tsts.ok((select restaurantes = 0 and lojas = 0 from public.seo_city('tsts-vazia-ts')), 'cidade com só teste conta zero');
  perform tsts.ok((select title = 'Garçom' from public.seo_job('77772000-0000-0000-0000-0000000000c1')), 'metadados da vaga');
  reset role;
  update public.jobs set status = 'closed' where id = '77772000-0000-0000-0000-0000000000c1';
  set role anon;
  perform tsts.ok(not exists (select 1 from public.sitemap_entries() where path like '/vagas%'), 'vaga encerrada sai');
  reset role;
  perform tsts.ok(not has_function_privilege('anon', 'private.indexable_businesses()', 'execute'), 'função interna exposta');
end $$;

do $$ begin raise notice 'RLS_SEO_OK'; end $$;
rollback;
