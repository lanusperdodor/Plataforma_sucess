-- Testes da 0010 (Conectuaí: amizades, recados, depoimentos, comunidades, tópicos, enquetes).
-- Tudo é revertido. Sucesso: NOTICE 'RLS_CONECTUAI_OK'.
begin;

create schema tstq;
grant usage on schema tstq to public;
create function tstq.login(uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set role authenticated;
end $$;
-- o Conectuaí é só para quem está logado (0025): "público" = qualquer pessoa logada
create function tstq.outsider() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', json_build_object('sub', '22220000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true); set role authenticated; end $$;
create function tstq.anon() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '{}', true); set role anon; end $$;
create function tstq.su() returns void language plpgsql as $$ begin reset role; end $$;
create function tstq.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALHOU: %', msg; end if; end $$;
create function tstq.denied(stmt text, msg text, codes text[] default array['42501']) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = any(codes) then return; end if;
    raise exception 'FALHOU: % (erro inesperado % %)', msg, sqlstate, sqlerrm;
  end;
  raise exception 'FALHOU: % (deveria ter sido negado)', msg;
end $$;
create function tstq.count(q text) returns int language plpgsql as $$
declare n int; begin execute 'select count(*)::int from (' || q || ') s' into n; return n; end $$;
create function tstq.affected(stmt text) returns int language plpgsql as $$
declare n int; begin execute stmt; get diagnostics n = row_count; return n; end $$;
create function tstq.val(q text) returns text language plpgsql as $$
declare v text; begin execute q into v; return v; end $$;

update public.platform_settings set value = 'false' where key = 'require_admin_mfa';

insert into auth.users(id, email) values
  ('22220000-0000-0000-0000-0000000000a1', 'q-ana@teste.invalid'),
  ('22220000-0000-0000-0000-0000000000b1', 'q-bia@teste.invalid'),
  ('22220000-0000-0000-0000-0000000000c1', 'q-caio@teste.invalid'),
  ('22220000-0000-0000-0000-0000000000f1', 'q-moderador@teste.invalid'),
  ('22220000-0000-0000-0000-0000000000d1', 'q-outra-pessoa-logada@teste.invalid');
insert into public.user_roles(user_id, role) values ('22220000-0000-0000-0000-0000000000f1', 'platform_operator');
insert into public.platform_staff_permissions(user_id, permission) values ('22220000-0000-0000-0000-0000000000f1', 'moderation.manage');
insert into public.social_profiles(user_id, handle, display_name) values
  ('22220000-0000-0000-0000-0000000000a1', 'q_ana', 'Ana'),
  ('22220000-0000-0000-0000-0000000000b1', 'q_bia', 'Bia'),
  ('22220000-0000-0000-0000-0000000000c1', 'q_caio', 'Caio'),
  ('22220000-0000-0000-0000-0000000000f1', 'q_mod', 'Moderador');

do $$
declare
  a constant uuid := '22220000-0000-0000-0000-0000000000a1';
  b constant uuid := '22220000-0000-0000-0000-0000000000b1';
  c constant uuid := '22220000-0000-0000-0000-0000000000c1';
  m constant uuid := '22220000-0000-0000-0000-0000000000f1';
  scrap uuid; dep uuid; pub uuid; priv uuid; topic uuid; poll uuid; opt1 uuid; rep uuid;
