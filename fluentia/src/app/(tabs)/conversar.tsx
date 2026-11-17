import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { LangSwitcher } from '@/components/LangSwitcher';
import { Button, Card, Loading, Notice, Pill, Row, Screen, Section, T, type IconName } from '@/components/ui';
import { LEVELS } from '@/content';
import { SCENARIOS } from '@/content/scenarios';
import { getLangSummary, listConversations } from '@/db/repo';
import { useApp, useData } from '@/state/app';
import { colors, radius, space } from '@/theme';

export default function Talk() {
  const router = useRouter();
  const { lang, ai } = useApp();
  const { data } = useData(async (db) => ({
    level: (await getLangSummary(db, lang)).level,
    history: await listConversations(db, lang),
    configured: await ai.isConfigured(),
  }), [lang]);
  if (!data) return <Loading />;
  const li = LEVELS.indexOf(data.level);

  return (
    <Screen>
      <T v="h1">Conversar com a IA</T>
      <LangSwitcher />
      {!data.configured ? (
        <Notice tone="warn" icon="key" text="O professor de IA ainda não está configurado. Ele precisa de um backend seu com uma chave de IA (o app não guarda chaves de provedores).">
          <Button small variant="secondary" title="Configurar agora" onPress={() => router.push('/configuracoes-ia')} style={s.mt} />
        </Notice>
      ) : (
        <Notice icon="cloud-upload-outline" text="Na conversa, o texto das suas mensagens é enviado ao seu backend e ao provedor de IA configurado. A voz é transcrita pelo serviço de fala do Android; o áudio não vai para o backend." />
      )}

      <Section title="Cenários">
        {SCENARIOS.map((sc) => {
          const advanced = LEVELS.indexOf(sc.minLevel) > li;
          return (
            <Card key={sc.id} testID={`cenario-${sc.id}`} onPress={() => router.push(`/conversa/nova?scenario=${sc.id}`)}>
              <Row gap={space.md}>
                <View style={s.icon}><Ionicons name={sc.icon as IconName} size={20} color={colors.primary} /></View>
                <View style={s.fill}>
                  <T v="h3">{sc.title}</T>
                  {advanced ? <T v="small">Recomendado a partir do {sc.minLevel}; o professor vai simplificar para o seu nível.</T> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Row>
            </Card>
          );
        })}
      </Section>

      <Section title="Conversas anteriores">
        {data.history.length === 0 ? <T v="small">Nenhuma conversa ainda.</T> : null}
        {data.history.slice(0, 20).map((c) => (
          <Card key={c.id} onPress={() => router.push(`/conversa/${c.id}`)}>
            <Row style={s.between}>
              <View style={s.fill}>
                <T v="h3">{c.title}</T>
                <T v="small">{new Date(c.updated_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {c.messages} mensagens</T>
              </View>
              {c.errors ? <Pill text={`${c.errors} correções`} tone="warn" /> : <Pill text={c.level} />}
            </Row>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  mt: { marginTop: space.sm },
  between: { justifyContent: 'space-between' },
  icon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
