import {check} from '../../../../runtime/http.mjs'
import {json} from '../../../../runtime/http.mjs'
import {body} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeEvents(services) {
  const {applications,directory,events,hasRole,identity,path,req,res,tickets,types}=services;

      check(identity?.active,403,'ACCESS_DENIED')
      const actor=identity.account
      const operator=hasRole(identity,'operator')
      if (req.method==='GET' && path==='/api/events') {
        const view=new URL(req.url,'http://localhost').searchParams.get('view')
        check(['mine','todo','query'].includes(view),400,'INVALID_VIEW')
        check(view==='mine' || operator || hasRole(identity,'admin'),403,'ACCESS_DENIED')
        return json(res,{items:events.all().filter(row=>view==='mine' ? directory.owns(row.account,identity) :
          view==='query' || (operator || hasRole(identity,'admin')) && row.status!=='已关闭').reverse().map(row=>({...row,handledByCurrent:directory.owns(row.handler,identity)}))})
      }
      check(req.method==='POST' && (!req.headers.origin || new URL(req.headers.origin).host===req.headers.host),403,'ACCESS_DENIED')
      const input=await body(req)
      check(typeof input?.ticketNo==='string' && /^EVT-01-[\w-]{1,90}$/.test(input.ticketNo),400,'INVALID_REQUEST')
      const previous=events.get(input.ticketNo)
      const at=new Date().toISOString()
      if (path==='/api/events/attachments') {
        check(previous,404,'NOT_FOUND')
        check(directory.owns(previous.account,identity) || operator,403,'ACCESS_DENIED')
        check(previous.revision===input.revision,409,'VERSION_CONFLICT','工单已更新，请刷新')
        check(typeof input.evidenceId==='string' && /^[a-f0-9-]{36}$/.test(input.evidenceId),400,'INVALID_EVIDENCE')
        check(typeof input.filename==='string' && input.filename.trim() && input.filename.length<=200 && !/[\\/]/.test(input.filename),400,'INVALID_FILENAME')
        check(typeof input.sha256==='string' && /^[a-f0-9]{64}$/.test(input.sha256),400,'INVALID_EVIDENCE')
        check(Number.isInteger(input.sizeBytes) && input.sizeBytes>0 && input.sizeBytes<=10*1024*1024,400,'INVALID_EVIDENCE')
        const attachments=Array.isArray(previous.attachments)?previous.attachments:[]
        check(attachments.length<20 && !attachments.some(item=>item.evidenceId===input.evidenceId),409,'EVIDENCE_CONFLICT')
        return json(res,events.put(input.ticketNo,{...previous,attachments:[...attachments,{evidenceId:input.evidenceId,filename:input.filename.trim(),sha256:input.sha256,sizeBytes:input.sizeBytes,actor}],revision:previous.revision+1,history:[...previous.history,{at,actor,action:'补充附件',fromStatus:previous.status,toStatus:previous.status,note:input.filename.trim()}]}))
      }
      if (path==='/api/events') {
        check(typeof input.facts==='string' && input.facts.trim() && input.facts.length<=4000 &&
          typeof input.resourceId==='string' && input.resourceId.trim() && input.resourceId.length<=200,400,'INVALID_FIELDS','请填写事件对象与事实说明')
        check(['知识库','智能体','插件','MCP','智能体仓库','账号与集成'].includes(input.objectType),400,'INVALID_OBJECT_TYPE')
        if (previous) {
          check(directory.owns(previous.account,identity) && previous.facts===input.facts.trim() && previous.resourceId===input.resourceId && previous.objectType===input.objectType,409,'EVENT_CONFLICT')
          return json(res,previous)
        }
        const severity=['提示','一般','重要','严重','紧急'].includes(input.severity)?input.severity:'一般'
        return json(res,events.put(input.ticketNo,{ticketNo:input.ticketNo,account:actor,resourceId:input.resourceId,originDraft:req.draftClaim ?? null,
          facts:input.facts.trim(),objectType:input.objectType,creationMode:'人工报告',alertId:'AL-'+id(),ruleCode:'MANUAL_REPORT',originalSeverity:severity,firstOccurredAt:at,lastOccurredAt:at,
          evidence:{facts:input.facts.trim()},status:'未研判',version:types.activeVersion('EVT-01'),revision:1,history:[{at,actor,action:'人工报告',fromStatus:null,toStatus:'未研判'}]}),201)
      }
      check(operator || hasRole(identity,'admin'),403,'ACCESS_DENIED')
      check(previous,404,'NOT_FOUND')
      check(previous.revision===input.revision,409,'VERSION_CONFLICT','工单已更新，请刷新')
      check(typeof input.note==='string' && input.note.trim() && input.note.length<=4000,400,'INVALID_FIELDS','请填写办理依据')
      const assessment=previous.status==='未研判' ? input.assessment : previous.assessment
      if(previous.status==='未研判') check(assessment &&
        ['提示','一般','严重','紧急'].includes(assessment.severity) &&
        ['真实故障','安全事件','误报','重复告警'].includes(assessment.conclusion) &&
        ['资源','网络','产品服务','插件代码','权限','数据','未知'].includes(assessment.cause) &&
        typeof assessment.impact==='string' && assessment.impact.trim() && assessment.impact.length<=4000,
        400,'INVALID_ASSESSMENT','请填写研判级别、结论、影响范围和根因')
      if(input.action==='提交误报复核') check(['误报','重复告警'].includes(assessment?.conclusion),400,'INVALID_CONCLUSION','误报复核须选择误报或重复告警结论')
      const disposition=previous.status==='处理中' && input.action==='提交复核' ? input.disposition : previous.disposition
      if(previous.status==='处理中' && input.action==='提交复核') {
        check(disposition && Array.isArray(disposition.actions) && disposition.actions.length>0 &&
          disposition.actions.every(a=>['观察','重试','禁用插件','停用文档','隔离MCP','下架应用','撤销密钥','转其他工单'].includes(a)) &&
          typeof disposition.result==='string' && disposition.result.trim() && disposition.result.length<=4000,
          400,'INVALID_DISPOSITION','请填写处置动作和结果')
        const relatedTypes={'禁用插件':'disable_plugin','停用文档':'dispose_dataset','隔离MCP':'isolate_mcp','下架应用':'withdraw_app','撤销密钥':'revoke_key'}
        for(const action of disposition.actions) {
          if(!relatedTypes[action] && action!=='转其他工单') continue
          check(Array.isArray(disposition.linkedTicketNos) && disposition.linkedTicketNos.some(number=>{
            const linked=tickets.get(number) ?? applications.records().find(row=>row.ticketNo===number)
            return (linked?.state ?? linked?.execution)?.status==='succeeded' &&
              (action==='转其他工单' || linked.command.action===relatedTypes[action]) &&
              linked.command.resourceId===previous.resourceId
          }),409,'RELATED_EXECUTION_REQUIRED','需先关联同对象已完成的处置工单')
        }
        if(disposition.recovered) check(typeof disposition.recoveredAt==='string' &&
          Number.isFinite(Date.parse(disposition.recoveredAt)) && Date.parse(disposition.recoveredAt)<=Date.now(),
          400,'INVALID_RECOVERY_TIME','已恢复时请填写有效恢复时间')
      }
      const transitions={'未研判':{'开始处置':'处理中','提交误报复核':'待复核'},'处理中':{'提交复核':'待复核'},
        '已重开':{'开始处置':'处理中'},'待复核':{'确认关闭':'已关闭','重新处置':'已重开','继续观察':'观察中'}}
      const allowed=transitions[previous.status]
      check(allowed && Object.hasOwn(allowed,input.action),409,'INVALID_TRANSITION')
      if (previous.status==='待复核') check(!directory.owns(previous.handler,identity),403,'INDEPENDENT_REVIEW','须由另一名运维人员复核')
      if (input.action==='继续观察') check(typeof input.observeUntil==='string' && Date.parse(input.observeUntil)>Date.now(),400,'INVALID_DEADLINE','请选择未来的观察截止时间')
      return json(res,events.put(input.ticketNo,{...previous,assessment,disposition,status:allowed[input.action],
        observeUntil:input.action==='继续观察'?new Date(input.observeUntil).toISOString():null,
        handler:previous.status==='待复核'?previous.handler:actor,
        revision:previous.revision+1,history:[...previous.history,{at,actor,action:input.action,fromStatus:previous.status,toStatus:allowed[input.action],note:input.note.trim(),assessment:previous.status==='未研判'?assessment:undefined,disposition:previous.status==='处理中'?disposition:undefined}]}))
    

}
