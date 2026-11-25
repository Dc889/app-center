import { check } from '../../../../runtime/http.mjs'

export function knowledgeMonitorWindow(range = '24h', now = Date.now()) {
  check(['1h', '24h', '7d'].includes(range), 400, 'INVALID_REQUEST', '无效的时间窗口')
  const bucketMs = range === '7d' ? 3600000 : 300000
  const to = Math.floor(now / bucketMs) * bucketMs
  const duration = { '1h': 3600000, '24h': 86400000, '7d': 604800000 }[range]
  const from = to - duration
  return { range, from: new Date(from).toISOString(), to: new Date(to).toISOString(), fromMs: from, toMs: to, bucketMs }
}

export async function knowledgeMonitorReport({
  query,
  now = Date.now(),
  cap,
  headers,
  identity,
  applications = [],
  difyInventory = null,
  directory = null,
}) {
  const admin = identity.roles.includes('admin')
  const ops = identity.roles.includes('operator')
  check(admin || ops, 403, 'ACCESS_DENIED')

  const filterOrg = query.get('org') || null
  if (!admin && filterOrg && filterOrg !== identity.org) {
    throw new (await import('../../../../runtime/http.mjs')).ApiError(403, 'ACCESS_DENIED', '无权查询其他组织的数据')
  }
  const effectiveOrg = admin ? filterOrg : (filterOrg || identity.org)

  const range = query.get('window') || '24h'
  const win = knowledgeMonitorWindow(range, now)

  const sourceFilter = query.get('sourceSystem') || '全部'
  const q = (query.get('q') || '').trim().toLowerCase()
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.get('pageSize') || '10', 10) || 10))

  // 1. 读取能力侧知识库目录盘点（聚合 RAGFlow + Dify 真实知识库，兼容 /catalog?kind=knowledge）
  let catalogItems = null
  let catalogSource = 'not_collected'
  const liveDatasets = []
  if (cap) {
    try {
      const [rfRes, difyRes] = await Promise.all([
        cap('/resources?kind=ragflow_dataset&limit=100', 'GET', undefined, headers).catch(() => null),
        cap('/resources?kind=dify_dataset&limit=100', 'GET', undefined, headers).catch(() => null),
      ])
      if (rfRes?.ok) {
        const rfBody = await rfRes.json().catch(() => null)
        if (Array.isArray(rfBody?.items)) {
          for (const item of rfBody.items) {
            liveDatasets.push({
              resourceId: item.resourceId,
              name: item.name || item.resourceId,
              source: 'RAGFlow',
              status: item.status || 'private',
              documentCount: item.data?.documentCount ?? item.documentCount ?? null,
              updatedAt: item.data?.updatedAt ?? item.updatedAt ?? new Date(now).toISOString(),
            })
          }
          catalogSource = 'collected'
        }
      }
      if (difyRes?.ok) {
        const difyBody = await difyRes.json().catch(() => null)
        if (Array.isArray(difyBody?.items)) {
          for (const item of difyBody.items) {
            liveDatasets.push({
              resourceId: item.resourceId,
              name: item.name || item.resourceId,
              source: 'Dify',
              status: item.status || 'private',
              documentCount: item.data?.documentCount ?? item.documentCount ?? null,
              updatedAt: item.data?.updatedAt ?? item.updatedAt ?? new Date(now).toISOString(),
            })
          }
          catalogSource = 'collected'
        }
      }
    } catch {
      // Fall through to legacy catalog endpoint
    }

    // Merge full multi-tenant Dify datasets synced from subsystem read-only DB
    if (difyInventory && Array.isArray(difyInventory.datasets) && difyInventory.datasets.length > 0) {
      const seenDs = new Set(liveDatasets.map(d => d.resourceId))
      for (const ds of difyInventory.datasets) {
        if (!ds?.resourceId || seenDs.has(ds.resourceId)) continue
        seenDs.add(ds.resourceId)
        const dirProfile = directory?.byAccount?.(ds.ownerAccount)
        liveDatasets.push({
          resourceId: ds.resourceId,
          name: ds.name || ds.resourceId,
          source: 'Dify',
          status: ds.permission === 'all_team_members' ? 'shared' : 'private',
          documentCount: ds.documentCount ?? 0,
          ownerAccount: dirProfile?.account || ds.ownerAccount || '',
          ownerName: dirProfile?.name || ds.ownerName || '',
          org: dirProfile?.org || ds.org || '待归属',
          updatedAt: ds.createdAt || difyInventory.syncedAt || new Date(now).toISOString(),
        })
      }
      catalogSource = 'collected'
    }

    if (liveDatasets.length > 0) {
      catalogItems = liveDatasets
    } else {
      try {
        const res = await cap('/catalog?kind=knowledge', 'GET', undefined, headers)
        if (res.ok) {
          const body = await res.json()
          if (Array.isArray(body?.items)) {
            catalogItems = body.items
            catalogSource = 'collected'
          }
        }
      } catch {
        catalogSource = 'not_collected'
      }
    }
  }

  // 2. 过滤组织下的知识库相关工单
  const kbApps = applications.filter(a =>
    ['KB-01', 'KB-02', 'KB-03', 'KB-04', 'KB-05'].includes(a.ticketType) &&
    (admin || !effectiveOrg || a.org === effectiveOrg || a.applicantOrg === effectiveOrg)
  )

  // 3. 统计五大核心指标
  let managedCount = null
  let sharedCount = null
  let buildingCount = null
  let abnormalCount = null
  let pendingDocCount = null

  if (catalogItems !== null) {
    managedCount = catalogItems.length
    sharedCount = catalogItems.filter(i => i.status === 'shared' || i.status === 'published' || i.status === '已分享').length
    buildingCount = catalogItems.filter(i => i.status === 'building' || i.status === '构建中').length
    abnormalCount = catalogItems.filter(i => i.status === 'abnormal' || i.status === 'failed' || i.status === '异常').length
  } else {
    // 能力端未采集，安全降级为 null，不补伪零
    managedCount = null
    buildingCount = null
    abnormalCount = null
  }

  // 从管理端工单提取在途待确认文档数与审批统计
  let pendingDocs = 0
  for (const app of kbApps) {
    if (['KB-02', 'KB-04'].includes(app.ticketType) && ['待受理', '待审批', '待运维办理', '待所有者提交'].includes(app.status)) {
      const docs = app.snapshot?.fields?.['文档审查明细'] || app.snapshot?.fields?.['变更明细'] || app.snapshot?.fields?.['文档清单']
      if (Array.isArray(docs)) {
        pendingDocs += docs.length
      } else {
        pendingDocs += 1
      }
    }
  }
  pendingDocCount = pendingDocs

  // 4. 来源与状态分布统计
  let ragflowCount = 0
  let difyCount = 0
  const statusCounter = new Map([
    ['已分享', 0],
    ['私有纳管', 0],
    ['构建中', 0],
    ['异常停滞', 0],
  ])

  if (liveDatasets.length > 0 && kbApps.length === 0) {
    for (const ds of liveDatasets) {
      if (ds.source === 'Dify') difyCount++
      else ragflowCount++
      if (['shared', 'published', '已分享'].includes(ds.status)) {
        statusCounter.set('已分享', (statusCounter.get('已分享') || 0) + 1)
      } else if (['building', '构建中'].includes(ds.status)) {
        statusCounter.set('构建中', (statusCounter.get('构建中') || 0) + 1)
      } else if (['abnormal', 'failed', '异常'].includes(ds.status)) {
        statusCounter.set('异常停滞', (statusCounter.get('异常停滞') || 0) + 1)
      } else {
        statusCounter.set('私有纳管', (statusCounter.get('私有纳管') || 0) + 1)
      }
    }
  } else {
    for (const app of kbApps) {
      const src = app.snapshot?.fields?.['来源系统'] || app.submission?.fields?.sourceSystem || 'RAGFlow'
      if (src === 'Dify') difyCount++
      else ragflowCount++

      if (app.ticketType === 'KB-02' && app.status === '已完成') {
        statusCounter.set('已分享', (statusCounter.get('已分享') || 0) + 1)
      } else if (app.ticketType === 'KB-01' && app.status === '已完成') {
        statusCounter.set('私有纳管', (statusCounter.get('私有纳管') || 0) + 1)
      } else if (['待受理', '待审批', '待运维办理'].includes(app.status)) {
        statusCounter.set('构建中', (statusCounter.get('构建中') || 0) + 1)
      } else if (app.ticketType === 'KB-05' || app.status === '执行失败') {
        statusCounter.set('异常停滞', (statusCounter.get('异常停滞') || 0) + 1)
      }
    }
  }

  // 如果管理端没有特定记录，保持合理分布基础
  const sourceDistribution = [
    { name: 'RAGFlow', value: ragflowCount },
    { name: 'Dify', value: difyCount },
  ]
  const statusDistribution = Array.from(statusCounter.entries()).map(([name, value]) => ({ name, value }))

  // 5. 构建任务与趋势
  const bucketCount = (win.toMs - win.fromMs) / win.bucketMs
  const trendBuckets = []
  for (let i = 0; i < bucketCount; i++) {
    const t = win.fromMs + i * win.bucketMs
    const d = new Date(t)
    const timeLabel = win.range === '7d'
      ? `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
      : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    trendBuckets.push({
      time: timeLabel,
      timestamp: t,
      total: 0,
      success: 0,
      alert: 0,
      failed: 0,
    })
  }

  // 6. 构建任务追踪列表（Tasks）
  const allTasks = []
  const seenDatasetIds = new Set()
  for (const app of kbApps) {
    if (app.resourceId) seenDatasetIds.add(app.resourceId)
    const time = app.history?.[0]?.at || app.createdAt || new Date(now).toISOString()
    const timeMs = Date.parse(time) || now
    const src = app.snapshot?.fields?.['来源系统'] || app.submission?.fields?.sourceSystem || 'RAGFlow'
    const name = app.snapshot?.fields?.['知识库名称'] || app.submission?.fields?.name || app.resourceId || '知识库'

    // 过滤来源系统
    if (sourceFilter !== '全部' && src !== sourceFilter) continue

    let stage = '索引 / 向量化'
    let progress = '100%'
    let statusText = '正常'
    if (['待受理', '待审批'].includes(app.status)) {
      stage = '切片'
      progress = '46%'
      statusText = '进行中'
    } else if (app.status === '待运维办理' || app.status === '待所有者提交') {
      stage = '解析'
      progress = '78%'
      statusText = '进行中'
    } else if (app.status === '执行失败' || app.ticketType === 'KB-05') {
      stage = '解析'
      progress = '—'
      statusText = '进度停滞'
    }

    const duration = app.snapshot?.fields?.['耗时'] || ''
    const taskItem = {
      taskId: app.ticketNo,
      source: src,
      datasetName: name,
      stage,
      progress,
      duration,
      status: statusText,
      ticketNo: app.ticketNo,
      updatedAt: time,
    }

    // 关键字过滤
    if (q) {
      const match = [taskItem.taskId, taskItem.datasetName, taskItem.ticketNo, taskItem.source, taskItem.status].some(
        str => str && str.toLowerCase().includes(q)
      )
      if (!match) continue
    }

    allTasks.push(taskItem)

    // 填入趋势时间桶
    if (timeMs >= win.fromMs && timeMs < win.toMs) {
      const bIdx = Math.floor((timeMs - win.fromMs) / win.bucketMs)
      if (bIdx >= 0 && bIdx < trendBuckets.length) {
        trendBuckets[bIdx].total += 1
        if (statusText === '正常') trendBuckets[bIdx].success += 1
        else if (statusText === '进行中') trendBuckets[bIdx].alert += 1
        else trendBuckets[bIdx].failed += 1
      }
    }
  }

  // 补充已采集的 RAGFlow / Dify 真实知识库条目（无在途工单时直接展示真实同步态）
  for (const ds of liveDatasets) {
    if (seenDatasetIds.has(ds.resourceId)) continue
    if (sourceFilter !== '全部' && ds.source !== sourceFilter) continue
    const taskItem = {
      taskId: ds.resourceId,
      source: ds.source,
      datasetName: ds.name,
      stage: '索引就绪',
      progress: '100%',
      duration: '—',
      status: '正常',
      ticketNo: '—',
      updatedAt: ds.updatedAt,
    }
    if (q) {
      const match = [taskItem.taskId, taskItem.datasetName, taskItem.source, taskItem.status].some(
        str => str && str.toLowerCase().includes(q),
      )
      if (!match) continue
    }
    allTasks.push(taskItem)
  }

  // 7. 逐文档审查台账（Document Audits）
  const documentAudits = []
  for (const app of kbApps) {
    if (!['KB-02', 'KB-04'].includes(app.ticketType)) continue
    const src = app.snapshot?.fields?.['来源系统'] || 'RAGFlow'
    if (sourceFilter !== '全部' && src !== sourceFilter) continue
    const dsName = app.snapshot?.fields?.['知识库名称'] || app.resourceId || '知识库'
    const docList = app.snapshot?.fields?.['文档审查明细'] || app.snapshot?.fields?.['变更明细'] || app.snapshot?.fields?.['文档清单'] || []
    const approvedVerdicts = app.approvedFields?.['文档确认记录'] || {}

    if (Array.isArray(docList) && docList.length > 0) {
      for (const d of docList) {
        const docId = d.documentId || 'doc-unknown'
        const docName = d.name || `${docId}.pdf`
        const sha256 = d.sha256 ? `${d.sha256.slice(0, 8)}...` : '—'
        const auto = d.autoVerdict || '通过'
        const manual = approvedVerdicts[docId] || (app.status === '已完成' ? '通过' : '待确认')

        if (q) {
          const match = [docId, docName, dsName, app.ticketNo, auto, manual].some(
            s => s && s.toLowerCase().includes(q)
          )
          if (!match) continue
        }

        documentAudits.push({
          documentId: docId,
          documentName: docName,
          datasetName: dsName,
          sourceSystem: src,
          sha256,
          autoVerdict: auto,
          manualVerdict: manual,
          status: manual === '通过' ? '已确认' : manual === '不通过' ? '已驳回' : '待确认',
          ticketNo: app.ticketNo,
          updatedAt: app.createdAt || new Date(now).toISOString(),
        })
      }
    }
  }

  // 8. 告警与处置追踪（Alerts）
  const alerts = []
  for (const app of kbApps) {
    if (app.ticketType !== 'KB-05') continue
    const src = app.snapshot?.fields?.['来源系统'] || 'RAGFlow'
    if (sourceFilter !== '全部' && src !== sourceFilter) continue
    const dsName = app.snapshot?.fields?.['知识库名称'] || app.resourceId || '知识库'
    const reason = app.submission?.fields?.reason || '安全处置'
    const operation = app.submission?.fields?.target || '暂停分享'

    alerts.push({
      alertId: `ALT-${app.ticketNo.slice(-8)}`,
      datasetName: dsName,
      reason,
      operation,
      status: app.status,
      ticketNo: app.ticketNo,
      time: app.createdAt || new Date(now).toISOString(),
    })
  }

  const embeddingModels = []
  const failureCategories = []

  const subsystemRows = catalogSource === 'collected' ? subsystemInventory(liveDatasets.length ? liveDatasets : (catalogItems ?? [])) : []
  const warehouse = warehouseCounts(kbApps)
  const securityAudits = securityAuditRows(kbApps, sourceFilter, q)

  // 分页截取 tasks
  const totalTasks = allTasks.length
  const startIndex = (page - 1) * pageSize
  const pagedTasks = allTasks.slice(startIndex, startIndex + pageSize)

  return {
    asOf: new Date(now).toISOString(),
    window: range,
    metrics: {
      managedCount,
      sharedCount,
      buildingCount,
      abnormalCount,
      pendingDocCount,
    },
    sources: {
      catalog: catalogSource,
      tasks: 'collected',
    },
    trend: trendBuckets.map(b => ({
      time: b.time,
      total: b.total,
      success: b.success,
      alert: b.alert,
      failed: b.failed,
    })),
    distribution: {
      sources: sourceDistribution,
      status: statusDistribution,
    },
    failureCategories,
    embeddingModels,
    tasks: {
      total: totalTasks,
      page,
      pageSize,
      items: pagedTasks,
    },
    documentAudits: documentAudits.slice(0, 50),
    alerts: alerts.slice(0, 50),
    quantity: {
      subsystems: { source: catalogSource, items: subsystemRows },
      warehouseListed: warehouse.listed,
      warehousePending: warehouse.pending,
    },
    securityAudits,
  }
}

function subsystemInventory(datasets) {
  const groups = new Map()
  for (const dataset of datasets) {
    const name = dataset.source || dataset.data?.sourceSystem || '未标明子系统'
    if (!groups.has(name)) groups.set(name, { name, datasetCount: 0, documentCount: 0, complete: true })
    const group = groups.get(name)
    group.datasetCount += 1
    const count = dataset.documentCount ?? dataset.data?.documentCount
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) group.documentCount += count
    else group.complete = false
  }
  return [...groups.values()].map(group => ({
    name: group.name,
    datasetCount: group.datasetCount,
    documentCount: group.complete ? group.documentCount : null,
  }))
}

function warehouseCounts(applications) {
  const listed = new Set()
  const pending = new Set()
  const ordered = [...applications].sort((a, b) => Date.parse(a.createdAt ?? 0) - Date.parse(b.createdAt ?? 0))
  for (const app of ordered) {
    const id = app.submission?.resourceId || app.resourceId || app.ticketNo
    if (!id) continue
    if (app.ticketType === 'KB-02' && app.status === '已完成') {
      listed.add(id)
      pending.delete(id)
    } else if (app.ticketType === 'KB-02' && ['待受理', '待审批', '待运维办理', '待运维确认', '待所有者提交', '待补正'].includes(app.status)) {
      pending.add(id)
    } else if (app.ticketType === 'KB-05' && app.status === '已完成') {
      const actions = app.approvedFields?.['处置动作']
      const target = app.submission?.fields?.target
      if ((Array.isArray(actions) && actions.includes('目录下架')) || target === '整个知识库' || target === '目录下架') listed.delete(id)
    }
  }
  return { listed: listed.size, pending: pending.size }
}

function documentList(app) {
  const fields = app.snapshot?.fields ?? {}
  const docs = fields['文档审查明细'] || fields['变更明细'] || fields['文档清单']
  return Array.isArray(docs) ? docs : []
}

function keywordScan(app) {
  const docs = documentList(app)
  if (!docs.length) return '未采集'
  if (docs.some(doc => doc.autoVerdict === '不通过')) return '未通过'
  if (docs.every(doc => doc.autoVerdict === '通过')) return '通过'
  return '未采集'
}

function subsystemScan(app) {
  const value = app.snapshot?.fields?.['子平台安全扫描'] ?? app.submission?.fields?.subsystemSecurityConfirmed
  if (value === true || value === '已确认' || value === '通过') return '已确认'
  if (value === false || value === '未通过' || value === '未确认') return '未确认'
  return '未采集'
}

function shareScope(app) {
  const fields = app.submission?.fields ?? {}
  const orgs = fields.targetOrgs ?? fields.boundaryOrgs ?? app.snapshot?.fields?.['目标组织']
  if (fields.shareMode === '共享目录') return '全组织可使用'
  if (Array.isArray(orgs) && orgs.length) return orgs.join('、')
  if (fields.shareMode === '指定人员' && Array.isArray(fields.targetAccounts) && fields.targetAccounts.length) return '指定人员：' + fields.targetAccounts.join('、')
  if (fields.shareMode) return '未规定分享范围'
  return '未采集'
}

function securityAuditRows(applications, sourceFilter, q) {
  const published = new Map()
  for (const app of applications) {
    const id = app.submission?.resourceId || app.resourceId
    if (app.ticketType === 'KB-02' && app.status === '已完成' && id) published.set(id, app)
  }
  const rows = []
  for (const app of applications) {
    if (!['KB-02', 'KB-03', 'KB-04'].includes(app.ticketType)) continue
    const source = app.snapshot?.fields?.['来源系统'] || app.submission?.fields?.sourceSystem || ''
    if (sourceFilter !== '全部' && source && source !== sourceFilter) continue
    const id = app.submission?.resourceId || app.resourceId || ''
    const datasetName = app.snapshot?.fields?.['知识库名称'] || app.submission?.fields?.name || id || '知识库'
    let scene = '上架审核'
    let scope = shareScope(app)
    if (app.ticketType === 'KB-03') {
      const publication = published.get(id)
      scope = publication ? shareScope(publication) : '未采集'
      const fields = publication?.submission?.fields ?? {}
      const orgs = fields.targetOrgs ?? fields.boundaryOrgs ?? []
      const accounts = fields.targetAccounts ?? []
      const open = !publication || fields.shareMode === '共享目录' || !fields.shareMode && !orgs.length && !accounts.length && publication
      const inside = open || orgs.includes(app.org) || accounts.includes(app.account) || publication?.account === app.account
      scene = publication && !inside ? '范围外使用申请' : publication ? '范围内使用申请' : '范围待核对'
    }
    const row = {
      scene,
      datasetName,
      applicant: app.account || '',
      org: app.org || '',
      keywordScan: keywordScan(app),
      subsystemScan: subsystemScan(app),
      shareScope: scope,
      status: app.status || '',
      ticketNo: app.ticketNo,
    }
    if (q && ![row.scene, row.datasetName, row.applicant, row.org, row.ticketNo, row.shareScope].some(value => value && value.toLowerCase().includes(q))) continue
    rows.push(row)
  }
  return rows.slice(0, 100)
}
