import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGS, type LangCode } from '@/content';
import { getSetting } from '@/db/repo';
import { compareSpeech, type SpeechComparison } from '@/domain/grading';
import type { DiffOp } from '@/domain/text';
import { AiError, type PronunciationScores } from '@/services/ai/client';
import { ensureMicPermission, listen, SttError, type ListenHandle } from '@/services/stt';
import { speak, stopSpeaking } from '@/services/tts';
import { useApp } from '@/state/app';
import { colors, font, radius, space } from '@/theme';
import { Button, Card, IconButton, Notice, Row, T } from './ui';

export function buzz(kind: 'ok' | 'bad' | 'tap'): void {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'tap'
      ? Haptics.selectionAsync()
      : Haptics.notificationAsync(kind === 'ok' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
  run.catch(() => undefined);
}

/** Botões de áudio: ouvir quantas vezes quiser, em velocidade normal ou reduzida. */
export function AudioButtons({ text, lang, big, autoPlay }: { text: string; lang: LangCode; big?: boolean; autoPlay?: boolean }) {
  const [playing, setPlaying] = useState<'normal' | 'slow' | null>(null);
  const play = (slow: boolean) => {
    setPlaying(slow ? 'slow' : 'normal');
    speak(text, lang, { slow, onDone: () => setPlaying(null), onError: () => setPlaying(null) });
  };
  useEffect(() => {
    if (autoPlay) play(false);
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  if (big) {
    return (
      <Row gap={space.md} style={s.center}>
        <Pressable onPress={() => play(false)} accessibilityRole="button" accessibilityLabel="Ouvir" testID="ouvir" style={({ pressed }) => [s.bigAudio, playing === 'normal' && s.bigAudioOn, pressed && s.pressed]}>
          <Ionicons name="volume-high" size={34} color={colors.primary} />
          <T v="small" color={colors.text}>
            Ouvir
          </T>
        </Pressable>
        <Pressable onPress={() => play(true)} accessibilityRole="button" accessibilityLabel="Ouvir devagar" testID="ouvir-devagar" style={({ pressed }) => [s.bigAudio, s.bigAudioSlow, playing === 'slow' && s.bigAudioOn, pressed && s.pressed]}>
          <Ionicons name="hourglass-outline" size={26} color={colors.muted} />
          <T v="small">Devagar</T>
        </Pressable>
      </Row>
    );
  }
  return (
    <Row gap={space.sm}>
      <IconButton icon="volume-high" label="Ouvir" onPress={() => play(false)} active={playing === 'normal'} />
      <IconButton icon="hourglass-outline" label="Ouvir devagar" onPress={() => play(true)} active={playing === 'slow'} size={18} />
    </Row>
  );
}

/** Texto no idioma estudado, com leitura auxiliar (romanização/pinyin) que pode começar oculta. */
export function TargetText({ text, reading, readingHidden, lang, small }: { text: string; reading?: string | null; readingHidden?: boolean; lang: LangCode; small?: boolean }) {
  const [shown, setShown] = useState(!readingHidden);
  useEffect(() => setShown(!readingHidden), [text, readingHidden]);
  return (
    <View style={s.target}>
      <Text style={[small ? s.targetSmall : font.target, { color: colors.text }]} selectable>
        {text}
      </Text>
      {reading ? (
        shown ? (
          <T v="small" color={colors.primary}>
            {reading}
          </T>
        ) : (
          <Pressable onPress={() => setShown(true)} accessibilityRole="button" accessibilityLabel={`Mostrar ${LANGS[lang].readingName ?? 'leitura'}`} hitSlop={8}>
            <T v="small" color={colors.faint}>
              Toque para ver {LANGS[lang].readingName?.toLowerCase() ?? 'a leitura'}
            </T>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

/** Mostra, palavra a palavra, o que bateu e o que ficou diferente do esperado. */
export function DiffView({ diff, lang }: { diff: DiffOp[]; lang: LangCode | 'pt' }) {
  const sep = lang === 'zh' ? '' : ' ';
  return (
    <Text style={s.diff}>
      {diff.map((d, i) => {
        const tail = i < diff.length - 1 ? sep : '';
        if (d.op === 'same') return <Text key={i} style={{ color: colors.success }}>{d.expected + tail}</Text>;
        if (d.op === 'missing') return <Text key={i} style={s.diffMissing}>{d.expected + tail}</Text>;
        if (d.op === 'extra') return <Text key={i} style={s.diffExtra}>{d.got + tail}</Text>;
        return (
          <Text key={i}>
            <Text style={s.diffMissing}>{d.expected}</Text>
            <Text style={s.diffExtra}>{` (${d.got})`}</Text>
            {tail}
          </Text>
        );
      })}
    </Text>
  );
}

export function describeSpeech(c: SpeechComparison): string {
  const missing = c.diff.filter((d) => d.op === 'missing').map((d) => d.expected);
  const wrong = c.diff.filter((d) => d.op === 'wrong');
  const extra = c.diff.filter((d) => d.op === 'extra').map((d) => d.got);
  const parts: string[] = [];
  if (wrong.length) parts.push(`O reconhecedor ouviu ${wrong.map((w) => `"${w.got}" no lugar de "${w.expected}"`).join(', ')}.`);
  if (missing.length) parts.push(`Não foi reconhecido: ${missing.map((m) => `"${m}"`).join(', ')}.`);
  if (extra.length) parts.push(`A mais: ${extra.map((m) => `"${m}"`).join(', ')}.`);
  return parts.join(' ');
}

type SpeakState = 'idle' | 'listening' | 'processing' | 'done';

export interface SpeakOutcome {
  /** null = não foi possível avaliar (reconhecimento falhou). */
  matched: boolean | null;
  transcript: string;
  attempts: number;
}

/**
 * Treino de fala: ouvir o modelo → gravar → transcrever → comparar com a frase esperada.
 * O resultado diz se as PALAVRAS foram reconhecidas. Nota de pronúncia só aparece quando existe
 * avaliação fonética real configurada no backend.
 */
export function SpeakPanel({ lang, accepted, onChange }: { lang: LangCode; accepted: string[]; onChange(outcome: SpeakOutcome): void }) {
  const { ai, db } = useApp();
  const [state, setState] = useState<SpeakState>('idle');
  const [partial, setPartial] = useState('');
  const [comparison, setComparison] = useState<SpeechComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [phonetic, setPhonetic] = useState<PronunciationScores | null>(null);
  const [phoneticState, setPhoneticState] = useState<'off' | 'ready' | 'loading' | 'error'>('off');
  const [phoneticError, setPhoneticError] = useState('');
  const handle = useRef<ListenHandle | null>(null);
  const uriRef = useRef<string | null>(null);

  const discardAudio = () => {
    // A gravação é temporária: apagada a cada nova tentativa e ao sair do exercício.
    const uri = uriRef.current;
    uriRef.current = null;
    if (uri && Platform.OS !== 'web') {
      try {
        const f = new File(uri);
        if (f.exists) f.delete();
      } catch {
        // arquivo já removido
      }
    }
  };

  useEffect(() => {
    getSetting(db, 'ai_pronunciation').then((v) => setPhoneticState(v === '1' ? 'ready' : 'off'));
    return () => {
      handle.current?.abort();
      discardAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setError(null);
    setPhonetic(null);
    stopSpeaking();
    if (!(await ensureMicPermission())) {
      setError('Permissão de microfone negada. Libere o microfone para o Fluentia nas configurações do Android.');
      onChange({ matched: null, transcript: '', attempts });
      return;
    }
    discardAudio();
    setAudioUri(null);
    setComparison(null);
    setPartial('');
    setState('listening');
    const h = listen(lang, { onPartial: setPartial, hints: accepted, keepAudio: true });
    handle.current = h;
    try {
      const res = await h.result;
      const n = attempts + 1;
      setAttempts(n);
      uriRef.current = res.audioUri;
      setAudioUri(res.audioUri);
      if (!res.transcripts.length) {
        setError('Não ouvi nada. Fale perto do microfone, logo depois de tocar no botão.');
        setState('idle');
        onChange({ matched: null, transcript: '', attempts: n });
        return;
      }
      const c = compareSpeech(res.transcripts, accepted, lang);
      setComparison(c);
      setState('done');
      buzz(c.matched ? 'ok' : 'bad');
      onChange({ matched: c.matched, transcript: c.transcript, attempts: n });
    } catch (e) {
      setState('idle');
      if (e instanceof SttError && e.code === 'aborted') return;
      setError(e instanceof SttError ? e.message : 'O reconhecimento de fala falhou. Tente de novo.');
      onChange({ matched: null, transcript: '', attempts });
    }
  };

  const stop = () => {
    setState('processing');
    handle.current?.stop();
  };

  const playMine = () => {
    if (!audioUri) return;
    try {
      const player = createAudioPlayer(audioUri);
      player.play();
    } catch {
      setError('Não foi possível reproduzir a gravação.');
    }
  };

  const assess = async () => {
    if (!audioUri) return;
    setPhoneticState('loading');
    try {
      const scores = await ai.pronunciation(new File(audioUri), LANGS[lang].locale, accepted[0]);
      setPhonetic(scores);
      setPhoneticState('ready');
    } catch (e) {
      setPhoneticError(e instanceof AiError ? e.message : 'A avaliação fonética falhou.');
      setPhoneticState('error');
    }
  };

  return (
    <View style={s.speak}>
      <Pressable
        testID="microfone"
        onPress={state === 'listening' ? stop : start}
        disabled={state === 'processing'}
        accessibilityRole="button"
        accessibilityLabel={state === 'listening' ? 'Parar de gravar' : 'Gravar minha fala'}
        style={({ pressed }) => [s.mic, state === 'listening' && s.micOn, pressed && s.pressed]}>
        {state === 'processing' ? <ActivityIndicator color={colors.bg} /> : <Ionicons name={state === 'listening' ? 'stop' : 'mic'} size={36} color={colors.bg} />}
      </Pressable>
      <T v="small" style={s.centerText}>
        {state === 'listening' ? partial || 'Ouvindo… fale agora' : state === 'processing' ? 'Processando…' : comparison ? 'Toque para tentar de novo' : 'Toque no microfone e repita'}
      </T>

      {error ? <Notice tone="warn" icon="alert-circle" text={error} /> : null}

      {comparison ? (
        <Card tone={comparison.matched ? 'success' : 'danger'} style={s.fullWidth}>
          <T v="tiny">O que o reconhecedor entendeu</T>
          <T v="h3" selectable>
            {comparison.transcript}
          </T>
          <T v="tiny" style={s.mt}>
            Comparação com a frase esperada
          </T>
          <DiffView diff={comparison.diff} lang={lang} />
          <T v="small" color={colors.text}>
            {comparison.matched ? 'Todas as palavras foram reconhecidas.' : describeSpeech(comparison)}
          </T>
          <Row gap={space.sm} wrap style={s.mt}>
            {audioUri ? <Button small variant="secondary" icon="play" title="Ouvir minha gravação" onPress={playMine} /> : null}
            {audioUri && phoneticState !== 'off' ? (
              <Button small variant="secondary" icon="analytics" title="Avaliação fonética" loading={phoneticState === 'loading'} onPress={assess} />
            ) : null}
          </Row>
          {phonetic ? (
            <View style={s.mt}>
              <T v="tiny">Avaliação fonética ({phonetic.provider})</T>
              <Row gap={space.lg} wrap>
                <Score label="Precisão" value={phonetic.accuracy} />
                {phonetic.fluency !== null ? <Score label="Fluência" value={phonetic.fluency} /> : null}
                {phonetic.completeness !== null ? <Score label="Completude" value={phonetic.completeness} /> : null}
                {phonetic.prosody !== null ? <Score label="Prosódia" value={phonetic.prosody} /> : null}
              </Row>
              {phonetic.words.filter((w) => w.error !== 'None' || (w.accuracy ?? 100) < 60).length ? (
                <T v="small" color={colors.text}>
                  Palavras a melhorar:{' '}
                  {phonetic.words
                    .filter((w) => w.error !== 'None' || (w.accuracy ?? 100) < 60)
                    .map((w) => `${w.word}${w.accuracy !== null ? ` (${Math.round(w.accuracy)})` : ''}`)
                    .join(', ')}
                </T>
              ) : null}
            </View>
          ) : null}
          {phoneticState === 'error' ? <T v="small" color={colors.warn}>{phoneticError}</T> : null}
          {phoneticState === 'off' ? (
            <T v="small" style={s.mt}>
              Este resultado indica apenas se as palavras foram reconhecidas. Não é uma nota de pronúncia: a avaliação fonética (fonemas, fluência, prosódia) exige um serviço próprio, ainda não configurado.
            </T>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <View>
      <Text style={s.scoreValue}>{Math.round(value)}</Text>
      <T v="small">{label}</T>
    </View>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
  mt: { marginTop: space.sm },
  fullWidth: { alignSelf: 'stretch' },
  bigAudio: { width: 116, height: 116, borderRadius: radius.lg, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: 'rgba(139,128,249,0.4)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  bigAudioSlow: { width: 92, height: 92, backgroundColor: colors.surface2, borderColor: colors.border },
  bigAudioOn: { borderColor: colors.primary, borderWidth: 2 },
  target: { gap: 4, alignItems: 'flex-start' },
  targetSmall: { fontSize: 18, fontWeight: '600', lineHeight: 26 },
  diff: { fontSize: 18, lineHeight: 28, fontWeight: '600' },
  diffMissing: { color: colors.danger, textDecorationLine: 'underline' },
  diffExtra: { color: colors.faint, textDecorationLine: 'line-through' },
  speak: { alignItems: 'center', gap: space.md },
  mic: { width: 92, height: 92, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: colors.danger },
  scoreValue: { color: colors.text, fontSize: 24, fontWeight: '800' },
});
