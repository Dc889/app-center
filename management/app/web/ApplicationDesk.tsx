import {AgentDisposalScopeField, AgentImpactPanel, AgentRiskDecisionField} from '../../modules/agents/public.web'
import type {AgentImpact} from '../../modules/agents/public.web'
import {KnowledgeChangesReviewFieldset, KnowledgeDispositionFieldset, KnowledgeSecurityReviewFieldset} from '../../modules/knowledge/public.web'
import {PluginRestoreForm} from '../../modules/plugins/public.web'
import {useEffect,useState} from 'react'
import {RecordDetails} from '../../shared-ui/RecordDetails'
import {CheckCircle2,AlertTriangle,Clock,RefreshCw,Search,ShieldCheck,Layers,Plug,Server,Wrench,FileText,User,Calendar} from 'lucide-react'

type DependencyAuditItem={kind?:string;kindLabel?:string;id?:string;name:string;source?:string;approved:boolean;externalAllowed:boolean;status?:string;reason?:string}
type DependencySummary={checkedAt?:string;workflowInspected?:boolean;total:number;passed:number;warnings:number;counts?:{knowledge?:number;plugin?:number;mcp?:number;tool?:number}}
type Application={agentImpact?:AgentImpact;approvedImpact?:AgentImpact;canQueryExecution?:boolean;ticketNo:string;ticketType:string;account:string;org?:string;status:string;revision:number;isApplicant?:boolean;restoreRequest?:{reason:string;repairInfo:string;minutes:number};observeFrom?:string;observeUntil?:string;observation?:{verdict:string;complete:boolean};observationError?:{code:string};urgentEventNo?:string;alertEvidence?:unknown[];deliveryBlocked?:boolean;lastError?:{code:string};linkedDispositionTicketNo?:string;linkedReviewDispositionTicketNo?:string;relatedTicketNos?:string[];linkError?:{code:string};creationMode?:string;approvalMode?:string;node?:string;evidenceRefs?:{evidenceId:string;filename?:string}[];attempts?:{command:{executionId:string;action:string};execution?:{status:string}}[];revealState?:string;command?:{action:string};approvedFields?:{文档确认记录?:{documentId:string;sha256:string;verdict:string;actor:string;at:string}[]};execution?:{status:string;result?:{failureCode?:string;failureReason?:string;retryable?:boolean;details?:unknown}};originalCatalog?:{name?:string;data?:{name?:string}};targetApplication?:{name?:string};submission:{resourceId:string;fields:Record<string,unknown>};snapshot:{snapshotId:string;name?:string;fields?:Record<string,unknown>&{文档审查明细?:{documentId:string;sha256:string;autoVerdict:string}[]};data?:{name?:string;mode?:string;packageMetadata?:{name?:string};dependencies?:DependencyAuditItem[];dependencySummary?:DependencySummary|null}};history:{at:string;actor:string;action:string;note?:string}[]}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isReadableName(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && !UUID_LIKE.test(v.trim())
}
function ticketDisplayName(item: Application): string {
  const sf = item.snapshot?.fields
  const sub = item.submission?.fields
  const candidates: unknown[] = [
    item.snapshot?.name,
    item.snapshot?.data?.name,
    item.snapshot?.data?.packageMetadata?.name,
    sf?.['知识库名称'],
    sf?.['目录展示名称'],
    sf?.['MCP名称'],
    sf?.['应用名称'],
    sf?.['插件名称'],
    sf?.['技能名称'],
    sub?.name,
    item.originalCatalog?.name,
    item.originalCatalog?.data?.name,
    item.targetApplication?.name,
    sub?.callerName,
  ]
  for (const c of candidates) {
    if (isReadableName(c)) return c.trim()
  }
  return item.submission.resourceId
}

