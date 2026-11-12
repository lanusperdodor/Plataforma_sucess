-- Testes da 0008 (Tucaí Conecta). Tudo é revertido. Sucesso: NOTICE 'RLS_CONECTA_OK'.
begin;

create schema tstc;
grant usage on schema tstc to public;
create function tstc.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
create function tstc.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tstc.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstc.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstc.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tstc.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tstc.affected(stmt text) returns int language plpgsql as $$
declare n int; begin execute stmt; get diagnostics n = row_count; return n; end $$;
create function tstc.val(q text) returns text language plpgsql as $$
declare v text; begin execute q into v; return v; end $$;

-- MFA obrigatório é testado em rls_security.sql; aqui as sessões são aal1.
update public.platform_settings set value = 'false' where key = 'require_admin_mfa';

insert into auth.users(id, email) values
  ('44440000-0000-0000-0000-0000000000a1', 'c-ana@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000b1', 'c-bruno@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000c1', 'c-carla-fechada@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000d1', 'c-sem-perfil@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000e1', 'c-dono@teste.invalid'),
  ('44440000-0000-0000-0000-0000000000f1', 'c-moderador@teste.invalid');
insert into public.user_roles(user_id, role) values ('44440000-0000-0000-0000-0000000000f1', 'platform_operator');
insert into public.platform_staff_permissions(user_id, permission) values ('44440000-0000-0000-0000-0000000000f1', 'moderation.manage');
insert into public.cities(id, name, state, slug) values ('44449000-0000-0000-0000-000000000001', 'Cidade C', 'TC', 'tstc-cidade');
insert into public.businesses(id, name, slug, owner_id, status, city_id) values
  ('44441000-0000-0000-0000-0000000000e1', 'Hamburgueria C', 'tstc-hamb', '44440000-0000-0000-0000-0000000000e1', 'active', '44449000-0000-0000-0000-000000000001'),
  ('44441000-0000-0000-0000-0000000000e2', 'Pendente C', 'tstc-pend', '44440000-0000-0000-0000-0000000000e1', 'pending', '44449000-0000-0000-0000-000000000001'),
  ('44441000-0000-0000-0000-0000000000e3', 'Outro C', 'tstc-outro', '44440000-0000-0000-0000-0000000000b1', 'active', '44449000-0000-0000-0000-000000000001');
insert into public.business_members(business_id, user_id, member_role) values
  ('44441000-0000-0000-0000-0000000000e1', '44440000-0000-0000-0000-0000000000e1', 'owner'),
  ('44441000-0000-0000-0000-0000000000e2', '44440000-0000-0000-0000-0000000000e1', 'owner'),
  ('44441000-0000-0000-0000-0000000000e3', '44440000-0000-0000-0000-0000000000b1', 'owner');
insert into public.menu_categories(id, business_id, name) values
  ('44442000-0000-0000-0000-0000000000e1', '44441000-0000-0000-0000-0000000000e1', 'Lanches'),
  ('44442000-0000-0000-0000-0000000000e3', '44441000-0000-0000-0000-0000000000e3', 'Outros');
insert into public.products(id, business_id, category_id, name, price_cents) values
  ('44443000-0000-0000-0000-0000000000e1', '44441000-0000-0000-0000-0000000000e1', '44442000-0000-0000-0000-0000000000e1', 'Combo C', 3500),
  ('44443000-0000-0000-0000-0000000000e3', '44441000-0000-0000-0000-0000000000e3', '44442000-0000-0000-0000-0000000000e3', 'Produto de B', 100);

do $$
declare
  a constant uuid := '44440000-0000-0000-0000-0000000000a1';
  b constant uuid := '44440000-0000-0000-0000-0000000000b1';
  c constant uuid := '44440000-0000-0000-0000-0000000000c1';
  d constant uuid := '44440000-0000-0000-0000-0000000000d1';
  o constant uuid := '44440000-0000-0000-0000-0000000000e1';
  m constant uuid := '44440000-0000-0000-0000-0000000000f1';
  city constant uuid := '44449000-0000-0000-0000-000000000001';
  biz constant uuid := '44441000-0000-0000-0000-0000000000e1';
  post_a uuid; post_c uuid; post_biz uuid; post_threat uuid; com_b uuid; reply_a uuid; rep uuid; app uuid; i int;
