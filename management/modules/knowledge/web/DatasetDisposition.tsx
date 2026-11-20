import {useEffect,useRef,useState} from 'react'
import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {readDirectoryPages as pages} from '../../../shared-ui/directory-pages'
type Evidence={evidenceId:string;filename:string}
type Candidate={resourceId:string;name:string;source:string;sourceScopeId:string;sourceResourceId:string}
type Context={resourceId:string;disposableDocumentIds:string[];fields:{'知识库名称':string;'来源系统':string;'源workspace/tenant ID':string;'源知识库ID':string;'文档清单':{documentId:string;sha256:string}[];'影响中的授权数':number;'影响中的智能体数':number}}
export function DatasetDisposition() {
  const [form,setForm]=useState({resourceId:'',target:'整库',reason:'主动下架',facts:''})
  const [documentIds,setDocumentIds]=useState<string[]>([]),[items,setItems]=useState<Candidate[]>([]),[selected,setSelected]=useState(''),[query,setQuery]=useState('')
  const [context,setContext]=useState<Context|null>(null)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  const [evidence,setEvidence]=useState<Evidence[]>([])
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [evidenceIds,setEvidenceIds]=useState<string[]>([])
  const draft=useApplicationDraft('KB-05',{...form,evidenceIds,documentIds},({evidenceIds,...value})=>{controller.current?.abort();setForm({resourceId:value.resourceId,target:value.target,reason:value.reason,facts:value.facts});setDocumentIds([]);setItems([]);setSelected('');setContext(null);setEvidence([]);setEvidenceIds(evidenceIds);setMessage('')})
  const {ticketNo}=draft
  useEffect(()=>{
    let active=true
    Promise.allSettled(evidenceIds.map(async id=>{
      const r=await fetch('/api/evidence/'+encodeURIComponent(id)+'?forApplication=1')
      const data=await r.json();if(!r.ok || data.evidenceId!==id)throw Error('附件引用不可用 · '+id)
      return data as Evidence
    })).then(results=>{if(active){setEvidence(results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]));
      if(results.some(r=>r.status==='rejected'))setMessage('部分附件未通过本人归属核验，请重新读取或移除此引用')}})
    return()=>{active=false}
  },[evidenceIds])
  const evidenceReady=evidenceIds.every(id=>evidence.some(item=>item.evidenceId===id))
  const gaps=()=>submissionGaps([['目录知识库与完整清单',selected===form.resourceId && context?form.resourceId:''],['事实说明',form.facts],
    ['文档选择',form.target==='指定文档'?documentIds.length?'已选择':'':'整库'],
    ['证据附件',evidenceReady && (!['内容违规','权限越界'].includes(form.reason) || evidenceIds.length)?'ready':'']])
  async function loadCandidates(){
    controller.current?.abort();const request=new AbortController();controller.current=request
    setBusy(true);setMessage('');setItems([]);setSelected('');setContext(null);setDocumentIds([])
    try{
      const rows=await pages('/api/execution-candidates?'+new URLSearchParams({ticketType:'KB-05',action:'dispose_dataset',q:query.trim()}),(row:unknown):row is Candidate=>!!row && typeof row==='object' &&
        ['resourceId','name','source','sourceScopeId','sourceResourceId'].every(key=>typeof (row as Candidate)[key as keyof Candidate]==='string' && !!(row as Candidate)[key as keyof Candidate].trim()),request.signal)
      if(new Set(rows.map(row=>row.resourceId)).size!==rows.length)throw Error('处置候选存在重复目录ID')
      if(!request.signal.aborted){setItems(rows);setMessage(rows.length?'请选择有处置申请资格的知识库':'当前身份没有可处置候选')}
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function selectResource(resourceId:string){
    controller.current?.abort();setSelected(resourceId);setForm(current=>({...current,resourceId}));setContext(null);setDocumentIds([]);setMessage('')
    const row=items.find(item=>item.resourceId===resourceId);if(!row)return
    const request=new AbortController();controller.current=request;setBusy(true)
    try{
      const response=await fetch('/api/execution-contexts?'+new URLSearchParams({ticketType:'KB-05',action:'dispose_dataset',resourceId}),{signal:request.signal});const data=await response.json(),f=data.fields
      if(!response.ok)throw Error(data.error?.message ?? '完整清单读取失败')
      if(data.resourceId!==resourceId || data.eligible!==true || f?.['来源系统']!==row.source || f?.['源workspace/tenant ID']!==row.sourceScopeId || f?.['源知识库ID']!==row.sourceResourceId || f?.['清单完整']!==true || !Array.isArray(f?.['文档清单']) || !Array.isArray(data.disposableDocumentIds))throw Error('处置依据与所选知识库来源不匹配')
      if(!request.signal.aborted)setContext(data)
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'清单读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  async function upload(file:File) {
    setBusy(true);setMessage('')
    try {
      const r=await fetch('/api/evidence',{method:'POST',headers:{'content-type':'application/octet-stream',
        'x-filename':encodeURIComponent(file.name)},body:file})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '证据上传失败')
      setEvidence(previous=>[...previous,data]);setEvidenceIds(previous=>[...previous,data.evidenceId])
    }catch(e){setMessage(e instanceof Error?e.message:'证据上传失败')}
    finally{setBusy(false)}
  }
  async function submit() {
    const gap=gaps()
    if(gap){setMessage(gap);return}
    if(!evidenceReady)return
    setBusy(true);setMessage('')
    try {
      const {resourceId,...fields}=form
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'KB-05',resourceId,fields:{...fields,
          documentIds:form.target==='指定文档'?documentIds:[],
          evidenceIds}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }
  return <fieldset className="form-section" disabled={busy || draft.controller.busy}><legend>知识库下架与违规处置申请</legend>
    <label>处置知识库搜索<input value={query} maxLength={200} onChange={event=>setQuery(event.target.value)}/></label>
    <button onClick={loadCandidates}>读取可处置知识库</button>
    {form.resourceId && selected!==form.resourceId && <p>待重新选择 · {form.resourceId}</p>}
    <label>目录知识库 ID<select aria-label="目录知识库 ID" value={selected} onChange={event=>void selectResource(event.target.value)}><option value="">请选择</option>{items.map(row=><option key={row.resourceId} value={row.resourceId}>{row.name} · {row.source} · {row.resourceId}</option>)}</select></label>
    {context && <fieldset><legend>知识库处置依据</legend>{(['知识库名称','来源系统','源workspace/tenant ID','源知识库ID','影响中的授权数','影响中的智能体数'] as const).map(key=><label key={key}>{key}<input aria-label={key} readOnly value={String(context.fields[key])}/></label>)}<p>完整文档数 · {context.fields['文档清单'].length}</p></fieldset>}
    <label>处置对象<select aria-label="处置对象" value={form.target} onChange={e=>{setForm({...form,target:e.target.value});setDocumentIds([])}}><option>整库</option><option>指定文档</option></select></label>
    {form.target==='指定文档' && <fieldset><legend>选择当前清单中的文档（最多100份）</legend>{context?.fields['文档清单'].map(doc=><label key={doc.documentId}><input type="checkbox" aria-label={'处置文档 '+doc.documentId} checked={documentIds.includes(doc.documentId)} disabled={!context.disposableDocumentIds.includes(doc.documentId) || documentIds.length>=100 && !documentIds.includes(doc.documentId)} onChange={event=>setDocumentIds(current=>event.target.checked?[...current,doc.documentId]:current.filter(id=>id!==doc.documentId))}/>{doc.documentId} · {doc.sha256}{!context.disposableDocumentIds.includes(doc.documentId) && ' · 当前不可停用'}</label>)}</fieldset>}
    <label>处置原因<select aria-label="处置原因" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}>{['主动下架','内容违规','权限越界','数据过期','其他'].map(s=><option key={s}>{s}</option>)}</select></label>
    <label>事实说明<textarea value={form.facts} onChange={e=>setForm({...form,facts:e.target.value})}/></label>
    <label>证据附件（每份最多10MB）<input type="file" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value=''}}/></label>
    {evidenceIds.map(id=><p key={id}>{evidence.some(e=>e.evidenceId===id)?<a href={'/api/evidence/'+id+'/file'}>{evidence.find(e=>e.evidenceId===id)?.filename}</a>:<span>待核验附件 · {id}</span>}
      <button onClick={()=>setEvidenceIds(previous=>previous.filter(e=>e!==id))}>移除此附件引用</button></p>)}
    <button className="primary-button" disabled={!evidenceReady} onClick={submit}>提交知识库处置审批</button>
    <button className="secondary-button" onClick={()=>setMessage(gaps() || readyToSubmit)}>检查</button>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{message}</p>
  </fieldset>
}
