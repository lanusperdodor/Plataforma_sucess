-- 0030_manutencao: modo manutenção global, controlado pelo Master (com MFA).
--  Estados: normal → preparando (novas operações bloqueadas; o que já começou pode terminar) → manutencao
--  (bloqueio total para usuários comuns; só concluir entregas em rota e fechar comandas/caixas já abertos) → normal.
--  * Bloqueio NO BANCO: gatilho único (private.maintenance_guard) nas tabelas de escrita — vale para RPCs e para
--    escrita direta pela API. Não depende de esconder telas.
--  * Não bloqueia: Master (MFA), processos do sistema sem usuário (webhook de pagamento via Worker, varreduras),
--    notificações/auditoria/eventos gerados dentro de operações permitidas. Nenhuma transação é interrompida:
--    o gatilho só recusa a próxima gravação; nada é cancelado ou apagado.
--  * Recuperação independente: supabase/admin/manutencao_recuperar.sql (SQL Editor) e /api/health no Worker.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('admin.maintenance', 60, 600)
on conflict (action) do nothing;

create table if not exists private.platform_state (
  id boolean primary key default true check (id),
  mode text not null default 'normal' check (mode in ('normal', 'preparando', 'manutencao')),
  reason text check (reason is null or char_length(reason) <= 300),
  eta timestamptz,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  prepared_at timestamptz,
  started_at timestamptz
);
insert into private.platform_state(id) values (true) on conflict do nothing;
revoke all on private.platform_state from public, anon, authenticated;

create or replace function private.platform_mode() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select mode from private.platform_state where id), 'normal')
$$;

create or replace function private.maintenance_block() returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'A Tucaí está em manutenção. Tente novamente em breve.' using errcode = 'P0001', hint = 'manutencao';
end $$;

-- operações comuns bloqueadas fora do modo normal (para RPCs que não gravam, ex.: abrir checkout)
create or replace function private.require_operational() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.platform_mode() <> 'normal' and auth.uid() is not null and not private.is_master_ok() then
    perform private.maintenance_block();
  end if;
end $$;

create or replace function private.maintenance_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m text := private.platform_mode(); v_full boolean;
begin
  if m = 'normal' or auth.uid() is null or private.is_master_ok() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_full := m = 'manutencao';
  case tg_table_name
    when 'orders' then
      -- sem pedidos novos; em manutenção só avanços que encerram (rota, entregue, retirado, cancelado, recusado)
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;
      if v_full and tg_op = 'UPDATE' and new.status is distinct from old.status
         and new.status::text not in ('out_for_delivery', 'delivered', 'picked_up', 'cancelled', 'rejected') then
        perform private.maintenance_block();
      end if;
    when 'deliveries' then
      -- corridas em andamento continuam (coleta, código, entrega, liberação); em manutenção ninguém assume corrida nova
      if v_full and tg_op = 'UPDATE' and new.status::text = 'accepted' and old.status::text is distinct from 'accepted' then
        perform private.maintenance_block();
      end if;
    when 'business_tabs' then
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;
      if v_full and tg_op = 'UPDATE' and new.status not in ('fechada', 'cancelada') and new.status is distinct from old.status then
        perform private.maintenance_block();
      end if;
    when 'business_tab_items' then
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;
    when 'cash_sessions' then
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;      -- fechar caixa aberto continua possível
    when 'cash_movements' then
      if tg_op = 'INSERT' and new.tab_id is null then perform private.maintenance_block(); end if;  -- só o pagamento ao fechar comanda
    when 'couriers' then
      if tg_op = 'INSERT' then perform private.maintenance_block(); end if;      -- ficar indisponível continua possível
    else
      perform private.maintenance_block();                                       -- novas publicações, cardápio, loja, cobranças…
  end case;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'orders', 'deliveries', 'business_tabs', 'business_tab_items', 'cash_sessions', 'cash_movements', 'couriers',
    'platform_charges', 'ad_campaigns', 'posts', 'post_comments', 'post_likes', 'scraps', 'testimonials', 'community_topics', 'topic_replies',
    'communities', 'community_members', 'poll_votes', 'follows', 'friendships', 'business_follows', 'reviews', 'products', 'menu_categories',
    'option_groups', 'options', 'services', 'business_hours', 'businesses', 'business_members', 'business_tables', 'business_expenses',
    'business_ingredients', 'product_recipe_items', 'business_product_costs', 'jobs', 'job_applications', 'profiles', 'social_profiles'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_maintenance', t);
      execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.maintenance_guard()', t || '_maintenance', t);
    end if;
  end loop;
