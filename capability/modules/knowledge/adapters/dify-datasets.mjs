import {isDeepStrictEqual} from 'node:util'
import {check} from '../../../../runtime/http.mjs'
import {getDifyConfig, resolveProductOwner, difyConsoleFetch, difyRequestContext} from '../../../platform/dify/public.mjs'
import {getRagflowConfig} from '../../../platform/ragflow/public.mjs'
import {computeManifest} from './knowledge-store.mjs'

async function difyFetch(path, {method = 'GET', body} = {}) {
  const cfg = getDifyConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 连接凭证')
  const res = await difyConsoleFetch(path, {
    method,
    headers: body !== undefined ? {'content-type': 'application/json'} : {},
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

export async function fetchDifyDocumentSegments(datasetId, documentId) {
  try {
    const raw = await difyFetch(
      `/console/api/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/segments?limit=50`,
    )
    const segs = Array.isArray(raw?.data) ? raw.data : []
    return segs
      .map(s => String(s?.content ?? '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function createDifyExternalBinding({name, targetWorkspaceId, endpoint, externalKnowledgeId, targetAppId}) {
  requireWorkspace(targetWorkspaceId)
  check(!targetAppId, 501, 'UPSTREAM_UNSUPPORTED', '指定应用编排配置尚未完成真实适配，不以外部知识库创建冒充应用绑定')
  const rag = getRagflowConfig()
  check(rag.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 RAGFlow 连接凭证')
  const apiRes = await difyFetch('/console/api/datasets/external-knowledge-api', {
    method: 'POST',
    body: {
      name: `ragflow-${externalKnowledgeId.slice(0, 12)}-${Date.now().toString(36)}`,
      settings: {endpoint, api_key: rag.externalApiKey || rag.token},
    },
  })
  const apiId = String(apiRes?.id ?? apiRes?.data?.id ?? '')
  check(apiId, 502, 'UPSTREAM_ERROR', 'Dify 未返回外部知识库 API 标识')
  let extRes
  try {
    extRes = await difyFetch('/console/api/datasets/external', {
      method: 'POST',
      body: {
        name: `${name}-${Date.now().toString(36)}`.slice(0, 40),
        external_knowledge_api_id: apiId,
        external_knowledge_id: externalKnowledgeId,
        external_retrieval_model: {top_k: 2, score_threshold: 0.5, score_threshold_enabled: false},
      },
    })
  } catch (err) {
    try {
      await difyFetch(`/console/api/datasets/external-knowledge-api/${encodeURIComponent(apiId)}`, {method: 'DELETE'})
    } catch {
      // Best-effort cleanup of orphan external knowledge API template.
    }
    throw err
  }
  const datasetId = extRes?.id ?? extRes?.data?.id
  check(typeof datasetId === 'string' && datasetId, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 未返回外部知识库标识')
  const after = await difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}`)
  check(
    after?.id === datasetId &&
      after?.provider === 'external' &&
      after?.external_knowledge_info?.external_knowledge_api_id === apiId &&
      after?.external_knowledge_info?.external_knowledge_id === externalKnowledgeId,
    502,
    'EXTERNAL_BINDING_READBACK_FAILED',
    'Dify 外部知识库创建后读回不一致，需查证原执行',
  )
  return {
    externalApiId: apiId,
    externalDatasetId: datasetId,
  }
}

function requireWorkspace(workspaceId) {
  const cfg = getDifyConfig()
  check(cfg.isReal, 501, 'UPSTREAM_UNSUPPORTED', '未配置真实 Dify 连接凭证')
  const tenantAccount = difyRequestContext?.getStore?.()?.account
  if (cfg.mode === 'connector' && tenantAccount && typeof workspaceId === 'string' && workspaceId.trim()) return
  check(cfg.workspaceId && cfg.workspaceId === workspaceId, 501, 'UPSTREAM_UNSUPPORTED', '缺少目标工作区的已核验产品身份')
}

function memberIds(dataset) {
  check(['only_me', 'partial_members', 'all_team_members'].includes(dataset?.permission), 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 未返回有效权限范围')
  if (dataset.permission !== 'partial_members') return []
  check(Array.isArray(dataset.partial_member_list) && dataset.partial_member_list.every(id => typeof id === 'string' && id), 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 指定成员清单不完整')
  return [...new Set(dataset.partial_member_list)].sort()
}

async function writeMembers(datasetId, before, members) {
  const retrievalModel = before?.retrieval_model_dict ?? before?.retrieval_model
  check(before?.provider === 'vendor' && retrievalModel && typeof retrievalModel === 'object' && !Array.isArray(retrievalModel),
    501, 'UPSTREAM_UNSUPPORTED', '缺少可保留的原生检索配置，不能用授权操作覆盖产品配置')
  const permission = members.length ? 'partial_members' : 'only_me'
  await difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}`, {method: 'PATCH', body: {
    retrieval_model: retrievalModel, permission, partial_member_list: members.map(user_id => ({user_id})),
  }})
  const after = await difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}`)
  check(after?.id === datasetId && after.name === before.name && after.description === before.description &&
    isDeepStrictEqual(after.retrieval_model_dict ?? after.retrieval_model, retrievalModel) && after.permission === permission && JSON.stringify(memberIds(after)) === JSON.stringify([...members].sort()),
    502, 'PERMISSION_READBACK_FAILED', 'Dify 权限写入后读回不一致，需查证原执行')
}

export async function grantDifySameWorkspaceAccess({datasetId, workspaceId, granteeAccount, permission, targetAppId}) {
  requireWorkspace(workspaceId)
  check(permission === '检索使用' && !targetAppId, 501, 'UPSTREAM_UNSUPPORTED', '指定应用编排配置尚未完成真实适配，不以工作区授权冒充应用绑定')
  const payload = await difyFetch('/console/api/workspaces/current/members')
  check(Array.isArray(payload?.accounts), 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 成员目录不完整')
  const candidates = payload.accounts.filter(member => member?.id && (member.id === granteeAccount || member.account === granteeAccount ||
    resolveProductOwner([member.id, member.email], {product: 'DIFY'}) === granteeAccount))
  check(candidates.length === 1, 409, 'DIFY_GRANTEE_UNRESOLVED', '获批账户没有唯一的 Dify 成员映射')
  const member = candidates[0]
  check(member.status === 'active', 409, 'DIFY_GRANTEE_INACTIVE', '获批 Dify 成员尚未激活')
  const before = await difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}`)
  check(before?.id === datasetId, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 知识库标识不一致')
  const existing = memberIds(before)
  const addedMemberIds = before.permission !== 'all_team_members' && !existing.includes(member.id) ? [member.id] : []
  if (addedMemberIds.length) await writeMembers(datasetId, before, [...existing, member.id])
  return {datasetId, granted: true, granteeAccountId: member.id, addedMemberIds, originalPermission: before.permission}
}

export async function copyDifyDatasetCrossWorkspace(_input) {
  check(false, 501, 'UPSTREAM_UNSUPPORTED', '尚无目标工作区身份及真实文档复制链路，禁止创建空知识库冒充跨区复制')
}

export async function disableDifyDocument({datasetId, documentId, workspaceId}) {
  const batchQuery = `?document_id=${encodeURIComponent(documentId)}${workspaceId ? `&workspace_id=${encodeURIComponent(workspaceId)}` : ''}`
  await difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}/documents/status/disable/batch${batchQuery}`, {
    method: 'PATCH',
  })
}

function isDifyNotFound(err) {
  return err?.status === 404 || (err?.status === 400 && /not found/i.test(String(err?.message ?? '')))
}

async function assertDifyDeleted(path, label) {
  let exists = false
  try {
    await difyFetch(path)
    exists = true
  } catch (err) {
    if (!isDifyNotFound(err)) throw err
  }
  check(!exists, 502, 'EXTERNAL_REVOKE_READBACK_FAILED', `${label}删除后仍可读回`)
}

export async function revokeDifyExternalBinding({externalDatasetId, externalApiId, workspaceId}) {
  requireWorkspace(workspaceId)
  check(
    typeof externalDatasetId === 'string' && externalDatasetId && typeof externalApiId === 'string' && externalApiId,
    501,
    'UPSTREAM_UNSUPPORTED',
    '缺少可核验的外部知识库及API标识，不能撤销外部绑定',
  )
  try {
    await difyFetch(`/console/api/datasets/${encodeURIComponent(externalDatasetId)}`, {method: 'DELETE'})
  } catch (err) {
    if (!isDifyNotFound(err)) throw err
  }
  await assertDifyDeleted(`/console/api/datasets/${encodeURIComponent(externalDatasetId)}`, '外部知识库')
  try {
    await difyFetch(`/console/api/datasets/external-knowledge-api/${encodeURIComponent(externalApiId)}`, {method: 'DELETE'})
  } catch (err) {
    if (!isDifyNotFound(err)) throw err
  }
  await assertDifyDeleted(`/console/api/datasets/external-knowledge-api/${encodeURIComponent(externalApiId)}`, '外部知识库API')
  return {revoked: true, changed: true}
}

export async function revokeDifyDatasetAccess({datasetId, workspaceId, grantRef}) {
  if (grantRef?.externalDatasetId || grantRef?.externalApiId) {
    return revokeDifyExternalBinding({
      externalDatasetId: grantRef.externalDatasetId,
      externalApiId: grantRef.externalApiId,
      workspaceId,
    })
  }
  requireWorkspace(workspaceId)
  check(grantRef && typeof grantRef.granteeAccountId === 'string' && Array.isArray(grantRef.addedMemberIds) &&
    grantRef.addedMemberIds.every(id => id === grantRef.granteeAccountId), 501, 'UPSTREAM_UNSUPPORTED', '缺少可核验的原生授权增量，不能猜测撤权接口或扩大范围')
  // Preexisting product access belongs to its original owner; this binding must not remove it.
  if (!grantRef.addedMemberIds.length) return {revoked: true, changed: false}
  const before = await difyFetch(`/console/api/datasets/${encodeURIComponent(datasetId)}`)
  check(before?.id === datasetId, 502, 'UPSTREAM_INVALID_RESPONSE', 'Dify 知识库标识不一致')
  const current = memberIds(before)
  check(before.permission !== 'all_team_members', 409, 'PERMISSION_SCOPE_CHANGED', '产品权限已改为全工作区共享，不能以单用户撤权覆盖现有范围')
  const remaining = current.filter(id => !grantRef.addedMemberIds.includes(id))
  if (remaining.length !== current.length) await writeMembers(datasetId, before, remaining)
  return {revoked: true, changed: remaining.length !== current.length}
}
