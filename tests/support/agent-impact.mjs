// Explicit synthetic inventories for management tests; never used by production code.
export function agentImpact(resourceId,appId,workspaceId,dependencies=[]){
  const capturedAt=new Date().toISOString()
  const items=dependencies.map((row,index)=>({kind:row.kind ?? 'tool',id:row.id ?? 'dependency-'+index,name:row.name,change:row.change ?? 'unchanged',approved:row.approved,externalAllowed:row.externalAllowed,fingerprint:row.fingerprint ?? 'a'.repeat(64)}))
  return {resourceId,appId,workspaceId,snapshotId:'impact-'+resourceId,capturedAt,grants:{state:'collected',count:0,revision:1,items:[]},keys:{state:'collected',count:0,revision:1,items:[]},dependencies:{state:'collected',count:items.length,revision:1,items},
    calls30d:{state:'collected',count:0,from:new Date(Date.parse(capturedAt)-30*86400000).toISOString(),to:capturedAt,source:'test-fixture'}}
}
