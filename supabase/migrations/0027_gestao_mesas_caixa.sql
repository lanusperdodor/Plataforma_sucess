-- 0027_gestao_mesas_caixa: Tucaí Gestão (atendimento presencial).
--  * Permissões extras por integrante (sem criar cargo novo): "comandas" (tabs.manage) e "caixa" (cash.manage),
--    somadas às do cargo. Ex.: atendente + caixa = operador de caixa.
--  * Mesas (com área, capacidade e QR próprio), comandas com ou sem mesa (balcão), itens com preço do servidor,
--    envio à cozinha, transferências, fechamento com pagamento registrado no caixa. Uma mesa nunca tem duas
--    comandas abertas; operações com identificador para não duplicar; cancelamentos e descontos auditados.
--  * Caixa presencial: turno (um aberto por estabelecimento), saldo inicial, vendas, entradas, saídas, sangrias,
--    suprimentos, fechamento com valor contado e diferença. Registro manual ≠ confirmação eletrônica.
--  * QR da mesa: só identifica mesa e cardápio público; nunca dá acesso administrativo.
--  * Recursos presenciais: Plano Premium (R$ 99), verificado no banco.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('gestao.tabs', 1200, 600), ('gestao.cash', 600, 600), ('gestao.tables', 300, 600)
on conflict (action) do nothing;

insert into public.permissions(code) values ('tabs.manage'), ('cash.manage') on conflict do nothing;
insert into public.role_permissions(member_role, permission) values
  ('owner', 'tabs.manage'), ('owner', 'cash.manage'), ('manager', 'tabs.manage'), ('manager', 'cash.manage'), ('attendant', 'tabs.manage')
on conflict do nothing;

create table if not exists public.business_member_permissions (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission in ('tabs.manage', 'cash.manage', 'reports.view')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id, permission)
);
create index if not exists business_member_permissions_user_idx on public.business_member_permissions(user_id);
create index if not exists business_member_permissions_granted_by_idx on public.business_member_permissions(granted_by);
alter table public.business_member_permissions enable row level security;
drop policy if exists business_member_permissions_select on public.business_member_permissions;
create policy business_member_permissions_select on public.business_member_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_business_permission(business_id, 'staff.manage'));
revoke all on public.business_member_permissions from public, anon, authenticated;
grant select on public.business_member_permissions to authenticated;

-- permissão = cargo + extras do integrante (extras só valem para quem continua na equipe)
create or replace function public.has_business_permission(_business uuid, _permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    join public.role_permissions rp on rp.member_role = m.member_role
    where m.business_id = _business and m.user_id = auth.uid() and rp.permission = _permission)
  or exists (
    select 1 from public.business_member_permissions x
    join public.business_members m on m.business_id = x.business_id and m.user_id = x.user_id
    where x.business_id = _business and x.user_id = auth.uid() and x.permission = _permission)
$$;

