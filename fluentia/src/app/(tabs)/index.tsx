import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LangSwitcher } from '@/components/LangSwitcher';
import { Welcome } from '@/components/Welcome';
import { Button, Card, Loading, Pill, ProgressBar, Row, Screen, Section, Stat, T } from '@/components/ui';
import { LANGS, LEVEL_NAMES, type LangCode, type Level } from '@/content';
import { getTotals } from '@/db/repo';
import { levelFromXp } from '@/domain/gamification';
import { formatMinutes, loadPlan } from '@/services/planning';
import { useApp, useData } from '@/state/app';
import { colors, radius, space } from '@/theme';

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

const TASK_ICON = { review: 'refresh-circle', lesson: 'book', skill: 'fitness', conversation: 'chatbubbles' } as const;

export default function Home() {
  const router = useRouter();
  const { profile, lang, setLang } = useApp();
  const { data } = useData(async (db) => ({ plan: await loadPlan(db), totals: await getTotals(db) }));

  if (!profile.name) return <Welcome />;
  if (!data) return <Loading />;
  const { plan, totals } = data;
  const sum = plan.summaries[lang];
  const L = LANGS[lang];
  const goal = Math.min(1, plan.secondsToday / (plan.dailyMinutes * 60));
  const xp = levelFromXp(totals.xp);
  const levels = Object.fromEntries(Object.entries(plan.summaries).map(([k, v]) => [k, v.level])) as Record<LangCode, Level>;
  const pending = plan.plan.tasks;

  const openTask = async (t: (typeof pending)[number]) => {
    if (t.lang !== lang) await setLang(t.lang);
    if (t.kind === 'review') router.push('/revisao');
    else if (t.kind === 'lesson' && t.lessonId) router.push(`/licao/${t.lessonId}`);
    else if (t.kind === 'skill') router.push('/(tabs)/aprender');
    else router.push('/(tabs)/conversar');
  };

  return (
    <Screen>
      <Row style={s.between}>
        <View style={s.fill}>
          <T v="small">{greeting()},</T>
          <T v="h1" testID="saudacao">
            {profile.name || 'estudante'}
          </T>
        </View>
        <View style={s.streak} accessibilityLabel={`Sequência de ${totals.streak} dias`}>
          <Ionicons name="flame" size={20} color={totals.streak > 0 ? colors.warn : colors.faint} />
          <T v="h3" testID="sequencia">
            {totals.streak}
          </T>
        </View>
      </Row>

      <LangSwitcher levels={levels} />

      <Animated.View entering={FadeInDown.duration(300)}>
        <LinearGradient colors={['#2A2560', '#17152E', colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <Row style={s.between}>
            <View>
              <T v="tiny" color="#C9C4FF">
                {L.flag} {L.name} · {L.nativeName}
              </T>
              <T v="h1" testID="nivel-atual">
                Nível {sum.level}
              </T>
              <T v="small" color="#C9C4FF">
                {LEVEL_NAMES[sum.level]}
                {L.examRef[sum.level] ? ` · ${L.examRef[sum.level]}` : ''}
              </T>
            </View>
            <View style={s.heroPct}>
              <T v="h2">{Math.round(sum.levelProgress * 100)}%</T>
              <T v="small" color="#C9C4FF">
                do nível
              </T>
            </View>
          </Row>
          <ProgressBar value={sum.levelProgress} />
          {sum.nextLesson ? (
            <View style={s.next}>
              <T v="tiny" color="#C9C4FF">
                {sum.started ? 'Próxima aula recomendada' : 'Comece por aqui'}
              </T>
              <T v="h3">{sum.nextLesson.title}</T>
              <T v="small" color="#C9C4FF" numberOfLines={2}>
                {sum.nextLesson.objective}
              </T>
            </View>
          ) : (
            <T v="small" color="#C9C4FF">
              Você concluiu todas as lições disponíveis de {L.name}. Revise, converse com o professor ou gere novas lições com IA em Aprender.
            </T>
          )}
          <Button testID="continuar-estudando" title={sum.started ? 'Continuar estudando' : 'Começar'} icon="play" onPress={() => (sum.nextLesson ? router.push(`/licao/${sum.nextLesson.id}`) : router.push('/(tabs)/aprender'))} />
          <Button testID="conversar-professor" variant="secondary" title="Conversar com o professor" icon="chatbubbles" onPress={() => router.push('/(tabs)/conversar')} />
        </LinearGradient>
      </Animated.View>

      <Card>
        <Row style={s.between}>
          <T v="h3">Meta de hoje</T>
          <T v="small" testID="tempo-hoje">
            {formatMinutes(plan.secondsToday)} de {plan.dailyMinutes} min
          </T>
        </Row>
        <ProgressBar value={goal} color={goal >= 1 ? colors.success : colors.primary} />
        <T v="small">{goal >= 1 ? 'Meta diária cumprida. 🎉' : plan.plan.reason}</T>
      </Card>

      <Row gap={space.sm} wrap>
        <Stat icon="text" value={String(sum.wordsLearned)} label="palavras aprendidas" />
        <Stat icon="checkmark-done" value={`${sum.lessonsCompleted}/${sum.lessonsTotal}`} label="aulas concluídas" color={colors.success} />
        <Stat icon="star" value={String(totals.xp)} label={`XP · nível ${xp.level}`} color={colors.warn} />
      </Row>

      <Section title="Para hoje">
        {pending.length === 0 ? (
          <Card>
            <T v="small">Nada pendente no plano de hoje. Estude o que quiser em Aprender.</T>
          </Card>
        ) : (
          pending.map((t, i) => (
            <Card key={`${t.kind}-${t.lang}-${i}`} onPress={() => openTask(t)} testID={`tarefa-${t.kind}-${t.lang}`}>
              <Row gap={space.md}>
                <View style={s.taskIcon}>
                  <Ionicons name={TASK_ICON[t.kind]} size={20} color={colors.primary} />
                </View>
                <View style={s.fill}>
                  <T v="h3" numberOfLines={1}>
                    {t.title}
                  </T>
                  <T v="small">
                    {LANGS[t.lang].flag} {LANGS[t.lang].name} · {t.detail}
                  </T>
                </View>
                <Pill text={`${t.minutes} min`} />
              </Row>
            </Card>
          ))
        )}
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  between: { justifyContent: 'space-between' },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  hero: { borderRadius: radius.lg, padding: space.lg, gap: space.md, borderWidth: 1, borderColor: 'rgba(139,128,249,0.35)' },
  heroPct: { alignItems: 'flex-end' },
  next: { gap: 2, backgroundColor: 'rgba(12,12,17,0.35)', borderRadius: radius.md, padding: space.md },
  taskIcon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
