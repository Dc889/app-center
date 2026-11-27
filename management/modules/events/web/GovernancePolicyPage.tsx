import {useEffect, useState} from 'react'
import {AlertTriangle, Lock, Play, Settings2, ShieldCheck, Unlock} from 'lucide-react'
import type {View} from '../../../shared-ui/UiContextData'

type PatrolConfig = {
  enableDatasetSensitiveScan: boolean
  enableShadowPluginScan: boolean
  enableShadowMcpScan: boolean
  enableExternalExposureScan: boolean
  enableChatSensitiveScan: boolean
  highFreqIpThresholdPerMin: number
  patrolIntervalMinutes: number
}

type CutoffSwitches = {
  enableWebAppCutoff: boolean
  enableApiKeyCutoff: boolean
}

type PolicyPayload = {
  canApprove: boolean
  policy: {
    version: number
    patrols: PatrolConfig
    cutoffSwitches: CutoffSwitches
    updatedByName: string | null
    updatedAt: string | null
  }
  configTickets: {
    ticketNo: string
    status: string
    reason: string
    applicantName: string
    createdAt: string
    after: {patrols: PatrolConfig; cutoffSwitches: CutoffSwitches}
  }[]
  cutoffTickets: {
    ticketNo: string
    status: string
    actionLabel: string
    appName: string
    keyMask: string | null
    reason: string
    applicantName: string
    createdAt: string
    execution?: {summary?: string} | null
  }[]
  lastPatrol: {
    ranAt: string
    ranBy: string
    createdCount: number
    skippedCount: number
    totalScannedFindings: number
  } | null
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', {hour12: false})
}

function toneOf(status: string) {
  if (status === '已完成') return 'tone-success'
  if (status === '已驳回') return 'tone-danger'
  return 'tone-pending'
}

