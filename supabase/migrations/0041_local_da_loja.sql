-- 0041: a loja marca o próprio endereço no mapa (lat/lng). Sem isso o frete por distância (0040) usa o frete padrão
-- e o mapa do rastreamento não mostra a loja. Só quem administra a loja (ou o Master que revisa estabelecimentos) altera.
create or replace function public.merchant_set_location(_business uuid, _lat numeric, _lng numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_business_permission(_business, 'store.customize') or public.has_business_permission(_business, 'settings.manage')
          or public.has_platform_permission('businesses.review')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (_lat is null) <> (_lng is null) then raise exception 'Informe latitude e longitude.' using errcode = 'P0001'; end if;
  -- território brasileiro (com folga), como na cotação do Worker
  if _lat is not null and not (_lat between -34 and 6 and _lng between -74 and -34) then
    raise exception 'Local fora do Brasil.' using errcode = 'P0001';
  end if;
  perform set_config('tucai.internal', 'on', true);
  update public.businesses set lat = round(_lat, 6), lng = round(_lng, 6) where id = _business;
  if not found then raise exception 'Estabelecimento não encontrado.' using errcode = 'P0001'; end if;
  perform private.audit('business.location', 'businesses', _business::text, jsonb_build_object('marcado', _lat is not null));
end $$;

-- a equipe da loja lê o ponto atual (a vitrine pública já expõe lat/lng pelo catálogo da 0034)
create or replace function public.merchant_location(_business uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b record;
begin
  if not (public.has_business_permission(_business, 'store.customize') or public.has_business_permission(_business, 'settings.manage')
          or public.has_platform_permission('businesses.review')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select bc.lat, bc.lng, bc.address_line into b from public.businesses bc where bc.id = _business;
  return jsonb_build_object('lat', b.lat, 'lng', b.lng, 'address', b.address_line);
end $$;

do $$ begin
  revoke all on function public.merchant_set_location(uuid, numeric, numeric) from public, anon;
  grant execute on function public.merchant_set_location(uuid, numeric, numeric) to authenticated;
  revoke all on function public.merchant_location(uuid) from public, anon;
  grant execute on function public.merchant_location(uuid) to authenticated;
end $$;
