import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ExerciseSession, type SessionResult } from '@/components/ExerciseSession';
import { AudioButtons, TargetText } from '@/components/learn';
import { Button, Card, Header, Loading, Notice, Pill, ProgressBar, Row, Screen, Section, T } from '@/components/ui';
import { display, LANGS, type Item } from '@/content';
import { getLesson, getUnitSiblings, markLessonStarted, recordAssessment } from '@/db/repo';
import { buildLessonExercises, PASS_RATIO, scoreSession, SKILL_NAMES, type SessionScore, type Skill } from '@/domain/exercises';
import { useApp, useData, useStudyTimer } from '@/state/app';
import { colors, space } from '@/theme';

type Stage = 'intro' | 'practice' | 'practiced' | 'assessment' | 'result';

function ItemRow({ item, readingHidden }: { item: Item; readingHidden: boolean }) {
  const { lang } = useApp();
  return (
    <Row gap={space.md} style={s.item}>
      <View style={s.fill}>
        <TargetText text={display(lang, item.t)} reading={item.r} readingHidden={readingHidden} lang={lang} small />
        <T v="small">{item.pt}</T>
      </View>
      <AudioButtons text={display(lang, item.t)} lang={lang} />
    </Row>
  );
}

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { db, lang, speech, refresh } = useApp();
  const [stage, setStage] = useState<Stage>('intro');
  const [seed, setSeed] = useState(() => Date.now() % 100000);
  const [score, setScore] = useState<SessionScore | null>(null);
  const [firstCompletion, setFirstCompletion] = useState(false);
  const { data, error } = useData(async (d) => {
    const lesson = await getLesson(d, id);
    if (!lesson) return null;
    const siblings = await getUnitSiblings(d, id);
    return { lesson, pool: siblings.flatMap((l) => [...l.words, ...l.sentences]) };
  }, [id]);
  useStudyTimer(lang, 'lesson');

  const practice = useMemo(() => (data ? buildLessonExercises(data.lesson, lang, { mode: 'practice', seed, pool: data.pool, speech }) : []), [data, lang, seed, speech]);
  const assessment = useMemo(() => (data ? buildLessonExercises(data.lesson, lang, { mode: 'assessment', seed: seed + 1, pool: data.pool, speech }) : []), [data, lang, seed, speech]);

  if (error) return <Screen><Notice tone="danger" text={error} /></Screen>;
  if (data === null) return <Loading />;
  if (!data) return <Screen><Header title="Lição" onBack={() => router.back()} /><Notice tone="warn" text="Lição não encontrada." /></Screen>;
  const { lesson } = data;
  const L = LANGS[lang];

  const finishAssessment = async (results: SessionResult[]) => {
    const graded = results.filter((r): r is { skill: Skill; correct: boolean } => r.correct !== null);
    const sc = scoreSession(graded);
    const res = await recordAssessment(db, lang, lesson, sc);
    setScore(sc);
    setFirstCompletion(res.firstCompletion);
    await refresh();
    setStage('result');
  };

  if (stage === 'practice') {
    return <ExerciseSession exercises={practice} context="practice" title="Prática" onExit={() => setStage('intro')} onFinish={() => setStage('practiced')} />;
  }
  if (stage === 'assessment') {
    return <ExerciseSession exercises={assessment} context="assessment" title="Avaliação" onExit={() => setStage('intro')} onFinish={finishAssessment} />;
  }

  if (stage === 'result' && score) {
    return (
      <Screen>
        <Header title={lesson.title} onBack={() => router.back()} />
        <Card tone={score.passed ? 'success' : 'warn'}>
          <Row gap={space.md}>
            <Ionicons name={score.passed ? 'trophy' : 'refresh-circle'} size={36} color={score.passed ? colors.success : colors.warn} />
            <View style={s.fill}>
              <T v="h2" testID="resultado-avaliacao">
                {score.passed ? 'Lição concluída!' : 'Ainda não foi desta vez'}
              </T>
              <T v="small" color={colors.text}>
                Você acertou {score.correct} de {score.total} ({Math.round(score.ratio * 100)}%). {score.passed ? (firstCompletion ? 'O vocabulário entrou nas suas revisões.' : '') : `É preciso ${Math.round(PASS_RATIO * 100)}% para concluir.`}
              </T>
            </View>
          </Row>
        </Card>
        <Section title="Por habilidade">
          {(Object.entries(score.bySkill) as [Skill, { total: number; correct: number }][]).map(([skill, v]) => (
            <Card key={skill}>
              <Row style={s.between}>
                <T v="h3">{SKILL_NAMES[skill]}</T>
                <T v="small">{v.correct}/{v.total}</T>
              </Row>
              <ProgressBar value={v.correct / v.total} color={v.correct / v.total >= PASS_RATIO ? colors.success : colors.warn} />
            </Card>
          ))}
          {!speech ? <Notice text="A fala não foi avaliada: o reconhecimento de voz não está disponível neste aparelho." /> : null}
        </Section>
        {score.passed ? (
          <>
            <Button testID="praticar-conversa" title="Praticar em conversa" icon="chatbubbles" onPress={() => router.push(`/conversa/nova?lessonId=${lesson.id}`)} />
            <Button variant="secondary" title="Voltar" onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Button title="Revisar e praticar de novo" icon="refresh" onPress={() => { setSeed((x) => x + 7); setStage('intro'); }} />
            <Button variant="secondary" title="Tentar a avaliação de novo" onPress={() => { setSeed((x) => x + 3); setStage('assessment'); }} />
          </>
        )}
      </Screen>
    );
  }

  const start = async () => {
    await markLessonStarted(db, lesson.id, lang);
    setStage('practice');
  };

  return (
    <Screen>
      <Header title={lesson.title} subtitle={`${L.flag} ${L.name}`} onBack={() => router.back()} />
      {stage === 'practiced' ? (
        <Card tone="primary">
          <T v="h3">Prática concluída</T>
          <T v="small" color={colors.text}>Agora a avaliação: sem dicas de leitura e cobrindo cada habilidade. Com {Math.round(PASS_RATIO * 100)}% de acerto a lição é concluída.</T>
          <Button testID="fazer-avaliacao" title="Fazer a avaliação" icon="ribbon" onPress={() => setStage('assessment')} />
          <Button variant="ghost" small title="Praticar mais uma vez" onPress={() => { setSeed((x) => x + 5); setStage('practice'); }} />
        </Card>
      ) : null}
      <Card>
        <T v="tiny">Objetivo</T>
        <T v="h3">{lesson.objective}</T>
        {lesson.id.includes('.g') ? <Pill text="Gerada por IA — pode conter imprecisões" tone="warn" icon="sparkles" /> : null}
      </Card>
      <Section title="Explicação">
        {lesson.explanation.map((p, i) => (
          <T key={i}>{p}</T>
        ))}
      </Section>
      {lesson.pronunciation?.length ? (
        <Section title="Pronúncia">
          {lesson.pronunciation.map((p, i) => (
            <Row key={i} gap={space.sm} style={s.top}>
              <Ionicons name="mic-outline" size={16} color={colors.primary} style={s.bullet} />
              <T style={s.fill}>{p}</T>
            </Row>
          ))}
        </Section>
      ) : null}
      <Section title={lesson.script ? 'Sons e letras' : 'Vocabulário'}>
        <Card>{lesson.words.map((w) => <ItemRow key={w.id} item={w} readingHidden={lesson.reading === 'tap'} />)}</Card>
      </Section>
      <Section title="Exemplos">
        <Card>{lesson.sentences.map((w) => <ItemRow key={w.id} item={w} readingHidden={lesson.reading === 'tap'} />)}</Card>
      </Section>
      {lesson.tones?.length ? <Notice icon="musical-notes" text="Esta lição inclui exercícios de identificação de tons: ouça a sílaba e escolha o tom." /> : null}
      <Card tone="primary">
        <T v="tiny">Conversação</T>
        <T v="small" color={colors.text}>{lesson.scenario}</T>
      </Card>
      {stage === 'intro' ? (
        <>
          <Button testID="comecar-pratica" title="Começar a prática" icon="play" onPress={start} />
          <Button variant="ghost" small title="Já sei — ir direto para a avaliação" onPress={async () => { await markLessonStarted(db, lesson.id, lang); setStage('assessment'); }} />
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  between: { justifyContent: 'space-between' },
  top: { alignItems: 'flex-start' },
  bullet: { marginTop: 3 },
  item: { paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
