import {useEffect,useState} from 'react'

type Version={code:string;version:string;name:string;actions:string[];workspaceId:string;revision:number;status:string;enabledOrgs?:string[];branchFlows?:Record<string,string>}
type Branch={action:string;variant:string|null;state:string;reasonCode:string}

async function readRegistry() {
  const response=await fetch('/api/types')
  if(!response.ok)throw Error('无法读取类型登记')
  return response.json()
}

export function TypeRegistry({names}:{names:Record<string,string>}) {
  const [routes,setRoutes]=useState<Record<string,string[]>>({})
  const [versions,setVersions]=useState<Version[]>([])
  const [code,setCode]=useState('SKL-03')
  const [version,setVersion]=useState('1')
  const [name,setName]=useState(names['SKL-03'])
  const [workspace,setWorkspace]=useState('')
  const [actions,setActions]=useState('')
  const [organizations,setOrganizations]=useState<string[]>([])
  const [enabledOrgs,setEnabledOrgs]=useState<string[]>([])
  const [newVersion,setNewVersion]=useState('2')
  const [branchFlows,setBranchFlows]=useState<Record<string,string>>({upgrade:'',uninstall:''})
  const [branches,setBranches]=useState<Branch[]>([])
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const current=versions.find(item=>item.code===code && item.version===version)
  async function load() {
    const data=await readRegistry()
    setRoutes(data.routes);setVersions(data.versions);setOrganizations(data.organizations ?? [])
  }
  useEffect(()=>{
    let active=true
    readRegistry().then(data=>{if(active){setRoutes(data.routes);setVersions(data.versions);setOrganizations(data.organizations ?? [])}})
      .catch(error=>{if(active)setMessage(error.message)})
    return ()=>{active=false}
  },[])
  function select(next:string,v:string) {
    const saved=versions.find(item=>item.code===next && item.version===v)
    setCode(next);setVersion(v);setName(saved?.name ?? (Object.hasOwn(names,next) ? names[next] : ''))
    setWorkspace(saved?.workspaceId ?? '');setActions(saved?.actions.join(', ') ?? '')
    setEnabledOrgs(saved?.enabledOrgs ?? [])
    setNewVersion(String(Math.max(Number(v)||1,...versions.filter(item=>item.code===next).map(item=>Number(item.version)))+1))
    setBranchFlows({upgrade:saved?.branchFlows?.upgrade ?? '',uninstall:saved?.branchFlows?.uninstall ?? ''})
    setBranches([]);setMessage('')
  }
  const registered=Object.hasOwn(routes,code) ? routes[code] : undefined
  const actionNames=registered ?? actions.split(',').map(a=>a.trim()).filter(Boolean)
  const immutable=!!current && current.status!=='draft'
  const dirty=!current || current.workspaceId!==workspace || current.name!==name || current.actions.join(',')!==actionNames.join(',') ||
    JSON.stringify([...(current?.enabledOrgs ?? [])].sort())!==JSON.stringify([...enabledOrgs].sort()) ||
    code==='PLG-03' && ['upgrade','uninstall'].some(action=>(current.branchFlows?.[action] ?? '')!==branchFlows[action])
  async function run(operation:string) {
    setBusy(true);setMessage('');setBranches([])
    try {
      const response=await fetch('/api/types/'+operation,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({code,version,name,workspaceId:workspace,actions:actionNames,branchFlows,enabledOrgs,newVersion,revision:current?.revision ?? 0})})
      const data=await response.json()
      if(!response.ok) throw Error(data.error?.message ?? '操作失败')
      if(operation==='check') {
        setBranches(data.branches)
        setMessage(data.ready?'所有执行分支已通过核验':'存在无法执行的分支')
      } else {await load();if(operation==='copy'){setVersion(data.version);setEnabledOrgs(data.enabledOrgs ?? []);setNewVersion(String(Number(data.version)+1))}
        setMessage(operation==='copy'?'已复制为新版本草稿，请核验后发布':operation==='draft'?'草稿已保存':operation==='disable'?'版本已停用':'版本已发布')}
    } catch(error) {setMessage(error instanceof Error?error.message:'服务暂不可用')}
    finally {setBusy(false)}
  }
  return <section className="panel list-panel"><fieldset disabled={busy} className="editor-section">
    <legend>工单类型与执行能力</legend>
    <div className="form-row"><label>类型编码<input list="type-codes" value={code} onChange={e=>select(e.target.value,'1')}/></label>
    <datalist id="type-codes">{Object.keys(routes).map(key=><option key={key} value={key}>{names[key]}</option>)}</datalist>
    <label>版本<input value={version} onChange={e=>select(code,e.target.value)}/></label></div>
    <div className="form-row"><label>类型名称<input value={name} disabled={immutable} onChange={e=>setName(e.target.value)}/></label>
    <label>目标工作区（留空核验通用范围）<input value={workspace} disabled={immutable} onChange={e=>setWorkspace(e.target.value)}/></label></div>
    <label>执行动作<input value={registered?.join(', ') ?? actions} disabled={!!registered || immutable} placeholder={code==='EVT-01'?'管理端本地流程':'多个动作以逗号分隔'} onChange={e=>setActions(e.target.value)}/></label>
    <fieldset disabled={immutable}><legend>启用组织（未选择表示全部组织）</legend>
      {[...new Set([...organizations,...enabledOrgs])].map(org=><label key={org}><input type="checkbox" checked={enabledOrgs.includes(org)} onChange={e=>setEnabledOrgs(e.target.checked?[...enabledOrgs,org]:enabledOrgs.filter(value=>value!==org))}/>{org}</label>)}
    </fieldset>
    {code==='PLG-03' && <fieldset disabled={immutable}><legend>升级与卸载办理流程</legend>
      {(['upgrade','uninstall'] as const).map(action=><label key={action}>{action==='upgrade'?'升级流程':'卸载流程'}<select aria-label={action==='upgrade'?'升级流程':'卸载流程'} value={branchFlows[action]} onChange={e=>setBranchFlows({...branchFlows,[action]:e.target.value})}>
        <option value="">尚未配置</option><option value="approval">运维审批</option><option value="instant">权限核验通过后即办</option>
      </select></label>)}
    </fieldset>}
    <div className="editor-actions"><button className="secondary-button" disabled={immutable} onClick={()=>run('draft')}>保存草稿</button>
    <button className="secondary-button" disabled={dirty} onClick={()=>run('check')}>核验全部分支</button>
    <button className="primary-button" disabled={dirty || immutable} onClick={()=>run('publish')}>发布版本</button>
    <button className="secondary-button" disabled={dirty || current?.status!=='published'} onClick={()=>run('disable')}>停用版本</button></div>
    {immutable && <div className="form-row"><label>复制到新版本<input value={newVersion} onChange={e=>setNewVersion(e.target.value)}/></label>
      <button className="secondary-button" onClick={()=>run('copy')}>复制为新版本草稿</button></div>}
    <p role="status">{message}</p>{branches.map(b=><p key={b.action+'-'+b.variant}>{[b.action,b.variant,b.state,b.reasonCode].filter(Boolean).join(' · ')}</p>)}
    <h3>已保存版本</h3>{versions.map(v=><button key={v.code+'/'+v.version} className="secondary-button" onClick={()=>select(v.code,v.version)}>{v.name} · {v.code} v{v.version} · {v.status==='published'?'已发布':v.status==='disabled'?'已停用':'草稿'}</button>)}
  </fieldset></section>
}
