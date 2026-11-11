-- 0010_conectuai_comunidades: Conectuaí completo — privacidade do perfil, amizades, recados
-- (mural), depoimentos com aprovação, comunidades públicas/privadas com moderadores, tópicos,
-- respostas e enquetes. Reaproveita perfis sociais, bloqueios, denúncias, moderação e
-- notificações da 0008. Depoimentos são pessoais: nunca viram avaliação de estabelecimento.

insert into private.rate_limit_rules(action, max_hits, window_seconds) values
  ('conectuai.friend', 40, 3600), ('conectuai.scrap', 30, 600), ('conectuai.testimonial', 10, 86400),
  ('conectuai.community', 3, 86400), ('conectuai.join', 60, 3600), ('conectuai.topic', 10, 3600),
  ('conectuai.reply', 40, 600), ('conectuai.poll', 5, 86400), ('conectuai.vote', 120, 600),
  ('conectuai.community_mod', 300, 600);

-- ---------- privacidade do perfil ----------
alter table public.social_profiles
  add column wall_enabled boolean not null default true,
  add column wall_audience text not null default 'everyone' check (wall_audience in ('everyone', 'friends')),
  add column show_connections boolean not null default true,
  add column testimonials_enabled boolean not null default true;
grant select (wall_enabled, wall_audience, show_connections, testimonials_enabled) on public.social_profiles to anon, authenticated;
grant update (wall_enabled, wall_audience, show_connections, testimonials_enabled) on public.social_profiles to authenticated;

-- notificações e denúncias ganham os novos tipos
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'like', 'comment', 'reply', 'follow', 'moderation',
  'friend_request', 'friend_accept', 'scrap', 'testimonial', 'community_request', 'community_accept', 'topic_reply'));
alter table public.notifications add column link text check (link is null or link ~ '^/conectuai/[A-Za-z0-9/_-]*$');

alter table public.content_reports drop constraint content_reports_target_type_check;
alter table public.content_reports add constraint content_reports_target_type_check check (target_type in (
  'post', 'comment', 'profile', 'community', 'topic', 'reply', 'scrap', 'testimonial'));
alter table public.moderation_appeals drop constraint moderation_appeals_target_type_check;
alter table public.moderation_appeals add constraint moderation_appeals_target_type_check check (target_type in (
  'post', 'comment', 'suspension', 'topic', 'reply', 'scrap', 'community'));

-- Marca interna da transação para operações do próprio sistema (criação da comunidade,
-- moderação). Não é alcançável pela API: set_config não é exposto pelo PostgREST.
create or replace function private.internal_on() returns boolean
language sql stable set search_path = '' as $$ select current_setting('tucai.internal', true) = 'on' $$;

