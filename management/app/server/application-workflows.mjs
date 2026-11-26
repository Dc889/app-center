import {submissionHandlers,approvalHandlers} from './workflow-registry.mjs'
import {pluginSafetyWorkflow} from '../../modules/plugins/public.server.mjs'
import {agentManagementContext} from '../../modules/agents/public.server.mjs'
import {datasetChangesContext,unchangedDatasetChanges,confirmDatasetChanges,changesDisposition} from '../../modules/knowledge/public.server.mjs'
import {validateDatasetDisposition,datasetDispositionContext} from '../../modules/knowledge/public.server.mjs'
import {pluginOperationActions} from '../../modules/plugins/public.server.mjs'
import {revisionKinds,revisionActions,packageRevisionContext,checkNewPackage,packageRevisionFields} from '../../platform/packages/public.server.mjs'
import {readyIntake} from '../../platform/packages/public.server.mjs'

import {validCidrs} from '../../modules/keys/public.server.mjs'

import {keyActions} from '../../modules/keys/public.server.mjs'
import {mcpDispositionActions} from '../../modules/mcp/public.server.mjs'




import {agentImpactContext,requireAgentImpact,sameAgentImpact} from '../../modules/agents/public.server.mjs'

import {body,check,json,ledger,same,id,digest} from '../../../runtime/http.mjs'
import {readExecution} from '../../../runtime/execution-state.mjs'

function visibleApplication(row,identity) {
  if(row.ticketType!=='MCP-02' || !identity.roles.includes('user'))return row
  const context=row.snapshot.data
  return {ticketNo:row.ticketNo,ticketType:row.ticketType,ticketTypeVersion:row.ticketTypeVersion,
    account:row.account,org:row.org,status:row.status,revision:row.revision,submission:row.submission,
    history:row.history,targetApplication:row.targetApplication?{appId:row.targetApplication.appId,name:row.targetApplication.name,workspaceId:row.targetApplication.workspaceId}:null,snapshot:{snapshotId:row.snapshot.snapshotId,data:{
      resourceId:context.resourceId,workspaceId:context.workspaceId,bindingAccess:context.bindingAccess}},
    execution:row.execution?{status:row.execution.status,result:row.execution.result?{
      resultId:row.execution.result.resultId,failureCode:row.execution.result.failureCode,
      failureReason:row.execution.result.failureReason,retryable:row.execution.result.retryable}:null}:null}
}