end $$;

-- checkout de cobrança (Worker) também respeita a manutenção; a confirmação do webhook não passa por aqui
create or replace function public.payable_charge(_charge uuid)
returns table (id uuid, business_id uuid, business_name text, description text, amount_cents integer, kind public.charge_kind)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.require_operational();
  perform private.limit_for('payments.checkout');
  return query
    select ch.id, ch.business_id, b.name, ch.description, ch.amount_cents, ch.kind
      from public.platform_charges ch join public.businesses b on b.id = ch.business_id
     where ch.id = _charge and ch.status = 'aberta'
       and (public.has_business_permission(ch.business_id, 'settings.manage') or public.has_business_permission(ch.business_id, 'reports.view')
            or private.is_master_ok());
end $$;

-- ---------- público: só o necessário para a página de manutenção ----------
create or replace function public.platform_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('mode', s.mode, 'eta', s.eta) from private.platform_state s where s.id
$$;

-- ---------- Master ----------
create or replace function private.maintenance_inflight() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pedidos_abertos', (select count(*) from public.orders where status in ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery')),
    'pedidos_aguardando_aceite', (select count(*) from public.orders where status = 'placed'),
    'entregas_em_rota', (select count(*) from public.deliveries where status in ('accepted', 'picked_up')),
    'comandas_abertas', (select count(*) from public.business_tabs where status in ('aberta', 'aguardando_pagamento')),
    'caixas_abertos', (select count(*) from public.cash_sessions where status = 'aberto'),
    'cobrancas_em_aberto', (select count(*) from public.platform_charges where status = 'aberta'),
    'campanhas_aguardando_pagamento', (select count(*) from public.ad_campaigns where status = 'pendente' and paid_at is null))
$$;

-- verificações de integridade (relatório; não corrige nada sozinho)
create or replace function private.maintenance_integrity() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pedido_em_rota_sem_coleta', (select count(*) from public.orders o join public.deliveries d on d.order_id = o.id
                                   where o.status = 'out_for_delivery' and d.status not in ('picked_up', 'delivered')),
    'entrega_coletada_pedido_inconsistente', (select count(*) from public.deliveries d join public.orders o on o.id = d.order_id
                                               where d.status = 'picked_up' and o.status not in ('out_for_delivery', 'delivered')),
    'comanda_fechada_pagamento_diferente', (select count(*) from public.business_tabs t
                                             where t.status = 'fechada' and coalesce((select sum(amount_cents) from public.cash_movements m where m.tab_id = t.id and m.kind = 'venda'), 0)
                                                   <> private.tab_total(t.id) - t.discount_cents),
    'caixa_aberto_mais_de_24h', (select count(*) from public.cash_sessions where status = 'aberto' and opened_at < now() - interval '24 hours'),
    'campanha_ativa_vencida', (select count(*) from public.ad_campaigns where status = 'ativa' and ends_at <= now()))
$$;

create or replace function public.admin_maintenance_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.platform_state%rowtype;
begin
  perform private.require_master();
  select * into s from private.platform_state where id;
  return jsonb_build_object('mode', s.mode, 'reason', s.reason, 'eta', s.eta, 'changed_at', s.changed_at,
    'changed_by', (select full_name from public.profiles where id = s.changed_by), 'prepared_at', s.prepared_at, 'started_at', s.started_at,
    'em_andamento', private.maintenance_inflight(), 'integridade', private.maintenance_integrity(),
    'mfa', private.current_aal() = 'aal2');
