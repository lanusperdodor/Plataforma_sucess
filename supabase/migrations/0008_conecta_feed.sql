-- 0008_conecta_feed: Tucaí Conecta — perfis sociais, feed, comentários, curtidas, salvos,
-- seguir (pessoas e estabelecimentos), bloqueio, denúncias, moderação humana com contestação,
-- suspensão e notificações. Reutiliza auth.users, businesses, products e cities.
-- Princípios: críticas legítimas são permitidas; nada é removido automaticamente; termos de
-- ameaça explícita só geram sinalização para revisão humana.

-- ---------- perfis sociais ----------
create table public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 60),
  bio text check (bio is null or char_length(bio) <= 300),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://[^\s<>"'']+$'),
  -- cidade só aparece se a própria pessoa informar (nulo = não divulgada)
  city_id uuid references public.cities(id) on delete set null,
  -- perfil fechado: publicações só para seguidores
  is_public boolean not null default true,
  conecta_suspended_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index social_profiles_city_idx on public.social_profiles(city_id);
create trigger social_profiles_updated before update on public.social_profiles
  for each row execute function public.set_updated_at();

-- ---------- seguir e bloquear ----------
create table public.follows (
  follower_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  followee_id uuid not null references public.social_profiles(user_id) on delete cascade,
  -- perfil fechado: a seguida fica pendente até a pessoa aprovar
  status text not null default 'accepted' check (status in ('accepted', 'pending')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows(followee_id);

create table public.business_follows (
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);
create index business_follows_business_idx on public.business_follows(business_id);

create table public.user_blocks (
  blocker_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks(blocked_id);

create or replace function public.is_blocked_between(_a uuid, _b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_blocks
                  where (blocker_id = _a and blocked_id = _b) or (blocker_id = _b and blocked_id = _a))
$$;

-- O usuário atual pode ver conteúdo deste autor? (perfil aberto ou seguidor, e sem bloqueio)
create or replace function public.conecta_can_see(_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select _author = auth.uid()
      or (not public.is_blocked_between(_author, auth.uid())
          and exists (select 1 from public.social_profiles p where p.user_id = _author
                        and (p.is_public or exists (select 1 from public.follows f
                                                     where f.follower_id = auth.uid() and f.followee_id = _author
                                                       and f.status = 'accepted'))))
$$;

-- ---------- publicações ----------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  -- publicação em nome de um estabelecimento (exige permissão no estabelecimento)
  business_id uuid references public.businesses(id) on delete cascade,
  product_id uuid,
  city_id uuid references public.cities(id) on delete set null,
  shared_post_id uuid references public.posts(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  -- patrocínio só pode ser marcado pela plataforma (campanhas); nunca pelo autor
  is_sponsored boolean not null default false,
  status text not null default 'published' check (status in ('published', 'hidden')),
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  check (product_id is null or business_id is not null),
  foreign key (product_id, business_id) references public.products(id, business_id) on delete set null (product_id)
);
create index posts_city_created_idx on public.posts(city_id, created_at desc, id desc);
create index posts_author_created_idx on public.posts(author_id, created_at desc);
create index posts_business_idx on public.posts(business_id, created_at desc);
create index posts_shared_idx on public.posts(shared_post_id);
create index posts_product_idx on public.posts(product_id, business_id);
create index posts_created_idx on public.posts(created_at desc, id desc);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  parent_id uuid references public.post_comments(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index post_comments_post_idx on public.post_comments(post_id, created_at);
create index post_comments_author_idx on public.post_comments(author_id);
create index post_comments_parent_idx on public.post_comments(parent_id);

create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes(user_id);

create table public.post_saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_saves_user_idx on public.post_saves(user_id, created_at desc);

-- ---------- notificações ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('like', 'comment', 'reply', 'follow', 'moderation')),
  actor_id uuid references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  message text check (message is null or char_length(message) <= 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_actor_idx on public.notifications(actor_id);
create index notifications_post_idx on public.notifications(post_id);
create index notifications_comment_idx on public.notifications(comment_id);

create or replace function private.notify(_user uuid, _kind text, _actor uuid, _post uuid, _comment uuid, _message text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if _user is null or _user = _actor then return; end if;
  if _actor is not null and public.is_blocked_between(_user, _actor) then return; end if;
  -- evita enxurrada: uma curtida/seguida não lida do mesmo autor basta
  if _kind in ('like', 'follow') and exists (
       select 1 from public.notifications where user_id = _user and kind = _kind and actor_id = _actor
          and post_id is not distinct from _post and read_at is null) then
    return;
  end if;
  insert into public.notifications(user_id, kind, actor_id, post_id, comment_id, message)
  values (_user, _kind, _actor, _post, _comment, _message);
end $$;

-- ---------- denúncias, moderação e contestação ----------
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  -- nulo = sinalização automática para revisão humana
  reporter_id uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('post', 'comment', 'profile')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'threat', 'sexual', 'false_info', 'other', 'auto_flag')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index content_reports_status_idx on public.content_reports(status, created_at);
create index content_reports_target_idx on public.content_reports(target_type, target_id);
create index content_reports_reporter_idx on public.content_reports(reporter_id);
create index content_reports_resolved_by_idx on public.content_reports(resolved_by);
create unique index content_reports_one_open_idx on public.content_reports(reporter_id, target_type, target_id)
  where status = 'open' and reporter_id is not null;

create table public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'suspension')),
  target_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  status text not null default 'open' check (status in ('open', 'upheld', 'reversed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index moderation_appeals_status_idx on public.moderation_appeals(status, created_at);
create index moderation_appeals_author_idx on public.moderation_appeals(author_id);
create index moderation_appeals_resolved_by_idx on public.moderation_appeals(resolved_by);
create unique index moderation_appeals_one_open_idx on public.moderation_appeals(author_id, target_type, target_id) where status = 'open';

-- limites de uso do Conecta (somam-se aos da 0006)
create or replace function private.limit_for(_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  case _action
    when 'business.submit'      then perform private.rate_limit(_action, 5, 3600);
    when 'admin.review'         then perform private.rate_limit(_action, 120, 600);
    when 'admin.city'           then perform private.rate_limit(_action, 60, 600);
    when 'admin.staff'          then perform private.rate_limit(_action, 60, 600);
    when 'admin.role'           then perform private.rate_limit(_action, 30, 600);
    when 'admin.setting'        then perform private.rate_limit(_action, 30, 600);
    when 'admin.privacy'        then perform private.rate_limit(_action, 60, 600);
    when 'privacy.request'      then perform private.rate_limit(_action, 5, 86400);
    when 'privacy.export'       then perform private.rate_limit(_action, 10, 3600);
    when 'conecta.post'         then perform private.rate_limit(_action, 10, 600);
    when 'conecta.comment'      then perform private.rate_limit(_action, 30, 600);
    when 'conecta.like'         then perform private.rate_limit(_action, 200, 600);
    when 'conecta.follow'       then perform private.rate_limit(_action, 60, 600);
    when 'conecta.report'       then perform private.rate_limit(_action, 20, 86400);
    when 'conecta.appeal'       then perform private.rate_limit(_action, 5, 86400);
    when 'admin.moderation'     then perform private.rate_limit(_action, 300, 600);
    else raise exception 'rate limit não configurado: %', _action;
  end case;
end $$;

-- Sinalização conservadora: só ameaças explícitas; não bloqueia, vai para revisão humana.
create or replace function private.needs_review(_text text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(_text) ~ '(vou|vamos) (te|lhe) (matar|esfaquear|dar um tiro)|(te|vou) (achar|pegar) na rua|merece morrer'
$$;

create or replace function private.conecta_author_guard() returns void
language plpgsql stable security definer set search_path = '' as $$
declare until timestamptz;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select conecta_suspended_until into until from public.social_profiles where user_id = auth.uid();
  if not found then
    raise exception 'Crie seu perfil no Conecta antes de interagir.' using errcode = 'P0001';
  end if;
  if until is not null and until > now() then
    raise exception 'Sua conta está suspensa no Conecta até %. Você pode contestar a decisão.',
      to_char(until at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') using errcode = 'P0001';
  end if;
end $$;

-- ---------- gatilhos de publicações ----------
create or replace function private.posts_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.post');
  new.body := btrim(new.body);
  new.is_sponsored := false;
  new.status := 'published';
  new.like_count := 0;
  new.comment_count := 0;
  if new.business_id is not null then
    if not (public.has_business_permission(new.business_id, 'store.customize') or public.has_business_permission(new.business_id, 'settings.manage')) then
      raise exception 'Você não pode publicar em nome deste estabelecimento.' using errcode = '42501';
    end if;
    if not public.is_active_business(new.business_id) then
      raise exception 'O estabelecimento precisa estar aprovado para publicar.' using errcode = 'P0001';
    end if;
  end if;
  if new.shared_post_id is not null and not exists (
       select 1 from public.posts p where p.id = new.shared_post_id and p.status = 'published' and public.conecta_can_see(p.author_id)) then
    raise exception 'Publicação compartilhada indisponível.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.posts where author_id = new.author_id and body = new.body
               and created_at > now() - interval '10 minutes') then
    raise exception 'Você acabou de publicar este mesmo texto.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.posts_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.needs_review(new.body) then
    insert into public.content_reports(reporter_id, target_type, target_id, reason)
    values (null, 'post', new.id, 'auto_flag');
  end if;
  return null;
end $$;

create or replace function private.posts_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- só o texto é editável pelo autor (grant por coluna); status/contadores vêm de funções internas
  if new.body is distinct from old.body then
    if old.status = 'hidden' then
      raise exception 'Publicação ocultada pela moderação não pode ser editada. Conteste a decisão.' using errcode = 'P0001';
    end if;
    new.body := btrim(new.body);
    new.edited_at := now();
  end if;
  return new;
end $$;

create trigger posts_before_insert before insert on public.posts for each row execute function private.posts_before_insert();
create trigger posts_after_insert after insert on public.posts for each row execute function private.posts_after_insert();
create trigger posts_before_update before update on public.posts for each row execute function private.posts_before_update();

-- ---------- gatilhos de comentários ----------
create or replace function private.comments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid; post_status text; parent public.post_comments%rowtype;
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.comment');
  new.body := btrim(new.body);
  new.status := 'published';
  select author_id, status into post_author, post_status from public.posts where id = new.post_id;
  if post_author is null or post_status <> 'published' or not public.conecta_can_see(post_author) then
    raise exception 'Publicação indisponível.' using errcode = 'P0001';
  end if;
  if new.parent_id is not null then
    select * into parent from public.post_comments where id = new.parent_id;
    if not found or parent.post_id <> new.post_id or parent.parent_id is not null or parent.status <> 'published' then
      raise exception 'Resposta inválida.' using errcode = 'P0001';
    end if;
    if public.is_blocked_between(parent.author_id, auth.uid()) then
      raise exception 'Não é possível responder a este comentário.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function private.comments_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid; parent_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id returning author_id into post_author;
    if new.parent_id is not null then
      select author_id into parent_author from public.post_comments where id = new.parent_id;
      perform private.notify(parent_author, 'reply', new.author_id, new.post_id, new.id);
    end if;
    if post_author is distinct from parent_author then
      perform private.notify(post_author, 'comment', new.author_id, new.post_id, new.id);
    end if;
    if private.needs_review(new.body) then
      insert into public.content_reports(reporter_id, target_type, target_id, reason) values (null, 'comment', new.id, 'auto_flag');
    end if;
  elsif tg_op = 'DELETE' then
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;

create or replace function private.comments_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- só o texto é editável pelo autor (grant por coluna); status/contadores vêm de funções internas
  if new.body is distinct from old.body then
    if old.status = 'hidden' then
      raise exception 'Comentário ocultado pela moderação não pode ser editado.' using errcode = 'P0001';
    end if;
    new.body := btrim(new.body);
    new.edited_at := now();
  end if;
  return new;
end $$;

create trigger comments_before_insert before insert on public.post_comments for each row execute function private.comments_before_insert();
create trigger comments_after_change after insert or delete on public.post_comments for each row execute function private.comments_after_change();
create trigger comments_before_update before update on public.post_comments for each row execute function private.comments_before_update();

-- ---------- curtidas, seguidas, bloqueios ----------
create or replace function private.likes_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid; post_status text;
begin
  perform private.conecta_author_guard();
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.like');
  select author_id, status into post_author, post_status from public.posts where id = new.post_id;
  if post_author is null or post_status <> 'published' or not public.conecta_can_see(post_author) then
    raise exception 'Publicação indisponível.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.likes_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id returning author_id into post_author;
    perform private.notify(post_author, 'like', new.user_id, new.post_id, null);
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;

create trigger likes_before_insert before insert on public.post_likes for each row execute function private.likes_before_insert();
create trigger likes_after_change after insert or delete on public.post_likes for each row execute function private.likes_after_change();

create or replace function private.saves_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare post_author uuid;
begin
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  select author_id into post_author from public.posts where id = new.post_id and status = 'published';
  if post_author is null or not public.conecta_can_see(post_author) then
    raise exception 'Publicação indisponível.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger saves_before_insert before insert on public.post_saves for each row execute function private.saves_before_insert();

create or replace function private.follows_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.follower_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.follow');
  if public.is_blocked_between(new.follower_id, new.followee_id) then
    raise exception 'Não é possível seguir este perfil.' using errcode = 'P0001';
  end if;
  new.status := case when exists (select 1 from public.social_profiles where user_id = new.followee_id and not is_public)
                     then 'pending' else 'accepted' end;
  return new;
end $$;
-- só quem é seguido aprova (pending -> accepted); recusar = apagar a linha
create or replace function private.follows_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'accepted' or old.status <> 'pending' then
    raise exception 'Alteração inválida.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function private.follows_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.followee_id, 'follow', new.follower_id, null, null,
    case when new.status = 'pending' then 'quer seguir você. Aprove ou recuse em Seguidores.' end);
  return null;
end $$;
create trigger follows_before_insert before insert on public.follows for each row execute function private.follows_before_insert();
create trigger follows_after_insert after insert on public.follows for each row execute function private.follows_after_insert();
create trigger follows_before_update before update on public.follows for each row execute function private.follows_before_update();

create or replace function private.business_follows_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.follow');
  if not public.is_active_business(new.business_id) then
    raise exception 'Estabelecimento indisponível.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger business_follows_before_insert before insert on public.business_follows for each row execute function private.business_follows_before_insert();

-- bloquear desfaz as seguidas nos dois sentidos
create or replace function private.blocks_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.follows where (follower_id = new.blocker_id and followee_id = new.blocked_id)
                               or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return null;
end $$;
create trigger blocks_after_insert after insert on public.user_blocks for each row execute function private.blocks_after_insert();

-- ---------- denúncias e contestação (titular) ----------
create or replace function public.report_content(_target_type text, _target_id uuid, _reason text, _details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.report');
  if _reason = 'auto_flag' or _reason is null then raise exception 'Motivo inválido.' using errcode = 'P0001'; end if;
  if char_length(coalesce(_details, '')) > 1000 then raise exception 'Texto muito longo.' using errcode = 'P0001'; end if;
  if not ((_target_type = 'post' and exists (select 1 from public.posts where id = _target_id))
       or (_target_type = 'comment' and exists (select 1 from public.post_comments where id = _target_id))
       or (_target_type = 'profile' and exists (select 1 from public.social_profiles where user_id = _target_id))) then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0001';
  end if;
  insert into public.content_reports(reporter_id, target_type, target_id, reason, details)
  values (auth.uid(), _target_type, _target_id, _reason, nullif(btrim(coalesce(_details, '')), ''))
  on conflict do nothing
  returning id into new_id;
  if new_id is null then raise exception 'Você já denunciou este conteúdo; a denúncia está em análise.' using errcode = 'P0001'; end if;
  return new_id;
end $$;

create or replace function public.appeal_moderation(_target_type text, _target_id uuid, _reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conecta.appeal');
  if not ((_target_type = 'post' and exists (select 1 from public.posts where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'comment' and exists (select 1 from public.post_comments where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'suspension' and _target_id = uid and exists (select 1 from public.social_profiles
                                                                      where user_id = uid and conecta_suspended_until > now()))) then
    raise exception 'Não há decisão de moderação para contestar.' using errcode = 'P0001';
  end if;
  insert into public.moderation_appeals(author_id, target_type, target_id, reason)
  values (uid, _target_type, _target_id, btrim(coalesce(_reason, '')))
  on conflict do nothing returning id into new_id;
  if new_id is null then raise exception 'Já existe uma contestação em análise.' using errcode = 'P0001'; end if;
  return new_id;
end $$;

-- ---------- moderação (equipe com moderation.manage + MFA) ----------
create or replace function public.admin_list_reports(_status text default 'open')
returns table (id uuid, target_type text, target_id uuid, reason text, details text, status text, created_at timestamptz,
               reporter_email text, content_body text, content_status text, author_id uuid, author_handle text, open_reports bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('moderation.manage');
  return query
    select r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at, u.email::text,
           coalesce(p.body, c.body, sp.bio, ''),
           coalesce(p.status, c.status, 'published'),
           coalesce(p.author_id, c.author_id, sp.user_id),
           coalesce(pa.handle, ca.handle, sp.handle),
           (select count(*) from public.content_reports x where x.target_type = r.target_type and x.target_id = r.target_id and x.status = 'open')
      from public.content_reports r
      left join auth.users u on u.id = r.reporter_id
      left join public.posts p on r.target_type = 'post' and p.id = r.target_id
      left join public.social_profiles pa on pa.user_id = p.author_id
      left join public.post_comments c on r.target_type = 'comment' and c.id = r.target_id
      left join public.social_profiles ca on ca.user_id = c.author_id
      left join public.social_profiles sp on r.target_type = 'profile' and sp.user_id = r.target_id
     where _status is null or r.status = _status
     order by r.created_at
     limit 200;
end $$;

create or replace function private.set_content_status(_type text, _id uuid, _status text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare author uuid;
begin
  if _type = 'post' then
    update public.posts set status = _status where id = _id returning author_id into author;
  elsif _type = 'comment' then
    update public.post_comments set status = _status where id = _id returning author_id into author;
  end if;
  return author;
end $$;

-- action: 'dismiss' (sem violação) | 'hide' (oculta o conteúdo). Resolve todas as denúncias abertas do alvo.
create or replace function public.admin_moderate(_report uuid, _action text, _note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.content_reports%rowtype; author uuid; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('moderation.manage');
  perform private.limit_for('admin.moderation');
  select * into r from public.content_reports where id = _report for update;
  if not found or r.status <> 'open' then raise exception 'Denúncia não encontrada ou já resolvida.' using errcode = 'P0001'; end if;
  if note is null then raise exception 'Registre o motivo da decisão.' using errcode = 'P0001'; end if;
  if _action not in ('dismiss', 'hide') then raise exception 'Ação inválida.' using errcode = 'P0001'; end if;
  if _action = 'hide' then
    if r.target_type = 'profile' then raise exception 'Para perfis, use a suspensão.' using errcode = 'P0001'; end if;
    author := private.set_content_status(r.target_type, r.target_id, 'hidden');
    if author = auth.uid() then raise exception 'Você não pode moderar o próprio conteúdo.' using errcode = '42501'; end if;
    perform private.notify(author, 'moderation', null,
      case when r.target_type = 'post' then r.target_id end, case when r.target_type = 'comment' then r.target_id end,
      'Seu conteúdo foi ocultado por violar as regras do Conecta: ' || note || ' Você pode contestar.');
  end if;
  update public.content_reports
     set status = case when _action = 'hide' then 'actioned' else 'dismissed' end,
         resolution_note = note, resolved_by = auth.uid(), resolved_at = now()
   where target_type = r.target_type and target_id = r.target_id and status = 'open';
  perform private.audit('moderation.' || _action, r.target_type, r.target_id::text, jsonb_build_object('report', r.id, 'reason', r.reason));
end $$;

create or replace function public.admin_suspend_user(_user uuid, _until timestamptz, _note text)
returns void language plpgsql security definer set search_path = '' as $$
declare note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('moderation.manage');
  perform private.limit_for('admin.moderation');
  if _user = auth.uid() then raise exception 'Você não pode suspender a si mesmo.' using errcode = '42501'; end if;
  if note is null then raise exception 'Registre o motivo da decisão.' using errcode = 'P0001'; end if;
  if _until is not null and (_until <= now() or _until > now() + interval '365 days') then
    raise exception 'Prazo inválido (até 365 dias).' using errcode = 'P0001';
  end if;
  update public.social_profiles set conecta_suspended_until = _until where user_id = _user;
  if not found then raise exception 'Perfil não encontrado.' using errcode = 'P0001'; end if;
  perform private.notify(_user, 'moderation', null, null, null,
    case when _until is null then 'Sua suspensão no Conecta foi encerrada.'
         else 'Sua conta foi suspensa no Conecta: ' || note || ' Você pode contestar.' end);
  perform private.audit(case when _until is null then 'moderation.unsuspend' else 'moderation.suspend' end,
                        'social_profiles', _user::text, jsonb_build_object('until', _until));
end $$;

create or replace function public.admin_list_appeals(_status text default 'open')
returns table (id uuid, author_id uuid, author_handle text, target_type text, target_id uuid, reason text, status text,
               content_body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('moderation.manage');
  return query
    select a.id, a.author_id, sp.handle, a.target_type, a.target_id, a.reason, a.status,
           coalesce(p.body, c.body, ''), a.created_at
      from public.moderation_appeals a
      left join public.social_profiles sp on sp.user_id = a.author_id
      left join public.posts p on a.target_type = 'post' and p.id = a.target_id
      left join public.post_comments c on a.target_type = 'comment' and c.id = a.target_id
     where _status is null or a.status = _status
     order by a.created_at
     limit 200;
end $$;

-- decision: 'uphold' (mantém) | 'reverse' (desfaz: republica ou encerra a suspensão)
create or replace function public.admin_resolve_appeal(_appeal uuid, _decision text, _note text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.moderation_appeals%rowtype; note text := nullif(btrim(coalesce(_note, '')), '');
begin
  perform private.require_permission('moderation.manage');
  perform private.limit_for('admin.moderation');
  select * into a from public.moderation_appeals where id = _appeal for update;
  if not found or a.status <> 'open' then raise exception 'Contestação não encontrada ou já resolvida.' using errcode = 'P0001'; end if;
  if a.author_id = auth.uid() then raise exception 'Você não pode julgar a própria contestação.' using errcode = '42501'; end if;
  if note is null then raise exception 'Registre o motivo da decisão.' using errcode = 'P0001'; end if;
  if _decision not in ('uphold', 'reverse') then raise exception 'Decisão inválida.' using errcode = 'P0001'; end if;
  if _decision = 'reverse' then
    if a.target_type = 'suspension' then
      update public.social_profiles set conecta_suspended_until = null where user_id = a.author_id;
    else
      perform private.set_content_status(a.target_type, a.target_id, 'published');
    end if;
  end if;
  update public.moderation_appeals
     set status = case when _decision = 'reverse' then 'reversed' else 'upheld' end,
         resolution_note = note, resolved_by = auth.uid(), resolved_at = now()
   where id = a.id;
  perform private.notify(a.author_id, 'moderation', null, null, null,
    case when _decision = 'reverse' then 'Sua contestação foi aceita: ' else 'Sua contestação foi analisada e a decisão foi mantida: ' end || note);
  perform private.audit('moderation.appeal_' || _decision, a.target_type, a.target_id::text, jsonb_build_object('appeal', a.id));
end $$;

-- ---------- RLS ----------
alter table public.social_profiles enable row level security;
alter table public.follows enable row level security;
alter table public.business_follows enable row level security;
alter table public.user_blocks enable row level security;
alter table public.posts enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_saves enable row level security;
alter table public.notifications enable row level security;
alter table public.content_reports enable row level security;
alter table public.moderation_appeals enable row level security;

create policy social_profiles_select on public.social_profiles for select to anon, authenticated
  using (user_id = auth.uid() or not public.is_blocked_between(user_id, auth.uid()));
create policy social_profiles_insert on public.social_profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy social_profiles_update on public.social_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- conexões de perfis fechados não são expostas
create policy follows_select on public.follows for select to anon, authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid()
         or exists (select 1 from public.social_profiles p where p.user_id = followee_id and p.is_public));
create policy follows_insert on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid() or followee_id = auth.uid());
create policy follows_update on public.follows for update to authenticated using (followee_id = auth.uid()) with check (followee_id = auth.uid());

create policy business_follows_select on public.business_follows for select to authenticated
  using (user_id = auth.uid());
create policy business_follows_insert on public.business_follows for insert to authenticated with check (user_id = auth.uid());
create policy business_follows_delete on public.business_follows for delete to authenticated using (user_id = auth.uid());

create policy user_blocks_select on public.user_blocks for select to authenticated using (blocker_id = auth.uid());
create policy user_blocks_insert on public.user_blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy user_blocks_delete on public.user_blocks for delete to authenticated using (blocker_id = auth.uid());

create policy posts_select on public.posts for select to anon, authenticated
  using (author_id = auth.uid() or (status = 'published' and public.conecta_can_see(author_id)));
create policy posts_select_moderation on public.posts for select to authenticated
  using (public.has_platform_permission('moderation.manage'));
create policy posts_insert on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy posts_update on public.posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy posts_delete on public.posts for delete to authenticated using (author_id = auth.uid());

create policy comments_select on public.post_comments for select to anon, authenticated
  using (author_id = auth.uid()
         or (status = 'published' and public.conecta_can_see(author_id)
             and exists (select 1 from public.posts p where p.id = post_id)));
create policy comments_select_moderation on public.post_comments for select to authenticated
  using (public.has_platform_permission('moderation.manage'));
create policy comments_insert on public.post_comments for insert to authenticated with check (author_id = auth.uid());
create policy comments_update on public.post_comments for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
-- o autor do comentário ou o autor da publicação podem apagar
create policy comments_delete on public.post_comments for delete to authenticated
  using (author_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

create policy likes_select on public.post_likes for select to authenticated using (user_id = auth.uid());
create policy likes_insert on public.post_likes for insert to authenticated with check (user_id = auth.uid());
create policy likes_delete on public.post_likes for delete to authenticated using (user_id = auth.uid());

create policy saves_select on public.post_saves for select to authenticated using (user_id = auth.uid());
create policy saves_insert on public.post_saves for insert to authenticated with check (user_id = auth.uid());
create policy saves_delete on public.post_saves for delete to authenticated using (user_id = auth.uid());

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy reports_select on public.content_reports for select to authenticated
  using (reporter_id = auth.uid() or public.has_platform_permission('moderation.manage'));
create policy appeals_select on public.moderation_appeals for select to authenticated
  using (author_id = auth.uid() or public.has_platform_permission('moderation.manage'));

-- ---------- privilégios (por coluna onde há escrita) ----------
revoke all on public.social_profiles, public.follows, public.business_follows, public.user_blocks, public.posts,
  public.post_comments, public.post_likes, public.post_saves, public.notifications, public.content_reports,
  public.moderation_appeals from public, anon, authenticated;

grant select (user_id, handle, display_name, bio, avatar_url, city_id, is_public, created_at) on public.social_profiles to anon, authenticated;
grant insert (user_id, handle, display_name, bio, avatar_url, city_id, is_public) on public.social_profiles to authenticated;
grant update (handle, display_name, bio, avatar_url, city_id, is_public) on public.social_profiles to authenticated;

grant select on public.follows to anon, authenticated;
grant insert (follower_id, followee_id), delete on public.follows to authenticated;
grant update (status) on public.follows to authenticated;
grant select, delete on public.business_follows to authenticated;
grant insert (user_id, business_id) on public.business_follows to authenticated;
grant select, delete on public.user_blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.user_blocks to authenticated;

grant select on public.posts to anon, authenticated;
grant insert (author_id, business_id, product_id, city_id, shared_post_id, body) on public.posts to authenticated;
grant update (body) on public.posts to authenticated;
grant delete on public.posts to authenticated;

grant select on public.post_comments to anon, authenticated;
grant insert (post_id, author_id, parent_id, body) on public.post_comments to authenticated;
grant update (body) on public.post_comments to authenticated;
grant delete on public.post_comments to authenticated;

grant select, delete on public.post_likes, public.post_saves to authenticated;
grant insert (post_id, user_id) on public.post_likes, public.post_saves to authenticated;

grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant select on public.content_reports, public.moderation_appeals to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'private.notify(uuid, text, uuid, uuid, uuid, text)', 'private.needs_review(text)', 'private.conecta_author_guard()',
    'private.posts_before_insert()', 'private.posts_after_insert()', 'private.posts_before_update()',
    'private.comments_before_insert()', 'private.comments_after_change()', 'private.comments_before_update()',
    'private.likes_before_insert()', 'private.likes_after_change()', 'private.saves_before_insert()',
    'private.follows_before_insert()', 'private.follows_after_insert()', 'private.follows_before_update()', 'private.business_follows_before_insert()',
    'private.blocks_after_insert()', 'private.set_content_status(text, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.is_blocked_between(uuid, uuid)', 'public.conecta_can_see(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.report_content(text, uuid, text, text)', 'public.appeal_moderation(text, uuid, text)',
    'public.admin_list_reports(text)', 'public.admin_moderate(uuid, text, text)',
    'public.admin_suspend_user(uuid, timestamptz, text)', 'public.admin_list_appeals(text)',
    'public.admin_resolve_appeal(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- LGPD: Conecta na exportação e na exclusão ----------
create or replace function public.my_data_export() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('privacy.export');
  return jsonb_build_object(
    'generated_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email) from auth.users u where u.id = uid),
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = uid),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.role, 'since', r.created_at)) from public.user_roles r where r.user_id = uid), '[]'::jsonb),
    'business_memberships', coalesce((select jsonb_agg(jsonb_build_object('business', b.name, 'role', m.member_role, 'since', m.created_at))
                                       from public.business_members m join public.businesses b on b.id = m.business_id
                                      where m.user_id = uid), '[]'::jsonb),
    'businesses_owned', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'status', b.status, 'phone', b.phone,
                                                                      'address_line', b.address_line, 'submitted_at', b.submitted_at))
                                   from public.businesses b where b.owner_id = uid), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('rating', v.rating, 'comment', v.comment, 'created_at', v.created_at))
                          from public.reviews v where v.user_id = uid), '[]'::jsonb),
    'privacy_requests', coalesce((select jsonb_agg(jsonb_build_object('kind', q.kind, 'status', q.status, 'created_at', q.created_at,
                                                                      'resolved_at', q.resolved_at, 'resolution_note', q.resolution_note))
                                   from public.privacy_requests q where q.user_id = uid), '[]'::jsonb),
    'conecta', jsonb_build_object(
      'social_profile', (select to_jsonb(s) - 'user_id' from public.social_profiles s where s.user_id = uid),
      'posts', coalesce((select jsonb_agg(jsonb_build_object('body', p.body, 'status', p.status, 'created_at', p.created_at) order by p.created_at)
                          from public.posts p where p.author_id = uid), '[]'::jsonb),
      'comments', coalesce((select jsonb_agg(jsonb_build_object('body', c.body, 'status', c.status, 'created_at', c.created_at) order by c.created_at)
                             from public.post_comments c where c.author_id = uid), '[]'::jsonb),
      'following', coalesce((select jsonb_agg(sp.handle) from public.follows f join public.social_profiles sp on sp.user_id = f.followee_id
                              where f.follower_id = uid and f.status = 'accepted'), '[]'::jsonb),
      'blocked', coalesce((select count(*) from public.user_blocks where blocker_id = uid), 0),
      'reports_sent', coalesce((select count(*) from public.content_reports where reporter_id = uid), 0)),
    'notes', jsonb_build_array(
      'Senha: guardada apenas como hash pelo Supabase Auth; nunca é exportada.',
      'Registros de auditoria e dados fiscais/financeiros podem ser mantidos pelo prazo legal.'));
end $$;

-- Exclusão: além do perfil, remove o perfil social (publicações, comentários, curtidas e
-- seguidas saem em cascata). Denúncias e decisões de moderação ficam como registro.
create or replace function private.anonymize_user(_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set full_name = null, phone = null, preferred_city_id = null where id = _user;
  update public.reviews set author_name = null where user_id = _user;
  delete from public.social_profiles where user_id = _user;
  delete from public.notifications where user_id = _user;
end $$;
revoke all on function private.anonymize_user(uuid) from public, anon, authenticated;
