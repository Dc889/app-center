type Doc = {documentId: string; sha256: string; autoVerdict: string}
type ConfirmedDoc = {documentId: string; sha256: string; verdict: string; actor: string; at: string}

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
  return (
    <fieldset disabled={disabled}>
      <legend>文档安全复核</legend>
      {documents.map(d => (
        <label key={d.documentId}>
          <input
            type="checkbox"
            disabled={d.autoVerdict !== '通过'}
            checked={
              !disabled
                ? confirmed.includes(JSON.stringify([d.documentId, d.sha256]))
                : !!approvedRecords?.some(c => c.documentId === d.documentId && c.sha256 === d.sha256 && c.verdict === '通过')
            }
            onChange={e => {
              const key = JSON.stringify([d.documentId, d.sha256])
              onChangeConfirmed(values => e.target.checked ? [...values, key] : values.filter(v => v !== key))
            }}
          />
          {d.documentId} · {d.sha256} · 自动结论 {d.autoVerdict}
        </label>
      ))}
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
