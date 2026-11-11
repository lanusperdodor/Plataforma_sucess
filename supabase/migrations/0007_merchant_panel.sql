-- 0007_merchant_panel: escrita do painel do estabelecimento com RLS por permissão.
--  * Membros leem os próprios dados (inclusive antes da aprovação, para preparar a loja).
--  * Loja/horários: store.customize ou settings.manage. Cardápio: menu.manage.
--  * Colunas sensíveis nunca são graváveis pelo comerciante: status, owner_id, slug, notas,
--    is_featured, popularity_score, rating_*, is_demo, is_popular (afirmação "mais pedido"
--    só pode vir de dados reais de vendas, não do próprio comerciante).
--  * Mudanças de preço ficam na auditoria.

-- ---------- estabelecimento ----------
drop policy businesses_owner_update on public.businesses;
create policy businesses_member_update on public.businesses for update to authenticated
  using (public.has_business_permission(id, 'store.customize') or public.has_business_permission(id, 'settings.manage'))
  with check (public.has_business_permission(id, 'store.customize') or public.has_business_permission(id, 'settings.manage'));

revoke update on public.businesses from authenticated;
grant update (name, description, phone, whatsapp, address_line, cover_url, logo_url, category_id,
              delivery_offer, own_delivery_fee_cents, accepts_pickup, estimated_min_minutes,
              estimated_max_minutes, min_order_cents)
  on public.businesses to authenticated;

-- a categoria precisa ser do mesmo tipo do estabelecimento
create or replace function private.businesses_category_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.category_id is not null and not exists (
       select 1 from public.categories where id = new.category_id and kind = new.business_type::text and not is_demo) then
    raise exception 'Categoria incompatível com o tipo de negócio.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.businesses_category_guard() from public, anon, authenticated;
create trigger businesses_category_guard before insert or update of category_id on public.businesses
  for each row execute function private.businesses_category_guard();

alter table public.businesses
  add constraint businesses_description_len check (description is null or char_length(description) <= 1000) not valid,
  add constraint businesses_fee_cap check (own_delivery_fee_cents <= 100000) not valid,
  add constraint businesses_min_order_cap check (min_order_cents <= 1000000) not valid;

-- ---------- horários ----------
create policy business_hours_member_select on public.business_hours for select to authenticated
  using (public.is_business_member(business_id));
create policy business_hours_member_write on public.business_hours for all to authenticated
  using (public.has_business_permission(business_id, 'store.customize') or public.has_business_permission(business_id, 'settings.manage'))
  with check (public.has_business_permission(business_id, 'store.customize') or public.has_business_permission(business_id, 'settings.manage'));
grant insert, update, delete on public.business_hours to authenticated;

-- ---------- cardápio ----------
create policy menu_categories_member_select on public.menu_categories for select to authenticated
  using (public.is_business_member(business_id));
create policy menu_categories_member_write on public.menu_categories for all to authenticated
  using (public.has_business_permission(business_id, 'menu.manage'))
  with check (public.has_business_permission(business_id, 'menu.manage'));
grant insert (business_id, name, sort_order, is_active) on public.menu_categories to authenticated;
grant update (name, sort_order, is_active) on public.menu_categories to authenticated;
grant delete on public.menu_categories to authenticated;

create policy products_member_select on public.products for select to authenticated
  using (public.is_business_member(business_id));
create policy products_member_write on public.products for all to authenticated
  using (public.has_business_permission(business_id, 'menu.manage'))
  with check (public.has_business_permission(business_id, 'menu.manage'));
grant insert (business_id, category_id, name, description, price_cents, image_url, is_available, sort_order)
  on public.products to authenticated;
grant update (category_id, name, description, price_cents, image_url, is_available, sort_order)
  on public.products to authenticated;
grant delete on public.products to authenticated;
alter table public.products
  add constraint products_price_cap check (price_cents <= 10000000) not valid;

create policy option_groups_member_select on public.option_groups for select to authenticated
  using (public.is_business_member(business_id));
create policy option_groups_member_write on public.option_groups for all to authenticated
  using (public.has_business_permission(business_id, 'menu.manage'))
  with check (public.has_business_permission(business_id, 'menu.manage'));
grant insert (business_id, product_id, name, min_select, max_select, sort_order) on public.option_groups to authenticated;
grant update (name, min_select, max_select, sort_order) on public.option_groups to authenticated;
grant delete on public.option_groups to authenticated;

create policy options_member_select on public.options for select to authenticated
  using (public.is_business_member(business_id));
create policy options_member_write on public.options for all to authenticated
  using (public.has_business_permission(business_id, 'menu.manage'))
  with check (public.has_business_permission(business_id, 'menu.manage'));
grant insert (business_id, group_id, name, price_delta_cents, is_available, sort_order) on public.options to authenticated;
grant update (name, price_delta_cents, is_available, sort_order) on public.options to authenticated;
grant delete on public.options to authenticated;

-- ---------- auditoria de preços ----------
create or replace function private.audit_product_price() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('product.create', 'products', new.id::text,
      jsonb_build_object('business_id', new.business_id, 'price_cents', new.price_cents));
  elsif new.price_cents is distinct from old.price_cents then
    perform private.audit('product.price', 'products', new.id::text,
      jsonb_build_object('business_id', new.business_id, 'from', old.price_cents, 'to', new.price_cents));
  end if;
  return null;
end $$;
revoke all on function private.audit_product_price() from public, anon, authenticated;
create trigger products_audit_price after insert or update of price_cents on public.products
  for each row execute function private.audit_product_price();

-- O nome do negócio (identidade comercial) continua exigindo settings.manage (dono).
create or replace function private.businesses_name_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- só para chamadas da API (PostgREST faz SET ROLE authenticated); manutenção interna não passa aqui
  if new.name is distinct from old.name and current_setting('role', true) in ('authenticated', 'anon')
     and not public.has_business_permission(new.id, 'settings.manage') then
    raise exception 'Somente o responsável pode alterar o nome do negócio.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.businesses_name_guard() from public, anon, authenticated;
create trigger businesses_name_guard before update of name on public.businesses
  for each row execute function private.businesses_name_guard();
