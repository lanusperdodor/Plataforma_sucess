-- Testes da 0013 (vagas e candidaturas) e LGPD de pedidos. Tudo é revertido. Sucesso: NOTICE 'RLS_JOBS_OK'.
begin;

create schema tstj;
grant usage on schema tstj to public;
create function tstj.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
create function tstj.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tstj.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstj.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstj.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tstj.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
grant execute on all functions in schema tstj to public;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';

-- own dono, mgr gerente, att atendente de A; ownp dono de P (pendente); p1/p2 candidatos; op operador com jobs.manage
insert into auth.users(id, email) values
  ('55550000-0000-0000-0000-0000000000a1', 'j-dono@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000a2', 'j-gerente@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000a3', 'j-atendente@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000b1', 'j-dono-pendente@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000c1', 'j-candidato1@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000c2', 'j-candidato2@teste.invalid'),
  ('55550000-0000-0000-0000-0000000000f1', 'j-operador@teste.invalid');
insert into public.user_roles(user_id, role) values ('55550000-0000-0000-0000-0000000000f1', 'platform_operator');
insert into public.platform_staff_permissions(user_id, permission) values ('55550000-0000-0000-0000-0000000000f1', 'jobs.manage');
insert into public.cities(id, name, state, slug) values ('55559000-0000-0000-0000-000000000001', 'Cidade J', 'TJ', 'tstj-cidade');
insert into public.businesses(id, name, slug, owner_id, status, city_id) values
  ('55551000-0000-0000-0000-00000000000a', 'Mercado A', 'tstj-a', '55550000-0000-0000-0000-0000000000a1', 'active', '55559000-0000-0000-0000-000000000001'),
  ('55551000-0000-0000-0000-00000000000b', 'Loja Pendente', 'tstj-b', '55550000-0000-0000-0000-0000000000b1', 'pending', '55559000-0000-0000-0000-000000000001');
insert into public.business_members(business_id, user_id, member_role) values
  ('55551000-0000-0000-0000-00000000000a', '55550000-0000-0000-0000-0000000000a1', 'owner'),
  ('55551000-0000-0000-0000-00000000000a', '55550000-0000-0000-0000-0000000000a2', 'manager'),
  ('55551000-0000-0000-0000-00000000000a', '55550000-0000-0000-0000-0000000000a3', 'attendant'),
  ('55551000-0000-0000-0000-00000000000b', '55550000-0000-0000-0000-0000000000b1', 'owner');

do $$
declare
  own constant uuid := '55550000-0000-0000-0000-0000000000a1';
  mgr constant uuid := '55550000-0000-0000-0000-0000000000a2';
  att constant uuid := '55550000-0000-0000-0000-0000000000a3';
  ownp constant uuid := '55550000-0000-0000-0000-0000000000b1';
  p1 constant uuid := '55550000-0000-0000-0000-0000000000c1';
  p2 constant uuid := '55550000-0000-0000-0000-0000000000c2';
  op constant uuid := '55550000-0000-0000-0000-0000000000f1';
  ba constant uuid := '55551000-0000-0000-0000-00000000000a';
  bp constant uuid := '55551000-0000-0000-0000-00000000000b';
  j1 uuid; j2 uuid; a1 uuid; a2 uuid; ex jsonb;
