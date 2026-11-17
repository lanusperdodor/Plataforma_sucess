import * as Speech from 'expo-speech';
import { LANGS, type LangCode } from '@/content';

export const RATE_NORMAL = 0.95;
export const RATE_SLOW = 0.55;

let voicesCache: Promise<string[]> | null = null;

/** Idiomas com voz instalada no aparelho (ex.: "en-US"). Lista vazia = não foi possível consultar. */
export function availableVoiceLanguages(): Promise<string[]> {
  if (!voicesCache) {
    voicesCache = Speech.getAvailableVoicesAsync()
      .then((v) => [...new Set(v.map((x) => x.language.replace('_', '-')))])
      .catch(() => []);
  }
  return voicesCache;
}

/** true/false quando dá para saber se há voz para o idioma; null quando o aparelho não informa. */
export async function hasVoiceFor(lang: LangCode): Promise<boolean | null> {
  const voices = await availableVoiceLanguages();
  if (!voices.length) return null;
  const prefix = LANGS[lang].locale.slice(0, 2).toLowerCase();
  return voices.some((v) => v.toLowerCase().startsWith(prefix) || (lang === 'zh' && v.toLowerCase().startsWith('cmn')));
}

export interface SpeakOptions {
  slow?: boolean;
  onDone?: () => void;
  onError?: () => void;
}

/** Fala o texto com a voz do sistema (síntese local do Android — nada é enviado ao backend do app). */
export function speak(text: string, lang: LangCode, opts: SpeakOptions = {}): void {
  if (!text.trim()) return;
  Speech.stop().catch(() => undefined);
  Speech.speak(text, {
    language: LANGS[lang].locale,
    rate: opts.slow ? RATE_SLOW : RATE_NORMAL,
    onDone: opts.onDone,
    onStopped: opts.onDone,
    onError: () => opts.onError?.(),
  });
}

export function stopSpeaking(): void {
  Speech.stop().catch(() => undefined);
}
