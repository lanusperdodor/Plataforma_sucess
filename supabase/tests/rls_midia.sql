-- 0045: mídia das publicações e avatar. Tudo é revertido. Sucesso: 'RLS_MIDIA_OK'.
-- (No banco local não há Storage: o tamanho vem do envio; em produção a função lê o tamanho real gravado no Storage.)
begin;
create schema tsmd;
grant usage on schema tsmd to public;
create function tsmd.login(uid uuid) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true); set role authenticated; end $$;
create function tsmd.anon() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tsmd.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tsmd.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tsmd.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when insufficient_privilege or raise_exception or check_violation then return; end;
  raise exception 'FALHOU: % (deveria ter sido recusado)', msg;
end $$;
grant execute on all functions in schema tsmd to public;
update public.platform_settings set value = 'false' where key = 'require_admin_mfa';

do $$
declare
  a constant uuid := '45450000-0000-0000-0000-0000000000a1';
  b constant uuid := '45450000-0000-0000-0000-0000000000b1';
  m uuid; p uuid; p2 uuid; mid uuid;
  img jsonb; five jsonb := '[]'::jsonb; i int;
begin
  insert into auth.users(id, email) values (a, 'md-ana@teste.invalid'), (b, 'md-bruno@teste.invalid');
  insert into public.social_profiles(user_id, handle, display_name) values (a, 'md_ana', 'Ana'), (b, 'md_bruno', 'Bruno');
  m := private.create_auth_user('md-master@teste.invalid', 'senha-master-1', 'Master MD');
  insert into public.user_roles(user_id, role) values (m, 'platform_master');

  perform tsmd.login(a);
  insert into public.posts(body) values ('Com fotos') returning id into p;
  for i in 1..5 loop
    five := five || jsonb_build_object('kind', 'image', 'path', a::text || '/' || gen_random_uuid()::text || '.webp', 'size', 900000, 'width', 1200, 'height', 900);
  end loop;
  perform tsmd.ok(public.post_attach_media(p, five) = 5, 'anexa 5 imagens');
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p, jsonb_build_array(jsonb_build_object('kind', 'image', 'path', a::text || '/' || gen_random_uuid()::text || '.jpg', 'size', 1000))), '6ª imagem');
  perform tsmd.denied($q$insert into public.post_media(post_id, author_id, kind, bucket, path, size_bytes) values (gen_random_uuid(), auth.uid(), 'image', 'post-images', 'x', 1)$q$, 'insert direto na tabela');

  insert into public.posts(body) values ('Com vídeo') returning id into p2;
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p2, jsonb_build_array(jsonb_build_object('kind', 'image', 'path', a::text || '/' || gen_random_uuid()::text || '.png', 'size', 11000000))), 'imagem acima de 10 MB');
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p2, jsonb_build_array(jsonb_build_object('kind', 'video', 'path', a::text || '/' || gen_random_uuid()::text || '.mp4', 'size', 30000000, 'duration_s', 75))), 'vídeo acima de 60 s');
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p2, jsonb_build_array(jsonb_build_object('kind', 'video', 'path', a::text || '/' || gen_random_uuid()::text || '.mp4', 'size', 60000000, 'duration_s', 30))), 'vídeo acima de 50 MB');
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p2, jsonb_build_array(jsonb_build_object('kind', 'image', 'path', a::text || '/' || gen_random_uuid()::text || '.svg', 'size', 1000))), 'SVG');
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p2, jsonb_build_array(jsonb_build_object('kind', 'image', 'path', b::text || '/' || gen_random_uuid()::text || '.jpg', 'size', 1000))), 'arquivo da pasta de outra pessoa');
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p2, jsonb_build_array(jsonb_build_object('kind', 'image', 'path', a::text || '/../x.jpg', 'size', 1000))), 'caminho com ..');
  perform tsmd.ok(public.post_attach_media(p2, jsonb_build_array(jsonb_build_object('kind', 'video', 'path', a::text || '/' || gen_random_uuid()::text || '.mp4', 'size', 30000000, 'duration_s', 42.5))) = 1, 'anexa 1 vídeo de 42 s');
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p2, jsonb_build_array(jsonb_build_object('kind', 'image', 'path', a::text || '/' || gen_random_uuid()::text || '.jpg', 'size', 1000))), 'foto junto com vídeo');

  -- outra pessoa não anexa na publicação da Ana; publicação antiga não aceita anexo
  perform tsmd.login(b);
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p, jsonb_build_array(jsonb_build_object('kind', 'image', 'path', b::text || '/' || gen_random_uuid()::text || '.jpg', 'size', 1000))), 'anexar na publicação de outra pessoa');
  perform tsmd.ok((select count(*) from public.post_media where post_id = p) = 5, 'Bruno vê as fotos da publicação pública');
  perform tsmd.su();
  update public.posts set created_at = now() - interval '2 hours' where id = p2;
  perform tsmd.login(a);
  perform tsmd.denied(format('select public.post_attach_media(%L, %L::jsonb)', p2, jsonb_build_array(jsonb_build_object('kind', 'video', 'path', a::text || '/' || gen_random_uuid()::text || '.mp4', 'size', 1000, 'duration_s', 5))), 'anexar em publicação antiga');

  -- moderação: publicação oculta esconde a mídia; Master remove mídia com motivo
  perform tsmd.su();
  update public.posts set status = 'hidden' where id = p;
  perform tsmd.login(b);
  perform tsmd.ok((select count(*) from public.post_media where post_id = p) = 0, 'publicação oculta: mídia some para os outros');
  perform tsmd.anon();
  perform tsmd.denied('select 1 from public.post_media', 'anônimo lê mídia (as publicações exigem login)');
  perform tsmd.denied(format('select public.admin_remove_post_media(%L, %L)', gen_random_uuid(), 'teste'), 'anônimo remove mídia');
  perform tsmd.login(b);
  select id into mid from public.post_media where post_id = p2 limit 1;
  perform tsmd.denied(format('select public.admin_remove_post_media(%L, %L)', mid, 'não gostei'), 'usuário comum remove mídia');
  perform tsmd.login(m);
  perform public.admin_remove_post_media(mid, 'Conteúdo denunciado e confirmado');
  perform tsmd.ok(not exists (select 1 from public.post_media where id = mid), 'Master removeu a mídia');
  perform tsmd.ok(exists (select 1 from public.audit_logs where action = 'moderation.media_removed'), 'remoção auditada');

  -- avatar: só da própria pasta do Storage
  perform tsmd.login(a);
  update public.social_profiles set avatar_url = 'https://x.supabase.co/storage/v1/object/public/avatars/' || a::text || '/foto.webp' where user_id = a;
  perform tsmd.denied(format($q$update public.social_profiles set avatar_url = 'https://x.supabase.co/storage/v1/object/public/avatars/%s/foto.webp' where user_id = %L$q$, b, a), 'avatar da pasta de outra pessoa');
  raise notice 'RLS_MIDIA_OK';
end $$;
rollback;
