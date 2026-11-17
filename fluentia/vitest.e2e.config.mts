import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Teste de interface de ponta a ponta: exige o app web rodando (npx expo start --web --port 8081).
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { include: ['tests/e2e/**/*.e2e.ts'], environment: 'node', testTimeout: 600_000, hookTimeout: 120_000 },
});
