import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { LangSwitcher } from '@/components/LangSwitcher';
import { Button, Card, Loading, ProgressBar, Row, Screen, Section, Stat, T } from '@/components/ui';
import { display, LANG_CODES, LANGS } from '@/content';
import { countDue, getHardItems, getReviewOverview } from '@/db/repo';
import { useApp, useData } from '@/state/app';
import { colors, space } from '@/theme';

export default function Review() {
  const router = useRouter();
  const { lang, setLang } = useApp();
  const { data } = useData(async (db) => {
    const others = await Promise.all(LANG_CODES.map(async (l) => [l, await countDue(db, l)] as const));
    return { overview: await getReviewOverview(db, lang), hard: await getHardItems(db, lang), others };
  }, [lang]);
  if (!data) return <Loading />;
  const { overview: o, hard } = data;

  return (
    <Screen>
      <T v="h1">Revisar hoje</T>
      <LangSwitcher />
      <Card tone={o.due ? 'primary' : undefined}>
        <T v="h2" testID="revisoes-pendentes">{o.due ? `${o.due} ${o.due === 1 ? 'item' : 'itens'} para revisar` : 'Tudo revisado por hoje'}</T>
        <T v="small" color={colors.text}>
          {o.total === 0 ? 'As palavras e frases entram aqui quando você conclui uma lição.' : 'A revisão começa pelo que você está mais perto de esquecer.'}
        </T>
        {o.due ? <Button testID="iniciar-revisao" title="Começar revisão" icon="play" onPress={() => router.push('/revisao')} /> : null}
      </Card>

      <Row gap={space.sm} wrap>
        <Stat icon="albums" value={String(o.total)} label="itens no sistema" />
        <Stat icon="calendar" value={String(o.upcoming7)} label="nos próximos 7 dias" />
        <Stat icon="pulse" value={o.retention30 === null ? '—' : `${Math.round(o.retention30 * 100)}%`} label={`retenção (30 dias, ${o.reviews30} revisões)`} color={colors.success} />
      </Row>
      {o.retention30 !== null ? (
        <Card>
          <T v="small">Retenção = revisões em que você lembrou, entre itens já aprendidos. O alvo do algoritmo (FSRS) é 90%.</T>
          <ProgressBar value={o.retention30} color={o.retention30 >= 0.85 ? colors.success : colors.warn} />
        </Card>
      ) : null}

      {data.others.some(([l, n]) => l !== lang && n > 0) ? (
        <Section title="Outros idiomas">
          {data.others.filter(([l, n]) => l !== lang && n > 0).map(([l, n]) => (
            <Card key={l} onPress={() => setLang(l)}>
              <T v="h3">{LANGS[l].flag} {LANGS[l].name}: {n} para revisar</T>
            </Card>
          ))}
        </Section>
      ) : null}

      <Section title="Suas dificuldades">
        {hard.length === 0 ? <T v="small">Ainda sem dados suficientes.</T> : null}
        {hard.map((h) => (
          <Card key={h.item_id}>
            <Row style={s.between}>
              <View style={s.fill}>
                <T v="h3">{display(lang, h.term)}</T>
                <T v="small">{h.reading ? `${h.reading} · ` : ''}{h.translation}</T>
              </View>
              <T v="small" color={colors.danger}>{h.wrong_count} erro{h.wrong_count > 1 ? 's' : ''}</T>
            </Row>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({ fill: { flex: 1 }, between: { justifyContent: 'space-between' } });
