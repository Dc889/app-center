import {useEffect,useState} from 'react'
import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import type {TicketResult} from '../../../platform/workflow/public.web'
type Item={resourceId:string;name:string;status:string;actions:string[];data:{version:string;sha256:string}}
export function SkillDownloadApplication({account,onMeta}:{account:string;onMeta:(value:{name:string;level:string;line:string})=>void}) {
  const [items,setItems]=useState<Item[]>([]),[resourceId,setResourceId]=useState(''),[version,setVersion]=useState(''),[pendingId,setPendingId]=useState('')
  const [reload,setReload]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[execution,setExecution]=useState<TicketResult|null>(null)
  const draft=useApplicationDraft('SKL-03',{resourceId:resourceId || pendingId,version},value=>{
    setPendingId(value.resourceId);setResourceId('');setVersion(value.version);setItems([]);setExecution(null);setMessage('');setReload(v=>v+1);onMeta({name:'',level:'',line:''})
  })
  useEffect(()=>{
    let active=true
    async function load() {
      const values:Item[]=[],seen=new Set<string>();let cursor=''
      do {
        if(seen.has(cursor))throw Error('目录游标重复，请稍后重新读取')
        seen.add(cursor)
        const r=await fetch('/api/catalog?'+new URLSearchParams({kind:'skill',...cursor?{cursor}:{}}))
        const page=await r.json();if(!r.ok)throw Error(page.error?.message ?? '无法读取Skill目录')
        values.push(...page.items.filter((v:Item)=>v.actions?.includes('download') && ['available','approved'].includes(v.status)));cursor=page.nextCursor ?? ''
      }while(cursor)
      if(active){setItems(values);const item=values.find(v=>v.resourceId===pendingId);setResourceId(item?.resourceId ?? '');
        onMeta({name:item?.name ?? '',level:'',line:''});if(pendingId && !item)setMessage('草稿资源当前不可用，请重新选择')}
    }
    void load().catch(e=>{if(active)setMessage(e.message)})
    return()=>{active=false}
  },[account,reload,pendingId,onMeta])
  const item=items.find(v=>v.resourceId===resourceId)
  const gaps=()=>submissionGaps([['Skill目录',item?.resourceId ?? '']])
  async function submit() {
    const gap=gaps();if(gap){setMessage(gap);return}
    if(!item)return
    setBusy(true)
    try {
      const r=await draft.submit('/api/tickets',{ticketType:'SKL-03',action:'download',resourceId:item.resourceId,account,...version?{version}:{}})
      const data=await r.json();if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setExecution(data);setMessage('')
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  async function download() {
    if(!execution?.downloadUrl)return
    setBusy(true)
    try {
      const r=await fetch(execution.downloadUrl)
      if(!r.ok)throw Error('文件暂不可领取，请查询原流水')
      const url=URL.createObjectURL(await r.blob()),link=document.createElement('a')
      link.href=url;link.download=/filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'skill.txt';link.click()
      setTimeout(()=>URL.revokeObjectURL(url),1000)
      const result=await fetch('/api/tickets/'+encodeURIComponent(execution.ticketNo))
      const data=await result.json();if(!result.ok)throw Error(data.error?.message ?? '回执待查证')
      setExecution(data)
    }catch(e){setMessage(e instanceof Error?e.message:'文件交付待查证')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>Skill下载申请</legend>
    <label>Skill目录<select aria-label="Skill目录" value={resourceId} onChange={e=>{setResourceId(e.target.value);setPendingId(e.target.value);setExecution(null);const selected=items.find(v=>v.resourceId===e.target.value);onMeta({name:selected?.name ?? '',level:'',line:''})}}>
      <option value="">请选择Skill</option>{items.map(v=><option key={v.resourceId} value={v.resourceId}>{v.name} · {v.resourceId}</option>)}
    </select></label>
    {!resourceId && pendingId && <p>草稿资源 · {pendingId} · 需核验当前可下载范围</p>}
    <button onClick={()=>setReload(v=>v+1)}>重新读取Skill目录</button>
    {item && <p>当前版本 · {item.data.version} · SHA-256 {item.data.sha256}</p>}
    <label>下载版本（留空使用最新）<input value={version} onChange={e=>{setVersion(e.target.value);setExecution(null)}}/></label>
    <button className="primary-button" disabled={!item} onClick={submit}>提交申请</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    {execution && <div className="read-source"><span><strong>{execution.ok?'执行完成 · '+execution.resultId:execution.downloadUrl?'等待领取文件':'交付状态待查证'}</strong>
      <small>{execution.ticketNo}{execution.ok?' 已完成':''}</small>{execution.downloadUrl && <button onClick={download}>领取文件</button>}</span></div>}
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
