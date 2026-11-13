-- 0035_usuarios_teste: as sete contas de teste entram com NOME DE USUÁRIO curto (o login único aceita usuário ou e-mail).
--  * empresario1, empresario2, funcionario, entregador1, entregador2, cliente1, cliente2 — mesma senha para as sete.
--  * Se o nome já estiver em uso por outra pessoa, ganha um sufixo curto (ex.: cliente1.4f2). Nunca altera conta real.
--  * Contas de teste existentes recebem o usuário ao aplicar a migration; ao remover um lote o usuário é liberado.

create or replace function private.test_username_base(_key text) returns text
language sql immutable set search_path = '' as $$
  select case _key when 'entregador' then 'entregador1' else _key end
$$;

-- garante usuário em cada conta do lote (só contas do próprio lote de teste) e devolve os logins com "username"
create or replace function private.assign_test_usernames(_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r private.test_data_runs%rowtype; l jsonb; out jsonb := '[]'::jsonb; uid uuid; cur text; base text; cand text; i int;
begin
  select * into r from private.test_data_runs where id = _run;
  if not found then return '[]'::jsonb; end if;
  for l in select * from jsonb_array_elements(r.logins) loop
    select u.id into uid from auth.users u where lower(u.email) = lower(l->>'email') and u.id = any(r.user_ids);
    if uid is null then out := out || l; continue; end if;
    select username into cur from public.profiles where id = uid;
    if cur is null and l->>'key' is not null then
      base := private.test_username_base(l->>'key');
      i := 0;
      loop
        cand := case when i = 0 then base else base || '.' || substr(md5(uid::text || i), 1, 3) end;
        begin
          if cand ~ '^[a-z0-9._]{3,30}$' and not private.username_reserved(cand) then
            update public.profiles set username = cand where id = uid;
            cur := cand;
            exit;
          end if;
        exception when unique_violation then null;
        end;
        i := i + 1;
        exit when i > 5;
      end loop;
    end if;
    out := out || (l || jsonb_build_object('username', cur));
  end loop;
  update private.test_data_runs set logins = out where id = _run;
  return out;
end $$;

-- gerador (mesmas regras da 0033) + usuários
create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; ids uuid[]; b uuid; other record; all_logins jsonb;
begin
  perform private.require_master();
  select r.id, c.name || ' - ' || c.state as cidade, private.test_run_is_standard(r.id) as std, r.city_id into other
    from private.test_data_runs r left join public.cities c on c.id = r.city_id
   where r.removed_at is null and not (r.city_id = _city and private.test_run_is_standard(r.id))
   order by r.created_at limit 1;
  if found then
    if other.std then
      raise exception 'As 7 contas de teste já existem em %. Use "Padronizar as 7 contas" para levá-las a outra cidade.', coalesce(other.cidade, 'outra cidade') using errcode = 'P0001';
    end if;
    raise exception 'Há contas de teste fora do padrão (lote antigo em %). Use "Padronizar as 7 contas".', coalesce(other.cidade, 'cidade removida') using errcode = 'P0001';
  end if;
  res := private.admin_create_test_data_impl(_city);
  select business_ids into ids from private.test_data_runs where id = (res->>'run_id')::uuid;
  perform private.label_test_businesses(ids);
  for b in select id from public.businesses where id = any(ids) and business_type = 'restaurante' and name like '[Teste] Lanchonete%'
             and not exists (select 1 from private.plan_grants g where g.business_id = businesses.id) loop
    perform public.admin_grant_test_plan(b, 'presencial_delivery', 'Homologação: Lanchonete de teste com todos os recursos');
  end loop;
  all_logins := private.assign_test_usernames((res->>'run_id')::uuid);
  -- devolve os logins criados agora com o usuário; e a lista completa do conjunto (para conferência)
  return res || jsonb_build_object(
    'logins', coalesce((select jsonb_agg(a) from jsonb_array_elements(all_logins) a
                         where exists (select 1 from jsonb_array_elements(res->'logins') n where n->>'email' = a->>'email')), '[]'::jsonb),
    'todos', all_logins);
end $$;

-- remoção de lote: libera o nome de usuário antes de apagar/anonimizar
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
  update public.profiles set username = null where id = any(r.user_ids);
  foreach u in array r.user_ids loop
    begin
      delete from auth.users where id = u;
      if found then n_users := n_users + 1; end if;
    exception when foreign_key_violation then
      perform private.anonymize_user(u);
      update auth.users set banned_until = 'infinity', email = 'removido-' || u::text || '@teste.example.com' where id = u;
      n_users := n_users + 1;
    end;
  end loop;
  update private.test_data_runs set removed_at = now() where id = r.id;
  return jsonb_build_object('pedidos', n_orders, 'estabelecimentos', n_biz, 'logins', n_users);
end $$;

do $$
declare run uuid;
begin
  revoke all on function private.test_username_base(text) from public, anon, authenticated;
  revoke all on function private.assign_test_usernames(uuid) from public, anon, authenticated;
  revoke all on function private.remove_test_run(uuid) from public, anon, authenticated;
  revoke all on function public.admin_create_test_data(uuid) from public, anon;
  grant execute on function public.admin_create_test_data(uuid) to authenticated;
  -- contas de teste que já existem ganham o usuário agora
  for run in select id from private.test_data_runs where removed_at is null and logins @> '[{"key":"empresario1"}]'::jsonb loop
    perform private.assign_test_usernames(run);
  end loop;
end $$;
