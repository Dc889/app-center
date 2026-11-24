import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto'
import {check,ledger} from '../../../../runtime/http.mjs'
export const platformRoles=['user','operator','admin']
export const DEFAULT_USER_PASSWORD=process.env.DEFAULT_USER_PASSWORD || 'Kpw@2026!'
export const EMAIL_DOMAIN='kpw.com'

export function hashPassword(password, salt=randomBytes(16).toString('hex')) {
  const derived=scryptSync(String(password), salt, 32).toString('hex')
  return `scrypt:${salt}:${derived}`
}

export function verifyPassword(password, stored) {
  if(typeof password!=='string' || typeof stored!=='string') return false
  const parts=stored.split(':')
  if(parts.length!==3 || parts[0]!=='scrypt') return false
  const [, salt, hex]=parts
  const actual=scryptSync(password, salt, 32)
  const expected=Buffer.from(hex, 'hex')
  return actual.length===expected.length && timingSafeEqual(actual, expected)
}

export const seedSubjects=[
  {subjectId:'person-chen-yu',account:'chen.yu',email:`chen.yu@${EMAIL_DOMAIN}`,name:'陈宇',roles:['user'],org:'业务一部',businessLine:'刑侦'},
  {subjectId:'person-zhou-min',account:'zhou.min',email:`zhou.min@${EMAIL_DOMAIN}`,name:'周敏',roles:['operator'],org:'平台运营组',businessLine:'平台运营'},
  {subjectId:'person-wang-ning',account:'wang.ning',email:`wang.ning@${EMAIL_DOMAIN}`,name:'王宁',roles:['operator'],org:'平台运营组',businessLine:'平台运营'},
  {subjectId:'person-li-qiang',account:'li.qiang',email:`li.qiang@${EMAIL_DOMAIN}`,name:'李强',roles:['admin'],org:'系统管理组',businessLine:'系统管理'},
]
export function identityDirectory(dir,initialSubjects=seedSubjects,now=Date.now,actorSnapshot) {
  const store=ledger(dir,'identity-workflows',actorSnapshot)
  if(!store.get('initialized'))store.transaction(()=>{
    for(const p of initialSubjects) {
      check(typeof p.subjectId==='string' && p.subjectId && typeof p.account==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(p.account) &&
        Array.isArray(p.roles) && p.roles.length && p.roles.every(role=>platformRoles.includes(role)),500,'INVALID_DIRECTORY_SEED')
      check(!store.all().some(row=>row.kind==='person' && row.account.toLowerCase()===p.account.toLowerCase()),500,'DUPLICATE_DIRECTORY_SEED')
      store.put('person:'+p.subjectId,{kind:'person',active:true,revision:1,aliases:[],ragflowPermission:'个人',difyRole:'成员',
        ragflowAccountId:null,difyAccountId:null,workspaceId:null,email:`${p.account}@${EMAIL_DOMAIN}`,
        passwordHash:hashPassword(p.password ?? DEFAULT_USER_PASSWORD),...p,pendingChange:null})
    }
    store.put('initialized',{kind:'metadata',version:1})
  })
  const subjects=()=>store.all().filter(row=>row.kind==='person')
  // Backfill email and passwordHash for existing persisted accounts (e.g. shared MySQL)
  for(const p of subjects()) {
    const needsEmail=!p.email
    const needsHash=!p.passwordHash && p.authSource!=='dify'
    if(needsEmail || needsHash) {
      store.put('person:'+p.subjectId,{
        ...p,
        email:p.email || `${p.account}@${EMAIL_DOMAIN}`,
        passwordHash:needsHash ? hashPassword(DEFAULT_USER_PASSWORD) : (p.passwordHash ?? ''),
      })
    }
  }
  if(!store.get('catalog'))store.put('catalog',{kind:'catalog',orgs:[...new Set(subjects().map(p=>p.org))],businessLines:[...new Set(subjects().map(p=>p.businessLine))]})
  
  // 预留正式组织 ID 映射与组织改名迁移处理
  if(!store.get('org-mappings')) {
    store.put('org-mappings', {
      kind: 'org-mappings',
      mappings: {
        'org_biz_1': { id: 'org_biz_1', name: '业务一部', aliases: ['业务一部', '刑侦一部'] },
        'org_ops': { id: 'org_ops', name: '平台运营组', aliases: ['平台运营组', '运维组'] },
        'org_admin': { id: 'org_admin', name: '系统管理组', aliases: ['系统管理组', '管理组'] },
      }
    })
  }

  function resolveOrg(orgOrId) {
    if(!orgOrId) return ''
    const data = store.get('org-mappings')
    const mappings = data?.mappings ?? {}
    if(mappings[orgOrId]) return mappings[orgOrId].name
    const found = Object.values(mappings).find(m => m.name === orgOrId || m.aliases.includes(orgOrId))
    return found ? found.name : orgOrId
  }

  function orgIdOf(orgName) {
    const data = store.get('org-mappings')
    const mappings = data?.mappings ?? {}
    const found = Object.values(mappings).find(m => m.name === orgName || m.aliases.includes(orgName))
    return found ? found.id : null
  }

  function migrateOrg(oldName, newName) {
    store.transaction(() => {
      const data = store.get('org-mappings')
      const mappings = { ...(data?.mappings ?? {}) }
      let matchedId = null
      for(const [k, v] of Object.entries(mappings)) {
        if(v.name === oldName || v.aliases.includes(oldName)) {
          matchedId = k
          v.name = newName
          if(!v.aliases.includes(oldName)) v.aliases.push(oldName)
          if(!v.aliases.includes(newName)) v.aliases.push(newName)
          break
        }
      }
      if(!matchedId) {
        const genId = 'org_' + Math.random().toString(36).slice(2, 8)
        mappings[genId] = { id: genId, name: newName, aliases: [oldName, newName] }
      }
      store.put('org-mappings', { kind: 'org-mappings', mappings })
      for(const p of subjects()) {
        if(p.org === oldName) {
          store.put('person:' + p.subjectId, { ...p, org: newName, revision: p.revision + 1 })
        }
      }
      const cat = store.get('catalog')
      if(cat) {
        store.put('catalog', { ...cat, orgs: [...new Set(subjects().map(p => p.org))] })
      }
    })
  }

  const get=subjectId=>store.get('person:'+subjectId)
  const byAccount=account=>subjects().find(p=>p.account===account)
  const byLogin=identifier=>{
    const key=String(identifier ?? '').trim().toLowerCase()
    if(!key) return undefined
    return subjects().find(p=>p.account.toLowerCase()===key || (p.email || `${p.account}@${EMAIL_DOMAIN}`).toLowerCase()===key)
  }
  const authenticate=(identifier,password)=>{
    const profile=byLogin(identifier)
    if(!profile || !verifyPassword(password, profile.passwordHash)) return null
    return profile
  }
  function sanitizeAccountSlug(email, difyAccountId) {
    const local = String(email ?? '').split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64)
    let base = local && /^[a-zA-Z0-9]/.test(local) ? local : `dify_${String(difyAccountId ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`
    if (!base) base = 'dify_user'
    let candidate = base
    let idx = 1
    while (subjects().some(p => p.account.toLowerCase() === candidate.toLowerCase())) {
      candidate = `${base.slice(0, 56)}_${idx++}`
    }
    return candidate
  }

  function upsertDifyOwner({difyAccountId, email, name, workspaceId, workspaceName, status, lastLoginAt}) {
    const cleanEmail = String(email ?? '').trim().toLowerCase()
    check(cleanEmail && difyAccountId, 400, 'INVALID_DIFY_OWNER')
    const all = subjects()
    const existing = all.find(p => (p.difyAccountId && p.difyAccountId === difyAccountId) || (p.email || '').toLowerCase() === cleanEmail)
    const nowIso = new Date().toISOString()
    if (existing) {
      const updated = {
        ...existing,
        difyAccountId,
        workspaceId: workspaceId ?? existing.workspaceId ?? null,
        workspaceName: workspaceName ?? existing.workspaceName ?? '',
        difyRole: 'owner',
        difyStatus: status ?? existing.difyStatus ?? 'active',
        lastLoginAt: lastLoginAt ?? existing.lastLoginAt ?? null,
        syncedAt: nowIso,
      }
      store.put('person:' + existing.subjectId, updated)
      return {action: 'updated', profile: updated}
    }
    const cleanId = String(difyAccountId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)
    const subjectId = `dify-${cleanId}`
    const account = sanitizeAccountSlug(cleanEmail, difyAccountId)
    const created = {
      kind: 'person',
      subjectId,
      account,
      email: cleanEmail,
      name: String(name ?? '').trim() || account,
      roles: ['user'],
      org: '',
      businessLine: '',
      active: status !== 'banned',
      revision: 1,
      aliases: [],
      ragflowPermission: '个人',
      difyRole: 'owner',
      ragflowAccountId: null,
      difyAccountId,
      workspaceId: workspaceId ?? null,
      workspaceName: workspaceName ?? '',
      difyStatus: status ?? 'active',
      lastLoginAt: lastLoginAt ?? null,
      authSource: 'dify',
      needsOnboarding: true,
      passwordHash: '',
      pendingChange: null,
      syncedAt: nowIso,
    }
    store.put('person:' + subjectId, created)
    return {action: 'created', profile: created}
  }

  function completeOnboarding(subjectId, {name, org}) {
    const profile = get(subjectId)
    check(profile, 404, 'NOT_FOUND', '用户不存在')
    const cleanName = String(name ?? '').trim()
    const cleanOrg = String(org ?? '').trim()
    check(cleanName && cleanName.length <= 60, 400, 'INVALID_NAME', '请填写有效的真实姓名')
    check(cleanOrg && cleanOrg.length <= 120, 400, 'INVALID_ORG', '请选择所属组织机构')
    const updated = {
      ...profile,
      name: cleanName,
      org: cleanOrg,
      businessLine: profile.businessLine || cleanOrg,
      needsOnboarding: false,
      onboardedAt: new Date().toISOString(),
      revision: (profile.revision ?? 1) + 1,
    }
    store.put('person:' + subjectId, updated)
    const cat = store.get('catalog')
    if (cat && !cat.orgs.includes(cleanOrg)) {
      store.put('catalog', {...cat, orgs: [...cat.orgs, cleanOrg]})
    }
    return updated
  }

  const isActive=p=>!!p?.active && (!p.expiresAt || Date.parse(p.expiresAt)>now())
  function session(saved) {
    if(!saved?.active)return null
    const profile=saved.subjectId?get(saved.subjectId):byAccount(saved.account)
    if(!isActive(profile) || profile.account!==saved.account || profile.revision!==(saved.profileRevision ?? 1))return null
    const role=saved.actingRole ?? (profile.roles.includes('admin')?'admin':profile.roles.includes('operator')?'operator':'user')
    if(!profile.roles.includes(role))return null
    return {active:true,account:profile.account,email:profile.email || `${profile.account}@${EMAIL_DOMAIN}`,subjectId:profile.subjectId,roles:[role],assignedRoles:profile.roles,org:profile.org,
      needsOnboarding:Boolean(profile.needsOnboarding),workspaceName:profile.workspaceName || '',authSource:profile.authSource || 'local',
      profileRevision:profile.revision,restricted:!!profile.pendingChange && Date.parse(profile.pendingChange.effectiveAt)<=now()}
  }
  const owns=(account,identity)=>{const p=identity && get(identity.subjectId);return !!p && (p.account===account || p.aliases.includes(account))}
  return {store,subjects,get,byAccount,byLogin,authenticate,upsertDifyOwner,completeOnboarding,isActive,session,owns,catalog:store.get('catalog'),
    resolveOrg,orgIdOf,migrateOrg,
    accounts:{has:account=>!!byAccount(account),get:account=>byAccount(account)?.org,
      role:account=>{const roles=byAccount(account)?.roles ?? [];return account==='system_event'?'system':roles.includes('user')?'user':roles.includes('operator')?'operator':roles.includes('admin')?'admin':null}},
    restricted:account=>account!=='system_event' && (!isActive(byAccount(account)) || !!byAccount(account)?.pendingChange && Date.parse(byAccount(account).pendingChange.effectiveAt)<=now()),
    close:store.close}
}
