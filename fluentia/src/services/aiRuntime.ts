import type { Db } from '@/db/types';
import { aiUsageOn, getSetting, logAiUsage } from '@/db/repo';
import { createAiClient, type AiClient, type AiConfig } from './ai/client';
import { secureDelete, secureGet, secureSet } from './secure';

const KEY_URL = 'fluentia.ai.url';
const KEY_TOKEN = 'fluentia.ai.token';
export const DEFAULT_DAILY_AI_LIMIT = 150;
/** Endereço do backend pessoal na conta Cloudflare do dono do app (nome do Worker em backend/wrangler.jsonc). */
export const DEFAULT_BACKEND_URL = 'https://fluentia-backend.marcossonopi.workers.dev';

export async function loadAiConfig(): Promise<AiConfig | null> {
  const [baseUrl, token] = await Promise.all([secureGet(KEY_URL), secureGet(KEY_TOKEN)]);
  return baseUrl && token ? { baseUrl, token } : null;
}

export async function saveAiConfig(c: AiConfig): Promise<void> {
  await secureSet(KEY_URL, c.baseUrl.trim());
  await secureSet(KEY_TOKEN, c.token.trim());
}

export async function clearAiConfig(): Promise<void> {
  await secureDelete(KEY_URL);
  await secureDelete(KEY_TOKEN);
}

export function createRuntimeAi(db: Db): AiClient {
  return createAiClient({
    getConfig: loadAiConfig,
    fetch: (input, init) => fetch(input, init),
    requestsToday: async () => (await aiUsageOn(db)).requests,
    dailyLimit: async () => Number(await getSetting(db, 'ai_daily_limit')) || DEFAULT_DAILY_AI_LIMIT,
    logUsage: (kind, input, output) => logAiUsage(db, kind, input, output),
  });
}
