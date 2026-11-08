/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const nm = (pkgs: string) => new RegExp(`[\\\\/]node_modules[\\\\/](?:${pkgs})[\\\\/]`)

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
