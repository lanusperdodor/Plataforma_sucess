import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const SUPABASE_PATTERN = {
  group: ['**/lib/supabase', '**/lib/supabase.ts'],
  message: 'lib/supabase só pode ser importado em features/**/repository.ts, features/auth, lib e testes.',
}
const PRICING_PATTERN = {
  group: ['**/features/pricing', '**/features/pricing/*'],
  message: 'features/pricing não pode ser importado em pages/ ou components/.',
}

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },

  // Fronteiras de arquitetura (design D4, Req 15.1 / 8.20)
  // 1) lib/supabase só é importável por repositórios, auth, lib e testes.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [SUPABASE_PATTERN] }],
    },
  },
  {
    files: [
      'src/features/**/repository.ts',
      'src/features/auth/**',
      'src/lib/**',
      'src/test/**',
      'src/**/*.test.{ts,tsx}',
      // Exceções explícitas: páginas de auth atuais que já usam supabase direto
      'src/pages/AuthPages.tsx',
      'src/pages/AccountPage.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  // 2) features/pricing proibido em pages e components (supabase continua restrito).
  {
    files: ['src/pages/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [SUPABASE_PATTERN, PRICING_PATTERN] }],
    },
  },
  // Exceções de supabase nas páginas de auth: mantêm a proibição de pricing.
  {
    files: ['src/pages/AuthPages.tsx', 'src/pages/AccountPage.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PRICING_PATTERN] }],
    },
  },
)
