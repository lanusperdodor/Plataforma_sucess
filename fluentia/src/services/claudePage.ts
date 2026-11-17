/**
 * Versão claude.ai: quando o Fluentia roda como página (Artifact) no claude.ai, o viewer oferece
 * capacidades por `window.claude.use(nome)`: `sample` (perguntar ao Claude com a conta de quem abriu),
 * `dictation` (fala → texto) e `downloads` (salvar arquivo). Fora do claude.ai, tudo isso é null.
 */
type Use = (name: string) => Promise<unknown | null>;
const cache = new Map<string, Promise<unknown | null>>();

export function inClaudePage(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { claude?: { use?: Use } }).claude?.use === 'function';
}

export function claudeCap<T>(name: string): Promise<T | null> {
  if (!inClaudePage()) return Promise.resolve(null);
  let p = cache.get(name);
  if (!p) {
    p = (window as unknown as { claude: { use: Use } }).claude.use(name).catch(() => null);
    cache.set(name, p);
  }
  return p as Promise<T | null>;
}

export interface SampleFn {
  (input: string | { role: 'user' | 'assistant'; content: string }[], opts?: { cache?: boolean; modelTier?: 'quick' | 'default' | 'complex'; signal?: AbortSignal }): Promise<{
    text: string;
    truncated: boolean;
    modelApplied?: string;
    modelTierApplied?: string;
  }>;
}

export interface DictationNs {
  start(opts?: { language?: string }): Promise<void>;
  stop(): Promise<void>;
  onPartial(h: (e: { text: string }) => void): () => void;
  onFinal(h: (e: { text: string }) => void): () => void;
  onState(h: (e: { state: string; reason?: string }) => void): () => void;
}

export interface DownloadsNs {
  save(file: { filename: string; data: string | Blob }): Promise<unknown>;
}

// Já pede as capacidades ao abrir, para que o microfone possa iniciar direto do toque (sem espera antes).
if (inClaudePage()) {
  for (const n of ['sample', 'dictation', 'downloads']) void claudeCap(n);
}
