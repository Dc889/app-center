import {check} from '../../../../runtime/http.mjs'
import {keyRegistrationActions} from './key-registrations.mjs'
import {json} from '../../../../runtime/http.mjs'
import {keyRegistrationPage} from './key-registrations.mjs'

// Injected services retain the owning transaction and identity snapshot.
export async function routeKeyRegistrations(services) {
  const {cap,identity,ownerHeaders,req,res}=services;

      check(req.method==='GET' && identity?.active,403,'ACCESS_DENIED')
      const input=new URL(req.url,'http://localhost').searchParams
      check(keyRegistrationActions.includes(input.get('action')),400,'INVALID_KEY_ACTION')
      const params=new URLSearchParams({action:input.get('action')})
      for(const key of ['q','cursor','limit']) {
        const value=input.get(key)
        if(value){check(value.length<=200 && (key!=='limit' || /^\d{1,3}$/.test(value) && Number(value)>=1 && Number(value)<=100),400,'INVALID_QUERY');params.set(key,value)}
      }
      return json(res,await keyRegistrationPage(cap,ownerHeaders({command:{account:identity.account,org:identity.org,actorRole:identity.roles[0]}}),params))
    

}