create or replace function public.merchant_set_member_permission(_business uuid, _user uuid, _permission text, _granted boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, 'staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('merchant.team');
  if _permission not in ('tabs.manage', 'cash.manage', 'reports.view') then raise exception 'Permissão inválida.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.business_members where business_id = _business and user_id = _user and member_role <> 'owner') then
    raise exception 'Integrante não encontrado.' using errcode = 'P0001';
  end if;
  if _granted then
    insert into public.business_member_permissions(business_id, user_id, permission, granted_by) values (_business, _user, _permission, auth.uid()) on conflict do nothing;
  else
    delete from public.business_member_permissions where business_id = _business and user_id = _user and permission = _permission;
  end if;
  perform private.audit(case when _granted then 'business.member_permission_grant' else 'business.member_permission_revoke' end,
                        'business_member_permissions', _business::text, jsonb_build_object('user', _user, 'permission', _permission));
end $$;

-- ---------- mesas ----------
create table if not exists public.business_tables (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  area text check (area is null or char_length(area) <= 40),
  capacity smallint check (capacity is null or capacity between 1 and 99),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  qr_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists business_tables_business_idx on public.business_tables(business_id, sort_order);

-- ---------- comandas ----------
create table if not exists public.business_tabs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  number integer not null,
  table_id uuid references public.business_tables(id) on delete set null,
  label text check (label is null or char_length(label) <= 60),
  people smallint check (people is null or people between 1 and 99),
  status text not null default 'aberta' check (status in ('aberta', 'aguardando_pagamento', 'fechada', 'cancelada')),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  close_op uuid unique,
  unique (business_id, number)
);
-- uma mesa nunca tem duas comandas abertas
create unique index if not exists business_tabs_table_open_idx on public.business_tabs(table_id) where status in ('aberta', 'aguardando_pagamento') and table_id is not null;
create index if not exists business_tabs_business_idx on public.business_tabs(business_id, status, opened_at desc);
create index if not exists business_tabs_table_idx on public.business_tabs(table_id);
create index if not exists business_tabs_opened_by_idx on public.business_tabs(opened_by);
create index if not exists business_tabs_closed_by_idx on public.business_tabs(closed_by);

create table if not exists public.business_tab_items (
  id uuid primary key default gen_random_uuid(),
  tab_id uuid not null references public.business_tabs(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity smallint not null check (quantity between 1 and 99),
  notes text check (notes is null or char_length(notes) <= 200),
  kitchen_status text not null default 'novo' check (kitchen_status in ('novo', 'em_preparo', 'pronto', 'servido', 'cancelado')),
  add_op uuid,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 200)
);
create unique index if not exists business_tab_items_op_idx on public.business_tab_items(tab_id, add_op, product_id) where add_op is not null;
create index if not exists business_tab_items_tab_idx on public.business_tab_items(tab_id);
create index if not exists business_tab_items_kitchen_idx on public.business_tab_items(business_id, kitchen_status);
create index if not exists business_tab_items_product_idx on public.business_tab_items(product_id);
create index if not exists business_tab_items_added_by_idx on public.business_tab_items(added_by);

-- ---------- caixa ----------
create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  opening_cents integer not null check (opening_cents >= 0),
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  counted_cents integer check (counted_cents is null or counted_cents >= 0),
  expected_cents integer,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 300)
);
create unique index if not exists cash_sessions_open_idx on public.cash_sessions(business_id) where status = 'aberto';
create index if not exists cash_sessions_business_idx on public.cash_sessions(business_id, opened_at desc);
create index if not exists cash_sessions_opened_by_idx on public.cash_sessions(opened_by);
create index if not exists cash_sessions_closed_by_idx on public.cash_sessions(closed_by);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_sessions(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('venda', 'entrada', 'saida', 'sangria', 'suprimento')),
  method text not null check (method in ('dinheiro', 'pix', 'cartao', 'outro')),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  confirmation text not null default 'manual' check (confirmation in ('manual', 'eletronica')),
  tab_id uuid references public.business_tabs(id) on delete set null,
  description text check (description is null or char_length(description) <= 200),
  op_id uuid not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_session_idx on public.cash_movements(session_id, created_at);
create index if not exists cash_movements_business_idx on public.cash_movements(business_id);
create index if not exists cash_movements_tab_idx on public.cash_movements(tab_id);
create index if not exists cash_movements_created_by_idx on public.cash_movements(created_by);

