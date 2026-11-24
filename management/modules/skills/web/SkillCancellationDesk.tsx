import {useEffect,useState} from 'react'
type Row={ticketNo:string;executionId:string;status:string;cancelStatus:string|null;cancelError:string|null}
export function SkillCancellationDesk() {
  const [rows,setRows]=useState<Row[]>([]),[reload,setReload]=useState(0),[selected,setSelected]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let active=true;fetch('/api/tickets?view=todo').then(async r=>{
    if(!r.ok)throw Error('读取文件执行待办失败')
    const data=await r.json();if(active)setRows(data.items)
  }).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[reload])
  const row=rows.find(r=>r.ticketNo===selected)
  async function act(action:'cancel'|'reconcile') {
    if(!row)return
    setBusy(true)
    try {
      const r=await fetch('/api/tickets/'+encodeURIComponent(row.ticketNo)+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({executionId:row.executionId,note})})
      const data=await r.json();if(!r.ok)throw Error(data.error?.message ?? '取消未确认')
      setError(data.cancelError?'取消仍待查证 · '+data.cancelError:'');setNote('');setReload(v=>v+1)
    }catch(e){setError(e instanceof Error?e.message:'取消未确认')}
    finally{setBusy(false)}
  }
  return <section className="panel list-panel">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:8}}>
      <h3 style={{margin:0}}>Skill文件执行待办（{rows.length} 条）</h3>
      <button className="secondary-button" disabled={busy} onClick={()=>{setError('');setReload(v=>v+1)}}>刷新文件待办</button>
    </div>
    {rows.length===0 && <p style={{color:'var(--muted,#64748b)',margin:'4px 0'}}>暂无 Skill 文件执行待办</p>}
    {rows.map(r=><button key={r.ticketNo} disabled={busy} onClick={()=>{setSelected(r.ticketNo);setNote('');setError('')}}>{r.ticketNo} · {r.status} · {r.cancelStatus ?? '尚未取消'}</button>)}
    {row && <div className="editor-section"><p>执行编号 · {row.executionId}</p><p>在途或未知交付须先查证，再申请取消。</p>
      {row.cancelError && <p>取消等待查证 · {row.cancelError}</p>}
      <label>文件办理意见<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>
      <button disabled={busy || !note.trim()} onClick={()=>act('reconcile')}>查证文件原执行</button>
      <button disabled={busy || !note.trim()} onClick={()=>act('cancel')}>{row.cancelStatus?'重新查证取消':'申请取消文件执行'}</button>
    </div>}{error && <p role="status">{error}</p>}
  </section>
}
