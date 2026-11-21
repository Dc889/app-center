import {useEffect,useState} from 'react'
import {RecordDetails} from '../../../shared-ui/RecordDetails'
type Row={ticketNo:string;subjectId:string;status:string;revision:number;canCancel?:boolean;submission:{fields:Record<string,unknown>};snapshot:{fields:unknown};target:unknown;localCommit?:unknown;
  recovery?:unknown;lastError?:{code:string};command?:{executionId:string};execution?:{result?:{retryable?:boolean;details?:unknown;failureCode?:string}};history:{at:string;actor:string;action:string;note?:string}[]}
export function AccountDesk({view}:{view:string}) {
  const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState(''),[note,setNote]=useState(''),[message,setMessage]=useState('')
  const [reload,setReload]=useState(0),[busy,setBusy]=useState(false)
  useEffect(()=>{let active=true;fetch('/api/account-applications?view='+view).then(async r=>{
    if(!r.ok)throw Error('无法读取账号工单')
    const data=await r.json();if(active){setRows(data.items);setMessage('')}
  }).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[view,reload])
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
  return <section className="panel list-panel"><h3>管理员账号工单</h3>
    <button className="secondary-button" disabled={busy} onClick={()=>setReload(v=>v+1)}>刷新账号工单</button>
    {rows.map(v=><button key={v.ticketNo} disabled={busy} onClick={()=>{setSelected(v.ticketNo);setNote('');setMessage('')}}>{v.ticketNo} · {v.subjectId} · {v.status}</button>)}
    {row && <div className="editor-section"><RecordDetails title="申请信息" values={row.submission.fields}/><RecordDetails title="当前状态" values={row.snapshot.fields}/><RecordDetails title="变更目标" values={row.target}/><details className="technical-details"><summary>执行与恢复详情</summary><pre>{JSON.stringify({申请:row.submission.fields,当前事实:row.snapshot.fields,批准目标:row.target,本地提交:row.localCommit,分步结果:row.execution?.result?.details,恢复核验证明:row.recovery},null,2)}</pre></details>
      {row.status==='执行失败' && !row.localCommit && <p>确认两端已恢复并完成核验后，方可解锁。</p>}
      {row.lastError && <p role="alert">账号执行需查证 · {row.lastError.code}</p>}
      {row.execution?.result?.failureCode && <p>执行失败 · {row.execution.result.failureCode} · 未完成核对前保留目标操作限制</p>}
      {row.history.map((h,i)=><p key={i}>{h.at} · {h.actor} · {h.action} · {h.note}</p>)}
      {actions.length>0 && <div><label>账号办理意见<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>{actions.map(action=><button key={action} disabled={busy || !note.trim()} onClick={()=>act(action)}>{action}</button>)}</div>}
    </div>}{message && <p role="status">{message}</p>}
  </section>
}
