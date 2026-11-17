import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { LANGS, type LangCode } from '@/content';

export interface SttResult {
  /** Transcrições alternativas, da mais provável para a menos. Vazio = nada foi reconhecido. */
  transcripts: string[];
  /** Gravação da fala (WAV), quando o aparelho permite guardar (Android 13+). */
  audioUri: string | null;
}

export class SttError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'SttError';
  }
}

const MESSAGES: Record<string, string> = {
  'not-allowed': 'Permissão de microfone negada. Libere o microfone para o Fluentia nas configurações do Android.',
  'service-not-allowed': 'O serviço de reconhecimento de fala não está disponível neste aparelho.',
  'language-not-supported': 'O reconhecimento de fala deste aparelho não tem suporte a este idioma. Instale o idioma no app Google.',
  network: 'O reconhecimento de fala precisa de internet neste aparelho (ou do pacote offline do idioma).',
  'audio-capture': 'Não foi possível acessar o microfone.',
  busy: 'O reconhecimento de fala está ocupado. Tente de novo em instantes.',
  'too-many-requests': 'Muitas tentativas seguidas. Aguarde alguns segundos.',
};

/** O aparelho tem um serviço de reconhecimento de fala utilizável? */
export function sttAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export async function ensureMicPermission(): Promise<boolean> {
  try {
    const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export interface ListenHandle {
  result: Promise<SttResult>;
  /** Encerra a captura e processa o que foi dito até aqui. */
  stop(): void;
  /** Cancela sem resultado. */
  abort(): void;
}

/**
 * Ouve uma fala e devolve a transcrição. A captura termina sozinha quando o serviço detecta silêncio.
 * O áudio é processado pelo serviço de voz do Android (normalmente Google), que pode usar a internet.
 */
export function listen(lang: LangCode, opts: { onPartial?: (text: string) => void; hints?: string[]; keepAudio?: boolean } = {}): ListenHandle {
  const subs: { remove(): void }[] = [];
  const finals: string[] = [];
  let partial = '';
  let audioUri: string | null = null;
  let settled = false;

  const result = new Promise<SttResult>((resolve, reject) => {
    const cleanup = () => subs.splice(0).forEach((s) => s.remove());
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    subs.push(
      ExpoSpeechRecognitionModule.addListener('result', (ev) => {
        const texts = ev.results.map((r) => r.transcript.trim()).filter(Boolean);
        if (ev.isFinal) {
          for (const t of texts) if (!finals.includes(t)) finals.push(t);
        } else if (texts[0]) {
          partial = texts[0];
          opts.onPartial?.(partial);
        }
      }),
      ExpoSpeechRecognitionModule.addListener('audioend', (ev) => {
        if (ev.uri) audioUri = ev.uri;
      }),
      ExpoSpeechRecognitionModule.addListener('error', (ev) => {
        if (ev.error === 'no-speech' || ev.error === 'speech-timeout') {
          finish(() => resolve({ transcripts: [], audioUri }));
        } else if (ev.error === 'aborted') {
          finish(() => reject(new SttError('aborted', 'Cancelado.')));
        } else {
          finish(() => reject(new SttError(ev.error, MESSAGES[ev.error] ?? 'O reconhecimento de fala falhou. Tente de novo.')));
        }
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        // Sem resultado final, usa o parcial mais recente (alguns serviços não mandam o final ao parar).
        finish(() => resolve({ transcripts: finals.length ? finals : partial ? [partial] : [], audioUri }));
      })
    );
    try {
      let canRecord = false;
      try {
        canRecord = !!opts.keepAudio && ExpoSpeechRecognitionModule.supportsRecording();
      } catch {
        canRecord = false;
      }
      ExpoSpeechRecognitionModule.start({
        lang: LANGS[lang].locale === 'zh-CN' ? 'cmn-Hans-CN' : LANGS[lang].locale,
        interimResults: true,
        maxAlternatives: 5,
        continuous: false,
        contextualStrings: opts.hints?.slice(0, 20),
        ...(canRecord ? { recordingOptions: { persist: true } } : {}),
      });
    } catch {
      finish(() => reject(new SttError('unavailable', 'O reconhecimento de fala não está disponível neste aparelho.')));
    }
  });

  return {
    result,
    stop: () => {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // já encerrado
      }
    },
    abort: () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // já encerrado
      }
    },
  };
}
