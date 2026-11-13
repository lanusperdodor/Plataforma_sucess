-- 0042: endereço em campos separados (CEP, rua, número, complemento, bairro, cidade, UF) para loja, cliente e entregador.
-- As partes ficam em jsonb validado; o texto antigo (address_line / delivery_address) continua sendo o que as telas mostram.
-- Na loja, o texto é montado pelo banco a partir das partes (não dá para gravar um e outro diferentes).

create or replace function public.address_parts_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and (select coalesce(bool_and(k in ('cep', 'street', 'number', 'complement', 'district', 'city', 'uf')), true) from jsonb_object_keys(p) k)
    and coalesce(p->>'cep', '') ~ '^[0-9]{8}$'
    and char_length(btrim(coalesce(p->>'street', ''))) between 2 and 120
    and char_length(btrim(coalesce(p->>'number', ''))) between 1 and 20
    and char_length(coalesce(p->>'complement', '')) <= 60
    and char_length(btrim(coalesce(p->>'district', ''))) between 2 and 80
    and char_length(btrim(coalesce(p->>'city', ''))) between 2 and 80
    and coalesce(p->>'uf', '') in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
    and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) <> 'string' or e.value::text ~ '[<>]')
  )
$$;

-- "Rua A, 10, Apto 2 - Centro - Itaú de Minas/MG, CEP 37975-000"
create or replace function public.format_address_parts(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then null else
    concat_ws(' - ',
      nullif(concat_ws(', ', nullif(btrim(p->>'street'), ''), nullif(btrim(p->>'number'), ''), nullif(btrim(p->>'complement'), '')), ''),
      nullif(btrim(p->>'district'), ''),
      nullif(concat_ws('/', nullif(btrim(p->>'city'), ''), nullif(p->>'uf', '')), ''))
    || ', CEP ' || substr(p->>'cep', 1, 5) || '-' || substr(p->>'cep', 6, 3)
  end
$$;

-- ---------- loja ----------
alter table public.businesses add column if not exists address_parts jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_address_parts_ok') then
    alter table public.businesses add constraint businesses_address_parts_ok check (public.address_parts_ok(address_parts));
  end if;
end $$;
create or replace function private.businesses_address_compose() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.address_parts is not null and (tg_op = 'INSERT' or new.address_parts is distinct from old.address_parts) then
    new.address_line := left(public.format_address_parts(new.address_parts), 200);
  end if;
  return new;
end $$;
drop trigger if exists businesses_address_compose on public.businesses;
create trigger businesses_address_compose before insert or update on public.businesses
  for each row execute function private.businesses_address_compose();
grant update (address_parts) on public.businesses to authenticated;

-- ---------- cliente (endereço salvo para o próximo pedido) ----------
alter table public.profiles add column if not exists address_parts jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_address_parts_ok') then
    alter table public.profiles add constraint profiles_address_parts_ok check (public.address_parts_ok(address_parts));
  end if;
end $$;
grant update (address_parts) on public.profiles to authenticated;

-- ---------- entregador ----------
alter table public.couriers add column if not exists address_parts jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'couriers_address_parts_ok') then
    alter table public.couriers add constraint couriers_address_parts_ok check (public.address_parts_ok(address_parts));
  end if;
end $$;

-- o entregador grava o próprio endereço (a tabela não tem UPDATE direto para ele)
create or replace function public.courier_set_address(_parts jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if _parts is null or not public.address_parts_ok(_parts) then raise exception 'Endereço incompleto ou inválido.' using errcode = 'P0001'; end if;
  update public.couriers set address_parts = _parts where user_id = auth.uid();
  if not found then raise exception 'Faça o cadastro de entregador primeiro.' using errcode = 'P0001'; end if;
end $$;

-- o Master (quem revisa entregadores) vê o endereço de um entregador
create or replace function public.admin_courier_address(_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb;
begin
  perform private.require_permission('couriers.review');
  select c.address_parts into p from public.couriers c where c.user_id = _user;
  return jsonb_build_object('parts', p, 'text', public.format_address_parts(p));
end $$;

do $$ begin
  -- funções puras (sem dados): usadas nas restrições CHECK, que rodam com o papel de quem grava
  grant execute on function public.address_parts_ok(jsonb) to anon, authenticated;
  grant execute on function public.format_address_parts(jsonb) to anon, authenticated;
  revoke all on function public.courier_set_address(jsonb) from public, anon;
  grant execute on function public.courier_set_address(jsonb) to authenticated;
  revoke all on function public.admin_courier_address(uuid) from public, anon;
  grant execute on function public.admin_courier_address(uuid) to authenticated;
end $$;
