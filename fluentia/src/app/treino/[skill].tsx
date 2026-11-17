import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ExerciseSession, type SessionResult } from '@/components/ExerciseSession';
import { Button, Card, Header, Loading, Notice, Screen, T } from '@/components/ui';
import { getCompletedLessons, getHardItems } from '@/db/repo';
import { buildDrill, scoreSession, SKILL_NAMES } from '@/domain/exercises';
import { useApp, useData, useStudyTimer } from '@/state/app';
import { colors } from '@/theme';

type DrillSkill = 'listening' | 'speaking' | 'writing';

export default function Drill() {
  const { skill: raw } = useLocalSearchParams<{ skill: string }>();
  const skill: DrillSkill = raw === 'speaking' || raw === 'writing' ? raw : 'listening';
  const router = useRouter();
  const { lang, speech } = useApp();
  const [seed, setSeed] = useState(() => Date.now() % 100000);
  const [results, setResults] = useState<SessionResult[] | null>(null);
  useStudyTimer(lang, `drill-${skill}`);
  const { data } = useData(async (db) => {
    const items = (await getCompletedLessons(db, lang)).flatMap((l) => [...l.words, ...l.sentences]);
    const hard = new Set((await getHardItems(db, lang, 20)).map((h) => h.item_id));
    // Itens difíceis aparecem duas vezes no sorteio: mais chance de cair no treino.
    return [...items, ...items.filter((i) => hard.has(i.id))];
  }, [lang]);
  const exercises = useMemo(() => {
    if (!data?.length) return [];
    const uniq = new Map(data.map((i) => [i.id, i]));
    const list = buildDrill([...uniq.values()], lang, skill, seed, 10);
    return list;
  }, [data, lang, skill, seed]);

  if (!data) return <Loading />;
  if (skill === 'speaking' && !speech) {
    return (
      <Screen>
        <Header title="Treino de fala" onBack={() => router.back()} />
        <Notice tone="warn" text="O reconhecimento de fala não está disponível neste aparelho. Instale ou ative o app Google (Reconhecimento de voz) e tente de novo." />
      </Screen>
    );
  }
  if (!exercises.length) {
    return (
      <Screen>
        <Header title={`Treino de ${SKILL_NAMES[skill].toLowerCase()}`} onBack={() => router.back()} />
        <Notice text="Conclua ao menos uma lição deste idioma para treinar com o que você já estudou." />
      </Screen>
    );
  }
  if (results) {
    const sc = scoreSession(results.filter((r): r is { skill: DrillSkill; correct: boolean } => r.correct !== null));
    return (
      <Screen>
        <Header title={`Treino de ${SKILL_NAMES[skill].toLowerCase()}`} onBack={() => router.back()} />
        <Card tone={sc.ratio >= 0.7 ? 'success' : 'warn'}>
          <T v="h2">{sc.correct} de {sc.total} certos</T>
          <T v="small" color={colors.text}>Os erros já anteciparam a revisão desses itens.</T>
        </Card>
        <Button title="Treinar de novo" icon="refresh" onPress={() => { setSeed((x) => x + 11); setResults(null); }} />
        <Button variant="secondary" title="Voltar" onPress={() => router.back()} />
      </Screen>
    );
  }
  return <ExerciseSession exercises={exercises} context="drill" title={`Treino de ${SKILL_NAMES[skill].toLowerCase()}`} onExit={() => router.back()} onFinish={setResults} />;
}
