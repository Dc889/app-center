import {check} from '../../../../runtime/http.mjs'
import {toolContext} from './tool-approval.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveTOL01(services) {
  let {accounts,actor,applications,approvedFields,at,cap,command,fields,headersFor,input,policy,previous}=services;

          check(input.securityVerdict==='通过' && typeof input.securityNote==='string' && input.securityNote.trim() &&
            input.securityNote.length<=4000 && ['允许','禁止'].includes(input.externalAllowed),400,'SECURITY_REVIEW_REQUIRED')
          const current=await toolContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
            previous.submission.resourceId,previous.submission.workspaceId,fields.operation)
          check(same(current.fields,previous.snapshot.fields) && same(current.preconditions,previous.preconditions),409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          policy={ref:'policy-'+id(),revision:1,resourceId:command.resourceId,workspaceId:previous.submission.workspaceId,
            scope:'orgs',targetOrgs:fields.targetOrgs,targetAccounts:[],boundaryOrgs:fields.targetOrgs,
            usages:fields.operation==='撤销批准' || input.externalAllowed==='禁止'?[]:['invoke_tool'],
            classification:fields.classification,businessLine:fields.businessLine}
          command.action='set_tool_approval';command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields={'操作类型':fields.operation,'Dify workspace ID':current.fields['Dify workspace ID'],'Dify工具ID':current.fields['Dify工具ID'],
            'Dify工具提供者ID':current.fields['Dify工具提供者ID'],'工具配置指纹':current.fields['工具配置指纹'],
            '工具版本':current.fields['工具版本'],'对外使用权限':input.externalAllowed,policyRef:policy.ref,
            '安全审查结果':'通过','安全审查意见':input.securityNote.trim(),'确认人':actor,'确认时间':at,
              ...Object.fromEntries(['工具名称','工具提供者名称','配置来源','输入参数schema','输出说明','原批准工单号','原工具版本','原工具配置指纹','配置差异'].filter(key=>current.fields[key]!==undefined).map(key=>[key,current.fields[key]]))}
        
return {approvedFields,policy};
}