const TICKET_NAMES: Record<string,string> = {
  'AG-02':'智能体发布申请','AG-03':'智能体受限授权','AG-04':'智能体版本更新','AG-05':'智能体下架处置',
  'KB-02':'知识库分享申请','KB-04':'知识库变更再审','KB-05':'知识库下架处置',
  'PLG-01':'插件上架申请','PLG-02':'插件版本更新','PLG-04':'插件禁用与恢复',
  'MCP-01':'MCP 上架登记','MCP-03':'MCP 隔离与下架',
  'SKL-01':'Skill 上架申请','SKL-02':'Skill 版本更新','SKL-04':'Skill 下架处置',
  'KEY-01':'密钥申请','KEY-02':'密钥轮换与吊销','TOL-01':'自定义工具审批','SVC-01':'服务运维工单',
}

function statusTone(status:string): 'pending'|'progress'|'success'|'danger'|'muted' {
  if(['待受理','待运维确认','待恢复审核','待所有者提交','待补正','已禁用待确认'].includes(status)) return 'pending'
  if(['执行中','待结果确认','观察中'].includes(status)) return 'progress'
  if(['已完成','已通过'].includes(status)) return 'success'
  if(['已驳回','执行失败','已终止'].includes(status)) return 'danger'
  return 'muted'
}

function buildSteps(row:Application, warnCount:number) {
  const s = row.status
  const submitted = true
  const audited = true
  const approvedDone = ['执行中','待结果确认','已完成'].includes(s)
  const rejected = ['已驳回','已撤回','已终止','执行失败'].includes(s)
  const finished = s === '已完成'
  return [
    {label:'提交申请', state: submitted ? 'done' : 'wait'},
    {label:'合规核验', state: audited ? (warnCount > 0 ? 'warn' : 'done') : 'wait'},
    {label:'运维审批', state: rejected ? 'error' : approvedDone ? 'done' : 'active'},
    {label:'执行生效', state: finished ? 'done' : (['执行中','待结果确认'].includes(s) ? 'active' : 'wait')},
  ]
}

