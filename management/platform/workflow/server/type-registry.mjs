import {readFileSync} from 'node:fs'
import {body, check, json, ledger} from '../../../../runtime/http.mjs'

const routes = JSON.parse(readFileSync(new URL('../../../../contracts/capability-api/actions.json',import.meta.url),'utf8'))
const datasetVariants = ['RAGFlow外部知识库','Dify同workspace授权','Dify跨workspace复制']

export function typeRegistry(dir, cap, actorSnapshot, {organizations=()=>[],currentOrg=()=>null}={}) {
  const versions = ledger(dir,'ticket-types',actorSnapshot)
  async function inspect(record) {
    if (record.code === 'EVT-01') return []
    if(record.code==='PLG-03')check(['upgrade','uninstall'].every(action=>
      ['approval','instant'].includes(record.branchFlows?.[action])),409,'BRANCH_FLOW_REQUIRED','请配置升级和卸载的办理流程')
    const query = record.workspaceId ? '?workspaceId='+encodeURIComponent(record.workspaceId) : ''
    const {items} = await (await cap('/capabilities'+query)).json()
    const branches = items.filter(item=>item.ticketType===record.code && item.ticketTypeVersion===record.version)
    const actions = Object.hasOwn(routes,record.code) ? routes[record.code] : record.actions
    check(actions.length>0,409,'MISSING_ROUTE','尚未登记此类型版本的执行路由')
    return actions.flatMap(action => {
      const variants = record.code==='KB-03' ? datasetVariants : [null]
      return variants.map(variant=>{
        const matches=branches.filter(item=>item.action===action && item.variant===variant)
        if (matches.length===1) return matches[0]
        return {action,variant,state:'unsupported',reasonCode:matches.length?'AMBIGUOUS_ROUTE':'MISSING_ROUTE'}
      })
    })
  }
  async function handle(req,res,path,actor) {
    if (req.method==='GET' && path==='/api/types') return json(res,{routes,versions:versions.all(),organizations:organizations()})
    const input=await body(req)
    check(typeof input?.code==='string' && /^[A-Z]{2,8}-\d{2,4}$/.test(input.code) &&
      typeof input.version==='string' && /^[1-9]\d{0,5}$/.test(input.version),400,'INVALID_TYPE_VERSION')
    const key=input.code+'/'+input.version
    const previous=versions.get(key)
    check(req.method==='POST' && ['/api/types/draft','/api/types/copy','/api/types/check','/api/types/publish','/api/types/disable'].includes(path),404,'NOT_FOUND')
    check((previous?.revision ?? 0)===input.revision,409,'VERSION_CONFLICT','记录已变化，请刷新')
    if(path==='/api/types/copy')return versions.transaction(()=>{
      check(previous,404,'NOT_FOUND')
      check(versions.get(key)?.revision===input.revision,409,'VERSION_CONFLICT','源版本已变化，请刷新')
      check(['published','disabled'].includes(previous.status),409,'INVALID_TRANSITION','请先发布源版本')
      check(typeof input.newVersion==='string' && /^[1-9]\d{0,5}$/.test(input.newVersion) &&
        versions.all().filter(v=>v.code===input.code).every(v=>Number(v.version)<Number(input.newVersion)),409,'INVALID_NEW_VERSION','新版本必须大于该类型的所有已有版本')
      const copy={code:previous.code,version:input.newVersion,name:previous.name,workspaceId:previous.workspaceId,
        actions:previous.actions,enabledOrgs:previous.enabledOrgs ?? [],...(previous.branchFlows?{branchFlows:previous.branchFlows}:{}),
        status:'draft',revision:1,copiedFrom:{version:previous.version,revision:previous.revision},
        history:[{at:new Date().toISOString(),actor,action:'复制类型为新版本',sourceVersion:previous.version}]}
      return json(res,versions.put(input.code+'/'+input.newVersion,copy),201)
    })
    if (path==='/api/types/draft') {
      check(!['published','disabled'].includes(previous?.status),409,'IMMUTABLE_VERSION','已发布版本不可覆盖')
      check(typeof input.name==='string' && input.name.trim() && input.name.length<=120 &&
        typeof input.workspaceId==='string' && input.workspaceId.length<=160,400,'INVALID_FIELDS')
      const known=Object.hasOwn(routes,input.code)
      const actions=known ? routes[input.code] : input.actions
      check(Array.isArray(actions) && actions.every(a=>typeof a==='string' && /^[a-z][a-z_]{0,63}$/.test(a)) &&
        (actions.length || input.code==='EVT-01'),400,'MISSING_ROUTE','请填写需要登记的执行动作')
      const branchFlows={}
      const enabledOrgs=input.enabledOrgs ?? []
      check(Array.isArray(enabledOrgs) && enabledOrgs.length<=200 && enabledOrgs.every(org=>typeof org==='string' && organizations().includes(org)) &&
        new Set(enabledOrgs).size===enabledOrgs.length,400,'INVALID_ORGANIZATIONS','启用组织必须从当前组织目录选择')
      if(input.code==='PLG-03')for(const action of ['upgrade','uninstall']) {
        const mode=input.branchFlows?.[action]
        check(mode===undefined || mode==='' || ['approval','instant'].includes(mode),400,'INVALID_BRANCH_FLOW')
        if(mode)branchFlows[action]=mode
      }
      return json(res,versions.put(key,{code:input.code,version:input.version,name:input.name.trim(),actions:[...new Set(actions)],
        ...(input.code==='PLG-03'?{branchFlows}:{}),
        enabledOrgs:[...enabledOrgs],...(previous?.copiedFrom?{copiedFrom:previous.copiedFrom}:{}),
        workspaceId:input.workspaceId.trim(),status:'draft',revision:input.revision+1,
        history:[...(previous?.history ?? []),{at:new Date().toISOString(),actor,action:'保存类型草稿'}]}))
    }
    check(previous,404,'NOT_FOUND')
    if(path==='/api/types/disable') {
      check(['published','disabled'].includes(previous.status),409,'INVALID_TRANSITION')
      if(previous.status==='disabled') return json(res,previous)
      return json(res,versions.put(key,{...previous,status:'disabled',revision:previous.revision+1,
        history:[...(previous.history ?? []),{at:new Date().toISOString(),actor,action:'停用类型版本'}]}))
    }
    check(previous.status!=='disabled',409,'TYPE_DISABLED','已停用版本需复制为新版本后发布')
    const branches=await inspect(previous)
    const ready=branches.every(branch=>branch.state==='verified')
    if(path==='/api/types/check') return json(res,{ready,branches})
    check(versions.get(key).revision===input.revision,409,'VERSION_CONFLICT')
    check(ready,409,'CAPABILITY_UNAVAILABLE','存在未核验或缺失的能力分支，不能发布')
    if (previous.status==='published') return json(res,previous)
    return json(res,versions.put(key,{...previous,status:'published',revision:previous.revision+1,
      publishedAt:new Date().toISOString(),branches,
      history:[...(previous.history ?? []),{at:new Date().toISOString(),actor,action:'发布类型版本'}]}))
  }
  function activeVersion(code, workspaceId='', org=currentOrg()) {
    const published=versions.all().filter(v=>['published','disabled'].includes(v.status) && v.code===code && (!v.workspaceId || v.workspaceId===workspaceId))
    published.sort((a,b)=>Number(b.version)-Number(a.version))
    check(published[0]?.status!=='disabled',409,'TYPE_DISABLED','该工单类型已停用，无法新建申请')
    check(!org || !published[0]?.enabledOrgs?.length || published[0].enabledOrgs.includes(org),403,'TYPE_ORGANIZATION_DISABLED','该工单类型未对您当前组织启用')
    return published[0]?.version ?? '1'
  }
  function branchMode(code,version,action,workspaceId='') {
    const record=versions.get(code+'/'+version)
    check(record && ['published','disabled'].includes(record.status) && (!record.workspaceId || record.workspaceId===workspaceId) &&
      ['approval','instant'].includes(record.branchFlows?.[action]),409,'BRANCH_FLOW_REQUIRED','此分支尚未配置办理流程')
    return record.branchFlows[action]
  }
  return {handle,activeVersion,branchMode,records:versions.all,close:versions.close}
}
