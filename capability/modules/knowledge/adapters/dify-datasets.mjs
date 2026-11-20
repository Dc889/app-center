import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig, resolveProductOwner} from '../../../platform/dify/public.mjs'
import {getRagflowConfig} from '../../../platform/ragflow/public.mjs'
import {computeManifest} from './knowledge-store.mjs'

async function difyFetch(path, {method = 'GET', body} = {}) {
  const cfg = getDifyConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 连接凭证')
  const res = await fetch(`${cfg.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(body !== undefined ? {'content-type': 'application/json'} : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
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
    const err = Object.assign(new Error(data?.message ?? `Dify 接口错误 (${res.status})`), {
      status: res.status >= 500 ? 502 : res.status,
      code: data?.code ?? 'UPSTREAM_ERROR',
    })
    throw err
  }
  return data
}

export async function listDifyDatasets(workspaceId) {
  const cfg = getDifyConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实知识库连接凭证')
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}&limit=100` : '?limit=100'
  const raw = await difyFetch(`/console/api/datasets${query}`)
  const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : null
  check(rows, 502, 'UPSTREAM_INVALID_RESPONSE', '知识库列表响应格式错误')
  return rows.map(row => ({
    resourceId: String(row.id ?? row.resourceId),
    name: String(row.name ?? row.id),
    source: 'dify',
    workspaceId: String(row.workspace_id ?? row.workspaceId ?? workspaceId ?? cfg.workspaceId),
    ownerAccount: resolveProductOwner([row.owner_account, row.ownerAccount, row.created_by], {product: 'DIFY'}),
  }))
}

export async function getDifyDatasetDetail(datasetId, workspaceId) {
  const cfg = getDifyConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 连接凭证')
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''
  const [ds, docsRaw] = await Promise.all([
    difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}${query}`),
    difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}/documents${query}`),
  ])
  const docList = Array.isArray(docsRaw?.data) ? docsRaw.data : Array.isArray(docsRaw) ? docsRaw : []
  const manifest = computeManifest(docList)
  return {
    resourceId: String(ds?.id ?? datasetId),
    name: String(ds?.name ?? datasetId),
    workspaceId: String(ds?.workspace_id ?? ds?.workspaceId ?? workspaceId ?? cfg.workspaceId),
    ownerAccount: resolveProductOwner([ds?.owner_account, ds?.ownerAccount, ds?.created_by], {product: 'DIFY'}),
    modelVerified: ds?.model_verified !== false,
    ...manifest,
  }
}

export async function createDifyExternalBinding({name, targetWorkspaceId, endpoint, externalKnowledgeId}) {
  const cfg = getDifyConfig()
  check(!cfg.workspaceId || cfg.workspaceId === targetWorkspaceId, 501, 'UPSTREAM_UNSUPPORTED', 'Dify 当前访问身份不属于目标工作区')
  const rag = getRagflowConfig()
  check(rag.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
  const apiRes = await difyFetch('/console/api/datasets/external-knowledge-api', {
    method: 'POST',
    body: {
      name: `ragflow-${externalKnowledgeId.slice(0, 12)}-${Date.now().toString(36)}`,
      settings: {endpoint, api_key: rag.token},
    },
  })
  const apiId = String(apiRes?.id ?? apiRes?.data?.id ?? '')
  check(apiId, 502, 'UPSTREAM_ERROR', 'Dify 未返回外部知识库 API 标识')
  const extRes = await difyFetch('/console/api/datasets/external', {
    method: 'POST',
    body: {
      name: `${name}-${Date.now().toString(36)}`.slice(0, 40),
      external_knowledge_api_id: apiId,
      external_knowledge_id: externalKnowledgeId,
      external_retrieval_model: {top_k: 2, score_threshold: 0.5, score_threshold_enabled: false},
    },
  })
  const datasetId = extRes?.id ?? extRes?.data?.id
  check(typeof datasetId === 'string' && datasetId, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 未返回外部知识库标识')
  return {
    externalApiId: apiId,
    externalDatasetId: datasetId,
  }
}

export async function grantDifySameWorkspaceAccess({datasetId, workspaceId, granteeAccount, permission, targetAppId}) {
  const res = await difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}`, {
    method: 'PATCH',
    body: {
      workspace_id: workspaceId,
      permission: 'all_team_members',
      grantee_account: granteeAccount,
      grant_permission: permission,
      target_app_id: targetAppId ?? null,
    },
  })
  return {
    datasetId: String(res?.id ?? datasetId),
    granted: true,
  }
}

export async function copyDifyDatasetCrossWorkspace({name, sourceDatasetId, sourceWorkspaceId, targetWorkspaceId, documents, targetAppId}) {
  const created = await difyFetch('/console/api/datasets', {
    method: 'POST',
    body: {
      name: `${name} (副本)`,
      workspace_id: targetWorkspaceId,
      source_dataset_id: sourceDatasetId,
      source_workspace_id: sourceWorkspaceId,
      target_app_id: targetAppId ?? null,
      documents: documents.map(d => ({documentId: d.documentId, name: d.name, sha256: d.sha256})),
    },
  })
  return {
    replicaDatasetId: String(created?.id ?? created?.data?.id ?? ''),
  }
}

export async function disableDifyDocument({datasetId, documentId, workspaceId}) {
  const batchQuery = `?document_id=${encodeURIComponent(documentId)}${workspaceId ? `&workspace_id=${encodeURIComponent(workspaceId)}` : ''}`
  await difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}/documents/status/disable/batch${batchQuery}`, {
    method: 'PATCH',
  })
}

export async function revokeDifyDatasetAccess({datasetId, workspaceId, bindingId, targetAppId}) {
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''
  await difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}/revoke${query}`, {
    method: 'POST',
    body: {bindingId, targetAppId},
  })
}
