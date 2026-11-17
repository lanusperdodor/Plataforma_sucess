import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ActivityGrid } from '@/components/charts';
import { Card, Loading, ProgressBar, Row, Screen, Section, Stat, T, type IconName } from '@/components/ui';
import { LANG_CODES, LANGS } from '@/content';
import { getGoals, getLangSummary, getTotals, getUnlockedAchievements, getWeekProgress } from '@/db/repo';
import { ACHIEVEMENTS, levelFromXp } from '@/domain/gamification';
import { addDays, todayKey } from '@/domain/text';
import { formatMinutes } from '@/services/planning';
import { useApp, useData } from '@/state/app';
import { colors, radius, space } from '@/theme';

const LINKS: { icon: IconName; title: string; href: string; detail: string }[] = [
  { icon: 'stats-chart', title: 'Estatísticas', href: '/estatisticas', detail: 'Evolução por habilidade e por idioma' },
  { icon: 'calendar', title: 'Plano de estudos e metas', href: '/plano', detail: 'Tempo diário, dias de cada idioma, metas' },
  { icon: 'sparkles', title: 'Inteligência artificial', href: '/configuracoes-ia', detail: 'Backend, custos e privacidade' },
  { icon: 'shield-checkmark', title: 'Dados e backup', href: '/dados', detail: 'Exportar, restaurar e apagar' },
];

export default function Profile() {
  const router = useRouter();
  const { profile } = useApp();
  const { data } = useData(async (db) => ({
    totals: await getTotals(db),
    summaries: await Promise.all(LANG_CODES.map((l) => getLangSummary(db, l))),
    unlocked: await getUnlockedAchievements(db),
    goals: await getGoals(db),
    week: await getWeekProgress(db),
  }));
  if (!data) return <Loading />;
  const { totals, summaries, unlocked, goals, week } = data;
  const xp = levelFromXp(totals.xp);
  const today = todayKey();
  const days = Array.from({ length: 35 }, (_, i) => addDays(today, i - 34));
  const have = new Set(unlocked.map((u) => u.id));

  return (
    <Screen>
      <Row gap={space.md}>
        <View style={s.avatar}><T v="h1" color={colors.bg}>{(profile.name || '?').slice(0, 1).toUpperCase()}</T></View>
        <View style={s.fill}>
          <T v="h1">{profile.name || 'Perfil'}</T>
          <T v="small">Nível de XP {xp.level} · {totals.xp} XP</T>
          <ProgressBar value={xp.into / xp.span} height={6} />
        </View>
      </Row>

      <Row gap={space.sm} wrap>
        <Stat icon="time" value={formatMinutes(totals.seconds)} label="tempo total" />
        <Stat icon="flame" value={`${totals.streak} d`} label={`sequência (recorde ${totals.longestStreak})`} color={colors.warn} />
        <Stat icon="text" value={String(totals.words)} label="palavras e frases" color={colors.success} />
      </Row>

      <Section title="Idiomas">
        {summaries.map((sm) => (
          <Card key={sm.lang}>
            <Row style={s.between}>
              <T v="h3">{LANGS[sm.lang].flag} {LANGS[sm.lang].name}</T>
              <T v="small">{sm.started ? `${sm.level} · ${sm.lessonsCompleted} aulas · ${formatMinutes(totals.secondsByLang[sm.lang])}` : 'não iniciado'}</T>
            </Row>
            <ProgressBar value={sm.levelProgress} height={6} />
          </Card>
        ))}
      </Section>

      <Section title="Metas da semana">
        <Card>
          <Row style={s.between}><T>Lições concluídas</T><T v="small">{week.lessons}/{goals.weekly_lessons}</T></Row>
          <ProgressBar value={week.lessons / (goals.weekly_lessons || 1)} color={colors.success} />
          <Row style={s.between}><T>Revisões</T><T v="small">{week.reviews}/{goals.weekly_reviews}</T></Row>
          <ProgressBar value={week.reviews / (goals.weekly_reviews || 1)} color={colors.success} />
        </Card>
      </Section>

      <Section title="Atividade (5 semanas)">
        <Card><ActivityGrid days={days} studied={new Set(totals.studyDays)} /></Card>
      </Section>

      <Section title={`Conquistas (${have.size}/${ACHIEVEMENTS.length})`}>
        <View style={s.grid}>
          {ACHIEVEMENTS.map((a) => (
            <View key={a.id} style={[s.badge, !have.has(a.id) && s.locked]} accessibilityLabel={`${a.title}: ${a.description}${have.has(a.id) ? ' (desbloqueada)' : ''}`}>
              <Ionicons name={a.icon as IconName} size={22} color={have.has(a.id) ? colors.warn : colors.faint} />
              <T v="small" color={colors.text} numberOfLines={1}>{a.title}</T>
              <T v="small" numberOfLines={2} style={s.badgeDesc}>{a.description}</T>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Configurações">
        {LINKS.map((l) => (
          <Card key={l.href} onPress={() => router.push(l.href as never)} testID={`link-${l.href.slice(1)}`}>
            <Row gap={space.md}>
              <Ionicons name={l.icon} size={22} color={colors.primary} />
              <View style={s.fill}><T v="h3">{l.title}</T><T v="small">{l.detail}</T></View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </Row>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  between: { justifyContent: 'space-between' },
  avatar: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  badge: { flexBasis: '31%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.sm, gap: 2 },
  badgeDesc: { fontSize: 11, lineHeight: 14 },
  locked: { opacity: 0.4 },
});
