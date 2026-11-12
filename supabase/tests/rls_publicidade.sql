-- Testes da 0029 (publicações patrocinadas). Tudo é revertido. Sucesso: NOTICE 'RLS_PUBLICIDADE_OK'.
begin;
create schema tspb;
grant usage on schema tspb to public;
create function tspb.login(uid uuid, aal text default 'aal2') returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true); set role authenticated; end $$;
create function tspb.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tspb.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tspb.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tspb.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then if sqlstate = any(codes) then return; end if; raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm; end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tspb.count(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
grant execute on all functions in schema tspb to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';
create function tspb.uid(k text) returns uuid language sql security definer as $$ select id from auth.users where email like k || '-%@teste.example.com' $$;
grant execute on function tspb.uid(text) to public;
do $$
declare m uuid; loj uuid; func uuid; c1 uuid; c2 uuid; bm uuid; city uuid; itau uuid; franca uuid; post uuid; post2 uuid; post3 uuid;
        res jsonb; camp uuid; charge uuid; op uuid := gen_random_uuid(); n int; outra uuid := gen_random_uuid();
begin
  perform private.import_municipalities('[{"codigo_ibge": 3106200, "nome": "Belo Horizonte", "latitude": "-19.9102", "longitude": "-43.9266", "capital": 1, "codigo_uf": 31}, {"codigo_ibge": 1400100, "nome": "Boa Vista", "latitude": "2.82384", "longitude": "-60.6753", "capital": 1, "codigo_uf": 14}, {"codigo_ibge": 3509502, "nome": "Campinas", "latitude": "-22.9053", "longitude": "-47.0659", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3115102, "nome": "Cássia", "latitude": "-20.5831", "longitude": "-46.9201", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 2304400, "nome": "Fortaleza", "latitude": "-3.71664", "longitude": "-38.5423", "capital": 1, "codigo_uf": 23}, {"codigo_ibge": 3516200, "nome": "Franca", "latitude": "-20.5352", "longitude": "-47.4039", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3518800, "nome": "Guarulhos", "latitude": "-23.4538", "longitude": "-46.5333", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3133758, "nome": "Itaú de Minas", "latitude": "-20.7375", "longitude": "-46.7525", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 1302603, "nome": "Manaus", "latitude": "-3.11866", "longitude": "-60.0212", "capital": 1, "codigo_uf": 13}, {"codigo_ibge": 3147907, "nome": "Passos", "latitude": "-20.7193", "longitude": "-46.609", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 3152907, "nome": "Pratápolis", "latitude": "-20.7411", "longitude": "-46.8624", "capital": 0, "codigo_uf": 31}, {"codigo_ibge": 3543402, "nome": "Ribeirão Preto", "latitude": "-21.1699", "longitude": "-47.8099", "capital": 0, "codigo_uf": 35}, {"codigo_ibge": 3304557, "nome": "Rio de Janeiro", "latitude": "-22.9129", "longitude": "-43.2003", "capital": 1, "codigo_uf": 33}, {"codigo_ibge": 3550308, "nome": "São Paulo", "latitude": "-23.5329", "longitude": "-46.6395", "capital": 1, "codigo_uf": 35}, {"codigo_ibge": 3164704, "nome": "São Sebastião do Paraíso", "latitude": "-20.9167", "longitude": "-46.9837", "capital": 0, "codigo_uf": 31}]'::jsonb, 'teste');
  perform private.link_cities_ibge();
  perform private.seed_initial_regions();
  select id into city from public.cities where slug = 'itau-de-minas-mg';
  select id into itau from public.commercial_regions where center_ibge = 3133758;
  select id into franca from public.commercial_regions where center_ibge = 3516200;
  m := private.create_auth_user('pb-master@teste.invalid', 'senha-master-1', 'Master PB');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');
  perform tspb.login(m);
  perform public.admin_set_region_status(itau, 'ativa', 'operação real');
  res := public.admin_create_test_data(city);
  perform tspb.su();
  loj := tspb.uid('empresario1'); func := tspb.uid('funcionario'); c1 := tspb.uid('cliente1'); c2 := tspb.uid('cliente2');
  select id into bm from public.businesses where owner_id = loj;
  insert into public.social_profiles(user_id, handle, display_name) values (loj, 'mercadinho_pb', 'Mercadinho') on conflict do nothing;
  perform tspb.login(loj);
  insert into public.posts(author_id, business_id, body) values (loj, bm, 'Promoção de hoje: cheeseburger em dobro!') returning id into post;
  insert into public.posts(author_id, business_id, body) values (loj, bm, 'Chegou café fresquinho.') returning id into post2;
  insert into public.posts(author_id, business_id, body) values (loj, bm, 'Horário estendido no sábado.') returning id into post3;
  perform tspb.su();
  if func is not null then insert into public.business_members(business_id, user_id, member_role) values (bm, func, 'attendant') on conflict do nothing; end if;

  -- orçamento: mínimo R$ 10 e R$ 5/dia por região
  perform tspb.login(loj);
  res := public.ad_quote(array[itau], 2, 1000);
  perform tspb.ok((res->>'ok')::boolean and (res->>'daily_cents')::int = 500, 'R$ 10 por 2 dias = R$ 5/dia');
  perform tspb.ok(not (public.ad_quote(array[itau], 2, 900)->>'ok')::boolean, 'abaixo do mínimo');
  perform tspb.ok((public.ad_quote(array[itau], 4, 1000)->>'min_cents')::int = 2000, 'mínimo cresce com dias × regiões');
  perform tspb.ok(not (public.ad_quote(array[franca], 2, 1000)->>'ok')::boolean, 'região inativa não vale');
  perform tspb.denied(format('select public.merchant_create_campaign(%L, %L, %L, array[%L]::uuid[], 2, 1000, %L)', bm, post, 'alcance', franca, gen_random_uuid()),
                      'campanha em região inativa', array['P0001']);
  perform tspb.denied(format('select public.merchant_create_campaign(%L, %L, %L, array[%L]::uuid[], 2, 900, %L)', bm, post, 'alcance', itau, gen_random_uuid()),
                      'abaixo do mínimo', array['P0001']);
  if func is not null then
    perform tspb.login(func);
    perform tspb.denied(format('select public.merchant_create_campaign(%L, %L, %L, array[%L]::uuid[], 2, 1000, %L)', bm, post, 'alcance', itau, gen_random_uuid()),
                        'atendente contrata anúncio');
  end if;
  perform tspb.login(c1);
  perform tspb.denied(format('select public.merchant_create_campaign(%L, %L, %L, array[%L]::uuid[], 2, 1000, %L)', bm, post, 'alcance', itau, gen_random_uuid()),
                      'cliente contrata anúncio para a loja');

  perform tspb.login(loj);
  res := public.merchant_create_campaign(bm, post, 'alcance', array[itau], 2, 1000, op);
  camp := (res->>'campaign_id')::uuid; charge := (res->>'charge_id')::uuid;
  perform tspb.ok((res->>'amount_cents')::int = 1000, 'preço final informado');
  res := public.merchant_create_campaign(bm, post, 'alcance', array[itau], 2, 1000, op);
  perform tspb.ok((res->>'campaign_id')::uuid = camp and (res->>'repetida')::boolean, 'mesma operação não gera segunda cobrança');
  perform tspb.denied(format('select public.merchant_create_campaign(%L, %L, %L, array[%L]::uuid[], 2, 1000, %L)', bm, post, 'alcance', itau, gen_random_uuid()),
                      'segunda campanha para a mesma publicação', array['P0001']);
  perform tspb.ok((select status from public.merchant_campaigns(bm) where id = camp) = 'aguardando_pagamento', 'aguardando pagamento');
  perform tspb.ok(tspb.count(format('select 1 from public.payable_charge(%L)', charge)) = 1, 'cobrança pagável pelo checkout existente');

  -- não aparece antes de pagar e aprovar
  perform tspb.login(c1);
  perform tspb.ok(tspb.count(format('select 1 from public.sponsored_feed(%L)', city)) = 0, 'sem pagamento/aprovação: fora do feed');
  perform tspb.denied('select * from public.ad_campaigns', 'leitura direta das campanhas');
  perform tspb.denied('select public.admin_ads_summary()', 'cliente vê receitas');

  -- pagamento confirmado (mesma rotina usada pelo webhook/baixa manual)
  perform tspb.login(m);
  perform public.admin_mark_charge_paid(charge, 'pix');
  perform tspb.login(loj);
  perform tspb.ok((select status from public.merchant_campaigns(bm) where id = camp) = 'aguardando_aprovacao', 'paga → aguardando aprovação');
  perform tspb.denied(format('select public.merchant_cancel_campaign(%L)', camp), 'cancelar campanha paga pelo anunciante', array['P0001']);
  perform tspb.login(c1);
  perform tspb.ok(tspb.count(format('select 1 from public.sponsored_feed(%L)', city)) = 0, 'paga sem aprovação: fora do feed');
  perform tspb.login(m);
  perform tspb.denied(format('select public.admin_set_region_status(%L, %L)', itau, 'pausada'), 'pausar região com campanha paga', array['P0001']);
  perform tspb.denied(format('select public.admin_save_region(%L, %L, 3133758, 50)', itau, 'Região de Itaú de Minas'), 'mudar raio com campanha paga', array['P0001']);
  perform tspb.ok(public.admin_review_campaign(camp, true, null) = 'ativa', 'aprovada e paga → ativa');
  perform tspb.su();
  perform tspb.ok((select ends_at - starts_at from public.ad_campaigns where id = camp) = interval '2 days', 'período começa na ativação');

  -- distribuição regional e métricas
  perform tspb.login(c1);
  perform tspb.ok(tspb.count(format('select 1 from public.sponsored_feed(%L) where campaign_id = %L', city, camp)) = 1, 'aparece para quem escolheu cidade da região');
  perform tspb.ok(tspb.count(format('select 1 from public.sponsored_feed(%L)', outra)) = 0, 'não aparece fora da região');
  perform tspb.ok(not public.ad_track(camp, 'clique'), 'clique sem impressão não conta');
  perform tspb.ok(public.ad_track(camp, 'impressao'), 'impressão válida');
  perform tspb.ok(not public.ad_track(camp, 'impressao'), 'impressão repetida no dia não conta');
  perform tspb.ok(public.ad_track(camp, 'clique'), 'clique válido');
  perform tspb.ok(not public.ad_track(camp, 'clique'), 'clique repetido não conta');
  perform tspb.login(c2);
  perform tspb.ok(public.ad_track(camp, 'impressao'), 'outra pessoa conta');
  perform tspb.login(loj);
  perform tspb.ok(not public.ad_track(camp, 'impressao'), 'equipe da loja não conta');
  perform tspb.ok((select impressions = 2 and clicks = 1 and status = 'ativa' from public.merchant_campaigns(bm) where id = camp), 'painel do anunciante: 2 impressões, 1 clique');
  perform tspb.su();
  perform tspb.ok(not exists (select 1 from public.ad_events where viewer_key like '%' || c1::text || '%'), 'métrica sem id da pessoa');

  -- recusa e cancelamento antes do pagamento cancelam a cobrança
  perform tspb.login(loj);
  res := public.merchant_create_campaign(bm, post2, 'visitas', array[itau], 3, 1500, gen_random_uuid());
  perform public.merchant_cancel_campaign((res->>'campaign_id')::uuid);
  perform tspb.su();
  perform tspb.ok((select status from public.platform_charges where id = (res->>'charge_id')::uuid) = 'cancelada', 'cancelar antes de pagar cancela a cobrança');
  perform tspb.login(loj);
  res := public.merchant_create_campaign(bm, post3, 'pedidos', array[itau], 2, 1000, gen_random_uuid());
  perform tspb.login(m);
  perform tspb.denied(format('select public.admin_review_campaign(%L, false, null)', res->>'campaign_id'), 'recusa sem motivo', array['P0001']);
  perform tspb.ok(public.admin_review_campaign((res->>'campaign_id')::uuid, false, 'Imagem fora das regras') = 'recusada', 'recusada');
  perform tspb.su();
  perform tspb.ok((select status from public.platform_charges where id = (res->>'charge_id')::uuid) = 'cancelada', 'recusa sem pagamento cancela a cobrança');

  -- expiração automática libera a região
  update public.ad_campaigns set starts_at = now() - interval '3 days', ends_at = now() - interval '1 day' where id = camp;
  perform tspb.login(c1);
  perform tspb.ok(tspb.count(format('select 1 from public.sponsored_feed(%L)', city)) = 0, 'expirada sai do feed');
  perform tspb.su();
  perform tspb.ok((select status from public.ad_campaigns where id = camp) = 'encerrada', 'expirada encerrada automaticamente');
  perform tspb.login(m);
  res := public.admin_ads_summary();
  perform tspb.ok((res->>'impressoes')::int = 2 and (res->>'cliques')::int = 1, 'Master vê métricas');
  perform public.admin_set_region_status(itau, 'pausada', 'fim do teste');
  raise notice 'RLS_PUBLICIDADE_OK';
end $$;
rollback;