export function GovernancePolicyPage({onNavigate}: {onNavigate: (view: View, ticketType?: string | null) => void}) {
  const [data, setData] = useState<PolicyPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [patrolling, setPatrolling] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    setLoading(true)
    fetch('/api/governance-policy', {signal: c.signal})
      .then(async r => {
        if (!r.ok) throw new Error('读取旁路巡检与反制策略失败')
        return r.json()
      })
      .then((res: PolicyPayload) => {
        if (!c.signal.aborted) {
          setData(res)
          setError('')
        }
      })
      .catch(e => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : '读取策略失败')
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    return () => c.abort()
  }, [rev])

  async function runPatrol() {
    setPatrolling(true)
    setNotice('')
    setError('')
    try {
      const r = await fetch('/api/governance-policy/patrol/run', {method: 'POST'})
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body?.error?.message || body?.message || '巡检执行失败')
      const s = body.summary
      setNotice(`旁路只读巡检完成：共扫描 ${s.totalScannedFindings} 项风险线索，新生成 ${s.createdCount} 条安全告警单（去重跳过 ${s.skippedCount} 条已有未关闭告警）。未对原平台资源做任何修改。`)
      setRev(n => n + 1)
    } catch (e: any) {
      setError(e?.message || '巡检执行失败')
    } finally {
      setPatrolling(false)
    }
  }

  const p = data?.policy.patrols
  const sw = data?.policy.cutoffSwitches

  return (
    <div className="org-page-stack" data-testid="governance-policy-page">
      <div className="org-card">
        <div className="org-card-head" style={{justifyContent: 'space-between', flexWrap: 'wrap', gap: 12}}>
          <div>
            <h3 style={{margin: 0}}>旁路合规巡检与断流反制总控</h3>
            <p style={{margin: '4px 0 0', fontSize: 13, color: '#64748b'}}>
              默认运行于「只读监控 + 自动告警」模式，零干扰原 Dify / RAGFlow 用户使用；一键断流反制总闸门默认关闭，所有配置变更必须经由 CFG-05 工单审批生效。
            </p>
          </div>
          <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
            <button type="button" className="secondary-button" disabled={patrolling} onClick={runPatrol}>
              <Play size={14} /> {patrolling ? '正在巡检扫描…' : '立即执行旁路告警巡检'}
            </button>
            <button type="button" className="primary-button" onClick={() => onNavigate('manual', 'CFG-05')}>
              <Settings2 size={14} /> 发起策略变更工单
            </button>
          </div>
        </div>

        {error && <div className="app-banner danger" style={{marginTop: 10}}><AlertTriangle size={15} /> {error}</div>}
        {notice && <div className="app-banner info" style={{marginTop: 10}}><ShieldCheck size={15} /> {notice}</div>}

        {loading && !data ? (
          <p style={{color: '#64748b', marginTop: 12}}>正在加载当前生效策略…</p>
        ) : data && p && sw ? (
          <>
            <div className="metric-grid four" style={{marginTop: 14}}>
              <article className="metric-card">
                <span>当前策略版本</span>
                <strong>v{data.policy.version}</strong>
              </article>
              <article className="metric-card">
                <span>违规处置模式</span>
                <strong>仅生成告警</strong>
              </article>
              <article className="metric-card">
                <span>WebApp / iframe 断流总闸门</span>
                <strong style={{color: sw.enableWebAppCutoff ? '#b45309' : '#475569', display: 'inline-flex', alignItems: 'center', gap: 6}}>
                  {sw.enableWebAppCutoff ? <><Unlock size={16} /> 已开启</> : <><Lock size={16} /> 默认关闭</>}
                </strong>
              </article>
              <article className="metric-card">
                <span>API 密钥断流总闸门</span>
                <strong style={{color: sw.enableApiKeyCutoff ? '#b45309' : '#475569', display: 'inline-flex', alignItems: 'center', gap: 6}}>
                  {sw.enableApiKeyCutoff ? <><Unlock size={16} /> 已开启</> : <><Lock size={16} /> 默认关闭</>}
                </strong>
              </article>
            </div>

            <div className="table-scroll" style={{marginTop: 14}}>
              <table className="org-table">
                <thead>
                  <tr>
                    <th>监管维度</th>
                    <th>说明与检测范围</th>
                    <th>当前状态</th>
                    <th>触发动作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>个人/共享知识库敏感词巡检</strong></td>
                    <td>旁路读取 Dify 文档分段并匹配平台敏感词库，无需用户提单</td>
                    <td><span className={`app-status-pill ${p.enableDatasetSensitiveScan ? 'tone-success' : 'tone-neutral'}`}>{p.enableDatasetSensitiveScan ? '已开启' : '已关闭'}</span></td>
                    <td>仅自动生成告警单（不改原库）</td>
                  </tr>
                  <tr>
                    <td><strong>未备案私装插件巡检</strong></td>
                    <td>比对 Plugin Daemon 全租户实装清单与平台已准入白名单</td>
                    <td><span className={`app-status-pill ${p.enableShadowPluginScan ? 'tone-success' : 'tone-neutral'}`}>{p.enableShadowPluginScan ? '已开启' : '已关闭'}</span></td>
                    <td>仅自动生成告警单</td>
                  </tr>
                  <tr>
                    <td><strong>未登记 MCP 与外联巡检</strong></td>
                    <td>识别工作区私自绑定的 MCP 服务与外部接口节点</td>
                    <td><span className={`app-status-pill ${p.enableShadowMcpScan ? 'tone-success' : 'tone-neutral'}`}>{p.enableShadowMcpScan ? '已开启' : '已关闭'}</span></td>
                    <td>仅自动生成告警单</td>
                  </tr>
                  <tr>
                    <td><strong>未审批 Web / API / iframe 暴露检测</strong></td>
                    <td>识别未备案却开启公开 WebApp、生成外部 API 密钥及第三方 Referer 嵌入调用</td>
                    <td><span className={`app-status-pill ${p.enableExternalExposureScan ? 'tone-success' : 'tone-neutral'}`}>{p.enableExternalExposureScan ? '已开启' : '已关闭'}</span></td>
                    <td>仅自动生成告警单</td>
                  </tr>
                  <tr>
                    <td><strong>外部调用问答敏感词审计</strong></td>
                    <td>抽检近 7 日外部非控制台对话输入输出，识别涉密内容外泄风险</td>
                    <td><span className={`app-status-pill ${p.enableChatSensitiveScan ? 'tone-success' : 'tone-neutral'}`}>{p.enableChatSensitiveScan ? '已开启' : '已关闭'}</span></td>
                    <td>仅自动生成告警单</td>
                  </tr>
                  <tr>
                    <td><strong>一键断流反制总闸门</strong></td>
                    <td>控制是否允许通过 SEC-01 工单暂停应用 WebApp 公开访问或吊销 API 密钥</td>
                    <td>
                      <span className={`app-status-pill ${sw.enableWebAppCutoff || sw.enableApiKeyCutoff ? 'tone-pending' : 'tone-neutral'}`}>
                        {sw.enableWebAppCutoff || sw.enableApiKeyCutoff ? '部分或全部已解锁' : '默认全部关闭 🔒'}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="secondary-button compact" onClick={() => onNavigate('manual', 'CFG-05')}>
                        经由 CFG-05 变更
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {data.lastPatrol && (
              <p style={{marginTop: 10, fontSize: 12, color: '#64748b'}}>
                最近一次旁路巡检：{fmtTime(data.lastPatrol.ranAt)} · 执行人：{data.lastPatrol.ranBy} · 新增告警 {data.lastPatrol.createdCount} 条（去重跳过 {data.lastPatrol.skippedCount} 条）
              </p>
            )}
          </>
        ) : null}
      </div>

      {data && data.configTickets.length > 0 && (
        <div className="org-card">
          <div className="org-card-head" style={{justifyContent: 'space-between'}}>
            <h4 style={{margin: 0}}>近期策略变更工单（CFG-05）</h4>
            <button type="button" className="secondary-button compact" onClick={() => onNavigate('manual', 'CFG-05')}>前往审批 / 提单</button>
          </div>
          <div className="table-scroll" style={{marginTop: 8}}>
            <table className="org-table">
              <thead>
                <tr><th>时间</th><th>申请人</th><th>目标断流开关</th><th>变更原因</th><th>状态</th></tr>
              </thead>
              <tbody>
                {data.configTickets.slice(0, 8).map(t => (
                  <tr key={t.ticketNo}>
                    <td>{fmtTime(t.createdAt)}</td>
                    <td>{t.applicantName}</td>
                    <td>WebApp 断流：{t.after.cutoffSwitches.enableWebAppCutoff ? '开' : '关'} · API 断流：{t.after.cutoffSwitches.enableApiKeyCutoff ? '开' : '关'}</td>
                    <td>{t.reason}</td>
                    <td><span className={`app-status-pill ${toneOf(t.status)}`}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.cutoffTickets.length > 0 && (
        <div className="org-card">
          <div className="org-card-head" style={{justifyContent: 'space-between'}}>
            <h4 style={{margin: 0}}>外部访问断流 / 恢复执行记录（SEC-01）</h4>
            <button type="button" className="secondary-button compact" onClick={() => onNavigate('manual', 'SEC-01')}>前往 SEC-01 办理</button>
          </div>
          <div className="table-scroll" style={{marginTop: 8}}>
            <table className="org-table">
              <thead>
                <tr><th>时间</th><th>目标应用</th><th>反制动作</th><th>申请人</th><th>状态</th><th>执行结果</th></tr>
              </thead>
              <tbody>
                {data.cutoffTickets.slice(0, 10).map(t => (
                  <tr key={t.ticketNo}>
                    <td>{fmtTime(t.createdAt)}</td>
                    <td>{t.appName}</td>
                    <td>{t.actionLabel}{t.keyMask ? ` (${t.keyMask})` : ''}</td>
                    <td>{t.applicantName}</td>
                    <td><span className={`app-status-pill ${toneOf(t.status)}`}>{t.status}</span></td>
                    <td>{t.execution?.summary || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
