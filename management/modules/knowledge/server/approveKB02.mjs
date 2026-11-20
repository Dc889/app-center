import {check} from '../../../../runtime/http.mjs'
import {datasetContext} from './dataset-review.mjs'
import {applicationTarget} from '../../agents/public.server.mjs'
import {same} from '../../../../runtime/http.mjs'
import {confirmDatasetReview} from './dataset-review.mjs'
import {id} from '../../../../runtime/http.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function approveKB02(services) {
  let {accounts,actor,applications,approvedFields,at,cap,command,fields,headersFor,input,policy,previous}=services;

          check(!fields.expiresAt || Date.parse(fields.expiresAt)>Date.now(),409,'AUTHORIZATION_EXPIRED')
          const current=await datasetContext(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),
            previous.submission.resourceId,previous.submission.workspaceId)
          const related=fields.shareMode==='随应用发布'?await applicationTarget(cap,headersFor({command:{account:previous.account,org:previous.org,actorRole:previous.applicantRole ?? accounts.role(previous.account)}}),'dataset_publication',fields.relatedWorkspaceId,fields.relatedAppId):null
          check(same(related,previous.targetApplication ?? null),409,'STALE_APPLICATION_TARGET')
          const confirmations=confirmDatasetReview(previous.snapshot,current,input.confirmations,actor,at)
          check(applications.get(input.ticketNo).revision===input.revision,409,'VERSION_CONFLICT')
          const scope={共享目录:'all',指定组织:'orgs',指定人员:'accounts',随应用发布:'app'}[fields.shareMode]
          policy={ref:'policy-'+id(),revision:1,resourceId:command.resourceId,workspaceId:previous.submission.workspaceId,
            scope,targetOrgs:fields.targetOrgs ?? [],targetAccounts:fields.targetAccounts ?? [],
            boundaryOrgs:fields.boundaryOrgs,usages:['read','bind_dataset'],classification:fields.classification,businessLine:fields.businessLine,expiresAt:fields.expiresAt ?? null,
            ...related?{relatedAppId:related.appId,relatedWorkspaceId:related.workspaceId,applicationTargetRef:related.targetRef}:{}}
          command.action='publish_dataset'
          command.payload={decisionRef:'dec-'+command.executionId}
          approvedFields={'来源系统':current.fields['来源系统'],'workspace/tenant ID':current.fields['workspace/tenant ID'],
            '文档清单快照ID':current.fields['文档清单快照ID'],'分享方式':fields.shareMode,'目标组织':fields.targetOrgs ?? [],
            '目标人员':fields.targetAccounts ?? [],'关联智能体ID':related?.appId ?? null,'关联Dify workspace ID':related?.workspaceId ?? null,'关联应用登记ID':related?.targetRef ?? null,'关联应用名称':related?.name ?? null,
            '目录展示名称':fields.name,'目录简介':fields.description,'目录标签':fields.tags,
            '有效期截止时间':fields.expiresAt ?? null,policyRef:policy.ref,'文档确认记录':confirmations}
        
return {approvedFields,policy};
}
