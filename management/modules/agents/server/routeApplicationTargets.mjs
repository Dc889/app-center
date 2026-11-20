import {check} from '../../../../runtime/http.mjs'
import {json} from '../../../../runtime/http.mjs'
import {applicationTarget} from './application-targets.mjs'
import {applicationTargetPage} from './application-targets.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeApplicationTargets(services) {
  const {cap,identity,ownerHeaders,path,req,res}=services;

      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const query=new URL(req.url,'http://localhost').searchParams,parts=path.split('/').slice(3)
      check(parts.length===0 || parts.length===1 && parts[0],400,'INVALID_APPLICATION_TARGET_PATH')
      const headers=ownerHeaders({command:{account:identity.account,org:identity.org,actorRole:identity.roles[0]}})
      return json(res,parts.length?await applicationTarget(cap,headers,query.get('purpose'),query.get('workspaceId'),decodeURIComponent(parts[0])):await applicationTargetPage(cap,headers,query))
    

}