create or replace function private.notify_link(_user uuid, _kind text, _actor uuid, _link text, _message text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if _user is null or _user = _actor then return; end if;
  if _actor is not null and public.is_blocked_between(_user, _actor) then return; end if;
  insert into public.notifications(user_id, kind, actor_id, link, message) values (_user, _kind, _actor, _link, _message);
end $$;

-- ---------- amizades ----------
create table public.friendships (
  requester_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  addressee_id uuid not null references public.social_profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create index friendships_addressee_idx on public.friendships(addressee_id, status);
-- um único vínculo por par, em qualquer direção
create unique index friendships_pair_idx on public.friendships(least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create or replace function public.are_friends(_a uuid, _b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships
                  where status = 'accepted'
                    and ((requester_id = _a and addressee_id = _b) or (requester_id = _b and addressee_id = _a)))
$$;

create or replace function private.friendships_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.requester_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.friend');
  if public.is_blocked_between(new.requester_id, new.addressee_id) then
    raise exception 'Não é possível enviar convite para este perfil.' using errcode = 'P0001';
  end if;
  new.status := 'pending';
  new.responded_at := null;
  return new;
end $$;
create or replace function private.friendships_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'pending' or new.status <> 'accepted' then raise exception 'Alteração inválida.' using errcode = 'P0001'; end if;
  new.responded_at := now();
  return new;
end $$;
create or replace function private.friendships_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  if tg_op = 'INSERT' then
    select handle into h from public.social_profiles where user_id = new.requester_id;
    perform private.notify_link(new.addressee_id, 'friend_request', new.requester_id, '/conectuai/amigos');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' then
    select handle into h from public.social_profiles where user_id = new.addressee_id;
    perform private.notify_link(new.requester_id, 'friend_accept', new.addressee_id, '/conectuai/u/' || h);
  end if;
  return null;
end $$;
create trigger friendships_before_insert before insert on public.friendships for each row execute function private.friendships_before_insert();
create trigger friendships_before_update before update on public.friendships for each row execute function private.friendships_before_update();
create trigger friendships_after_change after insert or update on public.friendships for each row execute function private.friendships_after_change();

-- bloquear desfaz amizade
create or replace function private.blocks_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.follows where (follower_id = new.blocker_id and followee_id = new.blocked_id)
                               or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  delete from public.friendships where (requester_id = new.blocker_id and addressee_id = new.blocked_id)
                                   or (requester_id = new.blocked_id and addressee_id = new.blocker_id);
  return null;
end $$;

-- ---------- recados (mural) ----------
create table public.scraps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.social_profiles(user_id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  parent_id uuid references public.scraps(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now()
);
create index scraps_owner_idx on public.scraps(owner_id, created_at desc);
create index scraps_author_idx on public.scraps(author_id);
create index scraps_parent_idx on public.scraps(parent_id);

create or replace function public.can_see_wall(_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select _owner = auth.uid() or exists (
    select 1 from public.social_profiles p where p.user_id = _owner and p.wall_enabled
       and not public.is_blocked_between(_owner, auth.uid())
       and (p.wall_audience = 'everyone' or public.are_friends(_owner, auth.uid())))
$$;

create or replace function private.scraps_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent public.scraps%rowtype;
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.scrap');
  new.body := btrim(new.body);
  new.status := 'published';
  if not exists (select 1 from public.social_profiles where user_id = new.owner_id and wall_enabled) then
    raise exception 'Este mural está desativado.' using errcode = 'P0001';
  end if;
  if new.owner_id <> new.author_id and not public.can_see_wall(new.owner_id) then
    raise exception 'Você não pode deixar recados neste mural.' using errcode = 'P0001';
  end if;
  if new.parent_id is not null then
    select * into parent from public.scraps where id = new.parent_id;
    if not found or parent.owner_id <> new.owner_id or parent.parent_id is not null then
      raise exception 'Resposta inválida.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create or replace function private.scraps_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  select handle into h from public.social_profiles where user_id = new.owner_id;
  perform private.notify_link(new.owner_id, 'scrap', new.author_id, '/conectuai/u/' || h);
  if private.needs_review(new.body) then
    insert into public.content_reports(reporter_id, target_type, target_id, reason) values (null, 'scrap', new.id, 'auto_flag');
  end if;
  return null;
end $$;
create trigger scraps_before_insert before insert on public.scraps for each row execute function private.scraps_before_insert();
create trigger scraps_after_insert after insert on public.scraps for each row execute function private.scraps_after_insert();

-- ---------- depoimentos (aprovados antes de aparecer) ----------
create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.social_profiles(user_id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'hidden')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (recipient_id, author_id),
  check (recipient_id <> author_id)
);
create index testimonials_author_idx on public.testimonials(author_id);
create index testimonials_recipient_idx on public.testimonials(recipient_id, status);

create or replace function private.testimonials_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.testimonial');
  new.body := btrim(new.body);
  new.status := 'pending';
  new.decided_at := null;
  if not exists (select 1 from public.social_profiles where user_id = new.recipient_id and testimonials_enabled) then
    raise exception 'Esta pessoa não recebe depoimentos.' using errcode = 'P0001';
  end if;
  if not public.are_friends(new.author_id, new.recipient_id) then
    raise exception 'Depoimentos são só entre amigos.' using errcode = 'P0001';
  end if;
  return new;
end $$;
-- só quem recebe decide (pendente -> aprovado/recusado); o autor só pode apagar
create or replace function private.testimonials_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.internal_on() then
    if old.recipient_id is distinct from auth.uid() or new.body is distinct from old.body
       or new.status not in ('approved', 'rejected') or old.status = 'hidden' then
      raise exception 'Alteração inválida.' using errcode = 'P0001';
    end if;
  end if;
  new.decided_at := now();
  return new;
end $$;
create or replace function private.testimonials_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_link(new.recipient_id, 'testimonial', new.author_id, '/conectuai/amigos',
                              'escreveu um depoimento para você. Aprove ou recuse.');
  return null;
end $$;
create trigger testimonials_before_insert before insert on public.testimonials for each row execute function private.testimonials_before_insert();
create trigger testimonials_before_update before update on public.testimonials for each row execute function private.testimonials_before_update();
create trigger testimonials_after_insert after insert on public.testimonials for each row execute function private.testimonials_after_insert();

-- ---------- comunidades ----------
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 3 and 80),
  description text check (description is null or char_length(description) <= 1000),
  rules text check (rules is null or char_length(rules) <= 3000),
  category text not null check (category in ('gastronomia', 'comercio', 'promocoes', 'empregos', 'servicos', 'esportes',
                                             'veiculos', 'cultura', 'educacao', 'bairro', 'cidade', 'outros')),
  city_id uuid references public.cities(id) on delete set null,
  is_private boolean not null default false,
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://[^\s<>"'']+$'),
  cover_url text check (cover_url is null or cover_url ~ '^https://[^\s<>"'']+$'),
  -- comerciante pode criar a comunidade do próprio estabelecimento
  business_id uuid references public.businesses(id) on delete set null,
  owner_id uuid not null default auth.uid() references public.social_profiles(user_id),
  status text not null default 'active' check (status in ('active', 'hidden')),
  member_count integer not null default 0 check (member_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index communities_city_idx on public.communities(city_id, member_count desc);
create index communities_category_idx on public.communities(category);
create index communities_owner_idx on public.communities(owner_id);
create index communities_business_idx on public.communities(business_id);
create trigger communities_updated before update on public.communities for each row execute function public.set_updated_at();

create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  status text not null default 'active' check (status in ('active', 'pending', 'banned')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_idx on public.community_members(user_id, status);

create or replace function public.community_role(_community uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.community_members where community_id = _community and user_id = auth.uid() and status = 'active'
$$;
create or replace function public.is_community_mod(_community uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.community_role(_community) in ('owner', 'moderator'), false)
$$;
create or replace function public.can_read_community(_community uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.communities c where c.id = _community and c.status = 'active'
                   and (not c.is_private or public.community_role(c.id) is not null))
$$;

create or replace function private.communities_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.owner_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.community');
  new.name := btrim(new.name);
  new.slug := private.slugify(new.name);
  if exists (select 1 from public.communities where slug = new.slug) then
    new.slug := left(new.slug, 50) || '-' || substr(md5(random()::text), 1, 6);
  end if;
  new.status := 'active';
  new.member_count := 0;
  if new.business_id is not null and not public.has_business_permission(new.business_id, 'store.customize')
     and not public.has_business_permission(new.business_id, 'settings.manage') then
    raise exception 'Você não pode criar comunidade em nome deste estabelecimento.' using errcode = '42501';
  end if;
  return new;
end $$;
create or replace function private.communities_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('tucai.internal', 'on', true);
  insert into public.community_members(community_id, user_id, role, status) values (new.id, new.owner_id, 'owner', 'active');
  perform set_config('tucai.internal', 'off', true);
  perform private.audit('community.create', 'communities', new.id::text, jsonb_build_object('private', new.is_private));
  return null;
end $$;
create trigger communities_before_insert before insert on public.communities for each row execute function private.communities_before_insert();
create trigger communities_after_insert after insert on public.communities for each row execute function private.communities_after_insert();

-- entrar: aberta -> ativo; fechada -> pendente (moderadores aprovam)
create or replace function private.members_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare priv boolean;
begin
  -- a dona entra pela criação da comunidade (operação interna)
  if private.internal_on() and new.role = 'owner'
     and exists (select 1 from public.communities where id = new.community_id and owner_id = new.user_id) then
    return new;
  end if;
  perform private.conecta_author_guard();
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.join');
  select is_private into priv from public.communities where id = new.community_id and status = 'active';
  if priv is null then raise exception 'Comunidade indisponível.' using errcode = 'P0001'; end if;
  new.role := 'member';
  new.status := case when priv then 'pending' else 'active' end;
  return new;
end $$;
create or replace function private.members_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cid uuid := coalesce(new.community_id, old.community_id); s text; mod uuid;
begin
  update public.communities set member_count = (select count(*) from public.community_members
                                                  where community_id = cid and status = 'active') where id = cid;
  if tg_op = 'INSERT' and new.status = 'pending' then
    select slug into s from public.communities where id = cid;
    for mod in select user_id from public.community_members where community_id = cid and role in ('owner', 'moderator') and status = 'active' loop
      perform private.notify_link(mod, 'community_request', new.user_id, '/conectuai/c/' || s);
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    select slug into s from public.communities where id = cid;
    perform private.notify_link(new.user_id, 'community_accept', null, '/conectuai/c/' || s, 'Sua entrada na comunidade foi aprovada.');
  end if;
  return null;
end $$;
create trigger members_before_insert before insert on public.community_members for each row execute function private.members_before_insert();
create trigger members_after_change after insert or update or delete on public.community_members for each row execute function private.members_after_change();

-- ação de moderação da comunidade: aprovar/recusar entrada, promover, rebaixar, banir, desbanir
create or replace function public.community_manage_member(_community uuid, _user uuid, _action text)
returns void language plpgsql security definer set search_path = '' as $$
declare me_role text := public.community_role(_community); target public.community_members%rowtype;
begin
  if me_role is null or me_role not in ('owner', 'moderator') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.community_mod');
  select * into target from public.community_members where community_id = _community and user_id = _user for update;
  if not found then raise exception 'Membro não encontrado.' using errcode = 'P0001'; end if;
  if target.role = 'owner' or (target.role = 'moderator' and me_role <> 'owner') then
    raise exception 'Você não pode alterar este membro.' using errcode = '42501';
  end if;
  if _action = 'approve' and target.status = 'pending' then
    update public.community_members set status = 'active', joined_at = now() where community_id = _community and user_id = _user;
  elsif _action = 'reject' and target.status = 'pending' then
    delete from public.community_members where community_id = _community and user_id = _user;
  elsif _action = 'ban' and target.status <> 'banned' then
    update public.community_members set status = 'banned', role = 'member' where community_id = _community and user_id = _user;
  elsif _action = 'unban' and target.status = 'banned' then
    delete from public.community_members where community_id = _community and user_id = _user;
  elsif _action = 'promote' and me_role = 'owner' and target.status = 'active' and target.role = 'member' then
    update public.community_members set role = 'moderator' where community_id = _community and user_id = _user;
  elsif _action = 'demote' and me_role = 'owner' and target.role = 'moderator' then
    update public.community_members set role = 'member' where community_id = _community and user_id = _user;
  else
    raise exception 'Ação inválida para este membro.' using errcode = 'P0001';
  end if;
  perform private.audit('community.member_' || _action, 'communities', _community::text, jsonb_build_object('user', _user));
end $$;

-- ---------- tópicos, respostas e enquetes ----------
create table public.community_topics (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 140),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  is_pinned boolean not null default false,
  is_locked boolean not null default false,
  status text not null default 'published' check (status in ('published', 'hidden')),
  reply_count integer not null default 0 check (reply_count >= 0),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index community_topics_list_idx on public.community_topics(community_id, is_pinned desc, last_activity_at desc);
create index community_topics_author_idx on public.community_topics(author_id);

create table public.topic_replies (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.community_topics(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 3000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index topic_replies_topic_idx on public.topic_replies(topic_id, created_at);
create index topic_replies_author_idx on public.topic_replies(author_id);

create table public.community_polls (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.social_profiles(user_id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 3 and 200),
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (closes_at > created_at)
);
create index community_polls_community_idx on public.community_polls(community_id, created_at desc);
create index community_polls_author_idx on public.community_polls(author_id);
create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.community_polls(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  position smallint not null,
  vote_count integer not null default 0 check (vote_count >= 0),
  unique (poll_id, position),
  unique (id, poll_id)
);
create table public.poll_votes (
  poll_id uuid not null references public.community_polls(id) on delete cascade,
  option_id uuid not null,
  user_id uuid not null default auth.uid() references public.social_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id),
  foreign key (option_id, poll_id) references public.poll_options(id, poll_id) on delete cascade
);
create index poll_votes_option_idx on public.poll_votes(option_id, poll_id);
create index poll_votes_user_idx on public.poll_votes(user_id);

create or replace function private.topics_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.topic');
  if public.community_role(new.community_id) is null then
    raise exception 'Entre na comunidade para criar tópicos.' using errcode = 'P0001';
  end if;
  new.title := btrim(new.title); new.body := btrim(new.body);
  new.is_pinned := false; new.is_locked := false; new.status := 'published'; new.reply_count := 0; new.last_activity_at := now();
  return new;
end $$;
create or replace function private.topics_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.internal_on() then
    if (new.title is distinct from old.title or new.body is distinct from old.body) then
      if old.author_id <> auth.uid() or old.status = 'hidden' then raise exception 'Alteração inválida.' using errcode = 'P0001'; end if;
      new.edited_at := now();
    end if;
    if (new.is_pinned is distinct from old.is_pinned or new.is_locked is distinct from old.is_locked)
       and not public.is_community_mod(old.community_id) then
      raise exception 'Só moderadores fixam ou trancam tópicos.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create or replace function private.topics_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.needs_review(new.title || ' ' || new.body) then
    insert into public.content_reports(reporter_id, target_type, target_id, reason) values (null, 'topic', new.id, 'auto_flag');
  end if;
  return null;
end $$;
create trigger topics_before_insert before insert on public.community_topics for each row execute function private.topics_before_insert();
create trigger topics_before_update before update on public.community_topics for each row execute function private.topics_before_update();
create trigger topics_after_insert after insert on public.community_topics for each row execute function private.topics_after_insert();

create or replace function private.replies_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.community_topics%rowtype;
begin
  perform private.conecta_author_guard();
  if new.author_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.reply');
  select * into t from public.community_topics where id = new.topic_id;
  if not found or t.status <> 'published' then raise exception 'Tópico indisponível.' using errcode = 'P0001'; end if;
  if t.is_locked then raise exception 'Tópico trancado pelos moderadores.' using errcode = 'P0001'; end if;
  if public.community_role(t.community_id) is null then raise exception 'Entre na comunidade para responder.' using errcode = 'P0001'; end if;
  new.body := btrim(new.body); new.status := 'published';
  return new;
end $$;
create or replace function private.replies_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.community_topics%rowtype; s text;
begin
  if tg_op = 'INSERT' then
    update public.community_topics set reply_count = reply_count + 1, last_activity_at = now() where id = new.topic_id returning * into t;
    select slug into s from public.communities where id = t.community_id;
    perform private.notify_link(t.author_id, 'topic_reply', new.author_id, '/conectuai/c/' || s || '/t/' || t.id);
    if private.needs_review(new.body) then
      insert into public.content_reports(reporter_id, target_type, target_id, reason) values (null, 'reply', new.id, 'auto_flag');
    end if;
  else
    update public.community_topics set reply_count = greatest(reply_count - 1, 0) where id = old.topic_id;
  end if;
  return null;
end $$;
create or replace function private.replies_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.body is distinct from old.body then
    if old.status = 'hidden' then raise exception 'Resposta ocultada pela moderação não pode ser editada.' using errcode = 'P0001'; end if;
    new.body := btrim(new.body); new.edited_at := now();
  end if;
  return new;
end $$;
create trigger replies_before_insert before insert on public.topic_replies for each row execute function private.replies_before_insert();
create trigger replies_after_change after insert or delete on public.topic_replies for each row execute function private.replies_after_change();
create trigger replies_before_update before update on public.topic_replies for each row execute function private.replies_before_update();

create or replace function public.create_poll(_community uuid, _question text, _options text[], _days integer default 7)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pid uuid; i int := 0; opt text; clean text[];
begin
  perform private.conecta_author_guard();
  perform private.limit_for('conectuai.poll');
  if public.community_role(_community) is null then raise exception 'Entre na comunidade para criar enquetes.' using errcode = 'P0001'; end if;
  select array_agg(btrim(o)) into clean from unnest(_options) o where btrim(o) <> '';
  if coalesce(array_length(clean, 1), 0) not between 2 and 6 then
    raise exception 'A enquete precisa de 2 a 6 opções.' using errcode = 'P0001';
  end if;
  if coalesce(_days, 7) not between 1 and 30 then raise exception 'Duração de 1 a 30 dias.' using errcode = 'P0001'; end if;
  insert into public.community_polls(community_id, author_id, question, closes_at)
  values (_community, auth.uid(), btrim(_question), now() + make_interval(days => coalesce(_days, 7))) returning id into pid;
  foreach opt in array clean loop
    i := i + 1;
    insert into public.poll_options(poll_id, label, position) values (pid, opt, i);
  end loop;
  return pid;
end $$;

create or replace function private.votes_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.community_polls%rowtype;
begin
  perform private.conecta_author_guard();
  if new.user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.vote');
  select * into p from public.community_polls where id = new.poll_id;
  if not found then raise exception 'Enquete indisponível.' using errcode = 'P0001'; end if;
  if p.closes_at <= now() then raise exception 'Enquete encerrada.' using errcode = 'P0001'; end if;
  if public.community_role(p.community_id) is null then raise exception 'Só membros votam.' using errcode = 'P0001'; end if;
  return new;
end $$;
create or replace function private.votes_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.poll_options set vote_count = vote_count + 1 where id = new.option_id;
  else update public.poll_options set vote_count = greatest(vote_count - 1, 0) where id = old.option_id; end if;
  return null;
end $$;
create trigger votes_before_insert before insert on public.poll_votes for each row execute function private.votes_before_insert();
create trigger votes_after_change after insert or delete on public.poll_votes for each row execute function private.votes_after_change();

-- ---------- moderação: novos alvos ----------
create or replace function private.set_content_status(_type text, _id uuid, _status text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare author uuid;
begin
  perform set_config('tucai.internal', 'on', true);
  case _type
    when 'post' then update public.posts set status = _status where id = _id returning author_id into author;
    when 'comment' then update public.post_comments set status = _status where id = _id returning author_id into author;
    when 'topic' then update public.community_topics set status = _status where id = _id returning author_id into author;
    when 'reply' then update public.topic_replies set status = _status where id = _id returning author_id into author;
    when 'scrap' then update public.scraps set status = _status where id = _id returning author_id into author;
    when 'testimonial' then
      update public.testimonials set status = case when _status = 'hidden' then 'hidden' else 'approved' end
       where id = _id returning author_id into author;
    when 'community' then
      update public.communities set status = case when _status = 'hidden' then 'hidden' else 'active' end
       where id = _id returning owner_id into author;
    else null;
  end case;
  perform set_config('tucai.internal', 'off', true);
  return author;
end $$;
revoke all on function private.set_content_status(text, uuid, text) from public, anon, authenticated;

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
       or (_target_type = 'profile' and exists (select 1 from public.social_profiles where user_id = _target_id))
       or (_target_type = 'community' and exists (select 1 from public.communities where id = _target_id))
       or (_target_type = 'topic' and exists (select 1 from public.community_topics where id = _target_id))
       or (_target_type = 'reply' and exists (select 1 from public.topic_replies where id = _target_id))
       or (_target_type = 'scrap' and exists (select 1 from public.scraps where id = _target_id))
       or (_target_type = 'testimonial' and exists (select 1 from public.testimonials where id = _target_id))) then
    raise exception 'Conteúdo não encontrado.' using errcode = 'P0001';
  end if;
  insert into public.content_reports(reporter_id, target_type, target_id, reason, details)
  values (auth.uid(), _target_type, _target_id, _reason, nullif(btrim(coalesce(_details, '')), ''))
  on conflict do nothing returning id into new_id;
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
       or (_target_type = 'topic' and exists (select 1 from public.community_topics where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'reply' and exists (select 1 from public.topic_replies where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'scrap' and exists (select 1 from public.scraps where id = _target_id and author_id = uid and status = 'hidden'))
       or (_target_type = 'community' and exists (select 1 from public.communities where id = _target_id and owner_id = uid and status = 'hidden'))
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
      'Seu conteúdo foi ocultado por violar as regras do Conectuaí: ' || note || ' Você pode contestar.');
  end if;
  update public.content_reports
     set status = case when _action = 'hide' then 'actioned' else 'dismissed' end,
         resolution_note = note, resolved_by = auth.uid(), resolved_at = now()
   where target_type = r.target_type and target_id = r.target_id and status = 'open';
  perform private.audit('moderation.' || _action, r.target_type, r.target_id::text, jsonb_build_object('report', r.id, 'reason', r.reason));
end $$;

create or replace function public.admin_list_reports(_status text default 'open')
returns table (id uuid, target_type text, target_id uuid, reason text, details text, status text, created_at timestamptz,
               reporter_email text, content_body text, content_status text, author_id uuid, author_handle text, open_reports bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('moderation.manage');
  return query
    with c as (
      select r.*,
        case r.target_type
          when 'post' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.posts x where x.id = r.target_id)
          when 'comment' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.post_comments x where x.id = r.target_id)
          when 'profile' then (select jsonb_build_object('b', coalesce(x.bio, x.display_name), 's', 'published', 'a', x.user_id) from public.social_profiles x where x.user_id = r.target_id)
          when 'community' then (select jsonb_build_object('b', x.name || ' — ' || coalesce(x.description, ''), 's', x.status, 'a', x.owner_id) from public.communities x where x.id = r.target_id)
          when 'topic' then (select jsonb_build_object('b', x.title || ' — ' || x.body, 's', x.status, 'a', x.author_id) from public.community_topics x where x.id = r.target_id)
          when 'reply' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.topic_replies x where x.id = r.target_id)
          when 'scrap' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.scraps x where x.id = r.target_id)
          when 'testimonial' then (select jsonb_build_object('b', x.body, 's', x.status, 'a', x.author_id) from public.testimonials x where x.id = r.target_id)
        end as info
      from public.content_reports r
      where _status is null or r.status = _status
      order by r.created_at
      limit 200)
    select c.id, c.target_type, c.target_id, c.reason, c.details, c.status, c.created_at, u.email::text,
           coalesce(c.info->>'b', ''), coalesce(c.info->>'s', 'published'), (c.info->>'a')::uuid, sp.handle,
           (select count(*) from public.content_reports x where x.target_type = c.target_type and x.target_id = c.target_id and x.status = 'open')
      from c
      left join auth.users u on u.id = c.reporter_id
      left join public.social_profiles sp on sp.user_id = (c.info->>'a')::uuid
     order by c.created_at;
end $$;

-- moderadores da comunidade ocultam/restauram tópicos e respostas dela (com auditoria)
create or replace function public.community_moderate_content(_type text, _id uuid, _hide boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if _type = 'topic' then select community_id into cid from public.community_topics where id = _id;
  elsif _type = 'reply' then select t.community_id into cid from public.topic_replies r join public.community_topics t on t.id = r.topic_id where r.id = _id;
  else raise exception 'Tipo inválido.' using errcode = 'P0001'; end if;
  if cid is null or not public.is_community_mod(cid) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('conectuai.community_mod');
  perform private.set_content_status(_type, _id, case when _hide then 'hidden' else 'published' end);
  perform private.audit('community.' || case when _hide then 'hide_' else 'restore_' end || _type, 'communities', cid::text, jsonb_build_object('id', _id));
end $$;

-- ---------- RLS ----------
alter table public.friendships enable row level security;
alter table public.scraps enable row level security;
alter table public.testimonials enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_topics enable row level security;
alter table public.topic_replies enable row level security;
alter table public.community_polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

-- amizades: participantes; aceitas aparecem para todos se ambos mostram conexões
create policy friendships_select on public.friendships for select to anon, authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid())
         or (status = 'accepted'
             and exists (select 1 from public.social_profiles p where p.user_id = requester_id and p.show_connections)
             and exists (select 1 from public.social_profiles p where p.user_id = addressee_id and p.show_connections)));
create policy friendships_insert on public.friendships for insert to authenticated with check (requester_id = (select auth.uid()));
create policy friendships_update on public.friendships for update to authenticated
  using (addressee_id = (select auth.uid())) with check (addressee_id = (select auth.uid()));
create policy friendships_delete on public.friendships for delete to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

create policy scraps_select on public.scraps for select to anon, authenticated
  using (author_id = (select auth.uid()) or owner_id = (select auth.uid())
         or (status = 'published' and public.can_see_wall(owner_id) and not public.is_blocked_between(author_id, (select auth.uid()))));
create policy scraps_insert on public.scraps for insert to authenticated with check (author_id = (select auth.uid()));
create policy scraps_delete on public.scraps for delete to authenticated
  using (author_id = (select auth.uid()) or owner_id = (select auth.uid()));

create policy testimonials_select on public.testimonials for select to anon, authenticated
  using (author_id = (select auth.uid()) or recipient_id = (select auth.uid())
         or (status = 'approved' and not public.is_blocked_between(recipient_id, (select auth.uid()))));
create policy testimonials_insert on public.testimonials for insert to authenticated with check (author_id = (select auth.uid()));
create policy testimonials_update on public.testimonials for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy testimonials_delete on public.testimonials for delete to authenticated
  using (author_id = (select auth.uid()) or recipient_id = (select auth.uid()));

-- comunidades: visíveis na busca (inclusive privadas, sem o conteúdo); dona edita
create policy communities_select on public.communities for select to anon, authenticated
  using (status = 'active' or owner_id = (select auth.uid()));
create policy communities_insert on public.communities for insert to authenticated with check (owner_id = (select auth.uid()));
create policy communities_update on public.communities for update to authenticated
  using (public.community_role(id) = 'owner') with check (public.community_role(id) = 'owner');
create policy communities_delete on public.communities for delete to authenticated
  using (owner_id = (select auth.uid()));

-- membros: de comunidade aberta, todos veem os ativos; de fechada, só membros; cada um vê o próprio pedido;
-- moderadores veem pendentes e banidos
create policy members_select on public.community_members for select to anon, authenticated
  using (user_id = (select auth.uid())
         or public.is_community_mod(community_id)
         or (status = 'active' and public.can_read_community(community_id)));
create policy members_insert on public.community_members for insert to authenticated with check (user_id = (select auth.uid()));
-- sair: o próprio membro (a dona não sai sem transferir); banido não apaga o banimento
create policy members_delete on public.community_members for delete to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner' and status <> 'banned');

create policy topics_select on public.community_topics for select to anon, authenticated
  using (public.can_read_community(community_id)
         and (status = 'published' or author_id = (select auth.uid()) or public.is_community_mod(community_id)));
create policy topics_insert on public.community_topics for insert to authenticated with check (author_id = (select auth.uid()));
create policy topics_update on public.community_topics for update to authenticated
  using (author_id = (select auth.uid()) or public.is_community_mod(community_id))
  with check (author_id = (select auth.uid()) or public.is_community_mod(community_id));
create policy topics_delete on public.community_topics for delete to authenticated
  using (author_id = (select auth.uid()));

create policy replies_select on public.topic_replies for select to anon, authenticated
  using (exists (select 1 from public.community_topics t where t.id = topic_id)
         and (status = 'published' or author_id = (select auth.uid())
              or exists (select 1 from public.community_topics t where t.id = topic_id and public.is_community_mod(t.community_id))));
create policy replies_insert on public.topic_replies for insert to authenticated with check (author_id = (select auth.uid()));
create policy replies_update on public.topic_replies for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy replies_delete on public.topic_replies for delete to authenticated using (author_id = (select auth.uid()));

create policy polls_select on public.community_polls for select to anon, authenticated using (public.can_read_community(community_id));
create policy poll_options_select on public.poll_options for select to anon, authenticated
  using (exists (select 1 from public.community_polls p where p.id = poll_id));
create policy poll_votes_select on public.poll_votes for select to authenticated using (user_id = (select auth.uid()));
create policy poll_votes_insert on public.poll_votes for insert to authenticated with check (user_id = (select auth.uid()));
create policy poll_votes_delete on public.poll_votes for delete to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.community_polls p where p.id = poll_id and p.closes_at > now()));

-- ---------- privilégios ----------
revoke all on public.friendships, public.scraps, public.testimonials, public.communities, public.community_members,
  public.community_topics, public.topic_replies, public.community_polls, public.poll_options, public.poll_votes
  from public, anon, authenticated;
grant select on public.friendships, public.scraps, public.testimonials, public.communities, public.community_members,
  public.community_topics, public.topic_replies, public.community_polls, public.poll_options to anon, authenticated;
grant select on public.poll_votes to authenticated;
grant insert (requester_id, addressee_id), delete on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;
grant insert (owner_id, author_id, parent_id, body), delete on public.scraps to authenticated;
grant insert (recipient_id, author_id, body), delete on public.testimonials to authenticated;
grant update (status) on public.testimonials to authenticated;
grant insert (name, description, rules, category, city_id, is_private, avatar_url, cover_url, business_id, owner_id), delete
  on public.communities to authenticated;
grant update (description, rules, category, city_id, is_private, avatar_url, cover_url) on public.communities to authenticated;
grant insert (community_id, user_id), delete on public.community_members to authenticated;
grant insert (community_id, author_id, title, body), delete on public.community_topics to authenticated;
grant update (title, body, is_pinned, is_locked) on public.community_topics to authenticated;
grant insert (topic_id, author_id, body), delete on public.topic_replies to authenticated;
grant update (body) on public.topic_replies to authenticated;
grant insert (poll_id, option_id, user_id), delete on public.poll_votes to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'private.internal_on()', 'private.notify_link(uuid, text, uuid, text, text)', 'private.friendships_before_insert()', 'private.friendships_before_update()',
    'private.friendships_after_change()', 'private.blocks_after_insert()', 'private.scraps_before_insert()', 'private.scraps_after_insert()',
    'private.testimonials_before_insert()', 'private.testimonials_before_update()', 'private.testimonials_after_insert()',
    'private.communities_before_insert()', 'private.communities_after_insert()', 'private.members_before_insert()',
    'private.members_after_change()', 'private.topics_before_insert()', 'private.topics_before_update()', 'private.topics_after_insert()',
    'private.replies_before_insert()', 'private.replies_after_change()', 'private.replies_before_update()',
    'private.votes_before_insert()', 'private.votes_after_change()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.are_friends(uuid, uuid)', 'public.can_see_wall(uuid)', 'public.community_role(uuid)',
                           'public.is_community_mod(uuid)', 'public.can_read_community(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.community_manage_member(uuid, uuid, text)', 'public.create_poll(uuid, text, text[], integer)',
    'public.community_moderate_content(text, uuid, boolean)', 'public.report_content(text, uuid, text, text)',
    'public.appeal_moderation(text, uuid, text)', 'public.admin_moderate(uuid, text, text)', 'public.admin_list_reports(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- LGPD: novos dados na exportação e na exclusão ----------
create or replace function private.anonymize_user(_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set full_name = null, phone = null, preferred_city_id = null where id = _user;
  update public.reviews set author_name = null where user_id = _user;
  -- comunidades da pessoa passam para um moderador ativo, se houver; senão são removidas
  update public.communities c set owner_id = m.user_id
    from (select distinct on (community_id) community_id, user_id from public.community_members
           where role = 'moderator' and status = 'active' and user_id <> _user order by community_id, joined_at) m
   where c.id = m.community_id and c.owner_id = _user;
  update public.community_members cm set role = 'owner'
    from public.communities c where c.id = cm.community_id and cm.user_id = c.owner_id and c.owner_id <> _user and cm.role = 'moderator';
  delete from public.communities where owner_id = _user;
  delete from public.couriers where user_id = _user;
  delete from public.social_profiles where user_id = _user;
  delete from public.notifications where user_id = _user;
end $$;
revoke all on function private.anonymize_user(uuid) from public, anon, authenticated;

create or replace function private.conectuai_export(_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(sp.handle) from public.friendships f
                          join public.social_profiles sp on sp.user_id = case when f.requester_id = _uid then f.addressee_id else f.requester_id end
                         where f.status = 'accepted' and _uid in (f.requester_id, f.addressee_id)), '[]'::jsonb),
    'scraps_written', coalesce((select jsonb_agg(jsonb_build_object('body', body, 'created_at', created_at)) from public.scraps where author_id = _uid), '[]'::jsonb),
    'testimonials_written', coalesce((select jsonb_agg(jsonb_build_object('body', body, 'status', status)) from public.testimonials where author_id = _uid), '[]'::jsonb),
    'communities', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'role', m.role, 'status', m.status))
                              from public.community_members m join public.communities c on c.id = m.community_id where m.user_id = _uid), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'body', body, 'created_at', created_at)) from public.community_topics where author_id = _uid), '[]'::jsonb),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('body', body, 'created_at', created_at)) from public.topic_replies where author_id = _uid), '[]'::jsonb),
    'courier', (select to_jsonb(c) - 'user_id' - 'reviewed_by' from public.couriers c where c.user_id = _uid))
$$;
revoke all on function private.conectuai_export(uuid) from public, anon, authenticated;

-- exportação: acrescenta comunidades, amizades, recados, depoimentos e cadastro de entregador
do $$
declare src text;
begin
  select pg_get_functiondef('public.my_data_export()'::regprocedure) into src;
  if strpos(src, '''notes'', jsonb_build_array(') = 0 then raise exception 'my_data_export: ponto de extensão não encontrado'; end if;
  src := replace(src, '''notes'', jsonb_build_array(', '''conectuai_extra'', private.conectuai_export(uid),
    ''notes'', jsonb_build_array(');
  execute src;
end $$;
