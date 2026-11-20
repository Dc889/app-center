import {useEffect,useRef,useState} from 'react'

type Snapshot={snapshotId:string;resourceId:string;workspaceId:string|null;capturedAt:string;data:Record<string,unknown>}
export function useResourceSnapshot() {
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const controller=useRef<AbortController|null>(null)
  useEffect(()=>()=>{controller.current?.abort()},[])
  function reset() {
    controller.current?.abort();controller.current=null
    setSnapshot(null);setBusy(false);setError('')
  }
  async function read(kind:'dify_app'|'dify_dataset'|'ragflow_dataset',resourceId:string,workspaceId:string) {
    reset()
    const request=new AbortController();controller.current=request
    setBusy(true)
    try {
      const params=kind==='ragflow_dataset'?'':'?'+new URLSearchParams({workspaceId})
      const response=await fetch('/api/resources/'+kind+'/'+encodeURIComponent(resourceId)+params,{signal:request.signal})
      const data=await response.json()
      if(!response.ok)throw Error(data.error?.message ?? '资源快照读取失败')
      if(!data || data.resourceId!==resourceId || typeof data.snapshotId!=='string' || !data.snapshotId.trim() ||
        typeof data.capturedAt!=='string' || !Number.isFinite(Date.parse(data.capturedAt)) ||
        !data.data || typeof data.data!=='object' || Array.isArray(data.data) ||
        (kind==='ragflow_dataset' ? data.workspaceId!==null || typeof data.data.tenantId!=='string' || !data.data.tenantId.trim() : data.workspaceId!==workspaceId))throw Error('资源快照与所选对象或范围不匹配，请重新读取')
      if(!request.signal.aborted){setSnapshot(data);return data as Snapshot}
    }catch(error){if(!request.signal.aborted)setError(error instanceof Error?error.message:'资源快照读取失败')}
    finally{if(!request.signal.aborted)setBusy(false)}
    return null
  }
  return {snapshot,busy,error,read,reset}
}
