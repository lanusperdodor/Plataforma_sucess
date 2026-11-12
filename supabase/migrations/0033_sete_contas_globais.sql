-- 0033_sete_contas_globais: exatamente sete contas operacionais de teste em TODA a Tucaí (não sete por cidade).
--  * Um único conjunto ativo: Empresário 1 — Lanchonete, Empresário 2 — Supermercado, Funcionário — Lanchonete,
--    Entregador 1 — Independente, Entregador 2 — Próprio, Cliente 1, Cliente 2. Master continua separado.
--  * Criar em outra cidade ou com lote antigo ativo é recusado: o Master usa "Padronizar as 7 contas".
--  * Padronizar remove contas de teste excedentes (lotes antigos: cozinha, prestador, restaurante, lojista, operador,
--    2º entregador independente…) SOMENTE depois de verificar dependências. Se alguma conta de teste tiver vínculo com
--    dado real (estabelecimento real, pedido em loja real, papel administrativo concedido fora do gerador), nada é
--    removido e o Master recebe a lista. Usuários reais nunca entram: só quem está nos lotes de teste.

create or replace function private.test_keys() returns text[] language sql immutable as $$
  select array['empresario1', 'empresario2', 'funcionario', 'entregador', 'entregador2', 'cliente1', 'cliente2']
$$;

-- lote no padrão = formato novo com as sete chaves, nada além delas
create or replace function private.test_run_is_standard(_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select array_agg(distinct l->>'key' order by l->>'key') from private.test_data_runs r, jsonb_array_elements(r.logins) l where r.id = _run)
                  <@ private.test_keys()
              and (select logins @> '[{"key":"empresario1"}]'::jsonb from private.test_data_runs where id = _run), false)
$$;

-- vínculos de uma conta de teste com dados reais (impedem a remoção automática)
create or replace function private.test_user_real_links(_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from public.business_members m join public.businesses b on b.id = m.business_id where m.user_id = _user and not b.is_test)
         then 'vinculada a estabelecimento real' end,
    case when exists (select 1 from public.businesses b where b.owner_id = _user and not b.is_test) then 'dona de estabelecimento real' end,
    case when exists (select 1 from public.orders o join public.businesses b on b.id = o.business_id where o.customer_id = _user and not b.is_test)
         then 'tem pedido em estabelecimento real' end,
    case when exists (select 1 from public.user_roles r where r.user_id = _user and r.role = 'platform_master') then 'é Master' end
  ], null)
$$;

create or replace function public.admin_test_accounts_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare std uuid; n_std int;
begin
  perform private.require_master();
  select id into std from private.test_data_runs r where removed_at is null and private.test_run_is_standard(r.id) order by created_at desc limit 1;
  select count(*) into n_std from private.test_data_runs r where removed_at is null and private.test_run_is_standard(r.id);
  return jsonb_build_object(
    'contas', (select count(distinct u) from private.test_data_runs r, unnest(r.user_ids) u where r.removed_at is null),
    'lotes', (select count(*) from private.test_data_runs where removed_at is null),
    'padrao', n_std = 1 and (select count(*) from private.test_data_runs where removed_at is null) = 1
              and (select jsonb_array_length(logins) from private.test_data_runs where id = std) = 7,
    'cidade', (select c.name || ' - ' || c.state from private.test_data_runs r join public.cities c on c.id = r.city_id where r.id = std),
    'faltando', coalesce((select to_jsonb(array_agg(k)) from unnest(private.test_keys()) k
                           where std is null or not exists (select 1 from private.test_data_runs r, jsonb_array_elements(r.logins) l where r.id = std and l->>'key' = k)), '[]'::jsonb),
    'excedentes', coalesce((select jsonb_agg(jsonb_build_object('label', l->>'label', 'email', l->>'email') order by l->>'label')
                             from private.test_data_runs r, jsonb_array_elements(r.logins) l
                            where r.removed_at is null and (r.id is distinct from std or not (l->>'key' = any(private.test_keys())))), '[]'::jsonb),
    'bloqueios', coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'motivos', to_jsonb(private.test_user_real_links(u.id))))
                            from private.test_data_runs r, unnest(r.user_ids) x join auth.users u on u.id = x
                           where r.removed_at is null and cardinality(private.test_user_real_links(u.id)) > 0), '[]'::jsonb));
end $$;

-- gerador: um único conjunto global
create or replace function public.admin_create_test_data(_city uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; ids uuid[]; b uuid; other record;
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
  return res;
end $$;

-- padronização: remove excedentes (com verificação de dependências) e garante as sete contas na cidade escolhida
create or replace function public.admin_standardize_test_accounts(_city uuid, _confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare keep uuid; run record; res jsonb; lotes int := 0; contas int := 0; blocked jsonb; created jsonb;
begin
  perform private.require_master();
  if upper(btrim(coalesce(_confirm, ''))) <> 'PADRONIZAR' then raise exception 'Digite PADRONIZAR para confirmar.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.cities where id = _city and is_active) then raise exception 'Cidade não encontrada ou inativa.' using errcode = 'P0001'; end if;
  perform private.limit_for('admin.test_data');
  select id into keep from private.test_data_runs r
   where removed_at is null and city_id = _city and private.test_run_is_standard(r.id) order by created_at desc limit 1;
  -- dependências primeiro: se qualquer conta a remover tiver vínculo real, nada é removido
  select jsonb_agg(jsonb_build_object('email', u.email, 'motivos', to_jsonb(private.test_user_real_links(u.id)))) into blocked
    from private.test_data_runs r, unnest(r.user_ids) x join auth.users u on u.id = x
   where r.removed_at is null and r.id is distinct from keep and cardinality(private.test_user_real_links(u.id)) > 0;
  if blocked is not null then
    raise exception 'Padronização cancelada: contas de teste com vínculo real (%). Nada foi removido.', blocked::text using errcode = 'P0001';
  end if;
  for run in select id from private.test_data_runs where removed_at is null and id is distinct from keep order by created_at loop
    res := private.remove_test_run(run.id);
    if res is not null then lotes := lotes + 1; contas := contas + (res->>'logins')::int; end if;
  end loop;
  -- cria as que faltam (ou o conjunto inteiro) na cidade escolhida
  created := public.admin_create_test_data(_city);
  perform private.audit('test_data.standardize', 'test_data_runs', (created->>'run_id'), jsonb_build_object('lotes_removidos', lotes, 'contas_removidas', contas, 'city', _city));
  return jsonb_build_object('lotes_removidos', lotes, 'contas_removidas', contas, 'criadas', created);
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.test_keys()', 'private.test_run_is_standard(uuid)', 'private.test_user_real_links(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.admin_test_accounts_status()', 'public.admin_create_test_data(uuid)', 'public.admin_standardize_test_accounts(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
