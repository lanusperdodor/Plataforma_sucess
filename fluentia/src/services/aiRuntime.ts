import type { Db } from '@/db/types';
import { aiUsageOn, getSetting, logAiUsage } from '@/db/repo';
import { createAiClient, type AiClient, type AiConfig, type SampleLike } from './ai/client';
import { claudeCap, inClaudePage } from './claudePage';
import { secureDelete, secureGet, secureSet } from './secure';

const KEY_URL = 'fluentia.ai.url';
const KEY_TOKEN = 'fluentia.ai.token';
const KEY_MODE = 'fluentia.ai.mode';
const KEY_MODEL = 'fluentia.ai.model';
export const DEFAULT_DAILY_AI_LIMIT = 150;
/** Endereço do backend pessoal na conta Cloudflare do dono do app (nome do Worker em backend/wrangler.jsonc). */
export const DEFAULT_BACKEND_URL = 'https://fluentia-backend.marcossonopi.workers.dev';

/** No claude.ai o professor usa sempre o Claude da conta de quem abriu: nada a configurar. */
export const CLAUDE_PAGE_CONFIG: AiConfig = { mode: 'claude', baseUrl: 'claude.ai', token: 'conta-do-viewer' };

export async function loadAiConfig(): Promise<AiConfig | null> {
  if (inClaudePage()) return CLAUDE_PAGE_CONFIG;
  const [baseUrl, token, mode, model] = await Promise.all([secureGet(KEY_URL), secureGet(KEY_TOKEN), secureGet(KEY_MODE), secureGet(KEY_MODEL)]);
  if (!baseUrl || !token) return null;
  return { baseUrl, token, mode: mode === 'direct' ? 'direct' : 'backend', model: model || undefined };
}

export async function saveAiConfig(c: AiConfig): Promise<void> {
  await secureSet(KEY_URL, c.baseUrl.trim());
  await secureSet(KEY_TOKEN, c.token.trim());
  await secureSet(KEY_MODE, c.mode ?? 'backend');
  if (c.model) await secureSet(KEY_MODEL, c.model);
  else await secureDelete(KEY_MODEL);
}

export async function clearAiConfig(): Promise<void> {
  for (const k of [KEY_URL, KEY_TOKEN, KEY_MODE, KEY_MODEL]) await secureDelete(k);
}

export function createRuntimeAi(db: Db): AiClient {
  return createAiClient({
    getConfig: loadAiConfig,
    fetch: (input, init) => fetch(input, init),
    requestsToday: async () => (await aiUsageOn(db)).requests,
    dailyLimit: async () => Number(await getSetting(db, 'ai_daily_limit')) || DEFAULT_DAILY_AI_LIMIT,
    logUsage: (kind, input, output) => logAiUsage(db, kind, input, output),
    sample: () => claudeCap<SampleLike>('sample'),
  });
}
