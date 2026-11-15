-- 0050: tipos de conta no cadastro (cliente, entregador, empresário) e liberação automática da empresa.
--  * Preços dos planos (aprovados): Padrão R$ 79,90 e Premium (completo) R$ 99,90. Assinaturas já existentes mantêm o
--    valor contratado; o novo valor vale para quem assinar daqui em diante.
--  * Empresário: escolhe o plano no cadastro e paga a 1ª mensalidade (débito automático, 0049). Com o pagamento
--    confirmado pelo Mercado Pago, a loja é ATIVADA AUTOMATICAMENTE. O Master vê as lojas ativadas assim e pode suspender.
--  * Cliente e entregador não pagam nada (entregador continua com a conferência do Master antes de receber entregas).

update public.plans set price_cents = 7990 where code = 'delivery' and price_cents = 7900;
update public.plans set price_cents = 9990 where code = 'presencial_delivery' and price_cents = 9900;

alter table public.businesses add column if not exists auto_activated_at timestamptz;

create or replace function public.worker_preapproval_payment(_key text, _preapproval_id text, _payment_id text, _amount_cents integer, _method text) returns text
language plpgsql security definer set search_path = '' as $$
declare g public.business_gateway_subscriptions%rowtype; s public.business_subscriptions%rowtype; b public.businesses%rowtype; ref date := date_trunc('month', current_date)::date;
begin
  perform private.limit_for('worker.payments');
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into g from public.business_gateway_subscriptions where preapproval_id = _preapproval_id for update;
  if not found then return 'assinatura_inexistente'; end if;
  if exists (select 1 from public.platform_charges where provider = 'mercadopago' and provider_payment_id = _payment_id) then return 'ja_confirmado'; end if;
  if _amount_cents <> g.price_cents then return 'valor_diferente'; end if;
  select * into s from public.business_subscriptions where business_id = g.business_id and status = 'active' for update;
  if not found then
    insert into public.business_subscriptions(business_id, plan_code, price_cents, status, started_on, current_period_end, notes)
    values (g.business_id, g.plan_code, g.price_cents, 'active', current_date, current_date, 'Débito automático (Mercado Pago)')
    returning * into s;
  end if;
  update public.business_subscriptions set current_period_end = (greatest(current_period_end, current_date) + interval '1 month')::date,
         plan_code = g.plan_code, price_cents = g.price_cents where id = s.id;
  insert into public.platform_charges(business_id, subscription_id, kind, description, amount_cents, due_on, status, paid_at, paid_method, provider, provider_payment_id)
  values (g.business_id, s.id, 'plano', 'Mensalidade ' || (select name from public.plans where code = g.plan_code) || ' — débito automático ' || to_char(ref, 'MM/YYYY'),
          g.price_cents, current_date, 'paga', now(), case when _method in ('pix', 'cartao', 'boleto') then _method else 'cartao' end, 'mercadopago', _payment_id);
  update public.business_gateway_subscriptions set status = 'autorizada', last_payment_at = now(), updated_at = now() where business_id = g.business_id;
  -- 0050: primeira mensalidade paga libera a loja na hora (sem esperar o Master); o Master confere depois e pode suspender
  select * into b from public.businesses where id = g.business_id for update;
  if b.status = 'pending' then
    perform set_config('tucai.internal', 'on', true);
    update public.businesses set status = 'active', reviewed_at = now(), reviewed_by = null,
           review_note = 'Ativado automaticamente pelo pagamento do plano', auto_activated_at = now()
     where id = b.id;
    insert into public.user_roles(user_id, role) values (b.owner_id, 'business_owner') on conflict do nothing;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (null, 'business.auto_activated', 'businesses', b.id::text, jsonb_build_object('motivo', 'primeira mensalidade paga', 'payment_id', _payment_id));
  end if;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (null, 'payments.subscription_paid', 'business_gateway_subscriptions', g.business_id::text, jsonb_build_object('payment_id', _payment_id, 'amount', _amount_cents));
  return 'confirmado';
