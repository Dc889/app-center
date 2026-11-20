import {useEffect,useRef,useState} from 'react'
import fieldSchemas from '../../../../contracts/management-api/draft-fields.json'
type Data=Record<string,unknown>
type Draft={draftId:string;ticketType:string;revision:number;fields:Data;status:string;canRestore?:boolean;canRecover?:boolean;restoreBlockedCode?:string;updatedAt:string;submission?:{ticketNo:string}}
export type DraftController={rows:Draft[];busy:boolean;message:string;current:Draft|null;save:()=>Promise<Draft>;restore:(row:Draft,recover?:boolean)=>Promise<void>;fresh:()=>void;reload:()=>Promise<void>}
const dateKeys=(type:string)=>((fieldSchemas as Record<string,{dates?:string}>)[type]?.dates ?? '').split(' ').filter(Boolean)
function editable(data:Data,type:string) {
  const schema=(fieldSchemas as Record<string,{strings?:string;dates?:string;lists?:string;records?:Record<string,string>}>)[type]
  const keys=[...(schema?.strings ?? '').split(' '),...dateKeys(type),...(schema?.lists ?? '').split(' '),...Object.keys(schema?.records ?? {})]
  return Object.fromEntries(Object.entries(data).filter(([key])=>keys.includes(key)))
}
function dates(data:Data,type:string,restore=false) {
  const result={...data}
  for(const key of dateKeys(type))if(result[key]) {
    const d=new Date(String(result[key]));if(!Number.isFinite(d.getTime()))throw Error('请填写有效时间')
    result[key]=restore?[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')+'T'+
      [String(d.getHours()).padStart(2,'0'),String(d.getMinutes()).padStart(2,'0')].join(':'):d.toISOString()
  }
  return result
}
export function useApplicationDraft<T extends Data>(ticketType:string,data:T,onRestore:(value:T)=>void) {
  const initial=useRef(data)
  const operation=useRef(false)
  const [ticketNo,setTicketNo]=useState(()=>ticketType+'-'+crypto.randomUUID())
  const [rows,setRows]=useState<Draft[]>([]),[current,setCurrent]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  async function reload() {
    const r=await fetch('/api/drafts');if(!r.ok)throw Error('读取申请草稿失败')
    const result=await r.json();setRows(result.items.filter((d:Draft)=>d.ticketType===ticketType))
    setCurrent(old=>{
      if(!old)return null
      const found=result.items.find((d:Draft)=>d.draftId===old.draftId)
      return found && (found.status!=='draft' || JSON.stringify(found.fields)===JSON.stringify(old.fields))?found:old
    })
  }
  useEffect(()=>{let active=true;fetch('/api/drafts').then(async r=>{
    if(!r.ok)throw Error('读取申请草稿失败')
    const result=await r.json();if(active)setRows(result.items.filter((d:Draft)=>d.ticketType===ticketType))
  }).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[ticketType])
  async function persist() {
    if(current && current.status!=='draft')throw Error('此草稿已提交或正在提交，请查看工单或新建草稿')
    const r=await fetch('/api/drafts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      draftId:current?.draftId ?? crypto.randomUUID(),revision:current?.revision ?? 0,ticketType,fields:dates(editable(data,ticketType),ticketType)})})
    const result=await r.json();if(!r.ok)throw Error(result.error?.message ?? '保存草稿失败')
    setCurrent(result);setRows(old=>[result,...old.filter(d=>d.draftId!==result.draftId)]);setMessage('申请草稿已保存');return result as Draft
  }
  async function save() {
    if(operation.current)throw Error('草稿正在处理，请稍后重试')
    operation.current=true;setBusy(true)
    try{return await persist()}finally{operation.current=false;setBusy(false)}
  }
  async function restore(row:Draft,recover=false) {
    if(operation.current)return
    operation.current=true;setBusy(true)
    try {
      const r=await fetch(recover?'/api/drafts/recover':'/api/drafts/restore',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draftId:row.draftId,revision:row.revision})})
      const result=await r.json();if(!r.ok)throw Error(result.error?.message ?? '恢复失败')
      onRestore({...initial.current,...dates(result.fields,ticketType,true)} as T);setCurrent(result);setTicketNo(ticketType+'-'+crypto.randomUUID())
      setMessage('已恢复草稿，资源与上传引用需重新核验')
    }catch(e){setMessage(e instanceof Error?e.message:'恢复失败')}
    finally{operation.current=false;setBusy(false)}
  }
  function fresh(){if(operation.current)return;setCurrent(null);setTicketNo(ticketType+'-'+crypto.randomUUID());onRestore(initial.current);setMessage('已开始新申请草稿')}
  async function submit(endpoint:string,payload:Data) {
    if(operation.current)throw Error('草稿正在处理，请稍后重试')
    operation.current=true;setBusy(true)
    try {
      const saved=await persist()
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,ticketNo,
        draft:{draftId:saved.draftId,revision:saved.revision}})})
      await reload();return response
    }catch(e){await reload().catch(()=>{});throw e}
    finally{operation.current=false;setBusy(false)}
  }
  return {ticketNo,submit,controller:{rows,busy,message,current,save,restore,fresh,reload} satisfies DraftController}
}