begin
  -- 1. publicação
  perform tstj.login(att);
  perform tstj.denied(format($q$select public.save_job(%L, 'Caixa', 'atendimento', 'Atendimento no caixa do mercado, turno da tarde.', 'clt')$q$, ba), 'atendente publica vaga');
  perform tstj.denied(format($q$insert into public.jobs(business_id, title, area, description, employment_type) values (%L, 'Caixa', 'atendimento', 'Atendimento no caixa do mercado.', 'clt')$q$, ba),
                      'inserção direta de vaga');
  perform tstj.login(ownp);
  perform tstj.denied(format($q$select public.save_job(%L, 'Vendedor', 'vendas', 'Vendas no balcão da loja, com metas mensais.', 'clt')$q$, bp), 'loja pendente publica', array['P0001']);
  perform tstj.login(own);
  perform tstj.denied(format($q$select public.save_job(%L, 'Caixa', 'atendimento', 'curta', 'clt')$q$, ba), 'descrição curta demais', array['23514']);
  perform tstj.denied(format($q$select public.save_job(%L, 'Caixa', 'atendimento', 'Atendimento no caixa do mercado, turno da tarde.', 'clt', 'presencial', null, null, 300000, 200000)$q$, ba),
                      'salário máximo menor que o mínimo', array['23514']);
  j1 := public.save_job(ba, 'Operador de caixa', 'atendimento', 'Atendimento no caixa do mercado, turno da tarde.', 'clt',
                        'presencial', 'Ensino médio', 'Vale-transporte', 180000, 220000, 2, 30);
  perform tstj.login(mgr);
  j2 := public.save_job(ba, 'Repositor', 'servicos_gerais', 'Reposição de mercadorias e organização das gôndolas.', 'temporario');
  perform public.set_job_status(j2, 'paused');

  -- 2. visibilidade
  perform tstj.anon();
  perform tstj.ok(tstj.count('select 1 from public.jobs') = 1, 'anon vê só a vaga aberta');
  perform tstj.ok(tstj.count(format('select 1 from public.jobs where id = %L and city_id = %L', j1, '55559000-0000-0000-0000-000000000001')) = 1, 'vaga herda a cidade da loja');
  perform tstj.denied(format('select public.apply_to_job(%L, %L, %L)', j1, 'Ana', '35999990000'), 'anon se candidata');
  perform tstj.login(own);
  perform tstj.ok(tstj.count('select 1 from public.jobs') = 2, 'dono vê vagas pausadas');
  perform tstj.denied(format($q$update public.jobs set status = 'open' where id = %L$q$, j2), 'atualização direta de vaga');

  -- 3. candidatura
  perform tstj.login(p1);
  perform tstj.denied(format($q$select public.apply_to_job(%L, 'Paula Um', '35999990001')$q$, j2), 'candidata a vaga pausada', array['P0001']);
  a1 := public.apply_to_job(j1, 'Paula Um', '(35) 99999-0001', 'Tenho disponibilidade à tarde.', '2 anos como caixa.');
  perform tstj.denied(format($q$select public.apply_to_job(%L, 'Paula Um', '35999990001')$q$, j1), 'candidatura duplicada', array['P0001']);
  perform tstj.denied(format($q$insert into public.job_applications(job_id, applicant_id, full_name, phone) values (%L, %L, 'X Y Z', '35999990001')$q$, j1, p1),
                      'candidatura direta na tabela');
  perform tstj.login(att);
  perform tstj.denied(format($q$select public.apply_to_job(%L, 'Atendente', '35999990009')$q$, j1), 'equipe se candidata à própria vaga', array['P0001']);
  perform tstj.ok(tstj.count('select 1 from public.job_applications') = 0, 'atendente não vê candidaturas');
  perform tstj.login(p2);
  a2 := public.apply_to_job(j1, 'Pedro Dois', '35999990002');
  perform tstj.ok(tstj.count('select 1 from public.job_applications') = 1, 'candidato vê só a própria candidatura');
  perform tstj.denied(format($q$select public.update_application_status(%L, 'hired')$q$, a2), 'candidato se aprova');
  perform tstj.login(own);
  perform tstj.ok(tstj.count('select 1 from public.job_applications') = 2, 'dono vê candidaturas');
  perform public.update_application_status(a1, 'interview', 'Quinta às 14h');
  perform tstj.denied(format($q$select public.update_application_status(%L, 'withdrawn')$q$, a1), 'loja marca desistência', array['P0001']);
  perform tstj.login(p2);
  perform public.withdraw_application(a2);
  perform tstj.login(own);
  perform tstj.denied(format($q$select public.update_application_status(%L, 'hired')$q$, a2), 'aprova quem desistiu', array['P0001']);
  perform tstj.su();
  perform tstj.ok(tstj.count(format($q$select 1 from public.notifications where user_id in (%L, %L) and kind = 'job_application'$q$, own, mgr)) = 4,
                  'dono e gerente notificados das candidaturas');
  perform tstj.ok(tstj.count(format($q$select 1 from public.notifications where user_id = %L and kind = 'job_update' and link = %L$q$, p1, '/vagas/' || j1)) = 1,
                  'candidato notificado do andamento');

  -- 4. encerramento pela plataforma e pela loja
  perform tstj.login(op);
  perform tstj.denied(format($q$select public.set_job_status(%L, 'paused')$q$, j1), 'operador pausa vaga');
  perform public.set_job_status(j1, 'closed', 'Conteúdo irregular');
  perform tstj.login(own);
  perform tstj.denied(format($q$select public.set_job_status(%L, 'open')$q$, j1), 'reabre vaga encerrada', array['P0001']);
  perform tstj.anon();
  perform tstj.ok(tstj.count('select 1 from public.jobs') = 0, 'vaga encerrada sai do ar');

  -- 5. LGPD: exportação e anonimização
  perform tstj.login(p1);
  ex := public.my_data_export();
  perform tstj.ok(jsonb_array_length(ex->'commerce'->'job_applications') = 1 and ex->'commerce' ? 'orders', 'exportação inclui candidaturas e pedidos');
  perform tstj.su();
  perform private.anonymize_user(p1);
  perform tstj.ok(tstj.count(format('select 1 from public.job_applications where applicant_id = %L', p1)) = 0, 'anonimização remove candidaturas');
end $$;

do $$ begin raise notice 'RLS_JOBS_OK'; end $$;
rollback;
