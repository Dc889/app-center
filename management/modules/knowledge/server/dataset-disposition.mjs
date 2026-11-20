import {check,same} from '../../../../runtime/http.mjs'
export const datasetDispositions=['目录下架','暂停分享','停用文档','撤销未到期授权']
const text=value=>typeof value==='string' && value.trim() && value.length<=4000
export async function datasetDispositionCandidates(cap,headers,input) {
  check(input.get('action')==='dispose_dataset',400,'INVALID_DISPOSITION_CANDIDATES')
  const query=new URLSearchParams({action:'dispose_dataset'})
  for(const key of ['q','cursor','limit']){
    const value=input.get(key)
    if(value){check(value.length<=200 && (key!=='limit' || /^\d{1,3}$/.test(value) && Number(value)>=1 && Number(value)<=100),400,'INVALID_QUERY');query.set(key,value)}
  }
  const raw=await(await cap('/execution-contexts/KB-05/candidates?'+query,'GET',undefined,headers)).json()
  check(raw && Array.isArray(raw.items) && (raw.nextCursor===null || typeof raw.nextCursor==='string' && raw.nextCursor.trim() && raw.nextCursor.length<=200) &&
    raw.items.every(row=>row && ['resourceId','name','sourceScopeId','sourceResourceId'].every(key=>text(row[key]) && row[key].length<=200) && ['Dify','RAGFlow'].includes(row.source)) &&
    new Set(raw.items.map(row=>row.resourceId)).size===raw.items.length,503,'INVALID_DISPOSITION_CANDIDATES')
  return {items:raw.items.map(({resourceId,name,source,sourceScopeId,sourceResourceId})=>({resourceId,name,source,sourceScopeId,sourceResourceId})),nextCursor:raw.nextCursor}
}
export function validateDatasetDisposition(fields) {
  check(fields && ['整库','指定文档'].includes(fields.target) &&
    ['主动下架','内容违规','权限越界','数据过期','其他'].includes(fields.reason) && text(fields.facts) &&
    Array.isArray(fields.documentIds) && fields.documentIds.length<=100 && fields.documentIds.every(text) &&
    new Set(fields.documentIds).size===fields.documentIds.length &&
    (fields.target==='指定文档'?fields.documentIds.length>0:fields.documentIds.length===0),400,'INVALID_DATASET_DISPOSITION')
}
export async function datasetDispositionContext(cap,headers,resourceId,fields,action='dispose_dataset',sourceEventId) {
  const query=new URLSearchParams({action,resourceId})
  if(sourceEventId)query.set('sourceEventId',sourceEventId)
  const raw=await(await cap('/execution-contexts/KB-05?'+query,'GET',undefined,headers)).json()
  check(raw?.eligible!==false,403,'DATASET_DISPOSITION_DENIED')
  const f=raw?.fields
  check(raw && raw.ticketType==='KB-05' && raw.action===action && raw.resourceId===resourceId && raw.eligible===true && text(raw.snapshotId) && f &&
    text(f['知识库名称']) && text(f['源workspace/tenant ID']) &&
    ['Dify','RAGFlow'].includes(f['来源系统']) && text(f['源知识库ID']) && text(f['文档清单快照ID']) &&
    f['清单完整']===true && Array.isArray(f['文档清单']) &&
    f['文档清单'].every(d=>d && text(d.documentId) && /^[a-f0-9]{64}$/.test(d.sha256)) &&
    new Set(f['文档清单'].map(d=>d.documentId)).size===f['文档清单'].length &&
    ['影响中的授权数','影响中的智能体数'].every(key=>Number.isSafeInteger(f[key]) && f[key]>=0) &&
    Array.isArray(f['处置目标清单']) && f['处置目标清单'].length>0 && f['处置目标清单'].every(t=>t && ['平台','Dify','RAGFlow'].includes(t.system) &&
      text(t.objectId) && datasetDispositions.includes(t.action) && (t.action==='停用文档'?f['文档清单'].some(d=>d.documentId===t.documentId):!t.documentId)) &&
    new Set(f['处置目标清单'].map(t=>JSON.stringify([t.system,t.objectId,t.action,t.documentId ?? null]))).size===f['处置目标清单'].length &&
    Array.isArray(raw.preconditions) && raw.preconditions.filter(p=>p && p.kind==='dataset' && p.id===resourceId).length===1 &&
    raw.preconditions.some(p=>p && p.kind==='dataset' && p.id===resourceId && Number.isSafeInteger(p.revision) && p.revision>=0) &&
    raw.preconditions.filter(p=>p && p.kind==='dataset_manifest' && p.id===f['文档清单快照ID']).length===1 &&
    raw.preconditions.some(p=>p && p.kind==='dataset_manifest' && p.id===f['文档清单快照ID'] && /^[a-f0-9]{64}$/.test(p.sha256)) &&
    raw.preconditions.every(p=>p && text(p.kind) && text(p.id) && Object.keys(p).every(key=>['kind','id','revision','version','sha256'].includes(key)) &&
      (p.revision===undefined || Number.isSafeInteger(p.revision) && p.revision>=0) && (p.version===undefined || typeof p.version==='string') && (p.sha256===undefined || /^[a-f0-9]{64}$/.test(p.sha256))),
    409,'INCOMPLETE_DATASET_DISPOSITION')
  check(fields.documentIds.every(key=>f['文档清单'].some(d=>d.documentId===key)),409,'DOCUMENT_NOT_IN_SNAPSHOT')
  check(fields.documentIds.every(key=>f['处置目标清单'].some(t=>t.action==='停用文档' && t.documentId===key)),409,'DOCUMENT_DISPOSITION_UNSUPPORTED')
  if(sourceEventId)check(f['告警ID']===sourceEventId && Array.isArray(f['告警证据']) && f['告警证据'].length &&
    f['告警证据'].every(e=>e && text(e.evidenceId) && /^[a-f0-9]{64}$/.test(e.sha256)),409,'INVALID_ALERT_EVIDENCE')
  // Persist the allowlisted facts only; document bodies and unknown adapter fields stay outside management.
  const fieldsSafe=Object.fromEntries(['知识库名称','来源系统','源workspace/tenant ID','源知识库ID','文档清单快照ID','清单完整','影响中的授权数','影响中的智能体数'].map(key=>[key,f[key]]))
  fieldsSafe['文档清单']=f['文档清单'].map(({documentId,sha256})=>({documentId,sha256}))
  fieldsSafe['处置目标清单']=f['处置目标清单'].map(({system,objectId,action,documentId})=>({system,objectId,action,...documentId?{documentId}:{}}))
  if(sourceEventId){fieldsSafe['告警ID']=f['告警ID'];fieldsSafe['告警证据']=f['告警证据'].map(({evidenceId,sha256})=>({evidenceId,sha256}))}
  return {snapshotId:raw.snapshotId,resourceId,fields:fieldsSafe,preconditions:raw.preconditions}
}
export function approveDatasetDisposition(previous,current,input) {
  const fields=previous.submission.fields
  check(same(previous.snapshot.fields,current.fields) &&
    (previous.creationMode==='告警转单' || same(previous.preconditions,current.preconditions)),409,'STALE_SNAPSHOT')
  const actions=input.dispositionActions
  check(Array.isArray(actions) && actions.length && new Set(actions).size===actions.length &&
    actions.every(a=>datasetDispositions.includes(a)) &&
    (fields.target==='整库' || actions.every(a=>a==='停用文档')) &&
    (!input.recoveryCondition || text(input.recoveryCondition)),400,'INVALID_DISPOSITION_ACTIONS')
  const targets=current.fields['处置目标清单'].filter(t=>actions.includes(t.action) &&
    (fields.target==='整库' || fields.documentIds.includes(t.documentId)))
  check(actions.every(action=>targets.some(t=>t.action===action)) &&
    (!actions.includes('停用文档') || (fields.target==='指定文档'?fields.documentIds:current.fields['文档清单'].map(d=>d.documentId))
      .every(key=>targets.some(t=>t.action==='停用文档' && t.documentId===key))),409,'INCOMPLETE_DISPOSITION_TARGETS')
  return {'创建方式':previous.creationMode,'来源系统':current.fields['来源系统'],'源知识库ID':current.fields['源知识库ID'],
    '处置对象':fields.target,'文档ID列表':fields.documentIds,'文档清单快照ID':current.fields['文档清单快照ID'],
    '处置原因':fields.reason,'事实说明':fields.facts,'证据附件':previous.evidenceRefs,'处置动作':actions,
    'API执行对象清单':targets,'恢复条件':input.recoveryCondition ?? null}
}
