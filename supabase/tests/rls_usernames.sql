-- Testes da 0016 (login com nome de usuário). Tudo é revertido. Sucesso: NOTICE 'RLS_USERNAMES_OK'.
begin;
create schema tstu;
grant usage on schema tstu to public;
create function tstu.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
create function tstu.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tstu.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstu.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstu.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
grant execute on all functions in schema tstu to public;

do $$
declare a uuid; b uuid;
begin
  a := private.create_auth_user('ana@teste.example.com', 'senha-da-ana-1', 'Ana');
  b := private.create_auth_user('bia@teste.example.com', 'senha-da-bia-1', 'Bia');
  -- nome de usuário vindo do cadastro: válido e livre é aproveitado; reservado é ignorado
  insert into auth.users(id, email, raw_user_meta_data) values ('88880000-0000-0000-0000-0000000000c1', 'cad@teste.example.com', '{"username":"Carlos.Silva"}');
  insert into auth.users(id, email, raw_user_meta_data) values ('88880000-0000-0000-0000-0000000000c2', 'res@teste.example.com', '{"username":"admin"}');
  insert into auth.users(id, email, raw_user_meta_data) values ('88880000-0000-0000-0000-0000000000c3', 'dup@teste.example.com', '{"username":"carlos.silva"}');
  perform tstu.ok((select username from public.profiles where id = '88880000-0000-0000-0000-0000000000c1') = 'carlos.silva', 'cadastro grava usuário em minúsculas');
  perform tstu.ok((select username from public.profiles where id = '88880000-0000-0000-0000-0000000000c2') is null, 'nome reservado ignorado no cadastro');
  perform tstu.ok((select username from public.profiles where id = '88880000-0000-0000-0000-0000000000c3') is null, 'nome repetido não impede o cadastro');

  perform tstu.login(a);
  perform tstu.ok(public.set_my_username('Ana.Souza') = 'ana.souza', 'define o próprio usuário');
  perform tstu.denied($q$select public.set_my_username('admin')$q$, 'usuário reservado', array['P0001']);
  perform tstu.denied($q$select public.set_my_username('a b')$q$, 'formato inválido', array['P0001']);
  perform tstu.denied($q$update public.profiles set username = 'outro' where id = auth.uid()$q$, 'atualização direta do usuário');
  perform tstu.login(b);
  perform tstu.denied($q$select public.set_my_username('ANA.SOUZA')$q$, 'usuário já em uso (sem diferenciar maiúsculas)', array['P0001']);

  perform tstu.anon();
  perform tstu.ok(public.resolve_login('ANA.souza', 'senha-da-ana-1') = 'ana@teste.example.com', 'senha certa devolve o e-mail (sem diferenciar maiúsculas)');
  perform tstu.ok(public.resolve_login('ana.souza', 'senha-errada') is null, 'senha errada não revela o e-mail');
  perform tstu.ok(public.resolve_login('ninguem', 'qualquer') is null, 'usuário inexistente');
  perform tstu.ok(public.username_available('ana.souza') = false and public.username_available('livre.123') and not public.username_available('Admin'), 'disponibilidade');
  perform tstu.denied($q$select public.set_my_username('x123')$q$, 'anon define usuário');
  perform tstu.denied($q$select username from public.profiles$q$, 'anon lê usuários');
  -- limite de tentativas por usuário
  perform public.resolve_login('ana.souza', 'errada') from generate_series(1, 8);
  perform tstu.denied($q$select public.resolve_login('ana.souza', 'senha-da-ana-1')$q$, 'tentativas ilimitadas', array['PT429']);
  perform tstu.su();
  perform tstu.ok(not has_function_privilege('anon', 'private.username_reserved(text)', 'execute'), 'função interna exposta');
end $$;

do $$ begin raise notice 'RLS_USERNAMES_OK'; end $$;
rollback;
