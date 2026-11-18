import { readFileSync } from 'node:fs'
import { body, check, digest, json, ledger, listen, prefix, same } from '../../../runtime/http.mjs'

const catalog = [
  {resourceId:'skl_doc',name:'公文摘要 Skill',version:'v2.1.0',orgs:[]},
  {resourceId:'skl_sheet',name:'表格分析 Skill',version:'v1.8.2',orgs:['业务一部']},
]
function object(item) {
  const bytes = readFileSync(new URL('./objects/' + item.resourceId + '.txt', import.meta.url))
  return {bytes, sha256:digest(bytes), sizeBytes:bytes.length}
}
export function startSkill(options) {
  const store = ledger(options.dir, 'skill')
  return listen(async (req,res,path) => {
    if (req.method === 'GET' && path === prefix + '/skills') {
      return json(res, {items:catalog.map(item => {
        const {sha256,sizeBytes} = object(item)
        return {...item, sha256,sizeBytes,status:'available',revision:1}
      }),nextCursor:null})
    }
    if (req.method === 'POST' && path === prefix + '/deliveries') {
      check(req.headers['idempotency-key'], 400, 'INVALID_REQUEST', '缺少 Idempotency-Key')
      const input = await body(req)
      const item = catalog.find(i => i.resourceId === input.resourceId)
      check(item && (!item.orgs.length || item.orgs.includes(input.org)),403,'ACCESS_DENIED','不在下载范围内')
      const {sha256,sizeBytes} = object(item)
      check(item.version === input.version && sha256 === input.sha256,409,'STALE_SNAPSHOT')
      const resultId = 'DL-' + input.executionId
      const previous = store.get(resultId)
      if (previous) {
        check(same(previous.input,input),409,'EXECUTION_CONFLICT')
        return json(res,previous.delivery)
      }
      const delivery = {resultId,version:item.version,sha256,filename:item.resourceId+'.txt',contentType:'text/plain; charset=utf-8',sizeBytes}
      store.put(resultId,{input,delivery,deliveredAt:null})
      return json(res,delivery)
    }
    const match = /^\/internal\/v1\/deliveries\/([^/]+)\/(file|receipt)$/.exec(path)
    const row = match && store.get(match[1])
    check(row,404,'NOT_FOUND')
    const d = row.delivery
    if (req.method === 'GET' && match[2] === 'file') {
      const item = catalog.find(i => i.resourceId === row.input.resourceId)
      check(item && (!item.orgs.length || item.orgs.includes(row.input.org)),403,'ACCESS_DENIED')
      const file = object(item)
      check(file.sha256 === d.sha256,409,'STALE_SNAPSHOT')
      res.writeHead(200,{'content-length':d.sizeBytes,'content-type':d.contentType,'content-disposition':'attachment; filename="'+d.filename+'"','x-content-sha256':d.sha256})
      return res.end(file.bytes)
    }
    check(req.method === 'PUT' && match[2] === 'receipt',405,'METHOD_NOT_ALLOWED')
    const receipt = await body(req)
    check(receipt.sha256 === d.sha256 && receipt.bytesSent === d.sizeBytes,409,'INVALID_RECEIPT')
    const current = store.get(d.resultId)
    if (!current.deliveredAt) store.put(d.resultId,{...current,deliveredAt:new Date().toISOString()})
    json(res,{resultId:d.resultId,deliveredAt:store.get(d.resultId).deliveredAt})
  }, {...options,close:store.close})
}
