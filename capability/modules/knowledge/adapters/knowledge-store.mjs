import {createHash} from 'node:crypto'
import {check} from '../../../../runtime/http.mjs'

export function sha256Hex(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

export function normalizeDocument(raw) {
  const documentId = String(raw.documentId ?? raw.id ?? '')
  const name = String(raw.name ?? raw.title ?? documentId)
  const sha =
    typeof raw.sha256 === 'string' && /^[a-f0-9]{64}$/.test(raw.sha256)
      ? raw.sha256
      : sha256Hex({documentId, name, content: raw.content ?? raw.text ?? raw.updated_at ?? raw.word_count ?? ''})
  const autoVerdict = raw.autoVerdict === '不通过' || raw.flagged === true ? '不通过' : '通过'
  const disabled = Boolean(raw.disabled === true || raw.enabled === false || raw.status === 'disabled' || raw.status === '0' || raw.status === 0 || raw.enabled === '0' || raw.enabled === 0)
  return {documentId, name, sha256: sha, autoVerdict, disabled}
}

export function computeManifest(documents) {
  const normalized = [...documents]
    .map(normalizeDocument)
    .filter(d => d.documentId)
    .sort((a, b) => a.documentId.localeCompare(b.documentId))
  const sha256 = sha256Hex(normalized.map(d => ({documentId: d.documentId, sha256: d.sha256})))
  return {
    documents: normalized,
    manifestSha256: sha256,
    manifestSnapshotId: `manifest-${sha256.slice(0, 16)}`,
  }
}

export function diffDocuments(prevDocs, nextDocs) {
  const prevMap = new Map(prevDocs.map(d => [d.documentId, d]))
  const nextMap = new Map(nextDocs.map(d => [d.documentId, d]))
  const changes = []
  for (const [docId, doc] of nextMap) {
    const old = prevMap.get(docId)
    if (!old) {
      changes.push({documentId: docId, name: doc.name, changeType: '新增', sha256: doc.sha256, autoVerdict: doc.autoVerdict})
    } else if (old.sha256 !== doc.sha256) {
      changes.push({documentId: docId, name: doc.name, changeType: '修改', sha256: doc.sha256, autoVerdict: doc.autoVerdict})
    }
  }
  for (const [docId, old] of prevMap) {
    if (!nextMap.has(docId)) {
      changes.push({documentId: docId, name: old.name, changeType: '删除', sha256: old.sha256})
    }
  }
  return changes
}

export async function fetchApprovedKnowledgeInputs(clients, command) {
  check(clients?.management, 501, 'UPSTREAM_UNSUPPORTED', '未配置管理端回读通道')
  const res = await clients.management(`/approved-inputs/${encodeURIComponent(command.executionId)}`)
  const approved = await res.json()
  check(
    approved &&
      approved.decisionRef === command.payload?.decisionRef &&
      approved.ticketType === command.ticketType &&
      approved.action === command.action &&
      approved.resourceId === command.resourceId,
    409,
    'APPROVED_INPUT_MISMATCH',
    '获准输入与执行命令不一致',
  )
  return approved
}

export async function pushDatasetChanges(clients, {sourceEventId, resourceId}) {
  check(clients?.management, 501, 'UPSTREAM_UNSUPPORTED', '未配置管理端回调通道')
  const res = await clients.management('/dataset-changes', 'POST', {sourceEventId, resourceId})
  return res.json()
}

export async function pushDatasetAlert(clients, {sourceEventId, resourceId, fields}) {
  check(clients?.management, 501, 'UPSTREAM_UNSUPPORTED', '未配置管理端回调通道')
  const res = await clients.management('/dataset-alerts', 'POST', {sourceEventId, resourceId, fields})
  return res.json()
}

export function resolveBindingVariant(sourceSystem, sourceScopeId, targetWorkspaceId) {
  if (sourceSystem === 'RAGFlow') return 'RAGFlow外部知识库'
  return sourceScopeId === targetWorkspaceId ? 'Dify同workspace授权' : 'Dify跨workspace复制'
}
