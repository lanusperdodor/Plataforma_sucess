-- Apoio dos testes SQL (só no banco local descartável). Contas extras de teste para cobrir papéis internos que
-- continuam existindo, mas não fazem parte das sete contas operacionais: cozinha (legado), 2º entregador
-- independente (concorrência pela mesma oferta) e operador administrativo. Todas entram no lote de teste ativo.
create schema if not exists tfx;
grant usage on schema tfx to public;

create or replace function tfx.add_to_run(_user uuid, _city uuid) returns void language sql security definer as $$
  update private.test_data_runs set user_ids = user_ids || _user
   where id = (select id from private.test_data_runs where city_id = _city and removed_at is null order by created_at desc limit 1)
$$;

-- cozinha (papel legado 'kitchen') vinculada a um estabelecimento de teste
create or replace function tfx.kitchen(_business uuid) returns uuid language plpgsql security definer as $$
declare u uuid; city uuid;
begin
  select city_id into city from public.businesses where id = _business;
  u := private.create_auth_user('cozinha-' || substr(md5(gen_random_uuid()::text), 1, 6) || '@teste.example.com', 'senha-cozinha-1', 'Cozinha Teste');
  insert into public.business_members(business_id, user_id, member_role) values (_business, u, 'kitchen');
  perform tfx.add_to_run(u, city);
  return u;
end $$;

-- 2º entregador independente aprovado na cidade (para disputar a mesma oferta)
create or replace function tfx.partner_courier(_city uuid) returns uuid language plpgsql security definer as $$
declare u uuid;
begin
  u := private.create_auth_user('parceiro2-' || substr(md5(gen_random_uuid()::text), 1, 6) || '@teste.example.com', 'senha-parceiro-1', 'Entregador Parceiro Dois');
  insert into public.couriers(user_id, full_name, phone, city_id, vehicle, vehicle_plate, cnh_category, status, terms_version, terms_accepted_at)
  values (u, 'Entregador Parceiro Dois', '(35) 99999-0008', _city, 'moto', 'TST2B34', 'A', 'approved', 'teste', now());
  insert into public.user_roles(user_id, role) values (u, 'courier_partner') on conflict do nothing;
  perform tfx.add_to_run(u, _city);
  return u;
end $$;

-- operador administrativo de teste (painel, pedidos e usuários)
create or replace function tfx.operator(_city uuid) returns uuid language plpgsql security definer as $$
declare u uuid;
begin
  u := private.create_auth_user('operador-' || substr(md5(gen_random_uuid()::text), 1, 6) || '@teste.example.com', 'senha-operador-1', 'Operador Teste');
  insert into public.user_roles(user_id, role) values (u, 'platform_operator') on conflict do nothing;
  insert into public.platform_staff_permissions(user_id, permission) values (u, 'admin.dashboard'), (u, 'orders.view'), (u, 'users.view');
  perform tfx.add_to_run(u, _city);
  return u;
end $$;
grant execute on all functions in schema tfx to public;
