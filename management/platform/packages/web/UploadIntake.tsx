import {useEffect,useState} from 'react'
export type Intake={intakeId:string;status:string;sha256?:string;sizeBytes?:number;filename?:string;packageMetadata?:{uniqueIdentifier:string;name:string;version:string;dependencies:{name:string;version:string;license:string}[]};scan?:{verdict:string}}
export function UploadIntake({kind,onReady,onReference,onBusyChange,initialReference=''}:{kind:'skill'|'plugin';onReady?:(intake:Intake|null)=>void;
  onReference?:(intakeId:string)=>void;onBusyChange?:(busy:boolean)=>void;initialReference?:string}) {
  const [file,setFile]=useState<File|null>(null)
  const [uploadKey,setUploadKey]=useState(()=>crypto.randomUUID())
  const [intake,setIntake]=useState<Intake|null>(null)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(!!initialReference)
  useEffect(()=>{
    if(!initialReference)return
    let active=true;onBusyChange?.(true)
    fetch('/api/intake/'+kind+'/'+encodeURIComponent(initialReference)).then(async r=>{
      const data=await r.json();if(!r.ok)throw Error(data.error?.message ?? '无法恢复待审引用')
      if(data.intakeId!==initialReference)throw Error('待审引用不匹配')
      if(active){setIntake(data);onReady?.(data.status==='ready'?data:null);setMessage(data.status==='ready'?'待审引用已重新核验':'引用已恢复，等待扫描结果')}
    }).catch(e=>{if(active){onReady?.(null);setMessage(e.message)}}).finally(()=>{if(active){setBusy(false);onBusyChange?.(false)}})
    return()=>{active=false;onBusyChange?.(false)}
  },[initialReference,kind,onReady,onBusyChange])
  async function perform(upload:boolean) {
    if(upload && !file)return
    if(!upload && !intake)return
    setBusy(true);onBusyChange?.(true);onReady?.(null);setMessage('')
    try {
      const form=new FormData()
      if(file)form.set('file',file)
      const response=upload?await fetch('/api/intake/'+kind,{method:'POST',headers:{'Idempotency-Key':uploadKey},body:form}):
        await fetch('/api/intake/'+kind+'/'+encodeURIComponent(intake!.intakeId))
      const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '上传或扫描读取失败')
      setIntake(data);onReference?.(data.intakeId);onReady?.(data.status==='ready'?data:null)
    }catch(e){setMessage(e instanceof Error?e.message:'上传失败')}
    finally{setBusy(false);onBusyChange?.(false)}
  }
  return <fieldset className="form-section" disabled={busy}><legend>{kind==='skill'?'Skill 文件待审上传':'插件包待审上传'}</legend>
    <label>待审文件<input type="file" onChange={e=>{setFile(e.target.files?.[0] ?? null);setUploadKey(crypto.randomUUID());setIntake(null);onReference?.('');onReady?.(null);setMessage('')}}/></label>
    <button className="secondary-button" disabled={!file} onClick={()=>perform(true)}>上传待审文件</button>
    {intake && <div><label>待审引用<input readOnly value={intake.intakeId}/></label>
      <p>状态 · {intake.status}</p>{intake.sha256 && <p>SHA-256 · {intake.sha256}</p>}
      {intake.scan && <p>扫描结论 · {intake.scan.verdict}</p>}
      <button className="secondary-button" onClick={()=>perform(false)}>刷新扫描结果</button>
    </div>}
    <p role="status">{message}</p>
  </fieldset>
}
