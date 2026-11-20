import {AgentDisposalScopeField, AgentImpactPanel, AgentRiskDecisionField} from '../../modules/agents/public.web'
import type {AgentImpact} from '../../modules/agents/public.web'
import {KnowledgeChangesReviewFieldset, KnowledgeDispositionFieldset, KnowledgeSecurityReviewFieldset} from '../../modules/knowledge/public.web'
import {PluginRestoreForm} from '../../modules/plugins/public.web'
import {useEffect,useState} from 'react'
type Application={agentImpact?:AgentImpact;approvedImpact?:AgentImpact;canQueryExecution?:boolean;ticketNo:string;ticketType:string;account:string;status:string;revision:number;isApplicant?:boolean;restoreRequest?:{reason:string;repairInfo:string;minutes:number};observeFrom?:string;observeUntil?:string;observation?:{verdict:string;complete:boolean};observationError?:{code:string};urgentEventNo?:string;alertEvidence?:unknown[];deliveryBlocked?:boolean;lastError?:{code:string};linkedDispositionTicketNo?:string;linkedReviewDispositionTicketNo?:string;relatedTicketNos?:string[];linkError?:{code:string};creationMode?:string;node?:string;evidenceRefs?:{evidenceId:string;filename?:string}[];attempts?:{command:{executionId:string;action:string};execution?:{status:string}}[];revealState?:string;command?:{action:string};approvedFields?:{文档确认记录?:{documentId:string;sha256:string;verdict:string;actor:string;at:string}[]};execution?:{status:string;result?:{failureCode?:string;failureReason?:string;retryable?:boolean;details?:unknown}};submission:{resourceId:string;fields:Record<string,unknown>};snapshot:{snapshotId:string;fields?:{文档审查明细?:{documentId:string;sha256:string;autoVerdict:string}[]};data?:{dependencies?:{name:string;approved:boolean;externalAllowed:boolean}[]}};history:{at:string;actor:string;action:string;note?:string}[]}
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
      if(active){setItems(data.items);setError('')}
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
  return <section className="panel list-panel"><h3>业务审批申请</h3>
    <button className="secondary-button" disabled={busy} onClick={()=>setReload(v=>v+1)}>刷新发布申请</button>
    {items.map(item=><button key={item.ticketNo} disabled={busy} className="secondary-button" onClick={()=>{setSelected(item.ticketNo);setDocumentVerdicts({});setReviewVerdict('通过');setDispositionActions([]);setRecoveryCondition('');setHistoryPolicy('保留且不可新增下载');setSecret('');setSecurityVerdict('通过');setSecurityNote('');setExternalAllowed('禁止');setConfirmed([]);setNote('');setRisk(false);setError('');setDisposalScope(['仓库下架','撤销访问授权'])}}>{item.ticketNo} · {item.submission.resourceId} · {item.status}</button>)}
    {row && <div className="editor-section"><p>{row.account} · 快照 {row.snapshot.snapshotId}</p>
      {view==='mine' && (row.isApplicant || row.account===account) && row.execution?.status==='succeeded' &&
        (row.ticketType==='KEY-01' || row.ticketType==='KEY-02' && row.command?.action==='rotate_key') &&
        row.revealState!=='shown' && <button disabled={busy} onClick={reveal}>一次性领取密钥</button>}
      {secret && <div><label>一次性密钥<textarea aria-label="一次性密钥" readOnly value={secret}/></label><button onClick={()=>setSecret('')}>关闭密钥展示</button></div>}
      {row.deliveryBlocked && <p role="alert">执行结果需要查证 · {row.lastError?.code}</p>}
      {row.execution?.result?.failureCode && <p>{row.execution.result.failureCode} · {row.execution.result.failureReason}</p>}
      {['KB-05','PLG-04'].includes(row.ticketType) && <div><p>创建方式 · {row.creationMode}</p>
        {row.evidenceRefs?.filter(e=>e.filename).map(e=><p key={e.evidenceId}><a href={'/api/evidence/'+e.evidenceId+'/file'}>{e.filename}</a></p>)}
        {row.attempts?.map(a=><p key={a.command.executionId}>执行节点 · {a.command.action} · {a.execution?.status ?? '等待结果'} · {a.command.executionId}</p>)}
        {!!row.execution?.result?.details && <pre>{JSON.stringify(row.execution.result.details,null,2)}</pre>}
      </div>}
      {row.ticketType==='PLG-04' && <div>
        <pre>{JSON.stringify(row.alertEvidence,null,2)}</pre>
        {row.restoreRequest && <pre>{JSON.stringify(row.restoreRequest,null,2)}</pre>}
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
      <pre>{JSON.stringify(row.submission.fields,null,2)}</pre>
      {['SKL-01','PLG-01','SKL-02','PLG-02'].includes(row.ticketType) && <pre>{JSON.stringify(row.snapshot.data,null,2)}</pre>}
      {row.snapshot.fields && <pre>{JSON.stringify(row.snapshot.fields,null,2)}</pre>}
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
      {row.history.map((h,i)=><p key={i}>{h.at} · {h.actor} · {h.action} · {h.note}</p>)}
      {actions.length>0 && <div><label>{row.ticketType==='KB-04' && view==='mine' && ['待所有者提交','待补正'].includes(row.status)?'变更原因':'办理意见'}<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>
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
        {actions.map(action=><button key={action} disabled={busy || !note.trim()} onClick={()=>act(action)}>{action}</button>)}</div>}
    </div>}{error && <p role="alert">{error}</p>}
  </section>
}
