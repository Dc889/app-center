import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, type ViteDevServer } from 'vite'
import { executeTicket } from './server/execute.ts'

function ticketExecuteApi() {
  return {
    name: 'ticket-execute-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/execute', (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('只接受 POST')
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', async () => {
          let request: Record<string, string>
          try {
            request = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, string>
          } catch {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, failureReason: '请求不是 JSON', resultId: '' }))
            return
          }
          const result = await executeTicket(request)
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(result))
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ticketExecuteApi()],
  server: {
    allowedHosts: ['dc-pc.tail899e28.ts.net'],
  },
})
