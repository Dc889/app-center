type MatchedRule = {
  ruleId?: string
  category?: string
  severity?: string
  pattern: string
  note?: string
}

type Doc = {
  documentId: string
  name?: string
  sha256: string
  scannedChunks?: number
  autoVerdict: string
  matchedRules?: MatchedRule[]
}
type ConfirmedDoc = {documentId: string; sha256: string; verdict: string; actor: string; at: string}

function MatchedRulesBadges({doc}: {doc: Doc}) {
  const rules = Array.isArray(doc.matchedRules) ? doc.matchedRules : []
  if (rules.length > 0) {
    return (
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
        {rules.map((r, idx) => (
          <span
            key={`${r.ruleId || r.pattern}-${idx}`}
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              background: '#fee2e2',
              color: '#b42318',
              border: '1px solid #fecaca',
            }}
          >
            {r.severity || '阻断'} · {r.category || '敏感词'}：命中「{r.pattern}」
          </span>
        ))}
      </div>
    )
  }
  if (doc.autoVerdict !== '通过') {
    return <span style={{color: '#b42318', fontSize: 12, fontWeight: 500}}>自动安全扫描未通过，请驳回或要求整改</span>
  }
  return <span style={{color: '#027a48', fontSize: 12}}>未命中敏感词</span>
}

export function KnowledgeSecurityReviewFieldset({
  documents,
  confirmed,
  onChangeConfirmed,
  approvedRecords,
  disabled,
}: {
  documents: Doc[]
  confirmed: string[]
  onChangeConfirmed: (updater: (prev: string[]) => string[]) => void
  approvedRecords?: ConfirmedDoc[]
  disabled: boolean
}) {
  const failedCount = documents.filter(d => d.autoVerdict !== '通过').length
  return (
    <fieldset disabled={disabled} className="app-audit-card" style={{marginBlock: 12}}>
      <legend style={{fontWeight: 600, fontSize: 14, paddingInline: 6}}>
        逐文档安全审查清单（共 {documents.length} 篇{failedCount > 0 ? ` · ${failedCount} 篇命中敏感词阻断` : ' · 全部未命中敏感词'}）
      </legend>
      <div className="app-audit-table-wrap">
        <table className="app-audit-table">
          <thead>
            <tr>
              <th style={{width: 56}}>复核</th>
              <th>文档名称</th>
              <th>自动审查结论</th>
              <th>不通过原因 / 命中敏感词</th>
            </tr>
          </thead>
          <tbody>
            {documents.map(d => {
              const failed = d.autoVerdict !== '通过'
              const checked = !disabled
                ? confirmed.includes(JSON.stringify([d.documentId, d.sha256]))
                : !!approvedRecords?.some(c => c.documentId === d.documentId && c.sha256 === d.sha256 && c.verdict === '通过')
              return (
                <tr key={d.documentId} style={failed ? {background: '#fef2f2'} : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`确认通过 ${d.name || d.documentId}`}
                      disabled={failed}
                      checked={checked}
                      onChange={e => {
                        const key = JSON.stringify([d.documentId, d.sha256])
                        onChangeConfirmed(values => e.target.checked ? [...values, key] : values.filter(v => v !== key))
                      }}
                    />
                  </td>
                  <td>
                    <strong style={failed ? {color: '#b42318'} : undefined}>{d.name || d.documentId}</strong>
                    <div style={{fontSize: 11, color: '#64748b', fontFamily: 'monospace'}}>
                      {d.documentId} · sha256 {d.sha256.slice(0, 12)}
                      {d.scannedChunks !== undefined ? ` · 已扫 ${d.scannedChunks} 段` : ''}
                    </div>
                  </td>
                  <td>
                    <span className={`app-status-pill tone-${failed ? 'danger' : 'success'}`}>
                      {d.autoVerdict}
                    </span>
                  </td>
                  <td><MatchedRulesBadges doc={d} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </fieldset>
  )
}

export function KnowledgeChangesReviewFieldset({
  documents,
  documentVerdicts,
  onChangeVerdicts,
  reviewVerdict,
  onChangeReviewVerdict,
  approvedRecords,
  isTodoPending,
  disabled,
}: {
  documents: Doc[]
  documentVerdicts: Record<string, string>
  onChangeVerdicts: (updater: (prev: Record<string, string>) => Record<string, string>) => void
  reviewVerdict: string
  onChangeReviewVerdict: (val: string) => void
  approvedRecords?: ConfirmedDoc[]
  isTodoPending: boolean
  disabled: boolean
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>变更文档安全复核</legend>
      {documents.map(d => (
        <label key={d.documentId}>
          {d.documentId} · {d.sha256} · 自动结论 {d.autoVerdict}
          <select
            aria-label={'文档复核 ' + d.documentId}
            value={
              isTodoPending
                ? (documentVerdicts[JSON.stringify([d.documentId, d.sha256])] ?? '')
                : (approvedRecords?.find(c => c.documentId === d.documentId && c.sha256 === d.sha256)?.verdict ?? '')
            }
            onChange={e => onChangeVerdicts(prev => ({...prev, [JSON.stringify([d.documentId, d.sha256])]: e.target.value}))}
          >
            <option value="">尚未确认</option>
            <option disabled={d.autoVerdict !== '通过'}>通过</option>
            <option>不通过</option>
          </select>
        </label>
      ))}
      {isTodoPending && (
        <label>
          运维确认结论
          <select aria-label="运维确认结论" value={reviewVerdict} onChange={e => onChangeReviewVerdict(e.target.value)}>
            <option>通过</option>
            <option>不通过</option>
          </select>
        </label>
      )}
    </fieldset>
  )
}

export function KnowledgeDispositionFieldset({
  target,
  actions,
  onChangeActions,
  recoveryCondition,
  onChangeRecoveryCondition,
  disabled,
}: {
  target?: string
  actions: string[]
  onChangeActions: (updater: (prev: string[]) => string[]) => void
  recoveryCondition: string
  onChangeRecoveryCondition: (val: string) => void
  disabled: boolean
}) {
  const options = target === '指定文档'
    ? ['停用文档']
    : ['目录下架', '暂停分享', '停用文档', '撤销未到期授权']

  return (
    <fieldset disabled={disabled}>
      <legend>知识库处置决定</legend>
      {options.map(action => (
        <label key={action}>
          <input
            type="checkbox"
            checked={actions.includes(action)}
            onChange={e => onChangeActions(prev => e.target.checked ? [...prev, action] : prev.filter(a => a !== action))}
          />
          {action}
        </label>
      ))}
      <label>
        恢复条件
        <textarea value={recoveryCondition} onChange={e => onChangeRecoveryCondition(e.target.value)} />
      </label>
    </fieldset>
  )
}