begin
  -- 1. amizades
  perform tstq.login(a);
  insert into public.friendships(addressee_id) values (b);
  perform tstq.denied(format($q$insert into public.friendships(addressee_id) values (%L)$q$, a), 'amizade consigo', array['23514']);
  perform tstq.login(b);
  perform tstq.denied(format($q$insert into public.friendships(addressee_id) values (%L)$q$, a), 'convite duplicado no sentido inverso', array['23505']);
  perform tstq.ok(tstq.count('select 1 from public.notifications where kind = ''friend_request''') = 1, 'convite notificado');
  perform tstq.login(a);
  perform tstq.ok(tstq.affected(format($q$update public.friendships set status = 'accepted' where addressee_id = %L$q$, b)) = 0, 'quem convidou se autoaceita');
  perform tstq.login(b);
  perform tstq.ok(tstq.affected(format($q$update public.friendships set status = 'accepted' where requester_id = %L$q$, a)) = 1, 'convidada aceita');
  perform tstq.ok(public.are_friends(a, b), 'são amigas');

  -- 2. recados
  perform tstq.login(c);
  insert into public.scraps(owner_id, body) values (a, 'Oi Ana, tudo bem?') returning id into scrap;
  perform tstq.anon();
  perform tstq.denied(format($q$select 1 from public.scraps where owner_id = %L$q$, a), 'visitante sem login lê recados (0025)');
  perform tstq.denied('select 1 from public.communities', 'visitante sem login lê comunidades (0025)');
  perform tstq.outsider();
  perform tstq.ok(tstq.count(format($q$select 1 from public.scraps where owner_id = %L$q$, a)) = 1, 'mural aberto visível a quem está logado');
  perform tstq.login(a);
  insert into public.scraps(owner_id, parent_id, body) values (a, scrap, 'Tudo ótimo!');
  update public.social_profiles set wall_audience = 'friends' where user_id = a;
  perform tstq.login(c);
  perform tstq.denied(format($q$insert into public.scraps(owner_id, body) values (%L, 'de novo')$q$, a), 'não amigo em mural só de amigos', array['P0001']);
  perform tstq.ok(tstq.count(format($q$select 1 from public.scraps where owner_id = %L and author_id <> auth.uid()$q$, a)) = 0, 'mural só de amigos fica oculto para não amigos');
  perform tstq.login(b);
  insert into public.scraps(owner_id, body) values (a, 'Recado de amiga');
  perform tstq.login(a);
  update public.social_profiles set wall_enabled = false where user_id = a;
  perform tstq.login(b);
  perform tstq.denied(format($q$insert into public.scraps(owner_id, body) values (%L, 'mural fechado')$q$, a), 'mural desativado', array['P0001']);
  perform tstq.login(a);
  update public.social_profiles set wall_enabled = true, wall_audience = 'everyone' where user_id = a;
  perform tstq.ok(tstq.affected(format($q$delete from public.scraps where id = %L$q$, scrap)) = 1, 'dona apaga recado recebido');

  -- 3. depoimentos (só amigos, aprovação antes de aparecer)
  perform tstq.login(c);
  perform tstq.denied(format($q$insert into public.testimonials(recipient_id, body) values (%L, 'Pessoa incrível demais!')$q$, a), 'não amigo escreve depoimento', array['P0001']);
  perform tstq.login(b);
  insert into public.testimonials(recipient_id, body) values (a, 'A Ana é a melhor vizinha.') returning id into dep;
  perform tstq.ok(tstq.affected(format($q$update public.testimonials set status = 'approved' where id = %L$q$, dep)) = 0, 'autora aprova o próprio depoimento');
  perform tstq.outsider();
  perform tstq.ok(tstq.count(format($q$select 1 from public.testimonials where id = %L$q$, dep)) = 0, 'pendente invisível');
  perform tstq.login(a);
  perform tstq.denied(format($q$update public.testimonials set body = 'editado' where id = %L$q$, dep), 'destinatária edita texto');
  perform tstq.ok(tstq.affected(format($q$update public.testimonials set status = 'approved' where id = %L$q$, dep)) = 1, 'destinatária aprova');
  perform tstq.outsider();
  perform tstq.ok(tstq.count(format($q$select 1 from public.testimonials where id = %L$q$, dep)) = 1, 'aprovado público');

  -- 4. comunidades abertas e fechadas
  perform tstq.login(a);
  insert into public.communities(name, category, is_private) values ('Gastronomia de Itaú', 'gastronomia', false) returning id into pub;
  insert into public.communities(name, category, is_private, rules) values ('Motociclistas da Região', 'veiculos', true, 'Respeito sempre.') returning id into priv;
  perform tstq.su();
  perform tstq.ok((select role from public.community_members where community_id = pub and user_id = a) = 'owner', 'criadora é dona');
  perform tstq.ok((select member_count from public.communities where id = pub) = 1, 'contador de membros');
  perform tstq.ok((select slug from public.communities where id = pub) = 'gastronomia-de-itau', 'slug da comunidade');
  perform tstq.login(c);
  perform tstq.ok(tstq.affected(format($q$update public.communities set description = 'tomada' where id = %L$q$, pub)) = 0, 'não dono edita comunidade');
  insert into public.community_members(community_id) values (pub);
  insert into public.community_members(community_id) values (priv);
  perform tstq.ok(tstq.val(format($q$select status from public.community_members where community_id = %L and user_id = auth.uid()$q$, priv)) = 'pending', 'fechada vira pedido');
  perform tstq.denied(format($q$insert into public.community_topics(community_id, title, body) values (%L, 'Oi', 'texto')$q$, priv), 'pendente cria tópico', array['P0001']);
  perform tstq.login(a);
  perform tstq.ok(tstq.count('select 1 from public.notifications where kind = ''community_request''') = 1, 'dona avisada do pedido');
  perform public.community_manage_member(priv, c, 'approve');
  perform tstq.login(b);
  perform tstq.denied(format($q$select public.community_manage_member(%L, %L, 'ban')$q$, priv, c), 'não moderador bane');

  -- 5. tópicos, moderadores, trancar, respostas
  perform tstq.login(c);
  insert into public.community_topics(community_id, title, body) values (priv, 'Rolê de domingo', 'Quem vai?') returning id into topic;
  perform tstq.denied(format($q$update public.community_topics set is_pinned = true where id = %L$q$, topic), 'membro fixa tópico', array['42501']);
  perform tstq.login(b);
  perform tstq.ok(tstq.count(format($q$select 1 from public.community_topics where id = %L$q$, topic)) = 0, 'não membro lê tópico de comunidade fechada');
  perform tstq.outsider();
  perform tstq.ok(tstq.count(format($q$select 1 from public.communities where id = %L$q$, priv)) = 1, 'comunidade fechada aparece na busca');
  perform tstq.login(a);
  insert into public.topic_replies(topic_id, body) values (topic, 'Eu vou!');
  perform tstq.ok(tstq.affected(format($q$update public.community_topics set is_pinned = true, is_locked = true where id = %L$q$, topic)) = 1, 'dona fixa e tranca');
  perform tstq.login(c);
  perform tstq.ok(tstq.count('select 1 from public.notifications where kind = ''topic_reply''') = 1, 'autor avisado da resposta');
  perform tstq.denied(format($q$insert into public.topic_replies(topic_id, body) values (%L, 'mais uma')$q$, topic), 'responder tópico trancado', array['P0001']);
  perform tstq.ok(tstq.val(format($q$select reply_count from public.community_topics where id = %L$q$, topic)) = '1', 'contador de respostas');
  perform tstq.login(a);
  perform public.community_moderate_content('topic', topic, true);
  perform tstq.login(c);
  perform tstq.ok(tstq.count(format($q$select 1 from public.community_topics where id = %L and status = 'hidden'$q$, topic)) = 1, 'autor vê o próprio tópico oculto');
  perform tstq.login(a);
  perform public.community_manage_member(priv, c, 'ban');
  perform tstq.login(c);
  perform tstq.ok(tstq.affected(format($q$delete from public.community_members where community_id = %L and user_id = auth.uid()$q$, priv)) = 0, 'banido apaga o banimento');
  perform tstq.denied(format($q$insert into public.community_members(community_id) values (%L)$q$, priv), 'banido reentra', array['23505']);

  -- 6. enquetes
  perform tstq.login(a);
  perform tstq.denied(format($q$select public.create_poll(%L, 'Melhor pizza?', array['Só uma'])$q$, pub), 'enquete com uma opção', array['P0001']);
  poll := public.create_poll(pub, 'Melhor dia para o encontro?', array['Sábado', 'Domingo', ' '], 7);
  select id into opt1 from public.poll_options where poll_id = poll and position = 1;
  perform tstq.ok(tstq.count(format($q$select 1 from public.poll_options where poll_id = %L$q$, poll)) = 2, 'opções vazias descartadas');
  insert into public.poll_votes(poll_id, option_id) values (poll, opt1);
  perform tstq.denied(format($q$insert into public.poll_votes(poll_id, option_id) values (%L, %L)$q$, poll, opt1), 'votar duas vezes', array['23505']);
  perform tstq.login(b);
  perform tstq.denied(format($q$insert into public.poll_votes(poll_id, option_id) values (%L, %L)$q$, poll, opt1), 'não membro vota', array['P0001']);
  perform tstq.ok(tstq.val(format($q$select vote_count from public.poll_options where id = %L$q$, opt1)) = '1', 'contagem de votos');

  -- 7. moderação da plataforma sobre recado e depoimento
  perform tstq.login(c);
  insert into public.scraps(owner_id, body) values (b, 'Recado que será denunciado') returning id into scrap;
  perform tstq.login(b);
  rep := public.report_content('scrap', scrap, 'harassment');
  perform tstq.login(m);
  perform public.admin_moderate(rep, 'hide', 'Ofensa pessoal.');
  perform tstq.login(b);
  perform tstq.ok(tstq.val(format($q$select status from public.scraps where id = %L$q$, scrap)) = 'hidden', 'recado ocultado pela moderação');
  rep := public.report_content('testimonial', dep, 'other');
  perform tstq.login(m);
  perform public.admin_moderate(rep, 'hide', 'Conteúdo indevido.');
  perform tstq.outsider();
  perform tstq.ok(tstq.count(format($q$select 1 from public.testimonials where id = %L$q$, dep)) = 0, 'depoimento ocultado some do público');

  -- 8. bloqueio desfaz amizade; LGPD
  perform tstq.login(a);
  insert into public.user_blocks(blocked_id) values (b);
  perform tstq.ok(not public.are_friends(a, b), 'bloqueio desfaz amizade');
  perform tstq.ok(public.my_data_export()->'conectuai_extra' ? 'communities', 'exportação inclui o Conectuaí');
  perform tstq.su();
  perform private.anonymize_user(a);
  perform tstq.ok(not exists (select 1 from public.communities where owner_id = a), 'exclusão não deixa comunidades órfãs da pessoa');
  raise notice 'RLS_CONECTUAI_OK';
end $$;

rollback;
