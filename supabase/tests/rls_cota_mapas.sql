-- Testes da 0058 (cota do serviço de mapas). Tudo é revertido. Sucesso: NOTICE 'RLS_COTA_MAPAS_OK'.
begin;
create schema tscm;
grant usage on schema tscm to public;
create function tscm.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true); set role authenticated; end $$;
create function tscm.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tscm.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tscm.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tscm.blocked(stmt text) returns boolean language plpgsql as $$
begin begin execute stmt; exception when others then return sqlstate in ('PT429', '42501'); end; return false; end $$;
grant execute on all functions in schema tscm to public;
do $$
declare a uuid; b uuid; i int;
begin
  a := private.create_auth_user('cm-a@teste.invalid', 'senha-a-000001', 'Pessoa A');
  b := private.create_auth_user('cm-b@teste.invalid', 'senha-b-000001', 'Pessoa B');
  perform tscm.anon();
  perform tscm.ok(tscm.blocked('select public.geocode_allow()'), 'visitante não usa a busca de endereço');
  -- por pessoa: 30 por hora
  perform tscm.login(a);
  for i in 1..30 loop perform public.geocode_allow(); end loop;
  perform tscm.ok(tscm.blocked('select public.geocode_allow()'), '31ª busca na hora é recusada');
  perform tscm.login(b);
  perform public.geocode_allow();
  -- teto diário geral
  perform tscm.su();
  update private.daily_usage set n = 700 where name = 'geocode' and day = current_date;
  perform tscm.login(b);
  perform tscm.ok(tscm.blocked('select public.geocode_allow()'), 'teto diário geral atingido');
  -- diagnóstico público: 24 por dia
  perform tscm.anon();
  for i in 1..24 loop perform public.diagnostic_allow(); end loop;
  perform tscm.ok(tscm.blocked('select public.diagnostic_allow()'), '25º diagnóstico do dia é recusado');
  perform tscm.su();
  perform tscm.ok(not has_table_privilege('anon', 'private.daily_usage', 'select'), 'contador fora do alcance do público');
  raise notice 'RLS_COTA_MAPAS_OK';
end $$;
rollback;
