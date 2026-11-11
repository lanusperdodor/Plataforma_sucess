-- Testes do módulo multicidades (0009/0010): base IBGE, raio de 100 km por Haversine, situação das
-- cidades, painel Master, descoberta regional (200 km) x área de entrega do estabelecimento.
-- Tudo é revertido no final. Sucesso termina com NOTICE 'MULTICIDADES_OK'.
begin;

create schema tstmc;
grant usage on schema tstmc to public;

create function tstmc.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set role authenticated;
end $$;
create function tstmc.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tstmc.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstmc.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstmc.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tstmc.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
-- Distância por lei esférica dos cossenos: fórmula independente para conferir a Haversine.
create function tstmc.cosine_km(a float8, b float8, c float8, d float8) returns float8 language sql immutable as $$
  select 6371.0088 * acos(least(1, sin(radians(a)) * sin(radians(c)) + cos(radians(a)) * cos(radians(c)) * cos(radians(d - b))))
$$;

insert into auth.users(id, email) values
  ('12120000-0000-0000-0000-0000000000a1', 'mc-master@teste.invalid'),
  ('12120000-0000-0000-0000-0000000000a2', 'mc-operador@teste.invalid'),
  ('12120000-0000-0000-0000-0000000000b1', 'mc-dono@teste.invalid'),
  ('12120000-0000-0000-0000-0000000000c1', 'mc-cliente@teste.invalid');
insert into public.user_roles(user_id, role) values
  ('12120000-0000-0000-0000-0000000000a1', 'platform_master'),
  ('12120000-0000-0000-0000-0000000000a2', 'platform_operator');
update public.platform_settings set value = 'false' where key = 'require_admin_mfa';

do $$
declare
  m constant uuid := '12120000-0000-0000-0000-0000000000a1';
  o constant uuid := '12120000-0000-0000-0000-0000000000a2';
  dono constant uuid := '12120000-0000-0000-0000-0000000000b1';
  cli constant uuid := '12120000-0000-0000-0000-0000000000c1';
  itau uuid; passos uuid; pratapolis uuid; legacy uuid; bh uuid; biz uuid;
  hq record;
  n int;
