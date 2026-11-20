import {check} from '../../../../runtime/http.mjs'
export async function skillWithdrawalContext(cap,headers,resourceId) {
  async function eligible() {
    const row=await(await cap('/catalog/skill/'+encodeURIComponent(resourceId)+'?action=withdraw_skill','GET',undefined,headers)).json()
    check(row.resourceId===resourceId && ['available','approved'].includes(row.status) && Array.isArray(row.actions) && row.actions.includes('withdraw_skill'),
      403,'SKILL_WITHDRAWAL_DENIED','当前身份没有此Skill的下架资格')
    check(typeof row.data?.version==='string' && row.data.version.trim(),409,'INCOMPLETE_SKILL_WITHDRAWAL_CONTEXT')
    return row
  }
  const before=await eligible()
  const query=new URLSearchParams({action:'withdraw_skill',resourceId})
  const snapshot=await(await cap('/execution-contexts/SKL-04?'+query,'GET',undefined,headers)).json()
  const f=snapshot.fields
  check(snapshot.ticketType==='SKL-04' && snapshot.action==='withdraw_skill' && snapshot.resourceId===resourceId &&
    typeof snapshot.snapshotId==='string' && snapshot.snapshotId && f &&
    typeof f['Skill名称']==='string' && f['Skill名称'].trim() && typeof f['当前版本号']==='string' && f['当前版本号'].trim() &&
    ['历史下载次数','历史下载人数'].every(k=>Number.isInteger(f[k]) && f[k]>=0) &&
    Array.isArray(snapshot.preconditions) && snapshot.preconditions.filter(p=>p && p.kind==='skill' && p.id===resourceId).length===1 && snapshot.preconditions.some(p=>p && p.kind==='skill' && p.id===resourceId &&
      Number.isInteger(p.revision) && p.revision>=0),409,'INCOMPLETE_SKILL_WITHDRAWAL_CONTEXT')
  const after=await eligible()
  check(before.data.version===f['当前版本号'] && after.data.version===f['当前版本号'],409,'STALE_SNAPSHOT','读取依据期间Skill版本已变化，请重新读取')
  return snapshot
}
