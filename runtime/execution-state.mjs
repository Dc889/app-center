import {check,same} from './http.mjs'

const record=v=>!!v && typeof v==='object' && !Array.isArray(v)
const text=v=>typeof v==='string'
const hash=v=>text(v) && /^[a-f0-9]{64}$/.test(v)
const deliveryId=v=>text(v) && /^[A-Za-z0-9_-]{1,160}$/.test(v)
const safeHeader=v=>[...v].every(c=>c.charCodeAt(0)>=32 && c.charCodeAt(0)!==127)
const statuses=['queued','running','awaiting_delivery','reconciling','succeeded','failed','cancelled']
const terminal=status=>['succeeded','failed','cancelled'].includes(status)
export function isUtcTimestamp(value) {
  if(!text(value) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(value))return false
  const time=Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,19)===value.slice(0,19)
}
const utc=isUtcTimestamp

// Decode the provider's response as-is: never infer missing identity, state or result fields.
export function executionState(value,command,{expectedResultId,expectedDelivery,previous}={}) {
  check(record(value),409,'INVALID_EXECUTION_STATE')
  check(value.executionId===command.executionId && value.ticketNo===command.ticketNo,409,'EXECUTION_MISMATCH')
  check(statuses.includes(value.status) && utc(value.updatedAt) && Object.hasOwn(value,'delivery') && Object.hasOwn(value,'result'),409,'INVALID_EXECUTION_STATE')
  if(previous?.updatedAt && utc(previous.updatedAt))check(Date.parse(value.updatedAt)>=Date.parse(previous.updatedAt),409,'STALE_EXECUTION_RESULT')
  if(terminal(value.status)) {
    const r=value.result,ok=value.status==='succeeded'
    check(value.delivery===null && record(r) && ['failureCode','failureReason','resultId','version','sha256'].every(k=>text(r[k])) &&
      typeof r.ok==='boolean' && r.ok===ok && typeof r.retryable==='boolean' && (value.status==='failed' || r.retryable===false) && record(r.details) &&
      (ok?r.failureCode==='' && r.failureReason==='':r.failureCode.length>0 && r.failureReason.length>0) &&
      (r.sha256==='' || hash(r.sha256)) && (ok || r.resultId==='' && r.version==='' && r.sha256===''),409,'INVALID_EXECUTION_RESULT')
    if(ok && command.action==='download') {
      check(command.ticketType==='SKL-03' && deliveryId(r.resultId) && r.version===command.payload.version && r.sha256===command.payload.sha256 &&
        (!expectedResultId || r.resultId===expectedResultId),409,'DELIVERY_RESULT_MISMATCH')
    }
  } else {
    check(value.result===null,409,'INVALID_EXECUTION_RESULT')
    if(value.status==='awaiting_delivery') {
      const d=value.delivery
      check(command.ticketType==='SKL-03' && command.action==='download' && record(d) && deliveryId(d.resultId) &&
        d.version===command.payload.version && hash(d.sha256) && d.sha256===command.payload.sha256 &&
        text(d.filename) && d.filename.length>0 && d.filename.length<=255 && safeHeader(d.filename) && !/[\\/]/.test(d.filename) &&
        text(d.contentType) && d.contentType.length<=255 && safeHeader(d.contentType) && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;.*)?$/.test(d.contentType) &&
        Number.isSafeInteger(d.sizeBytes) && d.sizeBytes>=0 && (!expectedResultId || d.resultId===expectedResultId),409,'INVALID_EXECUTION_DELIVERY')
      if(expectedDelivery)check(['resultId','version','sha256','filename','contentType','sizeBytes'].every(k=>d[k]===expectedDelivery[k]),409,'DELIVERY_METADATA_CHANGED')
    } else check(value.delivery===null,409,'INVALID_EXECUTION_DELIVERY')
  }
  if(previous && terminal(previous.status))check(value.status===previous.status && same(value.result,previous.result) && same(value.delivery,previous.delivery),409,'EXECUTION_TERMINAL_CHANGED')
  return value
}

export async function readExecution(response,command,options) {
  let value
  try{value=await response.json()}catch{check(false,409,'INVALID_EXECUTION_STATE')}
  return executionState(value,command,options)
}
