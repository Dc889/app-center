import {ApplicationDrafts} from '../../../platform/workflow/public.web'
import {readyToSubmit,submissionGaps} from '../../../shared-ui/form-check'
import {useApplicationDraft} from '../../../platform/workflow/public.web'
import {useEffect,useRef,useState} from 'react'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
import {useResourceSnapshot} from '../../../shared-ui/useResourceSnapshot'
import {PublicationApplicationPicker} from '../../agents/public.web'
import {BUSINESS_LINE_PRESETS,ChipMultiInput,PresetInput,TAG_PRESETS,useOrgOptions} from '../../../shared-ui/PresetFields'

type Context={snapshotId:string;capturedAt:string;fields:Record<string,unknown>;preconditions:unknown[]}
const KB_PURPOSE_PRESETS = [
  '向指定组织共享业务知识库，支撑智能体检索问答',
  '向全网段开放通用规范与法条知识库',
  '随智能体应用一并发布专属业务语料库',
]
const KB_DESC_PRESETS = [
  '覆盖常见业务规范、标准话术与历史典型案例',
  '权威法律法规条文与内部制度文件索引',
  '警情研判与处置预案参考知识库',
]

export function DatasetPublicationContext() {
  const orgs = useOrgOptions()
  const [form,setForm]=useState({shareMode:'共享目录',targetOrgs:'',targetAccounts:'',relatedAppId:'',relatedWorkspaceId:'',purpose:'',boundaryOrgs:'业务一部',classification:'开放',businessLine:'刑侦',name:'',description:'',tags:'',expiresAt:''})
  const [associationVerified,setAssociationVerified]=useState(false),[associationKey,setAssociationKey]=useState(0)
  const [submitted,setSubmitted]=useState(false)
  const [resourceId,setResourceId]=useState('')
  const [workspaceId,setWorkspaceId]=useState('')
  const [sourceSystem,setSourceSystem]=useState('Dify')
  const [pickerKey,setPickerKey]=useState(0)
  const resource=useResourceSnapshot()
  const controller=useRef<AbortController|null>(null)
  const scopeRef=useRef('')
  useEffect(()=>()=>{controller.current?.abort()},[])
  const [context,setContext]=useState<Context|null>(null)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const draft=useApplicationDraft('KB-02',{...form,resourceId,workspaceId,sourceSystem},({resourceId,workspaceId,sourceSystem,...value})=>{setForm(value);setAssociationVerified(false);setAssociationKey(key=>key+1);setResourceId(resourceId);setWorkspaceId(workspaceId);setSourceSystem(sourceSystem);setPickerKey(key=>key+1);resource.reset();controller.current?.abort();setContext(null);setSubmitted(false);setMessage('')})
  const {ticketNo}=draft

  async function read(scope=scopeRef.current, selectedId=resourceId) {
    if(!selectedId)return
    setBusy(true);setContext(null);setMessage('');setAssociationVerified(false);setAssociationKey(key=>key+1)
    controller.current?.abort()
    const request=new AbortController();controller.current=request
    try {
      const params=new URLSearchParams({ticketType:'KB-02',action:'publish_dataset',resourceId:selectedId})
      if(scope)params.set('workspaceId',scope)
      const r=await fetch('/api/execution-contexts?'+params,{signal:request.signal})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '审批依据读取失败')
      const f=data.fields,docs=f?.['文档审查明细']
      if(data.ticketType!=='KB-02' || data.action!=='publish_dataset' || data.resourceId!==selectedId ||
        typeof data.snapshotId!=='string' || !data.snapshotId.trim() || typeof data.capturedAt!=='string' || !Number.isFinite(Date.parse(data.capturedAt)) ||
        f?.['来源系统']!==sourceSystem || f?.['workspace/tenant ID']!==scope || typeof f?.['所有者账户名']!=='string' || !f['所有者账户名'] ||
        !Array.isArray(docs) || !Number.isInteger(f['文档数']) || f['文档数']!==docs.length ||
        !docs.every((d:Record<string,unknown>)=>d && typeof d.documentId==='string' && d.documentId && typeof d.sha256==='string' && /^[a-f0-9]{64}$/.test(d.sha256)) ||
        new Set(docs.map((d:{documentId:string})=>d.documentId)).size!==docs.length ||
        typeof f['文档清单快照ID']!=='string' || !f['文档清单快照ID'] || !Array.isArray(data.preconditions) ||
        !data.preconditions.some((p:Record<string,unknown>)=>p && p.kind==='dataset_manifest' && p.id===f['文档清单快照ID'] && typeof p.sha256==='string' && /^[a-f0-9]{64}$/.test(p.sha256)))throw Error('文档审查依据与所选来源、范围或文档清单不匹配，请重新读取')
      if(!request.signal.aborted)setContext(data)
    }catch(e){if(!request.signal.aborted)setMessage(e instanceof Error?e.message:'读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }

  async function submit() {
    const gap=submissionGaps([['知识库名称',resourceId],['文档审查与模型核对',context?.snapshotId ?? ''],['申请说明',form.purpose],['组织边界',form.boundaryOrgs],['业务线',form.businessLine],['目录展示名称',form.name],['目录简介',form.description],['目录标签',form.tags]])
    if(gap){setMessage(gap);return}
    if(form.shareMode==='随应用发布' && (!form.relatedAppId || !form.relatedWorkspaceId || !associationVerified)){setMessage('请重新选择并核验关联应用和Dify工作区');return}
    if(!context)return
    setBusy(true)
    try {
      const list=(v:string)=>v.split(',').map(s=>s.trim()).filter(Boolean)
      const r=await draft.submit('/api/applications',{
        ticketNo,ticketType:'KB-02',resourceId,workspaceId,
        fields:{...form,sourceSystem,targetOrgs:list(form.targetOrgs),targetAccounts:list(form.targetAccounts),
          boundaryOrgs:list(form.boundaryOrgs),tags:list(form.tags),expiresAt:form.expiresAt?new Date(form.expiresAt).toISOString():null}})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '提交失败')
      setSubmitted(true);setMessage(data.ticketNo+' · '+data.status)
    }catch(e){setMessage(e instanceof Error?e.message:'提交失败')}
    finally{setBusy(false)}
  }

  const scanDocs = Array.isArray(context?.fields?.['文档审查明细']) ? (context!.fields['文档审查明细'] as {documentId:string;name?:string;autoVerdict:string}[]) : []

  return <fieldset className="form-section" disabled={busy || resource.busy || draft.controller.busy}><legend>知识库分享申请</legend>
    <fieldset disabled={submitted}><legend>来源知识库</legend>
      <label>来源系统<select aria-label="来源系统" value={sourceSystem} onChange={e=>{controller.current?.abort();setAssociationVerified(false);setAssociationKey(key=>key+1);setSourceSystem(e.target.value);setResourceId('');scopeRef.current='';setWorkspaceId('');setContext(null);setPickerKey(key=>key+1);resource.reset();setMessage('')}}><option>RAGFlow</option><option>Dify</option></select></label>
      <ResourcePicker key={pickerKey} kind={sourceSystem==='Dify'?'dify_dataset':'ragflow_dataset'} hideWorkspace nameOnly autoLoad searchLabel="知识库搜索" searchAction="搜索" resourceLabel="知识库名称" value={{resourceId,workspaceId}} onChange={(value,verified)=>{
        controller.current?.abort();setAssociationVerified(false);setAssociationKey(key=>key+1);resource.reset();setResourceId(value.resourceId);scopeRef.current=value.workspaceId;setWorkspaceId(value.workspaceId);setContext(null);setMessage('')
        if(verified)void resource.read(sourceSystem==='Dify'?'dify_dataset':'ragflow_dataset',value.resourceId,value.workspaceId).then(snapshot=>{
          if(!snapshot)return
          const scope=sourceSystem==='RAGFlow'?String(snapshot.data.tenantId ?? ''):(snapshot.workspaceId || value.workspaceId)
          scopeRef.current=scope
          setWorkspaceId(scope)
          const dsName=String(snapshot.data.name ?? '')
          if(dsName)setForm(cur=>({...cur,name:cur.name || dsName}))
        })
      }}/>
      <button className="secondary-button" disabled={!resource.snapshot} onClick={()=>read()}>读取文档审查与模型核对</button>
    </fieldset>
    {context && (
      <div className="app-audit-card is-pass" style={{marginBlock:12}}>
        <div className="app-audit-head">
          <div className="app-audit-title">
            <h4>文档与敏感词扫描核验</h4>
            <span className="app-mode-chip">文档数：{String(context.fields['文档数'] ?? 0)}</span>
            <span className="app-mode-chip">模型核对：{String(context.fields['模型目录核对结果'] ?? '—')}</span>
          </div>
          <span className="app-status-pill tone-success">{String(context.fields['关键词扫描结论'] ?? '扫描通过')}</span>
        </div>
        {!!context.fields['关键词扫描规则版本'] && <p className="app-link-note">扫描引擎：{String(context.fields['关键词扫描规则版本'])}</p>}
        {scanDocs.length > 0 && (
          <div className="app-audit-table-wrap">
            <table className="app-audit-table">
              <thead><tr><th>文档名称</th><th>自动审查结果</th></tr></thead>
              <tbody>
                {scanDocs.map(d => (
                  <tr key={d.documentId}>
                    <td><strong>{d.name || d.documentId}</strong></td>
                    <td><span className={`app-status-pill tone-${d.autoVerdict==='通过'?'success':'danger'}`}>{d.autoVerdict}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )}
    <fieldset disabled={submitted}><legend>分享内容</legend>
      <div className="form-row">
        <label>密级<select aria-label="密级" value={form.classification} onChange={e=>setForm({...form,classification:e.target.value})}><option>开放</option><option>限定范围</option></select></label>
        <label>分享方式<select aria-label="分享方式" value={form.shareMode} onChange={e=>{setForm({...form,shareMode:e.target.value});setAssociationVerified(false);setAssociationKey(key=>key+1)}}>{['共享目录','指定组织','指定人员','随应用发布'].map(s=><option key={s}>{s}</option>)}</select></label>
      </div>
      <div className="form-row">
        <PresetInput label="业务线" value={form.businessLine} onChange={v=>setForm({...form,businessLine:v})} presets={BUSINESS_LINE_PRESETS} />
        <label>目录展示名称<input value={form.name} placeholder="选择知识库后自动回填，也可修改" onChange={e=>setForm({...form,name:e.target.value})}/></label>
      </div>
      <PresetInput label="申请说明" value={form.purpose} onChange={v=>setForm({...form,purpose:v})} presets={KB_PURPOSE_PRESETS} />
      <PresetInput label="目录简介" value={form.description} onChange={v=>setForm({...form,description:v})} presets={KB_DESC_PRESETS} />
      <ChipMultiInput label="组织边界（逗号分隔）" value={form.boundaryOrgs} onChange={v=>setForm({...form,boundaryOrgs:v})} options={orgs} />
      <ChipMultiInput label="目录标签（逗号分隔）" value={form.tags} onChange={v=>setForm({...form,tags:v})} options={TAG_PRESETS} />
      {form.shareMode==='指定组织' && <ChipMultiInput label="目标组织" value={form.targetOrgs} onChange={v=>setForm({...form,targetOrgs:v})} options={orgs} />}
      {form.shareMode==='指定人员' && <label>目标人员<input value={form.targetAccounts} placeholder="逗号分隔账号，如 chen.yu, zhou.min" onChange={e=>setForm({...form,targetAccounts:e.target.value})}/></label>}
      {form.shareMode==='随应用发布' && <PublicationApplicationPicker key={associationKey} workspaceId={form.relatedWorkspaceId} appId={form.relatedAppId} onWorkspace={value=>{setForm(current=>({...current,relatedWorkspaceId:value}));setAssociationVerified(false)}} onChange={(value,verified)=>{setForm(current=>({...current,relatedAppId:value}));setAssociationVerified(verified)}}/>}
      <label>有效期截止时间（选填）<input type="datetime-local" value={form.expiresAt} onChange={e=>setForm({...form,expiresAt:e.target.value})}/></label>
      <div className="app-action-buttons" style={{marginTop:12}}>
        <button className="primary-button" onClick={submit}>提交申请</button>
        <button className="secondary-button" onClick={()=>setMessage(submissionGaps([['知识库名称',resourceId],['文档审查与模型核对',context?.snapshotId ?? ''],['申请说明',form.purpose],['组织边界',form.boundaryOrgs],['业务线',form.businessLine],['目录展示名称',form.name],['目录简介',form.description],['目录标签',form.tags]]) || readyToSubmit)}>检查</button>
      </div>
    </fieldset>
    <ApplicationDrafts draft={draft.controller}/><p role="status">{resource.error || message}</p>
  </fieldset>
}