begin
  select * into hq from private.ibge_municipalities where code = 3133758;
  itau := (select id from public.cities where ibge_code = 3133758);
  passos := (select id from public.cities where ibge_code = 3147907);
  pratapolis := (select id from public.cities where ibge_code = 3152907);

  -- 1. base IBGE e configuração
  perform tstmc.ok((select count(*) from private.ibge_municipalities) = 1498, 'base MG+SP com 1498 municípios');
  perform tstmc.ok((select (hq_ibge_code, service_radius_km, discovery_radius_km, eligible_states)
                      = (3133758, 100.0, 200.0, array['MG','SP']) from public.regional_settings), 'configuração regional');

  -- 2. Haversine confere com fórmula independente e com valores conhecidos
  perform tstmc.ok(abs(public.haversine_km(0, 0, 0, 1) - 111.195) < 0.01, '1 grau no equador ~ 111,195 km');
  perform tstmc.ok(public.haversine_km(-20.7375, -46.7525, -20.7375, -46.7525) = 0, 'distância zero');
  perform tstmc.ok((select max(abs(public.haversine_km(hq.lat, hq.lng, m.lat, m.lng) - tstmc.cosine_km(hq.lat, hq.lng, m.lat, m.lng)))
                      from private.ibge_municipalities m) < 0.01, 'Haversine = lei dos cossenos em toda a base');

  -- 3. cidades elegíveis: exatamente as 58 do raio, sem duplicatas, MG/SP, <= 100 km
  perform tstmc.ok((select count(*) from private.eligible_municipalities()) = 58, '58 municípios elegíveis');
  perform tstmc.ok(tstmc.count($q$select 1 from public.cities where ibge_code is not null$q$) = 58, '58 cidades com IBGE cadastradas');
  perform tstmc.ok(tstmc.count($q$
      select m.code from private.ibge_municipalities m, private.ibge_municipalities hq
       where hq.code = 3133758 and m.uf in ('MG','SP') and tstmc.cosine_km(hq.lat, hq.lng, m.lat, m.lng) <= 100
      except select ibge_code from public.cities$q$) = 0, 'nenhuma elegível faltando (conferência independente)');
  perform tstmc.ok(tstmc.count($q$select 1 from public.cities where ibge_code is not null and (distance_from_hq_km > 100 or state not in ('MG','SP'))$q$) = 0,
                   'nenhuma cidade fora do raio/UF');
  perform tstmc.ok((select count(*) from public.cities where ibge_code is not null and state = 'MG') = 38
                   and (select count(*) from public.cities where ibge_code is not null and state = 'SP') = 20, '38 MG + 20 SP');
  perform tstmc.ok(exists (select 1 from public.cities where ibge_code = 3525409 and distance_from_hq_km = 99.4), 'Jeriquara/SP (99,4 km) incluída');
  perform tstmc.ok(not exists (select 1 from public.cities where ibge_code in (3141306, 3106200, 3543402)),
                   'Medeiros (100,4 km), BH e Ribeirão Preto fora');
  perform tstmc.ok((select distance_from_hq_km from public.cities where id = passos) = 15.1, 'Passos a 15,1 km');

  -- 4. situação inicial: só Itaú de Minas ativa; demais planejadas
  perform tstmc.ok((select status from public.cities where id = itau) = 'active', 'Itaú de Minas ativa');
  perform tstmc.ok(tstmc.count($q$select 1 from public.cities where ibge_code is not null and ibge_code <> 3133758 and status <> 'planned'$q$) = 0,
                   'demais cidades do raio planejadas');

  -- 5. integridade: código IBGE único, vinculado a nome/UF corretos, status <-> is_active
  perform tstmc.denied(format($q$insert into public.cities(name, state, slug, ibge_code) values ('Passos', 'MG', 'passos-2', 3147907)$q$),
                       'código IBGE duplicado', array['23505', 'P0001']);
  perform tstmc.denied(format($q$update public.cities set ibge_code = 3147907 where id = %L$q$, pratapolis), 'código IBGE de outra cidade', array['P0001', '23505']);
  perform tstmc.denied($q$insert into public.cities(name, state, slug, ibge_code) values ('Inventada', 'MG', 'inventada-mg', 3199999)$q$,
                       'código fora da base', array['P0001']);
  perform tstmc.denied(format($q$update public.cities set state = 'SP' where id = %L$q$, passos), 'UF divergente do IBGE', array['P0001']);
  update public.cities set is_active = true where id = pratapolis;
  perform tstmc.ok((select status from public.cities where id = pratapolis) = 'active', 'is_active=true sincroniza status');
  update public.cities set is_active = false where id = pratapolis;
  perform tstmc.ok((select status::text || is_active::text from public.cities where id = pratapolis) = 'suspendedfalse', 'is_active=false -> suspensa');
  update public.cities set status = 'planned' where id = pratapolis;
  perform tstmc.ok((select not is_active and status_changed_at is not null from public.cities where id = pratapolis), 'status -> is_active');

  -- 6. público: só cidades ativas; referência e funções internas inacessíveis
  perform tstmc.anon();
  perform tstmc.ok(tstmc.count('select 1 from public.cities where ibge_code is not null') = 1, 'anon vê só a cidade ativa');
  perform tstmc.ok(tstmc.count('select 1 from public.regional_settings') = 1, 'anon lê configuração regional');
  perform tstmc.denied('select * from private.ibge_municipalities', 'anon lê base IBGE');
  perform tstmc.denied('select * from private.eligible_municipalities()', 'anon chama eligible_municipalities');
  perform tstmc.denied('select * from public.admin_list_cities()', 'anon lista cidades do painel');
  perform tstmc.denied('update public.regional_settings set service_radius_km = 500', 'anon altera raio');
  perform tstmc.login(cli);
  perform tstmc.denied('update public.regional_settings set discovery_radius_km = 900', 'cliente altera raio');
  perform tstmc.denied('select * from private.ibge_municipalities', 'cliente lê base IBGE');
  perform tstmc.denied(format($q$select public.admin_set_city_status(%L, 'active')$q$, passos), 'cliente ativa cidade');
  perform tstmc.login(o);
  perform tstmc.denied('select public.admin_sync_eligible_cities()', 'operador sem cities.manage sincroniza');
  perform tstmc.denied(format($q$select public.admin_link_city_ibge(%L, 3141306)$q$, passos), 'operador sem cities.manage vincula');

  -- 7. painel Master: busca por cidade/UF/código, filtros regionais
  perform tstmc.login(m);
  perform tstmc.ok(tstmc.count($q$select 1 from public.admin_list_cities(_state => 'sp')$q$) = 20, 'filtro UF=SP');
  perform tstmc.ok(tstmc.count($q$select 1 from public.admin_list_cities(_status => 'planned') where ibge_code is not null$q$) = 57, 'filtro planejadas');
  perform tstmc.ok(tstmc.count($q$select 1 from public.admin_list_cities('SAO SEBASTIAO DO PARAÍSO')$q$) = 1, 'busca sem acento/caixa');
  perform tstmc.ok(tstmc.count($q$select 1 from public.admin_list_cities('3133758')$q$) = 1, 'busca por código IBGE');
  perform tstmc.ok(tstmc.count($q$select 1 from public.admin_list_cities(_max_distance_km => 30)$q$) = 6, 'filtro até 30 km');
  perform tstmc.ok((select total_count from public.admin_list_cities(_limit => 5) limit 1) >= 58, 'total_count com paginação');
  perform tstmc.ok((select ibge_code from public.admin_list_cities() limit 1) = 3133758, 'ordenado pela distância da sede');

  -- ativação progressiva com auditoria
  perform public.admin_set_city_status(passos, 'active');
  perform tstmc.ok((select status from public.cities where id = passos) = 'active', 'Master ativa Passos');
  perform tstmc.ok(exists (select 1 from public.audit_logs where action = 'city.status' and entity_id = passos::text
                             and details->>'after' = 'active' and details->>'before' = 'planned'), 'auditoria da ativação');
  perform tstmc.ok(public.admin_set_city_status(passos, 'active') = 'active', 'reativar é idempotente');

  -- vínculo de cidade antiga e bloqueio fora da área
  perform tstmc.su();
  insert into public.cities(name, state, slug, status) values ('Medeiros', 'MG', 'medeiros-mg', 'planned') returning id into legacy;
  insert into public.cities(name, state, slug, status, ibge_code, center_lat, center_lng)
    values ('Belo Horizonte', 'MG', 'belo-horizonte-mg', 'planned', 3106200, -19.9102, -43.9266) returning id into bh;
  perform tstmc.login(m);
  perform tstmc.denied(format($q$select public.admin_set_city_status(%L, 'active')$q$, legacy), 'ativa sem IBGE', array['P0001']);
  perform tstmc.denied(format($q$select public.admin_link_city_ibge(%L, 3152907)$q$, legacy), 'vincula código de outra cidade', array['P0001', '23505']);
  perform tstmc.denied(format($q$select public.admin_link_city_ibge(%L, 3133758)$q$, legacy), 'vincula código já usado', array['23505']);
  perform public.admin_link_city_ibge(legacy, 3141306);
  perform tstmc.ok((select ibge_code = 3141306 and distance_from_hq_km = 100.4 and center_lat is not null
                      from public.admin_list_cities('medeiros') where id = legacy),
                   'vínculo preenche coordenadas e distância');
  perform tstmc.denied(format($q$select public.admin_set_city_status(%L, 'active')$q$, legacy), 'ativa a 100,4 km', array['P0001']);
  perform tstmc.denied(format($q$select public.admin_set_city_status(%L, 'active')$q$, bh), 'ativa BH fora da área', array['P0001']);
  perform tstmc.ok((select jsonb_array_length(public.admin_city_coverage()->'outside_area')) = 2, 'cobertura aponta fora da área');
  perform tstmc.ok((public.admin_city_coverage()->>'eligible_total')::int = 58
                   and jsonb_array_length(public.admin_city_coverage()->'missing_eligible') = 0, 'cobertura completa');

  -- sincronização idempotente e sem duplicatas
  perform tstmc.ok(public.admin_sync_eligible_cities() = 0, 'sincronizar de novo não insere nada');
  perform tstmc.su();
  delete from public.cities where ibge_code = 3525409; -- Jeriquara (planejada, sem vínculos)
  perform tstmc.login(m);
  perform tstmc.ok(jsonb_array_length(public.admin_city_coverage()->'missing_eligible') = 1, 'cobertura mostra a faltante');
  perform tstmc.ok(public.admin_sync_eligible_cities() = 1, 'sincronização repõe a faltante');
  perform tstmc.ok(tstmc.count($q$select 1 from public.admin_list_cities('3525409')$q$) = 1, 'sem duplicata após sincronizar');

  -- 8. descoberta regional (200 km) x área de entrega do estabelecimento
  perform tstmc.su();
  update public.cities set status = 'active' where id = bh; -- ativa fora da área (como dado legado), para testar o teto de 200 km
  insert into public.businesses(name, slug, owner_id, status, city_id, lat, lng, delivery_offer, delivery_radius_km)
    values ('Lanches Itaú', 'mc-lanches', dono, 'active', itau, -20.7375, -46.7525, 'own', 5) returning id into biz;
  insert into public.business_members(business_id, user_id, member_role) values (biz, dono, 'owner') on conflict do nothing;
  perform tstmc.anon();
  perform tstmc.ok(tstmc.count(format($q$select 1 from public.discover_cities(%L)$q$, itau)) = 2, 'descoberta: Itaú + Passos (BH a 260 km fica fora)');
  perform tstmc.ok(tstmc.count(format($q$select 1 from public.discover_cities(%L, 1000)$q$, itau)) = 2, 'raio pedido acima de 200 km é limitado');
  perform tstmc.ok(tstmc.count(format($q$select 1 from public.discover_cities(%L, 10)$q$, itau)) = 1, 'raio menor que o regional');
  perform tstmc.ok(public.business_delivers_to(biz, -20.76, -46.75), 'entrega a ~2,5 km (dentro dos 5 km da loja)');
  perform tstmc.ok(not public.business_delivers_to(biz, -20.7193, -46.609), 'não entrega em Passos: descoberta não implica entrega');
  perform tstmc.su();
  update public.businesses set delivery_radius_km = null where id = biz;
  perform tstmc.ok(not public.business_delivers_to(biz, -20.7375, -46.7525), 'sem área de entrega definida -> não entrega');
  perform tstmc.denied(format($q$update public.businesses set delivery_radius_km = 150 where id = %L$q$, biz), 'área de entrega > 100 km', array['23514']);
  perform tstmc.ok(has_column_privilege('authenticated', 'public.businesses', 'delivery_radius_km', 'update'), 'comerciante pode definir a área de entrega');
  perform tstmc.login(dono);
  update public.businesses set delivery_radius_km = 8 where id = biz;
  perform tstmc.su();
  perform tstmc.ok((select delivery_radius_km from public.businesses where id = biz) = 8, 'dono grava a área de entrega');

  -- 9. cidade suspensa tira a loja do catálogo; reativação devolve
  perform tstmc.login(m);
  perform public.admin_set_city_status(itau, 'suspended', 'teste de suspensão');
  perform tstmc.anon();
  perform tstmc.ok(tstmc.count(format($q$select 1 from public.public_businesses where id = %L$q$, biz)) = 0, 'loja some com a cidade suspensa');
  perform tstmc.ok(tstmc.count(format($q$select 1 from public.discover_cities(%L)$q$, itau)) = 0, 'cidade suspensa não é origem de descoberta');
  perform tstmc.login(m);
  perform public.admin_set_city_status(itau, 'active');
  perform tstmc.anon();
  perform tstmc.ok(tstmc.count(format($q$select 1 from public.public_businesses where id = %L$q$, biz)) = 1, 'loja volta com a reativação');
  perform tstmc.su();
end $$;

rollback;
do $$ begin raise notice 'MULTICIDADES_OK'; end $$;
