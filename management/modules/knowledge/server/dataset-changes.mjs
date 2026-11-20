import {check,same} from '../../../../runtime/http.mjs'
const text=v=>typeof v==='string' && v.trim() && v.length<=4000
const hash=v=>/^[a-f0-9]{64}$/.test(v)
export async function datasetChangesContext(cap,headers,resourceId,sourceEventId) {
  const query=new URLSearchParams({action:'review_dataset_changes',resourceId,sourceEventId})
  const raw=await(await cap('/execution-contexts/KB-04?'+query,'GET',undefined,headers)).json()
  const f=raw.fields
  check(raw.ticketType==='KB-04' && raw.action==='review_dataset_changes' && raw.resourceId===resourceId && text(raw.snapshotId) &&
    f && f['变更事件ID']===sourceEventId && text(f['所有者账户名']) && ['Dify','RAGFlow'].includes(f['来源系统']) &&
    text(f['源知识库ID']) && text(f['workspace/tenant ID']) && text(f['知识库名称']) &&
    text(f['上次快照ID']) && text(f['当前快照ID']) && f['上次快照ID']!==f['当前快照ID'] &&
    text(f['文档清单快照ID']) && text(f['处置证据事件ID']) && text(f['人工处置证据事件ID']) &&
    f['处置证据事件ID']!==f['人工处置证据事件ID'] && ['已发布','暂停分享'].includes(f['原目录状态']) &&
    Array.isArray(f['变更明细']) && f['变更明细'].length>0 && f['变更明细'].every(d=>text(d.documentId) && text(d.name) &&
      ['新增','修改','删除'].includes(d.changeType) && hash(d.sha256) &&
      (d.changeType==='删除' || ['通过','不通过'].includes(d.autoVerdict))) &&
    new Set(f['变更明细'].map(d=>d.documentId)).size===f['变更明细'].length &&
    ['新增','修改','删除'].every((kind,index)=>f[['新增文档数','变更文档数','删除文档数'][index]]===f['变更明细'].filter(d=>d.changeType===kind).length) &&
    Array.isArray(raw.preconditions) && raw.preconditions.some(p=>p.kind==='dataset' && p.id===resourceId && Number.isInteger(p.revision)) &&
    raw.preconditions.some(p=>p.kind==='dataset_manifest' && p.id===f['文档清单快照ID'] && hash(p.sha256)),409,'INCOMPLETE_DATASET_CHANGES')
  const changes=f['变更明细'].map(d=>({documentId:d.documentId,name:d.name,changeType:d.changeType,sha256:d.sha256,
    ...(d.changeType!=='删除'?{autoVerdict:d.autoVerdict}:{})}))
  return {snapshotId:raw.snapshotId,resourceId,preconditions:raw.preconditions,fields:{
    ...Object.fromEntries(['变更事件ID','所有者账户名','来源系统','源知识库ID','workspace/tenant ID','知识库名称','上次快照ID',
      '当前快照ID','文档清单快照ID','处置证据事件ID','人工处置证据事件ID','原目录状态','新增文档数','变更文档数','删除文档数'].map(k=>[k,f[k]])),
    '变更明细':changes,'文档审查明细':changes.filter(d=>d.changeType!=='删除').map(d=>({documentId:d.documentId,sha256:d.sha256,autoVerdict:d.autoVerdict})),
    '自动审查结论':changes.some(d=>d.autoVerdict==='不通过')?'不通过':'通过'}}
}
export function unchangedDatasetChanges(previous,current,relatedPauseSucceeded=false) {
  const fields={...previous.fields}
  if(relatedPauseSucceeded && current.fields['原目录状态']==='暂停分享')fields['原目录状态']='暂停分享'
  const stable=conditions=>conditions.filter(p=>!relatedPauseSucceeded || p.kind!=='dataset' || p.id!==previous.resourceId)
  check(same(fields,current.fields) && same(stable(previous.preconditions),stable(current.preconditions)) &&
    (!relatedPauseSucceeded || current.fields['原目录状态']==='暂停分享' && previous.preconditions.filter(p=>p.kind==='dataset' && p.id===previous.resourceId)
      .every(old=>current.preconditions.some(p=>p.kind===old.kind && p.id===old.id && p.revision>=old.revision))),409,'STALE_SNAPSHOT','知识库变化依据已更新，需按新快照重新复核')
}
export function confirmDatasetChanges(snapshot,input,actor,at) {
  const docs=snapshot.fields['文档审查明细']
  check(['通过','不通过'].includes(input.reviewVerdict) && Array.isArray(input.confirmations) &&
    input.confirmations.length===docs.length && new Set(input.confirmations.map(c=>c.documentId)).size===docs.length &&
    docs.every(d=>input.confirmations.some(c=>c.documentId===d.documentId && c.sha256===d.sha256 &&
      ['通过','不通过'].includes(c.verdict) && (d.autoVerdict==='通过' || c.verdict==='不通过'))),400,'DOCUMENT_CONFIRMATION_REQUIRED')
  check(input.reviewVerdict==='不通过' || input.confirmations.every(c=>c.verdict==='通过'),400,'REVIEW_VERDICT_CONFLICT')
  const confirmations=input.confirmations.map(c=>({documentId:c.documentId,sha256:c.sha256,verdict:c.verdict,actor,at}))
  return {'来源系统':snapshot.fields['来源系统'],'源知识库ID':snapshot.fields['源知识库ID'],
    '上次快照ID':snapshot.fields['上次快照ID'],'当前快照ID':snapshot.fields['当前快照ID'],
    '文档清单快照ID':snapshot.fields['文档清单快照ID'],'变更明细':snapshot.fields['变更明细'],
    '文档确认记录':confirmations,'运维确认结论':input.reviewVerdict,'运维确认意见':input.note,
    '新目录状态':input.reviewVerdict==='通过' && snapshot.fields['原目录状态']==='已发布'?'保持发布':'暂停分享'}
}
export function changesDisposition(row,confirmed) {
  const docs=row.snapshot.fields['文档审查明细']
  let failed=confirmed?confirmed.filter(c=>c.verdict==='不通过').map(c=>c.documentId):docs.filter(d=>d.autoVerdict==='不通过').map(d=>d.documentId)
  // An overall rejection may concern the entire library even when each individual document passed.
  if(confirmed && !failed.length)failed=docs.map(d=>d.documentId)
  if(confirmed && row.pendingDisposition) {
    const initial=row.pendingDisposition.fields
    if(initial.target==='整库')return null
    failed=failed.filter(key=>!initial.documentIds.includes(key))
    if(!failed.length && docs.length)return null
  }
  return {sourceEventId:row.snapshot.fields[confirmed?'人工处置证据事件ID':'处置证据事件ID'],resourceId:row.submission.resourceId,
    fields:{target:failed.length?'指定文档':'整库',documentIds:failed,reason:'内容违规',facts:'知识库变更审查不通过；关联工单 '+row.ticketNo}}
}
