import {check} from '../../../../runtime/http.mjs'

const usageMethods = ['检索使用', '编排绑定']
const sharedStatuses = new Set(['shared', 'published', 'approved', '已分享', '已发布'])
const unavailableStatuses = new Set(['withdrawn', 'unavailable', 'disabled', '已下架', '暂不可用'])

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function list(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : []
}

function stamp(row) {
  const value = Date.parse(row?.updatedAt ?? row?.approvedAt ?? row?.createdAt ?? '')
  return Number.isFinite(value) ? value : 0
}

function methodsFrom(fields) {
  if (fields?.shareMode === '随应用发布') return ['编排绑定']
  const requested = list(fields?.permissions).filter(item => usageMethods.includes(item))
  return requested.length ? requested : [...usageMethods]
}

function blankEntry(id) {
  return {
    id,
    name: id,
    source: '',
    summary: '',
    shareMode: '',
    ownerAccount: '',
    org: '',
    targetOrgs: [],
    targetAccounts: [],
    boundaryOrgs: [],
    methods: [...usageMethods],
    grantedAccounts: [],
    downloadCount: null,
    unavailable: false,
    ticketNo: '',
  }
}

function applyCatalog(entry, item) {
  entry.name = text(item.name) || entry.name
  entry.source = text(item.source) || text(item.data?.sourceSystem) || entry.source
  entry.summary = text(item.data?.description) || text(item.description) || entry.summary
  entry.shareMode = text(item.data?.shareMode) || entry.shareMode
  const count = numberOrNull(item.data?.downloadCount ?? item.data?.successfulDownloadCount ?? item.downloadCount)
  if (count !== null) entry.downloadCount = count
  if (unavailableStatuses.has(item.status)) entry.unavailable = true
}

export function knowledgeWarehouseReport({
  query,
  identity,
  applications = [],
  catalogItems = null,
  now = Date.now(),
}) {
  check(identity?.account, 403, 'ACCESS_DENIED')
  const staff = identity.roles?.includes('admin') || identity.roles?.includes('operator')
  const entries = new Map()

  for (const app of [...applications].sort((a, b) => stamp(a) - stamp(b))) {
    if (app.status !== '已完成') continue
    const id = text(app.submission?.resourceId) || text(app.snapshot?.resourceId)
    if (!id || !['KB-02', 'KB-03', 'KB-05'].includes(app.ticketType)) continue
    const fields = app.submission?.fields ?? {}
    let entry = entries.get(id)
    if (!entry && app.ticketType === 'KB-02') {
      entry = blankEntry(id)
      entries.set(id, entry)
    }
    if (!entry) continue
    if (app.ticketType === 'KB-02') {
      entry.name = text(fields.name) || entry.name
      entry.source = text(fields.sourceSystem) || entry.source
      entry.summary = text(fields.description) || text(fields.purpose) || entry.summary
      entry.shareMode = text(fields.shareMode) || entry.shareMode
      entry.ownerAccount = text(app.account) || entry.ownerAccount
      entry.org = text(app.org) || entry.org
      entry.targetOrgs = list(fields.targetOrgs)
      entry.targetAccounts = list(fields.targetAccounts)
      entry.boundaryOrgs = list(fields.boundaryOrgs)
      entry.methods = methodsFrom(fields)
      entry.unavailable = false
      entry.ticketNo = app.ticketNo
    }
    if (app.ticketType === 'KB-03' && text(app.account)) {
      entry.grantedAccounts = [...new Set([...entry.grantedAccounts, app.account])]
      const granted = text(fields.permission)
      if (usageMethods.includes(granted) && !entry.methods.includes(granted)) entry.methods.push(granted)
    }
    if (app.ticketType === 'KB-05') {
      const actions = list(app.approvedFields?.['处置动作'] ?? fields.dispositionActions)
      const whole = actions.includes('目录下架') || fields.target === '整个知识库' || fields.target === '知识库'
      if (whole) {
        entry.unavailable = true
        entry.ticketNo = app.ticketNo
      }
    }
  }

  for (const item of catalogItems ?? []) {
    const id = text(item?.resourceId)
    if (!id) continue
    const status = text(item.status)
    let entry = entries.get(id)
    if (!entry && (sharedStatuses.has(status) || unavailableStatuses.has(status))) {
      entry = blankEntry(id)
      entry.shareMode = sharedStatuses.has(status) ? '共享目录' : ''
      entries.set(id, entry)
    }
    if (entry) applyCatalog(entry, item)
  }

  const canUse = entry => {
    if (entry.unavailable) return false
    if (entry.ownerAccount === identity.account) return true
    if (entry.shareMode === '共享目录') return true
    if (entry.shareMode === '指定组织' && entry.targetOrgs.includes(identity.org)) return true
    if (entry.shareMode === '指定人员' && entry.targetAccounts.includes(identity.account)) return true
    return entry.grantedAccounts.includes(identity.account)
  }

  let visible = [...entries.values()]
  if (!staff) {
    visible = visible.filter(entry => {
      if (entry.unavailable) return false
      if (entry.boundaryOrgs.length && !entry.boundaryOrgs.includes(identity.org) && entry.ownerAccount !== identity.account) return false
      return true
    })
  }

  const q = (query.get('q') ?? '').trim().toLowerCase()
  const usable = query.get('usable') ?? '全部'
  const method = query.get('method') ?? '全部方式'
  const items = visible.filter(entry => {
    if (q && ![entry.name, entry.id, entry.summary, entry.source, entry.shareMode].join(' ').toLowerCase().includes(q)) return false
    const direct = canUse(entry)
    if (usable === '可直接使用' && !direct) return false
    if (usable === '暂不可用' && !entry.unavailable) return false
    if (method !== '全部方式' && !entry.methods.includes(method)) return false
    return true
  }).map(entry => ({
    id: entry.id,
    name: entry.name,
    source: entry.source,
    summary: entry.summary,
    shareMode: entry.shareMode,
    methods: entry.methods,
    directlyUsable: canUse(entry),
    unavailable: entry.unavailable,
    downloadCount: entry.downloadCount,
    org: entry.org,
    ticketNo: staff ? entry.ticketNo : '',
  }))

  const ranking = visible
    .filter(entry => !entry.unavailable)
    .map(entry => ({id: entry.id, name: entry.name, source: entry.source, count: entry.downloadCount}))
    .sort((a, b) => {
      if (a.count === null && b.count === null) return a.name.localeCompare(b.name, 'zh-CN')
      if (a.count === null) return 1
      if (b.count === null) return -1
      return b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')
    })
    .slice(0, 5)

  const knownCounts = visible.map(entry => entry.downloadCount).filter(count => count !== null)
  return {
    asOf: new Date(now).toISOString(),
    role: identity.roles?.includes('admin') ? 'admin' : identity.roles?.includes('operator') ? 'ops' : 'user',
    org: identity.org ?? '',
    metrics: {
      total: visible.length,
      usableCount: visible.filter(canUse).length,
      unavailableCount: visible.filter(entry => entry.unavailable).length,
      downloadCount: knownCounts.length ? knownCounts.reduce((sum, count) => sum + count, 0) : null,
    },
    ranking,
    items,
  }
}
