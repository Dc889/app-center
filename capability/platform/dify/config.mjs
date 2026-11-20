export function getDifyConfig() {
  const base = process.env.DIFY_API_BASE ?? process.env.DIFY_API_URL
  const token = process.env.DIFY_CONSOLE_TOKEN ?? process.env.DIFY_API_KEY
  const workspaceId = process.env.DIFY_WORKSPACE_ID ?? 'default-ws'
  const isReal = Boolean(base && token)
  return { base, token, workspaceId, isReal }
}

