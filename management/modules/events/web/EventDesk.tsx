import { useEffect, useState } from 'react'
import { AlertTriangle, Calendar, FileText, RefreshCw, ShieldAlert, User } from 'lucide-react'

type Attachment = {evidenceId:string; filename:string; sha256:string; sizeBytes:number}
type Entry = {ticketNo:string; facts:string; resourceId:string; account:string; status:string; revision:number;handledByCurrent?:boolean;originalSeverity?:string;ruleCode?:string;sourceTicketNo?:string; handler?:string;objectType?:string;alertId?:string;attachments?:Attachment[];disposition?:{actions:string[];result:string;linkedTicketNos?:string[];recovered?:boolean;recoveredAt?:string};assessment?:{severity:string;conclusion:string;cause:string;impact:string};
  history:{at:string; actor:string; action:string; note?:string}[]}
type Related = {ticketNo:string; ticketType:string; status:string}
const draftTypes: Record<string, string> = {停用文档:'KB-05', 隔离MCP:'MCP-03', 下架应用:'AG-05', 撤销密钥:'KEY-02'}
const decisions:Record<string,string[]>={'未研判':['开始处置','提交误报复核'],'处理中':['提交复核'],'已重开':['开始处置'],'待复核':['确认关闭','继续观察','重新处置']}

function eventTone(status: string): 'pending'|'progress'|'success'|'danger'|'muted' {
  if (['未研判', '待复核', '已重开'].includes(status)) return 'pending'
  if (status === '处理中') return 'progress'
  if (status === '已关闭') return 'success'
  return 'muted'
}

