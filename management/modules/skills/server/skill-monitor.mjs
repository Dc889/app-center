import { check } from '../../../../runtime/http.mjs'

export function skillMonitorWindow(range = '24h', now = Date.now()) {
  check(['1h', '24h', '7d'].includes(range), 400, 'INVALID_REQUEST', '无效的时间窗口')
  const bucketMs = range === '7d' ? 3600000 : 300000
  const to = Math.floor(now / bucketMs) * bucketMs
  const duration = { '1h': 3600000, '24h': 86400000, '7d': 604800000 }[range]
  const from = to - duration
  return { range, from: new Date(from).toISOString(), to: new Date(to).toISOString(), fromMs: from, toMs: to, bucketMs }
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return null
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export async function skillMonitorReport({
  query,
  now = Date.now(),
  cap,
  headers,
  identity,
  tickets = [],
  applications = [],
  directory,
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
  const win = skillMonitorWindow(range, now)

  const q = (query.get('q') || '').trim().toLowerCase()
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.get('pageSize') || '10', 10) || 10))

  // 1. 读取能力侧 Skill 目录
  let catalogItems = null
  let catalogSource = 'not_collected'
  if (cap) {
    try {
      const res = await cap('/catalog?kind=skill', 'GET', undefined, headers)
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

  // 2. 统计目录指标
  let publishedCount = null
  let versionCount = null
  let storageBytes = null
  let storageFormatted = null

  if (catalogItems !== null) {
    const activeItems = catalogItems.filter(i => ['available', 'approved'].includes(i.status))
    const uniqueSkills = new Set(activeItems.map(i => i.resourceId))
    publishedCount = uniqueSkills.size
    versionCount = activeItems.length
    storageBytes = activeItems.reduce((acc, i) => acc + (Number.isSafeInteger(i.data?.sizeBytes) ? i.data.sizeBytes : (Number.isSafeInteger(i.sizeBytes) ? i.sizeBytes : 0)), 0)
    storageFormatted = formatBytes(storageBytes)
  }

  // 3. 从 applications 提取待审核与已下架统计
  const pendingCount = applications.filter(a =>
    ['SKL-01', 'SKL-02', 'SKL-04'].includes(a.ticketType) &&
    ['待审批', '待运维办理', '待安全复核', '待受理'].includes(a.status) &&
    (admin || !effectiveOrg || a.applicantOrg === effectiveOrg)
  ).length

  const withdrawnCount = applications.filter(a =>
    a.ticketType === 'SKL-04' &&
    ['已完成', '已下架'].includes(a.status) &&
    (admin || !effectiveOrg || a.applicantOrg === effectiveOrg)
  ).length

  // 4. 从 tickets 提取 SKL-03 结算流水与执行记录
  const allDeliveries = []
  let deliveryFailures = 0
  const uniqueSuccessAccounts = new Set()
  const orgCounter = new Map()

  // 初始化时间桶
  const buckets = []
  for (let t = win.fromMs; t < win.toMs; t += win.bucketMs) {
    buckets.push({
      start: t,
      end: t + win.bucketMs,
      label: new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      success: 0,
      failed: 0,
    })
  }

  for (const row of tickets) {
    if (row.command?.ticketType !== 'SKL-03') continue

    // 组织边界隔离
    const rowOrg = row.command?.org || row.applicantOrg || ''
    if (effectiveOrg && rowOrg !== effectiveOrg) continue

    const person = directory?.byAccount?.(row.command?.account)
    const personName = person?.name || row.command?.account || '未知'

    // 确定时间戳
    let timeStr = row.state?.updatedAt || row.delivery?.updatedAt || row.history?.[row.history.length - 1]?.at
    if (!timeStr && row.command?.executionId) {
      timeStr = new Date(now).toISOString()
    }
    const recordTime = timeStr ? Date.parse(timeStr) : 0

    // 判断状态
    const succeeded = row.state?.status === 'succeeded' || row.delivery?.status === 'confirmed' || !!row.receipt
    const failed = row.state?.status === 'failed' || row.state?.status === 'cancelled' || row.deliveryClosure?.state === 'closed_unserved'
    let statusText = '进行中'
    if (succeeded) statusText = '成功'
    else if (failed) statusText = '失败'
    else if (['interrupted', 'uncertain'].includes(row.delivery?.status)) statusText = '中断'
    else if (row.delivery?.status === 'sending') statusText = '发送中'
    else if (row.deliveryClosure) statusText = '已关闭'

    // 检查时间窗
    const inWindow = recordTime >= win.fromMs && recordTime <= win.toMs

    if (inWindow) {
      if (failed) {
        deliveryFailures++
      }
      if (succeeded) {
        if (row.command?.account) uniqueSuccessAccounts.add(row.command.account)
        if (rowOrg) {
          orgCounter.set(rowOrg, (orgCounter.get(rowOrg) || 0) + 1)
        }
      }

      // 累加入时间桶
      for (const bucket of buckets) {
        if (recordTime >= bucket.start && recordTime < bucket.end) {
          if (succeeded) bucket.success++
          else if (failed) bucket.failed++
          break
        }
      }
    }

    const deliveryId = row.resultId || row.delivery?.transferId || (row.command?.executionId ? 'DL-' + row.command.executionId : '')
    const skillId = row.command?.resourceId || ''
    const skillName = catalogItems?.find(i => i.resourceId === skillId)?.name || skillId || '公文摘要 Skill'
    const version = row.command?.payload?.version || row.delivery?.version || '-'
    const sha256 = row.command?.payload?.sha256 || row.delivery?.sha256 || ''

    const item = {
      deliveryId,
      time: timeStr || new Date().toISOString(),
      account: row.command?.account || '',
      name: personName,
      org: rowOrg || '未分配',
      skillId,
      skillName,
      version,
      sha256: sha256 ? sha256.slice(0, 8) + '…' + sha256.slice(-4) : '',
      fullSha256: sha256,
      status: statusText,
      ticketNo: row.ticketNo,
      inWindow,
    }

    // 搜索过滤
    if (q) {
      const match = [
        deliveryId,
        skillId,
        skillName,
        row.ticketNo,
        row.command?.account,
        personName,
        rowOrg,
      ].some(val => val && val.toLowerCase().includes(q))
      if (!match) continue
    }

    allDeliveries.push(item)
  }

  // 排序：时间倒序
  allDeliveries.sort((a, b) => Date.parse(b.time) - Date.parse(a.time))

  // 分页截取
  const totalItems = allDeliveries.length
  const startIndex = (page - 1) * pageSize
  const paginatedItems = allDeliveries.slice(startIndex, startIndex + pageSize)

  // 组织分布转数组并排序
  const orgDistribution = Array.from(orgCounter.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  // 趋势数组
  const trend = buckets.map(b => ({
    time: b.label,
    success: b.success,
    failed: b.failed,
    total: b.success + b.failed,
  }))

  return {
    asOf: new Date(now).toISOString(),
    window: range,
    metrics: {
      publishedCount,
      pendingCount,
      withdrawnCount,
      versionCount,
      storageBytes,
      storageFormatted,
      deliveryFailures,
    },
    trend,
    orgDistribution,
    deliveries: {
      total: totalItems,
      page,
      pageSize,
      items: paginatedItems,
    },
    uniqueAccounts: uniqueSuccessAccounts.size,
    sources: {
      catalog: catalogSource,
      deliveries: 'collected',
    },
  }
}
