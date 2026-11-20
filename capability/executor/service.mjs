import { readFileSync } from 'node:fs'
import { body, check, client, json, ledger, listen, prefix, same } from '../../runtime/http.mjs'
import { installPlugin, installed } from '../adapters/dify-install.mjs'
import {
  createDifyApiKey,
  rotateDifyApiKey,
  revokeDifyApiKey,
  syncDifyApp,
  publishDifyApp,
  withdrawDifyApp,
} from '../adapters/dify-adapter.mjs'

const actions = JSON.parse(readFileSync(new URL('../../contracts/capability-api/actions.json',import.meta.url),'utf8'))
const stamp = () => new Date().toISOString()
function failure(code,message) {
  return {ok:false,failureCode:code,failureReason:message,retryable:false,resultId:'',version:'',sha256:'',details:{}}
}
export function startExecutor(options) {
  const store = ledger(options.dir,'executions')
  const skill = client(options.skill,options.token)
  const plugin = client(options.plugin,options.token)
  const busy = new Set()
  async function advance(row) {
    const {command,state} = row
    if (busy.has(command.executionId)) return
    if (state.status === 'reconciling' && row.productTask) {
      if (await installed(row.productTask)) {
        state.status='succeeded'
        state.updatedAt=stamp()
        state.result={ok:true,failureCode:'',failureReason:'',retryable:false,resultId:row.productTask.pluginUniqueIdentifier,version:command.payload.version,sha256:command.payload.sha256,details:row.productTask}
        store.put(command.executionId,row)
      }
      return
    }
    if (state.status !== 'queued') return
    busy.add(command.executionId)
    try {
      if (command.action === 'download') {
        state.delivery = await (await skill('/deliveries','POST',{
          executionId:command.executionId,resourceId:command.resourceId,account:command.account,org:command.org,...command.payload,
        },{'Idempotency-Key':command.executionId+':reserve'})).json()
        state.status = 'awaiting_delivery'
      } else if (command.action === 'install') {
        state.status = 'reconciling'
        store.put(command.executionId,row)
        row.productTask = await installPlugin(command,plugin)
        // Acceptance alone does not establish that the specified version is installed.
      } else if (command.action === 'create_key') {
        const keyInfo = await createDifyApiKey(command)
        state.status = 'succeeded'
        state.result = {
          ok: true,
          failureCode: '',
          failureReason: '',
          retryable: false,
          resultId: keyInfo.keyId,
          version: '1',
          sha256: '',
          details: {
            'Dify密钥ID': keyInfo.keyId,
            '密钥后四位': keyInfo.lastFour,
            'Dify API地址': keyInfo.apiBase,
            '密钥登记ID': keyInfo.keyId,
            'registrationId': keyInfo.keyId,
            secret: keyInfo.secret,
          },
        }
      } else if (command.action === 'rotate_key') {
        const keyInfo = await rotateDifyApiKey(command)
        state.status = 'succeeded'
        state.result = {
          ok: true,
          failureCode: '',
          failureReason: '',
          retryable: false,
          resultId: keyInfo.keyId,
          version: '2',
          sha256: '',
          details: {
            '新Dify密钥ID': keyInfo.keyId,
            '新密钥后四位': keyInfo.lastFour,
            '旧密钥撤销结果': '成功撤销',
            'Dify API地址': keyInfo.apiBase,
            '新密钥登记ID': keyInfo.keyId,
            'registrationId': keyInfo.keyId,
            secret: keyInfo.secret,
          },
        }
      } else if (command.action === 'revoke_key') {
        const revokeInfo = await revokeDifyApiKey(command)
        state.status = 'succeeded'
        state.result = {
          ok: true,
          failureCode: '',
          failureReason: '',
          retryable: false,
          resultId: revokeInfo.keyId,
          version: '',
          sha256: '',
          details: {
            '旧密钥撤销结果': '成功撤销',
            status: '已撤销',
          },
        }
      } else if (command.action === 'sync_app') {
        const appInfo = await syncDifyApp(command)
        state.status = 'succeeded'
        state.result = {
          ok: true,
          failureCode: '',
          failureReason: '',
          retryable: false,
          resultId: appInfo.appId,
          version: 'v1.0.0',
          sha256: '',
          details: {
            appId: appInfo.appId,
            name: appInfo.name,
            status: '已纳管',
          },
        }
      } else if (command.action === 'publish') {
        const pubInfo = await publishDifyApp(command)
        state.status = 'succeeded'
        state.result = {
          ok: true,
          failureCode: '',
          failureReason: '',
          retryable: false,
          resultId: pubInfo.resourceId,
          version: pubInfo.versionId,
          sha256: '',
          details: {
            status: '已发布',
            scope: pubInfo.scope,
          },
        }
      } else if (command.action === 'withdraw_app') {
        const withdrawInfo = await withdrawDifyApp(command)
        state.status = 'succeeded'
        state.result = {
          ok: true,
          failureCode: '',
          failureReason: '',
          retryable: false,
          resultId: withdrawInfo.resourceId,
          version: '',
          sha256: '',
          details: {
            status: '已下架',
            withdrawnAt: withdrawInfo.withdrawnAt,
          },
        }
      } else {
        state.status = 'failed'
        state.result = failure('UPSTREAM_UNSUPPORTED','无法自动执行：此动作尚未接入')
      }
    } catch (err) {
      if (err.status && err.status < 500 || err.status === 501) {
        state.status = 'failed'
        state.result = failure(err.code,err.message)
      } else if (command.action === 'download') {
        throw err // Reservation is idempotent and can be resumed by GET.
      }
    } finally {
      busy.delete(command.executionId)
      state.updatedAt = stamp()
      store.put(command.executionId,row)
    }
  }
  return listen(async (req,res,path) => {
    if (req.method === 'GET' && path === prefix + '/capabilities') {
      const workspaceId = new URL(req.url,'http://localhost').searchParams.get('workspaceId')
      const evidence = process.env.CAPABILITY_EVIDENCE_FILE
        ? JSON.parse(readFileSync(process.env.CAPABILITY_EVIDENCE_FILE,'utf8')) : []
      const items = []
      for (const [ticketType, names] of Object.entries(actions)) {
        for (const action of names) {
          const variants = ticketType === 'KB-03'
            ? ['RAGFlow外部知识库','Dify同workspace授权','Dify跨workspace复制'] : [null]
          for (const variant of variants) {
            const matches = evidence.filter(e => e.ticketType === ticketType && e.ticketTypeVersion === '1'
              && e.action === action && e.variant === variant && e.workspaceId === workspaceId)
            check(matches.length <= 1,503,'AMBIGUOUS_EVIDENCE','同一能力分支存在重复核验记录')
            const proof = matches[0]
            const wired = action === 'download' || action === 'install'
            const valid = proof && ['verified','unsupported'].includes(proof.state)
              && typeof proof.reasonCode === 'string' && typeof proof.checkedAt === 'string' && Number.isFinite(Date.parse(proof.checkedAt))
            items.push({ticketType,ticketTypeVersion:'1',action,variant,
              state: wired && valid ? proof.state : wired ? 'unverified' : 'unsupported',
              reasonCode: wired ? (valid ? proof.reasonCode : 'NO_DEPLOYMENT_EVIDENCE') : 'NO_HANDLER',
              checkedAt: wired && valid ? proof.checkedAt : null})
          }
        }
      }
      return json(res,{items,asOf:stamp()})
    }
    if (req.method==='GET' && path===prefix+'/catalog/plugin/document-parser') {
      const info=await (await plugin('/plugins/document-parser/versions/v2.4.1')).json()
      return json(res,{resourceId:info.resourceId,name:info.resourceId,status:'approved',actions:['install'],data:info})
    }
    if (req.method === 'GET' && path === prefix+'/catalog') {
      const kind = new URL(req.url,'http://localhost').searchParams.get('kind')
      check(kind === 'skill',501,'UPSTREAM_UNSUPPORTED')
      const org = decodeURIComponent(req.headers['x-org'] ?? '')
      const {items} = await (await skill('/skills')).json()
      return json(res,{items:items.filter(i=>!i.orgs.length || i.orgs.includes(org)).map(i=>({resourceId:i.resourceId,name:i.name,status:i.status,actions:['download'],data:{version:i.version,sha256:i.sha256,sizeBytes:i.sizeBytes}})),nextCursor:null})
    }
    if (req.method === 'POST' && path === prefix+'/executions') {
      const c = await body(req)
      check(c && ['executionId','ticketNo','ticketType','ticketTypeVersion','action','resourceId','account','org'].every(k=>typeof c[k] === 'string' && c[k].length>0 && c[k].length<=160) && /^[\w-]+$/.test(c.executionId),400,'INVALID_REQUEST')
      check(c.ticketTypeVersion==='1',400,'UNKNOWN_TYPE_VERSION')
      check(Object.hasOwn(actions,c.ticketType) && actions[c.ticketType].includes(c.action),400,'UNSUPPORTED_ACTION')
      const keys = c.action==='download'?['version','sha256']:c.action==='install'?['version','sha256','workspaceId']:null
      check(c.payload && typeof c.payload === 'object' && !Array.isArray(c.payload),400,'INVALID_REQUEST')
      if (keys) check(Object.keys(c.payload).length===keys.length && keys.every(k=>typeof c.payload[k]==='string' && c.payload[k]) && /^[a-f0-9]{64}$/.test(c.payload.sha256),400,'INVALID_REQUEST')
      if (c.action==='publish') check(['snapshotId','workspaceId','publicationVersionId','scope'].every(k=>typeof c.payload[k]==='string' && c.payload[k]) && Number.isInteger(c.payload.expectedRevision) && c.payload.expectedRevision>=0 && ['targetOrgs','targetAccounts','boundaryOrgs','usages'].every(k=>Array.isArray(c.payload[k])),400,'INVALID_REQUEST')
      else if (c.action==='bind') check(['workspaceId','startsAt','expiresAt','expectedUrlFingerprint'].every(k=>typeof c.payload[k]==='string' && c.payload[k]),400,'INVALID_REQUEST')
      else if (!keys) check(typeof c.payload.decisionRef==='string' && c.payload.decisionRef && Object.keys(c.payload).length===1,400,'INVALID_REQUEST')
      const prior = store.get(c.executionId)
      if (!prior) check(!store.all().some(r=>r.command.ticketNo===c.ticketNo && r.command.action===c.action && !r.state.result),409,'ACTIVE_EXECUTION')
      if (prior) check(same(prior.command,c),409,'EXECUTION_CONFLICT')
      const row = prior ?? store.put(c.executionId,{command:c,state:{executionId:c.executionId,ticketNo:c.ticketNo,status:'queued',delivery:null,result:null,updatedAt:stamp()}})
      await advance(row)
      return json(res,store.get(c.executionId).state,prior?200:202)
    }
    const item = /^\/internal\/v1\/executions\/([\w-]+)$/.exec(path)
    if (req.method==='GET' && item) {
      const row=store.get(item[1]); check(row,404,'NOT_FOUND')
      await advance(row)
      return json(res,store.get(item[1]).state)
    }
    const download = /^\/internal\/v1\/downloads\/(DL-([\w-]+))(\/receipt)?$/.exec(path)
    const row = download && store.get(download[2])
    check(row && row.reservation?.resultId === download[1] || row && row.state.delivery?.resultId === download[1],404,'NOT_FOUND')
    check(row.command.account===req.headers['x-account'] && row.command.org===decodeURIComponent(req.headers['x-org'] ?? ''),404,'NOT_FOUND')
    if (!download[3] && req.method==='GET') {
      const file = await skill('/deliveries/'+download[1]+'/file')
      for(const k of ['content-length','content-type','content-disposition','x-content-sha256']) res.setHeader(k,file.headers.get(k))
      return res.end(Buffer.from(await file.arrayBuffer()))
    }
    check(req.method==='PUT' && download[3],405,'METHOD_NOT_ALLOWED')
    const receipt = await body(req)
    const confirmed = await (await skill('/deliveries/'+download[1]+'/receipt','PUT',receipt)).json()
    const delivery = row.reservation ?? row.state.delivery
    row.reservation = delivery
    row.state = {...row.state,status:'succeeded',delivery:null,updatedAt:confirmed.deliveredAt,result:{
      ok:true,failureCode:'',failureReason:'',retryable:false,resultId:delivery.resultId,version:delivery.version,sha256:delivery.sha256,details:{deliveredAt:confirmed.deliveredAt},
    }}
    store.put(row.command.executionId,row)
    json(res,row.state)
  },{...options,close:store.close})
}
