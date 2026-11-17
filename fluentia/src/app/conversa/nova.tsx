import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Loading, Notice, Screen } from '@/components/ui';
import { SCENARIOS } from '@/content/scenarios';
import { createConversation, getLangSummary, getLesson } from '@/db/repo';
import { useApp } from '@/state/app';

/** Cria a conversa (por cenário ou para praticar uma lição) e abre a tela dela. */
export default function NewConversation() {
  const { scenario, lessonId } = useLocalSearchParams<{ scenario?: string; lessonId?: string }>();
  const router = useRouter();
  const { db, lang } = useApp();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const level = (await getLangSummary(db, lang)).level;
      let id: number;
      if (lessonId) {
        const lesson = await getLesson(db, lessonId);
        if (!lesson) throw new Error('Lição não encontrada.');
        id = await createConversation(db, lang, `lesson:${lessonId}`, `Prática: ${lesson.title}`, level);
      } else {
        const sc = SCENARIOS.find((x) => x.id === scenario) ?? SCENARIOS[0];
        id = await createConversation(db, lang, sc.id, sc.title, level);
      }
      router.replace(`/conversa/${id}`);
    })().catch((e) => setError(e instanceof Error ? e.message : 'Erro ao criar a conversa.'));
  }, [db, lang, scenario, lessonId, router]);
  return error ? <Screen><Notice tone="danger" text={error} /></Screen> : <Loading />;
}
