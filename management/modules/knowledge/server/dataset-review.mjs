import {check,same} from '../../../../runtime/http.mjs'

export async function datasetContext(cap,headers,resourceId,workspaceId) {
  const params=new URLSearchParams({action:'publish_dataset',resourceId})
  if(workspaceId)params.set('workspaceId',workspaceId)
  const context=await(await cap('/execution-contexts/KB-02?'+params,'GET',undefined,headers)).json()
  const data=context.fields
  check(context.ticketType==='KB-02' && context.action==='publish_dataset' && context.resourceId===resourceId &&
    typeof context.snapshotId==='string' && data && Array.isArray(data['文档审查明细']) &&
    Number.isInteger(data['文档数']) && data['文档数']===data['文档审查明细'].length &&
    typeof data['文档清单快照ID']==='string' && Array.isArray(context.preconditions) &&
    context.preconditions.some(p=>p.kind==='dataset_manifest' && p.id===data['文档清单快照ID'] && /^[a-f0-9]{64}$/.test(p.sha256)),
    409,'INCOMPLETE_DATASET_EVIDENCE')
  const docs=data['文档审查明细']
  check(docs.every(d=>typeof d.documentId==='string' && d.documentId && /^[a-f0-9]{64}$/.test(d.sha256)) &&
    new Set(docs.map(d=>d.documentId)).size===docs.length,409,'INVALID_DOCUMENT_MANIFEST')
  return context
}

export function confirmDatasetReview(previous,current,confirmations,actor,at) {
  check(['来源系统','所有者账户名','workspace/tenant ID','文档清单快照ID'].every(k=>same(previous.fields[k],current.fields[k])) && same(previous.preconditions,current.preconditions) &&
    same(previous.fields['文档审查明细'],current.fields['文档审查明细']),409,'STALE_SNAPSHOT','文档清单已变化，请重新申请')
  const docs=current.fields['文档审查明细']
  check(current.fields['模型目录核对结果']==='一致',409,'MODEL_NOT_VERIFIED')
  check(docs.every(d=>d.autoVerdict==='通过'),409,'DOCUMENT_REVIEW_FAILED')
  check(Array.isArray(confirmations) && confirmations.length===docs.length &&
    new Set(confirmations.map(d=>d.documentId)).size===docs.length &&
    docs.every(d=>confirmations.some(c=>c.documentId===d.documentId && c.sha256===d.sha256 && c.verdict==='通过')),
    400,'DOCUMENT_CONFIRMATION_REQUIRED','请按相同正文指纹逐项确认文档')
  return docs.map(d=>({documentId:d.documentId,sha256:d.sha256,verdict:'通过',actor,at}))
}
