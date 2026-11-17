import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LangSwitcher } from '@/components/LangSwitcher';
import { Button, Card, Loading, Notice, Pill, ProgressBar, Row, Screen, Section, T } from '@/components/ui';
import { LANGS, LEVEL_NAMES, LEVELS, type Level } from '@/content';
import { flattenLessons, getCompletedLessons, getCourseTree, getLangSummary, isUnlocked, saveAiLesson, type UnitRow } from '@/db/repo';
import { AiError } from '@/services/ai/client';
import { generateLesson } from '@/services/ai/lessonGen';
import { useApp, useData } from '@/state/app';
import { colors, radius, space } from '@/theme';

export default function Learn() {
  const router = useRouter();
  const { db, ai, lang, refresh } = useApp();
  const [open, setOpen] = useState<Level | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const { data } = useData(async (d) => {
    const tree = await getCourseTree(d, lang);
    const summary = await getLangSummary(d, lang);
    const completed = await getCompletedLessons(d, lang);
    return { tree, summary, studiedItems: completed.reduce((n, l) => n + l.words.length + l.sentences.length, 0) };
  }, [lang]);

  if (!data) return <Loading />;
  const { tree, summary } = data;
  const lessons = flattenLessons(tree);
  const L = LANGS[lang];
  const current = open ?? summary.level;

  const generate = async (unit: UnitRow) => {
    setBusy(unit.id);
    setGenError(null);
    try {
      const known = (await getCompletedLessons(db, lang)).flatMap((l) => [...l.words, ...l.sentences].map((i) => i.t)).slice(-80);
      const lesson = await generateLesson(ai, { lang, level: unit.level, unitId: unit.id, unitTitle: unit.title, unitGoals: unit.description, existing: unit.lessons.map((l) => l.title), known }, unit.lessons.length + 1);
      await saveAiLesson(db, unit.id, lesson);
      await refresh();
    } catch (e) {
      setGenError(e instanceof AiError ? e.message : 'Não foi possível gerar a lição.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <T v="h1">Aprender</T>
      <LangSwitcher />

      <Section title="Treinos livres">
        {data.studiedItems === 0 ? <T v="small">Conclua uma lição para liberar os treinos com o que você já estudou.</T> : null}
        <Row gap={space.sm} wrap>
          <Drill icon="ear" title="Escuta" disabled={!data.studiedItems} onPress={() => router.push('/treino/listening')} />
          <Drill icon="mic" title="Fala" disabled={!data.studiedItems} onPress={() => router.push('/treino/speaking')} />
          <Drill icon="pencil" title="Escrita" disabled={!data.studiedItems} onPress={() => router.push('/treino/writing')} />
          <Drill icon="document-text" title="Redação com IA" onPress={() => router.push('/escrita')} />
        </Row>
      </Section>

      <View style={s.levels}>
        {LEVELS.map((lv) => {
          const inLv = lessons.filter((l) => l.level === lv);
          const done = inLv.filter((l) => l.status === 'completed').length;
          return (
            <Pressable key={lv} testID={`nivel-${lv}`} onPress={() => setOpen(lv)} style={[s.level, current === lv && s.levelOn]} accessibilityRole="tab" accessibilityState={{ selected: current === lv }}>
              <T v="h3" color={current === lv ? colors.text : colors.muted}>{lv}</T>
              <T v="small">{inLv.length ? `${done}/${inLv.length}` : '—'}</T>
            </Pressable>
          );
        })}
      </View>

      <Card>
        <T v="h2">{current} · {LEVEL_NAMES[current]}</T>
        {L.examRef[current] ? <T v="small">Referência: {L.examRef[current]}. Os níveis CEFR e {lang === 'ko' ? 'TOPIK' : 'HSK'} não têm equivalência exata.</T> : null}
        <T v="small">Concluir lições aqui mede seu progresso no curso; não é certificação oficial.</T>
      </Card>

      {genError ? <Notice tone="danger" icon="alert-circle" text={genError} /> : null}

      {tree.filter((u) => u.level === current).map((u) => {
        const done = u.lessons.filter((l) => l.status === 'completed').length;
        return (
          <Section key={u.id} title={u.title}>
            <T v="small">{u.description}</T>
            {u.lessons.length ? <ProgressBar value={done / u.lessons.length} color={colors.success} height={6} /> : null}
            {u.lessons.map((l) => {
              const unlocked = isUnlocked(lessons, l.id);
              return (
                <Card key={l.id} testID={`licao-${l.id}`} onPress={unlocked ? () => router.push(`/licao/${l.id}`) : undefined} style={!unlocked && s.locked}>
                  <Row gap={space.md}>
                    <View style={[s.dot, l.status === 'completed' && s.dotDone, l.status === 'started' && s.dotStarted]}>
                      <Ionicons name={l.status === 'completed' ? 'checkmark' : unlocked ? 'play' : 'lock-closed'} size={16} color={l.status === 'completed' ? colors.bg : colors.text} />
                    </View>
                    <View style={s.fill}>
                      <T v="h3">{l.title}</T>
                      <T v="small" numberOfLines={2}>{l.objective}</T>
                    </View>
                    {l.best_score ? <Pill text={`${Math.round(l.best_score * 100)}%`} tone={l.status === 'completed' ? 'success' : 'warn'} /> : null}
                  </Row>
                  {l.source === 'ai' ? <Pill text="Gerada por IA" icon="sparkles" /> : null}
                </Card>
              );
            })}
            {u.status === 'planned' || u.lessons.some((l) => l.source === 'ai') ? (
              <Card>
                <T v="small">
                  {u.lessons.length ? 'Quer mais conteúdo nesta unidade?' : 'Unidade prevista no currículo, ainda sem lições escritas.'} O professor de IA pode escrever uma lição seguindo os objetivos acima (requer internet e IA configurada; o conteúdo gerado fica salvo para uso offline).
                </T>
                <Button small variant="secondary" icon="sparkles" title="Gerar lição com IA" loading={busy === u.id} disabled={!!busy} onPress={() => generate(u)} />
              </Card>
            ) : null}
          </Section>
        );
      })}
    </Screen>
  );
}

function Drill({ icon, title, onPress, disabled }: { icon: 'ear' | 'mic' | 'pencil' | 'document-text'; title: string; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [s.drill, disabled && s.locked, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <T v="small" color={colors.text}>{title}</T>
    </Pressable>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  levels: { flexDirection: 'row', gap: space.xs },
  level: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  levelOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  locked: { opacity: 0.45 },
  dot: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dotStarted: { borderColor: colors.primary },
  drill: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.xs },
});
