// Synthetic telemetry for tests only. Never used by production collectors.
import {resourceKeys,serviceKeys,callKeys,exceptionKeys} from '../../management/modules/overview/public.server.mjs'
export function overviewFixture(window,now=Date.now()) {
  const group=data=>({state:'collected',source:'test-fixture',capturedAt:new Date(now).toISOString(),data})
  return {...window,scope:'user_network',
    resources:group(resourceKeys.map(key=>({key,state:'collected',count:0,yesterdayCount:null}))),
    health:group(serviceKeys.map(key=>({key,instance:'test-instance',version:'test-version',status:'healthy',checkedAt:new Date(now).toISOString(),latencyMs:0,consecutiveFailures:0,evidenceRef:'test-probe'}))),
    ...Object.fromEntries([['calls',callKeys],['exceptions',exceptionKeys]].map(([groupKey,keys])=>[groupKey,group(Array.from({length:(Date.parse(window.to)-Date.parse(window.from))/window.bucketMs},(_,i)=>({at:new Date(Date.parse(window.from)+i*window.bucketMs).toISOString(),...Object.fromEntries(keys.map(k=>[k,0]))})))])),
  }
}
