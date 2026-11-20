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
  check(dataset && ['已发布', '暂停分享'].includes(dataset.status), 404, 'NOT_FOUND', '未找到对应知识库')

  const dsPre = preconditions.find(p => p.kind === 'dataset' && p.id === command.resourceId)
  if (dsPre) {
    check(dataset.revision >= dsPre.revision, 409, 'STALE_SNAPSHOT', '知识库修订不匹配')
  }
  const manifestPre = preconditions.find(p => p.kind === 'dataset_manifest')
  check(manifestPre && typeof manifestPre.sha256 === 'string', 409, 'MISSING_PRECONDITION', '缺少变更快照前置指纹')

  const live =
    dataset.sourceSystem === 'RAGFlow'
      ? await getRagflowDatasetDetail(dataset.sourceResourceId)
      : await getDifyDatasetDetail(dataset.sourceResourceId, dataset.sourceScopeId)

  check(
    live.manifestSnapshotId === manifestPre.id && live.manifestSha256 === manifestPre.sha256,
    409,
    'STALE_SNAPSHOT',
    '执行前检测到知识库文档再次变更',
  )

  const verdict = fields['运维确认结论']
  const nextStatus = fields['新目录状态'] === '保持发布' && verdict === '通过' ? '已发布' : '暂停分享'
  const nextRevision = dataset.revision + 1

  const updated = {
    ...dataset,
    status: nextStatus,
    documents: verdict === '通过' ? live.documents : dataset.documents,
    manifestSnapshotId: verdict === '通过' ? live.manifestSnapshotId : dataset.manifestSnapshotId,
    manifestSha256: verdict === '通过' ? live.manifestSha256 : dataset.manifestSha256,
    lastReviewedAt: new Date().toISOString(),
    lastReviewVerdict: verdict,
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
    resultId: `${command.resourceId}:${nextRevision}`,
    version: String(nextRevision),
    sha256: live.manifestSha256,
    details: {
      目录知识库ID: command.resourceId,
      运维确认结论: verdict,
      新目录状态: nextStatus,
      当前快照ID: live.manifestSnapshotId,
    },
  }
}
