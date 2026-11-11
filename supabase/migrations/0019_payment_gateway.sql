-- 0019_payment_gateway: Mercado Pago para pagar mensalidades e cobranças da plataforma.
--  * Credenciais ficam em private.payment_gateway (schema privado: nenhum papel da API lê a tabela).
--    O Master grava pelo painel e só vê os 4 últimos dígitos do Access Token.
--  * O Worker (servidor) busca a configuração e confirma pagamentos com uma CHAVE DE INTEGRAÇÃO:
--    gerada pelo Master (mostrada uma vez), salva só como hash aqui e como segredo no Cloudflare.
--  * A confirmação só dá baixa se o valor bater com a cobrança; repetir a mesma confirmação não duplica.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('worker.payments', 600, 600), ('payments.checkout', 30, 600);

create table private.payment_gateway (
  id boolean primary key default true check (id),
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  public_key text check (public_key is null or (public_key ~ '^(TEST|APP_USR)-[A-Za-z0-9-]+$' and char_length(public_key) between 15 and 200)),
  access_token text check (access_token is null or (access_token ~ '^(TEST|APP_USR)-[A-Za-z0-9-]+$' and char_length(access_token) between 25 and 300)),
  webhook_secret text check (webhook_secret is null or char_length(webhook_secret) between 16 and 200),
  enabled boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table private.integration_keys (
  name text primary key check (name = 'payments'),
  key_hash text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
revoke all on private.payment_gateway, private.integration_keys from public, anon, authenticated;

alter table public.platform_charges
  add column provider text check (provider is null or provider = 'mercadopago'),
  add column provider_payment_id text;
create unique index platform_charges_provider_payment_idx on public.platform_charges(provider, provider_payment_id) where provider_payment_id is not null;

create or replace function private.integration_key_ok(_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(char_length(_key) >= 32, false) and exists (
    select 1 from private.integration_keys
     where name = 'payments' and key_hash = encode(extensions.digest(_key, 'sha256'), 'hex'))
$$;
revoke all on function private.integration_key_ok(text) from public, anon, authenticated;

-- ---------- painel ----------
create or replace function public.admin_payment_gateway_get()
returns table (provider text, mode text, public_key text, token_last4 text, token_set boolean, webhook_secret_set boolean,
               integration_key_set boolean, enabled boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('finance.view');
  return query
    select 'mercadopago'::text,
           case when g.access_token like 'TEST-%' then 'teste' when g.access_token like 'APP_USR-%' then 'produção' else null end,
           g.public_key, right(g.access_token, 4), g.access_token is not null, g.webhook_secret is not null,
           exists (select 1 from private.integration_keys where name = 'payments'), coalesce(g.enabled, false), g.updated_at
      from (select true as k) one left join private.payment_gateway g on g.id;
end $$;

-- campos vazios/nulos mantêm o valor atual (o token nunca volta para a tela)
create or replace function public.admin_payment_gateway_set(_public_key text, _access_token text, _webhook_secret text, _enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare pk text := nullif(btrim(coalesce(_public_key, '')), ''); tk text := nullif(btrim(coalesce(_access_token, '')), '');
        ws text := nullif(btrim(coalesce(_webhook_secret, '')), ''); cur private.payment_gateway%rowtype;
begin
  perform private.require_master();
  perform private.limit_for('admin.finance');
  select * into cur from private.payment_gateway where id;
  if pk is not null and pk !~ '^(TEST|APP_USR)-' then raise exception 'Public Key inválida (começa com TEST- ou APP_USR-).' using errcode = 'P0001'; end if;
  if tk is not null and tk !~ '^(TEST|APP_USR)-' then raise exception 'Access Token inválido (começa com TEST- ou APP_USR-).' using errcode = 'P0001'; end if;
  if coalesce(pk, cur.public_key) is not null and coalesce(tk, cur.access_token) is not null
     and split_part(coalesce(pk, cur.public_key), '-', 1) <> split_part(coalesce(tk, cur.access_token), '-', 1) then
    raise exception 'Public Key e Access Token precisam ser do mesmo ambiente (os dois de teste ou os dois de produção).' using errcode = 'P0001';
  end if;
  if _enabled and coalesce(tk, cur.access_token) is null then raise exception 'Informe o Access Token antes de ativar.' using errcode = 'P0001'; end if;
  insert into private.payment_gateway as g (id, public_key, access_token, webhook_secret, enabled, updated_by, updated_at)
  values (true, pk, tk, ws, coalesce(_enabled, false), auth.uid(), now())
  on conflict (id) do update set
    public_key = coalesce(pk, g.public_key), access_token = coalesce(tk, g.access_token), webhook_secret = coalesce(ws, g.webhook_secret),
    enabled = coalesce(_enabled, g.enabled), updated_by = auth.uid(), updated_at = now();
  perform private.audit('payments.gateway', 'payment_gateway', 'mercadopago',
    jsonb_build_object('enabled', _enabled, 'token_changed', tk is not null, 'public_key_changed', pk is not null, 'webhook_secret_changed', ws is not null));
end $$;

-- nova chave de integração para o Worker (mostrada uma única vez; a anterior deixa de valer)
create or replace function public.admin_generate_integration_key() returns text
language plpgsql security definer set search_path = '' as $$
declare k text := 'tucai_pay_' || encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform private.require_master();
  insert into private.integration_keys(name, key_hash, created_by) values ('payments', encode(extensions.digest(k, 'sha256'), 'hex'), auth.uid())
  on conflict (name) do update set key_hash = excluded.key_hash, created_by = auth.uid(), created_at = now();
  perform private.audit('payments.integration_key', 'integration_keys', 'payments', '{}'::jsonb);
  return k;
end $$;

-- ---------- quem pode pagar uma cobrança ----------
create or replace function public.payable_charge(_charge uuid)
returns table (id uuid, business_id uuid, business_name text, description text, amount_cents integer, kind public.charge_kind)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('payments.checkout');
  return query
    select ch.id, ch.business_id, b.name, ch.description, ch.amount_cents, ch.kind
      from public.platform_charges ch join public.businesses b on b.id = ch.business_id
     where ch.id = _charge and ch.status = 'aberta'
       and (public.has_business_permission(ch.business_id, 'settings.manage') or public.has_business_permission(ch.business_id, 'reports.view')
            or private.is_master_ok());
end $$;

-- ---------- Worker (chave de integração) ----------
create or replace function public.worker_payment_config(_key text)
returns table (access_token text, webhook_secret text, enabled boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.limit_for('worker.payments');
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select g.access_token, g.webhook_secret, g.enabled from private.payment_gateway g where g.id;
end $$;

create or replace function public.worker_confirm_payment(_key text, _charge uuid, _payment_id text, _amount_cents integer, _method text)
returns text language plpgsql security definer set search_path = '' as $$
declare ch public.platform_charges%rowtype;
begin
  perform private.limit_for('worker.payments');
  if not private.integration_key_ok(_key) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ch from public.platform_charges where id = _charge for update;
  if not found then return 'cobranca_inexistente'; end if;
  if ch.status = 'paga' then return case when ch.provider_payment_id = _payment_id then 'ja_confirmado' else 'ja_paga' end; end if;
  if ch.status <> 'aberta' then return 'cobranca_cancelada'; end if;
  if _amount_cents <> ch.amount_cents then return 'valor_diferente'; end if;
  update public.platform_charges set status = 'paga', paid_at = now(),
         paid_method = case when _method in ('pix', 'cartao', 'boleto') then _method else 'outro' end,
         provider = 'mercadopago', provider_payment_id = _payment_id
   where id = ch.id;
  if ch.kind = 'plano' and ch.subscription_id is not null then
    update public.business_subscriptions set current_period_end = (current_period_end + interval '1 month')::date
     where id = ch.subscription_id and status = 'active';
  end if;
  insert into public.audit_logs(actor_id, action, entity, entity_id, details)
  values (null, 'payments.confirmed', 'platform_charges', ch.id::text, jsonb_build_object('provider', 'mercadopago', 'payment_id', _payment_id, 'amount', _amount_cents));
  return 'confirmado';
exception when unique_violation then
  return 'pagamento_ja_usado';
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_payment_gateway_get()', 'public.admin_payment_gateway_set(text, text, text, boolean)',
                           'public.admin_generate_integration_key()', 'public.payable_charge(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- chamadas pelo Worker (sem sessão): protegidas pela chave de integração
  foreach f in array array['public.worker_payment_config(text)', 'public.worker_confirm_payment(text, uuid, text, integer, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
