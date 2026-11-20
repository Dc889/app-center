function parseOwnerMap(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function getDifyConfig() {
  const base = process.env.DIFY_API_BASE ?? process.env.DIFY_API_URL
  const token = process.env.DIFY_CONSOLE_TOKEN ?? process.env.DIFY_API_KEY
  const workspaceId = process.env.DIFY_WORKSPACE_ID ?? null
  const isReal = Boolean(base && token)
  return {base, token, workspaceId, isReal}
}

// 部署级所有者映射：真实 Dify/RAGFlow 只有 created_by(UUID/邮箱)，需显式映射到平台账号名。
// DIFY_OWNER_ACCOUNT_MAP='{"<created_by或邮箱>":"chen.yu"}'；未映射时保留产品原始身份，不假定平台所有者。
export function resolveProductOwner(candidates, {product = 'DIFY'} = {}) {
  const map = parseOwnerMap(process.env[`${product}_OWNER_ACCOUNT_MAP`])
  for (const c of candidates) {
    if (typeof c === 'string' && c && Object.hasOwn(map, c)) return String(map[c])
  }
  return candidates.find(c => typeof c === 'string' && c) ?? ''
}


export function getDifyPluginDaemonConfig() {
  const base = process.env.DIFY_PLUGIN_DAEMON_BASE
  const token = process.env.DIFY_PLUGIN_DAEMON_KEY
  return {base, token, isReal: Boolean(base && token)}
}
