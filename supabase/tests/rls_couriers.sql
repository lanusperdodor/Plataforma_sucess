-- Testes da 0009 (entregadores parceiros). Tudo é revertido. Sucesso: NOTICE 'RLS_COURIERS_OK'.
begin;

create schema tste;
grant usage on schema tste to public;
create function tste.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
create function tste.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tste.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tste.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tste.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tste.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tste.affected(stmt text) returns int language plpgsql as $$
declare n int; begin execute stmt; get diagnostics n = row_count; return n; end $$;
create function tste.val(q text) returns text language plpgsql as $$
declare v text; begin execute q into v; return v; end $$;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';

insert into auth.users(id, email) values
  ('33330000-0000-0000-0000-0000000000a1', 'e-moto@teste.invalid'),
  ('33330000-0000-0000-0000-0000000000b1', 'e-bike@teste.invalid'),
  ('33330000-0000-0000-0000-0000000000f1', 'e-revisor@teste.invalid'),
  ('33330000-0000-0000-0000-0000000000f2', 'e-operador@teste.invalid');
insert into public.user_roles(user_id, role) values
  ('33330000-0000-0000-0000-0000000000f1', 'platform_operator'), ('33330000-0000-0000-0000-0000000000f2', 'platform_operator');
insert into public.platform_staff_permissions(user_id, permission) values ('33330000-0000-0000-0000-0000000000f1', 'couriers.review');
insert into public.cities(id, name, state, slug) values ('33339000-0000-0000-0000-000000000001', 'Cidade E', 'TE', 'tste-cidade');

do $$
declare
  a constant uuid := '33330000-0000-0000-0000-0000000000a1';
  b constant uuid := '33330000-0000-0000-0000-0000000000b1';
  r constant uuid := '33330000-0000-0000-0000-0000000000f1';
  o constant uuid := '33330000-0000-0000-0000-0000000000f2';
  city constant uuid := '33339000-0000-0000-0000-000000000001';
begin
  -- 1. cadastro: termos obrigatórios, placa/CNH só para motorizados, dados normalizados
  perform tste.anon();
  perform tste.denied(format($q$select public.submit_courier_application('Ana', '35999990000', %L, 'moto', 'ABC1D23', 'A', true)$q$, city), 'anon se cadastra');
  perform tste.login(a);
  perform tste.denied(format($q$select public.submit_courier_application('Ana Moto', '(35) 99999-0000', %L, 'moto', 'ABC1D23', 'A', false)$q$, city), 'sem aceitar termos', array['P0001']);
  perform tste.denied(format($q$select public.submit_courier_application('Ana Moto', '(35) 99999-0000', %L, 'moto')$q$, city), 'moto sem placa/CNH', array['P0001']);
  perform tste.denied(format($q$select public.submit_courier_application('Ana Moto', '(35) 99999-0000', %L, 'moto', 'XX-1', 'A', true)$q$, city), 'placa inválida', array['23514']);
  perform tste.ok(public.submit_courier_application('Ana Moto', '(35) 99999-0000', city, 'moto', 'abc-1d23', 'a', true) = 'pending', 'cadastro pendente');
  perform tste.ok(tste.val('select vehicle_plate || cnh_category from public.couriers') = 'ABC1D23A', 'placa e CNH normalizadas');
  perform tste.denied($q$update public.couriers set status = 'approved'$q$, 'entregador se aprova');
  perform tste.denied('select public.set_courier_online(true)', 'ficar online antes da aprovação', array['P0001']);
  perform tste.login(b);
  perform public.submit_courier_application('Bruno Bike', '(35) 98888-0000', city, 'bicicleta', 'ABC1D23', 'A', true);
  perform tste.ok(tste.val('select coalesce(vehicle_plate, ''-'') || coalesce(cnh_category, ''-'') from public.couriers') = '--', 'bicicleta não guarda placa nem CNH');
  perform tste.ok(tste.count('select 1 from public.couriers') = 1, 'entregador vê só o próprio cadastro');

  -- 2. análise pela equipe
  perform tste.login(o);
  perform tste.denied('select * from public.admin_list_couriers()', 'operador sem couriers.review lista');
  perform tste.login(r);
  perform tste.ok(tste.count('select 1 from public.admin_list_couriers()') = 2, 'revisor lista pendentes');
  perform tste.denied(format($q$select public.admin_review_courier(%L, 'reject')$q$, b), 'recusa sem motivo', array['P0001']);
  perform public.admin_review_courier(b, 'reject', 'Telefone não confere.');
  perform tste.ok(public.admin_review_courier(a, 'approve') = 'approved', 'aprova');
  perform tste.su();
  perform tste.ok(exists (select 1 from public.user_roles where user_id = a and role = 'courier_partner'), 'aprovação concede courier_partner');
  -- 3. online só aprovado; suspensão tira o papel e o status online
  perform tste.login(a);
  perform tste.ok(public.set_courier_online(true), 'aprovado fica online');
  perform tste.denied(format($q$select public.submit_courier_application('Outro', '35999990000', %L, 'carro', 'ABC1D23', 'B', true)$q$, city), 'aprovado reenvia cadastro', array['P0001']);
  perform tste.login(r);
  perform public.admin_review_courier(a, 'suspend', 'Reclamações de clientes.');
  perform tste.su();
  perform tste.ok((select not is_online from public.couriers where user_id = a), 'suspensão desliga online');
  perform tste.ok(not exists (select 1 from public.user_roles where user_id = a and role = 'courier_partner'), 'suspensão remove papel');
  -- recusado pode reenviar
  perform tste.login(b);
  perform tste.ok(public.submit_courier_application('Bruno Bike', '(35) 98888-1111', city, 'a_pe', null, null, true) = 'pending', 'recusado reenvia');
  perform tste.login(r);
  perform tste.denied(format($q$select public.admin_review_courier(%L, 'approve')$q$, r), 'revisor analisa a si mesmo');
  perform tste.su();
  perform tste.ok((select count(*) from public.audit_logs where action like 'courier.%') >= 5, 'análises auditadas');
  raise notice 'RLS_COURIERS_OK';
end $$;

rollback;