export function ApplicationDesk({view,account}:{view:string;account:string}) {
  const [items,setItems]=useState<Application[]>([])
  const [selected,setSelected]=useState('')
  const [search,setSearch]=useState('')
  const [statusFilter,setStatusFilter]=useState('全部')
  const [confirmed,setConfirmed]=useState<string[]>([])
  const [documentVerdicts,setDocumentVerdicts]=useState<Record<string,string>>({})
  const [reviewVerdict,setReviewVerdict]=useState('通过')
  const [secret,setSecret]=useState('')
  const [note,setNote]=useState('')
  const [disposalScope,setDisposalScope]=useState(['仓库下架','撤销访问授权'])
  const [historyPolicy,setHistoryPolicy]=useState('保留且不可新增下载')
  const [dispositionActions,setDispositionActions]=useState<string[]>([])
  const [recoveryCondition,setRecoveryCondition]=useState('')
  const [securityVerdict,setSecurityVerdict]=useState('通过')
  const [securityNote,setSecurityNote]=useState('')
  const [externalAllowed,setExternalAllowed]=useState('禁止')
  const [risk,setRisk]=useState(false)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [reload,setReload]=useState(0)

  useEffect(()=>{
    let active=true
    fetch('/api/applications?view='+view).then(async r=>{
      if(!r.ok)throw Error('读取审批申请失败')
      const data=await r.json()
      if(active){
        setItems(data.items)
        setSelected(prev=>data.items.some((i:Application)=>i.ticketNo===prev)?prev:(data.items[0]?.ticketNo ?? ''))
        setError('')
      }
    }).catch(e=>{if(active)setError(e.message)})
    return ()=>{active=false}
  },[view,reload])

  const filteredItems = items.filter(item => {
    if (statusFilter !== '全部' && item.status !== statusFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    const name = ticketDisplayName(item).toLowerCase()
    return item.ticketNo.toLowerCase().includes(q) || name.includes(q) || item.account.toLowerCase().includes(q) || item.ticketType.toLowerCase().includes(q)
  })
  const row = filteredItems.find(i=>i.ticketNo===selected) ?? items.find(i=>i.ticketNo===selected)
  const warnings = row?.snapshot.data?.dependencies?.filter(d=>!d.approved || !d.externalAllowed) ?? []
  const documents = row?.snapshot.fields?.文档审查明细 ?? []

  async function act(action:string,extra:Record<string,unknown>={}) {
    if(!row)return
    setBusy(true)
    try {
      const r=await fetch('/api/applications/transition',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        ticketNo:row.ticketNo,revision:row.revision,action,note,reviewVerdict,disposalScope,dispositionActions,recoveryCondition,historyPolicy,securityVerdict,securityNote,externalAllowed,confirmations:row.ticketType==='KB-04'?documents.filter(d=>documentVerdicts[JSON.stringify([d.documentId,d.sha256])]).map(d=>({documentId:d.documentId,sha256:d.sha256,verdict:documentVerdicts[JSON.stringify([d.documentId,d.sha256])]})):documents.filter(d=>confirmed.includes(JSON.stringify([d.documentId,d.sha256]))).map(d=>({documentId:d.documentId,sha256:d.sha256,verdict:'通过'})),warningDecision:risk?'确认风险并继续审批':undefined,...extra})})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '办理失败')
      setNote('');setError('');setRisk(false);setReload(v=>v+1)
    }catch(e){setError(e instanceof Error?e.message:'办理失败')}
    finally{setBusy(false)}
  }

  async function reveal() {
    if(!row)return
    setBusy(true);setSecret('')
    try {
      const r=await fetch('/api/applications/reveal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticketNo:row.ticketNo})})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '领取失败')
      setSecret(data.secret);setError('');setReload(v=>v+1)
    }catch(e){setError(e instanceof Error?e.message:'领取失败')}
    finally{setBusy(false)}
  }

  const actions=row && (view==='todo' && row.ticketType==='PLG-04' && row.status==='待恢复审核'?['批准恢复','驳回恢复']:view==='todo' && row.ticketType==='PLG-04' && row.status==='观察中'?['核对观察']:view==='mine' && row.ticketType==='KB-04' && (row.isApplicant || row.account===account) && ['待所有者提交','待补正'].includes(row.status)?['提交变更审查']:view==='todo' && row.ticketType==='KB-04' && row.status==='待受理'?['确认审查','退回补正']:view==='todo' && row.status==='待运维确认'?['批准']:view==='todo' && row.creationMode==='告警转单' && row.status==='待结果确认'?['确认结果']:view==='todo' && row.status==='待受理'?['批准','驳回']:view==='todo' && row.status==='执行失败'?row.execution?.result?.retryable?['重试执行','终止工单']:['终止工单']:view==='mine' && (row.isApplicant || row.account===account)?
    row.status==='待受理'?['撤回']:row.status==='待结果确认'?['确认结果']:[]:[]) || []
  if(row?.canQueryExecution && view==='todo')actions.push('查证原执行')
  const applicantAction=actions.length===1 && actions[0]==='撤回'
  const noteLabel=applicantAction?'撤回原因':row?.ticketType==='KB-04' && view==='mine' && ['待所有者提交','待补正'].includes(row.status)?'变更原因':'审批意见'
  const when=(value?:string)=>value && Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{hour12:false}):(value || '—')
  const historyText=(value:string)=>value.replaceAll('succeeded','已完成').replaceAll('failed','执行失败').replaceAll('cancelled','已终止').replaceAll('running','执行中')
  const uniqueStatuses = ['全部', ...Array.from(new Set(items.map(i => i.status)))]

  const selectTicket = (ticketNo: string) => {
    setSelected(ticketNo)
    setDocumentVerdicts({});setReviewVerdict('通过');setDispositionActions([]);setRecoveryCondition('')
    setHistoryPolicy('保留且不可新增下载');setSecret('');setSecurityVerdict('通过');setSecurityNote('')
    setExternalAllowed('禁止');setConfirmed([]);setNote('');setRisk(false);setError('')
    setDisposalScope(['仓库下架','撤销访问授权'])
  }

  return (
    <section className="app-workbench">
      <aside className="app-workbench-list">
        <div className="app-list-header">
          <div className="app-list-title">
            <h3>业务审批申请</h3>
            <span className="app-count-badge">{items.length}</span>
          </div>
          <button className="app-icon-btn" disabled={busy} onClick={()=>setReload(v=>v+1)} title="刷新发布申请">
            <RefreshCw size={14} className={busy ? 'spin' : ''} />
            <span>刷新发布申请</span>
          </button>
        </div>

        <div className="app-list-search">
          <Search size={14} />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索应用名、工单号或申请人..." />
        </div>

        {uniqueStatuses.length > 2 && (
          <div className="app-status-tabs">
            {uniqueStatuses.map(st => (
              <button key={st} className={statusFilter === st ? 'active' : ''} onClick={() => setStatusFilter(st)}>{st}</button>
            ))}
          </div>
        )}

        <div className="app-ticket-scroll">
          {filteredItems.length === 0 ? (
            <div className="app-empty-state">
              <FileText size={28} strokeWidth={1.5} />
              <p>{items.length === 0 ? '当前暂无业务审批申请' : '没有匹配的审批单'}</p>
            </div>
          ) : filteredItems.map(item => {
            const displayName = ticketDisplayName(item)
            const active = item.ticketNo === row?.ticketNo
            const submittedAt = item.history?.[0]?.at
            return (
              <button
                key={item.ticketNo}
                disabled={busy}
                className={`app-ticket-card ${active ? 'is-active' : ''}`}
                onClick={() => selectTicket(item.ticketNo)}
              >
                <div className="app-ticket-card-top">
                  <span className="app-type-tag">{item.ticketType}</span>
                  <span className={`app-status-pill tone-${statusTone(item.status)}`}>{item.status}</span>
                </div>
                <div className="app-ticket-card-name">{displayName}</div>
                <div className="app-ticket-card-meta">
                  <span>{item.account}</span>
                  <span>{when(submittedAt).split(' ')[0]}</span>
                </div>
                <div className="app-ticket-card-no">{item.ticketNo}</div>
              </button>
            )
          })}
        </div>
      </aside>

      <div className="app-workbench-detail">
        {!row ? (
          <div className="app-detail-empty">
            <ShieldCheck size={36} strokeWidth={1.4} />
            <h4>请选择左侧审批工单</h4>
            <p>点击任意工单卡片即可查看完整申请信息、组件合规核验报告与审批进度。</p>
          </div>
        ) : (
          <article className="app-detail-sheet">
            <header className="app-sheet-header">
              <div className="app-sheet-title-row">
                <div className="app-sheet-title-main">
                  <span className="app-type-tag lg">{row.ticketType}</span>
                  <div>
                    <h2>{ticketDisplayName(row)}</h2>
                    <div className="app-sheet-subtitle">
                      <span>{TICKET_NAMES[row.ticketType] || row.ticketType}</span>
                      <span className="dot">·</span>
                      <code>{row.ticketNo}</code>
                    </div>
                  </div>
                </div>
                <span className={`app-status-pill lg tone-${statusTone(row.status)}`}>{row.status}</span>
              </div>

              <div className="app-sheet-meta-bar">
                <span><User size={13} /> 申请人：<strong>{row.account}</strong>{row.org ? `（${row.org}）` : ''}</span>
                <span><Calendar size={13} /> 提交时间：<strong>{when(row.history?.[0]?.at)}</strong></span>
                <span><Clock size={13} /> 当前修订：<strong>v{row.revision}</strong></span>
              </div>

              <div className="app-stepper">
                {buildSteps(row, warnings.length).map((step, idx) => (
                  <div key={step.label} className={`app-step is-${step.state}`}>
                    <div className="app-step-dot">{idx + 1}</div>
                    <span className="app-step-label">{step.label}</span>
                  </div>
                ))}
              </div>
            </header>

            <div className="app-sheet-body">
              {view==='mine' && (row.isApplicant || row.account===account) && row.execution?.status==='succeeded' &&
                (row.ticketType==='KEY-01' || row.ticketType==='KEY-02' && row.command?.action==='rotate_key') &&
                row.revealState!=='shown' && <div className="app-banner info"><button className="primary-button" disabled={busy} onClick={reveal}>一次性领取密钥</button></div>}
              {secret && <div className="app-banner info"><label>一次性密钥<textarea aria-label="一次性密钥" readOnly value={secret}/></label><button className="secondary-button" onClick={()=>setSecret('')}>关闭密钥展示</button></div>}
              {row.deliveryBlocked && <div className="app-banner danger" role="alert"><AlertTriangle size={15}/> 执行结果需要查证 · {row.lastError?.code}</div>}
              {row.execution?.result?.failureCode && <div className="app-banner danger"><AlertTriangle size={15}/> {row.execution.result.failureCode} · {row.execution.result.failureReason}</div>}

              {row.ticketType==='SVC-01' && <div className="app-info-strip"><span>创建方式：{row.creationMode}</span><span>审批模式：{row.approvalMode}</span><span>目标服务：{row.submission.resourceId}</span></div>}
              {['KB-05','PLG-04'].includes(row.ticketType) && <div className="app-info-strip">
                <span>创建方式：{row.creationMode}</span>
                {row.evidenceRefs?.filter(e=>e.filename).map(e=><a key={e.evidenceId} href={'/api/evidence/'+e.evidenceId+'/file'}>{e.filename}</a>)}
                {row.attempts?.map(a=><span key={a.command.executionId}>执行节点 · {a.command.action} · {a.execution?.status ?? '等待结果'}</span>)}
              </div>}
              {row.ticketType==='PLG-04' && <div className="app-info-strip">
                {row.observeUntil && <span>恢复观察：{row.observeFrom} 至 {row.observeUntil} · {row.observation?.verdict ?? '尚未采集'}</span>}
                {row.observationError && <span role="status">观察等待核对 · {row.observationError.code}</span>}
                {row.urgentEventNo && <span>关联紧急事件：{row.urgentEventNo}</span>}
                {view==='todo' && row.status==='已禁用待确认' && <PluginRestoreForm key={row.ticketNo+'-'+row.revision} disabled={busy} onSubmit={fields=>act('申请恢复',fields)}/>}
              </div>}
              {row.linkedDispositionTicketNo && <p className="app-link-note">关联处置工单：{row.linkedDispositionTicketNo}</p>}
              {row.linkedReviewDispositionTicketNo && <p className="app-link-note">人工追加处置工单：{row.linkedReviewDispositionTicketNo}</p>}
              {row.relatedTicketNos?.map(number=><p key={number} className="app-link-note">关联来源工单：{number}</p>)}
              {row.linkError && <p role="status" className="app-link-note">处置工单关联等待重试 · {row.linkError.code}</p>}
              {(row.approvedImpact ?? row.agentImpact) && <AgentImpactPanel impact={(row.approvedImpact ?? row.agentImpact)!}/>}

              <RecordDetails title="申请基本信息" values={row.submission.fields}/>

              {['AG-02','AG-04'].includes(row.ticketType) && (() => {
                const deps = row.snapshot.data?.dependencies ?? []
                const summary = row.snapshot.data?.dependencySummary
                const counts = summary?.counts ?? {
                  knowledge: deps.filter(d=>d.kind==='knowledge').length,
                  plugin: deps.filter(d=>d.kind==='plugin').length,
                  mcp: deps.filter(d=>d.kind==='mcp').length,
                  tool: deps.filter(d=>d.kind==='tool').length,
                }
                const warnCount = warnings.length
                return (
                  <section className={`app-audit-card ${warnCount > 0 ? 'has-warn' : 'is-pass'}`}>
                    <div className="app-audit-head">
                      <div className="app-audit-title">
                        {warnCount > 0 ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
                        <h4>智能体内部组件合规核验</h4>
                        {row.snapshot.data?.mode && <span className="app-mode-chip">模式：{row.snapshot.data.mode}</span>}
                      </div>
                      <span className={`app-status-pill tone-${warnCount > 0 ? 'pending' : 'success'}`}>
                        {warnCount > 0 ? `发现 ${warnCount} 项风险组件` : '自动核验通过'}
                      </span>
                    </div>

                    <div className="app-audit-metrics">
                      <div className="app-audit-metric"><Layers size={15}/><span>知识库</span><strong>{counts.knowledge ?? 0}</strong></div>
                      <div className="app-audit-metric"><Plug size={15}/><span>插件</span><strong>{counts.plugin ?? 0}</strong></div>
                      <div className="app-audit-metric"><Server size={15}/><span>MCP</span><strong>{counts.mcp ?? 0}</strong></div>
                      <div className="app-audit-metric"><Wrench size={15}/><span>自定义工具</span><strong>{counts.tool ?? 0}</strong></div>
                    </div>

                    {deps.length === 0 ? (
                      <div className="app-audit-pass-note">
                        <CheckCircle2 size={15} />
                        <span>已自动扫描 Dify 应用配置，当前未绑定外部知识库、插件、MCP 或自定义 HTTP 工具，无高风险组件依赖。</span>
                      </div>
                    ) : (
                      <div className="app-audit-table-wrap">
                        <table className="app-audit-table">
                          <thead>
                            <tr><th>组件类型</th><th>组件名称 / 标识</th><th>核验结论</th><th>核验说明</th></tr>
                          </thead>
                          <tbody>
                            {deps.map((d,idx)=>{
                              const ok = d.approved && d.externalAllowed
                              return (
                                <tr key={`${d.kind ?? 'dep'}-${d.id ?? idx}`}>
                                  <td><span className="app-type-tag">{d.kindLabel || d.kind || '组件'}</span></td>
                                  <td><strong>{d.name}</strong></td>
                                  <td><span className={`app-status-pill tone-${ok ? 'success' : 'pending'}`}>{d.status || (ok?'合规通过':'未审告警')}</span></td>
                                  <td className="muted-cell">{d.reason || (ok?'符合平台安全策略':'未通过对应专项审核')}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )
              })()}

              {row.snapshot.fields && <RecordDetails title="资源核验信息" values={row.snapshot.fields}/>}

              {row.ticketType === 'KB-02' && (
                <KnowledgeSecurityReviewFieldset
                  documents={documents}
                  confirmed={confirmed}
                  onChangeConfirmed={setConfirmed}
                  approvedRecords={row.approvedFields?.文档确认记录}
                  disabled={busy || view !== 'todo' || row.status !== '待受理'}
                />
              )}
              {row.ticketType === 'KB-04' && (
                <KnowledgeChangesReviewFieldset
                  documents={documents}
                  documentVerdicts={documentVerdicts}
                  onChangeVerdicts={setDocumentVerdicts}
                  reviewVerdict={reviewVerdict}
                  onChangeReviewVerdict={setReviewVerdict}
                  approvedRecords={row.approvedFields?.文档确认记录}
                  isTodoPending={view === 'todo' && row.status === '待受理'}
                  disabled={busy || view !== 'todo' || row.status !== '待受理'}
                />
              )}
              {row.approvedFields?.文档确认记录?.map(c=><p key={c.documentId} className="app-link-note">安全复核 · {c.documentId} · {c.verdict} · {c.actor} · {c.at}</p>)}
              {warnings.map((d,i)=><p key={i} className="sr-only">资源告警 · {d.name}</p>)}

              {row.history.length > 0 && (
                <section className="app-timeline-section">
                  <h4>审批与流转记录</h4>
                  <ol className="app-timeline">
                    {row.history.map((item,index)=>(
                      <li key={index} className={index === row.history.length - 1 ? 'is-latest' : ''}>
                        <div className="app-timeline-dot" />
                        <div className="app-timeline-content">
                          <div className="app-timeline-row">
                            <strong>{historyText(item.action)}</strong>
                            <span className="app-timeline-actor">{item.actor==='system'?'系统自动执行':item.actor}</span>
                            <time>{when(item.at)}</time>
                          </div>
                          {item.note && <p className="app-timeline-note">{historyText(item.note)}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {actions.length > 0 && (
                <section className="app-action-card">
                  <h4>{applicantAction ? '申请人操作' : '审批处理'}</h4>
                  <label className="app-action-field">
                    <span>{noteLabel} <em className="req">*</em></span>
                    <textarea
                      value={note}
                      onChange={e=>setNote(e.target.value)}
                      placeholder={applicantAction ? '请输入撤回原因（必填）' : '请输入审批意见（必填，例如：组件核验通过，同意上架）'}
                      rows={3}
                    />
                  </label>
                  {view === 'todo' && row.ticketType === 'KB-05' && ['待受理', '待运维确认'].includes(row.status) && (
                    <KnowledgeDispositionFieldset
                      target={row.submission.fields.target as string | undefined}
                      actions={dispositionActions}
                      onChangeActions={setDispositionActions}
                      recoveryCondition={recoveryCondition}
                      onChangeRecoveryCondition={setRecoveryCondition}
                      disabled={busy}
                    />
                  )}
                  {view==='todo' && ['TOL-01','MCP-01'].includes(row.ticketType) && row.status==='待受理' && <fieldset className="app-sub-fieldset" disabled={busy}><legend>安全复核</legend>
                    <label>安全审查结果<select value={securityVerdict} onChange={e=>setSecurityVerdict(e.target.value)}><option>通过</option><option>不通过</option></select></label>
                    <label>安全审查意见<textarea value={securityNote} onChange={e=>setSecurityNote(e.target.value)}/></label>
                    <label>对外使用权限<select value={externalAllowed} onChange={e=>setExternalAllowed(e.target.value)}><option>禁止</option><option>允许</option></select></label>
                  </fieldset>}
                  {view==='todo' && row.ticketType==='SKL-02' && row.status==='待受理' && <label className="app-action-field"><span>历史版本下载策略</span><select value={historyPolicy} onChange={e=>setHistoryPolicy(e.target.value)}><option>保留且不可新增下载</option><option>继续可下载</option></select></label>}
                  {view==='todo' && ['PLG-01','PLG-02'].includes(row.ticketType) && row.status==='待受理' && <label className="app-action-field"><span>对外使用权限</span><select value={externalAllowed} onChange={e=>setExternalAllowed(e.target.value)}><option>禁止</option><option>允许</option></select></label>}
                  {view === 'todo' && row.ticketType === 'AG-05' && row.status === '待受理' && (
                    <AgentDisposalScopeField value={disposalScope} onChange={setDisposalScope} disabled={busy} />
                  )}
                  {view === 'todo' && ['AG-02', 'AG-04'].includes(row.ticketType) && warnings.length > 0 && (
                    <AgentRiskDecisionField checked={risk} onChange={setRisk} disabled={busy} />
                  )}
                  <div className="app-action-footer">
                    <div className="app-action-buttons">
                      {actions.map(action=>{
                        const isPrimary=['批准','批准恢复','确认审查','确认结果','提交变更审查','重试执行'].includes(action)
                        const isDanger=['驳回','驳回恢复','终止工单'].includes(action)
                        return <button key={action} className={isPrimary?'primary-button':isDanger?'danger-outline-button':'secondary-button'} disabled={busy || !note.trim()} onClick={()=>act(action)}>{action}</button>
                      })}
                    </div>
                    {!note.trim() && <span className="app-action-hint">请先填写{noteLabel}后再提交操作</span>}
                  </div>
                </section>
              )}

              {error && <div className="app-banner danger" role="alert"><AlertTriangle size={15}/> {error}</div>}

              <details className="app-raw-payload">
                <summary>查看工单审计报文（供排障使用）</summary>
                <pre>{JSON.stringify({ticketNo:row.ticketNo,snapshotId:row.snapshot.snapshotId,submission:row.submission.fields,verification:row.snapshot.fields ?? null},null,2)}</pre>
              </details>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
