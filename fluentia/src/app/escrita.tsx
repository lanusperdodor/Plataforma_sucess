import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Card, Header, Loading, Notice, Pill, Row, Screen, Section, T } from '@/components/ui';
import { LANGS } from '@/content';
import { getLangSummary, listWriting, recordAttempt, saveWriting, type WritingFeedback } from '@/db/repo';
import { AiError } from '@/services/ai/client';
import { correctWriting, pickWritingPrompt, WRITING_TASKS, type WritingTaskId } from '@/services/ai/tutor';
import { useApp, useData, useStudyTimer } from '@/state/app';
import { colors, radius, space } from '@/theme';

export default function Writing() {
  const router = useRouter();
  const { db, ai, lang, refresh } = useApp();
  const [task, setTask] = useState<WritingTaskId>('sentence');
  const [seed, setSeed] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<WritingFeedback | null>(null);
  useStudyTimer(lang, 'writing');
  const { data } = useData(async (d) => ({ level: (await getLangSummary(d, lang)).level, history: await listWriting(d, lang, 10), configured: await ai.isConfigured() }), [lang]);
  const prompt = useMemo(() => (data ? pickWritingPrompt(task, lang, data.level, seed) : ''), [data, task, lang, seed]);
  if (!data) return <Loading />;
  const L = LANGS[lang];
  const info = WRITING_TASKS.find((t) => t.id === task)!;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const fb = await correctWriting(ai, lang, data.level, info.title, prompt, text.trim());
      setFeedback(fb);
      await saveWriting(db, lang, task, prompt, text.trim(), fb);
      await recordAttempt(db, { lang, lessonId: null, itemId: null, type: 'writing', skill: 'writing', correct: fb.issues.length === 0, userAnswer: text.trim(), context: 'drill' });
      await refresh();
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'Não foi possível corrigir o texto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="Escrita com correção" subtitle={`${L.flag} ${L.name} · ${data.level}`} onBack={() => router.back()} />
      {!data.configured ? <Notice tone="warn" text="A correção de textos livres usa o professor de IA, que ainda não está configurado."><Button small variant="secondary" title="Configurar IA" onPress={() => router.push('/configuracoes-ia')} style={s.mt} /></Notice> : null}
      <Row gap={space.sm} wrap>
        {WRITING_TASKS.map((t) => (
          <Pressable key={t.id} onPress={() => { setTask(t.id); setFeedback(null); setText(''); }} style={[s.tab, task === t.id && s.tabOn]}>
            <T v="small" color={task === t.id ? colors.text : colors.muted}>{t.title}</T>
          </Pressable>
        ))}
      </Row>
      <Card>
        <T v="tiny">{info.hint}</T>
        <T v="h3" selectable testID="enunciado">{prompt}</T>
        <Button small variant="ghost" icon="shuffle" title="Outro tema" onPress={() => { setSeed(seed + 1); setFeedback(null); }} />
      </Card>
      <TextInput testID="texto" value={text} onChangeText={setText} multiline placeholder={`Escreva em ${L.name.toLowerCase()}…`} placeholderTextColor={colors.faint} style={s.input} autoCorrect={false} spellCheck={false} />
      <T v="small">O texto é enviado ao provedor de IA configurado para correção.</T>
      {error ? <Notice tone="danger" icon="alert-circle" text={error} /> : null}
      <Button testID="corrigir" title={feedback ? 'Corrigir nova versão' : 'Corrigir'} icon="checkmark-done" loading={busy} disabled={!text.trim() || !data.configured} onPress={submit} />

      {feedback ? (
        <Section title="Correção">
          <Card tone={feedback.issues.length ? 'warn' : 'success'}>
            <T color={colors.text}>{feedback.summary}</T>
            {feedback.levelEstimate ? <Pill text={`Estimativa da IA: ${feedback.levelEstimate}`} icon="sparkles" /> : null}
          </Card>
          {feedback.issues.length ? (
            <Card>
              <T v="tiny">Versão corrigida</T>
              <T v="h3" color={colors.success} selectable>{feedback.corrected}</T>
            </Card>
          ) : null}
          {feedback.issues.map((iss, k) => (
            <Card key={k}>
              <Pill text={iss.category} tone="warn" />
              {iss.original ? <T style={s.strike}>{iss.original}</T> : null}
              {iss.suggestion ? <T v="h3" color={colors.success}>{iss.suggestion}</T> : null}
              <T v="small" color={colors.text}>{iss.explanation}</T>
            </Card>
          ))}
          {feedback.strengths?.length ? <Card><T v="tiny">Pontos fortes</T>{feedback.strengths.map((p, k) => <T key={k} v="small" color={colors.text}>• {p}</T>)}</Card> : null}
          <T v="small">Reescreva o texto acima aplicando as correções e corrija de novo.</T>
        </Section>
      ) : null}

      {data.history.length ? (
        <Section title="Textos anteriores">
          {data.history.map((h) => (
            <Card key={h.id}>
              <T v="small">{new Date(h.created_at).toLocaleDateString('pt-BR')} · {h.prompt}</T>
              <T numberOfLines={3}>{h.text}</T>
            </Card>
          ))}
        </Section>
      ) : null}
      <View />
    </Screen>
  );
}

const s = StyleSheet.create({
  mt: { marginTop: space.sm },
  tab: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  input: { minHeight: 160, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, color: colors.text, fontSize: 17, padding: space.lg, textAlignVertical: 'top' },
  strike: { textDecorationLine: 'line-through', color: colors.danger },
});
