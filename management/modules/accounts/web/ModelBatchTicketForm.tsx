import {useEffect, useState} from 'react'
import {FormField} from '../../../shared-ui/UiPrimitives'

type UniqueModel = {
  key: string
  providerName: string
  modelName: string
  modelType: string
  configuredWorkspacesCount: number
  enabledWorkspacesCount: number
  totalWorkspacesCount: number
  monthlyTokens: number
  monthlyCalls: number
}

type WorkspaceOption = {
  workspaceId: string
  workspaceName: string
  ownerName: string
  org: string
  modelsCount: number
}

type BatchTicket = {
  ticketNo: string
  operationType: string
  providerName: string | null
  modelName: string | null
  modelType: string | null
  endpointUrl: string | null
  targetWorkspaceName: string | null
  reason: string
  applicantName: string
  status: string
  createdAt: string
  executionSummary: string | null
  reviewNote: string | null
}

type BatchData = {
  canApprove: boolean
  uniqueModels: UniqueModel[]
  workspaces: WorkspaceOption[]
  templates: {providerName: string; modelName: string; endpointUrl: string}[]
  tickets: BatchTicket[]
}

function statusTone(status: string) {
  if (status === '已完成') return 'tone-success'
  if (status === '执行失败' || status === '已驳回') return 'tone-danger'
  return 'tone-pending'
}

