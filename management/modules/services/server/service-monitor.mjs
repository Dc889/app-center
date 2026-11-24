import {digest} from '../../../../runtime/http.mjs'

const WINDOW_MS = 5 * 60 * 1000

export function restartTicketNo(service, now) {
  const windowId = Math.floor(now / WINDOW_MS)
  return 'SVC-01-' + digest([service.product, service.project || '', service.service, service.containerId, String(windowId)].join('\0')).slice(0, 40)
}

function summary(row) {
  return {
    ticketNo: row.ticketNo,
    product: row.submission.fields?.['产品'] ?? null,
    service: row.submission.fields?.['服务名'] ?? null,
    containerName: row.submission.fields?.['容器名'] ?? null,
    status: row.status,
    approvalMode: row.approvalMode,
    at: row.finishedAt ?? row.history?.at(-1)?.at ?? null,
    failureReason: row.execution?.result?.failureReason ?? null,
  }
}

export async function restartUnavailableServices({services, applications, restart, now, enabled}) {
  if (!enabled) return []
  const results = []
  for (const service of services) {
    if (service.status !== '不可用' || !service.restartable || !/^[a-f0-9]{12,64}$/.test(service.containerId)) continue
    const ticketNo = restartTicketNo(service, now)
    const existing = applications.serviceRestart(ticketNo)
    if (existing && ['已完成', '执行失败'].includes(existing.status)) {
      results.push(summary(existing))
      continue
    }
    const at = new Date(now).toISOString()
    const base = {
      ticketNo,
      ticketType: 'SVC-01',
      ticketTypeVersion: '1',
      account: 'system_event',
      org: '系统服务',
      creationMode: '系统巡检',
      approvalMode: '自动审批',
      submission: {
        resourceId: `${service.product}:${service.service}`,
        workspaceId: service.project || '未采集',
        fields: {
          '产品': service.product,
          '服务名': service.service,
          '容器名': service.containerName,
          '容器ID': service.containerId,
          'Compose项目': service.project,
        },
      },
      snapshot: {snapshotId: 'svc-' + service.containerId, fields: {}},
      preconditions: [],
      status: '执行中',
      revision: existing ? existing.revision + 1 : 1,
      finishedAt: null,
      execution: null,
      history: [...(existing?.history ?? []), {at, actor: 'system_event', action: existing ? '继续自动重启' : '系统创建重启工单并自动审批'}],
    }
    const started = applications.saveServiceRestart(base)
    let execution
    try {
      await restart(service.containerId)
      execution = {status: 'succeeded', result: {ok: true, failureCode: null, failureReason: null, retryable: false}}
    } catch (error) {
      execution = {status: 'failed', result: {ok: false, failureCode: error.code || 'RESTART_FAILED', failureReason: error.message || '重启失败', retryable: false}}
    }
    const finishedAt = new Date(now).toISOString()
    const saved = applications.saveServiceRestart({
      ...started,
      status: execution.status === 'succeeded' ? '已完成' : '执行失败',
      revision: started.revision + 1,
      finishedAt,
      execution,
      history: [...started.history, {at: finishedAt, actor: 'system_event', action: execution.status === 'succeeded' ? '自动重启完成' : '自动重启失败', note: execution.result.failureReason || ''}],
    })
    results.push(summary(saved))
  }
  return results
}

function productBlock(services, availability) {
  if (availability !== 'collected') return {running: null, unavailable: null, services: []}
  return {
    running: services.filter(item => item.status === '运行中').length,
    unavailable: services.filter(item => item.status === '不可用').length,
    services,
  }
}

export function serviceMonitorReport({probe, actions, now, enabled, tickets, host = null}) {
  const collected = probe.availability === 'collected'
  const dify = probe.services.filter(item => item.product === 'Dify')
  const ragflow = probe.services.filter(item => item.product === 'RAGFlow')
  const history = (tickets ?? []).filter(row => row.ticketType === 'SVC-01').map(summary).slice(-20).reverse()
  return {
    availability: probe.availability,
    reason: probe.reason,
    checkedAt: new Date(now).toISOString(),
    autoRestart: enabled,
    host: host ?? {availability: 'not_collected', hostname: null, cpuPercent: null, memory: null, storage: null},
    products: {
      Dify: productBlock(dify, probe.availability),
      RAGFlow: productBlock(ragflow, probe.availability),
    },
    restarts: collected ? actions : [],
    history,
    emptyNote: collected ? '已巡检，当前没有发现该产品的容器' : null,
  }
}
