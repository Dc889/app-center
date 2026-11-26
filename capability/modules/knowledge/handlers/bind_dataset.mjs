import {check, id} from '../../../../runtime/http.mjs'
import {
  getDifyDatasetDetailWithFallback,
  createDifyExternalBinding,
  grantDifySameWorkspaceAccess,
  copyDifyDatasetCrossWorkspace,
} from '../adapters/dify-datasets.mjs'
import {getRagflowExternalEndpoint} from '../adapters/ragflow-datasets.mjs'
import {fetchApprovedKnowledgeInputs, resolveBindingVariant} from '../adapters/knowledge-store.mjs'

export async function execute({command, state, row, clients, openLedger}) {
  const approved = await fetchApprovedKnowledgeInputs(clients, command)
  const fields = approved.fields ?? {}
  const preconditions = approved.preconditions ?? []

  const datasets = openLedger('datasets')
  const dataset = datasets.get(command.resourceId)
  check(dataset && !['已下架', '暂停分享'].includes(dataset.status), 404, 'NOT_FOUND', '知识库不存在或已暂停/下架')

  const catPre = preconditions.find(p => p.kind === 'dataset_catalog' && p.id === command.resourceId)
  check(catPre && catPre.revision === dataset.revision, 409, 'STALE_SNAPSHOT', '知识库目录修订已变化')

  const targetWorkspaceId = fields['目标Dify workspace ID']
  const permission = fields['申请权限'] ?? '检索使用'
  const granteeAccount = fields['获批使用者账户名'] ?? command.account
  const targetAppId = fields['目标智能体ID'] ?? null
  check(typeof targetWorkspaceId === 'string' && targetWorkspaceId.trim(), 400, 'INVALID_FIELDS')

  const variant = resolveBindingVariant(dataset.sourceSystem, dataset.sourceScopeId, targetWorkspaceId)
  if (variant === 'Dify同workspace授权') {
    const duplicate = openLedger('bindings').all().some(row => row.status === 'active' &&
      row.sourceResourceId === dataset.sourceResourceId && row.targetWorkspaceId === targetWorkspaceId && row.granteeAccount === granteeAccount)
    check(!duplicate, 409, 'DATASET_ALREADY_BOUND', '该账户已有有效绑定，先处置原绑定，避免重叠授权无法准确撤回')
  }

  if (fields['实现方式']) {
    check(fields['实现方式'] === variant, 409, 'INVALID_BINDING_VARIANT', '绑定实现方式与目标工作区不匹配')
  }

  let productRef = {}
  let sha256 = ''

  if (variant === 'RAGFlow外部知识库') {
    const endpoint = fields['外部知识库API地址'] ?? getRagflowExternalEndpoint()
    const created = await createDifyExternalBinding({
      name: dataset.name,
      targetWorkspaceId,
      endpoint,
      externalKnowledgeId: dataset.sourceResourceId,
      targetAppId,
    })
    productRef = {
      externalApiId: created.externalApiId,
      externalDatasetId: created.externalDatasetId,
      endpoint,
    }
  } else if (variant === 'Dify同workspace授权') {
    const granted = await grantDifySameWorkspaceAccess({
      datasetId: dataset.sourceResourceId,
      workspaceId: targetWorkspaceId,
      granteeAccount,
      permission,
      targetAppId,
    })
    productRef = {difyDatasetId: granted.datasetId, granteeAccountId: granted.granteeAccountId,
      addedMemberIds: granted.addedMemberIds, originalPermission: granted.originalPermission}
  } else {
    // Dify跨workspace复制
    const manifestPre = preconditions.find(p => p.kind === 'dataset_manifest')
    check(manifestPre && typeof manifestPre.sha256 === 'string', 409, 'MISSING_COPY_MANIFEST', '跨区复制缺少文档清单前置指纹')
    const live = await getDifyDatasetDetailWithFallback(dataset.sourceResourceId, dataset.sourceScopeId, {clients, fallbackDataset: dataset})
    check(
      live.manifestSnapshotId === manifestPre.id && live.manifestSha256 === manifestPre.sha256,
      409,
      'STALE_SNAPSHOT',
      '源知识库文档指纹已变化，停止跨区复制',
    )
    const copied = await copyDifyDatasetCrossWorkspace({
      clients,
      name: dataset.name,
      sourceDatasetId: dataset.sourceResourceId,
      sourceWorkspaceId: dataset.sourceScopeId,
      targetWorkspaceId,
      documents: live.documents,
      targetAppId,
    })
    sha256 = live.manifestSha256
    productRef = {
      replicaDatasetId: copied.replicaDatasetId,
      sourceManifestSha256: live.manifestSha256,
    }
  }

  const bindings = openLedger('bindings')
  const bindingId = `bind-${id()}`
  const period = fields['申请使用期限'] ?? {}
  const record = {
    bindingId,
    catalogResourceId: dataset.resourceId,
    sourceSystem: dataset.sourceSystem,
    sourceResourceId: dataset.sourceResourceId,
    sourceScopeId: dataset.sourceScopeId,
    variant,
    targetWorkspaceId,
    targetAppId,
    granteeAccount,
    permission,
    startsAt: period.from ?? new Date().toISOString(),
    expiresAt: period.to ?? null,
    status: 'active',
    productRef,
    createdAt: new Date().toISOString(),
  }
  bindings.put(bindingId, record)
  row.productTask = {bindingId, variant, productRef}

  state.status = 'succeeded'
  state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: bindingId,
    version: String(dataset.revision),
    sha256,
    details: {
      绑定ID: bindingId,
      实现方式: variant,
      目标workspaceId: targetWorkspaceId,
      目标智能体ID: targetAppId,
      获批使用者账户名: granteeAccount,
      申请权限: permission,
      ...productRef,
    },
  }
}

export async function reconcile({row, openLedger}) {
  const bindingId = row.productTask?.bindingId
  if (!bindingId) return
  const record = openLedger('bindings').get(bindingId)
  if (!record || record.status !== 'active') return
  row.state.status = 'succeeded'
  row.state.result = {
    ok: true,
    failureCode: '',
    failureReason: '',
    retryable: false,
    resultId: bindingId,
    version: '1',
    sha256: record.productRef?.sourceManifestSha256 ?? '',
    details: {绑定ID: bindingId, 实现方式: record.variant, ...record.productRef},
  }
}
