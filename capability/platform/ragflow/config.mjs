export function getRagflowConfig() {
  const base = process.env.RAGFLOW_API_BASE ?? process.env.RAGFLOW_API_URL
  const token = process.env.RAGFLOW_API_KEY ?? process.env.RAGFLOW_TOKEN
  const tenantId = process.env.RAGFLOW_TENANT_ID ?? 'default-tenant'
  const isReal = Boolean(base && token)
  return {base, token, tenantId, isReal}
}
