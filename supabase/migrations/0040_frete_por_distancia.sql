-- 0040_frete_por_distancia: frete da entrega parceira pela distância REAL por ruas, com a tabela aprovada pelo responsável.
--
--   Distância por ruas | Entregador | Tucaí | Custo total | Cliente | Loja | Falta (subsídio da Tucaí)
--   até 1,5 km         | R$ 5       | R$ 1  | R$ 6        | R$ 4    | R$ 2 | —
--   1,5 a 3 km         | R$ 6       | R$ 1  | R$ 7        | R$ 5    | R$ 2 | —
--   3 a 5 km           | R$ 7       | R$ 1  | R$ 8        | R$ 5    | R$ 2 | R$ 1
--   acima de 5 km      | sem entrega parceira até o Master criar uma faixa
--
-- Regras: custo total = ganho do entregador + taxa da Tucaí. A loja paga até o limite dela (R$ 2), o cliente o restante até
-- o limite dele (R$ 5); o que faltar é SUBSÍDIO EXPLÍCITO da Tucaí (registrado no pedido). O entregador nunca recebe menos.
-- Frete grátis (promoção da loja): cliente R$ 0 e a loja paga o custo total. Entrega própria da loja não usa as faixas.
--
-- Como a distância chega: o Worker calcula a rota por ruas (chave do provedor só no servidor) e grava uma COTAÇÃO com a chave
-- de integração (nunca com o login do usuário). Um gatilho em orders aplica a última cotação válida do próprio cliente para
-- aquela loja no momento do pedido: o navegador não envia valores. Sem cotação: se o Master exigir cálculo, o pedido é
-- recusado; senão vale a 1ª faixa (a regra que existia até aqui).
--
-- Acerto financeiro: o cliente paga na entrega e o entregador repassa o total à loja. Na cobrança mensal da Tucaí à loja
-- entram, além da comissão, o frete recebido dos clientes nas entregas parceiras + a parte da loja, e a taxa das entregas
-- próprias. A Tucaí paga o entregador pela carteira (0036) e fica com a taxa (menos o subsídio, quando houver).

-- ---------- configuração versionada (Master edita sem mexer no código) ----------
create table if not exists public.delivery_pricing (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  bands jsonb not null,                 -- [{ "ate_m": 1500, "entregador_cents": 500 }, ...] em ordem crescente
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  customer_max_cents integer not null check (customer_max_cents >= 0),
  merchant_max_cents integer not null check (merchant_max_cents >= 0),
  require_quote boolean not null default false,   -- true: entrega parceira só com distância calculada
  is_current boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(bands) = 'array' and jsonb_array_length(bands) between 1 and 10)
);
create unique index if not exists delivery_pricing_current_idx on public.delivery_pricing(is_current) where is_current;
create index if not exists delivery_pricing_created_by_idx on public.delivery_pricing(created_by);
alter table public.delivery_pricing enable row level security;
drop policy if exists delivery_pricing_read on public.delivery_pricing;
create policy delivery_pricing_read on public.delivery_pricing for select to anon, authenticated using (is_current);
revoke all on public.delivery_pricing from public, anon, authenticated;
grant select on public.delivery_pricing to anon, authenticated;   -- tabela de frete é pública (cliente vê antes de pedir)

insert into public.delivery_pricing(version, bands, platform_fee_cents, customer_max_cents, merchant_max_cents, require_quote, is_current)
select 1, '[{"ate_m":1500,"entregador_cents":500},{"ate_m":3000,"entregador_cents":600},{"ate_m":5000,"entregador_cents":700}]'::jsonb,
       100, 500, 200, false, true
 where not exists (select 1 from public.delivery_pricing);

