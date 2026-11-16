import type { LangCode } from '@/content/types';
import { diffTokens, levenshtein, normalize, stripAccents, tokens, type DiffOp } from './text';

export type Verdict = 'correct' | 'almost' | 'wrong';

export interface GradeResult {
  verdict: Verdict;
  /** Conta como acerto no progresso (correto ou correto com ressalva). */
  correct: boolean;
  /** Resposta aceita mais próxima do que o aluno escreveu. */
  closest: string;
  /** Observação em português quando o acerto tem ressalva (acento, digitação). */
  note?: string;
  diff: DiffOp[];
}

/**
 * Corrige uma resposta digitada contra TODAS as respostas aceitas (não uma única frase fixa).
 * - Ignora caixa, pontuação e contrações equivalentes.
 * - Acento faltando ou um erro de digitação em palavra longa: aceita, mas avisa.
 * Respostas livres (texto aberto) não passam por aqui: são avaliadas pela IA.
 */
export function gradeText(answer: string, accepted: string[], lang: LangCode | 'pt'): GradeResult {
  const got = normalize(answer, lang);
  const options = accepted.map((a) => ({ raw: a, norm: normalize(a, lang) }));
  let best = options[0];
  let bestDist = Infinity;
  for (const o of options) {
    const d = levenshtein(got, o.norm);
    if (d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  const diff = diffTokens(tokens(best.norm, lang), tokens(got, lang));
  const base = { closest: best.raw, diff };
  if (!got) return { ...base, verdict: 'wrong', correct: false };
  if (bestDist === 0) return { ...base, verdict: 'correct', correct: true };

  if (options.some((o) => stripAccents(o.norm) === stripAccents(got))) {
    return { ...base, verdict: 'almost', correct: true, note: 'Certo, mas atenção aos acentos.' };
  }
  // Tolerância a UM erro de digitação, só em alfabetos latinos e respostas não muito curtas.
  if ((lang === 'en' || lang === 'es' || lang === 'pt') && best.norm.length >= 6 && bestDist === 1) {
    const changed = diff.filter((d) => d.op !== 'same');
    const onlyOneWord = changed.length === 1 && changed[0].op === 'wrong';
    if (onlyOneWord && (changed[0].expected?.length ?? 0) >= 4) {
      return { ...base, verdict: 'almost', correct: true, note: 'Quase! Você trocou uma letra — confira a grafia.' };
    }
  }
  return { ...base, verdict: 'wrong', correct: false };
}

export interface SpeechComparison {
  /** Todas as palavras esperadas foram reconhecidas, na ordem. */
  matched: boolean;
  /** Proporção de palavras esperadas que o reconhecedor encontrou (0–1). NÃO é nota de pronúncia. */
  wordsRecognized: number;
  diff: DiffOp[];
  transcript: string;
}

/**
 * Compara a transcrição do reconhecedor de fala com a frase esperada.
 * Isto mede apenas "o reconhecedor entendeu as mesmas palavras?" — não avalia fonemas,
 * fluência nem entonação. Usa a melhor entre as transcrições alternativas.
 */
export function compareSpeech(transcripts: string[], accepted: string[], lang: LangCode): SpeechComparison {
  let best: SpeechComparison | null = null;
  for (const tr of transcripts) {
    for (const exp of accepted) {
      // Fala não tem acento gráfico nem pontuação: compara sem acentos nas línguas latinas.
      const clean = (s: string) => (lang === 'en' || lang === 'es' ? stripAccents(normalize(s, lang)) : normalize(s, lang));
      const e = tokens(clean(exp), lang);
      const g = tokens(clean(tr), lang);
      const diff = diffTokens(e, g);
      const same = diff.filter((d) => d.op === 'same').length;
      const cand: SpeechComparison = {
        matched: diff.every((d) => d.op === 'same'),
        wordsRecognized: e.length ? same / e.length : 0,
        diff,
        transcript: tr,
      };
      if (!best || cand.wordsRecognized > best.wordsRecognized) best = cand;
    }
  }
  return best ?? { matched: false, wordsRecognized: 0, diff: [], transcript: '' };
}