-- leitura direta pela equipe autorizada; toda escrita passa pelas funções
do $$
declare t text; p text;
begin
  foreach t in array array['business_tables', 'business_tabs', 'business_tab_items', 'cash_sessions', 'cash_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    p := case when t like 'cash_%' then 'cash.manage' else 'tabs.manage' end;
    execute format($f$create policy %I on public.%I for select to authenticated using (public.has_business_permission(business_id, %L)
                     or public.has_business_permission(business_id, 'orders.update_status')%s)$f$,
                   t || '_select', t, p, case when t like 'cash_%' then '' else ' or public.has_business_permission(business_id, ''cash.manage'')' end);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function private.require_gestao(_business uuid, _permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_business_permission(_business, _permission) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.require_premium(_business);
end $$;

-- mesas
create or replace function public.gestao_save_table(_business uuid, _id uuid, _name text, _area text, _capacity integer, _active boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  perform private.require_gestao(_business, 'settings.manage');
  perform private.limit_for('gestao.tables');
  if _id is null then
    insert into public.business_tables(business_id, name, area, capacity, is_active, sort_order)
    values (_business, btrim(_name), nullif(btrim(coalesce(_area, '')), ''), _capacity, coalesce(_active, true),
            coalesce((select max(sort_order) + 10 from public.business_tables where business_id = _business), 10))
    returning id into tid;
  else
    update public.business_tables set name = btrim(_name), area = nullif(btrim(coalesce(_area, '')), ''), capacity = _capacity, is_active = coalesce(_active, true)
     where id = _id and business_id = _business returning id into tid;
    if tid is null then raise exception 'Mesa não encontrada.' using errcode = 'P0001'; end if;
  end if;
  perform private.audit('gestao.table_save', 'business_tables', tid::text, jsonb_build_object('name', btrim(_name)));
  return tid;
exception when unique_violation then
  raise exception 'Já existe uma mesa com esse nome.' using errcode = 'P0001';
end $$;

-- cria várias mesas de uma vez ("Mesa 01" … "Mesa N"), sem limite fixo de quantidade
create or replace function public.gestao_create_tables(_business uuid, _count integer, _area text default null, _capacity integer default 4)
returns integer language plpgsql security definer set search_path = '' as $$
declare i int; n int := 0; base int;
begin
  perform private.require_gestao(_business, 'settings.manage');
  perform private.limit_for('gestao.tables');
  if _count is null or _count not between 1 and 300 then raise exception 'Informe de 1 a 300 mesas por vez.' using errcode = 'P0001'; end if;
  select count(*) into base from public.business_tables where business_id = _business;
  for i in 1.._count loop
    insert into public.business_tables(business_id, name, area, capacity, sort_order)
    values (_business, 'Mesa ' || lpad((base + i)::text, 2, '0'), nullif(btrim(coalesce(_area, '')), ''), _capacity, (base + i) * 10)
    on conflict (business_id, name) do nothing;
    n := n + 1;
  end loop;
  perform private.audit('gestao.tables_create', 'business_tables', _business::text, jsonb_build_object('count', _count));
  return n;
end $$;

-- comandas
create or replace function public.gestao_open_tab(_business uuid, _table uuid default null, _label text default null, _people integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; num int;
begin
  perform private.require_gestao(_business, 'tabs.manage');
  perform private.limit_for('gestao.tabs');
  if _table is not null and not exists (select 1 from public.business_tables where id = _table and business_id = _business and is_active) then
    raise exception 'Mesa não encontrada.' using errcode = 'P0001';
  end if;
  if _table is null and nullif(btrim(coalesce(_label, '')), '') is null then
    raise exception 'Comanda de balcão precisa de um nome ou identificação.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('tabs:' || _business::text));
  select coalesce(max(number), 0) + 1 into num from public.business_tabs where business_id = _business;
  insert into public.business_tabs(business_id, number, table_id, label, people, opened_by)
  values (_business, num, _table, nullif(btrim(coalesce(_label, '')), ''), _people, auth.uid()) returning id into tid;
  perform private.audit('gestao.tab_open', 'business_tabs', tid::text, jsonb_build_object('number', num, 'table', _table));
  return tid;
exception when unique_violation then
  raise exception 'Esta mesa já tem uma comanda aberta.' using errcode = 'P0001';
end $$;

-- adicionar itens (preço do cardápio, no servidor); a mesma operação repetida não duplica
create or replace function public.gestao_add_items(_tab uuid, _items jsonb, _op uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype; it jsonb; p public.products%rowtype; qty int; n int := 0;
begin
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'tabs.manage');
  perform private.limit_for('gestao.tabs');
  if t.status <> 'aberta' then raise exception 'A comanda não está aberta para novos itens.' using errcode = 'P0001'; end if;
  if _op is null then raise exception 'Operação inválida.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.business_tab_items where tab_id = _tab and add_op = _op) then return 0; end if;
  if jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) not between 1 and 50 then raise exception 'Informe de 1 a 50 itens.' using errcode = 'P0001'; end if;
  for it in select * from jsonb_array_elements(_items) loop
    select * into p from public.products where id = (it->>'product_id')::uuid and business_id = t.business_id;
    if not found or not p.is_available then raise exception 'Produto indisponível.' using errcode = 'P0001'; end if;
    qty := coalesce((it->>'quantity')::int, 0);
    if qty not between 1 and 99 then raise exception 'Quantidade inválida para %.', p.name using errcode = 'P0001'; end if;
    insert into public.business_tab_items(tab_id, business_id, product_id, name, unit_price_cents, quantity, notes, add_op, added_by)
    values (_tab, t.business_id, p.id, p.name, p.price_cents, qty, nullif(left(btrim(coalesce(it->>'notes', '')), 200), ''), _op, auth.uid());
    n := n + 1;
  end loop;
  update public.business_tabs set last_activity_at = now() where id = _tab;
  return n;
end $$;

-- cozinha/atendimento: novo → em preparo → pronto → servido (ordem obrigatória)
create or replace function public.gestao_item_status(_item uuid, _status text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.business_tab_items%rowtype; ok boolean;
begin
  select * into i from public.business_tab_items where id = _item for update;
  if not found then raise exception 'Item não encontrado.' using errcode = 'P0001'; end if;
  if not (public.has_business_permission(i.business_id, 'tabs.manage') or public.has_business_permission(i.business_id, 'orders.update_status')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_premium(i.business_id);
  ok := (i.kitchen_status = 'novo' and _status = 'em_preparo') or (i.kitchen_status = 'em_preparo' and _status = 'pronto')
     or (i.kitchen_status = 'pronto' and _status = 'servido');
  if not ok then raise exception 'Mudança não permitida (% → %).', i.kitchen_status, _status using errcode = 'P0001'; end if;
  update public.business_tab_items set kitchen_status = _status, updated_at = now() where id = _item;
  update public.business_tabs set last_activity_at = now() where id = i.tab_id;
end $$;

create or replace function public.gestao_cancel_item(_item uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.business_tab_items%rowtype; r text := nullif(btrim(coalesce(_reason, '')), '');
begin
  select * into i from public.business_tab_items where id = _item for update;
  if not found then raise exception 'Item não encontrado.' using errcode = 'P0001'; end if;
  perform private.require_gestao(i.business_id, 'tabs.manage');
  if r is null then raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001'; end if;
  if i.kitchen_status = 'cancelado' then raise exception 'Item já cancelado.' using errcode = 'P0001'; end if;
  if (select status from public.business_tabs where id = i.tab_id) not in ('aberta', 'aguardando_pagamento') then raise exception 'Comanda encerrada.' using errcode = 'P0001'; end if;
  update public.business_tab_items set kitchen_status = 'cancelado', cancel_reason = r, updated_at = now() where id = _item;
  perform private.audit('gestao.item_cancel', 'business_tab_items', _item::text, jsonb_build_object('reason', r, 'item', i.name, 'value', i.unit_price_cents * i.quantity));
end $$;

create or replace function public.gestao_transfer_tab(_tab uuid, _table uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype;
begin
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'tabs.manage');
  if t.status not in ('aberta', 'aguardando_pagamento') then raise exception 'Comanda encerrada.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.business_tables where id = _table and business_id = t.business_id and is_active) then raise exception 'Mesa não encontrada.' using errcode = 'P0001'; end if;
  update public.business_tabs set table_id = _table, last_activity_at = now() where id = _tab;
  perform private.audit('gestao.tab_transfer', 'business_tabs', _tab::text, jsonb_build_object('from', t.table_id, 'to', _table));
exception when unique_violation then
  raise exception 'A mesa de destino já tem uma comanda aberta.' using errcode = 'P0001';
end $$;

-- move itens para outra comanda aberta (com confirmação na tela)
create or replace function public.gestao_transfer_items(_items uuid[], _to_tab uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype; n int;
begin
  select * into t from public.business_tabs where id = _to_tab for update;
  if not found or t.status <> 'aberta' then raise exception 'Comanda de destino não está aberta.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'tabs.manage');
  update public.business_tab_items i set tab_id = _to_tab, updated_at = now()
   where i.id = any(_items) and i.business_id = t.business_id and i.kitchen_status <> 'cancelado'
     and exists (select 1 from public.business_tabs s where s.id = i.tab_id and s.status in ('aberta', 'aguardando_pagamento'));
  get diagnostics n = row_count;
  perform private.audit('gestao.items_transfer', 'business_tabs', _to_tab::text, jsonb_build_object('items', _items, 'moved', n));
  return n;
end $$;

create or replace function private.tab_total(_tab uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(unit_price_cents * quantity), 0)::int from public.business_tab_items where tab_id = _tab and kitchen_status <> 'cancelado'
$$;

create or replace function public.gestao_request_close(_tab uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype;
begin
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'tabs.manage');
  if t.status <> 'aberta' then raise exception 'A comanda não está aberta.' using errcode = 'P0001'; end if;
  update public.business_tabs set status = 'aguardando_pagamento', last_activity_at = now() where id = _tab;
end $$;

-- fechar: soma os pagamentos (registro manual no caixa aberto); total − desconto precisa bater
create or replace function public.gestao_close_tab(_tab uuid, _payments jsonb, _discount_cents integer, _op uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype; s public.cash_sessions%rowtype; total int; due int; paid int := 0; p jsonb; i int := 0;
begin
  if _op is null then raise exception 'Operação inválida.' using errcode = 'P0001'; end if;
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'cash.manage');
  perform private.limit_for('gestao.cash');
  if t.status = 'fechada' and t.close_op = _op then return jsonb_build_object('status', 'ja_fechada'); end if;
  if t.status not in ('aberta', 'aguardando_pagamento') then raise exception 'Comanda já encerrada.' using errcode = 'P0001'; end if;
  select * into s from public.cash_sessions where business_id = t.business_id and status = 'aberto';
  if not found then raise exception 'Abra o caixa antes de receber.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.business_tab_items where tab_id = _tab and kitchen_status in ('novo', 'em_preparo')) then
    raise exception 'Ainda há itens na cozinha. Sirva ou cancele antes de fechar.' using errcode = 'P0001';
  end if;
  total := private.tab_total(_tab);
  if coalesce(_discount_cents, 0) < 0 or coalesce(_discount_cents, 0) > total then raise exception 'Desconto inválido.' using errcode = 'P0001'; end if;
  due := total - coalesce(_discount_cents, 0);
  if jsonb_typeof(_payments) <> 'array' then raise exception 'Pagamentos inválidos.' using errcode = 'P0001'; end if;
  for p in select * from jsonb_array_elements(_payments) loop
    if (p->>'method') not in ('dinheiro', 'pix', 'cartao', 'outro') or coalesce((p->>'amount_cents')::int, 0) <= 0 then
      raise exception 'Pagamento inválido.' using errcode = 'P0001';
    end if;
    paid := paid + (p->>'amount_cents')::int;
  end loop;
  if paid <> due then raise exception 'Os pagamentos (R$ %) precisam somar o total a pagar (R$ %).', to_char(paid / 100.0, 'FM999990D00'), to_char(due / 100.0, 'FM999990D00') using errcode = 'P0001'; end if;
  for p in select * from jsonb_array_elements(_payments) loop
    i := i + 1;
    insert into public.cash_movements(session_id, business_id, kind, method, amount_cents, confirmation, tab_id, description, op_id, created_by)
    values (s.id, t.business_id, 'venda', p->>'method', (p->>'amount_cents')::int, 'manual', _tab, 'Comanda #' || t.number,
            (substr(md5(_op::text || ':' || i), 1, 8) || '-' || substr(md5(_op::text || ':' || i), 9, 4) || '-' || substr(md5(_op::text || ':' || i), 13, 4) || '-' ||
             substr(md5(_op::text || ':' || i), 17, 4) || '-' || substr(md5(_op::text || ':' || i), 21, 12))::uuid, auth.uid());
  end loop;
  update public.business_tabs set status = 'fechada', discount_cents = coalesce(_discount_cents, 0), closed_by = auth.uid(), closed_at = now(), close_op = _op
   where id = _tab;
  perform private.audit('gestao.tab_close', 'business_tabs', _tab::text, jsonb_build_object('total', total, 'discount', coalesce(_discount_cents, 0), 'paid', paid));
  return jsonb_build_object('status', 'fechada', 'total_cents', total, 'pago_cents', paid);
end $$;

create or replace function public.gestao_cancel_tab(_tab uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.business_tabs%rowtype; r text := nullif(btrim(coalesce(_reason, '')), '');
begin
  select * into t from public.business_tabs where id = _tab for update;
  if not found then raise exception 'Comanda não encontrada.' using errcode = 'P0001'; end if;
  perform private.require_gestao(t.business_id, 'cash.manage');
  if r is null then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  if t.status not in ('aberta', 'aguardando_pagamento') then raise exception 'Comanda já encerrada.' using errcode = 'P0001'; end if;
  update public.business_tabs set status = 'cancelada', closed_by = auth.uid(), closed_at = now() where id = _tab;
  perform private.audit('gestao.tab_cancel', 'business_tabs', _tab::text, jsonb_build_object('reason', r, 'total', private.tab_total(_tab)));
end $$;

-- quadro de mesas: situação calculada no banco
create or replace function public.gestao_board(_business uuid)
returns table (table_id uuid, table_name text, area text, capacity smallint, tab_id uuid, tab_number integer, tab_label text, people smallint,
               tab_status text, situation text, opened_at timestamptz, last_activity_at timestamptz, opened_by_name text,
               total_cents integer, items_count bigint, pending_kitchen bigint, ready_items bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_business_permission(_business, 'tabs.manage') or public.has_business_permission(_business, 'cash.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.require_premium(_business);
  return query
    with tabs as (
      select t.*, private.tab_total(t.id) as total,
             (select count(*) from public.business_tab_items i where i.tab_id = t.id and i.kitchen_status <> 'cancelado') as n_items,
             (select count(*) from public.business_tab_items i where i.tab_id = t.id and i.kitchen_status in ('novo', 'em_preparo')) as n_kitchen,
             (select count(*) from public.business_tab_items i where i.tab_id = t.id and i.kitchen_status = 'pronto') as n_ready
        from public.business_tabs t where t.business_id = _business and t.status in ('aberta', 'aguardando_pagamento'))
    select bt.id, bt.name, bt.area, bt.capacity, x.id, x.number, x.label, x.people, x.status,
           case when x.id is null then 'livre' when x.status = 'aguardando_pagamento' then 'aguardando_pagamento'
                when x.n_ready > 0 then 'pronto' when x.n_kitchen > 0 then 'em_preparo' else 'ocupada' end,
           x.opened_at, x.last_activity_at, p.full_name, coalesce(x.total, 0), coalesce(x.n_items, 0), coalesce(x.n_kitchen, 0), coalesce(x.n_ready, 0)
      from public.business_tables bt
      left join tabs x on x.table_id = bt.id
      left join public.profiles p on p.id = x.opened_by
     where bt.business_id = _business and bt.is_active
    union all
    select null, null, null, null, x.id, x.number, x.label, x.people, x.status,
           case when x.status = 'aguardando_pagamento' then 'aguardando_pagamento' when x.n_ready > 0 then 'pronto'
                when x.n_kitchen > 0 then 'em_preparo' else 'ocupada' end,
           x.opened_at, x.last_activity_at, p.full_name, x.total, x.n_items, x.n_kitchen, x.n_ready
      from tabs x left join public.profiles p on p.id = x.opened_by where x.table_id is null
     order by 2 nulls last, 6;
end $$;

-- cozinha unificada: delivery/retirada (pedidos) + mesa/balcão (comandas)
create or replace function public.gestao_kitchen(_business uuid)
returns table (origin text, ref_id uuid, ref_label text, item_id uuid, item_name text, quantity integer, notes text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_business_permission(_business, 'orders.update_status') or public.has_business_permission(_business, 'tabs.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select case o.fulfillment when 'pickup' then 'retirada' else 'delivery' end, o.id, 'Pedido #' || o.code, i.id, i.name, i.quantity::int, i.notes,
           o.status::text, o.created_at
      from public.orders o join public.order_items i on i.order_id = o.id
     where o.business_id = _business and o.status in ('accepted', 'preparing')
    union all
    select case when t.table_id is null then 'balcao' else 'mesa' end, t.id,
           coalesce(bt.name || ' — ', 'Balcão — ') || 'Comanda #' || lpad(t.number::text, 3, '0'), i.id, i.name, i.quantity::int, i.notes,
           i.kitchen_status, i.created_at
      from public.business_tab_items i join public.business_tabs t on t.id = i.tab_id left join public.business_tables bt on bt.id = t.table_id
     where i.business_id = _business and i.kitchen_status in ('novo', 'em_preparo', 'pronto') and t.status in ('aberta', 'aguardando_pagamento')
       and public.business_has_premium(_business)
     order by 9;
end $$;

-- caixa
create or replace function public.gestao_open_cash(_business uuid, _opening_cents integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  perform private.require_gestao(_business, 'cash.manage');
  perform private.limit_for('gestao.cash');
  if _opening_cents is null or _opening_cents < 0 then raise exception 'Informe o saldo inicial.' using errcode = 'P0001'; end if;
  insert into public.cash_sessions(business_id, opening_cents, opened_by) values (_business, _opening_cents, auth.uid()) returning id into sid;
  perform private.audit('gestao.cash_open', 'cash_sessions', sid::text, jsonb_build_object('opening', _opening_cents));
  return sid;
exception when unique_violation then
  raise exception 'O caixa já está aberto.' using errcode = 'P0001';
end $$;

create or replace function public.gestao_cash_movement(_business uuid, _kind text, _method text, _amount_cents integer, _description text, _op uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.cash_sessions%rowtype; mid uuid;
begin
  perform private.require_gestao(_business, 'cash.manage');
  perform private.limit_for('gestao.cash');
  if _kind not in ('venda', 'entrada', 'saida', 'sangria', 'suprimento') then raise exception 'Tipo inválido.' using errcode = 'P0001'; end if;
  -- saídas e sangrias são sensíveis: só quem gerencia a loja (proprietário/gerente)
  if _kind in ('saida', 'sangria') and not public.has_business_permission(_business, 'reports.view') then
    raise exception 'Saídas e sangrias exigem autorização do gerente ou proprietário.' using errcode = '42501';
  end if;
  if _kind in ('saida', 'sangria') and nullif(btrim(coalesce(_description, '')), '') is null then raise exception 'Descreva o motivo.' using errcode = 'P0001'; end if;
  select * into s from public.cash_sessions where business_id = _business and status = 'aberto';
  if not found then raise exception 'O caixa está fechado.' using errcode = 'P0001'; end if;
  select id into mid from public.cash_movements where op_id = _op;
  if mid is not null then return mid; end if;
  insert into public.cash_movements(session_id, business_id, kind, method, amount_cents, description, op_id, created_by)
  values (s.id, _business, _kind, _method, _amount_cents, nullif(btrim(coalesce(_description, '')), ''), _op, auth.uid()) returning id into mid;
  perform private.audit('gestao.cash_' || _kind, 'cash_movements', mid::text, jsonb_build_object('amount', _amount_cents, 'method', _method));
  return mid;
end $$;

create or replace function private.cash_expected(_session uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (s.opening_cents + coalesce(sum(case when m.method = 'dinheiro' and m.kind in ('venda', 'entrada', 'suprimento') then m.amount_cents
                                              when m.method = 'dinheiro' and m.kind in ('saida', 'sangria') then -m.amount_cents else 0 end), 0))::int
    from public.cash_sessions s left join public.cash_movements m on m.session_id = s.id where s.id = _session group by s.opening_cents
$$;

create or replace function public.gestao_close_cash(_business uuid, _counted_cents integer, _notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.cash_sessions%rowtype; expected int;
begin
  perform private.require_gestao(_business, 'cash.manage');
  perform private.limit_for('gestao.cash');
  select * into s from public.cash_sessions where business_id = _business and status = 'aberto' for update;
  if not found then raise exception 'O caixa já está fechado.' using errcode = 'P0001'; end if;
  if _counted_cents is null or _counted_cents < 0 then raise exception 'Informe o valor contado em dinheiro.' using errcode = 'P0001'; end if;
  expected := private.cash_expected(s.id);
  update public.cash_sessions set status = 'fechado', counted_cents = _counted_cents, expected_cents = expected, closed_by = auth.uid(), closed_at = now(),
         notes = nullif(btrim(coalesce(_notes, '')), '') where id = s.id;
  perform private.audit('gestao.cash_close', 'cash_sessions', s.id::text, jsonb_build_object('expected', expected, 'counted', _counted_cents));
  return public.gestao_cash_report(s.id);
end $$;

create or replace function public.gestao_cash_report(_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.cash_sessions%rowtype;
begin
  select * into s from public.cash_sessions where id = _session;
  if not found or not public.has_business_permission(s.business_id, 'cash.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at, 'opening_cents', s.opening_cents,
    'opened_by', (select full_name from public.profiles where id = s.opened_by), 'closed_by', (select full_name from public.profiles where id = s.closed_by),
    'expected_cash_cents', coalesce(s.expected_cents, private.cash_expected(s.id)), 'counted_cents', s.counted_cents,
    'difference_cents', case when s.counted_cents is null then null else s.counted_cents - coalesce(s.expected_cents, private.cash_expected(s.id)) end,
    'by_kind', coalesce((select jsonb_object_agg(kind, total) from (select kind, sum(amount_cents) as total from public.cash_movements where session_id = s.id group by kind) x), '{}'::jsonb),
    'by_method', coalesce((select jsonb_object_agg(method, total) from (select method, sum(amount_cents) as total from public.cash_movements where session_id = s.id and kind = 'venda' group by method) x), '{}'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'method', m.method, 'amount_cents', m.amount_cents, 'description', m.description,
                                  'confirmation', m.confirmation, 'at', m.created_at, 'by', p.full_name) order by m.created_at)
                             from public.cash_movements m left join public.profiles p on p.id = m.created_by where m.session_id = s.id), '[]'::jsonb));
end $$;

create or replace function public.gestao_cash_status(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.cash_sessions%rowtype;
begin
  if not public.is_business_member(_business) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.cash_sessions where business_id = _business and status = 'aberto';
  if not found then return jsonb_build_object('open', false); end if;
  return jsonb_build_object('open', true, 'session_id', s.id, 'opened_at', s.opened_at,
                            'opened_by', (select full_name from public.profiles where id = s.opened_by));
end $$;

-- QR da mesa: identifica mesa e cardápio público; nada administrativo
create or replace function public.table_by_qr(_token uuid)
returns table (business_slug text, business_name text, business_type public.business_type, table_name text)
language sql stable security definer set search_path = '' as $$
  select b.slug, b.name, b.business_type, t.name
    from public.business_tables t join public.businesses b on b.id = t.business_id
   where t.qr_token = _token and t.is_active and b.status = 'active' and not b.is_demo
     and (not b.is_test or public.viewer_sees_tests())
$$;

-- tempo real para a equipe (RLS das tabelas vale para o canal)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['business_tabs', 'business_tab_items', 'cash_sessions', 'cash_movements', 'business_tables'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['private.require_gestao(uuid, text)', 'private.tab_total(uuid)', 'private.cash_expected(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.merchant_set_member_permission(uuid, uuid, text, boolean)', 'public.gestao_save_table(uuid, uuid, text, text, integer, boolean)',
    'public.gestao_create_tables(uuid, integer, text, integer)', 'public.gestao_open_tab(uuid, uuid, text, integer)',
    'public.gestao_add_items(uuid, jsonb, uuid)', 'public.gestao_item_status(uuid, text)', 'public.gestao_cancel_item(uuid, text)',
    'public.gestao_transfer_tab(uuid, uuid)', 'public.gestao_transfer_items(uuid[], uuid)', 'public.gestao_request_close(uuid)',
    'public.gestao_close_tab(uuid, jsonb, integer, uuid)', 'public.gestao_cancel_tab(uuid, text)', 'public.gestao_board(uuid)',
    'public.gestao_kitchen(uuid)', 'public.gestao_open_cash(uuid, integer)', 'public.gestao_cash_movement(uuid, text, text, integer, text, uuid)',
    'public.gestao_close_cash(uuid, integer, text)', 'public.gestao_cash_report(uuid)', 'public.gestao_cash_status(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function public.table_by_qr(uuid) from public;
  grant execute on function public.table_by_qr(uuid) to anon, authenticated;
end $$;
