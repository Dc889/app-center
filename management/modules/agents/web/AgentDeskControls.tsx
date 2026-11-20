export function AgentDisposalScopeField({
  value,
  onChange,
  disabled,
}: {
  value: string[]
  onChange: (val: string[]) => void
  disabled?: boolean
}) {
  return (
    <label>
      处置范围
      <select
        multiple
        value={value}
        disabled={disabled}
        onChange={e => onChange(Array.from(e.target.selectedOptions, o => o.value))}
      >
        {['仓库下架', '撤销访问授权', '撤销登记密钥'].map(s => (
          <option key={s}>{s}</option>
        ))}
      </select>
    </label>
  )
}

export function AgentRiskDecisionField({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      确认风险并继续审批
    </label>
  )
}
