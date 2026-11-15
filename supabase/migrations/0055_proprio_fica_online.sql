-- 0055 — Entregador próprio já logado fica Online direto, sem ir à página de cadastro.
-- Na primeira vez, a Área do entregador pede só celular e veículo (pré-preenchidos) e o aceite dos termos; a cidade
-- é a da loja dele e o nome é o do perfil. O cadastro nasce liberado (0050) e já fica Online. Nas próximas vezes,
-- o botão "Ficar online" funciona como para qualquer entregador.

create or replace function public.own_courier_go_online(
  _phone text, _vehicle public.courier_vehicle, _vehicle_plate text default null, _cnh_category text default null, _accept_terms boolean default false
) returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.couriers%rowtype;
  v_city uuid; v_name text;
  plate text := nullif(upper(regexp_replace(coalesce(_vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g')), '');
  cnh text := nullif(upper(btrim(coalesce(_cnh_category, ''))), '');
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('courier.submit');
  if not private.is_any_own_courier(uid) then
    raise exception 'Somente entregador próprio de um estabelecimento usa esta opção.' using errcode = '42501';
  end if;
  select * into c from public.couriers where user_id = uid for update;
  if found then
    if c.status <> 'approved' then raise exception 'Seu cadastro de entregador está em análise ou suspenso. Fale com o suporte.' using errcode = 'P0001'; end if;
    update public.couriers set is_online = true where user_id = uid;
    return c.status;
  end if;
  if not coalesce(_accept_terms, false) then raise exception 'É preciso aceitar os termos de parceria.' using errcode = 'P0001'; end if;
  if _vehicle in ('bicicleta', 'a_pe') then plate := null; cnh := null; end if;
  if _vehicle in ('moto', 'carro') and (plate is null or cnh is null) then
    raise exception 'Informe a placa e a categoria da CNH.' using errcode = 'P0001';
  end if;
  select b.city_id into v_city
    from public.business_members m join public.businesses b on b.id = m.business_id
    join public.cities ci on ci.id = b.city_id and ci.is_active
   where m.user_id = uid and m.member_role = 'courier_own'
   order by m.created_at limit 1;
  if v_city is null then raise exception 'A loja ainda não tem cidade cadastrada.' using errcode = 'P0001'; end if;
  select nullif(btrim(p.full_name), '') into v_name from public.profiles p where p.id = uid;
  if v_name is null or char_length(v_name) < 3 then raise exception 'Complete seu nome em Minha conta antes de ficar online.' using errcode = 'P0001'; end if;
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category,
                              status, terms_version, terms_accepted_at, submitted_at)
  values (uid, v_name, btrim(_phone), v_city, _vehicle, plate, cnh, 'pending', private.courier_terms_version(), now(), now());
  -- o gatilho da 0050 libera o cadastro; só então pode ficar Online
  update public.couriers set is_online = true where user_id = uid and status = 'approved';
  perform private.audit('courier.own_join_network', 'couriers', uid::text, jsonb_build_object('vehicle', _vehicle));
  return (select x.status from public.couriers x where x.user_id = uid);
end $$;

do $$ begin
  revoke all on function public.own_courier_go_online(text, public.courier_vehicle, text, text, boolean) from public, anon;
  grant execute on function public.own_courier_go_online(text, public.courier_vehicle, text, text, boolean) to authenticated;
end $$;
