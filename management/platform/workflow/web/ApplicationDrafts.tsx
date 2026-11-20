import {useState} from 'react'
import type {DraftController} from './useApplicationDraft'
export function ApplicationDrafts({draft}:{draft:DraftController}) {
  const [error,setError]=useState('')
  async function save(){try{setError('');await draft.save()}catch(e){setError(e instanceof Error?e.message:'保存失败')}}
  return <section className="editor-section"><h4>申请草稿</h4>
    <button disabled={draft.busy || !!draft.current && draft.current.status!=='draft'} onClick={save}>保存申请草稿</button>
    <button disabled={draft.busy} onClick={()=>{setError('');draft.fresh()}}>新建申请草稿</button>
    <button disabled={draft.busy} onClick={()=>draft.reload().catch(e=>setError(e.message))}>刷新申请草稿</button>
    {draft.rows.map(row=><div key={row.draftId}>{row.status==='draft'?<button disabled={draft.busy || row.canRestore===false} onClick={()=>{setError('');void draft.restore(row)}}>
      恢复草稿 · {String(row.fields.resourceId || row.fields.subjectId || row.fields.name || '未填写对象')} · {row.updatedAt}</button>:
      <p>{row.status==='submitted'?'已提交':'提交待查证'} · {row.submission?.ticketNo ?? row.draftId}</p>}
      {row.canRecover && <button disabled={draft.busy} onClick={()=>{setError('');void draft.restore(row,true)}}>恢复未受理草稿</button>}
      {row.restoreBlockedCode && <p>草稿需重新核对 · {row.restoreBlockedCode}</p>}</div>)}
    <p role="status">{error || draft.message}</p>
  </section>
}
