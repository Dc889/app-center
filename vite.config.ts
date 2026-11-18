import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { developmentApi } from './dev/vite-api.mjs'

export default defineConfig({
  plugins: [react(), developmentApi()],
  server: {
    allowedHosts: ['dc-pc.tail899e28.ts.net'],
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local-data/**',
        '**/*.sqlite*', '**/capability/**', '**/management/api/**', '**/runtime/**', '**/dev/**'],
    },
  },
})
