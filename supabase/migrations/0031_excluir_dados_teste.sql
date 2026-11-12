-- 0031_excluir_dados_teste: botão "Excluir todos os dados de teste" (Master, aba Logins).
--  * Remove TODOS os lotes de homologação ativos (estabelecimentos [Teste], pedidos, entregas, comandas, caixas,
--    campanhas, cobranças e logins de teste) e qualquer resto marcado como teste (estabelecimento/pedido is_test).
--  * Dados reais nunca entram: só o que está nos lotes de teste ou marcado is_test pela plataforma.
--  * Exige Master e a palavra EXCLUIR digitada. Auditado com as contagens. A remoção por lote usa a mesma rotina.

-- remoção de um lote (corpo da 0015, agora compartilhado)
create or replace function private.remove_test_run(_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r private.test_data_runs%rowtype; u uuid; n_orders int; n_biz int; n_users int := 0;
begin
  select * into r from private.test_data_runs where id = _run and removed_at is null for update;
  if not found then return null; end if;
  perform set_config('tucai.internal', 'on', true);
  delete from public.orders where business_id = any(r.business_ids) or customer_id = any(r.user_ids);
  get diagnostics n_orders = row_count;
  delete from public.businesses where id = any(r.business_ids);
  get diagnostics n_biz = row_count;
  delete from public.couriers where user_id = any(r.user_ids);
  foreach u in array r.user_ids loop
    begin
      delete from auth.users where id = u;
      if found then n_users := n_users + 1; end if;
    exception when foreign_key_violation then
      -- conta citada em registros que devem ser preservados (ex.: auditoria): bloqueia e anonimiza
      perform private.anonymize_user(u);
      update auth.users set banned_until = 'infinity', email = 'removido-' || u::text || '@teste.example.com' where id = u;
      n_users := n_users + 1;
    end;
  end loop;
  update private.test_data_runs set removed_at = now() where id = r.id;
  return jsonb_build_object('pedidos', n_orders, 'estabelecimentos', n_biz, 'logins', n_users);
end $$;

create or replace function public.admin_remove_test_data(_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  perform private.require_master();
  perform private.limit_for('admin.test_data');
  res := private.remove_test_run(_run);
  if res is null then raise exception 'Lote de teste não encontrado.' using errcode = 'P0001'; end if;
  perform private.audit('test_data.remove', 'test_data_runs', _run::text, res);
end $$;

create or replace function public.admin_remove_all_test_data(_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run uuid; res jsonb; lotes int := 0; pedidos int := 0; estab int := 0; logins int := 0; n int;
begin
  perform private.require_master();
  if upper(btrim(coalesce(_confirm, ''))) <> 'EXCLUIR' then
    raise exception 'Digite EXCLUIR para confirmar.' using errcode = 'P0001';
  end if;
  perform private.limit_for('admin.test_data');
  for run in select id from private.test_data_runs where removed_at is null order by created_at loop
    res := private.remove_test_run(run);
    if res is not null then
      lotes := lotes + 1;
      pedidos := pedidos + (res->>'pedidos')::int; estab := estab + (res->>'estabelecimentos')::int; logins := logins + (res->>'logins')::int;
    end if;
  end loop;
  -- restos marcados como teste fora de lotes ativos (nunca dados reais)
  perform set_config('tucai.internal', 'on', true);
  delete from public.orders where is_test;
  get diagnostics n = row_count; pedidos := pedidos + n;
  delete from public.businesses where is_test;
  get diagnostics n = row_count; estab := estab + n;
  res := jsonb_build_object('lotes', lotes, 'pedidos', pedidos, 'estabelecimentos', estab, 'logins', logins);
  perform private.audit('test_data.remove_all', 'test_data_runs', null, res);
  return res;
end $$;

do $$
begin
  revoke all on function private.remove_test_run(uuid) from public, anon, authenticated;
  revoke all on function public.admin_remove_test_data(uuid) from public, anon;
  grant execute on function public.admin_remove_test_data(uuid) to authenticated;
  revoke all on function public.admin_remove_all_test_data(text) from public, anon;
  grant execute on function public.admin_remove_all_test_data(text) to authenticated;
end $$;
