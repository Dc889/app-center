import {check} from '../../../../runtime/http.mjs'
import {getRagflowConfig} from '../../../platform/ragflow/public.mjs'
import {computeManifest} from './knowledge-store.mjs'

async function ragflowFetch(path, {method = 'GET', body} = {}) {
  const cfg = getRagflowConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
  const res = await fetch(`${cfg.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(body !== undefined ? {'content-type': 'application/json'} : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  if (!res.ok) {
    const err = Object.assign(new Error(data?.message ?? `RAGFlow 接口错误 (${res.status})`), {
      status: res.status >= 500 ? 502 : res.status,
      code: data?.code ?? 'UPSTREAM_ERROR',
    })
    throw err
  }
  return data
}

export function getRagflowExternalEndpoint() {
  const cfg = getRagflowConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
  const parsed = new URL('/api/v1/dify/retrieval', cfg.base)
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

export async function listRagflowDatasets() {
  const cfg = getRagflowConfig()
  if (!cfg.isReal) {
    check(process.env.CAPABILITY_STRICT_UPSTREAM !== '1', 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
    return [{resourceId: 'rag-kb-01', name: '警务研判 RAG 知识库', source: 'ragflow', workspaceId: null}]
  }
  const raw = await ragflowFetch('/api/v1/datasets?page_size=100')
  const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : []
  return rows.map(row => ({
    resourceId: String(row.id ?? row.resourceId),
    name: String(row.name ?? row.id),
    source: 'ragflow',
    workspaceId: null,
    tenantId: String(row.tenant_id ?? row.tenantId ?? cfg.tenantId),
    ownerAccount: row.owner_account ?? row.ownerAccount ?? row.created_by ?? '',
  }))
}

export async function getRagflowDatasetDetail(datasetId) {
  const cfg = getRagflowConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
  const [dsRaw, docsRaw] = await Promise.all([
    ragflowFetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}`),
    ragflowFetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/documents`),
  ])
  const ds = dsRaw?.data ?? dsRaw
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
    ownerAccount: String(ds?.owner_account ?? ds?.ownerAccount ?? ds?.created_by ?? ''),
    modelVerified: ds?.model_verified !== false,
    ...manifest,
  }
}

export async function disableRagflowDocument({datasetId, documentId}) {
  await ragflowFetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`, {
    method: 'PUT',
    body: {enabled: false, status: 'disabled'},
  })
}
