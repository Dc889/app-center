import {check,same} from '../../../../runtime/http.mjs'

// Only these non-secret product facts may be frozen or compared for recovery.
export function recoveryBaseline(value,fields) {
  if(value===undefined)return null // Old deployments remain usable, but cannot unlock.
  const r=value?.ragflow,d=value?.dify
  const valid=(p,permission,allowed)=>p && typeof p.account==='string' && typeof p.active==='boolean' &&
    (p.accountId===null? p.active===false && p[permission]===null:typeof p.accountId==='string' && p.accountId && allowed.includes(p[permission]))
  check(valid(r,'permission',['个人','团队成员','管理员']) && valid(d,'role',['成员','编辑','管理员']) &&
    r.account===fields['当前账户名'] && d.account===r.account &&
    r.accountId===fields['RAGFlow账户ID'] && d.accountId===fields['Dify账户ID'] && d.workspaceId===fields['Dify workspace ID'] &&
    (r.accountId===null || r.permission===fields['当前RAGFlow权限']) && (d.accountId===null || d.role===fields['当前Dify workspace角色']),409,'INVALID_RECOVERY_BASELINE')
  return {ragflow:{accountId:r.accountId,account:r.account,active:r.active,permission:r.permission},
    dify:{accountId:d.accountId,workspaceId:d.workspaceId,account:d.account,active:d.active,role:d.role}}
}

export function verifiedRestoration(proof,row,startedAt,now) {
  const revision=kind=>row.preconditions.find(p=>p.kind===kind && p.id===row.subjectId)?.revision
  check(row.snapshot.recoveryBaseline,409,'RECOVERY_BASELINE_REQUIRED')
  check(proof && proof.executionId===row.command.executionId && proof.ticketNo===row.ticketNo && proof.subjectId===row.subjectId &&
    proof.identityRevision===revision('identity_mapping') && proof.productMappingRevision===revision('product_account_mapping') &&
    proof.executionStatus==='failed' && proof.sealed===true && proof.outcome==='restored' &&
    typeof proof.proofId==='string' && proof.proofId.length>0 && proof.proofId.length<=160 &&
    typeof proof.checkedAt==='string' && Date.parse(proof.checkedAt)>=startedAt-60000 && Date.parse(proof.checkedAt)<=now+60000 &&
    same(proof.products,row.snapshot.recoveryBaseline),409,'RESTORATION_NOT_VERIFIED')
  return {proofId:proof.proofId,executionId:proof.executionId,ticketNo:proof.ticketNo,subjectId:proof.subjectId,
    identityRevision:proof.identityRevision,productMappingRevision:proof.productMappingRevision,executionStatus:'failed',
    sealed:true,outcome:'restored',checkedAt:proof.checkedAt,products:row.snapshot.recoveryBaseline}
}
