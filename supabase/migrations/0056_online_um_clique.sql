-- 0056 — Entregador próprio já logado: "Ficar online" com UM clique, sem digitar nada.
-- O cadastro de parceiro é criado com o que já está na conta: nome (perfil; senão o nome do login; senão o usuário),
-- telefone do perfil (quando houver) e a cidade da loja. Veículo, placa e CNH ficam "não informados" (nada é
-- inventado) e podem ser completados depois em Meus dados. O clique em "Ficar online" registra o aceite dos termos
-- de parceria (aviso exibido junto ao botão).

alter table public.couriers alter column vehicle drop not null;
alter table public.couriers alter column phone drop not null;

drop function if exists public.own_courier_go_online(text, public.courier_vehicle, text, text, boolean);

create or replace function public.own_courier_go_online() returns public.courier_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.couriers%rowtype;
  v_city uuid; v_name text; v_phone text;
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
  select b.city_id into v_city
    from public.business_members m join public.businesses b on b.id = m.business_id
    join public.cities ci on ci.id = b.city_id and ci.is_active
   where m.user_id = uid and m.member_role = 'courier_own'
   order by m.created_at limit 1;
  if v_city is null then raise exception 'A loja ainda não tem cidade cadastrada.' using errcode = 'P0001'; end if;
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), nullif(btrim(u.raw_user_meta_data->>'name'), ''), p.username),
         case when p.phone ~ '^[0-9+() -]{8,20}$' then p.phone end
    into v_name, v_phone
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = uid;
  if v_name is null or char_length(v_name) < 3 then raise exception 'Complete seu nome em Minha conta antes de ficar online.' using errcode = 'P0001'; end if;
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category,
                              status, terms_version, terms_accepted_at, submitted_at)
  values (uid, left(v_name, 120), v_phone, v_city, null, null, null, 'pending', private.courier_terms_version(), now(), now());
  -- o gatilho da 0050 libera o cadastro; só então pode ficar Online
  update public.couriers set is_online = true where user_id = uid and status = 'approved';
  perform private.audit('courier.own_join_network', 'couriers', uid::text, jsonb_build_object('um_clique', true));
  return (select x.status from public.couriers x where x.user_id = uid);
end $$;

do $$ begin
  revoke all on function public.own_courier_go_online() from public, anon;
  grant execute on function public.own_courier_go_online() to authenticated;
end $$;
