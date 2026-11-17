import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Header, IconButton, Loading, Notice, Pill, Row, T } from '@/components/ui';
import { LANGS } from '@/content';
import { SCENARIOS } from '@/content/scenarios';
import { addMessage, getCompletedLessons, getConversation, getHardItems, getLesson, getMessages, getProfile, setMessageFeedback, type Conversation, type Message, type TutorFeedback } from '@/db/repo';
import { AiError } from '@/services/ai/client';
import { tutorTurn, type TutorContext } from '@/services/ai/tutor';
import { ensureMicPermission, listen, SttError, type ListenHandle } from '@/services/stt';
import { speak, stopSpeaking } from '@/services/tts';
import { useApp, useStudyTimer } from '@/state/app';
import { colors, radius, space } from '@/theme';

const REQUESTS = [
  { label: 'Explicar em português', text: '(Pedido) Explique em português, de forma simples, sua última fala e o vocabulário dela.' },
  { label: 'Mais simples', text: '(Pedido) Repita sua última fala de forma mais simples e mais curta.' },
  { label: 'Me dê a resposta', text: '(Pedido) Não sei responder. Mostre uma resposta correta possível e explique.' },
];

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { db, ai, lang: activeLang, speech, refresh } = useApp();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [ctx, setCtx] = useState<TutorContext | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [showPt, setShowPt] = useState<Record<number, boolean>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const handle = useRef<ListenHandle | null>(null);
  const lang = conv?.lang ?? activeLang;
  useStudyTimer(lang, 'conversation', !!conv);

  const reload = useCallback(async () => setMessages(await getMessages(db, Number(id))), [db, id]);

  const runTurn = useCallback(
    async (c: TutorContext, stored: Message[], userMessageId: number | null) => {
      setBusy(true);
      setError(null);
      try {
        const turn = await tutorTurn(ai, c, stored);
        if (userMessageId && turn.feedback) await setMessageFeedback(db, userMessageId, turn.feedback);
        await addMessage(db, Number(id), { role: 'assistant', content: turn.reply, reading: turn.reading, translation: turn.translation });
        setSuggestions(turn.suggestions);
        await reload();
        if (voice) speak(turn.reply, c.lang);
      } catch (e) {
        setError(e instanceof AiError ? e.message : 'Não foi possível falar com o professor.');
      } finally {
        setBusy(false);
      }
    },
    [ai, db, id, reload, voice]
  );

  useEffect(() => {
    (async () => {
      const c = await getConversation(db, Number(id));
      if (!c) throw new Error('Conversa não encontrada.');
      setConv(c);
      const profile = await getProfile(db);
      const completed = await getCompletedLessons(db, c.lang);
      const weak = (await getHardItems(db, c.lang, 10)).map((h) => `${h.term} (${h.translation})`);
      let scenario = SCENARIOS.find((s) => s.id === c.scenario_id)?.brief ?? SCENARIOS[0].brief;
      let lesson;
      if (c.scenario_id.startsWith('lesson:')) {
        const l = await getLesson(db, c.scenario_id.slice(7));
        if (l) {
          scenario = l.scenario;
          lesson = { title: l.title, objective: l.objective };
        }
      }
      const context: TutorContext = { lang: c.lang, level: c.level, scenario, studentName: profile.name, known: completed.flatMap((l) => [...l.words, ...l.sentences].map((i) => i.t)).slice(-60), weak, lesson };
      setCtx(context);
      const stored = await getMessages(db, c.id);
      setMessages(stored);
      if (stored.length === 0 && (await ai.isConfigured())) await runTurn(context, [], null);
    })().catch((e) => setError(e instanceof Error ? e.message : 'Erro ao abrir a conversa.'));
    return () => {
      handle.current?.abort();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }, [messages.length, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || !ctx || busy) return;
    setInput('');
    setSuggestions([]);
    stopSpeaking();
    const mid = await addMessage(db, Number(id), { role: 'user', content });
    const stored = await getMessages(db, Number(id));
    setMessages(stored);
    await runTurn(ctx, stored, mid);
    await refresh();
  };

  const retry = async () => {
    if (!ctx) return;
    const stored = await getMessages(db, Number(id));
    const last = stored[stored.length - 1];
    await runTurn(ctx, stored, last?.role === 'user' ? last.id : null);
  };

  const talk = async () => {
    if (listening) {
      handle.current?.stop();
      return;
    }
    setError(null);
    stopSpeaking();
    if (Platform.OS !== 'web' && !(await ensureMicPermission())) {
      setError('Permissão de microfone negada. Libere o microfone para o Fluentia nas configurações do Android.');
      return;
    }
    setListening(true);
    setPartial('');
    const h = listen(lang, { onPartial: setPartial });
    handle.current = h;
    try {
      const res = await h.result;
      if (!res.transcripts.length) setError('Não ouvi nada. Toque no microfone e fale logo em seguida.');
      else await send(res.transcripts[0]);
    } catch (e) {
      if (!(e instanceof SttError && e.code === 'aborted')) setError(e instanceof SttError ? e.message : 'O reconhecimento de fala falhou.');
    } finally {
      setListening(false);
      setPartial('');
    }
  };

  if (!conv && !error) return <Loading />;
  const L = LANGS[lang];
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const corrections = messages.filter((m) => m.role === 'user' && m.feedback_json && !(JSON.parse(m.feedback_json) as TutorFeedback).ok);

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.pad}>
          <Header
            title={conv?.title ?? 'Conversa'}
            subtitle={`${L.flag} ${L.name} · ${conv?.level ?? ''}`}
            onBack={() => router.back()}
            right={
              <Row gap={space.sm}>
                <IconButton icon="list" label="Revisar correções" active={review} onPress={() => setReview(!review)} testID="revisar-correcoes" />
                {speech ? <IconButton icon={voice ? 'volume-high' : 'volume-mute'} label={voice ? 'Modo voz ligado' : 'Ligar modo voz'} active={voice} onPress={() => { setVoice(!voice); stopSpeaking(); }} testID="modo-voz" /> : null}
              </Row>
            }
          />
        </View>

        {review ? (
          <ScrollView contentContainerStyle={s.list}>
            <T v="h2">Correções desta conversa</T>
            {corrections.length === 0 ? <T v="small">Nenhuma correção até agora.</T> : null}
            {corrections.map((m) => {
              const f = JSON.parse(m.feedback_json!) as TutorFeedback;
              return (
                <Card key={m.id}>
                  <T v="tiny">Você escreveu</T>
                  <T>{m.content}</T>
                  {f.corrected ? (<><T v="tiny">Forma correta</T><T v="h3" color={colors.success}>{f.corrected}</T></>) : null}
                  {f.explanation ? <T v="small" color={colors.text}>{f.explanation}</T> : null}
                  {f.hint && !f.corrected ? <T v="small" color={colors.warn}>Dica: {f.hint}</T> : null}
                </Card>
              );
            })}
            <Button variant="secondary" title="Voltar à conversa" onPress={() => setReview(false)} />
          </ScrollView>
        ) : (
          <ScrollView ref={scroll} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
            {messages.map((m) => {
              const fb = m.feedback_json ? (JSON.parse(m.feedback_json) as TutorFeedback) : null;
              if (m.role === 'user') {
                return (
                  <View key={m.id} style={s.userWrap}>
                    <View style={[s.bubble, s.user]}>
                      <Text style={s.userText}>{m.content}</Text>
                    </View>
                    {fb && !fb.ok ? (
                      <View style={s.fb} testID="correcao">
                        {fb.hint && !fb.corrected ? <T v="small" color={colors.warn}>💡 {fb.hint}</T> : null}
                        {fb.corrected ? <T v="small" color={colors.success}>✓ {fb.corrected}</T> : null}
                        {fb.explanation ? <T v="small">{fb.explanation}</T> : null}
                      </View>
                    ) : fb?.ok && !m.content.startsWith('(Pedido)') ? (
                      <Ionicons name="checkmark-circle" size={16} color={colors.success} style={s.okIcon} />
                    ) : null}
                  </View>
                );
              }
              return (
                <View key={m.id} style={[s.bubble, s.bot]}>
                  <Text style={s.botText} selectable>{m.content}</Text>
                  {m.reading ? <T v="small" color={colors.primary}>{m.reading}</T> : null}
                  {showPt[m.id] && m.translation ? <T v="small">{m.translation}</T> : null}
                  <Row gap={space.md} style={s.botActions}>
                    <Pressable onPress={() => speak(m.content, lang)} hitSlop={8} accessibilityLabel="Ouvir"><Ionicons name="volume-high" size={18} color={colors.muted} /></Pressable>
                    <Pressable onPress={() => speak(m.content, lang, { slow: true })} hitSlop={8} accessibilityLabel="Ouvir devagar"><Ionicons name="hourglass-outline" size={17} color={colors.muted} /></Pressable>
                    {m.translation ? (
                      <Pressable onPress={() => setShowPt({ ...showPt, [m.id]: !showPt[m.id] })} hitSlop={8} accessibilityLabel="Traduzir"><Text style={s.link}>{showPt[m.id] ? 'Ocultar tradução' : 'Traduzir'}</Text></Pressable>
                    ) : null}
                  </Row>
                </View>
              );
            })}
            {busy ? (<Row gap={space.sm} style={s.typing}><ActivityIndicator color={colors.primary} /><T v="small">O professor está respondendo…</T></Row>) : null}
            {error ? (
              <Notice tone="danger" icon="cloud-offline" text={error}>
                <Row gap={space.sm} style={s.mt}>
                  {/configur/i.test(error) ? <Button small variant="secondary" title="Configurar IA" onPress={() => router.push('/configuracoes-ia')} /> : <Button small variant="secondary" title="Tentar de novo" onPress={retry} />}
                </Row>
              </Notice>
            ) : null}
          </ScrollView>
        )}

        {!review ? (
          <View style={s.composer}>
            {lastAssistant && !busy ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
                {suggestions.map((sg) => (
                  <Pressable key={sg} onPress={() => setInput(sg)} style={[s.chip, s.chipSuggest]}><Text style={s.chipText}>{sg}</Text></Pressable>
                ))}
                {REQUESTS.map((r) => (
                  <Pressable key={r.label} onPress={() => send(r.text)} style={s.chip}><Text style={s.chipText}>{r.label}</Text></Pressable>
                ))}
              </ScrollView>
            ) : null}
            {listening ? <Pill text={partial || 'Ouvindo… fale agora'} tone="danger" icon="mic" /> : null}
            <Row gap={space.sm}>
              <TextInput testID="mensagem" value={input} onChangeText={setInput} placeholder={`Escreva em ${L.name.toLowerCase()}…`} placeholderTextColor={colors.faint} style={s.input} multiline editable={!busy} onSubmitEditing={() => send(input)} />
              {input.trim() ? (
                <IconButton icon="send" label="Enviar" onPress={() => send(input)} disabled={busy} testID="enviar" />
              ) : speech ? (
                <Pressable onPress={talk} disabled={busy} accessibilityLabel={listening ? 'Parar' : 'Falar'} testID="falar" style={[s.mic, listening && s.micOn, busy && { opacity: 0.4 }]}>
                  <Ionicons name={listening ? 'stop' : 'mic'} size={24} color={colors.bg} />
                </Pressable>
              ) : null}
            </Row>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  pad: { paddingHorizontal: space.lg },
  mt: { marginTop: space.sm },
  list: { padding: space.lg, gap: space.md, paddingBottom: space.xl, width: '100%', maxWidth: 720, alignSelf: 'center' },
  bubble: { borderRadius: radius.lg, padding: space.md, maxWidth: '88%', gap: 4 },
  bot: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start', borderTopLeftRadius: 6 },
  botText: { color: colors.text, fontSize: 18, lineHeight: 26 },
  botActions: { marginTop: 4 },
  link: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  userWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '88%', gap: 4 },
  user: { backgroundColor: colors.primary, borderTopRightRadius: 6, maxWidth: '100%' },
  userText: { color: colors.bg, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  fb: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: space.sm, gap: 2, borderWidth: 1, borderColor: colors.border },
  okIcon: { marginRight: 4 },
  typing: { paddingLeft: space.sm },
  composer: { padding: space.md, gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, width: '100%', maxWidth: 720, alignSelf: 'center' },
  chips: { gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  chipSuggest: { borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  input: { flex: 1, minHeight: 48, maxHeight: 120, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 16, paddingHorizontal: space.md, paddingVertical: space.sm },
  mic: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: colors.danger },
});
