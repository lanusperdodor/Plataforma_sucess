import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { recordAttempt } from '@/db/repo';
import { checkAnswer, SKILL_NAMES, type Exercise, type Outcome, type Skill } from '@/domain/exercises';
import { stopSpeaking } from '@/services/tts';
import { useApp } from '@/state/app';
import { colors, radius, space } from '@/theme';
import { AudioButtons, buzz, DiffView, SpeakPanel, TargetText, type SpeakOutcome } from './learn';
import { Button, IconButton, Pill, ProgressBar, Row, T } from './ui';

export interface SessionResult {
  skill: Skill;
  /** null = não avaliado (não entra na nota). */
  correct: boolean | null;
}

interface Props {
  exercises: Exercise[];
  context: 'practice' | 'assessment' | 'drill';
  title: string;
  onFinish(results: SessionResult[]): void;
  onExit(): void;
}

const LISTEN_TYPES = new Set(['listen_choose', 'listen_pick', 'dictation', 'tone']);
const TYPED = new Set(['translate', 'translate_pt', 'dictation']);

export function ExerciseSession({ exercises, context, title, onFinish, onExit }: Props) {
  const { db, refresh } = useApp();
  const [queue, setQueue] = useState(exercises);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [typed, setTyped] = useState('');
  const [spoken, setSpoken] = useState<SpeakOutcome | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [skipped, setSkipped] = useState(false);

  const ex = queue[index];
  const isRetry = index >= exercises.length;
  const answered = outcome !== null || skipped;

  useEffect(() => () => stopSpeaking(), []);

  const answer = useMemo(() => {
    if (!ex) return '';
    if (ex.options) return choice ?? '';
    if (ex.bank) return picked.map((i) => ex.bank![i]).join(ex.lang === 'zh' ? '' : ' ');
    return typed;
  }, [ex, choice, picked, typed]);

  if (!ex) return null;

  const canCheck = ex.type === 'speak' ? spoken !== null && spoken.matched !== null : answer.trim().length > 0;

  const check = async () => {
    stopSpeaking();
    const result: Outcome = ex.type === 'speak' ? { correct: spoken!.matched === true } : checkAnswer(ex, answer);
    setOutcome(result);
    if (ex.type !== 'speak') buzz(result.correct ? 'ok' : 'bad');
    await recordAttempt(db, {
      lang: ex.lang,
      lessonId: ex.lessonId,
      itemId: ex.itemId.includes('.tone.') ? null : ex.itemId,
      type: ex.type,
      skill: ex.skill,
      correct: result.correct,
      userAnswer: ex.type === 'speak' ? spoken!.transcript : answer,
      expected: ex.accepted[0],
      context,
    });
    // A nota considera só a primeira tentativa de cada exercício.
    if (!isRetry) setResults((r) => [...r, { skill: ex.skill, correct: result.correct }]);
    // Na prática, o que foi errado volta uma vez no fim da sessão.
    if (!result.correct && context !== 'assessment' && !isRetry) setQueue((q) => [...q, { ...ex, id: `${ex.id}~` }]);
  };

  /** Fala que não pôde ser avaliada (sem microfone ou reconhecimento): segue sem contar na nota. */
  const skip = async () => {
    setSkipped(true);
    await recordAttempt(db, { lang: ex.lang, lessonId: ex.lessonId, itemId: ex.itemId, type: ex.type, skill: ex.skill, correct: null, context });
    if (!isRetry) setResults((r) => [...r, { skill: ex.skill, correct: null }]);
  };

  const next = async () => {
    if (index + 1 >= queue.length) {
      await refresh();
      onFinish(results);
      return;
    }
    setChoice(null);
    setPicked([]);
    setTyped('');
    setSpoken(null);
    setOutcome(null);
    setSkipped(false);
    setIndex(index + 1);
  };

  const hidePrompt = LISTEN_TYPES.has(ex.type);

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Row style={s.top} gap={space.md}>
          <IconButton icon="close" label="Sair" onPress={onExit} testID="sair-sessao" />
          <View style={s.fill}>
            <ProgressBar value={index / queue.length} />
          </View>
          <T v="small">
            {index + 1}/{queue.length}
          </T>
        </Row>

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Animated.View key={ex.id} entering={FadeInDown.duration(220)} style={s.block}>
            <Row gap={space.sm} wrap>
              <Pill text={context === 'assessment' ? 'Avaliação' : title} tone={context === 'assessment' ? 'warn' : 'primary'} />
              <Pill text={SKILL_NAMES[ex.skill]} />
              {isRetry ? <Pill text="Reforço" tone="warn" icon="refresh" /> : null}
            </Row>
            <T v="h2" testID="instrucao">
              {ex.instruction}
            </T>

            {ex.audio && hidePrompt ? <AudioButtons text={ex.audio} lang={ex.lang} big autoPlay /> : null}

            {ex.prompt && !hidePrompt ? (
              <View style={s.prompt} testID="enunciado">
                {ex.answerLang === 'pt' || ex.type === 'speak' || ex.type === 'fill' ? (
                  <TargetText text={ex.prompt} reading={ex.promptReading} readingHidden={ex.readingHidden} lang={ex.lang} />
                ) : (
                  <T v="h2" style={s.ptPrompt}>
                    {ex.prompt}
                  </T>
                )}
                {ex.audio && !hidePrompt ? <AudioButtons text={ex.audio} lang={ex.lang} /> : null}
              </View>
            ) : null}

            {ex.type === 'speak' ? (
              <>
                {ex.translation ? <T v="small">{ex.translation}</T> : null}
                {!answered ? <SpeakPanel key={ex.id} lang={ex.lang} accepted={ex.accepted} onChange={setSpoken} /> : null}
              </>
            ) : null}

            {ex.options ? (
              <View style={s.options}>
                {ex.options.map((o) => {
                  const isAnswer = answered && o === ex.accepted[0];
                  const isWrongPick = answered && o === choice && o !== ex.accepted[0];
                  return (
                    <Pressable
                      key={o}
                      testID={`opcao-${o}`}
                      disabled={answered}
                      onPress={() => {
                        buzz('tap');
                        setChoice(o);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: choice === o }}
                      style={[s.option, choice === o && s.optionOn, isAnswer && s.optionRight, isWrongPick && s.optionWrong]}>
                      <Text style={[s.optionText, ex.answerLang !== 'pt' && s.optionTarget]}>{o}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {ex.bank ? (
              <>
                <View style={s.assembled}>
                  {picked.length === 0 ? <T v="small">Toque nas palavras na ordem certa</T> : null}
                  {picked.map((i, pos) => (
                    <Pressable key={`${i}-${pos}`} disabled={answered} onPress={() => setPicked(picked.filter((_, p) => p !== pos))} style={[s.chip, s.chipOn]} accessibilityRole="button" accessibilityLabel={`Remover ${ex.bank![i]}`}>
                      <Text style={s.chipText}>{ex.bank![i]}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={s.bank}>
                  {ex.bank.map((w, i) => {
                    const used = picked.includes(i);
                    return (
                      <Pressable
                        key={`${w}-${i}`}
                        testID={`peca-${w}`}
                        disabled={used || answered}
                        onPress={() => {
                          buzz('tap');
                          setPicked([...picked, i]);
                        }}
                        style={[s.chip, used && s.chipUsed]}
                        accessibilityRole="button"
                        accessibilityLabel={w}>
                        <Text style={[s.chipText, used && { color: 'transparent' }]}>{w}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {TYPED.has(ex.type) ? (
              <TextInput
                testID="resposta"
                value={typed}
                onChangeText={setTyped}
                editable={!answered}
                placeholder={ex.answerLang === 'pt' ? 'Escreva em português' : 'Escreva sua resposta'}
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                multiline
                style={s.input}
              />
            ) : null}
          </Animated.View>
        </ScrollView>

        <View style={[s.footer, outcome ? (outcome.correct ? s.footerOk : s.footerBad) : null]}>
          {outcome ? (
            <Animated.View entering={FadeInDown.duration(180)} style={s.feedback}>
              <Row gap={space.sm}>
                <Ionicons name={outcome.correct ? 'checkmark-circle' : 'close-circle'} size={24} color={outcome.correct ? colors.success : colors.danger} />
                <T v="h3" color={outcome.correct ? colors.success : colors.danger} testID="resultado">
                  {outcome.correct ? (outcome.grade?.verdict === 'almost' ? 'Certo, com uma ressalva' : 'Correto!') : ex.type === 'speak' ? 'Ainda não foi reconhecido' : 'Resposta incorreta'}
                </T>
              </Row>
              {outcome.grade?.note ? <T v="small" color={colors.text}>{outcome.grade.note}</T> : null}
              {outcome.grade && !outcome.correct && outcome.grade.diff.length ? (
                <View>
                  <T v="tiny">Onde ficou diferente</T>
                  <DiffView diff={outcome.grade.diff} lang={ex.answerLang} />
                </View>
              ) : null}
              {!outcome.correct || outcome.grade?.verdict === 'almost' || ex.type !== 'speak' ? (
                <View>
                  <T v="tiny">{ex.answerLang === 'pt' ? 'Resposta' : 'Forma correta'}</T>
                  <T v="h3" selectable>
                    {ex.answerLang === 'pt' ? (outcome.grade?.closest ?? ex.accepted[0]) : (outcome.grade?.closest ?? ex.target)}
                  </T>
                  {ex.answerLang !== 'pt' && ex.reading && ex.type !== 'tone' ? <T v="small" color={colors.primary}>{ex.reading}</T> : null}
                </View>
              ) : null}
              <Row gap={space.md} style={s.between}>
                <View style={s.fill}>
                  <T v="small">
                    {ex.target}
                    {ex.type === 'tone' ? '' : ` — ${ex.translation}`}
                  </T>
                </View>
                <AudioButtons text={ex.audio ?? ex.target} lang={ex.lang} />
              </Row>
            </Animated.View>
          ) : null}
          {skipped ? <T v="small">Exercício de fala pulado: não entra na nota.</T> : null}
          {answered ? (
            <Button testID="continuar" title={index + 1 >= queue.length ? 'Concluir' : 'Continuar'} variant={outcome && !outcome.correct ? 'secondary' : 'success'} onPress={next} />
          ) : (
            <View style={s.actions}>
              <Button testID="verificar" title={ex.type === 'speak' ? 'Registrar resultado' : 'Verificar'} onPress={check} disabled={!canCheck} />
              {ex.type === 'speak' ? <Button variant="ghost" small title="Não posso falar agora (pular, não conta)" onPress={skip} /> : null}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  top: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { padding: space.lg, paddingBottom: space.xxl, width: '100%', maxWidth: 720, alignSelf: 'center' },
  block: { gap: space.lg },
  prompt: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  ptPrompt: { flex: 1, lineHeight: 28 },
  options: { gap: space.sm },
  option: { borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, paddingVertical: space.md + 2, paddingHorizontal: space.lg, minHeight: 56, justifyContent: 'center' },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionRight: { borderColor: colors.success, backgroundColor: colors.successSoft },
  optionWrong: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  optionText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  optionTarget: { fontSize: 20 },
  assembled: { minHeight: 64, borderBottomWidth: 1.5, borderBottomColor: colors.border, flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingBottom: space.md, alignItems: 'center' },
  bank: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
  chip: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, minHeight: 48, justifyContent: 'center' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipUsed: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  chipText: { color: colors.text, fontSize: 18, fontWeight: '600' },
  input: { minHeight: 96, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontSize: 18, padding: space.lg, textAlignVertical: 'top' },
  footer: { padding: space.lg, gap: space.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg, width: '100%', maxWidth: 720, alignSelf: 'center' },
  footerOk: { backgroundColor: '#0F1A14' },
  footerBad: { backgroundColor: '#1C1114' },
  feedback: { gap: space.sm },
  between: { justifyContent: 'space-between' },
  actions: { gap: space.xs },
});
