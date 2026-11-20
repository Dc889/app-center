import {check,id} from '../../../../runtime/http.mjs'

// Every claim and close decision uses the same SQLite transaction, including across API instances.
export function deliveryControl(store) {
  const stamp=()=>new Date().toISOString()
  const sent=row=>!!row.receipt || ['pending_receipt','confirmed'].includes(row.delivery?.status) ||
    row.history?.some(h=>h.action==='文件发送完成' || h.action==='确认文件回执')
  for(const row of store.all())if(row.delivery?.status==='sending') {
    let alive=true
    if(row.delivery.processId)try{process.kill(row.delivery.processId,0)}catch(e){alive=e.code!=='ESRCH'}
    // Never turn another live instance's sending claim into a retryable interruption.
    if(!alive || !row.delivery.processId)store.transaction(()=>{
      const latest=store.get(row.ticketNo)
      if(latest.delivery?.transferId===row.delivery.transferId && latest.delivery.status==='sending')store.put(row.ticketNo,{...latest,
        delivery:{...latest.delivery,status:!alive && latest.delivery.stage==='fetching'?'interrupted':'uncertain',updatedAt:stamp()}})
    })
  }
  function claim(ticketNo) {
    return store.transaction(()=>{
      const row=store.get(ticketNo)
      check(!row.deliveryClosure && !row.cancelRequest,409,'DELIVERY_CLOSED','此流水已封住新领取，需查询关闭或取消结果')
      check(!row.receipt && !['sending','uncertain'].includes(row.delivery?.status),409,'DELIVERY_BUSY','文件正在交付或结果待查证')
      check(!['failed','cancelled'].includes(row.state?.status),409,'EXECUTION_ENDED')
      const transferId=id()
      store.put(ticketNo,{...row,delivery:{transferId,status:'sending',stage:'fetching',processId:process.pid,updatedAt:stamp()}})
      return transferId
    })
  }
  function emitting(ticketNo,transferId) {
    return store.transaction(()=>{
      const row=store.get(ticketNo)
      check(row.delivery?.transferId===transferId && row.delivery.status==='sending',409,'DELIVERY_BUSY')
      // Persist before the first possible outgoing byte; crash afterwards remains uncertain.
      return store.put(ticketNo,{...row,delivery:{...row.delivery,stage:'emitting',updatedAt:stamp()}})
    })
  }
  function interrupt(ticketNo,transferId) {
    return store.transaction(()=>{
      const row=store.get(ticketNo)
      if(row.delivery?.transferId!==transferId || row.delivery.status!=='sending')return
      return store.put(ticketNo,{...row,delivery:{...row.delivery,status:row.delivery.stage==='fetching'?'interrupted':'uncertain',updatedAt:stamp()}})
    })
  }
  function finish(ticketNo,transferId,{sha256,bytesSent,sourceIp,recipient}) {
    return store.transaction(()=>{
      const row=store.get(ticketNo)
      if(row.delivery?.transferId!==transferId)return
      return store.put(ticketNo,{...row,receiptSourceIp:Object.hasOwn(row,'receiptSourceIp')?row.receiptSourceIp:sourceIp,
        history:[...(row.history ?? []),{at:stamp(),actor:'system',action:'文件发送完成',...recipient}],
        delivery:{...row.delivery,status:row.state?.status==='succeeded'?'confirmed':'pending_receipt',stage:'sent',updatedAt:stamp()},
        receipt:row.state?.status==='succeeded'?null:{sha256,bytesSent}})
    })
  }
  function close(resultId) {
    return store.transaction(()=>{
      const matches=store.all().filter(row=>row.command.ticketType==='SKL-03' && row.command.action==='download' &&
        (row.resultId===resultId || row.state?.delivery?.resultId===resultId || row.state?.result?.resultId===resultId))
      check(matches.length===1,404,'NOT_FOUND')
      const row=matches[0]
      let state
      if(row.deliveryClosure?.state==='closed_unserved')state='closed_unserved'
      else if(sent(row))state='receipt_pending'
      else if(row.state?.status==='succeeded' || row.delivery?.status==='uncertain' || row.delivery?.status==='interrupted' && row.delivery.stage!=='fetching')state='uncertain'
      else if(row.delivery?.status==='sending')state='uncertain'
      else state='closed_unserved'
      if(row.deliveryClosure?.state!==state)store.put(row.ticketNo,{...row,deliveryClosure:{state,at:stamp()},
        history:[...(row.history ?? []),{at:stamp(),actor:'capability',action:'关闭交付检查 '+state,resultId}]})
      return {ticketNo:row.ticketNo,state}
    })
  }
  function beginCancel(ticketNo,executionId,actor,note) {
    return store.transaction(()=>{
      const row=store.get(ticketNo)
      check(row.command.ticketType==='SKL-03' && row.command.executionId===executionId,409,'EXECUTION_MISMATCH')
      if(row.cancelRequest || row.state?.status==='cancelled')return row
      check(!row.state?.result && !sent(row) && !['sending','uncertain'].includes(row.delivery?.status) &&
        !(row.delivery?.status==='interrupted' && row.delivery.stage!=='fetching'),409,'DELIVERY_UNCERTAIN')
      return store.put(ticketNo,{...row,cancelRequest:{executionId,status:'pending',actor,note,at:stamp()},
        history:[...(row.history ?? []),{at:stamp(),actor,action:'申请取消执行',note,executionId}]})
    })
  }
  return {claim,emitting,interrupt,finish,close,beginCancel}
}
