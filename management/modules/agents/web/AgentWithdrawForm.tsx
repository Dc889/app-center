import { ApplicationDrafts, useApplicationDraft } from '../../../platform/workflow/public.web'
import { submissionGaps, readyToSubmit } from '../../../shared-ui/form-check'
import { useEffect, useRef, useState } from 'react'
import { ResourcePicker } from '../../../shared-ui/ResourcePicker'
import { useResourceSnapshot } from '../../../shared-ui/useResourceSnapshot'
import { AgentReplacementPicker } from './AgentReplacementPicker'
import { AgentImpactPanel } from './AgentImpactPanel'
import type { AgentImpact } from './AgentImpactPanel'

export function AgentWithdrawForm({ ticketType = 'AG-05' }: { ticketType?: 'AG-04' | 'AG-05' }) {
  const [fields, setFields] = useState({
    resourceId: '',
    workspaceId: '',
    reason: '主动下架',
    explanation: '',
    effectiveAt: '',
    replacementAppId: '',
  })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const resource = useResourceSnapshot()
  const [original, setOriginal] = useState<Record<string, unknown> | null>(null)
  const [impact, setImpact] = useState<AgentImpact | null>(null)
  const [pickerKey, setPickerKey] = useState(0)
  const [replacementVerified, setReplacementVerified] = useState(false)
  const [replacementKey, setReplacementKey] = useState(0)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => { controller.current?.abort() }, [])

  const action = ticketType === 'AG-04' ? 'republish' : 'withdraw_app'
  const draft = useApplicationDraft(ticketType, fields, (value) => {
    setFields(value)
    setImpact(null)
    setReplacementVerified(false)
    setReplacementKey((k) => k + 1)
    setOriginal(null)
    resource.reset()
    controller.current?.abort()
    setPickerKey((k) => k + 1)
    setMessage('')
  })
  const { ticketNo } = draft

  const gaps = () => submissionGaps([
    ['仓库应用 ID', original && resource.snapshot ? fields.resourceId : ''],
    ['原因说明', fields.explanation],
    ...(ticketType === 'AG-04' ? [] : [['生效时间', fields.effectiveAt]] as [string, string][]),
    ['完整影响依据', impact && impact.dependencies.state === 'collected' && (ticketType === 'AG-04' || (impact.grants.state === 'collected' && impact.keys.state === 'collected')) ? '已采集' : ''],
  ])

  async function read(value: { resourceId: string; workspaceId: string }) {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setBusy(true)
    setOriginal(null)
    setImpact(null)
    setMessage('')
    try {
      const r = await fetch('/api/catalog/agent/' + encodeURIComponent(value.resourceId) + '?action=' + action, {
        signal: request.signal,
      })
      const data = await r.json()
      const d = data.data
      if (!r.ok) throw Error(data.error?.message ?? '目录依据读取失败')
      if (
        data.resourceId !== value.resourceId ||
        !d ||
        d.workspaceId !== value.workspaceId ||
        typeof d.appId !== 'string' ||
        !d.appId ||
        !Array.isArray(data.actions) ||
        !data.actions.includes(action) ||
        !(action === 'republish' ? ['active', 'unavailable', 'withdrawn'] : ['active', 'unavailable']).includes(data.status)
      ) {
        throw Error('当前目录不允许此管理操作，或资源范围已变化')
      }
      if (ticketType === 'AG-04' && !['publicationVersionId', 'workflowSnapshotId', 'policyRef'].every((k) => typeof d[k] === 'string' && d[k])) {
        throw Error('目录缺少原发布版本、工作流或授权依据')
      }
      const snapshot = await resource.read('dify_app', d.appId, value.workspaceId)
      if (request.signal.aborted || !snapshot) return
      if (
        typeof snapshot.data.publicationVersionId !== 'string' ||
        !snapshot.data.publicationVersionId ||
        !Number.isInteger(snapshot.data.catalogRevision) ||
        (ticketType === 'AG-04' && (typeof snapshot.data.workflowSnapshotId !== 'string' || !snapshot.data.workflowSnapshotId))
      ) {
        throw Error('应用快照缺少新发布版本、工作流或目录修订')
      }
      const impactResponse = await fetch(
        '/api/agent-impact?' + new URLSearchParams({ resourceId: value.resourceId, workspaceId: value.workspaceId, action }),
        { signal: request.signal }
      )
      const evidence = await impactResponse.json()
      if (!impactResponse.ok) throw Error(evidence.error?.message ?? '影响依据读取失败')
      if (
        evidence.impact?.resourceId !== value.resourceId ||
        evidence.impact?.appId !== d.appId ||
        evidence.impact?.workspaceId !== value.workspaceId ||
        evidence.publicationVersionId !== snapshot.data.publicationVersionId ||
        evidence.catalogRevision !== snapshot.data.catalogRevision ||
        evidence.workflowSnapshotId !== (snapshot.data.workflowSnapshotId ?? null)
      ) {
        throw Error('影响依据与所选应用版本不匹配')
      }
      if (!request.signal.aborted) {
        setImpact(evidence.impact)
        setOriginal({ appId: d.appId, publicationVersionId: d.publicationVersionId, workflowSnapshotId: d.workflowSnapshotId })
      }
    } catch (error) {
      if (!request.signal.aborted) setMessage(error instanceof Error ? error.message : '目录依据读取失败')
    } finally {
      if (!request.signal.aborted) setBusy(false)
    }
  }

  async function submit() {
    const gap = gaps()
    if (gap) {
      setMessage(gap)
      return
    }
    setBusy(true)
    try {
      const response = await draft.submit('/api/applications', {
        ticketNo,
        ticketType,
        resourceId: fields.resourceId,
        workspaceId: fields.workspaceId,
        fields: {
          reason: fields.reason,
          explanation: fields.explanation,
          changeDescription: fields.explanation,
          effectiveAt: ticketType === 'AG-04' ? '' : (fields.effectiveAt ? new Date(fields.effectiveAt).toISOString() : ''),
          replacementAppId: ticketType === 'AG-05' && replacementVerified ? fields.replacementAppId : '',
        },
      })
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo + ' · ' + data.status)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="form-section" disabled={busy || resource.busy || draft.controller.busy}>
      <legend>{ticketType === 'AG-04' ? '智能体变更再发布申请 (AG-04)' : '智能体下架申请 (AG-05)'}</legend>
      <ResourcePicker
        key={'source:' + pickerKey}
        kind="agent"
        catalogAction={action}
        value={fields}
        onChange={(value, verified) => {
          controller.current?.abort()
          resource.reset()
          setFields((current) => ({ ...current, ...value }))
          setImpact(null)
          setReplacementVerified(false)
          setReplacementKey((key) => key + 1)
          setOriginal(null)
          setMessage('')
          if (verified) void read(value)
        }}
      />
      <div className="form-row">
        <label>
          来源工作区
          <input aria-label="来源工作区" readOnly value={fields.workspaceId} />
        </label>
        <label>
          Dify应用 ID
          <input aria-label="Dify应用 ID" readOnly value={String(original?.appId ?? '')} />
        </label>
      </div>
      {original && ticketType === 'AG-04' && (
        <div className="detail-callout">
          原发布版本 · {String(original.publicationVersionId)} · 原工作流 · {String(original.workflowSnapshotId)}
          <br />
          新发布版本 · {String(resource.snapshot?.data.publicationVersionId)} · 新工作流 · {String(resource.snapshot?.data.workflowSnapshotId)}
        </div>
      )}
      {impact && <AgentImpactPanel impact={impact} />}
      <label className="full-width">
        原因说明
        <input
          value={fields.explanation}
          onChange={(e) => setFields((prev) => ({ ...prev, explanation: e.target.value }))}
        />
      </label>
      {ticketType === 'AG-05' && (
        <div className="form-row">
          <label>
            下架原因
            <select value={fields.reason} onChange={(e) => setFields((prev) => ({ ...prev, reason: e.target.value }))}>
              {['主动下架', '版本替换', '安全事件', '长期故障', '其他'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            生效时间
            <input
              type="datetime-local"
              value={fields.effectiveAt}
              onChange={(e) => setFields((prev) => ({ ...prev, effectiveAt: e.target.value }))}
            />
          </label>
        </div>
      )}
      {ticketType === 'AG-05' && (
        <AgentReplacementPicker
          key={'replacement:' + replacementKey}
          sourceResourceId={fields.resourceId}
          value={fields.replacementAppId}
          enabled={!!original && !!resource.snapshot}
          onChange={(val, verified) => {
            setFields((prev) => ({ ...prev, replacementAppId: val }))
            setReplacementVerified(verified)
          }}
        />
      )}
      <div className="form-submit-row">
        <button className="primary-button" onClick={submit}>
          {ticketType === 'AG-04' ? '提交再发布审批' : '提交下架审批'}
        </button>
        <button className="secondary-button" onClick={() => setMessage(gaps() || readyToSubmit)}>
          检查
        </button>
      </div>
      <ApplicationDrafts draft={draft.controller} />
      <p role="status">{resource.error || message}</p>
    </fieldset>
  )
}
