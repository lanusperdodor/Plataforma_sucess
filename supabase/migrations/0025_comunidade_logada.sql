-- 0025_comunidade_logada: o Conectuaí (feed, perfis, recados, depoimentos e comunidades) passa a ser só para
-- quem está logado. Visitante sem conta não lê nem publica; as regras de quem vê o quê entre usuários logados
-- (perfil fechado, amigos, comunidades fechadas, bloqueios) continuam as mesmas.
revoke select on public.social_profiles, public.follows, public.posts, public.post_comments,
  public.friendships, public.scraps, public.testimonials,
  public.communities, public.community_members, public.community_topics, public.topic_replies,
  public.community_polls, public.poll_options
from anon;

do $$
declare f text;
begin
  foreach f in array array['public.are_friends(uuid, uuid)', 'public.can_read_community(uuid)', 'public.can_see_wall(uuid)',
                           'public.community_role(uuid)', 'public.conecta_can_see(uuid)', 'public.is_blocked_between(uuid, uuid)',
                           'public.is_community_mod(uuid)'] loop
    execute format('revoke execute on function %s from anon', f);
  end loop;
end $$;
