-- 0039_rastreamento_broadcast: avisos do rastreamento por Supabase Realtime Broadcast em canal PRIVADO, um por pedido.
--  * Tópico: 'rastreio:<id do pedido>'. Só recebe quem pode ver o pedido (public.can_view_order): cliente do pedido,
--    equipe do estabelecimento, entregador atribuído (parceiro ou próprio) e equipe da plataforma com orders.view.
--  * Ninguém publica pelo navegador (não há política de INSERT): só o banco envia, por gatilho, quando a posição/rota muda.
--  * A mensagem NÃO leva coordenadas: o app recebe "atualizado" e lê delivery_tracking(), que arredonda por perfil (0037).
--  * O aviso por postgres_changes da 0037 continua funcionando como reserva.
--  * Fora do Supabase (banco local de testes) o esquema realtime não existe: o bloco abaixo não faz nada.

-- extrai o pedido do tópico sem quebrar com tópicos de outro formato
create or replace function public.tracking_topic_order(_topic text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if _topic !~ '^rastreio:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return substr(_topic, 10)::uuid;
end $$;
-- só converte texto em id (não lê dados); usada pela política de recebimento
revoke all on function public.tracking_topic_order(text) from public, anon;
grant execute on function public.tracking_topic_order(text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'realtime' and p.proname = 'send')
     or not exists (select 1 from pg_tables where schemaname = 'realtime' and tablename = 'messages') then
    raise notice 'Tucaí 0039: Realtime Broadcast indisponível neste banco (ambiente local); nada a fazer.';
    return;
  end if;

  execute $f$
    create or replace function private.tracking_broadcast() returns trigger
    language plpgsql security definer set search_path = '' as $b$
    begin
      perform realtime.send(jsonb_build_object('version', new.version), 'atualizado', 'rastreio:' || new.order_id::text, true);
      return null;
    end $b$
  $f$;
  execute 'revoke all on function private.tracking_broadcast() from public, anon, authenticated';
  execute 'drop trigger if exists delivery_tracking_broadcast on public.delivery_tracking_ticks';
  execute 'create trigger delivery_tracking_broadcast after insert or update on public.delivery_tracking_ticks for each row execute function private.tracking_broadcast()';

  -- receber: só quem pode ver o pedido do tópico
  execute 'drop policy if exists tucai_rastreio_receber on realtime.messages';
  execute $p$
    create policy tucai_rastreio_receber on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast'
             and public.tracking_topic_order(realtime.topic()) is not null
             and public.can_view_order(public.tracking_topic_order(realtime.topic())))
  $p$;
end $$;
