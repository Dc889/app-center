import {check} from '../../../../runtime/http.mjs'
import {fetchApprovedKnowledgeInputs} from '../adapters/knowledge-store.mjs'

export async function execute({command, state, clients, openLedger}) {
  const approved = await fetchApprovedKnowledgeInputs(clients, command)
  const fields = approved.fields ?? {}
  const preconditions = approved.preconditions ?? []

  const datasets = openLedger('datasets')
  const dataset = datasets.get(command.resourceId)
  check(dataset && dataset.status !== '已下架', 404, 'NOT_FOUND', '知识库不存在或已下架')

  const dsPre = preconditions.find(p => p.kind === 'dataset' && p.id === command.resourceId)
  if (dsPre) {
    check(dataset.revision === dsPre.revision, 409, 'STALE_SNAPSHOT', '知识库修订已变化')
  }

  const nextRevision = dataset.revision + 1
  datasets.put(command.resourceId, {
    ...dataset,
    status: '暂停分享',
    pausedReason: fields['处置原因'] ?? '告警自动暂停',
    pausedByAlertId: fields['告警ID'] ?? null,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
  })

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: `${command.resourceId}:pause:${nextRevision}`,
    version: String(nextRevision),
    sha256: dataset.manifestSha256 ?? '',
    details: {
      目录知识库ID: command.resourceId,
      状态: '暂停分享',
      告警ID: fields['告警ID'] ?? null,
    },
  }
}
