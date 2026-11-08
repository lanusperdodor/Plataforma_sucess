-- Teste de RLS para rodar com `supabase test db` (pgTAP) em um projeto/local do usuário.
-- STATUS: escrito, AINDA NÃO EXECUTADO (sandbox sem PostgreSQL/Supabase CLI).
begin;
select plan(5);

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@teste.invalid'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@teste.invalid');

select is((select count(*)::int from public.user_roles
           where user_id = '00000000-0000-0000-0000-0000000000a1' and role = 'customer'), 1,
  'novo usuário recebe customer');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok($$insert into public.user_roles(user_id, role)
  values ('00000000-0000-0000-0000-0000000000a1','platform_master')$$, '42501',
  null, 'usuário não se autoatribui platform_master');

select throws_ok($$select public.grant_role('00000000-0000-0000-0000-0000000000a1','platform_master')$$,
  '42501', 'forbidden', 'grant_role exige master');

select is((select count(*)::int from public.profiles), 1, 'vê somente o próprio perfil');
select is((select count(*)::int from public.audit_logs), 0, 'não lê auditoria');

select * from finish();
rollback;
