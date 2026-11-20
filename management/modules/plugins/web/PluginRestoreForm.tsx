import {useState} from 'react'
export function PluginRestoreForm({disabled,onSubmit}:{disabled:boolean;onSubmit:(fields:Record<string,unknown>)=>Promise<void>}) {
  const [reason,setReason]=useState(''),[repairInfo,setRepairInfo]=useState(''),[minutes,setMinutes]=useState(5)
  const [files,setFiles]=useState<{evidenceId:string;filename:string}[]>([])
  const [uploading,setUploading]=useState(false),[error,setError]=useState('')
  async function upload(file:File) {
    setUploading(true);setError('')
    try {
      const r=await fetch('/api/evidence',{method:'POST',headers:{'content-type':'application/octet-stream','x-filename':encodeURIComponent(file.name)},body:file})
      const data=await r.json()
      if(!r.ok)throw Error(data.error?.message ?? '上传失败')
      setFiles(previous=>[...previous,data])
    }catch(e){setError(e instanceof Error?e.message:'上传失败')}
    finally{setUploading(false)}
  }
  return <fieldset disabled={disabled || uploading}><legend>插件恢复申请</legend>
    <label>恢复申请原因<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <label>修复说明<textarea value={repairInfo} onChange={e=>setRepairInfo(e.target.value)}/></label>
    <label>恢复观察时长（分钟）<input type="number" min={5} max={1440} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>
    <label>修复附件<input type="file" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value=''}}/></label>
    {files.map(file=><p key={file.evidenceId}>{file.filename}<button onClick={()=>setFiles(previous=>previous.filter(f=>f.evidenceId!==file.evidenceId))}>移除此附件引用</button></p>)}
    <button disabled={!reason.trim() || !repairInfo.trim()} onClick={()=>onSubmit({note:reason,repairInfo,observationMinutes:minutes,evidenceIds:files.map(f=>f.evidenceId)})}>申请恢复</button>
    {error && <p role="alert">{error}</p>}
  </fieldset>
}
