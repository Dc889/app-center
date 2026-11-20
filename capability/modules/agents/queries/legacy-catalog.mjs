import {json} from '../../../../runtime/http.mjs'

// Existing sample directory responses; production discovery is still a separate acceptance item.
export async function listCatalog({res,query}) {
const q=(query.get('q') ?? '').trim().toLowerCase(),workspaceId=query.get('workspaceId'),action=query.get('action');


        const agents = [

          {

            resourceId: 'app-police-query',

            name: '警情摘要与案情研判助手',

            status: 'approved',

            actions: action === 'withdraw_app' ? ['withdraw_app'] : action === 'republish' ? ['republish'] : ['view'],

            data: {

              appId: 'app-dify-police-01',

              workspaceId: workspaceId || 'ws-default',

              version: 'v1.0.0',

            },

          },

          {

            resourceId: 'app-doc-assistant',

            name: '智能政务公文问答助手',

            status: 'approved',

            actions: action === 'withdraw_app' ? ['withdraw_app'] : action === 'republish' ? ['republish'] : ['view'],

            data: {

              appId: 'app-dify-doc-02',

              workspaceId: workspaceId || 'ws-default',

              version: 'v1.2.0',

            },

          },

        ]

        const matched = q ? agents.filter(a => (a.name + a.resourceId).toLowerCase().includes(q)) : agents

        return json(res, { items: matched, nextCursor: null })

      
}
export async function catalogItem({res,query,resourceId}) {
const action=query.get('action')


        return json(res, {

          resourceId,

          name: resourceId,

          status: 'approved',

          actions: action ? [action] : ['republish', 'withdraw_app'],

          data: { appId: resourceId, workspaceId: 'ws-default', version: 'v1.0.0' },

        })

      
}