-- divisão do custo de uma corrida (null = fora da área de entrega parceira)
create or replace function private.delivery_split(_distance_m integer, _free boolean, _cfg public.delivery_pricing) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare band jsonb; courier int; cost int; merchant int; customer int; i int := 0;
begin
  if _distance_m is null or _distance_m < 0 then return null; end if;
  for band in select * from jsonb_array_elements(_cfg.bands) loop
    i := i + 1;
    if _distance_m <= (band->>'ate_m')::int then
      courier := (band->>'entregador_cents')::int;
      exit;
    end if;
  end loop;
  if courier is null then return null; end if;
  cost := courier + _cfg.platform_fee_cents;
  if _free then
    merchant := cost; customer := 0;
  else
    merchant := least(_cfg.merchant_max_cents, cost);
    customer := least(_cfg.customer_max_cents, cost - merchant);
  end if;
  return jsonb_build_object('faixa', i, 'distancia_m', _distance_m, 'entregador_cents', courier, 'tucai_cents', _cfg.platform_fee_cents,
                            'custo_cents', cost, 'cliente_cents', customer, 'loja_cents', merchant,
                            'subsidio_cents', cost - merchant - customer, 'frete_gratis', _free, 'versao', _cfg.version);
end $$;

-- ---------- pedido: novas colunas (snapshot imutável) e promoção da loja ----------
alter table public.businesses add column if not exists free_delivery boolean not null default false;
alter table public.orders add column if not exists delivery_distance_m integer check (delivery_distance_m is null or delivery_distance_m >= 0);
alter table public.orders add column if not exists delivery_band smallint;
alter table public.orders add column if not exists delivery_subsidy_cents integer not null default 0 check (delivery_subsidy_cents >= 0);
alter table public.orders add column if not exists delivery_quote_id uuid;

-- ---------- cotações (gravadas só pelo Worker) ----------
create table if not exists public.delivery_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  lat numeric(8, 5) not null check (lat between -34 and 6),
  lng numeric(8, 5) not null check (lng between -74 and -34),
  distance_m integer not null check (distance_m >= 0),
  duration_s integer not null check (duration_s >= 0),
  provider text not null check (char_length(provider) <= 40),
  split jsonb,                                  -- null = fora da área
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz
);
create index if not exists delivery_quotes_customer_idx on public.delivery_quotes(customer_id, business_id, created_at desc);
create index if not exists delivery_quotes_business_idx on public.delivery_quotes(business_id);
alter table public.delivery_quotes enable row level security;
drop policy if exists delivery_quotes_own on public.delivery_quotes;
create policy delivery_quotes_own on public.delivery_quotes for select to authenticated using (customer_id = (select auth.uid()));
revoke all on public.delivery_quotes from public, anon, authenticated;
grant select on public.delivery_quotes to authenticated;

