import {AgentDisposalScopeField, AgentImpactPanel, AgentRiskDecisionField} from '../../modules/agents/public.web'
import type {AgentImpact} from '../../modules/agents/public.web'
import {KnowledgeChangesReviewFieldset, KnowledgeDispositionFieldset, KnowledgeSecurityReviewFieldset} from '../../modules/knowledge/public.web'
import {PluginRestoreForm} from '../../modules/plugins/public.web'
import {useEffect,useState} from 'react'
import {RecordDetails} from '../../shared-ui/RecordDetails'
type DependencyAuditItem={kind?:string;kindLabel?:string;id?:string;name:string;source?:string;approved:boolean;externalAllowed:boolean;status?:string;reason?:string}
type DependencySummary={checkedAt?:string;workflowInspected?:boolean;total:number;passed:number;warnings:number;counts?:{knowledge?:number;plugin?:number;mcp?:number;tool?:number}}
type Application={agentImpact?:AgentImpact;approvedImpact?:AgentImpact;canQueryExecution?:boolean;ticketNo:string;ticketType:string;account:string;status:string;revision:number;isApplicant?:boolean;restoreRequest?:{reason:string;repairInfo:string;minutes:number};observeFrom?:string;observeUntil?:string;observation?:{verdict:string;complete:boolean};observationError?:{code:string};urgentEventNo?:string;alertEvidence?:unknown[];deliveryBlocked?:boolean;lastError?:{code:string};linkedDispositionTicketNo?:string;linkedReviewDispositionTicketNo?:string;relatedTicketNos?:string[];linkError?:{code:string};creationMode?:string;approvalMode?:string;node?:string;evidenceRefs?:{evidenceId:string;filename?:string}[];attempts?:{command:{executionId:string;action:string};execution?:{status:string}}[];revealState?:string;command?:{action:string};approvedFields?:{文档确认记录?:{documentId:string;sha256:string;verdict:string;actor:string;at:string}[]};execution?:{status:string;result?:{failureCode?:string;failureReason?:string;retryable?:boolean;details?:unknown}};submission:{resourceId:string;fields:Record<string,unknown>};snapshot:{snapshotId:string;name?:string;fields?:{文档审查明细?:{documentId:string;sha256:string;autoVerdict:string}[]};data?:{name?:string;mode?:string;dependencies?:DependencyAuditItem[];dependencySummary?:DependencySummary|null}};history:{at:string;actor:string;action:string;note?:string}[]}
export function ApplicationDesk({view,account}:{view:string;account:string}) {
  const [items,setItems]=useState<Application[]>([])
  const [selected,setSelected]=useState('')
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
  const row=items.find(i=>i.ticketNo===selected)
  const warnings=row?.snapshot.data?.dependencies?.filter(d=>!d.approved || !d.externalAllowed) ?? []
  const documents=row?.snapshot.fields?.文档审查明细 ?? []
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
  const noteLabel=applicantAction?'撤回说明':row?.ticketType==='KB-04' && view==='mine' && ['待所有者提交','待补正'].includes(row.status)?'变更原因':'办理意见'
  const when=(value:string)=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{hour12:false}):value
  const historyText=(value:string)=>value.replaceAll('succeeded','已完成').replaceAll('failed','执行失败').replaceAll('cancelled','已终止').replaceAll('running','执行中')
  return <section className="panel list-panel application-desk">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:12}}>
      <h3 style={{margin:0}}>业务审批申请（{items.length} 条）</h3>
      <button className="secondary-button" disabled={busy} onClick={()=>setReload(v=>v+1)}>刷新发布申请</button>
    </div>
    {items.length===0 ? <p style={{color:'var(--muted,#64748b)',margin:'8px 0'}}>暂无业务审批申请</p> : (
      <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:14}}>
        {items.map(item=>{
          const displayName=item.snapshot?.name || item.snapshot?.data?.name || ''
          const active=item.ticketNo===selected
          return <button key={item.ticketNo} disabled={busy} className="secondary-button"
            style={{display:'flex',justifyContent:'space-between',alignItems:'center',textAlign:'left',width:'100%',padding:'10px 14px',borderColor:active?'var(--accent,#2563eb)':undefined,background:active?'rgba(37,99,235,0.06)':undefined}}
            onClick={()=>{setSelected(item.ticketNo);setDocumentVerdicts({});setReviewVerdict('通过');setDispositionActions([]);setRecoveryCondition('');setHistoryPolicy('保留且不可新增下载');setSecret('');setSecurityVerdict('通过');setSecurityNote('');setExternalAllowed('禁止');setConfirmed([]);setNote('');setRisk(false);setError('');setDisposalScope(['仓库下架','撤销访问授权'])}}>
            <span>
              <strong>{displayName ? `${displayName} · ` : ''}{item.ticketNo}</strong>
              <span style={{marginLeft:8,color:'var(--muted,#64748b)',fontSize:12}}>{item.ticketType} · 申请人 {item.account} · {item.submission.resourceId}</span>
            </span>
            <span style={{fontWeight:600,color:item.status==='待受理'?'#d97706':item.status==='已完成'?'#16a34a':'var(--accent,#2563eb)'}}>{item.status}</span>
          </button>
        })}
      </div>
    )}
    {row && <div className="editor-section application-detail">
      <div className="application-detail-head">
        <div>
          <h4>{row.snapshot?.name || row.snapshot?.data?.name || row.submission.resourceId}</h4>
          <p>{row.ticketType} · {row.ticketNo}</p>
        </div>
        <strong className="application-status">{row.status}</strong>
      </div>
      <p className="application-meta">申请人 {row.account}</p>
      {view==='mine' && (row.isApplicant || row.account===account) && row.execution?.status==='succeeded' &&
        (row.ticketType==='KEY-01' || row.ticketType==='KEY-02' && row.command?.action==='rotate_key') &&
        row.revealState!=='shown' && <button disabled={busy} onClick={reveal}>一次性领取密钥</button>}
      {secret && <div><label>一次性密钥<textarea aria-label="一次性密钥" readOnly value={secret}/></label><button onClick={()=>setSecret('')}>关闭密钥展示</button></div>}
      {row.deliveryBlocked && <p role="alert">执行结果需要查证 · {row.lastError?.code}</p>}
      {row.execution?.result?.failureCode && <p>{row.execution.result.failureCode} · {row.execution.result.failureReason}</p>}
      {row.ticketType==='SVC-01' && <div><p>创建方式 · {row.creationMode}</p><p>审批 · {row.approvalMode}</p><p>服务 · {row.submission.resourceId}</p></div>}
      {['KB-05','PLG-04'].includes(row.ticketType) && <div><p>创建方式 · {row.creationMode}</p>
        {row.evidenceRefs?.filter(e=>e.filename).map(e=><p key={e.evidenceId}><a href={'/api/evidence/'+e.evidenceId+'/file'}>{e.filename}</a></p>)}
        {row.attempts?.map(a=><p key={a.command.executionId}>执行节点 · {a.command.action} · {a.execution?.status ?? '等待结果'} · {a.command.executionId}</p>)}
        {!!row.execution?.result?.details && <details className="technical-details"><summary>详细信息</summary><pre>{JSON.stringify(row.execution.result.details,null,2)}</pre></details>}
      </div>}
      {row.ticketType==='PLG-04' && <div>
        <details className="technical-details"><summary>详细信息</summary><pre>{JSON.stringify(row.alertEvidence,null,2)}</pre></details>
        {row.restoreRequest && <details className="technical-details"><summary>详细信息</summary><pre>{JSON.stringify(row.restoreRequest,null,2)}</pre></details>}
        {row.observeUntil && <p>恢复观察 · {row.observeFrom} 至 {row.observeUntil} · {row.observation?.verdict ?? '尚未采集'}</p>}
        {row.observationError && <p role="status">观察等待核对 · {row.observationError.code}</p>}
        {row.urgentEventNo && <p>关联紧急事件 · {row.urgentEventNo}</p>}
        {view==='todo' && row.status==='已禁用待确认' && <PluginRestoreForm key={row.ticketNo+'-'+row.revision} disabled={busy} onSubmit={fields=>act('申请恢复',fields)}/>}
      </div>}
      {row.linkedDispositionTicketNo && <p>关联处置工单 · {row.linkedDispositionTicketNo}</p>}
      {row.linkedReviewDispositionTicketNo && <p>人工追加处置工单 · {row.linkedReviewDispositionTicketNo}</p>}
      {row.relatedTicketNos?.map(number=><p key={number}>关联来源工单 · {number}</p>)}
      {row.linkError && <p role="status">处置工单关联等待重试 · {row.linkError.code}</p>}
      {(row.approvedImpact ?? row.agentImpact) && <AgentImpactPanel impact={(row.approvedImpact ?? row.agentImpact)!}/>}
      <RecordDetails title="申请内容" values={row.submission.fields}/>
      {['AG-02','AG-04'].includes(row.ticketType) && (() => {
        const deps=row.snapshot.data?.dependencies ?? []
        const summary=row.snapshot.data?.dependencySummary
        const counts=summary?.counts ?? {
          knowledge:deps.filter(d=>d.kind==='knowledge').length,
          plugin:deps.filter(d=>d.kind==='plugin').length,
          mcp:deps.filter(d=>d.kind==='mcp').length,
          tool:deps.filter(d=>d.kind==='tool').length,
        }
        const warnCount=warnings.length
        return <section style={{margin:'12px 0',padding:'12px 14px',borderRadius:8,border:`1px solid ${warnCount>0?'#f59e0b':'#cbd5e1'}`,background:warnCount>0?'rgba(245,158,11,0.06)':'rgba(15,23,42,0.02)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:8}}>
            <h4 style={{margin:0}}>智能体内部组件合规核验</h4>
            <span style={{fontSize:12,fontWeight:600,padding:'2px 8px',borderRadius:999,background:warnCount>0?'#fef3c7':'#dcfce7',color:warnCount>0?'#b45309':'#15803d'}}>
              {warnCount>0?`发现 ${warnCount} 项待确认风险组件`:'自动核验通过'}
            </span>
          </div>
          <p style={{margin:'0 0 8px',fontSize:13,color:'var(--muted,#64748b)'}}>
            知识库 {counts.knowledge ?? 0} · 插件 {counts.plugin ?? 0} · MCP {counts.mcp ?? 0} · 自定义工具 {counts.tool ?? 0}
            {row.snapshot.data?.mode ? `（应用模式：${row.snapshot.data.mode}）` : ''}
          </p>
          {deps.length===0 ? (
            <p style={{margin:0,fontSize:13,color:'#15803d'}}>已自动扫描 Dify 应用配置，当前未绑定外部知识库、插件、MCP 或自定义 HTTP 工具，无高风险组件依赖。</p>
          ) : (
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{borderBottom:'1px solid #e2e8f0',textAlign:'left'}}>
                  <th style={{padding:'6px 8px'}}>组件类型</th>
                  <th style={{padding:'6px 8px'}}>组件名称 / 标识</th>
                  <th style={{padding:'6px 8px'}}>核验结论</th>
                  <th style={{padding:'6px 8px'}}>核验说明</th>
                </tr>
              </thead>
              <tbody>
                {deps.map((d,idx)=>{
                  const ok=d.approved && d.externalAllowed
                  return <tr key={`${d.kind ?? 'dep'}-${d.id ?? idx}`} style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td style={{padding:'6px 8px'}}>{d.kindLabel || d.kind || '组件'}</td>
                    <td style={{padding:'6px 8px'}}><strong>{d.name}</strong></td>
                    <td style={{padding:'6px 8px',fontWeight:600,color:ok?'#15803d':'#b45309'}}>{d.status || (ok?'合规通过':'未审告警')}</td>
                    <td style={{padding:'6px 8px',color:'var(--muted,#475569)'}}>{d.reason || (ok?'符合平台安全策略':'未通过对应专项审核')}</td>
                  </tr>
                })}
              </tbody>
            </table>
          )}
        </section>
      })()}
      {['SKL-01','PLG-01','SKL-02','PLG-02'].includes(row.ticketType) && <details className="technical-details"><summary>详细信息</summary><pre>{JSON.stringify(row.snapshot.data,null,2)}</pre></details>}
      {row.snapshot.fields && <RecordDetails title="资源核验" values={row.snapshot.fields}/>}
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
      {row.approvedFields?.文档确认记录?.map(c=><p key={c.documentId}>安全复核 · {c.documentId} · {c.verdict} · {c.actor} · {c.at}</p>)}
      {warnings.map((d,i)=><p key={i}>资源告警 · {d.name}</p>)}
      {row.history.length>0 && <section className="application-history"><h4>办理记录</h4><ol>{row.history.map((item,index)=><li key={index}><time>{when(item.at)}</time><span>{item.actor==='system'?'系统':item.actor} · {historyText(item.action)}{item.note?` · ${historyText(item.note)}`:''}</span></li>)}</ol></section>}
      <details className="technical-details"><summary>技术明细</summary><pre>{JSON.stringify({申请:row.submission.fields,核验:row.snapshot.fields ?? null},null,2)}</pre></details>
      {actions.length>0 && <div className="application-actions">
        <label style={{display:'flex',flexDirection:'column',gap:6}}>{noteLabel}
          <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder={applicantAction?'写一句撤回原因':'写一句办理意见，例如：同意发布'} rows={3}/>
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
        {view==='todo' && ['TOL-01','MCP-01'].includes(row.ticketType) && row.status==='待受理' && <fieldset disabled={busy}><legend>安全复核</legend>
          <label>安全审查结果<select value={securityVerdict} onChange={e=>setSecurityVerdict(e.target.value)}><option>通过</option><option>不通过</option></select></label>
          <label>安全审查意见<textarea value={securityNote} onChange={e=>setSecurityNote(e.target.value)}/></label>
          <label>对外使用权限<select value={externalAllowed} onChange={e=>setExternalAllowed(e.target.value)}><option>禁止</option><option>允许</option></select></label>
        </fieldset>}
        {view==='todo' && row.ticketType==='SKL-02' && row.status==='待受理' && <label>历史版本下载策略<select value={historyPolicy} onChange={e=>setHistoryPolicy(e.target.value)}><option>保留且不可新增下载</option><option>继续可下载</option></select></label>}
        {view==='todo' && ['PLG-01','PLG-02'].includes(row.ticketType) && row.status==='待受理' && <label>对外使用权限<select value={externalAllowed} onChange={e=>setExternalAllowed(e.target.value)}><option>禁止</option><option>允许</option></select></label>}
        {view === 'todo' && row.ticketType === 'AG-05' && row.status === '待受理' && (
          <AgentDisposalScopeField value={disposalScope} onChange={setDisposalScope} disabled={busy} />
        )}
        {view === 'todo' && ['AG-02', 'AG-04'].includes(row.ticketType) && warnings.length > 0 && (
          <AgentRiskDecisionField checked={risk} onChange={setRisk} disabled={busy} />
        )}
        <div style={{display:'flex',gap:8,alignItems:'center',marginTop:10}}>
          {actions.map(action=>{
            const isPrimary=['批准','批准恢复','确认审查','确认结果','提交变更审查','重试执行'].includes(action)
            return <button key={action} className={isPrimary?'primary-button':'secondary-button'} disabled={busy || !note.trim()} onClick={()=>act(action)}>{action}</button>
          })}
          {!note.trim() && <span style={{fontSize:12,color:'var(--muted,#64748b)'}}>{applicantAction?'请先填写撤回说明':'请先填写办理意见'}</span>}
        </div>
      </div>}
    </div>}{error && <p role="alert">{error}</p>}
  </section>
}
