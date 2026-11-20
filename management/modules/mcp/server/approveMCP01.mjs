import {check} from '../../../../runtime/http.mjs'
import {mcpRegistration} from './mcp-registration.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveMCP01(services) {
  let {accounts,applications,approvedFields,cap,command,fields,headersFor,input,policy,previous}=services;

          check(input.securityVerdict==='通过' && typeof input.securityNote==='string' && input.securityNote.trim() &&
            input.securityNote.length<=4000 && ['允许','禁止'].includes(input.externalAllowed),400,'SECURITY_REVIEW_REQUIRED')
          const current=await mcpRegistration(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),previous.submission.resourceId)
          check(same(current.data,previous.snapshot.data),409,'STALE_SNAPSHOT')
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          command.action='register_mcp';command.resourceId=previous.catalogId
          command.payload={decisionRef:'dec-'+command.executionId}
          policy={ref:'policy-'+id(),revision:1,resourceId:previous.catalogId,workspaceId:null,scope:'orgs',
            targetOrgs:fields.boundaryOrgs,boundaryOrgs:fields.boundaryOrgs,targetAccounts:[],
            classification:fields.classification,businessLine:fields.businessLine,usages:input.externalAllowed==='允许'?['invoke_mcp','bind']:[]}
          approvedFields={'技术注册ID':current.data.registrationId,'URL指纹':current.data.urlFingerprint,
            'MCP名称':fields.name,'MCP用途':fields.purpose,'组织边界':fields.boundaryOrgs,'对外使用权限':input.externalAllowed,
            '安全审查结果':'通过','安全审查意见':input.securityNote.trim(),policyRef:policy.ref}
        
return {approvedFields,policy};
}
