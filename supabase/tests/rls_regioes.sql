-- Testes da 0028 (cobertura nacional e regiões comerciais). Tudo é revertido. Sucesso: NOTICE 'RLS_REGIOES_OK'.
-- Usa 15 municípios reais (amostra do arquivo gerado a partir dos dados do IBGE).
begin;
create schema tsrg;
grant usage on schema tsrg to public;
create function tsrg.login(uid uuid, aal text default 'aal2') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tsrg.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsrg.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsrg.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsrg.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tsrg.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
grant execute on all functions in schema tsrg to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
do $$
declare m uuid; cli uuid; res jsonb; itau uuid; sp uuid; n int;
begin
  -- importação idempotente
  res := private.import_municipalities('[{"codigo_ibge": 3106200, "nome": "Belo Horizonte", "latitude": "-19.9102", "longitude": "-43.9266", "capital": 1, "codigo_uf": 31}, {"codigo_ibge": 1400100, "nome": "Boa Vista", "latitude": "2.82384", "longitude": "-60.6753", "capital": 1, "codigo_uf": 14}, {"codigo_ibge": 3509502, "nome": "Campinas", "latitude": "-22.9053", "longitude": "-47.0659", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3115102, "nome": "Cássia", "latitude": "-20.5831", "longitude": "-46.9201", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 2304400, "nome": "Fortaleza", "latitude": "-3.71664", "longitude": "-38.5423", "capital": 1, "codigo_uf": 23}, {"codigo_ibge": 3516200, "nome": "Franca", "latitude": "-20.5352", "longitude": "-47.4039", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3518800, "nome": "Guarulhos", "latitude": "-23.4538", "longitude": "-46.5333", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3133758, "nome": "Itaú de Minas", "latitude": "-20.7375", "longitude": "-46.7525", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 1302603, "nome": "Manaus", "latitude": "-3.11866", "longitude": "-60.0212", "capital": 1, "codigo_uf": 13}, {"codigo_ibge": 3147907, "nome": "Passos", "latitude": "-20.7193", "longitude": "-46.609", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 3152907, "nome": "Pratápolis", "latitude": "-20.7411", "longitude": "-46.8624", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 3543402, "nome": "Ribeirão Preto", "latitude": "-21.1699", "longitude": "-47.8099", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3304557, "nome": "Rio de Janeiro", "latitude": "-22.9129", "longitude": "-43.2003", "capital": 1, "codigo_uf": 33}, {"codigo_ibge": 3550308, "nome": "São Paulo", "latitude": "-23.5329", "longitude": "-46.6395", "capital": 1, "codigo_uf": 35}, {"codigo_ibge": 3164704, "nome": "São Sebastião do Paraíso", "latitude": "-20.9167", "longitude": "-46.9837", "capital": 0, "codigo_uf": 31}]'::jsonb, 'teste');
  perform tsrg.ok((res->>'inseridos')::int = 15, 'importa 15 municípios');
  res := private.import_municipalities('[{"codigo_ibge": 3106200, "nome": "Belo Horizonte", "latitude": "-19.9102", "longitude": "-43.9266", "capital": 1, "codigo_uf": 31}, {"codigo_ibge": 1400100, "nome": "Boa Vista", "latitude": "2.82384", "longitude": "-60.6753", "capital": 1, "codigo_uf": 14}, {"codigo_ibge": 3509502, "nome": "Campinas", "latitude": "-22.9053", "longitude": "-47.0659", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3115102, "nome": "Cássia", "latitude": "-20.5831", "longitude": "-46.9201", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 2304400, "nome": "Fortaleza", "latitude": "-3.71664", "longitude": "-38.5423", "capital": 1, "codigo_uf": 23}, {"codigo_ibge": 3516200, "nome": "Franca", "latitude": "-20.5352", "longitude": "-47.4039", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3518800, "nome": "Guarulhos", "latitude": "-23.4538", "longitude": "-46.5333", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3133758, "nome": "Itaú de Minas", "latitude": "-20.7375", "longitude": "-46.7525", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 1302603, "nome": "Manaus", "latitude": "-3.11866", "longitude": "-60.0212", "capital": 1, "codigo_uf": 13}, {"codigo_ibge": 3147907, "nome": "Passos", "latitude": "-20.7193", "longitude": "-46.609", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 3152907, "nome": "Pratápolis", "latitude": "-20.7411", "longitude": "-46.8624", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 3543402, "nome": "Ribeirão Preto", "latitude": "-21.1699", "longitude": "-47.8099", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3304557, "nome": "Rio de Janeiro", "latitude": "-22.9129", "longitude": "-43.2003", "capital": 1, "codigo_uf": 33}, {"codigo_ibge": 3550308, "nome": "São Paulo", "latitude": "-23.5329", "longitude": "-46.6395", "capital": 1, "codigo_uf": 35}, {"codigo_ibge": 3164704, "nome": "São Sebastião do Paraíso", "latitude": "-20.9167", "longitude": "-46.9837", "capital": 0, "codigo_uf": 31}]'::jsonb, 'teste');
  perform tsrg.ok((res->>'inseridos')::int = 0 and (res->>'atualizados')::int = 0, 'reimportar não duplica nem altera');
  perform tsrg.ok(private.fold('São Sebastião do Paraíso') = 'sao sebastiao do paraiso', 'busca sem acento');
  perform tsrg.ok(abs(private.haversine_km(-20.7375, -46.7525, -20.5352, -47.4039) - 71) < 3, 'Itaú de Minas–Franca ≈ 71 km em linha reta');
  perform tsrg.ok(private.link_cities_ibge() >= 5, 'cidades atendidas ligadas ao IBGE por nome + UF');
  perform tsrg.ok(private.seed_initial_regions() = 6, '6 regiões de exemplo');
  perform tsrg.ok(private.seed_initial_regions() = 0, 'regiões de exemplo não duplicam');
  perform tsrg.ok((select count(*) from public.commercial_regions where kind = 'raio' and status = 'rascunho') = 6, 'nascem como rascunho (nada ativado sozinho)');
  select id into itau from public.commercial_regions where center_ibge = 3133758;
  select id into sp from public.commercial_regions where center_ibge = 3550308;
  perform tsrg.ok(exists (select 1 from public.region_municipalities where region_id = itau and ibge_code = 3516200), 'Franca está a 100 km de Itaú de Minas');
  perform tsrg.ok(not exists (select 1 from public.region_municipalities where region_id = itau and ibge_code = 3550308), 'São Paulo fora do raio de Itaú');
  -- sobreposição: Franca está em Itaú e em Franca, mas tem uma só região principal
  perform tsrg.ok((select count(*) from public.region_municipalities where ibge_code = 3516200) >= 2, 'sobreposição registrada');
  perform tsrg.ok((select count(*) from public.region_municipalities where ibge_code = 3516200 and is_primary) = 1, 'uma região principal por município');
  perform tsrg.ok((select count(*) from public.municipalities m where not exists (select 1 from public.region_municipalities x where x.ibge_code = m.ibge_code and x.is_primary)) = 0,
                  '100% dos municípios com região principal');
  -- lacuna: Manaus fica na cobertura administrativa do AM, sinalizada
  perform tsrg.ok(exists (select 1 from public.region_municipalities x join public.commercial_regions r on r.id = x.region_id
                           where x.ibge_code = 1302603 and r.kind = 'administrativa' and x.is_primary), 'Manaus: cobertura administrativa (lacuna)');

  m := private.create_auth_user('rg-master@teste.invalid', 'senha-master-1', 'Master RG');
  cli := private.create_auth_user('rg-cliente@teste.invalid', 'senha-cli-1', 'Cliente RG');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');

  perform tsrg.login(cli);
  perform tsrg.denied('select public.admin_coverage_summary()', 'cliente vê cobertura');
  perform tsrg.denied(format('select public.admin_set_region_status(%L, %L)', itau, 'ativa'), 'cliente ativa região');
  perform tsrg.denied('select * from public.commercial_regions', 'leitura direta das regiões');
  perform tsrg.ok(tsrg.count('select 1 from public.active_regions()') = 0, 'nenhuma região ativa ainda');
  perform tsrg.anon();
  perform tsrg.ok(tsrg.count('select 1 from public.municipalities') = 15, 'municípios são dado público');
  perform tsrg.denied('select * from public.active_regions()', 'visitante lista regiões');

  perform tsrg.login(m);
  res := public.admin_coverage_summary();
  perform tsrg.ok((res->>'municipios')::int = 15 and (res->>'lacunas')::int = 3, 'resumo: 15 municípios, 3 lacunas (Manaus, Boa Vista, Fortaleza)');
  perform tsrg.ok(tsrg.count('select 1 from public.admin_uncovered_municipalities()') = (res->>'lacunas')::int, 'lista de lacunas bate com o resumo');
  perform tsrg.ok(tsrg.count($q$select 1 from public.admin_regions(null, null, 'itau')$q$) >= 1, 'busca de região sem acento');
  perform tsrg.ok(tsrg.count($q$select 1 from public.admin_regions('SP') where kind = 'raio'$q$) = 3, 'filtro por UF');
  perform tsrg.ok(tsrg.count($q$select 1 from public.admin_municipality_search('sao sebas')$q$) = 1, 'busca de município sem acento');
  perform public.admin_set_region_status(itau, 'ativa', 'operação real');
  perform tsrg.ok(tsrg.count('select 1 from public.admin_region_municipalities(' || quote_literal(itau) || ')') >= 5, 'municípios abrangidos');
  -- retirar e incluir manualmente
  perform public.admin_region_member(itau, 3516200, false);
  perform tsrg.su();
  perform tsrg.ok((select excluded from public.region_municipalities where region_id = itau and ibge_code = 3516200), 'Franca retirada (lembrada)');
  perform tsrg.login(m);
  perform public.admin_save_region(itau, 'Região de Itaú de Minas', 3133758, 110);
  perform tsrg.su();
  perform tsrg.ok((select excluded from public.region_municipalities where region_id = itau and ibge_code = 3516200), 'recalcular respeita a retirada');
  perform tsrg.login(m);
  perform public.admin_region_member(itau, 3516200, true);
  perform public.admin_region_member(itau, 3550308, true);
  perform tsrg.su();
  perform tsrg.ok((select source from public.region_municipalities where region_id = itau and ibge_code = 3550308) = 'manual', 'inclusão manual');
  perform tsrg.login(m);
  -- gerador cobre o restante
  perform tsrg.su(); select count(*) into n from public.commercial_regions; perform tsrg.login(m);
  perform tsrg.ok(tsrg.count('select 1 from public.admin_suggest_regions(100, 50, null, false)') >= 1, 'prévia de sugestões');
  perform tsrg.su();
  perform tsrg.ok((select count(*) from public.commercial_regions) = n, 'prévia não cria nada');
  perform tsrg.login(m);
  select count(*) into n from public.admin_suggest_regions(100, 50, null, true);
  res := public.admin_coverage_summary();
  perform tsrg.ok((res->>'lacunas')::int = 0, 'gerador cobre 100% dos municípios com coordenadas');
  perform tsrg.su();
  perform tsrg.ok((select bool_and(status = 'rascunho' and suggested) from public.commercial_regions where suggested), 'sugeridas nascem como rascunho');
  perform tsrg.ok(not exists (select 1 from public.region_municipalities x join public.commercial_regions r on r.id = x.region_id where r.kind = 'administrativa'),
                  'sem lacunas, a cobertura administrativa fica vazia');
  perform tsrg.login(m);
  perform tsrg.denied($q$select public.admin_save_region(null, 'X', 3133758, 900)$q$, 'raio acima de 500 km', array['P0001']);
  perform tsrg.ok(tsrg.count($q$select 1 from public.active_regions('franca')$q$) = 1, 'região ativa aparece para o anunciante (busca por município)');
  perform tsrg.su();
  perform tsrg.ok((select count(*) from public.audit_logs where action like 'regions.%') >= 5, 'alterações auditadas');
  raise notice 'RLS_REGIOES_OK';
end $$;
rollback;
