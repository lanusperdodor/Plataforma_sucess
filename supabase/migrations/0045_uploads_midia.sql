-- 0045: upload de fotos, vídeo e avatar (Supabase Storage), com limites e validação no servidor.
--  Limites (aprovados): avatar 5 MB · imagem 10 MB · até 5 imagens por publicação · vídeo 50 MB e 60 s (1 por publicação).
--  * Storage: um bucket por tipo, com tamanho máximo e tipos permitidos (o próprio Storage recusa o resto).
--    Sem SVG, HTML ou executáveis. Cada pessoa só grava na própria pasta (<id>/arquivo) e só apaga o que é seu.
--  * Publicação: a mídia é anexada por função (nunca insert direto), que confere dono, quantidade, tipo e tamanho
--    REAL do arquivo gravado no Storage. Duração do vídeo: medida no aparelho e conferida aqui (≤ 60 s); o Storage
--    limita o tamanho. Mídia de publicação oculta pela moderação fica oculta junto (mesma regra de leitura do post).
--  * Denúncia: a já existente (content_reports) da publicação; o Master remove a mídia (auditado).

insert into private.rate_limit_rules(action, max_hits, window_seconds) values ('media.attach', 60, 3600)
on conflict (action) do nothing;

-- ---------- buckets e regras do Storage (só onde o Storage existe) ----------
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Storage ausente: buckets e regras de upload não criados (ambiente local).';
    return;
  end if;
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
    ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
    ('post-images', 'post-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('post-videos', 'post-videos', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists tucai_midia_enviar on storage.objects';
  execute $p$create policy tucai_midia_enviar on storage.objects for insert to authenticated with check (
    bucket_id in ('avatars', 'post-images', 'post-videos')
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
    and case bucket_id
          when 'avatars' then name ~* '\.(jpe?g|png|webp)$'
          when 'post-images' then name ~* '\.(jpe?g|png|webp|gif)$'
          else name ~* '\.(mp4|webm|mov)$' end)$p$;
  execute 'drop policy if exists tucai_midia_apagar on storage.objects';
  execute $p$create policy tucai_midia_apagar on storage.objects for delete to authenticated using (
    bucket_id in ('avatars', 'post-images', 'post-videos') and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  -- leitura: buckets públicos (servidos pelo CDN do Storage, em outro domínio); nenhuma regra de UPDATE = arquivo não é trocado
end $$;

-- ---------- mídia das publicações ----------
create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  bucket text not null check (bucket in ('post-images', 'post-videos')),
  path text not null check (char_length(path) <= 200),
  size_bytes integer not null check (size_bytes > 0),
  width integer check (width is null or width between 1 and 10000),
  height integer check (height is null or height between 1 and 10000),
  duration_s numeric(6, 2) check (duration_s is null or duration_s > 0),
  position smallint not null default 0 check (position between 0 and 4),
  created_at timestamptz not null default now(),
  unique (bucket, path),
  check ((kind = 'image') = (bucket = 'post-images')),
  check (kind <> 'image' or size_bytes <= 10485760),
  check (kind <> 'video' or (size_bytes <= 52428800 and duration_s is not null and duration_s <= 60))
);
create index if not exists post_media_post_idx on public.post_media(post_id, position);
create index if not exists post_media_author_idx on public.post_media(author_id);
alter table public.post_media enable row level security;
drop policy if exists post_media_select on public.post_media;
-- vê a mídia quem vê a publicação (inclui a regra de bloqueio e a de moderação dos posts)
create policy post_media_select on public.post_media for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
revoke all on public.post_media from public, anon, authenticated;
grant select on public.post_media to authenticated;   -- como as publicações: só com login

-- anexa até 5 imagens OU 1 vídeo à própria publicação, logo após publicar
create or replace function public.post_attach_media(_post uuid, _items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare p public.posts%rowtype; it jsonb; k text; b text; pth text; sz bigint; mime text; dur numeric; n_img int; n_vid int; i int := 0;
        has_storage boolean := to_regclass('storage.objects') is not null;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.limit_for('media.attach');
  select * into p from public.posts where id = _post for update;
  if not found or p.author_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p.status <> 'published' then raise exception 'Publicação indisponível.' using errcode = 'P0001'; end if;
  if p.created_at < now() - interval '1 hour' then raise exception 'Anexe as fotos ou o vídeo ao publicar.' using errcode = 'P0001'; end if;
  if jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) not between 1 and 5 then raise exception 'Envie de 1 a 5 arquivos.' using errcode = 'P0001'; end if;
  select count(*) filter (where kind = 'image'), count(*) filter (where kind = 'video') into n_img, n_vid from public.post_media where post_id = _post;
  for it in select * from jsonb_array_elements(_items) loop
    k := it->>'kind';
    pth := it->>'path';
    if k not in ('image', 'video') then raise exception 'Tipo de arquivo inválido.' using errcode = 'P0001'; end if;
    b := case k when 'image' then 'post-images' else 'post-videos' end;
    if pth is null or pth !~ ('^' || auth.uid()::text || case k when 'image' then '/[0-9a-f-]{36}\.(jpe?g|png|webp|gif)$' else '/[0-9a-f-]{36}\.(mp4|webm|mov)$' end) then
      raise exception 'Arquivo inválido.' using errcode = 'P0001';
    end if;
    if k = 'image' then n_img := n_img + 1; else n_vid := n_vid + 1; end if;
    if n_img > 5 then raise exception 'No máximo 5 imagens por publicação.' using errcode = 'P0001'; end if;
    if n_vid > 1 then raise exception 'No máximo 1 vídeo por publicação.' using errcode = 'P0001'; end if;
    if n_vid > 0 and n_img > 0 then raise exception 'Envie fotos ou um vídeo (não os dois juntos).' using errcode = 'P0001'; end if;
    dur := nullif(it->>'duration_s', '')::numeric;
    sz := nullif(it->>'size', '')::bigint;
    if has_storage then
      -- tamanho e tipo REAIS do arquivo gravado (não confia no navegador)
      -- consulta estática (só roda onde o Storage existe; o PL/pgSQL só resolve a tabela ao executar a linha)
      select (o.metadata->>'size')::bigint, o.metadata->>'mimetype' into sz, mime from storage.objects o where o.bucket_id = b and o.name = pth;
      if sz is null then raise exception 'Arquivo não encontrado. Envie de novo.' using errcode = 'P0001'; end if;
      if (k = 'image' and mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif'))
         or (k = 'video' and mime not in ('video/mp4', 'video/webm', 'video/quicktime')) then
        raise exception 'Tipo de arquivo não permitido.' using errcode = 'P0001';
      end if;
    end if;
    if sz is null or sz <= 0 then raise exception 'Arquivo inválido.' using errcode = 'P0001'; end if;
    if k = 'image' and sz > 10485760 then raise exception 'Imagem acima de 10 MB.' using errcode = 'P0001'; end if;
    if k = 'video' and sz > 52428800 then raise exception 'Vídeo acima de 50 MB.' using errcode = 'P0001'; end if;
    if k = 'video' and (dur is null or dur > 60) then raise exception 'Vídeo com até 60 segundos.' using errcode = 'P0001'; end if;
    insert into public.post_media(post_id, author_id, kind, bucket, path, size_bytes, width, height, duration_s, position)
    values (_post, auth.uid(), k, b, pth, sz::int,
            nullif(it->>'width', '')::int, nullif(it->>'height', '')::int, case when k = 'video' then dur end, (n_img + n_vid - 1)::smallint);
    i := i + 1;
  end loop;
  return i;
end $$;

-- moderação: o Master remove uma mídia (a publicação continua; a denúncia segue o fluxo existente)
create or replace function public.admin_remove_post_media(_media uuid, _reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.post_media%rowtype;
begin
  perform private.require_permission('moderation.manage');
  if char_length(btrim(coalesce(_reason, ''))) < 3 then raise exception 'Informe o motivo.' using errcode = 'P0001'; end if;
  delete from public.post_media where id = _media returning * into m;
  if not found then raise exception 'Mídia não encontrada.' using errcode = 'P0001'; end if;
  -- tira do ar também o endereço público (o Storage passa a responder "não encontrado")
  -- (algumas versões do Storage proíbem apagar direto pela tabela: aí a mídia some da Tucaí e o arquivo fica para a limpeza)
  if to_regclass('storage.objects') is not null then
    begin
      delete from storage.objects o where o.bucket_id = m.bucket and o.name = m.path;
    exception when others then
      raise notice 'Arquivo mantido no Storage para limpeza: %', m.path;
    end;
  end if;
  perform private.audit('moderation.media_removed', 'post_media', _media::text,
                        jsonb_build_object('post', m.post_id, 'author', m.author_id, 'bucket', m.bucket, 'motivo', left(_reason, 300)));
end $$;

-- avatar enviado pela Tucaí: só da própria pasta
create or replace function private.social_avatar_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.avatar_url ~ '/storage/v1/object/public/avatars/' and new.avatar_url !~ ('/storage/v1/object/public/avatars/' || new.user_id::text || '/') then
    raise exception 'Use uma foto enviada por você.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists social_avatar_guard on public.social_profiles;
create trigger social_avatar_guard before insert or update of avatar_url on public.social_profiles
  for each row execute function private.social_avatar_guard();

do $$ begin
  revoke all on function public.post_attach_media(uuid, jsonb) from public, anon;
  grant execute on function public.post_attach_media(uuid, jsonb) to authenticated;
  revoke all on function public.admin_remove_post_media(uuid, text) from public, anon;
  grant execute on function public.admin_remove_post_media(uuid, text) to authenticated;
  revoke all on function private.social_avatar_guard() from public, anon, authenticated;
end $$;
