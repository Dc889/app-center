import test from 'node:test'
import assert from 'node:assert/strict'
import {executionState} from '../../runtime/execution-state.mjs'
import {mockExecution} from '../support/execution-state.mjs'

const command={executionId:'original-execution',ticketNo:'SKL-03-original',ticketType:'SKL-03',action:'download',payload:{version:'1',sha256:'a'.repeat(64)}}
const delivery={resultId:'DL-original',version:'1',sha256:'a'.repeat(64),filename:'file.txt',contentType:'text/plain; charset=utf-8',sizeBytes:12}
const waiting=()=>mockExecution(command,{status:'awaiting_delivery',delivery})
const success=()=>mockExecution(command,{status:'succeeded',result:{ok:true,failureCode:'',failureReason:'',retryable:false,resultId:'DL-original',version:'1',sha256:'a'.repeat(64),details:{deliveredAt:new Date().toISOString()}}})

test('执行响应全部必填字段按原值核验，缺失、空值与错误关联不自动补齐',()=>{
  const valid=waiting()
  assert.equal(executionState(valid,command),valid)
  for(const key of ['executionId','ticketNo','status','updatedAt','delivery','result']) {
    const raw={...valid};delete raw[key]
    assert.throws(()=>executionState(raw,command),{status:409},key)
    assert.equal(Object.hasOwn(raw,key),false)
  }
  for(const raw of [null,[],{}, {...valid,executionId:'other'},{...valid,ticketNo:'other'},{...valid,status:'accepted'},
    {...valid,updatedAt:'invalid'},{...valid,updatedAt:'2026-02-30T00:00:00Z'},{...valid,updatedAt:'2026-11-18T25:00:00Z'},
    {...valid,updatedAt:'2026-11-18T00:00:00+08:00'}])assert.throws(()=>executionState(raw,command),{status:409})
})

test('非终态不得携带结果，等待交付只属于原Skill版本与摘要且元数据完整',()=>{
  for(const status of ['queued','running','reconciling']) {
    assert.equal(executionState(mockExecution(command,{status}),command).status,status)
    assert.throws(()=>executionState({...waiting(),status},command),{code:'INVALID_EXECUTION_DELIVERY'})
  }
  assert.throws(()=>executionState({...waiting(),result:{}},command),{code:'INVALID_EXECUTION_RESULT'})
  assert.throws(()=>executionState(waiting(),{...command,action:'install'}),{code:'INVALID_EXECUTION_DELIVERY'})
  for(const patch of [{resultId:''},{resultId:'../other'},{version:'2'},{sha256:'b'.repeat(64)},{filename:'../file.txt'},{filename:'file\r\n.txt'},
    {contentType:'text/plain\r\nx-secret: value'},{contentType:'invalid'},{sizeBytes:-1},{sizeBytes:1.5},{sizeBytes:Number.MAX_SAFE_INTEGER+1}])
    assert.throws(()=>executionState({...waiting(),delivery:{...delivery,...patch}},command),{code:'INVALID_EXECUTION_DELIVERY'},JSON.stringify(patch))
  for(const key of Object.keys(delivery)) {
    const d={...delivery};delete d[key]
    assert.throws(()=>executionState({...waiting(),delivery:d},command),{code:'INVALID_EXECUTION_DELIVERY'},key)
  }
  assert.throws(()=>executionState(waiting(),command,{expectedResultId:'other'}),{code:'INVALID_EXECUTION_DELIVERY'})
  assert.throws(()=>executionState({...waiting(),delivery:{...delivery,filename:'other.txt'}},command,{expectedDelivery:delivery}),{code:'DELIVERY_METADATA_CHANGED'})
})

test('终态结果区分成功、失败和取消，下载成功必须精确关联原流水',()=>{
  const good=success()
  assert.equal(executionState(good,command,{expectedResultId:delivery.resultId}),good)
  for(const key of ['ok','failureCode','failureReason','retryable','resultId','version','sha256','details']) {
    const r={...good.result};delete r[key]
    assert.throws(()=>executionState({...good,result:r},command),{status:409},key)
  }
  for(const patch of [{ok:false},{retryable:true},{failureCode:'ERROR'},{failureReason:'error'},{details:[]},{sha256:'invalid'}])
    assert.throws(()=>executionState({...good,result:{...good.result,...patch}},command),{code:'INVALID_EXECUTION_RESULT'})
  assert.throws(()=>executionState({...good,delivery},command),{code:'INVALID_EXECUTION_RESULT'})
  assert.throws(()=>executionState(good,command,{expectedResultId:'other'}),{code:'DELIVERY_RESULT_MISMATCH'})
  for(const patch of [{resultId:''},{resultId:'../other'},{version:'2'},{sha256:'b'.repeat(64)}])
    assert.throws(()=>executionState({...good,result:{...good.result,...patch}},command),{code:'DELIVERY_RESULT_MISMATCH'})
  for(const status of ['failed','cancelled']) {
    const raw=mockExecution(command,{status})
    assert.equal(executionState(raw,command).status,status)
    assert.throws(()=>executionState({...raw,result:{...raw.result,ok:true}},command),{code:'INVALID_EXECUTION_RESULT'})
    assert.throws(()=>executionState({...raw,result:{...raw.result,resultId:'not-empty'}},command),{code:'INVALID_EXECUTION_RESULT'})
  }
})

test('旧时间戳和已确认终态不能回退或改写',()=>{
  const previous=success(),older={...previous,updatedAt:'2020-01-01T00:00:00Z'}
  assert.throws(()=>executionState(older,command,{previous}),{code:'STALE_EXECUTION_RESULT'})
  assert.equal(executionState({...previous},command,{previous}).status,'succeeded')
  assert.throws(()=>executionState(mockExecution(command,{status:'running'}),command,{previous}),{code:'EXECUTION_TERMINAL_CHANGED'})
  assert.throws(()=>executionState({...success(),result:{...previous.result,details:{changed:true}}},command,{previous}),{code:'EXECUTION_TERMINAL_CHANGED'})
})

test('非法JSON响应按协议错误拒绝，不转为网络重投或默认成功',async()=>{
  const {readExecution}=await import('../../runtime/execution-state.mjs')
  await assert.rejects(readExecution(new Response('not JSON'),command),{code:'INVALID_EXECUTION_STATE'})
})