end $$;

-- transições: normal→preparando→manutencao; preparando/manutencao→normal. Exige MFA, motivo e confirmação digitada.
create or replace function public.admin_set_maintenance(_mode text, _reason text, _eta timestamptz, _confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.platform_state%rowtype; r text := nullif(btrim(coalesce(_reason, '')), '');
begin
  perform private.require_master_mfa();
  perform private.limit_for('admin.maintenance');
  select * into s from private.platform_state where id for update;
  if _mode not in ('normal', 'preparando', 'manutencao') then raise exception 'Estado inválido.' using errcode = 'P0001'; end if;
  if _mode = s.mode then raise exception 'A plataforma já está neste estado.' using errcode = 'P0001'; end if;
  if s.mode = 'normal' and _mode = 'manutencao' then
    raise exception 'Passe primeiro por "Preparando manutenção" para as operações em andamento terminarem.' using errcode = 'P0001';
  end if;
  if upper(btrim(coalesce(_confirm, ''))) <> (case when _mode = 'normal' then 'NORMAL' else 'MANUTENCAO' end) then
    raise exception 'Digite % para confirmar.', (case when _mode = 'normal' then 'NORMAL' else 'MANUTENCAO' end) using errcode = 'P0001';
  end if;
  if _mode <> 'normal' and (r is null or char_length(r) < 5) then raise exception 'Informe o motivo (mínimo 5 caracteres).' using errcode = 'P0001'; end if;
  if _eta is not null and _eta <= now() then raise exception 'A previsão de retorno precisa ser no futuro.' using errcode = 'P0001'; end if;
  update private.platform_state set mode = _mode, reason = case when _mode = 'normal' then null else coalesce(r, reason) end,
         eta = case when _mode = 'normal' then null else coalesce(_eta, eta) end, changed_by = auth.uid(), changed_at = now(),
         prepared_at = case when _mode = 'preparando' then now() when _mode = 'normal' then null else prepared_at end,
         started_at = case when _mode = 'manutencao' then now() when _mode = 'normal' then null else started_at end
   where id;
  perform private.audit('platform.maintenance', 'platform_state', _mode, jsonb_build_object('from', s.mode, 'to', _mode, 'reason', r, 'eta', _eta,
    'em_andamento', private.maintenance_inflight()));
  if _mode = 'normal' then perform private.ad_sweep(); end if;
  return jsonb_build_object('mode', _mode, 'em_andamento', private.maintenance_inflight(), 'integridade', private.maintenance_integrity());
end $$;

-- recuperação independente do app (SQL Editor, como postgres): volta ao normal e registra na auditoria
create or replace function private.maintenance_force_normal(_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.platform_state%rowtype;
begin
  select * into s from private.platform_state where id for update;
  update private.platform_state set mode = 'normal', reason = null, eta = null, changed_by = null, changed_at = now(), prepared_at = null, started_at = null where id;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (null, 'platform.maintenance_recovery', 'platform_state', 'normal', jsonb_build_object('from', s.mode, 'reason', coalesce(_reason, 'recuperação manual')));
  return jsonb_build_object('mode', 'normal', 'anterior', s.mode, 'integridade', private.maintenance_integrity());
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.maintenance_force_normal(text)', 'private.platform_mode()', 'private.maintenance_block()', 'private.require_operational()', 'private.maintenance_guard()',
                           'private.maintenance_inflight()', 'private.maintenance_integrity()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  revoke all on function public.platform_status() from public;
  grant execute on function public.platform_status() to anon, authenticated;
  foreach f in array array['public.admin_maintenance_status()', 'public.admin_set_maintenance(text, text, timestamptz, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
