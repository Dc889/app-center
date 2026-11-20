import assert from 'node:assert/strict'

// Construct a conforming provider fixture from its accepted command. Do not use this
// around responses under test: malformed-response tests must send their raw objects.
export function mockExecution(command,partial={}) {
  assert.ok(command?.executionId && command?.ticketNo,'fixture requires the accepted command identity')
  const status=partial.status ?? 'running',ok=status==='succeeded',terminal=['succeeded','failed','cancelled'].includes(status)
  const result=terminal?{ok,failureCode:ok?'':'TEST_FAILURE',failureReason:ok?'':'模拟产品执行失败',retryable:false,
    resultId:'',version:'',sha256:'',details:{},...partial.result}:null
  return {executionId:command.executionId,ticketNo:command.ticketNo,updatedAt:new Date().toISOString(),delivery:null,...partial,status,result}
}

export function mockDownload(command,resultId,metadata) {
  assert.ok(Number.isSafeInteger(metadata?.sizeBytes),'fixture requires the actual byte length')
  return mockExecution(command,{status:'awaiting_delivery',delivery:{resultId,version:command.payload.version,sha256:command.payload.sha256,
    filename:'file.txt',contentType:'text/plain',...metadata}})
}

export function mockDelivered(command,resultId) {
  return mockExecution(command,{status:'succeeded',result:{resultId,version:command.payload.version,sha256:command.payload.sha256}})
}
