import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { developmentApi } from './dev/vite-api.mjs'

export default defineConfig({
  plugins: [react(), developmentApi()],
  server: {
    allowedHosts: ['dc-pc.tail899e28.ts.net'],
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local-data/**',
        '**/*.sqlite*', '**/capability/**', '**/management/**/server/**', '**/management/**/public.server.mjs', '**/management/**/tests/**', '**/runtime/**', '**/dev/**'],
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
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
})
