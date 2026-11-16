import type { LangCode } from '@/content/types';

const PUNCT = /[.,!?¿¡;:"“”‘’()[\]{}…。，！？、；：「」『』（）·~\-–—]/g;

const EN_CONTRACTIONS: [RegExp, string][] = [
  [/\bi'm\b/g, 'i am'],
  [/\b(you|we|they)'re\b/g, '$1 are'],
  [/\b(he|she|it|that|what|where|who|there|here|how)'s\b/g, '$1 is'],
  [/\blet's\b/g, 'let us'],
  [/\bcan't\b/g, 'cannot'],
  [/\bcan not\b/g, 'cannot'],
  [/\bwon't\b/g, 'will not'],
  [/\b(do|does|did|is|are|was|were|have|has|had|would|should|could)n't\b/g, '$1 not'],
  [/\b(i|you|we|they)'ve\b/g, '$1 have'],
  [/\b(i|you|he|she|it|we|they)'ll\b/g, '$1 will'],
  [/\b(i|you|he|she|we|they)'d like\b/g, '$1 would like'],
];

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

/** Forma canônica para comparação: sem pontuação, caixa e espaços extras. Preserva acentos. */
export function normalize(text: string, lang: LangCode | 'pt'): string {
  let s = text.normalize('NFC').toLowerCase().replace(/[’`´]/g, "'");
  if (lang === 'en') for (const [re, to] of EN_CONTRACTIONS) s = s.replace(re, to);
  s = s.replace(PUNCT, ' ').replace(/'/g, lang === 'en' ? "'" : ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (lang === 'zh') s = s.replace(/\s+/g, '');
  return s;
}

/** Unidades de comparação: caracteres no mandarim, palavras nos demais. */
export function tokens(normalized: string, lang: LangCode | 'pt'): string[] {
  if (!normalized) return [];
  return lang === 'zh' ? Array.from(normalized) : normalized.split(' ');
}

export function levenshtein(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prev = y.map((_, j) => j + 1);
  prev.unshift(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

export type DiffOp = { op: 'same' | 'missing' | 'extra' | 'wrong'; expected?: string; got?: string };

/** Alinha o que era esperado com o que foi dito/escrito (LCS por token). */
export function diffTokens(expected: string[], got: string[]): DiffOp[] {
  const n = expected.length;
  const m = got.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = expected[i] === got[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const raw: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i] === got[j]) {
      raw.push({ op: 'same', expected: expected[i], got: got[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      raw.push({ op: 'missing', expected: expected[i++] });
    } else {
      raw.push({ op: 'extra', got: got[j++] });
    }
  }
  while (i < n) raw.push({ op: 'missing', expected: expected[i++] });
  while (j < m) raw.push({ op: 'extra', got: got[j++] });
  // Junta "faltou X" + "sobrou Y" vizinhos em "trocou X por Y".
  const out: DiffOp[] = [];
  for (const d of raw) {
    const last = out[out.length - 1];
    if (last && ((last.op === 'missing' && d.op === 'extra') || (last.op === 'extra' && d.op === 'missing'))) {
      out[out.length - 1] = { op: 'wrong', expected: last.expected ?? d.expected, got: last.got ?? d.got };
    } else {
      out.push(d);
    }
  }
  return out;
}

/** Gerador pseudoaleatório determinístico (mulberry32) para embaralhar de forma reproduzível. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function todayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d + delta));
}