exception when unique_violation then
  return 'ja_confirmado';
end $$;

do $$ begin
  revoke all on function public.worker_preapproval_payment(text, text, text, integer, text) from public;
  grant execute on function public.worker_preapproval_payment(text, text, text, integer, text) to anon, authenticated;
end $$;

-- ---------- entregador: liberado automaticamente no primeiro cadastro (não paga nada) ----------
-- Reenvio depois de recusa continua passando pelo Master (quem foi recusado não se libera sozinho).
create or replace function private.courier_auto_approve() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    new.status := 'approved';
    new.reviewed_at := now();
    new.review_note := 'Liberado automaticamente no cadastro';
  end if;
  return new;
end $$;
drop trigger if exists couriers_auto_approve on public.couriers;
create trigger couriers_auto_approve before insert on public.couriers for each row execute function private.courier_auto_approve();

create or replace function private.courier_auto_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' then
    insert into public.user_roles(user_id, role) values (new.user_id, 'courier_partner') on conflict do nothing;
    insert into public.audit_logs(actor_id, action, entity, entity_id, details)
    values (new.user_id, 'courier.auto_approved', 'couriers', new.user_id::text, '{}'::jsonb);
  end if;
  return null;
end $$;
drop trigger if exists couriers_auto_role on public.couriers;
create trigger couriers_auto_role after insert on public.couriers for each row execute function private.courier_auto_role();

do $$ begin
  revoke all on function private.courier_auto_approve() from public, anon, authenticated;
  revoke all on function private.courier_auto_role() from public, anon, authenticated;
end $$;

-- devolve a situação real do cadastro (aprovado na hora, ou pendente no reenvio após recusa)
create or replace function public.submit_courier_application(
  _full_name text, _phone text, _city_id uuid, _vehicle public.courier_vehicle,
  _vehicle_plate text default null, _cnh_category text default null, _accept_terms boolean default false
) returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  plate text := nullif(upper(regexp_replace(coalesce(_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g')), '');
  cnh text := nullif(upper(btrim(coalesce(_cnh_category, ''))), '');
  current_status public.courier_status;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.submit');
  if not coalesce(_accept_terms, false) then
    raise exception 'É preciso aceitar os termos de parceria.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cities where id = _city_id and is_active and not is_demo) then
    raise exception 'Cidade indisponível.' using errcode = 'P0001';
  end if;
  if _vehicle in ('bicicleta', 'a_pe') then plate := null; cnh := null; end if;
  if _vehicle in ('moto', 'carro') and (plate is null or cnh is null) then
    raise exception 'Informe a placa e a categoria da CNH.' using errcode = 'P0001';
  end if;
  select status into current_status from public.couriers where user_id = uid for update;
  if current_status in ('approved', 'suspended') then
    raise exception 'Seu cadastro já foi analisado. Fale com o suporte para alterar dados.' using errcode = 'P0001';
  end if;
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category,
                              status, terms_version, terms_accepted_at, submitted_at, review_note, reviewed_by, reviewed_at)
  values (uid, btrim(_full_name), btrim(_phone), _city_id, _vehicle, plate, cnh, 'pending',
          private.courier_terms_version(), now(), now(), null, null, null)
  on conflict (user_id) do update set
    full_name = excluded.full_name, phone = excluded.phone, city_id = excluded.city_id, vehicle = excluded.vehicle,
    vehicle_plate = excluded.vehicle_plate, cnh_category = excluded.cnh_category, status = 'pending',
    terms_version = excluded.terms_version, terms_accepted_at = excluded.terms_accepted_at,
    submitted_at = now(), review_note = null, reviewed_by = null, reviewed_at = null;
  perform private.audit('courier.submit', 'couriers', uid::text, jsonb_build_object('vehicle', _vehicle));
  -- 0050: devolve a situação real (no primeiro cadastro o entregador já sai liberado)
  return (select c.status from public.couriers c where c.user_id = uid);
end $$;
