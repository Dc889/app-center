import {check} from '../../../../runtime/http.mjs'
import {getRagflowConfig, ragflowFetch as platformRagflowFetch} from '../../../platform/ragflow/public.mjs'
import {resolveProductOwner} from '../../../platform/dify/public.mjs'
import {computeManifest} from './knowledge-store.mjs'

async function ragflowFetch(path, {method = 'GET', body} = {}) {
  const cfg = getRagflowConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
  const res = await platformRagflowFetch(path, {
    method,
    headers: body !== undefined ? {'content-type': 'application/json'} : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeoutMs: 15000,
  })
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = {raw: text}
    }
  }
  if (!res.ok || (typeof data?.code === 'number' && data.code !== 0)) {
    const err = Object.assign(new Error(data?.message ?? `RAGFlow 接口错误 (${res.status})`), {
      status: res.status >= 500 ? 502 : res.status === 200 ? 502 : res.status,
      code: data?.code ?? 'UPSTREAM_ERROR',
    })
    throw err
  }
  return data
}

// Dify 外部知识库 API 会向 `<endpoint>/retrieval` 发起校验请求，因此端点需指向 RAGFlow 的 `/api/v1/dify`，
// 且必须是 Dify 容器可达的地址；可用 RAGFLOW_EXTERNAL_ENDPOINT 覆盖（例如 http://host.docker.internal:9380/api/v1/dify）。
export function getRagflowExternalEndpoint() {
  const cfg = getRagflowConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
  const rawEndpoint = process.env.RAGFLOW_EXTERNAL_ENDPOINT || cfg.externalEndpoint
  const parsed = new URL(rawEndpoint || '/api/v1/dify', rawEndpoint ? undefined : cfg.base)
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export async function listRagflowDatasets() {
  const cfg = getRagflowConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实知识库连接凭证')
  const raw = await ragflowFetch('/api/v1/datasets?page_size=100')
  const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : null
  check(rows, 502, 'UPSTREAM_INVALID_RESPONSE', '知识库列表响应格式错误')
  return rows.map(row => ({
    resourceId: String(row.id ?? row.resourceId),
    name: String(row.name ?? row.id),
    source: 'ragflow',
    workspaceId: null,
    tenantId: String(row.tenant_id ?? row.tenantId ?? cfg.tenantId),
    ownerAccount: resolveProductOwner([row.owner_account, row.ownerAccount, row.created_by], {product: 'RAGFLOW'}),
  }))
}

export async function getRagflowDatasetDetail(datasetId) {
  const cfg = getRagflowConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
  const dsRaw = await ragflowFetch(`/api/v1/datasets?id=${encodeURIComponent(datasetId)}`)
  check(Array.isArray(dsRaw?.data), 502, 'UPSTREAM_INVALID_RESPONSE', 'RAGFlow 知识库列表响应格式错误')
  const ds = dsRaw.data.find(item => String(item.id ?? item.resourceId) === datasetId)
  check(ds, 404, 'NOT_FOUND', '未找到 RAGFlow 知识库')
  const docsRaw = await ragflowFetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/documents`)
  const docList = Array.isArray(docsRaw?.data?.docs)
    ? docsRaw.data.docs
    : Array.isArray(docsRaw?.data)
      ? docsRaw.data
      : Array.isArray(docsRaw)
        ? docsRaw
        : []
  const manifest = computeManifest(docList)
  return {
    resourceId: String(ds?.id ?? datasetId),
    name: String(ds?.name ?? datasetId),
    tenantId: String(ds?.tenant_id ?? ds?.tenantId ?? cfg.tenantId),
    workspaceId: null,
    ownerAccount: resolveProductOwner([ds?.owner_account, ds?.ownerAccount, ds?.created_by], {product: 'RAGFLOW'}),
    modelVerified: ds?.model_verified !== false,
    ...manifest,
  }
}

export async function disableRagflowDocument({datasetId, documentId}) {
  await ragflowFetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`, {
    method: 'PUT',
    body: {enabled: false},
  })
}

export async function fetchRagflowDocumentChunks(datasetId, documentId) {
  try {
    const raw = await ragflowFetch(
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks?page=1&page_size=50`,
    )
    const chunks = Array.isArray(raw?.data?.chunks)
      ? raw.data.chunks
      : Array.isArray(raw?.data)
        ? raw.data
        : []
    return chunks
      .map(c => String(c?.content ?? c?.content_with_weight ?? '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}
