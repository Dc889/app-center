import {check} from '../../../../runtime/http.mjs'
import {getDifyDatasetDetail} from '../adapters/dify-datasets.mjs'
import {getRagflowDatasetDetail} from '../adapters/ragflow-datasets.mjs'
import {fetchApprovedKnowledgeInputs} from '../adapters/knowledge-store.mjs'

export async function execute({command, state, clients, openLedger}) {
  const approved = await fetchApprovedKnowledgeInputs(clients, command)
  const fields = approved.fields ?? {}
  const preconditions = approved.preconditions ?? []

  const datasets = openLedger('datasets')
  const dataset = datasets.get(command.resourceId)
  check(dataset && dataset.status !== '已下架', 404, 'NOT_FOUND', '未找到待发布知识库')

  const dsPre = preconditions.find(p => p.kind === 'dataset' && p.id === command.resourceId)
  if (dsPre) {
    check(dataset.revision === dsPre.revision, 409, 'STALE_SNAPSHOT', '知识库目录修订已变化')
  }
  const manifestPre = preconditions.find(p => p.kind === 'dataset_manifest')
  check(manifestPre && typeof manifestPre.sha256 === 'string', 409, 'MISSING_PRECONDITION', '缺少文档清单指纹前置条件')

  const live =
    dataset.sourceSystem === 'RAGFlow'
      ? await getRagflowDatasetDetail(dataset.sourceResourceId)
      : await getDifyDatasetDetail(dataset.sourceResourceId, dataset.sourceScopeId)

  check(
    live.manifestSnapshotId === manifestPre.id && live.manifestSha256 === manifestPre.sha256,
    409,
    'STALE_SNAPSHOT',
    '执行前复核发现文档清单已漂移',
  )
  check(live.modelVerified, 409, 'MODEL_NOT_VERIFIED', '嵌入/检索模型目录核对未通过')
  check(live.documents.every(d => d.autoVerdict === '通过'), 409, 'DOCUMENT_REVIEW_FAILED', '存在自动审查不通过的文档')

  const nextRevision = dataset.revision + 1
  const updated = {
    ...dataset,
    name: fields['目录展示名称'] || dataset.name,
    description: fields['目录简介'] ?? dataset.description ?? '',
    tags: Array.isArray(fields['目录标签']) ? fields['目录标签'] : (dataset.tags ?? []),
    shareMode: fields['分享方式'] ?? '共享目录',
    targetOrgs: Array.isArray(fields['目标组织']) ? fields['目标组织'] : [],
    targetAccounts: Array.isArray(fields['目标人员']) ? fields['目标人员'] : [],
    boundaryOrgs: Array.isArray(fields['组织边界'])
      ? fields['组织边界']
      : Array.isArray(fields['目标组织']) && fields['目标组织'].length
        ? fields['目标组织']
        : (dataset.boundaryOrgs ?? [command.org]),
    classification: fields['密级'] ?? dataset.classification ?? '内部',
    businessLine: fields['业务线'] ?? dataset.businessLine ?? '通用业务',
    policyRef: fields.policyRef ?? dataset.policyRef ?? `policy-${command.executionId}`,
    relatedAppId: fields['关联智能体ID'] ?? null,
    relatedWorkspaceId: fields['关联Dify workspace ID'] ?? null,
    relatedTargetRef: fields['关联应用登记ID'] ?? null,
    expiresAt: fields['有效期截止时间'] ?? null,
    documents: live.documents,
    manifestSnapshotId: live.manifestSnapshotId,
    manifestSha256: live.manifestSha256,
    status: '已发布',
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
  }
  datasets.put(command.resourceId, updated)

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: updated.resourceId,
    version: String(nextRevision),
    sha256: live.manifestSha256,
    details: {
      目录知识库ID: updated.resourceId,
      状态: '已发布',
      分享方式: updated.shareMode,
      policyRef: updated.policyRef,
      关联智能体ID: updated.relatedAppId,
      文档清单快照ID: live.manifestSnapshotId,
    },
  }
}
