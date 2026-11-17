/**
 * Reconhecimento de fala na versão web: usa o ditado do claude.ai (capacidade `dictation`).
 * Fora do claude.ai a fala fica indisponível e o app esconde os exercícios de fala.
 */
import { LANGS, type LangCode } from '@/content';
import { claudeCap, inClaudePage, type DictationNs } from './claudePage';

export interface SttResult {
  transcripts: string[];
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

let dictation: DictationNs | null = null;
if (inClaudePage()) void claudeCap<DictationNs>('dictation').then((d) => (dictation = d));

export function sttAvailable(): boolean {
  return inClaudePage();
}

/** O ditado pede a permissão sozinho no primeiro uso. */
export async function ensureMicPermission(): Promise<boolean> {
  return true;
}

export interface ListenHandle {
  result: Promise<SttResult>;
  stop(): void;
  abort(): void;
}

const MESSAGES: Record<string, string> = {
  not_granted: 'O microfone não foi permitido para esta página. Libere em Permissões da página no claude.ai.',
  unavailable: 'O ditado não está disponível aqui. Use o Chrome no computador ou o app do Claude para desktop.',
  rate_limited: 'Muitos ditados seguidos. Espere alguns segundos e tente de novo.',
  upstream_error: 'O ditado falhou. Tente de novo.',
  no_gesture: 'Toque no microfone para falar.',
};

export function listen(lang: LangCode, opts: { onPartial?: (text: string) => void; hints?: string[]; keepAudio?: boolean } = {}): ListenHandle {
  const d = dictation;
  const finals: string[] = [];
  let partial = '';
  let started = false;
  let aborted = false;
  const subs: (() => void)[] = [];
  let settle: { ok: (r: SttResult) => void; fail: (e: SttError) => void } | null = null;
  const result = new Promise<SttResult>((ok, fail) => (settle = { ok, fail }));
  const done = (fn: () => void) => {
    if (!settle) return;
    subs.splice(0).forEach((u) => u());
    fn();
    settle = null;
  };
  if (!d) {
    done(() => settle!.fail(new SttError('unavailable', MESSAGES.unavailable)));
    return { result, stop() {}, abort() {} };
  }
  subs.push(
    d.onPartial(({ text }) => {
      partial = text;
      opts.onPartial?.([...finals, text].join(' ').trim());
    }),
    d.onFinal(({ text }) => {
      if (text.trim()) finals.push(text.trim());
      partial = '';
      opts.onPartial?.(finals.join(' '));
    }),
    d.onState(({ state, reason }) => {
      if (state === 'listening') started = true;
      if (state !== 'idle' || !started) return;
      if (aborted) return done(() => settle!.fail(new SttError('aborted', 'Cancelado.')));
      if (reason && MESSAGES[reason] && reason !== 'no_gesture' && !finals.length) {
        return done(() => settle!.fail(new SttError(reason, MESSAGES[reason])));
      }
      const text = [...finals, partial].join(' ').trim();
      done(() => settle!.ok({ transcripts: text ? [text] : [], audioUri: null }));
    })
  );
  // Iniciado direto do toque, sem nada aguardado antes.
  d.start({ language: LANGS[lang].locale }).catch((e: { code?: string }) => {
    const code = e?.code ?? 'upstream_error';
    if (code === 'dismissed' || code === 'stopped') return done(() => settle!.fail(new SttError('aborted', 'Cancelado.')));
    done(() => settle!.fail(new SttError(code, MESSAGES[code] ?? MESSAGES.upstream_error)));
  });
  return {
    result,
    stop: () => void d.stop().catch(() => undefined),
    abort: () => {
      aborted = true;
      void d.stop().catch(() => undefined);
      done(() => settle!.fail(new SttError('aborted', 'Cancelado.')));
    },
  };
}
