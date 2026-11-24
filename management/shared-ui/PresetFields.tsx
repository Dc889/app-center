import {useEffect, useId, useState} from 'react'

export const BUSINESS_LINE_PRESETS = ['刑侦', '经侦', '网安', '治安', '交警', '指挥中心', '综合法制', '平台运营']
export const TAG_PRESETS = ['刑侦', '法规', '研判', '摘要', '内部规范', '知识问答', '通用工具']
export const PERMISSION_PRESETS = ['读取文本', '知识库检索', '文档解析', '外部HTTP请求', '数据库只读查询']
export const CIDR_PRESETS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.1/32']
export const QPS_PRESETS = ['5', '20', '50', '100']
export const FALLBACK_ORGS = ['业务一部', '平台运营组', '系统管理组']

let cachedOrgs: string[] | null = null

export function useOrgOptions() {
  const [orgs, setOrgs] = useState<string[]>(cachedOrgs ?? FALLBACK_ORGS)
  useEffect(() => {
    if (cachedOrgs) return
    let active = true
    fetch('/api/organizations')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!active || !Array.isArray(data?.items)) return
        const names = Array.from(
          new Set<string>(
            data.items
              .map((o: {name?: string; placeholderKey?: string}) => (o.name || o.placeholderKey || '').trim())
              .filter(Boolean),
          ),
        )
        if (names.length) {
          cachedOrgs = names
          setOrgs(names)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return orgs
}

export function toggleCsvValue(current: string, token: string): string {
  const parts = current
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const exists = parts.includes(token)
  const next = exists ? parts.filter(p => p !== token) : [...parts, token]
  return next.join(', ')
}

export function PresetInput({
  label,
  value,
  onChange,
  presets,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  presets: string[]
  placeholder?: string
}) {
  const listId = useId()
  return (
    <label>
      {label}
      <input
        list={listId}
        value={value}
        placeholder={placeholder || '可下拉选择或直接输入'}
        onChange={e => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {presets.map(p => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </label>
  )
}

export function ChipMultiInput({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
}) {
  const selected = new Set(
    value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )
  return (
    <div className="preset-chip-field">
      <label>
        {label}
        <input
          value={value}
          placeholder={placeholder || '点击下方标签快速选择，或逗号分隔手动输入'}
          onChange={e => onChange(e.target.value)}
        />
      </label>
      <div className="preset-chip-row">
        {options.map(opt => {
          const active = selected.has(opt)
          return (
            <button
              key={opt}
              type="button"
              className={`preset-chip ${active ? 'is-active' : ''}`}
              onClick={() => onChange(toggleCsvValue(value, opt))}
            >
              {active ? `✓ ${opt}` : `+ ${opt}`}
            </button>
          )
        })}
      </div>
    </div>
  )
}
