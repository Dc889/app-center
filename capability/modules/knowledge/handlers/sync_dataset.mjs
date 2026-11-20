import {check} from '../../../../runtime/http.mjs'
import {getDifyDatasetDetail} from '../adapters/dify-datasets.mjs'
import {getRagflowDatasetDetail} from '../adapters/ragflow-datasets.mjs'
import {fetchApprovedKnowledgeInputs} from '../adapters/knowledge-store.mjs'

export async function execute({command, state, clients, openLedger}) {
  const approved = await fetchApprovedKnowledgeInputs(clients, command)
  const fields = approved.fields ?? {}
  const sourceSystem = fields['来源系统']
  const scopeId = fields['所属workspace/tenant ID']
  const ownerAccount = fields['所有者账户名'] ?? command.account
  check(['Dify', 'RAGFlow'].includes(sourceSystem) && typeof scopeId === 'string' && scopeId.trim(), 400, 'INVALID_FIELDS')

  const live =
    sourceSystem === 'RAGFlow'
      ? await getRagflowDatasetDetail(command.resourceId)
      : await getDifyDatasetDetail(command.resourceId, scopeId)

  if (live.ownerAccount) {
    check(live.ownerAccount === ownerAccount, 403, 'NOT_RESOURCE_OWNER', '仅可同步本人知识库')
  }

  const datasets = openLedger('datasets')
  const catalogId = `kb-${sourceSystem.toLowerCase()}-${command.resourceId}`
  const existing = datasets.get(catalogId)
  const nextRevision = (existing?.revision ?? 0) + 1
  const record = {
    ...(existing ?? {}),
    resourceId: catalogId,
    sourceSystem,
    sourceResourceId: live.resourceId,
    sourceScopeId: sourceSystem === 'RAGFlow' ? live.tenantId : live.workspaceId,
    name: live.name,
    ownerAccount,
    status: existing?.status && existing.status !== '已下架' ? existing.status : '已纳管',
    documents: live.documents,
    manifestSnapshotId: live.manifestSnapshotId,
    manifestSha256: live.manifestSha256,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
  }
  datasets.put(catalogId, record)

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: catalogId,
    version: String(nextRevision),
    sha256: live.manifestSha256,
    details: {
      目录知识库ID: catalogId,
      来源系统: sourceSystem,
      源知识库ID: live.resourceId,
      '源workspace/tenant ID': record.sourceScopeId,
      文档数: live.documents.length,
      文档清单快照ID: live.manifestSnapshotId,
      状态: record.status,
    },
  }
}
