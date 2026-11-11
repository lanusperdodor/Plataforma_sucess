-- Dados "de produção" anteriores à 0010, para provar que a migration preserva o que já existe.
-- (Itaú de Minas já vem da 0003: ativa e sem coordenadas.)
insert into auth.users(id, email) values ('10100000-0000-0000-0000-0000000000a1', 'up-dono@teste.invalid');
insert into public.cities(id, name, state, slug, is_active, center_lat, center_lng) values
  -- inativa com estabelecimento -> deve virar suspensa
  ('10109000-0000-0000-0000-000000000001', 'Passos', 'MG', 'passos-mg', false, null, null),
  -- ativa com coordenadas manuais divergentes (~13 km) -> continua ativa, coordenadas mantidas
  ('10109000-0000-0000-0000-000000000002', 'Cássia', 'MG', 'cassia-mg', true, -20.70, -46.90),
  -- ativa sem correspondência no IBGE -> fica intacta, sem código, listada para o Master
  ('10109000-0000-0000-0000-000000000003', 'Vila Inexistente', 'MG', 'vila-inexistente-mg', true, null, null),
  -- inativa sem estabelecimento, grafia sem acento -> vinculada e planejada
  ('10109000-0000-0000-0000-000000000004', 'FRANCA', 'SP', 'franca-sp', false, null, null),
  -- ativa fora do raio -> preservada ativa, apontada como fora da área
  ('10109000-0000-0000-0000-000000000005', 'Belo Horizonte', 'MG', 'belo-horizonte-mg', true, null, null);
insert into public.businesses(id, name, slug, owner_id, status, city_id) values
  ('10101000-0000-0000-0000-000000000001', 'Loja em Passos', 'up-passos', '10100000-0000-0000-0000-0000000000a1', 'active',
   '10109000-0000-0000-0000-000000000001');