export function EventDesk({view,account}:{view:string;account:string}) {
  const [items,setItems]=useState<Entry[]>([])
  const [selected,setSelected]=useState('')
  const [disposition,setDisposition]=useState({actions:['观察'],result:'',recovered:false,recoveredAt:''})
  const [deadline,setDeadline]=useState('')
  const [linkedNumbers,setLinkedNumbers]=useState('')
  const [assessment,setAssessment]=useState({severity:'一般',conclusion:'真实故障',cause:'未知',impact:''})
  const [note,setNote]=useState('')
  const [error,setError]=useState('')
  const [named,setNamed]=useState<{id:string;name:string}|null>(null)
  const [nameMap,setNameMap]=useState<Record<string,string>>({})
  const [related,setRelated]=useState<Related[]>([])
  const [picked,setPicked]=useState<string[]>([])
  const [reload,setReload]=useState(0)
  const [busy,setBusy]=useState(false)

  useEffect(()=>{
    let active=true
    fetch('/api/events?view='+view).then(async response=>{
      if(!response.ok) throw Error('无法读取事件工单')
      const data=await response.json()
      if(active) {
        setItems(data.items)
        setSelected(prev=>data.items.some((i:Entry)=>i.ticketNo===prev)?prev:(data.items[0]?.ticketNo ?? ''))
        setError('')
      }
    }).catch(e=>{if(active)setError(e.message)})
    return ()=>{active=false}
  },[view,reload])

  useEffect(()=>{
    if(!items.length)return
    let active=true
    Promise.all(['agent','plugin','mcp','skill'].map(k=>fetch('/api/catalog?kind='+k).then(r=>r.ok?r.json():{items:[]}).catch(()=>({items:[]})))).then(results=>{
      if(!active)return
      const map:Record<string,string>={}
      for(const res of results) for(const it of (res.items ?? [])) if(it?.resourceId && it?.name) map[it.resourceId]=it.name
      setNameMap(map)
    })
    return ()=>{active=false}
  },[items])

  const row=items.find(item=>item.ticketNo===selected)
  const objectKind=({插件:'plugin',MCP:'mcp',智能体:'agent',智能体仓库:'agent'} as Record<string,string>)[row?.objectType ?? '']
  const objectName=!row || !objectKind ? '未采集' : named?.id===row.resourceId ? named.name : (nameMap[row.resourceId] || '未采集')

  useEffect(()=>{
    if(!row || !objectKind)return
    let active=true
    const id=row.resourceId
    fetch('/api/catalog?kind='+objectKind).then(async response=>{
      const data=await response.json()
      if(!response.ok)throw Error()
      const found=data.items?.find((item:{resourceId:string;name?:string})=>item.resourceId===id)
      if(active)setNamed({id,name:found?.name || '未采集'})
    }).catch(()=>{if(active)setNamed({id,name:'未采集'})})
    return ()=>{active=false}
  },[row,objectKind])

  useEffect(()=>{
    if(view!=='todo')return
    let active=true
    Promise.all([
      fetch('/api/applications?view=query').then(async response=>response.ok?(await response.json()).items:[]),
      fetch('/api/tickets?view=query').then(async response=>response.ok?(await response.json()).items:[]),
    ]).then(([applications,tickets])=>{
      if(!active || !row)return
      const rows=[...applications.map((item:{ticketNo:string;ticketType:string;status:string;submission?:{resourceId?:string};execution?:{status?:string}})=>item.submission?.resourceId===row.resourceId && item.execution?.status==='succeeded'?{ticketNo:item.ticketNo,ticketType:item.ticketType,status:item.status}:null),
        ...tickets.map((item:{ticketNo:string;ticketType:string;selection?:string;status:string})=>item.selection===row.resourceId && item.status==='succeeded'?{ticketNo:item.ticketNo,ticketType:item.ticketType,status:'已完成'}:null)].filter((item):item is Related=>!!item)
      setRelated(rows)
    }).catch(()=>{if(active)setRelated([])})
    return ()=>{active=false}
  },[view,row])

  async function transition(action:string) {
    if(!row) return
    setBusy(true);setError('')
    try {
      const response=await fetch('/api/events/transition',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({ticketNo:row.ticketNo,revision:row.revision,assessment,disposition:{...disposition,linkedTicketNos:[...new Set([...linkedNumbers.split(',').map(v=>v.trim()).filter(Boolean),...picked])]},note,action,observeUntil:action==='继续观察' && deadline ? new Date(deadline).toISOString() : undefined})})
      const data=await response.json()
      if(!response.ok) throw Error(data.error?.message ?? '办理失败')
      setItems(items=>items.map(item=>item.ticketNo===row.ticketNo?data:item).filter(item=>view!=='todo'||item.status!=='已关闭'))
      setNote('')
    } catch(e){setError(e instanceof Error?e.message:'办理失败')}
    finally {setBusy(false)}
  }

  const when=(v?:string)=>v && Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('zh-CN',{hour12:false}):(v || '—')

  return (
    <section className="app-workbench">
      <aside className="app-workbench-list">
        <div className="app-list-header">
          <div className="app-list-title">
            <h3>事件工单</h3>
            <span className="app-count-badge">{items.length}</span>
          </div>
          <button className="app-icon-btn" disabled={busy} onClick={()=>setReload(v=>v+1)}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} />
            <span>刷新事件</span>
          </button>
        </div>

        <div className="app-ticket-scroll">
          {items.length === 0 ? (
            <div className="app-empty-state">
              <FileText size={28} strokeWidth={1.5} />
              <p>当前暂无异常事件工单</p>
            </div>
          ) : items.map(item => {
            const active = item.ticketNo === row?.ticketNo
            const title = nameMap[item.resourceId] || item.objectType || item.resourceId
            return (
              <button
                key={item.ticketNo}
                disabled={busy}
                className={`app-ticket-card ${active ? 'is-active' : ''}`}
                onClick={()=>{setSelected(item.ticketNo);setLinkedNumbers(item.disposition?.linkedTicketNos?.join(', ') ?? '');setDeadline('');setNote('');setError('');setDisposition(item.disposition ? {...item.disposition,recovered:item.disposition.recovered ?? false,recoveredAt:item.disposition.recoveredAt ?? ''} : {actions:['观察'],result:'',recovered:false,recoveredAt:''});setAssessment(item.assessment ?? {severity:'一般',conclusion:'真实故障',cause:'未知',impact:''})}}
              >
                <div className="app-ticket-card-top">
                  <span className="app-type-tag">EVT-01 · {item.objectType || '事件'}</span>
                  <span className={`app-status-pill tone-${eventTone(item.status)}`}>{item.status}</span>
                </div>
                <div className="app-ticket-card-name">{title}</div>
                <div className="app-ticket-card-meta">
                  <span>上报人 {item.account}</span>
                  <span>{when(item.history?.[0]?.at).split(' ')[0]}</span>
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
            <ShieldAlert size={36} strokeWidth={1.4} />
            <h4>请选择左侧事件工单</h4>
            <p>点击任意事件卡片查看事件事实、研判结论、处置记录与双人复核操作。</p>
          </div>
        ) : (
          <article className="app-detail-sheet">
            <header className="app-sheet-header">
              <div className="app-sheet-title-row">
                <div className="app-sheet-title-main">
                  <span className="app-type-tag lg">EVT-01</span>
                  <div>
                    <h2>{nameMap[row.resourceId] || objectName || row.resourceId}</h2>
                    <div className="app-sheet-subtitle">
                      <span>安全与运行事件研判处置</span>
                      <span className="dot">·</span>
                      <code>{row.ticketNo}</code>
                    </div>
                  </div>
                </div>
                <span className={`app-status-pill lg tone-${eventTone(row.status)}`}>{row.status}</span>
              </div>
              <div className="app-sheet-meta-bar">
                <span><User size={13}/> 上报人：<strong>{row.account}</strong></span>
                <span>对象类型：<strong>{row.objectType || '—'}</strong></span>
                <span><Calendar size={13}/> 上报时间：<strong>{when(row.history?.[0]?.at)}</strong></span>
              </div>
            </header>

            <div className="app-sheet-body">
              <section className="record-details">
                <h4>事件基本事实</h4>
                <dl className="record-grid">
                  <div><dt>目录对象名称</dt><dd>{objectName}</dd></div>
                  <div><dt>对象标识</dt><dd>{row.resourceId}</dd></div>
                  <div style={{gridColumn:'1 / -1'}}><dt>事实说明</dt><dd>{row.facts}</dd></div>
                  {row.originalSeverity && <div><dt>原始级别 / 规则</dt><dd>{row.originalSeverity} · {row.ruleCode}</dd></div>}
                  {row.sourceTicketNo && <div><dt>关联来源工单</dt><dd>{row.sourceTicketNo}</dd></div>}
                  {row.assessment && <div style={{gridColumn:'1 / -1'}}><dt>研判结论</dt><dd>{row.assessment.severity} · {row.assessment.conclusion} · 根因：{row.assessment.cause}{row.assessment.impact ? ` · 影响：${row.assessment.impact}` : ''}</dd></div>}
                  {row.disposition && <div style={{gridColumn:'1 / -1'}}><dt>处置情况</dt><dd>{row.disposition.actions.join('、')} · {row.disposition.result}{row.disposition.linkedTicketNos?.length ? ` · 关联工单：${row.disposition.linkedTicketNos.join('、')}` : ''}</dd></div>}
                </dl>
              </section>

              <div data-testid="event-attachments" className="app-audit-card">
                <div className="app-audit-head">
                  <h4 style={{margin:0,fontSize:14}}>事件证据附件（{(row.attachments ?? []).length}）</h4>
                  <label className="app-icon-btn" style={{cursor:'pointer'}}>
                    <span>+ 补充附件</span>
                    <input aria-label="事件附件" type="file" style={{display:'none'}} disabled={busy} onChange={async event=>{
                      const file=event.target.files?.[0];event.target.value=''
                      if(!file)return
                      setBusy(true)
                      try {
                        const uploaded=await fetch('/api/evidence',{method:'POST',headers:{'x-filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()})
                        const evidence=await uploaded.json();if(!uploaded.ok)throw Error(evidence.error?.message ?? '附件上传失败')
                        const saved=await fetch('/api/events/attachments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticketNo:row.ticketNo,revision:row.revision,evidenceId:evidence.evidenceId,filename:evidence.filename,sha256:evidence.sha256,sizeBytes:evidence.sizeBytes})})
                        const data=await saved.json();if(!saved.ok)throw Error(data.error?.message ?? '附件登记失败')
                        setItems(items=>items.map(item=>item.ticketNo===row.ticketNo?data:item));setError('')
                      }catch(reason){setError(reason instanceof Error?reason.message:'附件登记失败')}
                      finally{setBusy(false)}
                    }}/>
                  </label>
                </div>
                {(row.attachments ?? []).length === 0 ? (
                  <p className="app-link-note">暂无证据附件，可点击右上角上传。</p>
                ) : (row.attachments ?? []).map(item=>(
                  <p key={item.evidenceId} className="app-link-note"><a href={'/api/evidence/'+item.evidenceId+'/file'}>{item.filename}</a> · <code>{item.sha256.slice(0,16)}...</code></p>
                ))}
              </div>

              {row.history.length > 0 && (
                <section className="app-timeline-section">
                  <h4>研判与处置流转记录</h4>
                  <ol className="app-timeline">
                    {row.history.map((h,i)=>(
                      <li key={h.at+h.action+i} className={i===row.history.length-1?'is-latest':''}>
                        <div className="app-timeline-dot"/>
                        <div className="app-timeline-content">
                          <div className="app-timeline-row">
                            <strong>{h.action}</strong>
                            <span className="app-timeline-actor">{h.actor}</span>
                            <time>{when(h.at)}</time>
                          </div>
                          {h.note && <p className="app-timeline-note">{h.note}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {view==='todo' && decisions[row.status] && (
                row.status==='待复核' && (row.handledByCurrent || row.handler===account) ? (
                  <div className="app-banner info">该事件已由您完成处置，需等待另一名运维人员进行双人独立复核。</div>
                ) : (
                  <section className="app-action-card">
                    <h4>事件研判与处置</h4>
                    {row.status==='未研判' && (
                      <>
                        <div className="form-row">
                          {([['severity','研判级别',['提示','一般','严重','紧急']],['conclusion','研判结论',['真实故障','安全事件','误报','重复告警']],['cause','根因分类',['资源','网络','产品服务','插件代码','权限','数据','未知']]] as const).map(([key,label,options])=>(
                            <label key={key} className="app-action-field"><span>{label}</span><select value={assessment[key]} onChange={e=>setAssessment({...assessment,[key]:e.target.value})}>{options.map(o=><option key={o}>{o}</option>)}</select></label>
                          ))}
                        </div>
                        <label className="app-action-field"><span>影响范围</span><textarea value={assessment.impact} placeholder="请描述受影响范围与业务影响程度" onChange={e=>setAssessment({...assessment,impact:e.target.value})} rows={2}/></label>
                      </>
                    )}
                    {row.status==='处理中' && (
                      <>
                        <label className="app-action-field"><span>处置动作</span><select multiple value={disposition.actions} onChange={e=>setDisposition({...disposition,actions:Array.from(e.target.selectedOptions,o=>o.value)})}>{['观察','重试','禁用插件','停用文档','隔离MCP','下架应用','撤销密钥','转其他工单'].map(a=><option key={a}>{a}</option>)}</select></label>
                        <label className="app-action-field"><span>关联处置工单号（逗号分隔）</span><input value={linkedNumbers} onChange={e=>setLinkedNumbers(e.target.value)}/></label>
                        <fieldset><legend>选择已完成处置</legend>{related.map(item=><label key={item.ticketNo}><input type="checkbox" checked={picked.includes(item.ticketNo)} onChange={event=>setPicked(values=>event.target.checked?[...values,item.ticketNo]:values.filter(value=>value!==item.ticketNo))}/>{item.ticketType} · {item.ticketNo}</label>)}{related.length===0 && <p className="app-link-note">当前对象暂无已完成的关联工单。</p>}</fieldset>
                        <button className="secondary-button" type="button" disabled={busy} onClick={async ()=>{
                          const action=disposition.actions.find(item=>draftTypes[item])
                          if(!action){setError(disposition.actions.includes('禁用插件')?'插件禁用由系统告警创建 PLG-04，不能从事件手工新建':'请选择可创建草稿的处置动作');return}
                          setBusy(true)
                          try {
                            const ticketType=draftTypes[action]
                            const fields=ticketType==='KB-05'?{resourceId:row.resourceId,target:'目录',documents:'',reason:'安全问题',facts:row.facts}:ticketType==='MCP-03'?{resourceId:row.resourceId,workspaceId:'',operation:'目录隔离',targetAccount:'',reason:'安全问题',facts:row.facts}:ticketType==='AG-05'?{resourceId:row.resourceId,workspaceId:'',reason:'安全事件',explanation:row.facts,replacementAppId:'',effectiveAt:''}:{resourceId:row.resourceId,operation:'撤销',reason:row.facts,effectiveAt:'',newExpiresAt:''}
                            const response=await fetch('/api/drafts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draftId:'evt-'+row.ticketNo+'-'+ticketType,revision:0,ticketType,fields})})
                            const data=await response.json();if(!response.ok)throw Error(data.error?.message ?? '关联草稿创建失败')
                            setError('');setNote(note || '已创建 '+ticketType+' 草稿 '+data.draftId)
                          }catch(reason){setError(reason instanceof Error?reason.message:'关联草稿创建失败')}
                          finally{setBusy(false)}
                        }}>创建关联处置草稿</button>
                        <label className="app-action-field"><span>处置结果</span><textarea value={disposition.result} onChange={e=>setDisposition({...disposition,result:e.target.value})} rows={2}/></label>
                        <label><input type="checkbox" checked={disposition.recovered} onChange={e=>setDisposition({...disposition,recovered:e.target.checked})}/> 已恢复</label>
                        {disposition.recovered && <label className="app-action-field"><span>恢复时间</span><input type="datetime-local" value={disposition.recoveredAt} onChange={e=>setDisposition({...disposition,recoveredAt:e.target.value})}/></label>}
                      </>
                    )}
                    <label className="app-action-field"><span>办理依据 <em className="req">*</em></span><textarea value={note} placeholder="请输入研判/处置/复核意见（必填）" onChange={e=>setNote(e.target.value)} rows={3}/></label>
                    {row.status==='待复核' && <label className="app-action-field"><span>继续观察至</span><input type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label>}
                    <div className="app-action-footer">
                      <div className="app-action-buttons">
                        {decisions[row.status].map(action=>{
                          const isPrimary=['开始处置','提交复核','确认关闭'].includes(action)
                          return <button key={action} className={isPrimary?'primary-button':'secondary-button'} disabled={busy||!note.trim()||(action==='继续观察' && !deadline)} onClick={()=>transition(action)}>{action}</button>
                        })}
                      </div>
                      {!note.trim() && <span className="app-action-hint">请先填写办理依据</span>}
                    </div>
                  </section>
                )
              )}

              {error && <div className="app-banner danger" role="alert"><AlertTriangle size={15}/> {error}</div>}
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
