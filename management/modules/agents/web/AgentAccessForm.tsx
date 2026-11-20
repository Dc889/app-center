import { ApplicationDrafts, useApplicationDraft } from '../../../platform/workflow/public.web'
import { submissionGaps, readyToSubmit } from '../../../shared-ui/form-check'
import { useEffect, useRef, useState } from 'react'
import { ResourcePicker } from '../../../shared-ui/ResourcePicker'

export function AgentAccessForm() {
  const [fields, setFields] = useState({
    resourceId: '',
    workspaceId: '',
    purpose: '',
    startsAt: '',
    expiresAt: '',
    permission: '检索使用',
    targetAppId: '',
  })
  const [context, setContext] = useState<Record<string, unknown> | null>(null)
  const [usages, setUsages] = useState<string[]>(['run'])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<{ resourceId: string; workspaceId: string } | null>(null)
  const [pickerKey, setPickerKey] = useState(0)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => { controller.current?.abort() }, [])

  const draft = useApplicationDraft('AG-03', { ...fields, usages }, ({ usages: u, ...value }) => {
    setFields(value)
    setUsages(u)
    setSelection(null)
    setPickerKey((k) => k + 1)
    controller.current?.abort()
    setContext(null)
    setMessage('')
  })
  const { ticketNo } = draft

  const selected = selection?.resourceId === fields.resourceId && selection?.workspaceId === fields.workspaceId

  const gaps = () => submissionGaps([
    ['仓库应用 ID', selected ? fields.resourceId : ''],
    ['工作区 ID', fields.workspaceId],
    ['使用目的', fields.purpose],
    ['使用开始时间', fields.startsAt],
    ['使用截止时间', fields.expiresAt],
    ['当前资源依据', context ? '已读取' : ''],
    ['申请访问方式', usages.join(',')],
  ])

  async function readAgent(value: { resourceId: string; workspaceId: string }) {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setBusy(true)
    setContext(null)
    setMessage('')
    try {
      const r = await fetch('/api/catalog/agent/' + encodeURIComponent(value.resourceId), { signal: request.signal })
      const data = await r.json()
      const d = data.data
      if (!r.ok) throw Error(data.error?.message ?? '智能体依据读取失败')
      if (
        data.resourceId !== value.resourceId ||
        data.status !== 'active' ||
        !d ||
        d.workspaceId !== value.workspaceId ||
        typeof d.appId !== 'string' ||
        !d.appId ||
        !Array.isArray(d.usages) ||
        !d.usages.length ||
        !d.usages.every((usage: unknown) => typeof usage === 'string' && ['run', 'embed', 'api'].includes(usage))
      ) {
        throw Error('智能体目录详情与所选资源、工作区或使用方式不匹配')
      }
      if (!request.signal.aborted) {
        setContext({ appId: d.appId, workspaceId: d.workspaceId, usages: d.usages })
        setUsages((current) => current.filter((usage) => d.usages.includes(usage)))
      }
    } catch (error) {
      if (!request.signal.aborted) setMessage(error instanceof Error ? error.message : '智能体依据读取失败')
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
      const r = await draft.submit('/api/applications', {
        ticketNo,
        ticketType: 'AG-03',
        resourceId: fields.resourceId,
        workspaceId: fields.workspaceId,
        fields: {
          purpose: fields.purpose,
          permission: fields.permission,
          targetAppId: fields.targetAppId,
          startsAt: fields.startsAt ? new Date(fields.startsAt).toISOString() : '',
          expiresAt: fields.expiresAt ? new Date(fields.expiresAt).toISOString() : '',
          usages,
        },
      })
      const data = await r.json()
      if (!r.ok) throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo + ' · ' + data.status)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  const availableUsages = (context?.usages as string[] | undefined) ?? []

  return (
    <fieldset className="form-section" disabled={busy || draft.controller.busy}>
      <legend>智能体使用授权申请 (AG-03)</legend>
      <ResourcePicker
        key={pickerKey}
        kind="agent"
        value={fields}
        onChange={(val, verified) => {
          controller.current?.abort()
          setFields((prev) => ({ ...prev, ...val }))
          setSelection(verified ? val : null)
          setContext(null)
          setMessage('')
          if (verified) void readAgent(val)
        }}
      />
      <label>
        来源工作区
        <input aria-label="来源工作区" readOnly value={fields.workspaceId} />
      </label>
      <label>
        Dify应用 ID
        <input aria-label="Dify应用 ID" readOnly value={String(context?.appId ?? '')} />
      </label>
      <label>
        使用目的
        <input
          value={fields.purpose}
          onChange={(e) => setFields((prev) => ({ ...prev, purpose: e.target.value }))}
          placeholder="说明调用用途或接入业务"
        />
      </label>
      <label>
        使用开始时间
        <input
          type="datetime-local"
          value={fields.startsAt}
          onChange={(e) => setFields((prev) => ({ ...prev, startsAt: e.target.value }))}
        />
      </label>
      <label>
        使用截止时间
        <input
          type="datetime-local"
          value={fields.expiresAt}
          onChange={(e) => setFields((prev) => ({ ...prev, expiresAt: e.target.value }))}
        />
      </label>
      {context && (
        <fieldset>
          <legend>申请使用方式</legend>
          {([['run', '运行'], ['embed', '嵌入网站'], ['api', '访问 API']] as const).map(([code, name]) => {
            const available = availableUsages.includes(code)
            return (
              <label key={code}>
                <input
                  type="checkbox"
                  aria-label={name}
                  disabled={!available}
                  checked={usages.includes(code)}
                  onChange={(e) =>
                    setUsages((curr) => (e.target.checked ? [...curr, code] : curr.filter((u) => u !== code)))
                  }
                />
                {name} {!available && '(未开通)'}
              </label>
            )
          })}
        </fieldset>
      )}
      <button className="primary-button" disabled={!usages.length || !selected} onClick={submit}>
        提交使用授权
      </button>
      <button className="secondary-button" onClick={() => setMessage(gaps() || readyToSubmit)}>
        检查
      </button>
      <ApplicationDrafts draft={draft.controller} />
      <p role="status">{message}</p>
    </fieldset>
  )
}
