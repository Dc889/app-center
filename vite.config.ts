import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'

export default defineConfig(async ({ command }) => {
  const plugins: PluginOption[] = [react()]
  if (command === 'serve') {
    const devApiUrl = pathToFileURL(resolve(process.cwd(), 'dev', 'vite-api.mjs')).href
    const { developmentApi } = await import(/* @vite-ignore */ devApiUrl)
    plugins.push(developmentApi() as PluginOption)
  }
  return {
    plugins,
    server: {
      allowedHosts: ['dc-pc.tail899e28.ts.net'],
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local-data/**',
          '**/*.sqlite*', '**/capability/**', '**/connectors/**', '**/management/**/server/**', '**/management/**/public.server.mjs', '**/management/**/tests/**', '**/runtime/**', '**/dev/**'],
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react-vendor'
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'lucide-vendor'
            }
            if (id.includes('node_modules/recharts')) {
              return 'recharts-vendor'
            }
          },
        },
      },
    },
  }
})
