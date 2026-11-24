import {useEffect,useState} from 'react'
import {RecordDetails} from '../../../shared-ui/RecordDetails'
import {AlertTriangle,FileText,RefreshCw,UserCheck} from 'lucide-react'

type Row={ticketNo:string;subjectId:string;status:string;revision:number;canCancel?:boolean;submission:{fields:Record<string,unknown>};snapshot:{fields:unknown};target:unknown;localCommit?:unknown;
  recovery?:unknown;lastError?:{code:string};command?:{executionId:string};execution?:{result?:{retryable?:boolean;details?:unknown;failureCode?:string}};history:{at:string;actor:string;action:string;note?:string}[]}

function accTone(status: string): 'pending'|'progress'|'success'|'danger'|'muted' {
  if (['待受理','待生效'].includes(status)) return 'pending'
  if (['执行中','待结果确认'].includes(status)) return 'progress'
  if (status === '已完成') return 'success'
  if (['已驳回','执行失败'].includes(status)) return 'danger'
  return 'muted'
}

export function AccountDesk({view}:{view:string}) {
  const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState(''),[note,setNote]=useState(''),[message,setMessage]=useState('')
  const [reload,setReload]=useState(0),[busy,setBusy]=useState(false)

  useEffect(()=>{
    let active=true
    fetch('/api/account-applications?view='+view).then(async r=>{
      if(!r.ok)throw Error('无法读取账号工单')
      const data=await r.json()
      if(active){
        setRows(data.items)
        setSelected(prev=>data.items.some((v:Row)=>v.ticketNo===prev)?prev:(data.items[0]?.ticketNo ?? ''))
        setMessage('')
      }
    }).catch(e=>{if(active)setMessage(e.message)})
    return()=>{active=false}
  },[view,reload])

  const row=rows.find(v=>v.ticketNo===selected)
  async function act(action:string) {
    if(!row)return
    setBusy(true)
    try {
      const r=await fetch('/api/account-applications/transition',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticketNo:row.ticketNo,revision:row.revision,action,note})})
      const data=await r.json();if(!r.ok)throw Error(data.error?.message ?? '办理失败')
      setNote('');setReload(v=>v+1);setMessage('')
    }catch(e){setMessage(e instanceof Error?e.message:'办理失败')}
    finally{setBusy(false)}
  }

  const actions=!row?[]:row.status==='待受理'?(view==='mine'?['撤回']:['批准','驳回']):row.status==='待结果确认'?['确认结果']:
    row.status==='执行失败' && !row.localCommit?[...(row.execution?.result?.retryable?['重试执行']:[]),'核验恢复并解锁']:
    row.canCancel?['取消待生效']:row.status==='执行中' && row.command?['查证原执行']:[]
  const when=(v?:string)=>v && Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('zh-CN',{hour12:false}):(v || '—')
  const titleOf=(v:Row)=>String(v.submission?.fields?.account || v.submission?.fields?.newAccount || v.submission?.fields?.oldAccount || v.subjectId)

  return (
    <section className="app-workbench">
      <aside className="app-workbench-list">
        <div className="app-list-header">
          <div className="app-list-title">
            <h3>管理员账号工单</h3>
            <span className="app-count-badge">{rows.length}</span>
          </div>
          <button className="app-icon-btn" disabled={busy} onClick={()=>setReload(v=>v+1)}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} />
            <span>刷新账号工单</span>
          </button>
        </div>

        <div className="app-ticket-scroll">
          {rows.length === 0 ? (
            <div className="app-empty-state">
              <FileText size={28} strokeWidth={1.5} />
              <p>当前暂无账号变更工单</p>
            </div>
          ) : rows.map(v => (
            <button key={v.ticketNo} disabled={busy} className={`app-ticket-card ${v.ticketNo===row?.ticketNo?'is-active':''}`} onClick={()=>{setSelected(v.ticketNo);setNote('');setMessage('')}}>
              <div className="app-ticket-card-top">
                <span className="app-type-tag">{v.ticketNo.startsWith('ACC-02')?'ACC-02':'ACC-01'}</span>
                <span className={`app-status-pill tone-${accTone(v.status)}`}>{v.status}</span>
              </div>
              <div className="app-ticket-card-name">{titleOf(v)}</div>
              <div className="app-ticket-card-no">{v.ticketNo}</div>
            </button>
          ))}
        </div>
      </aside>

      <div className="app-workbench-detail">
        {!row ? (
          <div className="app-detail-empty">
            <UserCheck size={36} strokeWidth={1.4} />
            <h4>请选择左侧账号工单</h4>
            <p>点击任意工单卡片查看跨平台账号变更详情与审批进度。</p>
          </div>
        ) : (
          <article className="app-detail-sheet">
            <header className="app-sheet-header">
              <div className="app-sheet-title-row">
                <div className="app-sheet-title-main">
                  <span className="app-type-tag lg">{row.ticketNo.startsWith('ACC-02')?'ACC-02':'ACC-01'}</span>
                  <div>
                    <h2>{titleOf(row)}</h2>
                    <div className="app-sheet-subtitle">
                      <span>跨平台账号权限/账户名变更</span>
                      <span className="dot">·</span>
                      <code>{row.ticketNo}</code>
                    </div>
                  </div>
                </div>
                <span className={`app-status-pill lg tone-${accTone(row.status)}`}>{row.status}</span>
              </div>
            </header>

            <div className="app-sheet-body">
              {row.status==='执行失败' && !row.localCommit && <div className="app-banner danger"><AlertTriangle size={15}/> 确认两端已恢复并完成核验后，方可解锁。</div>}
              {row.lastError && <div className="app-banner danger" role="alert"><AlertTriangle size={15}/> 账号执行需查证 · {row.lastError.code}</div>}
              {row.execution?.result?.failureCode && <div className="app-banner danger"><AlertTriangle size={15}/> 执行失败 · {row.execution.result.failureCode} · 未完成核对前保留目标操作限制</div>}

              <RecordDetails title="申请信息" values={row.submission.fields}/>
              <RecordDetails title="当前状态" values={row.snapshot.fields}/>
              <RecordDetails title="变更目标" values={row.target}/>

              {row.history.length > 0 && (
                <section className="app-timeline-section">
                  <h4>审批与执行记录</h4>
                  <ol className="app-timeline">
                    {row.history.map((h,i)=>(
                      <li key={i} className={i===row.history.length-1?'is-latest':''}>
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

              {actions.length > 0 && (
                <section className="app-action-card">
                  <h4>管理员办理</h4>
                  <label className="app-action-field"><span>账号办理意见 <em className="req">*</em></span><textarea value={note} placeholder="请输入审批或核验说明（必填）" onChange={e=>setNote(e.target.value)} rows={3}/></label>
                  <div className="app-action-footer">
                    <div className="app-action-buttons">
                      {actions.map(action=>{
                        const isPrimary=['批准','确认结果','重试执行','核验恢复并解锁'].includes(action)
                        const isDanger=['驳回','取消待生效'].includes(action)
                        return <button key={action} className={isPrimary?'primary-button':isDanger?'danger-outline-button':'secondary-button'} disabled={busy || !note.trim()} onClick={()=>act(action)}>{action}</button>
                      })}
                    </div>
                    {!note.trim() && <span className="app-action-hint">请先填写账号办理意见</span>}
                  </div>
                </section>
              )}

              {message && <div className="app-banner info" role="status">{message}</div>}

              <details className="app-raw-payload">
                <summary>查看执行与恢复报文（供排障使用）</summary>
                <pre>{JSON.stringify({申请:row.submission.fields,当前事实:row.snapshot.fields,批准目标:row.target,本地提交:row.localCommit,分步结果:row.execution?.result?.details,恢复核验证明:row.recovery},null,2)}</pre>
              </details>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
