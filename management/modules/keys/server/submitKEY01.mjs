import {keyCreationContext} from './key-creation.mjs'
import {check} from '../../../../runtime/http.mjs'
import {same} from '../../../../runtime/http.mjs'
import {id} from '../../../../runtime/http.mjs'
import {keyCreationFields} from './key-creation.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function submitKEY01(services) {
  const {accounts,actor,applications,at,cap,deliver,fields,headersFor,identity,input,owns,save,send,submission,types,version}=services;

      const snapshot=await keyCreationContext(cap,headersFor({command:{account:actor,org:accounts.get(actor),actorRole:identity.roles[0]}}),input.resourceId,input.workspaceId)
      const instant=fields.purpose==='本人调试'
      if(instant)check(snapshot.fields['所有者账户名']===actor,403,'NOT_RESOURCE_OWNER')
      else check(snapshot.fields['关联发布工单号']===fields.publicationTicketNo,409,'PUBLICATION_NOT_MATCHED')
      check(types.activeVersion(input.ticketType,input.workspaceId)===version,409,'TYPE_VERSION_CHANGED')
      const concurrent=applications.get(input.ticketNo)
      if(concurrent) {
        check(owns(concurrent) && same(concurrent.submission,submission),409,'APPLICATION_CONFLICT')
        return send(concurrent)
      }
      const executionId=id()
      const approvedFields=instant?keyCreationFields(fields):undefined
      const command=instant?{executionId,ticketNo:input.ticketNo,ticketType:'KEY-01',ticketTypeVersion:version,action:'create_key',
        resourceId:input.resourceId,account:actor,org:accounts.get(actor),payload:{decisionRef:'dec-'+executionId}}:undefined
      const row=save(input.ticketNo,{ticketNo:input.ticketNo,ticketType:'KEY-01',ticketTypeVersion:version,
        account:actor,org:accounts.get(actor),submission,snapshot,preconditions:snapshot.preconditions,status:instant?'执行中':'待受理',
        revision:1,command,approvedFields,attempts:command?[{command,approvedFields}]:[],history:[{at,actor,action:'提交密钥创建登记'}]})
      if(instant)void deliver(row)
      return send(row,201)
    

}
