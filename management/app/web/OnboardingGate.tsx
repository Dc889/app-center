import {useEffect, useState} from 'react'
import {Building2, CheckCircle2, LogOut, ShieldCheck, User} from 'lucide-react'

export type OnboardingProfile = {
  account: string
  email?: string
  name: string
  org: string
  businessLine?: string
  roles?: string[]
  actingRole: string
  subjectId: string
  needsOnboarding?: boolean
  workspaceName?: string
}

type OrgOption = {
  id: string
  name: string
  parentId?: string | null
  level?: number
  status?: string
}

export function OnboardingGate({
  profile,
  onCompleted,
  onLogout,
}: {
  profile: OnboardingProfile
  onCompleted: (updated: OnboardingProfile) => void
  onLogout: () => void
}) {
  const [name, setName] = useState(profile.name || '')
  const [org, setOrg] = useState(profile.org || '')
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [loadingOrgs, setLoadingOrgs] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/organizations')
      .then(async res => (res.ok ? await res.json() : {items: []}))
      .then(data => {
        if (!active) return
        const items: OrgOption[] = Array.isArray(data?.items)
          ? data.items.filter((o: OrgOption) => o && o.name && o.status !== 'disabled')
          : []
        setOrgs(items)
      })
      .catch(() => {
        if (active) setOrgs([])
      })
      .finally(() => {
        if (active) setLoadingOrgs(false)
      })
    return () => { active = false }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('请填写真实姓名')
      return
    }
    if (!org.trim()) {
      setError('请选择所属组织机构')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/auth/complete-profile', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({name: name.trim(), org: org.trim()}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error?.message || '提交失败，请重试')
        return
      }
      onCompleted(data as OnboardingProfile)
    } catch {
      setError('服务连接失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid="onboarding-gate"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: '#ffffff',
          borderRadius: 16,
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.08)',
          border: '1px solid #e2e8f0',
          padding: 32,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12}}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#eff6ff',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 style={{margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a'}}>
              首次登录 · 完善身份信息
            </h2>
            <p style={{margin: '2px 0 0', fontSize: 13, color: '#64748b'}}>
              补充真实姓名与所属组织机构后立即进入平台
            </p>
          </div>
        </div>

        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 20,
            fontSize: 13,
            color: '#334155',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
            <span style={{color: '#64748b'}}>Dify 租户账号</span>
            <strong style={{fontWeight: 600}}>{profile.email || profile.account}</strong>
          </div>
          {profile.workspaceName && (
            <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
              <span style={{color: '#64748b'}}>关联工作区</span>
              <strong style={{fontWeight: 600}}>{profile.workspaceName}</strong>
            </div>
          )}
        </div>

        <form onSubmit={submit} style={{display: 'grid', gap: 16}}>
          <label style={{display: 'grid', gap: 6}}>
            <span style={{fontSize: 13, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6}}>
              <User size={14} /> 真实姓名 *
            </span>
            <input
              aria-label="真实姓名"
              data-testid="onboarding-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="请输入您的真实姓名"
              maxLength={60}
              style={{
                height: 40,
                padding: '0 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </label>

          <label style={{display: 'grid', gap: 6}}>
            <span style={{fontSize: 13, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6}}>
              <Building2 size={14} /> 所属组织机构 *
            </span>
            {orgs.length > 0 ? (
              <select
                aria-label="所属组织机构"
                data-testid="onboarding-org"
                value={org}
                onChange={e => setOrg(e.target.value)}
                disabled={loadingOrgs}
                style={{
                  height: 40,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 14,
                  background: '#ffffff',
                  outline: 'none',
                }}
              >
                <option value="">请选择所属组织机构</option>
                {orgs.map(item => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="所属组织机构"
                data-testid="onboarding-org"
                value={org}
                onChange={e => setOrg(e.target.value)}
                placeholder={loadingOrgs ? '正在加载组织机构...' : '请输入所属组织机构名称'}
                maxLength={120}
                style={{
                  height: 40,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            )}
          </label>

          {error && (
            <div className="app-banner danger" role="alert" style={{margin: 0}}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="primary-button"
            data-testid="onboarding-submit"
            disabled={submitting}
            style={{
              height: 42,
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 600,
              marginTop: 4,
            }}
          >
            <CheckCircle2 size={16} />
            <span>{submitting ? '正在保存...' : '确认并进入应用中心'}</span>
          </button>
        </form>

        <div style={{marginTop: 18, textAlign: 'center'}}>
          <button
            type="button"
            onClick={onLogout}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: 13,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <LogOut size={13} />
            <span>切换其他账号登录</span>
          </button>
        </div>
      </div>
    </div>
  )
}
