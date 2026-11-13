-- 0043: a Tucaí recebe a sua taxa (R$ 1) em TODA corrida parceira. Regra aprovada pelo responsável:
--   entregador = (o que o cliente paga + o que a loja paga) − taxa da Tucaí.
-- Ex.: 3 a 5 km → cliente R$ 5 + loja R$ 2 = R$ 7 − R$ 1 da Tucaí = R$ 6 ao entregador. Sem subsídio.
-- Pedidos já feitos não mudam (cada pedido guarda os próprios valores).

-- 1) a tabela só é aceita se cliente + loja cobrirem entregador + Tucaí em todas as faixas
create or replace function public.admin_set_delivery_pricing(_bands jsonb, _platform_fee_cents integer, _customer_max_cents integer,
                                                              _merchant_max_cents integer, _require_quote boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare b jsonb; prev int := 0; v int; n int := 0;
begin
  perform private.require_master_mfa();
  perform private.limit_for('admin.finance');
  if jsonb_typeof(_bands) <> 'array' or jsonb_array_length(_bands) not between 1 and 10 then raise exception 'Informe de 1 a 10 faixas.' using errcode = 'P0001'; end if;
  if _platform_fee_cents not between 0 and 2000 or _customer_max_cents not between 0 and 5000 or _merchant_max_cents not between 0 and 5000 then
    raise exception 'Valores fora dos limites.' using errcode = 'P0001';
  end if;
  for b in select * from jsonb_array_elements(_bands) loop
    n := n + 1;
    if (b->>'ate_m') !~ '^[0-9]+$' or (b->>'entregador_cents') !~ '^[0-9]+$' then raise exception 'Faixa inválida.' using errcode = 'P0001'; end if;
    if (b->>'ate_m')::int <= prev or (b->>'ate_m')::int > 50000 then raise exception 'As distâncias das faixas precisam crescer (até 50 km).' using errcode = 'P0001'; end if;
    if (b->>'entregador_cents')::int < 100 or (b->>'entregador_cents')::int > 20000 then raise exception 'Ganho do entregador entre R$ 1 e R$ 200.' using errcode = 'P0001'; end if;
    if (b->>'entregador_cents')::int + _platform_fee_cents > _customer_max_cents + _merchant_max_cents then
      raise exception 'Faixa %: o entregador pode receber no máximo R$ % (cliente R$ % + loja R$ % − Tucaí R$ %). A Tucaí recebe a taxa em toda corrida.',
        n, to_char((_customer_max_cents + _merchant_max_cents - _platform_fee_cents) / 100.0, 'FM999990D00'),
        to_char(_customer_max_cents / 100.0, 'FM999990D00'), to_char(_merchant_max_cents / 100.0, 'FM999990D00'), to_char(_platform_fee_cents / 100.0, 'FM999990D00')
        using errcode = 'P0001';
    end if;
    prev := (b->>'ate_m')::int;
  end loop;
  select coalesce(max(version), 0) + 1 into v from public.delivery_pricing;
  update public.delivery_pricing set is_current = false where is_current;
  insert into public.delivery_pricing(version, bands, platform_fee_cents, customer_max_cents, merchant_max_cents, require_quote, is_current, created_by)
  values (v, _bands, _platform_fee_cents, _customer_max_cents, _merchant_max_cents, coalesce(_require_quote, false), true, auth.uid());
  perform private.audit('finance.delivery_pricing', 'delivery_pricing', v::text,
                        jsonb_build_object('faixas', _bands, 'tucai', _platform_fee_cents, 'cliente_max', _customer_max_cents, 'loja_max', _merchant_max_cents, 'exige_cotacao', _require_quote));
  return v;
end $$;

-- 2) tabela vigente: se ainda é a versão 1 original (5/6/7), vira a versão 2 com 5/6/6. Se o Master já mudou, não mexe.
do $$
declare cur public.delivery_pricing%rowtype; v int;
begin
  select * into cur from public.delivery_pricing where is_current;
  if found and cur.version = 1 and cur.platform_fee_cents = 100 and cur.customer_max_cents = 500 and cur.merchant_max_cents = 200
     and cur.bands = '[{"ate_m":1500,"entregador_cents":500},{"ate_m":3000,"entregador_cents":600},{"ate_m":5000,"entregador_cents":700}]'::jsonb then
    select coalesce(max(version), 0) + 1 into v from public.delivery_pricing;
    update public.delivery_pricing set is_current = false where is_current;
    insert into public.delivery_pricing(version, bands, platform_fee_cents, customer_max_cents, merchant_max_cents, require_quote, is_current, created_by)
    values (v, '[{"ate_m":1500,"entregador_cents":500},{"ate_m":3000,"entregador_cents":600},{"ate_m":5000,"entregador_cents":600}]'::jsonb,
            100, 500, 200, cur.require_quote, true, null);
    perform private.audit('finance.delivery_pricing', 'delivery_pricing', v::text,
      jsonb_build_object('motivo', 'Tucaí recebe R$ 1 em toda corrida: 3 a 5 km passa a R$ 6 ao entregador (cliente 5 + loja 2 − Tucaí 1)', 'origem', 'migração 0043'));
  end if;
end $$;