-- Worker: grava a cotação calculada por ruas (só com a chave de integração)
create or replace function public.worker_store_delivery_quote(_key text, _customer uuid, _business uuid, _lat numeric, _lng numeric,
                                                              _distance_m integer, _duration_s integer, _provider text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.businesses%rowtype; cfg public.delivery_pricing%rowtype; s jsonb; q uuid;
begin
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into b from public.businesses where id = _business;
  if not found or b.status <> 'active' or b.delivery_offer <> 'partner' then raise exception 'Este estabelecimento não usa entregador parceiro.' using errcode = 'P0001'; end if;
  if (select count(*) from public.delivery_quotes where customer_id = _customer and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Muitos cálculos de frete em pouco tempo. Aguarde alguns minutos.' using errcode = 'P0001';
  end if;
  select * into cfg from public.delivery_pricing where is_current;
  s := private.delivery_split(greatest(_distance_m, 0), b.free_delivery, cfg);
  insert into public.delivery_quotes(customer_id, business_id, lat, lng, distance_m, duration_s, provider, split)
  values (_customer, _business, round(_lat, 5), round(_lng, 5), greatest(_distance_m, 0), greatest(_duration_s, 0), left(coalesce(_provider, '?'), 40), s)
  returning id into q;
  return jsonb_build_object('quote_id', q, 'fora_da_area', s is null, 'distancia_m', greatest(_distance_m, 0), 'duracao_s', greatest(_duration_s, 0),
                            'split', s, 'expira_em', now() + interval '15 minutes');
end $$;

-- Worker: coordenadas da loja (para calcular a rota) — só com a chave de integração
create or replace function public.worker_business_point(_key text, _business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.businesses%rowtype;
begin
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into b from public.businesses where id = _business and status = 'active';
  if not found then raise exception 'Estabelecimento indisponível.' using errcode = 'P0001'; end if;
  return jsonb_build_object('lat', b.lat, 'lng', b.lng, 'delivery_offer', b.delivery_offer);
end $$;

-- ---------- gatilho: aplica a distância no pedido (o navegador não envia valores) ----------
create or replace function private.apply_delivery_distance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg public.delivery_pricing%rowtype; q public.delivery_quotes%rowtype; s jsonb; free boolean;
begin
  if new.fulfillment <> 'delivery_partner' then return new; end if;
  select * into cfg from public.delivery_pricing where is_current;
  if not found then return new; end if;
  select coalesce(b.free_delivery, false) into free from public.businesses b where b.id = new.business_id;
  select * into q from public.delivery_quotes
   where customer_id = new.customer_id and business_id = new.business_id and used_at is null and expires_at > now()
   order by created_at desc limit 1;
  if q.id is not null then
    if q.split is null then raise exception 'Seu endereço está fora da área de entrega parceira desta loja (acima do limite de distância).' using errcode = 'P0001'; end if;
    s := private.delivery_split(q.distance_m, free, cfg);   -- recalculado com a configuração vigente
    if s is null then raise exception 'Seu endereço está fora da área de entrega parceira desta loja.' using errcode = 'P0001'; end if;
    update public.delivery_quotes set used_at = now() where id = q.id;
    new.delivery_quote_id := q.id;
    new.delivery_distance_m := q.distance_m;
    new.delivery_lat := q.lat;
    new.delivery_lng := q.lng;
  elsif cfg.require_quote then
    raise exception 'Marque o local de entrega para calcularmos o frete pela distância.' using errcode = 'P0001';
  else
    s := private.delivery_split(0, free, cfg);   -- sem distância calculada: 1ª faixa (regra anterior)
  end if;
  new.delivery_band := (s->>'faixa')::smallint;
  new.delivery_fee_cents := (s->>'cliente_cents')::int;
  new.merchant_delivery_contribution_cents := (s->>'loja_cents')::int;
  new.courier_pay_cents := (s->>'entregador_cents')::int;
  new.platform_delivery_fee_cents := (s->>'tucai_cents')::int;
  new.delivery_subsidy_cents := (s->>'subsidio_cents')::int;
  new.total_cents := new.subtotal_cents + new.delivery_fee_cents - coalesce(new.discount_cents, 0);
  new.pricing_snapshot := coalesce(new.pricing_snapshot, '{}'::jsonb) || jsonb_build_object('frete', s);
  if new.change_for_cents is not null and new.change_for_cents < new.total_cents then
    raise exception 'O valor para troco precisa ser maior que o total (com o frete de R$ %).', to_char(new.delivery_fee_cents / 100.0, 'FM999990D00') using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.apply_delivery_distance() from public, anon, authenticated;
drop trigger if exists orders_apply_delivery_distance on public.orders;
create trigger orders_apply_delivery_distance before insert on public.orders for each row execute function private.apply_delivery_distance();

-- ---------- cobrança da Tucaí à loja: comissão + frete repassado + parte da loja + taxa das entregas próprias ----------
-- (a RECEITA da Tucaí continua em private.platform_fees: comissão + taxa por entrega; aqui é o valor a cobrar da loja)
create or replace function private.store_charge_total(_business uuid, _from timestamptz, _to timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(o.commission_cents
           + case when o.fulfillment = 'delivery_partner' then o.delivery_fee_cents + o.merchant_delivery_contribution_cents
                  when o.fulfillment = 'delivery_own' then o.platform_delivery_fee_cents else 0 end), 0)::int
    from public.orders o
   where o.business_id = _business and o.status in ('delivered', 'picked_up') and not o.is_test
     and o.updated_at >= _from and o.updated_at < _to
$$;
revoke all on function private.store_charge_total(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.admin_charge_commission(_business uuid, _month date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ref date := date_trunc('month', _month)::date; f timestamptz; t timestamptz; total int; cid uuid;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  if ref >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Gere a comissão só de meses já encerrados.' using errcode = 'P0001';
  end if;
  f := ref::timestamp at time zone 'America/Sao_Paulo';
  t := (ref + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';
  total := private.store_charge_total(_business, f, t);
  if total <= 0 then raise exception 'Sem comissão ou taxas neste mês.' using errcode = 'P0001'; end if;
  insert into public.platform_charges(business_id, kind, description, amount_cents, due_on, reference_month, created_by)
  values (_business, 'comissao', 'Comissão, frete das entregas parceiras e taxas de ' || to_char(ref, 'MM/YYYY'), total, current_date + 7, ref, auth.uid())
  returning id into cid;
  perform private.audit('finance.charge', 'platform_charges', cid::text, jsonb_build_object('kind', 'comissao', 'month', ref, 'total', total));
  return cid;
exception when unique_violation then
  raise exception 'A comissão deste mês já foi gerada.' using errcode = 'P0001';
end $$;

-- ---------- Master: tabela de frete (nova versão a cada mudança; pedidos antigos guardam a versão deles) ----------
create or replace function public.delivery_pricing_current() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('versao', version, 'faixas', bands, 'tucai_cents', platform_fee_cents, 'cliente_max_cents', customer_max_cents,
                            'loja_max_cents', merchant_max_cents, 'exige_cotacao', require_quote, 'atualizado_em', created_at,
                            'tabela', (select jsonb_agg(private.delivery_split(least((b->>'ate_m')::int, (b->>'ate_m')::int), false, p) order by (b->>'ate_m')::int)
                                         from jsonb_array_elements(bands) b))
    from public.delivery_pricing p where is_current
$$;

create or replace function public.admin_set_delivery_pricing(_bands jsonb, _platform_fee_cents integer, _customer_max_cents integer,
                                                              _merchant_max_cents integer, _require_quote boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare b jsonb; prev int := 0; v int;
begin
  perform private.require_master_mfa();
  perform private.limit_for('admin.finance');
  if jsonb_typeof(_bands) <> 'array' or jsonb_array_length(_bands) not between 1 and 10 then raise exception 'Informe de 1 a 10 faixas.' using errcode = 'P0001'; end if;
  for b in select * from jsonb_array_elements(_bands) loop
    if (b->>'ate_m') !~ '^[0-9]+$' or (b->>'entregador_cents') !~ '^[0-9]+$' then raise exception 'Faixa inválida.' using errcode = 'P0001'; end if;
    if (b->>'ate_m')::int <= prev or (b->>'ate_m')::int > 50000 then raise exception 'As distâncias das faixas precisam crescer (até 50 km).' using errcode = 'P0001'; end if;
    if (b->>'entregador_cents')::int < 100 or (b->>'entregador_cents')::int > 20000 then raise exception 'Ganho do entregador entre R$ 1 e R$ 200.' using errcode = 'P0001'; end if;
    prev := (b->>'ate_m')::int;
  end loop;
  if _platform_fee_cents not between 0 and 2000 or _customer_max_cents not between 0 and 5000 or _merchant_max_cents not between 0 and 5000 then
    raise exception 'Valores fora dos limites.' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into v from public.delivery_pricing;
  update public.delivery_pricing set is_current = false where is_current;
  insert into public.delivery_pricing(version, bands, platform_fee_cents, customer_max_cents, merchant_max_cents, require_quote, is_current, created_by)
  values (v, _bands, _platform_fee_cents, _customer_max_cents, _merchant_max_cents, coalesce(_require_quote, false), true, auth.uid());
  perform private.audit('finance.delivery_pricing', 'delivery_pricing', v::text,
                        jsonb_build_object('faixas', _bands, 'tucai', _platform_fee_cents, 'cliente_max', _customer_max_cents, 'loja_max', _merchant_max_cents, 'exige_cotacao', _require_quote));
  return v;
end $$;

-- loja liga/desliga frete grátis (assume o custo total da entrega parceira)
create or replace function public.merchant_set_free_delivery(_business uuid, _on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_business_permission(_business, 'store.customize') or public.has_business_permission(_business, 'settings.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform set_config('tucai.internal', 'on', true);
  update public.businesses set free_delivery = coalesce(_on, false) where id = _business;
  perform private.audit('business.free_delivery', 'businesses', _business::text, jsonb_build_object('on', _on));
end $$;

-- Master: receita, valores por corrida e subsídios (substitui a da 0036 acrescentando subsídio e faixas)
create or replace function public.admin_delivery_money(_from date, _to date, _include_test boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f timestamptz := (_from::timestamp at time zone 'America/Sao_Paulo');
        t timestamptz := ((_to + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  perform private.require_permission('finance.view');
  if _from is null or _to is null or _to < _from or _to - _from > 366 then raise exception 'Período inválido (até 1 ano).' using errcode = 'P0001'; end if;
  return (
    with o as (
      select o.* from public.orders o
       where o.status = 'delivered' and o.updated_at >= f and o.updated_at < t and (_include_test or not o.is_test)
         and o.fulfillment in ('delivery_partner', 'delivery_own')),
    w as (select * from public.courier_withdrawals where (_include_test or not is_test))
    select jsonb_build_object(
      'entregas_parceiras', (select count(*) from o where fulfillment = 'delivery_partner'),
      'clientes_pagaram_cents', coalesce((select sum(delivery_fee_cents) from o where fulfillment = 'delivery_partner'), 0),
      'lojas_pagaram_cents', coalesce((select sum(merchant_delivery_contribution_cents) from o where fulfillment = 'delivery_partner'), 0),
      'entregadores_ganharam_cents', coalesce((select sum(courier_pay_cents) from o where fulfillment = 'delivery_partner'), 0),
      'tucai_parceiras_cents', coalesce((select sum(platform_delivery_fee_cents) from o where fulfillment = 'delivery_partner'), 0),
      'subsidios_cents', coalesce((select sum(delivery_subsidy_cents) from o where fulfillment = 'delivery_partner'), 0),
      'por_faixa', coalesce((select jsonb_agg(x order by x.faixa) from (
          select coalesce(delivery_band, 1) as faixa, count(*) as entregas, sum(courier_pay_cents) as entregadores_cents,
                 sum(delivery_subsidy_cents) as subsidios_cents from o where fulfillment = 'delivery_partner' group by 1) x), '[]'::jsonb),
      'entregas_proprias', (select count(*) from o where fulfillment = 'delivery_own'),
      'tucai_proprias_cents', coalesce((select sum(platform_delivery_fee_cents) from o where fulfillment = 'delivery_own'), 0),
      'teste_incluido', _include_test,
      'pedidos_teste', (select count(*) from o where is_test),
      'saques_pagos_cents', coalesce((select sum(amount_cents) from w where status = 'pago' and decided_at >= f and decided_at < t), 0),
      'saques_em_analise', (select count(*) from w where status = 'solicitado'),
      'saques_em_analise_cents', coalesce((select sum(amount_cents) from w where status = 'solicitado'), 0),
      'saldo_entregadores_cents', coalesce((select sum(courier_pay_cents) from public.deliveries d
                                             where d.status = 'delivered' and (_include_test or not d.is_test)), 0)
                                  - coalesce((select sum(amount_cents) from w where status in ('pago', 'solicitado')), 0)));
end $$;

do $$
declare f text;
begin
  revoke all on function private.delivery_split(integer, boolean, public.delivery_pricing) from public, anon, authenticated;
  foreach f in array array['public.worker_store_delivery_quote(text, uuid, uuid, numeric, numeric, integer, integer, text)', 'public.worker_business_point(text, uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);   -- protegidas pela chave de integração
  end loop;
  foreach f in array array['public.admin_set_delivery_pricing(jsonb, integer, integer, integer, boolean)', 'public.merchant_set_free_delivery(uuid, boolean)',
                           'public.admin_delivery_money(date, date, boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function public.delivery_pricing_current() from public;
  grant execute on function public.delivery_pricing_current() to anon, authenticated;
end $$;