export function applicationApi(dir,cap,types,accounts,headersFor,canWithdrawSkill=()=>false,evidence,workflowOptions={}) {
  const applications=ledger(dir,'applications',workflowOptions.actorSnapshot)
  for(const row of applications.all()) {
    if(row.revealState==='sending')applications.put(row.ticketNo,{...row,revealState:'consumed_unconfirmed',revision:row.revision+1})
  }
  const busy=new Set()
  const linking=new Set()
  let closed=false
  const pluginSafety=pluginSafetyWorkflow({store:applications,cap,types,headersFor,deliver,evidence,
    onEmergency:workflowOptions.onPluginEmergency,now:workflowOptions.now})
  function relatedPauseSucceeded(row) {
    return [row.linkedDispositionTicketNo,row.linkedReviewDispositionTicketNo].some(key=>key &&
      applications.get(key)?.attempts?.some(a=>a.command.action==='pause_share' && a.execution?.status==='succeeded'))
  }
  async function linkDisposition(row) {
    if(closed || linking.has(row.ticketNo))return
    linking.add(row.ticketNo)
    try {
      for(const [pendingKey,linkedKey] of [['pendingDisposition','linkedDispositionTicketNo'],['pendingReviewDisposition','linkedReviewDispositionTicketNo']]) {
        const source=applications.get(row.ticketNo)
        if(!source[pendingKey] || source[linkedKey])continue
        const disposition=await ingestDatasetAlert(source[pendingKey])
        if(closed)return
        const latest=applications.get(row.ticketNo)
        applications.put(row.ticketNo,{...latest,[linkedKey]:disposition.ticketNo,linkError:null,revision:latest.revision+1,
          history:[...latest.history,{at:new Date().toISOString(),actor:'system_event',action:'关联知识库处置 '+disposition.ticketNo}]})
        const target=applications.get(disposition.ticketNo)
        applications.put(target.ticketNo,{...target,relatedTicketNos:[...new Set([...(target.relatedTicketNos ?? []),row.ticketNo])]})
      }
    }catch(error){if(!closed){const latest=applications.get(row.ticketNo);applications.put(row.ticketNo,{...latest,linkError:{code:error.code ?? 'NETWORK_ERROR'}})}}
    finally{linking.delete(row.ticketNo)}
  }
  async function deliver(row,{queryOnly=false}={}) {
    if(closed || busy.has(row.ticketNo) || row.effectiveAt && Date.parse(row.effectiveAt)>Date.now())return
    busy.add(row.ticketNo)
    let observed=false
    try {
      let response
      try {response=await cap('/executions/'+row.command.executionId)}
      catch(error) {
        if(error.status!==404 || queryOnly || row.executionKnown || row.execution)throw error
        check(!workflowOptions.isAccountRestricted?.(row.account),409,'APPLICANT_IDENTITY_UNAVAILABLE')
        if(row.command.action==='withdraw_skill' && !canWithdrawSkill(row.command.resourceId)) {
          const latest=applications.get(row.ticketNo)
          if(latest.status!=='等待交付核对') applications.put(row.ticketNo,{...latest,status:'等待交付核对',revision:latest.revision+1})
          return
        }
        response=await cap('/executions','POST',row.command)
      }
      observed=true // A received execution response prevents later automatic reconstruction.
      let execution=await readExecution(response,row.command,{previous:row.execution})
      if(row.ticketType==='KB-04' && execution.status==='succeeded') {
        check(execution.result?.details?.values?.['新目录状态']===row.approvedFields['新目录状态'],409,'EXECUTION_RESULT_MISMATCH','知识库目录状态与获准审查结论不一致，需查证')
      }
      if(['KEY-01','KEY-02'].includes(row.ticketType) && execution.result) {
        const result=execution.result
        const details={}
        for(const key of ['新Dify密钥ID','新密钥后四位','旧密钥撤销结果','Dify密钥ID','密钥后四位','Dify API地址','密钥登记ID','新密钥登记ID','registrationId','revealExpiresAt','明文展示状态']) {
          if(result.details?.[key]!==undefined)details[key]=result.details[key]
        }
        execution={executionId:execution.executionId,ticketNo:execution.ticketNo,status:execution.status,updatedAt:execution.updatedAt,delivery:null,
          result:{ok:result.ok,resultId:result.resultId,failureCode:result.failureCode,
          failureReason:result.failureReason,retryable:result.retryable,version:result.version,sha256:result.sha256,details}}
      }
      if(closed)return
      const latest=applications.get(row.ticketNo)
      if(latest.command?.executionId!==row.command.executionId || latest.execution?.result)return
      let status=execution.status==='succeeded'?(['AG-01','KB-01','KB-02','KB-03','KB-05'].includes(row.ticketType) || ['MCP-02','PLG-03'].includes(row.ticketType) && !row.approvedBy || row.ticketType==='AG-03' && !row.approvedBy?'已完成':'待结果确认'):execution.status==='failed'?'执行失败':execution.status==='cancelled'?'已终止':'执行中'
      if(row.ticketType==='KEY-01' && execution.status==='succeeded')status='待领取密钥'
      if(row.ticketType==='KB-05' && row.node==='pause')status=execution.status==='succeeded'?'待运维确认':execution.status==='failed'?'执行失败':'自动暂停中'
      const safety=row.ticketType==='PLG-04'?pluginSafety.afterResult(latest,execution):{}
      const updated=applications.put(row.ticketNo,{...latest,execution,executionKnown:true,deliveryBlocked:false,status,...safety,
        effectOrder:execution.status==='succeeded'?Math.max(0,...applications.all().map(r=>r.effectOrder ?? 0))+1:latest.effectOrder,
        attempts:(latest.attempts ?? []).map(attempt=>attempt.command.executionId===row.command.executionId?{...attempt,execution}:attempt),revision:latest.revision+1,lastError:null,
        history:latest.execution?.status===execution.status ? latest.history :
          [...latest.history,{at:new Date().toISOString(),actor:'system',action:'执行状态 '+execution.status}]})
      if(updated.urgentNeeded)pluginSafety.escalate(updated)
    } catch(error) {
      if(!closed) {
        const latest=applications.get(row.ticketNo)
        if(latest.command?.executionId!==row.command.executionId || latest.execution?.result)return
        applications.put(row.ticketNo,{...latest,executionKnown:latest.executionKnown || observed,lastError:{code:error.code ?? 'NETWORK_ERROR',at:new Date().toISOString()},
          ...(row.ticketType==='PLG-04' && row.command.action==='disable_plugin'?pluginSafety.urgent(row,error.code ?? 'NETWORK_ERROR'):{}),
          deliveryBlocked:!!error.status && error.status<500})
        if(row.ticketType==='PLG-04')pluginSafety.escalate(applications.get(row.ticketNo))
      }
    } finally {busy.delete(row.ticketNo)}
  }
  const timer=setInterval(()=>{
    for(const row of applications.all()) {
      if(row.ticketType==='PLG-04') {
        if(row.urgentNeeded)pluginSafety.escalate(row)
        if(row.status==='观察中')void pluginSafety.observe(row)
      }
      if(row.pendingDisposition && !row.linkedDispositionTicketNo || row.pendingReviewDisposition && !row.linkedReviewDispositionTicketNo)void linkDisposition(row)
      if(row.command && !row.execution?.result && !row.deliveryBlocked)void deliver(row)
    }
  },2000)
  timer.unref()
  async function handle(req,res,path,identity) {
    check(identity?.active,403,'ACCESS_DENIED')
    const actor=identity.account
    const send=(value,status=200)=>json(res,value?.ticketType?project(value):value,status)
    const operator=identity.roles.includes('operator') || identity.roles.includes('admin')
    const owns=row=>row.account===actor || !!workflowOptions.ownsHistorical?.(row.account,identity)
    const project=row=>({...visibleApplication(row,identity),isApplicant:owns(row),
      canQueryExecution:!!(operator && row.command && !row.execution?.result && (!row.effectiveAt || Date.parse(row.effectiveAt)<=Date.now()) && !['已完成','已终止','已驳回'].includes(row.status))})
    const save=(key,row)=>applications.put(key,{...row,originDraft:row.originDraft ?? (key===req.draftClaim?.ticketNo?req.draftClaim:null),
      applicantRole:row.applicantRole ?? (row.account===actor?identity.roles[0]:accounts.role(row.account))})
    if(req.method==='GET') {
      const view=new URL(req.url,'http://localhost').searchParams.get('view')
      check(['mine','todo','query'].includes(view),400,'INVALID_VIEW')
      check(view==='mine' || operator || identity.roles.includes('admin') && view==='query',403,'ACCESS_DENIED')
      return send({items:applications.all().filter(row=>view==='mine'?owns(row):
        view==='todo'?row.ticketType!=='SVC-01' && (row.deliveryBlocked || row.command && !row.execution?.result || ['待受理','待运维确认','已禁用待确认','待恢复审核','观察中','执行失败'].includes(row.status) || row.creationMode==='告警转单' && row.status==='待结果确认'):true).reverse().map(row=>project(row))})
    }
    check(req.method==='POST' && (!req.headers.origin || new URL(req.headers.origin).host===req.headers.host),403,'ACCESS_DENIED')
    const input=await body(req)
    check(typeof input?.ticketNo==='string' && /^(AG-(01|02|03|04|05)|KB-(01|02|03|04|05)|MCP-(01|02|03)|SKL-(01|02|04)|KEY-(01|02)|TOL-01|PLG-(01|02|03|04))-[\w-]{1,90}$/.test(input.ticketNo),400,'INVALID_TICKET')
    const previous=applications.get(input.ticketNo)
    const at=new Date().toISOString()
    if(path==='/api/applications/reveal') {
      check(previous && owns(previous),404,'NOT_FOUND')
      check(previous.execution?.status==='succeeded' && (previous.ticketType==='KEY-01' ||
        previous.ticketType==='KEY-02' && previous.command.action==='rotate_key'),409,'REVEAL_NOT_READY')
      check(!['sending','shown'].includes(previous.revealState),409,'REVEAL_UNAVAILABLE')
      const metadata=previous.execution.result?.details
      const registrationId=metadata?.registrationId ?? metadata?.['新密钥登记ID'] ?? metadata?.['密钥登记ID']
      check(typeof registrationId==='string' && registrationId,409,'MISSING_KEY_REGISTRATION')
      save(input.ticketNo,{...previous,revealState:'sending',revision:previous.revision+1})
      try {
        const revealed=await(await cap('/key-registrations/'+encodeURIComponent(registrationId)+'/reveal','POST',{},
          headersFor({command:{...previous.command,account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}))).json()
        check(typeof revealed.secret==='string' && revealed.secret,503,'INVALID_REVEAL')
        const current=applications.get(input.ticketNo)
        save(input.ticketNo,{...current,revealState:'consumed_unconfirmed',revision:current.revision+1})
        res.once('finish',()=>{
          const latest=applications.get(input.ticketNo)
          save(input.ticketNo,{...latest,revealState:'shown',
            status:previous.ticketType==='KEY-01'?'已完成':latest.status,revision:latest.revision+1,
            history:[...latest.history,{at:new Date().toISOString(),actor,action:'一次性领取密钥'}]})
        })
        return send({secret:revealed.secret})
      } catch(error) {
        const current=applications.get(input.ticketNo)
        save(input.ticketNo,{...current,revealState:'consumed_unconfirmed',revision:current.revision+1})
        throw error
      }
    }
    if(path==='/api/applications/transition') {
      check(previous,404,'NOT_FOUND')
      if(input.action==='终止工单' && previous.status==='已终止') {
        check(operator,403,'ACCESS_DENIED')
        return send(visibleApplication(previous,identity))
      }
      check(previous.revision===input.revision,409,'VERSION_CONFLICT')
      check(typeof input.note==='string' && input.note.trim() && input.note.length<=4000,400,'INVALID_NOTE')
      if(input.action==='查证原执行') {
        check(operator,403,'ACCESS_DENIED')
        check(previous.command && !previous.execution?.result && !['已完成','已终止','已驳回'].includes(previous.status),409,'INVALID_TRANSITION')
        check(!previous.effectiveAt || Date.parse(previous.effectiveAt)<=Date.now(),409,'EXECUTION_NOT_DUE')
        check(!busy.has(previous.ticketNo),409,'EXECUTION_BUSY')
        const row=save(input.ticketNo,{...previous,revision:previous.revision+1,
          history:[...previous.history,{at,actor,action:input.action,note:input.note.trim(),executionId:previous.command.executionId,
            previousErrorCode:previous.lastError?.code ?? null}]})
        await deliver(row,{queryOnly:true})
        check(!workflowOptions.isCurrentOperator || workflowOptions.isCurrentOperator(identity),403,'OPERATOR_SESSION_CHANGED')
        return send(applications.get(input.ticketNo))
      }
      if(previous.ticketType==='PLG-04' && !['重试执行','终止工单'].includes(input.action))return send(await pluginSafety.transition(previous,input,identity))
      if(previous.ticketType==='KB-04' && ['提交变更审查','退回补正','确认审查','撤回'].includes(input.action)) {
        if(input.action==='退回补正' || input.action==='撤回') {
          check(previous.status==='待受理',409,'INVALID_TRANSITION')
          check(input.action==='退回补正'?operator:actor===previous.account,403,'ACCESS_DENIED')
          return send(save(input.ticketNo,{...previous,status:input.action==='退回补正'?'待补正':'待所有者提交',revision:previous.revision+1,
            history:[...previous.history,{at,actor,action:input.action,note:input.note.trim()}]}))
        }
        const submitting=input.action==='提交变更审查'
        check(submitting?actor===previous.account:operator,403,'ACCESS_DENIED')
        check(submitting?['待所有者提交','待补正'].includes(previous.status):previous.status==='待受理',409,'INVALID_TRANSITION')
        const current=await datasetChangesContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
          previous.submission.resourceId,previous.sourceEventId)
        unchangedDatasetChanges(previous.snapshot,current,relatedPauseSucceeded(previous))
        check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
        if(submitting) return send(save(input.ticketNo,{...previous,status:'待受理',revision:previous.revision+1,
          snapshot:current,preconditions:current.preconditions,
          submission:{...previous.submission,fields:{changeReason:input.note.trim()}},
          history:[...previous.history,{at,actor,action:input.action,note:input.note.trim()}]}))
        const approvedFields={...confirmDatasetChanges(current,input,actor,at),'变更原因':previous.submission.fields.changeReason}
        const executionId=id()
        const command={executionId,ticketNo:previous.ticketNo,ticketType:'KB-04',ticketTypeVersion:previous.ticketTypeVersion,
          action:'review_dataset_changes',resourceId:previous.submission.resourceId,account:previous.account,org:previous.org,payload:{decisionRef:'dec-'+executionId}}
        const reviewDisposition=input.reviewVerdict==='不通过'?changesDisposition(previous,approvedFields['文档确认记录']):null
        const pendingDisposition=previous.pendingDisposition ?? reviewDisposition
        const pendingReviewDisposition=previous.pendingDisposition?reviewDisposition:null
        const approved=save(input.ticketNo,{...previous,status:'执行中',revision:previous.revision+1,approvedBy:actor,approvedAt:at,
          command,approvedFields,pendingDisposition,pendingReviewDisposition,snapshot:current,preconditions:current.preconditions,attempts:[{command,approvedFields,preconditions:current.preconditions}],
          history:[...previous.history,{at,actor,action:'确认审查 '+input.reviewVerdict,note:input.note.trim()}]})
        if(pendingDisposition)void linkDisposition(approved)
        void deliver(approved)
        return send(approved)
      }
      if(previous.ticketType==='KB-04')check(!['批准','驳回'].includes(input.action),400,'USE_DATASET_REVIEW','请使用逐文档审查办理入口')
      if(['重试执行','终止工单'].includes(input.action)) {
        check(operator,403,'ACCESS_DENIED')
        check(previous.status==='执行失败' && previous.execution?.status==='failed',409,'INVALID_TRANSITION')
        if(input.action==='终止工单') return send(save(input.ticketNo,{...previous,status:'已终止',
          revision:previous.revision+1,history:[...previous.history,{at,actor,action:'终止工单',note:input.note.trim()}]}))
        check(previous.execution.result?.retryable===true,409,'NOT_RETRYABLE')
        const command={...previous.command,executionId:id()}
        if(previous.command.payload.decisionRef)command.payload={decisionRef:'dec-'+command.executionId}
        const retried=save(input.ticketNo,{...previous,command,
          attempts:[...(previous.attempts ?? [{command:previous.command,execution:previous.execution}]),{command,approvedFields:previous.approvedFields,preconditions:previous.preconditions,
            ...(previous.nodeIndex!==undefined?{nodeIndex:previous.nodeIndex}:{})}],
          execution:null,executionKnown:false,deliveryBlocked:false,lastError:null,status:'执行中',revision:previous.revision+1,
          history:[...previous.history,{at,actor,action:'重试执行',note:input.note.trim()}]})
        void deliver(retried)
        return send(retried)
      }
      if(input.action==='确认结果') {
        if(previous.ticketType==='KEY-02' && previous.command?.action==='rotate_key')check(previous.revealState==='shown',409,'KEY_REVEAL_REQUIRED')
        check(owns(previous) || previous.creationMode==='告警转单' && operator,403,'ACCESS_DENIED')
        check(previous.status==='待结果确认',409,'INVALID_TRANSITION')
        return send(save(input.ticketNo,{...previous,status:'已完成',revision:previous.revision+1,
          history:[...previous.history,{at,actor,action:'确认结果',note:input.note.trim()}]}))
      }
      check(previous.status==='待受理' || previous.ticketType==='KB-05' && previous.status==='待运维确认' && input.action==='批准',409,'INVALID_TRANSITION')
      check(input.action==='撤回' && owns(previous) || ['驳回','批准'].includes(input.action) && operator,403,'ACCESS_DENIED')
      if(input.action==='批准') {
        let currentAgentImpact=null
        if(['AG-04','AG-05'].includes(previous.ticketType)) {
          const current=await agentManagementContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
            previous.submission.resourceId,previous.submission.workspaceId,previous.ticketType==='AG-04'?'republish':'withdraw_app')
          check(['appId','workspaceId','publicationVersionId','workflowSnapshotId','policyRef'].every(key=>same(current.data[key],previous.originalCatalog.data[key])),409,'STALE_SNAPSHOT','目录原版本或授权依据已变化，请重新申请')
          const latest=await agentImpactContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),previous.submission.resourceId,previous.submission.workspaceId,previous.ticketType==='AG-04'?'republish':'withdraw_app')
          check(latest.publicationVersionId===previous.snapshot.data.publicationVersionId && latest.workflowSnapshotId===(previous.snapshot.data.workflowSnapshotId ?? null) && latest.catalogRevision===previous.snapshot.data.catalogRevision,409,'STALE_SNAPSHOT')
          currentAgentImpact=latest.impact
          requireAgentImpact(currentAgentImpact,previous.ticketType==='AG-04'?'republish':'withdraw_app')
          check(previous.agentImpact && sameAgentImpact(previous.agentImpact,currentAgentImpact),409,'STALE_AGENT_IMPACT','影响清单或依赖已变化，请重新申请')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
        }
        if(previous.ticketType==='AG-03') check(Date.parse(previous.submission.fields.expiresAt)>Date.now(),409,'AUTHORIZATION_EXPIRED')
        const data=previous.snapshot.data ?? previous.snapshot.fields
        const warnings=(data.dependencies ?? []).filter(d=>!d.approved || !d.externalAllowed)
        if(['AG-02','AG-04'].includes(previous.ticketType) && warnings.length) check(input.warningDecision==='确认风险并继续审批',400,'WARNING_DECISION_REQUIRED')
        const fields=previous.submission.fields
        const command={executionId:id(),ticketNo:previous.ticketNo,ticketType:previous.ticketType,
          ticketTypeVersion:previous.ticketTypeVersion,action:'publish',resourceId:previous.submission.resourceId,
          account:previous.account,org:previous.org,payload:{
            name:previous.snapshot?.name || data?.name || undefined,
            snapshotId:previous.snapshot.snapshotId,workspaceId:previous.submission.workspaceId,
            publicationVersionId:data.publicationVersionId,expectedRevision:data.catalogRevision,
            scope:fields.scope,targetOrgs:fields.scope==='orgs'?fields.targetOrgs:[],
            targetAccounts:fields.scope==='accounts'?fields.targetAccounts:[],
            boundaryOrgs:fields.boundaryOrgs,usages:fields.usages}}
        let approvedFields=command.payload
        let approvedSnapshot=previous.snapshot,approvedPreconditions=previous.preconditions
        let policy
        if(approvalHandlers[previous.ticketType]) {
          const context={accounts,applications,approvedFields,approvedPreconditions,approvedSnapshot,cap,command,fields,headersFor,input,previous,currentAgentImpact,data,warnings,policy,actor,at}
          const changed=await approvalHandlers[previous.ticketType](context)
          ;({approvedFields,approvedPreconditions,approvedSnapshot,policy}={...context,...changed})
        }















        if(Object.hasOwn(revisionKinds,previous.ticketType)) {
          if(previous.ticketType==='SKL-02')check(['保留且不可新增下载','继续可下载'].includes(input.historyPolicy),400,'HISTORY_POLICY_REQUIRED')
          else check(['允许','禁止'].includes(input.externalAllowed),400,'EXTERNAL_PERMISSION_REQUIRED')
          const headers=headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}})
          const current=await packageRevisionContext(cap,headers,previous.ticketType,previous.submission.resourceId)
          const intake=await readyIntake(cap,headers,revisionKinds[previous.ticketType],fields.intakeId)
          checkNewPackage(previous.ticketType,fields,current,intake)
          check(same(current.fields,previous.snapshot.fields) && same(current.preconditions,previous.snapshot.preconditions) &&
            intake.sha256===previous.snapshot.data.sha256 && same(intake.packageMetadata,previous.snapshot.data.packageMetadata),
            409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action=revisionActions[previous.ticketType];command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields=packageRevisionFields(previous.ticketType,fields,current,intake,input)
        }

        const approved=save(input.ticketNo,{...previous,status:'执行中',revision:previous.revision+1,
            ...currentAgentImpact?{approvedImpact:currentAgentImpact}:{},
          command,approvedFields,policy,snapshot:approvedSnapshot,preconditions:approvedPreconditions,
          ...(previous.ticketType==='KB-05'?{node:'dispose',execution:null,executionKnown:false}:{}),
          effectiveAt:['AG-05','SKL-04','KEY-02'].includes(previous.ticketType)?fields.effectiveAt:null,
          attempts:[...(previous.attempts ?? []),{command,approvedFields,preconditions:approvedPreconditions}],approvedBy:actor,approvedAt:at,warningDecision:input.warningDecision,
          history:[...previous.history,{at,actor,action:'批准',note:input.note.trim()}]})
        void deliver(approved)
        return send(approved)
      }
      return send(save(input.ticketNo,{...previous,status:input.action==='撤回'?'已撤回':'已驳回',revision:previous.revision+1,
        history:[...previous.history,{at,actor,action:input.action,note:input.note.trim()}]}))
    }
    check(path==='/api/applications',404,'NOT_FOUND')
    if(['KB-05','SKL-01','SKL-02','SKL-04','KEY-02','MCP-01','PLG-01','PLG-02'].includes(input.ticketType) || input.ticketType==='MCP-03' && input.fields?.operation!=='单用户解绑')input.workspaceId=''
    check(['AG-01','AG-02','AG-03','AG-04','AG-05','KB-01','KB-02','KB-03','KB-05','MCP-01','MCP-02','MCP-03','SKL-01','SKL-02','SKL-04','KEY-01','KEY-02','TOL-01','PLG-01','PLG-02','PLG-03'].includes(input.ticketType) && input.ticketNo.startsWith(input.ticketType+'-') && typeof input.resourceId==='string' && input.resourceId &&
      typeof input.workspaceId==='string' && (input.workspaceId || ['KB-05','SKL-01','SKL-02','SKL-04','MCP-03','KEY-02','MCP-01','PLG-01','PLG-02'].includes(input.ticketType)),400,'INVALID_APPLICATION')
    let fields=input.ticketType==='AG-01'?{}:input.fields
    if(input.ticketType==='KB-05')fields={target:fields?.target,documentIds:fields?.documentIds,reason:fields?.reason,facts:fields?.facts,evidenceIds:fields?.evidenceIds ?? []}
    if(input.ticketType==='KB-03')fields={purpose:fields?.purpose,permission:fields?.permission,targetAppId:fields?.targetAppId ?? '',startsAt:fields?.startsAt,expiresAt:fields?.expiresAt}
    if(input.ticketType==='MCP-02')fields={purpose:fields?.purpose,targetAppId:fields?.targetAppId ?? '',startsAt:fields?.startsAt,expiresAt:fields?.expiresAt}
    if(input.ticketType==='PLG-03')fields={operation:fields?.operation,purpose:fields?.purpose ?? '',installationId:fields?.installationId ?? ''}
    if(input.ticketType==='MCP-01')fields={name:fields?.name,purpose:fields?.purpose,boundaryOrgs:fields?.boundaryOrgs,classification:fields?.classification,businessLine:fields?.businessLine}
    if(input.ticketType==='KEY-01')fields={purpose:fields?.purpose,callerName:fields?.callerName,callerOrg:fields?.callerOrg,environment:fields?.environment,allowedCidrs:fields?.allowedCidrs,peakQps:fields?.peakQps,expiresAt:fields?.expiresAt,publicationTicketNo:fields?.publicationTicketNo}
    if(input.ticketType==='KEY-02') {
      fields={operation:fields?.operation,reason:fields?.reason,effectiveAt:fields?.effectiveAt,newExpiresAt:fields?.newExpiresAt}
    }
    const text=value=>typeof value==='string' && value.trim() && value.length<=4000
    const list=value=>Array.isArray(value) && value.length>0 && value.length<=100 && value.every(text)
    if(input.ticketType==='KB-05')validateDatasetDisposition(fields)
    else if(input.ticketType==='PLG-03') check(fields && Object.hasOwn(pluginOperationActions,fields.operation) && (!fields.purpose || text(fields.purpose)),400,'INVALID_FIELDS')
    else if(Object.hasOwn(revisionKinds,input.ticketType)) check(fields && text(fields.intakeId) &&
      text(fields.changeDescription) && (input.ticketType==='SKL-02'?text(fields.newVersion) && text(fields.compatibility):
        ['逐个工单升级','仅新安装使用新版本'].includes(fields.upgradePolicy)),400,'INVALID_FIELDS')
    else if(input.ticketType==='PLG-01') check(fields && fields.intakeId===input.resourceId &&
      text(fields.description) && text(fields.instructions) && list(fields.permissions) &&
      ['公开免审安装','受限安装'].includes(fields.accessMode) &&
      (fields.accessMode!=='受限安装' || list(fields.visibleOrgs)) &&
      ['本地包','GitHub','市场'].includes(fields.installationMethod) &&
      Array.isArray(fields.networkAccess) && fields.networkAccess.every(n=>text(n.domain) &&
        Number.isInteger(n.port) && n.port>=1 && n.port<=65535 && text(n.purpose)),400,'INVALID_FIELDS')
    else if(input.ticketType==='SKL-01') check(fields && text(fields.intakeId) && text(fields.name) &&
      text(fields.version) && text(fields.description) && text(fields.instructions) && text(fields.license) &&
      list(fields.tags) && ['全网段公开','指定组织','指定人员'].includes(fields.scope) &&
      (fields.scope!=='指定组织' || list(fields.targetOrgs)) &&
      (fields.scope!=='指定人员' || list(fields.targetAccounts)),400,'INVALID_FIELDS')
    else if(input.ticketType==='MCP-01') check(fields && text(fields.name) && text(fields.purpose) &&
      list(fields.boundaryOrgs) && ['公开','内部','敏感','机密'].includes(fields.classification) && text(fields.businessLine),
      400,'INVALID_FIELDS')
    else if(input.ticketType==='KEY-01') check(['本人调试','已发布应用API调用','系统集成'].includes(fields.purpose) &&
      text(fields.callerName) && text(fields.callerOrg) && ['开发','测试','生产'].includes(fields.environment) &&
      validCidrs(fields.allowedCidrs) && typeof fields.peakQps==='number' && Number.isFinite(fields.peakQps) && fields.peakQps>0 &&
      typeof fields.expiresAt==='string' && Date.parse(fields.expiresAt)>Date.now() &&
      (fields.purpose==='本人调试' || text(fields.publicationTicketNo)),400,'INVALID_FIELDS')
    else if(input.ticketType==='TOL-01') check(fields &&
      ['首次批准','变更再审','撤销批准'].includes(fields.operation) && text(fields.description) && text(fields.purpose) &&
      list(fields.permissions) && list(fields.targetOrgs) && ['公开','内部','敏感','机密'].includes(fields.classification) &&
      text(fields.businessLine),400,'INVALID_FIELDS')
    else if(input.ticketType==='KEY-02') check(Object.hasOwn(keyActions,fields.operation) && text(fields.reason) &&
      typeof fields.effectiveAt==='string' && Number.isFinite(Date.parse(fields.effectiveAt)) &&
      (fields.operation!=='轮换' || typeof fields.newExpiresAt==='string' &&
        Date.parse(fields.newExpiresAt)>Math.max(Date.now(),Date.parse(fields.effectiveAt))),400,'INVALID_FIELDS')
    else if(input.ticketType==='MCP-03') check(fields && Object.hasOwn(mcpDispositionActions,fields.operation) && ['主动解绑','授权到期','异常调用','安全问题','其他'].includes(fields.reason) && text(fields.facts) && (fields.operation!=='单用户解绑' || text(fields.targetAccount) && text(input.workspaceId)),400,'INVALID_FIELDS')
    else if(input.ticketType==='SKL-04') check(fields && ['主动下架','安全问题','授权问题','过期','其他'].includes(fields.reason) && text(fields.explanation) && typeof fields.effectiveAt==='string' && Number.isFinite(Date.parse(fields.effectiveAt)),400,'INVALID_FIELDS')
    else if(['KB-03','MCP-02'].includes(input.ticketType)) check(fields && text(fields.purpose) &&
      (input.ticketType==='MCP-02' || ['检索使用','编排绑定'].includes(fields.permission)) && typeof fields.startsAt==='string' &&
      typeof fields.expiresAt==='string' && Number.isFinite(Date.parse(fields.startsAt)) &&
      Date.parse(fields.expiresAt)>Math.max(Date.now(),Date.parse(fields.startsAt)) &&
      (!fields.targetAppId || text(fields.targetAppId)),400,'INVALID_FIELDS')
    else if(input.ticketType==='KB-02') check(fields && ['RAGFlow','Dify'].includes(fields.sourceSystem) &&
      ['共享目录','指定组织','指定人员','随应用发布'].includes(fields.shareMode) && text(fields.purpose) &&
      text(fields.name) && text(fields.description) && list(fields.tags) && list(fields.boundaryOrgs) &&
      ['公开','内部','敏感','机密','开放','限定范围'].includes(fields.classification) && text(fields.businessLine) &&
      (fields.shareMode!=='指定组织' || list(fields.targetOrgs)) && (fields.shareMode!=='指定人员' || list(fields.targetAccounts)) &&
      (fields.shareMode!=='随应用发布' || text(fields.relatedAppId) && text(fields.relatedWorkspaceId)) &&
      (!fields.expiresAt || Date.parse(fields.expiresAt)>Date.now()),400,'INVALID_FIELDS')
    else if(input.ticketType==='KB-01') check(fields && ['RAGFlow','Dify'].includes(fields.sourceSystem),400,'INVALID_FIELDS')
    else if(input.ticketType==='AG-05') check(fields && ['主动下架','版本替换','安全事件','长期故障','其他'].includes(fields.reason) && text(fields.explanation) && typeof fields.effectiveAt==='string' && Number.isFinite(Date.parse(fields.effectiveAt)),400,'INVALID_FIELDS')
    else if(input.ticketType==='AG-03') check(fields && text(fields.purpose) &&
      typeof fields.startsAt==='string' && typeof fields.expiresAt==='string' &&
      Number.isFinite(Date.parse(fields.startsAt)) && Date.parse(fields.expiresAt)>Date.now() &&
      Date.parse(fields.expiresAt)>Date.parse(fields.startsAt) && list(fields.usages) &&
      fields.usages.every(v=>['run','embed','api'].includes(v)),400,'INVALID_FIELDS')
    else if(input.ticketType==='AG-04') check(fields && text(fields.changeDescription),400,'INVALID_FIELDS')
    else if(input.ticketType==='AG-02') check(fields && text(fields.scenario) && text(fields.instructions) && text(fields.businessLine) &&
      ['公开','内部','敏感','机密'].includes(fields.classification) && ['all','orgs','accounts'].includes(fields.scope) &&
      list(fields.boundaryOrgs) && Array.isArray(fields.usages) && fields.usages.length>0 &&
      fields.usages.every(value=>['run','embed','api'].includes(value)) &&
      (fields.scope!=='orgs' || list(fields.targetOrgs)) &&
      (fields.scope!=='accounts' || list(fields.targetAccounts)),400,'INVALID_FIELDS')
    const submission={resourceId:input.resourceId,workspaceId:input.workspaceId,fields}
    if(previous) {
      check(owns(previous) && same(previous.submission,submission),409,'APPLICATION_CONFLICT')
      return send(visibleApplication(previous,identity))
    }
    const version=types.activeVersion(input.ticketType,input.workspaceId)
    if(submissionHandlers[input.ticketType]) return submissionHandlers[input.ticketType]({accounts,actor,applications,at,cap,evidence,fields,headersFor,identity,input,owns,save,send,submission,types,version,deliver,text,visibleApplication})

    if(Object.hasOwn(revisionKinds,input.ticketType)) {
      const headers=headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}})
      const context=await packageRevisionContext(cap,headers,input.ticketType,input.resourceId)
      const intake=await readyIntake(cap,headers,revisionKinds[input.ticketType],fields.intakeId)
      checkNewPackage(input.ticketType,fields,context,intake)
      check(types.activeVersion(input.ticketType)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      const preconditions=[...context.preconditions,{kind:revisionKinds[input.ticketType]+'_upload',id:fields.intakeId,sha256:intake.sha256}]
      return send(save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:input.ticketType,ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot:{...context,data:intake},preconditions,status:'待受理',revision:1,
        history:[{at,actor,action:'提交包版本变更再审'}]}),201)
    }











    check(false, 400, 'UNSUPPORTED_TICKET_TYPE')
  }
  async function ingestDatasetAlert(input) {
    check(typeof input.sourceEventId==='string' && input.sourceEventId.length>0 && input.sourceEventId.length<=200 &&
      typeof input.resourceId==='string' && input.resourceId.length>0 && input.resourceId.length<=200,400,'INVALID_ALERT')
    const fields={target:input.fields?.target,documentIds:input.fields?.documentIds,reason:input.fields?.reason,facts:input.fields?.facts}
    validateDatasetDisposition(fields)
    check(['内容违规','权限越界'].includes(fields.reason),400,'INVALID_ALERT_REASON')
    const ticketNo='KB-05-alert-'+digest(input.sourceEventId).slice(0,40)
    const submission={ticketType:'KB-05',resourceId:input.resourceId,workspaceId:'',fields}
    function duplicate(row) {
      check(row.sourceEventId===input.sourceEventId && same(row.submission,submission),409,'ALERT_CONFLICT')
      return row
    }
    const previous=applications.get(ticketNo)
    if(previous)return duplicate(previous)
    const version=types.activeVersion('KB-05')
    const snapshot=await datasetDispositionContext(cap,headersFor({command:{account:'system_event',org:'系统服务'}}),
      input.resourceId,fields,'pause_share',input.sourceEventId)
    check(types.activeVersion('KB-05')===version,409,'TYPE_VERSION_CHANGED')
    const concurrent=applications.get(ticketNo)
    if(concurrent)return duplicate(concurrent)
    const executionId=id(),at=new Date().toISOString()
    const command={executionId,ticketNo,ticketType:'KB-05',ticketTypeVersion:version,action:'pause_share',
      resourceId:input.resourceId,account:'system_event',org:'系统服务',payload:{decisionRef:'dec-'+executionId}}
    const approvedFields={'创建方式':'告警转单','告警ID':input.sourceEventId,'处置对象':fields.target,
      '文档ID列表':fields.documentIds,'处置动作':['暂停分享'],'证据附件':snapshot.fields['告警证据']}
    const row=applications.put(ticketNo,{ticketNo,ticketType:'KB-05',ticketTypeVersion:version,account:'system_event',org:'系统服务',
      creationMode:'告警转单',sourceEventId:input.sourceEventId,submission,snapshot,evidenceRefs:snapshot.fields['告警证据'],
      preconditions:snapshot.preconditions,node:'pause',status:'自动暂停中',revision:1,command,approvedFields,
      attempts:[{command,approvedFields,preconditions:snapshot.preconditions}],history:[{at,actor:'system_event',action:'告警创建并自动暂停分享'}]})
    void deliver(row)
    return row
  }
  async function ingestDatasetChanges(input) {
    check(typeof input.sourceEventId==='string' && input.sourceEventId.length>0 && input.sourceEventId.length<=200 &&
      typeof input.resourceId==='string' && input.resourceId.length>0 && input.resourceId.length<=200,400,'INVALID_CHANGE_EVENT')
    const ticketNo='KB-04-change-'+digest(input.sourceEventId).slice(0,40)
    const previous=applications.get(ticketNo)
    if(previous) {
      check(previous.submission.resourceId===input.resourceId,409,'CHANGE_EVENT_CONFLICT')
      return previous
    }
    const version=types.activeVersion('KB-04')
    const snapshot=await datasetChangesContext(cap,headersFor({command:{account:'system_event',org:'系统服务'}}),input.resourceId,input.sourceEventId)
    const owner=snapshot.fields['所有者账户名']
    check(accounts.has(owner),409,'UNKNOWN_DATASET_OWNER')
    check(types.activeVersion('KB-04')===version,409,'TYPE_VERSION_CHANGED')
    const concurrent=applications.get(ticketNo)
    if(concurrent){check(concurrent.submission.resourceId===input.resourceId,409,'CHANGE_EVENT_CONFLICT');return concurrent}
    const row={ticketNo,ticketType:'KB-04',ticketTypeVersion:version,sourceEventId:input.sourceEventId,creationMode:'系统起草',
      account:owner,org:accounts.get(owner),submission:{resourceId:input.resourceId,workspaceId:snapshot.fields['workspace/tenant ID'],fields:{changeReason:''}},
      snapshot,preconditions:snapshot.preconditions,status:'待所有者提交',revision:1,
      history:[{at:new Date().toISOString(),actor:'system_event',action:'系统起草知识库变更再审'}]}
    if(snapshot.fields['自动审查结论']==='不通过')row.pendingDisposition=changesDisposition(row)
    applications.put(ticketNo,row)
    if(row.pendingDisposition)void linkDisposition(row)
    return row
  }
  function saveServiceRestart(row) {
    check(row?.ticketType==='SVC-01' && /^SVC-01-[a-f0-9]{40}$/.test(row.ticketNo),400,'INVALID_TICKET')
    check(row.account==='system_event' && row.org==='系统服务' && row.creationMode==='系统巡检' && row.approvalMode==='自动审批',400,'INVALID_SERVICE_RESTART')
    check(typeof row.submission?.resourceId==='string' && row.submission.resourceId && typeof row.snapshot?.snapshotId==='string' &&
      Number.isInteger(row.revision) && row.revision>0 && Array.isArray(row.history),400,'INVALID_SERVICE_RESTART')
    const previous=applications.get(row.ticketNo)
    if(previous) {
      check(previous.ticketType==='SVC-01' && previous.submission.resourceId===row.submission.resourceId,409,'TICKET_TYPE_CONFLICT')
      check(row.revision===previous.revision+1,409,'VERSION_CONFLICT')
    } else check(row.revision===1,409,'VERSION_CONFLICT')
    return applications.put(row.ticketNo,row)
  }
  return {handle,ingestDatasetAlert,ingestDatasetChanges,ingestPluginAlert:pluginSafety.ingest,records:applications.all,
    serviceRestart:ticketNo=>applications.get(ticketNo),saveServiceRestart,
    close(){closed=true;pluginSafety.close();clearInterval(timer);applications.close()}}
}
