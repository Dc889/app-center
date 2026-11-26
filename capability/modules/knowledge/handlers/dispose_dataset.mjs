import {check} from '../../../../runtime/http.mjs'
import {getDifyDatasetDetailWithFallback, disableDifyDocument, revokeDifyDatasetAccess} from '../adapters/dify-datasets.mjs'
import {getRagflowDatasetDetail, disableRagflowDocument} from '../adapters/ragflow-datasets.mjs'
import {fetchApprovedKnowledgeInputs} from '../adapters/knowledge-store.mjs'

export async function execute({command, state, clients, openLedger}) {
  const approved = await fetchApprovedKnowledgeInputs(clients, command)
  const fields = approved.fields ?? {}
  const preconditions = approved.preconditions ?? []

  const datasets = openLedger('datasets')
  const bindings = openLedger('bindings')
  const dataset = datasets.get(command.resourceId)
  check(dataset && dataset.status !== '已下架', 404, 'NOT_FOUND', '知识库不存在或已下架')

  const dsPre = preconditions.find(p => p.kind === 'dataset' && p.id === command.resourceId)
  check(!dsPre || dataset.revision === dsPre.revision, 409, 'STALE_SNAPSHOT', '知识库修订已变化')

  const manifestPre = preconditions.find(p => p.kind === 'dataset_manifest')
  check(manifestPre && typeof manifestPre.sha256 === 'string', 409, 'MISSING_PRECONDITION', '缺少文档清单前置指纹')

  const live =
    dataset.sourceSystem === 'RAGFlow'
      ? await getRagflowDatasetDetail(dataset.sourceResourceId)
      : await getDifyDatasetDetailWithFallback(dataset.sourceResourceId, dataset.sourceScopeId, {clients, fallbackDataset: dataset})

  check(
    live.manifestSnapshotId === manifestPre.id && live.manifestSha256 === manifestPre.sha256,
    409,
    'STALE_SNAPSHOT',
    '处置执行前检测到文档清单变化，中止处置',
  )

  const actions = Array.isArray(fields['处置动作']) ? fields['处置动作'] : []
  const targets = Array.isArray(fields['API执行对象清单']) ? fields['API执行对象清单'] : []
  check(actions.length > 0 && targets.length > 0, 400, 'INVALID_DISPOSITION_ACTIONS')

  const executedNodes = []
  let nextStatus = dataset.status

  for (const target of targets) {
    if (target.action === '目录下架') {
      nextStatus = '已下架'
      executedNodes.push({...target, status: 'succeeded'})
    } else if (target.action === '暂停分享') {
      if (nextStatus !== '已下架') nextStatus = '暂停分享'
      executedNodes.push({...target, status: 'succeeded'})
    } else if (target.action === '撤销未到期授权') {
      const binding = bindings.get(target.objectId)
      if (binding && binding.status === 'active') {
        await revokeDifyDatasetAccess({
          datasetId: binding.productRef?.externalDatasetId ?? binding.productRef?.replicaDatasetId ?? binding.sourceResourceId,
          workspaceId: binding.targetWorkspaceId,
          grantRef: binding.productRef,
          bindingId: binding.bindingId,
          targetAppId: binding.targetAppId,
        })
        bindings.put(binding.bindingId, {...binding, status: 'revoked', revokedAt: new Date().toISOString()})
      }
      executedNodes.push({...target, status: 'succeeded'})
    } else if (target.action === '停用文档') {
      if (target.system === 'RAGFlow') {
        await disableRagflowDocument({datasetId: target.objectId, documentId: target.documentId})
      } else {
        await disableDifyDocument({
          datasetId: target.objectId,
          documentId: target.documentId,
          workspaceId: dataset.sourceScopeId,
        })
      }
      executedNodes.push({...target, status: 'succeeded'})
    }
  }

  const disabledDocIds = new Set(targets.filter(t => t.action === '停用文档').map(t => t.documentId))
  const nextDocs = live.documents.map(d => (disabledDocIds.has(d.documentId) ? {...d, disabled: true} : d))
  const nextRevision = dataset.revision + 1

  datasets.put(command.resourceId, {
    ...dataset,
    status: nextStatus,
    documents: nextDocs,
    disposedReason: fields['处置原因'] ?? null,
    recoveryCondition: fields['恢复条件'] ?? null,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
  })

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: `${command.resourceId}:dispose:${nextRevision}`,
    version: String(nextRevision),
    sha256: live.manifestSha256,
    details: {
      目录知识库ID: command.resourceId,
      新状态: nextStatus,
      已执行节点数: executedNodes.length,
      执行节点对账: executedNodes,
    },
  }
}
