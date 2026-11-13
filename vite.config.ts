/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const nm = (pkgs: string) => new RegExp(`[\\\\/]node_modules[\\\\/](?:${pkgs})[\\\\/]`)

/** Remove comentários "sourceMappingURL" de arquivos copiados de bibliotecas (ex.: worker do MapLibre): nenhum source map é publicado. */
function stripSourceMapComments() {
  const strip = (t: string) => t.replace(/\n?\/\/# sourceMappingURL=[^\n]*/g, '').replace(/\/\*# sourceMappingURL=[^*]*\*\//g, '')
  return {
    name: 'tucai-strip-sourcemap-comments',
    apply: 'build' as const,
    generateBundle(_: unknown, bundle: Record<string, { type: string; fileName: string; source?: string | Uint8Array; code?: string }>) {
      for (const f of Object.values(bundle)) {
        if (!/\.(m?js|css)$/.test(f.fileName)) continue
        if (f.type === 'chunk' && typeof f.code === 'string') f.code = strip(f.code)
        else if (f.type === 'asset' && f.source !== undefined) {
          const text = typeof f.source === 'string' ? f.source : new TextDecoder().decode(f.source)
          if (text.includes('sourceMappingURL')) f.source = strip(text)
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [stripSourceMapComments(), react(), tailwindcss()],
  // Pré-otimiza as dependências do núcleo na partida: evita o 504 "Outdated Optimize Dep"
  // (tela branca) quando o Vite descobre uma dependência nova no meio da sessão.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-router-dom',
      '@tanstack/react-query',
      '@supabase/supabase-js',
      'zod',
      'react-hook-form',
      '@hookform/resolvers/zod',
      'lucide-react',
    ],
  },
  build: {
    // produção sem source maps: o navegador recebe só o código minificado (o código-fonte original não é publicado)
    sourcemap: false,
    minify: true,
    rolldownOptions: {
      output: {
        // Vendors em chunks próprios (cache estável entre deploys).
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: nm('react|react-dom|scheduler|react-router|react-router-dom'), priority: 30 },
            { name: 'vendor-supabase', test: nm('@supabase|iceberg-js'), priority: 20 },
            { name: 'vendor-tanstack', test: nm('@tanstack'), priority: 10 },
          ],
        },
      },
    },
  },
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}'] },
})
