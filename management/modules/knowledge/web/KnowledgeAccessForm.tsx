import { ApplicationDrafts, useApplicationDraft } from '../../../platform/workflow/public.web'
import { submissionGaps, readyToSubmit } from '../../../shared-ui/form-check'
import { useEffect, useRef, useState } from 'react'
import { KnowledgeBindingPicker } from './KnowledgeBindingPicker'
import type { BindingCandidate } from './KnowledgeBindingPicker'
import { ApplicationTargetPicker } from '../../agents/public.web'

export function KnowledgeAccessForm() {
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
  const [datasetCandidate, setDatasetCandidate] = useState<BindingCandidate | null>(null)
  const [selection, setSelection] = useState<{ resourceId: string; workspaceId: string } | null>(null)
  const [targetVerified, setTargetVerified] = useState(false)
  const [targetKey, setTargetKey] = useState(0)
  const [pickerKey, setPickerKey] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => { controller.current?.abort() }, [])

  const draft = useApplicationDraft('KB-03', fields, (value) => {
    setFields(value)
    setDatasetCandidate(null)
    setSelection(null)
    setTargetVerified(false)
    setTargetKey((k) => k + 1)
    setPickerKey((k) => k + 1)
    controller.current?.abort()
    setContext(null)
    setMessage('')
  })
  const { ticketNo } = draft

  const selected = selection?.resourceId === fields.resourceId && selection?.workspaceId === fields.workspaceId

  const gaps = () => submissionGaps([
    ['目录知识库 ID', selected ? fields.resourceId : ''],
    ['工作区 ID', fields.workspaceId],
    ['使用目的', fields.purpose],
    ['使用开始时间', fields.startsAt],
    ['使用截止时间', fields.expiresAt],
    ['当前资源依据', context ? '已读取' : ''],
    ['目标应用核验', !fields.targetAppId || targetVerified ? '已核验' : ''],
  ])

  async function readContext(targetAppId?: string) {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setBusy(true)
    setContext(null)
    setMessage('')
    try {
      const params = new URLSearchParams({
        ticketType: 'KB-03',
        action: 'bind_dataset',
        resourceId: fields.resourceId,
        workspaceId: fields.workspaceId,
        permission: fields.permission,
      })
      const appId = targetAppId ?? fields.targetAppId
      if (appId) params.set('targetAppId', appId)
      const res = await fetch('/api/execution-contexts?' + params, { signal: request.signal })
      const data = await res.json()
      if (!res.ok) throw Error(data.error?.message ?? '读取知识库依据失败')
      if (
        !datasetCandidate ||
        data.resourceId !== fields.resourceId ||
        data.eligible !== true ||
        data.fields?.['目标Dify workspace ID'] !== fields.workspaceId ||
        data.fields?.['目录来源'] !== datasetCandidate.source ||
        data.fields?.['来源系统'] !== datasetCandidate.sourceSystem ||
        data.fields?.['源workspace/tenant ID'] !== datasetCandidate.sourceScopeId ||
        data.fields?.['源知识库ID'] !== datasetCandidate.sourceResourceId ||
        data.fields?.['源所有者账户名'] !== datasetCandidate.ownerAccount
      ) {
        throw Error('绑定依据与所选知识库来源不匹配，请重新选择')
      }
      if (!request.signal.aborted) setContext(data.fields)
    } catch (e) {
      if (!request.signal.aborted) setMessage(e instanceof Error ? e.message : '读取知识库依据失败')
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
        ticketType: 'KB-03',
        resourceId: fields.resourceId,
        workspaceId: fields.workspaceId,
        fields: {
          purpose: fields.purpose,
          permission: fields.permission,
          targetAppId: fields.targetAppId,
          startsAt: fields.startsAt ? new Date(fields.startsAt).toISOString() : '',
          expiresAt: fields.expiresAt ? new Date(fields.expiresAt).toISOString() : '',
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

  return (
    <fieldset className="form-section" disabled={busy || draft.controller.busy}>
      <legend>知识库使用授权申请 (KB-03)</legend>
      <KnowledgeBindingPicker
        key={pickerKey}
        value={fields}
        permission={fields.permission}
        onChange={(val, row) => {
          controller.current?.abort()
          setFields((current) => ({ ...current, ...val }))
          setTargetVerified(false)
          setTargetKey((key) => key + 1)
          setDatasetCandidate(row)
          setSelection(row ? val : null)
          setContext(null)
          setMessage('')
        }}
      />
      {datasetCandidate && (
        <p>已匹配目录知识库 · {datasetCandidate.name}</p>
      )}
      <label>
        使用目的
        <input
          value={fields.purpose}
          onChange={(e) => setFields((prev) => ({ ...prev, purpose: e.target.value }))}
          placeholder="说明检索或编排接入业务"
        />
      </label>
      <label>
        授权类型
        <select
          value={fields.permission}
          onChange={(e) => {
            setFields((prev) => ({ ...prev, permission: e.target.value }))
            setContext(null)
          }}
        >
          <option>检索使用</option>
          <option>编排使用</option>
        </select>
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
      <ApplicationTargetPicker
        key={targetKey + ':' + fields.workspaceId}
        purpose="dataset_binding"
        workspaceId={fields.workspaceId}
        value={fields.targetAppId}
        enabled={!!selected}
        onChange={(value, verified) => {
          setFields((current) => ({ ...current, targetAppId: value }))
          setTargetVerified(verified)
          setContext(null)
          if (verified) void readContext(value)
        }}
      />
      <button className="secondary-button" disabled={!selected} onClick={() => void readContext()}>
        读取绑定依据
      </button>
      {context && (
        <fieldset>
          <legend>知识库绑定依据</legend>
          {Object.entries(context)
            .filter(([key]) => key !== 'policyRef')
            .map(([key, value]) => (
              <label key={key}>
                {key}
                <textarea
                  aria-label={key}
                  readOnly
                  value={typeof value === 'string' ? value : JSON.stringify(value)}
                />
              </label>
            ))}
        </fieldset>
      )}
      <button className="primary-button" onClick={submit}>
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
