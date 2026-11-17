import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { BarChart } from '@/components/charts';
import { LangSwitcher } from '@/components/LangSwitcher';
import { Card, Header, Loading, Notice, ProgressBar, Row, Screen, Section, Stat, T } from '@/components/ui';
import { LANG_CODES, LANGS, LEVELS } from '@/content';
import { getDailySeries, getLangSummary, getReviewOverview, getSkillStats, getSkillTrend, getTotals, listWriting } from '@/db/repo';
import { SKILL_NAMES, SKILLS, type Skill } from '@/domain/exercises';
import { formatMinutes } from '@/services/planning';
import { useApp, useData } from '@/state/app';
import { colors, radius, space } from '@/theme';

export default function Stats() {
  const router = useRouter();
  const { lang } = useApp();
  const [skill, setSkill] = useState<Skill>('listening');
  const { data } = useData(async (db) => {
    const writing = await listWriting(db, lang, 30);
    return {
      totals: await getTotals(db),
      series: await getDailySeries(db, 14, lang),
      skills: await getSkillStats(db, lang, 30),
      trend: await getSkillTrend(db, lang, skill, 8),
      summary: await getLangSummary(db, lang),
      review: await getReviewOverview(db, lang),
      aiLevels: writing.map((w) => (w.feedback_json ? (JSON.parse(w.feedback_json) as { levelEstimate?: string }).levelEstimate : undefined)).filter((x): x is string => !!x && LEVELS.includes(x as never)),
    };
  }, [lang, skill]);
  if (!data) return <Loading />;
  const { totals, series, skills, trend, summary, review } = data;
  const acc = totals.attempts ? totals.correct / totals.attempts : null;

  return (
    <Screen>
      <Header title="Estatísticas" onBack={() => router.back()} />
      <Section title="Geral (todos os idiomas)">
        <Row gap={space.sm} wrap>
          <Stat icon="time" value={formatMinutes(totals.seconds)} label="tempo total" />
          <Stat icon="flame" value={`${totals.streak} d`} label="dias consecutivos" color={colors.warn} />
          <Stat icon="checkmark-done" value={String(totals.attempts)} label="exercícios corrigidos" />
        </Row>
        <Row gap={space.sm} wrap>
          <Stat icon="checkmark" value={String(totals.correct)} label="acertos" color={colors.success} />
          <Stat icon="close" value={String(totals.wrong)} label="erros" color={colors.danger} />
          <Stat icon="analytics" value={acc === null ? '—' : `${Math.round(acc * 100)}%`} label="taxa de acerto" />
        </Row>
        <Card>
          <T v="h3">Tempo por idioma</T>
          {LANG_CODES.map((l) => (
            <Row key={l} style={s.between}>
              <T v="small" color={colors.text}>{LANGS[l].flag} {LANGS[l].name}</T>
              <T v="small">{formatMinutes(totals.secondsByLang[l])}</T>
            </Row>
          ))}
        </Card>
      </Section>

      <LangSwitcher />
      <Section title={`${LANGS[lang].name}: últimos 14 dias`}>
        <Card>
          <T v="tiny">Minutos estudados por dia</T>
          <BarChart testID="grafico-tempo" data={series.map((d) => ({ label: d.day.slice(8), value: Math.round(d.seconds / 60) }))} />
        </Card>
        <Card>
          <T v="tiny">Taxa de acerto por dia</T>
          <BarChart data={series.map((d) => ({ label: d.day.slice(8), value: d.total ? d.correct / d.total : null }))} max={1} color={colors.success} format={(v) => `${Math.round(v * 100)}%`} />
        </Card>
      </Section>

      <Section title="Acerto por habilidade (30 dias)">
        <Notice text="Medidas objetivas: proporção de respostas corrigidas automaticamente como certas. A fala mede só se o reconhecedor entendeu as palavras." />
        {skills.map((sk) => (
          <Card key={sk.skill}>
            <Row style={s.between}><T v="h3">{SKILL_NAMES[sk.skill]}</T><T v="small">{sk.total ? `${Math.round((sk.accuracy ?? 0) * 100)}% de ${sk.total}` : 'sem dados'}</T></Row>
            <ProgressBar value={sk.accuracy ?? 0} color={(sk.accuracy ?? 0) >= 0.75 ? colors.success : colors.warn} />
          </Card>
        ))}
      </Section>

      <Section title="Evolução semanal">
        <Row gap={space.xs} wrap>
          {SKILLS.map((sk) => (
            <Pressable key={sk} onPress={() => setSkill(sk)} style={[s.tab, skill === sk && s.tabOn]}><T v="small" color={skill === sk ? colors.text : colors.muted}>{SKILL_NAMES[sk]}</T></Pressable>
          ))}
        </Row>
        <Card>
          <T v="tiny">{SKILL_NAMES[skill]}: acerto por semana</T>
          <BarChart data={trend.map((t) => ({ label: t.label, value: t.accuracy }))} max={1} format={(v) => `${Math.round(v * 100)}%`} />
        </Card>
      </Section>

      <Section title="Nível">
        <Card>
          <T v="h3">Nível do curso: {summary.level} ({Math.round(summary.levelProgress * 100)}% das lições)</T>
          <T v="small">Baseado em avaliações concluídas com ao menos 70% de acerto. Não é certificação.</T>
          <T v="small">Revisões: {review.total} itens; retenção {review.retention30 === null ? 'sem dados' : `${Math.round(review.retention30 * 100)}%`} (medida).</T>
          {data.aiLevels.length ? <T v="small" color={colors.warn}>Estimativa da IA pela sua escrita (últimos textos): {data.aiLevels.slice(0, 5).join(', ')} — opinião do modelo, não medição.</T> : null}
        </Card>
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  tab: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
