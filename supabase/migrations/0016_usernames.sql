-- 0016_usernames: login com e-mail OU nome de usuário.
--  * profiles.username: opcional, único, sem diferenciar maiúsculas (guardado em minúsculas).
--    É só para entrar na conta; não é exibido publicamente (o @ do Conectuaí é outro campo).
--  * resolve_login(usuário, senha): devolve o e-mail da conta SOMENTE se a senha conferir.
--    Assim ninguém descobre o e-mail de outra pessoa testando nomes de usuário.
--    Tentativas limitadas por nome de usuário; a senha continua sendo conferida de novo pelo Supabase Auth.
--  * Nomes reservados (admin, suporte...) não podem ser escolhidos pelo app; só via SQL.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('account.username', 20, 3600);

alter table public.profiles add column username text check (username is null or username ~ '^[a-z0-9._]{3,30}$');
create unique index profiles_username_idx on public.profiles(username);

create or replace function private.username_reserved(_u text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(_u) = any(array['admin', 'administrador', 'administracao', 'root', 'suporte', 'ajuda', 'tucai', 'equipe',
                               'master', 'sistema', 'moderacao', 'moderador', 'contato', 'seguranca'])
$$;
revoke all on function private.username_reserved(text) from public, anon, authenticated;

create or replace function public.resolve_login(_username text, _password text) returns text
language plpgsql security definer set search_path = '' as $$
declare u text := lower(btrim(coalesce(_username, ''))); mail text; hash text;
begin
  if u !~ '^[a-z0-9._]{3,30}$' or coalesce(_password, '') = '' then return null; end if;
  perform private.rate_limit('login.username:' || u, 10, 900);
  select au.email, au.encrypted_password into mail, hash
    from public.profiles p join auth.users au on au.id = p.id
   where p.username = u and (au.banned_until is null or au.banned_until < now());
  if hash is null then
    perform extensions.crypt(_password, extensions.gen_salt('bf'));  -- mesmo custo com ou sem conta
    return null;
  end if;
  if hash = extensions.crypt(_password, hash) then return mail; end if;
  return null;
end $$;

-- disponibilidade (não revela e-mail nem nada da conta)
create or replace function public.username_available(_username text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare u text := lower(btrim(coalesce(_username, '')));
begin
  if u !~ '^[a-z0-9._]{3,30}$' or private.username_reserved(u) then return false; end if;
  return not exists (select 1 from public.profiles where username = u);
end $$;

create or replace function public.set_my_username(_username text) returns text
language plpgsql security definer set search_path = '' as $$
declare u text := nullif(lower(btrim(coalesce(_username, ''))), '');
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('account.username');
  if u is not null and u !~ '^[a-z0-9._]{3,30}$' then
    raise exception 'Use de 3 a 30 letras minúsculas, números, ponto ou sublinhado.' using errcode = 'P0001';
  end if;
  if u is not null and private.username_reserved(u) then raise exception 'Este nome de usuário é reservado.' using errcode = 'P0001'; end if;
  update public.profiles set username = u where id = auth.uid();
  return u;
exception when unique_violation then
  raise exception 'Este nome de usuário já está em uso.' using errcode = 'P0001';
end $$;

-- cadastro: aproveita o nome de usuário informado, se válido e livre (nunca impede a criação da conta)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u text := lower(btrim(coalesce(new.raw_user_meta_data->>'username', '')));
begin
  insert into public.profiles(id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120));
  insert into public.user_roles(user_id, role) values (new.id, 'customer');
  if u ~ '^[a-z0-9._]{3,30}$' and not private.username_reserved(u) then
    begin
      update public.profiles set username = u where id = new.id;
    exception when unique_violation then null;
    end;
  end if;
  return new;
end $$;

do $$
declare f text;
begin
  revoke all on function public.handle_new_user() from public, anon, authenticated;
  foreach f in array array['public.resolve_login(text, text)', 'public.username_available(text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  revoke all on function public.set_my_username(text) from public, anon;
  grant execute on function public.set_my_username(text) to authenticated;
end $$;