begin
  -- 1. perfil social: necessário para interagir; validação; campos protegidos
  perform tstc.login(d);
  perform tstc.denied($q$insert into public.posts(body) values ('Oi')$q$, 'publicar sem perfil', array['P0001']);
  perform tstc.login(a);
  insert into public.social_profiles(user_id, handle, display_name, city_id) values (a, 'ana_itau', 'Ana', city);
  perform tstc.denied($q$insert into public.social_profiles(user_id, handle, display_name) values ('44440000-0000-0000-0000-0000000000b1', 'falso', 'Falso')$q$, 'criar perfil de outra pessoa');
  perform tstc.denied($q$update public.social_profiles set conecta_suspended_until = null$q$, 'alterar a própria suspensão');
  perform tstc.denied($q$update public.social_profiles set avatar_url = 'javascript:alert(1)' where user_id = auth.uid()$q$, 'avatar javascript:', array['23514']);
  perform tstc.login(b);
  perform tstc.denied($q$insert into public.social_profiles(user_id, handle, display_name) values (auth.uid(), 'ana_itau', 'Bruno')$q$, 'handle repetido', array['23505']);
  perform tstc.denied($q$insert into public.social_profiles(user_id, handle, display_name) values (auth.uid(), 'Bruno Silva!', 'Bruno')$q$, 'handle inválido', array['23514']);
  insert into public.social_profiles(user_id, handle, display_name) values (b, 'bruno', 'Bruno');
  perform tstc.login(c);
  insert into public.social_profiles(user_id, handle, display_name, is_public) values (c, 'carla', 'Carla', false);
  perform tstc.login(o);
  insert into public.social_profiles(user_id, handle, display_name) values (o, 'dono_hamb', 'Dono');
  perform tstc.login(m);
  insert into public.social_profiles(user_id, handle, display_name) values (m, 'moderador', 'Moderador');

  -- 2. publicar, editar, apagar; campos que só a plataforma define
  perform tstc.login(a);
  insert into public.posts(body, city_id) values ('  A pizza da praça é ótima, mas o atendimento demorou.  ', city) returning id into post_a;
  perform tstc.ok(tstc.val(format($q$select body from public.posts where id = %L$q$, post_a)) = 'A pizza da praça é ótima, mas o atendimento demorou.', 'texto aparado e crítica publicada');
  perform tstc.denied($q$insert into public.posts(body, is_sponsored) values ('x', true)$q$, 'autor marca patrocinado');
  perform tstc.denied($q$insert into public.posts(author_id, body) values ('44440000-0000-0000-0000-0000000000b1', 'falso')$q$, 'publicar como outra pessoa');
  perform tstc.denied($q$insert into public.posts(body) values ('A pizza da praça é ótima, mas o atendimento demorou.')$q$, 'texto duplicado em 10 min', array['P0001']);
  perform tstc.ok(tstc.affected(format($q$update public.posts set body = 'Corrigindo: o atendimento foi rápido.' where id = %L$q$, post_a)) = 1, 'autor edita');
  perform tstc.ok(tstc.val(format($q$select edited_at is not null from public.posts where id = %L$q$, post_a)) = 'true', 'edição marcada');
  perform tstc.denied(format($q$update public.posts set like_count = 999 where id = %L$q$, post_a), 'autor infla curtidas');
  perform tstc.login(b);
  perform tstc.ok(tstc.affected(format($q$update public.posts set body = 'invadido' where id = %L$q$, post_a)) = 0, 'outro usuário edita');
  perform tstc.ok(tstc.affected(format($q$delete from public.posts where id = %L$q$, post_a)) = 0, 'outro usuário apaga');
  perform tstc.anon();
  perform tstc.denied(format($q$select 1 from public.posts where id = %L$q$, post_a), 'visitante sem login lê o Conectuaí (0025)');
  perform tstc.denied('select 1 from public.social_profiles', 'visitante sem login lê perfis (0025)');
  perform tstc.login('44440000-0000-0000-0000-0000000000d1');
  perform tstc.ok(tstc.count(format($q$select 1 from public.posts where id = %L$q$, post_a)) = 1, 'qualquer usuário logado lê publicação pública');
  perform tstc.anon();
  perform tstc.denied($q$insert into public.posts(body) values ('anon')$q$, 'visitante publica');

  -- 3. comentários, respostas, curtidas e contadores
  perform tstc.login(b);
  insert into public.post_comments(post_id, body) values (post_a, 'Concordo!') returning id into com_b;
  insert into public.post_likes(post_id) values (post_a);
  perform tstc.denied(format($q$insert into public.post_likes(post_id) values (%L)$q$, post_a), 'curtir duas vezes', array['23505']);
  perform tstc.login(a);
  insert into public.post_comments(post_id, parent_id, body) values (post_a, com_b, 'Obrigada!') returning id into reply_a;
  perform tstc.denied(format($q$insert into public.post_comments(post_id, parent_id, body) values (%L, %L, 'x')$q$, post_a, reply_a), 'resposta de resposta', array['P0001']);
  perform tstc.ok(tstc.val(format($q$select like_count || '/' || comment_count from public.posts where id = %L$q$, post_a)) = '1/2', 'contadores reais');
  perform tstc.ok(tstc.count($q$select 1 from public.notifications where kind in ('like', 'comment')$q$) = 2, 'autora notificada de curtida e comentário');
  perform tstc.login(b);
  perform tstc.ok(tstc.count($q$select 1 from public.notifications where kind = 'reply'$q$) = 1, 'resposta notificada');
  perform tstc.ok(tstc.count(format($q$select 1 from public.notifications where user_id = %L$q$, a)) = 0, 'não lê notificações alheias');
  perform tstc.denied($q$update public.notifications set message = 'x'$q$, 'altera notificação além de read_at');
  delete from public.post_likes where post_id = post_a;
  perform tstc.ok(tstc.val(format($q$select like_count from public.posts where id = %L$q$, post_a)) = '0', 'descurtir atualiza contador');
  perform tstc.login(a);
  perform tstc.ok(tstc.affected(format($q$delete from public.post_comments where id = %L$q$, com_b)) = 1, 'autora da publicação apaga comentário recebido');

  -- 4. salvos são privados
  perform tstc.login(b);
  insert into public.post_saves(post_id) values (post_a);
  perform tstc.login(a);
  perform tstc.ok(tstc.count('select 1 from public.post_saves') = 0, 'salvos de outra pessoa invisíveis');

  -- 5. perfil fechado: só seguidores veem; conexões não são expostas
  perform tstc.login(c);
  insert into public.posts(body) values ('Só para quem me segue.') returning id into post_c;
  perform tstc.login(b);
  perform tstc.ok(tstc.count(format($q$select 1 from public.posts where id = %L$q$, post_c)) = 0, 'não seguidor vê perfil fechado');
  insert into public.follows(follower_id, followee_id) values (b, c);
  perform tstc.ok(tstc.val(format($q$select status from public.follows where follower_id = %L and followee_id = %L$q$, b, c)) = 'pending', 'seguir perfil fechado vira solicitação');
  perform tstc.ok(tstc.count(format($q$select 1 from public.posts where id = %L$q$, post_c)) = 0, 'solicitação pendente não dá acesso');
  perform tstc.ok(tstc.affected(format($q$update public.follows set status = 'accepted' where follower_id = %L$q$, b)) = 0, 'quem pediu se autoaprova');
  perform tstc.login(c);
  perform tstc.ok(tstc.affected(format($q$update public.follows set status = 'accepted' where follower_id = %L$q$, b)) = 1, 'perfil fechado aprova');
  perform tstc.login(b);
  perform tstc.ok(tstc.count(format($q$select 1 from public.posts where id = %L$q$, post_c)) = 1, 'seguidor aprovado vê perfil fechado');
  perform tstc.login('44440000-0000-0000-0000-0000000000d1');
  perform tstc.ok(tstc.count(format($q$select 1 from public.follows where followee_id = %L$q$, c)) = 0, 'seguidores de perfil fechado ocultos');
  perform tstc.login(c);
  perform tstc.ok(tstc.count($q$select 1 from public.notifications where kind = 'follow'$q$) = 1, 'nova seguidora notificada');

  -- 6. bloqueio
  perform tstc.login(b);
  insert into public.follows(follower_id, followee_id) values (b, a);
  perform tstc.login(a);
  insert into public.user_blocks(blocker_id, blocked_id) values (a, b);
  perform tstc.login(b);
  perform tstc.ok(tstc.count(format($q$select 1 from public.posts where id = %L$q$, post_a)) = 0, 'bloqueado não vê publicações');
  perform tstc.denied(format($q$insert into public.post_comments(post_id, body) values (%L, 'oi')$q$, post_a), 'bloqueado comenta', array['P0001']);
  perform tstc.denied(format($q$insert into public.post_likes(post_id) values (%L)$q$, post_a), 'bloqueado curte', array['P0001']);
  perform tstc.denied(format($q$insert into public.follows(follower_id, followee_id) values (auth.uid(), %L)$q$, a), 'bloqueado segue', array['P0001']);
  perform tstc.ok(tstc.count(format($q$select 1 from public.follows where follower_id = %L and followee_id = %L$q$, b, a)) = 0, 'bloqueio desfaz seguida');
  perform tstc.login(a);
  perform tstc.ok(tstc.count('select 1 from public.user_blocks') = 1, 'bloqueadora vê o bloqueio');
  delete from public.user_blocks where blocked_id = b;

  -- 7. publicações de estabelecimentos ligadas a produtos reais
  perform tstc.login(o);
  insert into public.posts(body, business_id, product_id, city_id) values ('Combo C saindo agora!', biz, '44443000-0000-0000-0000-0000000000e1', city) returning id into post_biz;
  perform tstc.ok(post_biz is not null, 'estabelecimento publica oferta ligada ao produto');
  perform tstc.denied($q$insert into public.posts(body, business_id, product_id) values ('x', '44441000-0000-0000-0000-0000000000e1', '44443000-0000-0000-0000-0000000000e3')$q$, 'produto de outro estabelecimento', array['23503']);
  perform tstc.denied($q$insert into public.posts(body, business_id) values ('pendente', '44441000-0000-0000-0000-0000000000e2')$q$, 'estabelecimento pendente publica', array['P0001']);
  perform tstc.login(a);
  perform tstc.denied($q$insert into public.posts(body, business_id) values ('me passando', '44441000-0000-0000-0000-0000000000e1')$q$, 'publicar em nome de estabelecimento alheio');
  insert into public.business_follows(business_id) values (biz);
  perform tstc.denied($q$insert into public.business_follows(business_id) values ('44441000-0000-0000-0000-0000000000e2')$q$, 'seguir estabelecimento pendente', array['P0001']);

  -- 8. limite contra publicação automatizada
  perform tstc.login(o);
  for i in 2..10 loop insert into public.posts(body) values ('Novidade número ' || i); end loop;
  perform tstc.denied($q$insert into public.posts(body) values ('11ª em 10 minutos')$q$, '11ª publicação em 10 min', array['PT429']);

  -- 9. denúncias e sinalização automática (sem ocultar nada sozinha)
  perform tstc.login(b);
  rep := public.report_content('post', post_a, 'harassment', 'Acho ofensivo');
  perform tstc.denied(format($q$select public.report_content('post', %L, 'spam')$q$, post_a), 'denúncia duplicada', array['P0001']);
  perform tstc.denied(format($q$select public.report_content('post', %L, 'auto_flag')$q$, post_a), 'usuário usa motivo automático', array['P0001']);
  perform tstc.login(c);
  insert into public.posts(body) values ('Se continuar assim vou te matar.') returning id into post_threat;
  perform tstc.su();
  perform tstc.ok(exists (select 1 from public.content_reports where target_id = post_threat and reason = 'auto_flag' and reporter_id is null), 'ameaça sinalizada para revisão humana');
  perform tstc.ok((select status from public.posts where id = post_threat) = 'published', 'sinalização não oculta automaticamente');
  perform tstc.ok(not exists (select 1 from public.content_reports where target_id = post_a and reason = 'auto_flag'), 'crítica legítima não é sinalizada');

  -- 10. moderação humana, contestação e auditoria
  perform tstc.login(b);
  perform tstc.denied('select * from public.admin_list_reports()', 'usuário lista denúncias');
  perform tstc.login(m);
  perform tstc.ok(tstc.count('select 1 from public.admin_list_reports() where content_body <> ''''') >= 2, 'moderador vê fila com o conteúdo');
  perform tstc.denied(format($q$select public.admin_moderate(%L, 'hide', null)$q$, rep), 'decisão sem motivo', array['P0001']);
  perform public.admin_moderate(rep, 'hide', 'Linguagem ofensiva contra pessoa identificada.');
  perform tstc.login(b);
  perform tstc.ok(tstc.count(format($q$select 1 from public.posts where id = %L$q$, post_a)) = 0, 'conteúdo oculto some do feed');
  perform tstc.login(a);
  perform tstc.ok(tstc.count(format($q$select 1 from public.posts where id = %L and status = 'hidden'$q$, post_a)) = 1, 'autora vê a própria publicação ocultada');
  perform tstc.denied(format($q$update public.posts set body = 'editando' where id = %L$q$, post_a), 'editar conteúdo ocultado', array['P0001']);
  perform tstc.ok(tstc.count($q$select 1 from public.notifications where kind = 'moderation'$q$) = 1, 'autora notificada da moderação');
  app := public.appeal_moderation('post', post_a, 'Era uma crítica ao serviço, não uma ofensa.');
  perform tstc.denied(format($q$select public.appeal_moderation('post', %L, 'De novo, por favor revisem')$q$, post_a), 'contestação duplicada', array['P0001']);
  perform tstc.login(m);
  perform public.admin_resolve_appeal(app, 'reverse', 'Crítica legítima ao atendimento; republicada.');
  perform tstc.login(b);
  perform tstc.ok(tstc.count(format($q$select 1 from public.posts where id = %L$q$, post_a)) = 1, 'contestação aceita republica');
  perform tstc.su();
  perform tstc.ok((select count(*) from public.audit_logs where action in ('moderation.hide', 'moderation.appeal_reverse')) = 2, 'decisões auditadas');

  -- 11. suspensão e contestação da suspensão
  perform tstc.login(m);
  perform tstc.denied(format($q$select public.admin_suspend_user(%L, now() + interval '7 days', 'x')$q$, m), 'moderador suspende a si mesmo');
  perform public.admin_suspend_user(c, now() + interval '7 days', 'Ameaça explícita.');
  perform tstc.login(c);
  perform tstc.denied($q$insert into public.posts(body) values ('voltei')$q$, 'suspensa publica', array['P0001']);
  perform tstc.denied(format($q$insert into public.post_likes(post_id) values (%L)$q$, post_biz), 'suspensa curte', array['P0001']);
  app := public.appeal_moderation('suspension', c, 'Peço revisão do prazo da suspensão.');
  perform tstc.login(m);
  perform public.admin_resolve_appeal(app, 'uphold', 'Ameaça confirmada; suspensão mantida.');
  perform tstc.login(c);
  perform tstc.denied($q$insert into public.posts(body) values ('ainda suspensa')$q$, 'suspensão mantida', array['P0001']);

  -- 12. LGPD: exportação inclui o Conecta; exclusão remove o conteúdo social
  perform tstc.login(o);
  perform tstc.ok(jsonb_array_length(public.my_data_export()->'conecta'->'posts') >= 10, 'exportação traz publicações do Conecta');
  perform tstc.su();
  perform private.anonymize_user(o);
  perform tstc.ok(not exists (select 1 from public.posts where author_id = o), 'exclusão remove publicações');
  perform tstc.ok(not exists (select 1 from public.social_profiles where user_id = o), 'exclusão remove perfil social');

  perform tstc.su();
  raise notice 'RLS_CONECTA_OK';
end $$;

rollback;
