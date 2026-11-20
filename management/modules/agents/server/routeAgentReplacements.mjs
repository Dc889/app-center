import {check} from '../../../../runtime/http.mjs'
import {json} from '../../../../runtime/http.mjs'
import {replacementContext} from './agent-replacements.mjs'
import {replacementPage} from './agent-replacements.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeAgentReplacements(services) {
  const {cap,identity,ownerHeaders,path,req,res}=services;

      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const query=new URL(req.url,'http://localhost').searchParams,parts=path.split('/').slice(3)
      check(parts.length===0 || parts.length===1 && parts[0],400,'INVALID_REPLACEMENT_PATH')
      const headers=ownerHeaders({command:{account:identity.account,org:identity.org,actorRole:identity.roles[0]}})
      return json(res,parts.length?await replacementContext(cap,headers,query.get('sourceResourceId'),decodeURIComponent(parts[0])):await replacementPage(cap,headers,query))
    

}
