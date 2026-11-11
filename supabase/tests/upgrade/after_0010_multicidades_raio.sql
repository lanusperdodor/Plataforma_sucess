-- Verifica a 0010 sobre os dados de before_0010 e remove os fixtures no final.
-- Sucesso termina com NOTICE 'UPGRADE_0010_OK'.
do $$
declare r record;
begin
  -- Itaú de Minas: vinculada, coordenadas do IBGE preenchidas, ativa, distância 0
  select * into r from public.cities where slug = 'itau-de-minas-mg';
  if r.ibge_code is distinct from 3133758 or r.status <> 'active' or r.center_lat is null or r.distance_from_hq_km <> 0 then
    raise exception 'FALHOU: Itaú de Minas %', row_to_json(r);
  end if;

  select * into r from public.cities where id = '10109000-0000-0000-0000-000000000001';
  if r.ibge_code is distinct from 3147907 or r.status <> 'suspended' or r.is_active or r.center_lat <> -20.7193 then
    raise exception 'FALHOU: Passos (inativa com loja -> suspensa, vinculada) %', row_to_json(r);
  end if;

  select * into r from public.cities where id = '10109000-0000-0000-0000-000000000002';
  if r.ibge_code is distinct from 3115102 or r.status <> 'active' or r.center_lat <> -20.70 or r.center_lng <> -46.90 then
    raise exception 'FALHOU: Cássia (coordenadas manuais devem ser mantidas) %', row_to_json(r);
  end if;

  select * into r from public.cities where id = '10109000-0000-0000-0000-000000000003';
  if r.ibge_code is not null or r.status <> 'active' or r.center_lat is not null then
    raise exception 'FALHOU: cidade sem IBGE deveria ficar intacta %', row_to_json(r);
  end if;

  select * into r from public.cities where id = '10109000-0000-0000-0000-000000000004';
  if r.ibge_code is distinct from 3516200 or r.status <> 'planned' or r.name <> 'FRANCA' then
    raise exception 'FALHOU: Franca (vínculo sem renomear) %', row_to_json(r);
  end if;

  select * into r from public.cities where id = '10109000-0000-0000-0000-000000000005';
  if r.ibge_code is distinct from 3106200 or r.status <> 'active' or r.distance_from_hq_km <= 100 then
    raise exception 'FALHOU: Belo Horizonte (preservada ativa, fora da área) %', row_to_json(r);
  end if;

  -- sem duplicatas: um registro por código IBGE e nenhum "Passos"/"Cássia"/"Franca" repetido
  if (select count(*) from public.cities where state = 'MG' and search_name in ('passos', 'cassia')) <> 2
     or (select count(*) from public.cities where state = 'SP' and search_name = 'franca') <> 1 then
    raise exception 'FALHOU: duplicatas criadas pela carga';
  end if;
  -- todas as 58 elegíveis presentes (as existentes vinculadas + as novas planejadas)
  if (select count(*) from public.cities c join private.eligible_municipalities() e on e.code = c.ibge_code) <> 58 then
    raise exception 'FALHOU: elegíveis cadastradas';
  end if;
  -- novas entram planejadas; só Itaú e Cássia (que já eram ativas) estão ativas no raio
  if (select count(*) from public.cities c join private.eligible_municipalities() e on e.code = c.ibge_code where c.status = 'active') <> 2 then
    raise exception 'FALHOU: ativas dentro do raio';
  end if;
  -- loja de cidade suspensa sai do catálogo público
  if exists (select 1 from public.public_businesses where id = '10101000-0000-0000-0000-000000000001')
     or public.is_active_business('10101000-0000-0000-0000-000000000001') then
    raise exception 'FALHOU: loja em cidade suspensa ainda pública';
  end if;

  -- limpeza dos fixtures (a cidade suspensa/planejada volta a ser só carga)
  delete from public.businesses where id = '10101000-0000-0000-0000-000000000001';
  delete from public.cities where id in ('10109000-0000-0000-0000-000000000003', '10109000-0000-0000-0000-000000000005');
  update public.cities set status = 'planned', center_lat = -20.5831, center_lng = -46.9201
   where id = '10109000-0000-0000-0000-000000000002';
  update public.cities set status = 'planned' where id = '10109000-0000-0000-0000-000000000001';
  update public.cities set name = 'Franca' where id = '10109000-0000-0000-0000-000000000004';
  delete from auth.users where id = '10100000-0000-0000-0000-0000000000a1';
  raise notice 'UPGRADE_0010_OK';
end $$;