export function ModelBatchTicketForm() {
  const [data, setData] = useState<BatchData | null>(null)
  const [operationType, setOperationType] = useState<'全员统一配置模型' | '新户默认配齐公共模型' | '全员统一删除模型' | '全员批量禁用模型' | '全员批量启用模型'>('全员统一配置模型')
  const [providerName, setProviderName] = useState('langgenius/openai_api_compatible/openai_api_compatible')
  const [modelName, setModelName] = useState('')
  const [modelType, setModelType] = useState('text-generation')
  const [displayName, setDisplayName] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [contextSize, setContextSize] = useState('8192')
  const [maxTokens, setMaxTokens] = useState('4096')
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    fetch('/api/model-batch', {signal: c.signal})
      .then(async r => (r.ok ? r.json() : null))
      .then((res: BatchData | null) => {
        if (!res || c.signal.aborted) return
        setData(res)
        let prefill: any = null
        try {
          const raw = sessionStorage.getItem('mod02-prefill')
          if (raw) {
            prefill = JSON.parse(raw)
            sessionStorage.removeItem('mod02-prefill')
          }
        } catch {}
        if (prefill?.operationType) setOperationType(prefill.operationType)
        if (prefill?.modelKey) setSelectedModelKey(prefill.modelKey)
        else if (!selectedModelKey && res.uniqueModels?.[0]) setSelectedModelKey(res.uniqueModels[0].key)
        if (prefill?.targetWorkspaceId) setTargetWorkspaceId(prefill.targetWorkspaceId)
        else if (!targetWorkspaceId && res.workspaces?.[0]) setTargetWorkspaceId(res.workspaces[0].workspaceId)
      })
      .catch(() => {})
    return () => c.abort()
  }, [rev])

  const selectedModel = data?.uniqueModels.find(m => m.key === selectedModelKey) ?? null
  const selectedWs = data?.workspaces.find(w => w.workspaceId === targetWorkspaceId) ?? null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (operationType === '全员统一配置模型') {
      if (!providerName.trim() || !modelName.trim()) { setErr('请填写供应商与模型名称'); return }
      if (!/^https?:\/\//i.test(endpointUrl.trim())) { setErr('请填写以 http:// 或 https:// 开头的模型 API 地址'); return }
    } else if (operationType === '新户默认配齐公共模型') {
      if (!targetWorkspaceId) { setErr('请选择目标租户工作区'); return }
    } else {
      if (!selectedModel) { setErr('请选择目标模型'); return }
    }
    if (!reason.trim()) { setErr('请输入申请原因'); return }

    setBusy(true)
    try {
      const payload = operationType === '全员统一配置模型'
        ? {
            operationType,
            providerName: providerName.trim(),
            modelName: modelName.trim(),
            modelType,
            displayName: displayName.trim() || modelName.trim(),
            endpointUrl: endpointUrl.trim(),
            apiKey: apiKey.trim(),
            contextSize: contextSize.trim() || '8192',
            maxTokens: maxTokens.trim() || '4096',
            reason: reason.trim(),
          }
        : operationType === '新户默认配齐公共模型'
        ? {
            operationType,
            targetWorkspaceId,
            targetWorkspaceName: selectedWs?.workspaceName,
            reason: reason.trim(),
          }
        : {
            operationType,
            providerName: selectedModel?.providerName,
            modelName: selectedModel?.modelName,
            modelType: selectedModel?.modelType,
            reason: reason.trim(),
          }

      const r = await fetch('/api/model-batch/request', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(payload),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.message || body?.error?.message || '工单提交失败')
      setMsg(`模型批量管控工单 ${body.ticket?.ticketNo} 已提交，请在「租户与模型监控」由系统管理员审批后统一生效`)
      setReason('')
      setApiKey('')
      setRev(n => n + 1)
    } catch (e: any) {
      setErr(e?.message || '工单提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="mod-02-form" className="org-page-stack">
      <form onSubmit={submit} className="form-section">
        <div className="section-heading">
          <span>02</span>
          <div><h4>全员模型批量配置与下线</h4></div>
        </div>

        <div className="form-row">
          <FormField label="批量操作类型" source="用户" required>
            <select value={operationType} onChange={e => setOperationType(e.target.value as any)}>
              <option value="全员统一配置模型">全员统一配置并下发模型</option>
              <option value="新户默认配齐公共模型">新户默认配齐内网公共模型</option>
              <option value="全员统一删除模型">全员统一删除下线模型</option>
              <option value="全员批量禁用模型">全员批量禁用指定模型</option>
              <option value="全员批量启用模型">全员批量启用指定模型</option>
            </select>
          </FormField>

          {operationType === '新户默认配齐公共模型' && (
            <FormField label="目标租户工作区" source="用户" required>
              <select value={targetWorkspaceId} onChange={e => setTargetWorkspaceId(e.target.value)} required>
                <option value="">请选择目标工作区</option>
                {(data?.workspaces ?? []).map(w => (
                  <option key={w.workspaceId} value={w.workspaceId}>
                    {w.workspaceName} · {w.ownerName} · 已配 {w.modelsCount} 个模型
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {['全员统一删除模型', '全员批量禁用模型', '全员批量启用模型'].includes(operationType) && (
            <FormField label="目标模型" source="用户" required>
              <select value={selectedModelKey} onChange={e => setSelectedModelKey(e.target.value)} required>
                <option value="">请选择目标模型</option>
                {(data?.uniqueModels ?? []).map(m => (
                  <option key={m.key} value={m.key}>
                    {m.modelName} · {m.modelType} · 覆盖 {m.configuredWorkspacesCount}/{m.totalWorkspacesCount} 租户
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </div>

        {operationType === '全员统一配置模型' && (
          <>
            <div className="form-row">
              <FormField label="模型供应商标识" source="用户" required>
                <input
                  value={providerName}
                  onChange={e => setProviderName(e.target.value)}
                  required
                  placeholder="langgenius/openai_api_compatible/openai_api_compatible"
                />
              </FormField>
              <FormField label="模型名称" source="用户" required>
                <input value={modelName} onChange={e => setModelName(e.target.value)} required placeholder="例如 qwen2.5-72b-instruct" />
              </FormField>
            </div>

            <div className="form-row">
              <FormField label="模型类型" source="用户" required>
                <select value={modelType} onChange={e => setModelType(e.target.value)}>
                  <option value="text-generation">对话与文本生成 · text-generation</option>
                  <option value="text-embedding">向量嵌入 · text-embedding</option>
                  <option value="rerank">检索重排 · rerank</option>
                  <option value="speech2text">语音转文本 · speech2text</option>
                  <option value="tts">语音合成 · tts</option>
                </select>
              </FormField>
              <FormField label="展示名称" source="用户">
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="留空则默认与模型名称一致" />
              </FormField>
            </div>

            <div className="form-row">
              <FormField label="内网 API 地址" source="用户" required>
                <input value={endpointUrl} onChange={e => setEndpointUrl(e.target.value)} required placeholder="例如 http://192.168.2.101:3000/v1" />
              </FormField>
              <FormField label="API Key 凭证" source="用户">
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="审批时将按各租户独立 RSA 公钥自动加密写入 Dify" />
              </FormField>
            </div>

            <div className="form-row">
              <FormField label="上下文窗口大小" source="用户">
                <input type="number" value={contextSize} onChange={e => setContextSize(e.target.value)} />
              </FormField>
              <FormField label="最大输出 Token" source="用户">
                <input type="number" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} />
              </FormField>
            </div>
          </>
        )}

        {data && (
          <div className="app-audit-card" style={{marginTop: 4}}>
            <div className="app-audit-metrics">
              <div><span>纳管租户工作区</span><strong>{data.workspaces.length}</strong></div>
              <div><span>在用模型种类</span><strong>{data.uniqueModels.length}</strong></div>
              <div><span>已登记公共模型模板</span><strong>{data.templates.length}</strong></div>
              <div><span>累计批量工单</span><strong>{data.tickets.length}</strong></div>
            </div>
          </div>
        )}

        <FormField label="申请原因" source="用户" required>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} required placeholder="请说明全员模型上线、新户配齐或统一删除下线依据" />
        </FormField>

        {err && <p role="alert" style={{color: '#b42318', fontSize: 13, margin: 0}}>{err}</p>}
        {msg && <p role="status" style={{color: '#027a48', fontSize: 13, fontWeight: 500, margin: 0}}>{msg}</p>}

        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在提交…' : '提交全员模型管控工单'}
          </button>
        </div>
      </form>

      {data && data.tickets.length > 0 && (
        <section className="form-section">
          <div className="section-heading">
            <span>03</span>
            <div><h4>全员模型批量管控记录</h4></div>
          </div>
          <div className="org-table-wrap">
            <table className="org-table">
              <thead>
                <tr><th>工单号</th><th>操作类型</th><th>目标对象</th><th>申请原因</th><th>状态</th><th>执行结果</th></tr>
              </thead>
              <tbody>
                {data.tickets.slice(0, 10).map(t => (
                  <tr key={t.ticketNo}>
                    <td><code className="org-code">{t.ticketNo}</code></td>
                    <td>{t.operationType}</td>
                    <td>{t.targetWorkspaceName || t.modelName || '-'}</td>
                    <td>{t.reason}</td>
                    <td><span className={`app-status-pill ${statusTone(t.status)}`}>{t.status}</span></td>
                    <td>{t.executionSummary || t.reviewNote || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
