import {useEffect,useRef,useState} from 'react'
import {readDirectoryPages} from '../../../shared-ui/directory-pages'
type Registration={registrationId:string;appId:string;workspaceId:string;appName?:string;lastFour:string;status:string;revision:number;actions:string[]}
const valid=(value:unknown):value is Registration=>!!value && typeof value==='object' &&
  ['registrationId','appId','workspaceId'].every(key=>typeof (value as Record<string,unknown>)[key]==='string' && !!(value as Record<string,string>)[key]) &&
  typeof (value as Registration).lastFour==='string' && (value as Registration).lastFour.length===4 &&
  Number.isSafeInteger((value as Registration).revision) && (value as Registration).revision>=0 && Array.isArray((value as Registration).actions)
export function KeyRegistrationPicker({action,value,onChange}:{action:'rotate_key'|'revoke_key'|undefined;value:string;onChange:(id:string,verified:boolean)=>void}) {
  const [items,setItems]=useState<Registration[]>([]),[selected,setSelected]=useState(''),[query,setQuery]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>{controller.current?.abort()},[])
  async function load() {
    if(!action)return
    controller.current?.abort()
    const request=new AbortController();controller.current=request
    setBusy(true);setItems([]);setSelected('');setMessage('');onChange(value,false)
    try {
      const rows=await readDirectoryPages('/api/key-registrations?'+new URLSearchParams({action,q:query.trim()}),valid,request.signal)
      if(new Set(rows.map(row=>row.registrationId)).size!==rows.length)throw Error('密钥登记分页存在重复ID，请重新读取')
      const available=rows.filter(row=>['active','expired'].includes(row.status) && row.actions.includes(action))
      if(!request.signal.aborted){setItems(available);setMessage(available.length?'请选择登记；提交时会重新核验':'当前身份没有此动作的可选密钥登记')}
    }catch(error){if(!request.signal.aborted)setMessage(error instanceof Error?error.message:'密钥登记读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
  }
  return <fieldset disabled={busy}><legend>选择密钥登记元数据</legend>
    <label>登记搜索<input maxLength={200} value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <button className="secondary-button" disabled={!action} onClick={load}>读取可操作密钥登记</button>
    {value && selected!==value && <p>待重新选择的登记 · {value}</p>}
    <label>密钥登记 ID<select aria-label="密钥登记 ID" value={selected===value?selected:''} onChange={e=>{setSelected(e.target.value);onChange(e.target.value,items.some(row=>row.registrationId===e.target.value))}}><option value="">请选择</option>{items.map(row=><option key={row.registrationId} value={row.registrationId}>{row.appName ?? row.appId} · {row.registrationId} · 后四位 {row.lastFour}</option>)}</select></label>
    <p role="status">{message}</p>
  </fieldset>
}
