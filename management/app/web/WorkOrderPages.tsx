import {ticketTypes,adminTicketTypes} from './ticket-catalog'
import type {Role} from '../../shared-ui/UiContextData'
import {personOf} from '../../shared-ui/UiContextData'
import {FormField,DataTable} from '../../shared-ui/UiPrimitives'
import {useCallback,useEffect,useState} from 'react'
import type {TicketResult} from '../../platform/workflow/public.web'
import {ApplicationDrafts,TypeRegistry,useApplicationDraft} from '../../platform/workflow/public.web'
import {PageHeader} from '../../shared-ui/UiContext'
import {Activity,AlertTriangle,ArrowRight,Check,ClipboardCheck,Clock3,Search,X,Zap} from 'lucide-react'
import {EventDesk} from '../../modules/events/public.web'
import {ApplicationDesk} from './ApplicationDesk'
import {AccountDesk} from '../../modules/accounts/public.web'
import {SkillCancellationDesk} from '../../modules/skills/public.web'
import {hasRegisteredTicketForm,renderTicketForm} from './module-registry'





export type ResourceStamp = { name: string; level: string; line: string; action?: string }

function defaultPath(code: string) {
  if (code === 'MCP-03') return '解绑'
  return '本人'
}

function needsApplicationNote(code: string, path: string) {
  if (code === 'EVT-01') return false
  if (code === 'KEY-01') return path === '对外'
  if (code === 'PLG-01' || code === 'SKL-01' || code === 'MCP-01') return path === '分享'
  if (code === 'MCP-03') return path === '隔离' || path === '下架'
  if (['KB-01', 'KB-03', 'AG-01', 'AG-03', 'PLG-03', 'SKL-03', 'MCP-02'].includes(code)) return false
  return ['KB-05', 'AG-02', 'AG-04', 'AG-05', 'KEY-02', 'TOL-01', 'PLG-02', 'SKL-02', 'SKL-04', 'ACC-01', 'ACC-02'].includes(code)
}

function needsLevelPick(code: string, path: string) {
  if (code === 'KEY-01') return path === '对外'
  if (code === 'PLG-01' || code === 'SKL-01' || code === 'MCP-01') return path === '分享'
  if (code === 'MCP-03') return path === '下架'
  return ['KB-05', 'AG-02', 'AG-04', 'AG-05', 'TOL-01', 'PLG-02', 'SKL-02', 'SKL-04'].includes(code)
}

function shownMode(code: string, catalogMode: string, path: string) {
  if (['KEY-01', 'PLG-01', 'SKL-01', 'MCP-01', 'MCP-03'].includes(code)) {
    return needsApplicationNote(code, path) ? '人工审批' : '即办'
  }
  return catalogMode
}

function resourceChoices(code: string): ResourceStamp[] {
  if (code.startsWith('KB')) return [
    { name: '反诈话术资料库', level: '内部', line: '刑侦' },
    { name: '个人测试语料库', level: '', line: '' },
  ]
  if (code.startsWith('KEY') || code === 'TOL-01') return [{ name: '调试密钥', level: '', line: '' }]
  if (code.startsWith('PLG')) return [
    { name: 'document-parser', level: '内部', line: '刑侦' },
    { name: 'private-exporter', level: '', line: '' },
  ]
  if (code.startsWith('SKL')) return [
    { name: '公文摘要 Skill', level: '内部', line: '刑侦' },
    { name: '表格分析 Skill', level: '', line: '' },
  ]
  if (code.startsWith('MCP')) return [
    { name: '档案检索服务', level: '内部', line: '刑侦' },
    { name: '测试文件服务', level: '', line: '' },
  ]
  if (code === 'EVT-01') return [{ name: 'plugin daemon 健康波动', level: '', line: '' }]
  if (code.startsWith('ACC')) return [{ name: '林杰', level: '', line: '' }]
  return [{ name: '未命名资源', level: '', line: '' }]
}

const specializedCodes = ['AG-01', 'AG-02', 'AG-03', 'AG-04', 'AG-05', 'PLG-03', 'MCP-02', 'SKL-03']

export function RecordedBoundary({ role, resourceLevel, resourceLine, choose }: { role: Role; resourceLevel: string; resourceLine: string; choose: boolean }) {
  const person = personOf(role)
  const level = resourceLevel || person.level
  const line = resourceLine || person.line
  return (
    <div className="form-row">
      {level ? (
        <div className="context-fact"><span>密级</span><strong>{level}</strong></div>
      ) : choose ? (
        <FormField label="密级" source="用户" required>
          <select defaultValue=""><option value="" disabled>请选择</option><option>公开</option><option>内部</option><option>敏感</option><option>机密</option></select>
        </FormField>
      ) : (
        <div className="context-fact"><span>密级</span><strong>未登记</strong></div>
      )}
      {line ? (
        <div className="context-fact"><span>业务线</span><strong>{line}</strong></div>
      ) : choose ? (
        <FormField label="业务线" source="用户" required>
          <select defaultValue=""><option value="" disabled>请选择</option><option>刑侦</option><option>网安</option><option>经侦</option><option>治安</option></select>
        </FormField>
      ) : (
        <div className="context-fact"><span>业务线</span><strong>未登记</strong></div>
      )}
    </div>
  )
}

function manualSources(code: string, category: string) {
  if (code === 'KB-01' || code === 'KB-02') return ['RAGFlow', 'Dify']
  if (category === '知识库' || category === 'Skill' || category === '告警') return ['本平台']
  if (category === '凭证' || category === '工具' || category === '智能体') return ['Dify']
  return ['Dify', '本平台']
}

export function ManualApplication({ role, ticketType, onSelectTicketType }: { role: Role; ticketType?: string | null; onSelectTicketType?: (code: string) => void }) {
  const availableTypes = role === 'admin' ? [...ticketTypes, ...adminTicketTypes] : ticketTypes
  const initialSelected = (ticketType ? availableTypes.find(item => item[0] === ticketType) : null) ?? availableTypes[0]
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [selected, setSelected] = useState(initialSelected)
  const [syncedTicketType, setSyncedTicketType] = useState(ticketType ?? null)
  const [path, setPath] = useState(defaultPath(initialSelected[0]))
  const opening = hasRegisteredTicketForm(initialSelected[0]) ? {name:'',level:'',line:''} : resourceChoices(initialSelected[0])[0]
  const [resourceName, setResourceName] = useState(opening.name)
  const [resourceLevel, setResourceLevel] = useState(opening.level)
  const [resourceLine, setResourceLine] = useState(opening.line)
  const person = personOf(role)
  const [execution, setExecution] = useState<TicketResult | null>(null)
  const [facts,setFacts]=useState('')
  const [eventKind,setEventKind]=useState('插件')
  const [eventObject,setEventObject]=useState('')
  const [submitting, setSubmitting] = useState(false)
  const [checkNote,setCheckNote]=useState('')
  const onMeta = useCallback((meta: ResourceStamp) => {
    setResourceName(meta.name)
    setResourceLevel(meta.level)
    setResourceLine(meta.line)
  }, [])
  const applyTypeSelection = (item: typeof availableTypes[number]) => {
    setSelected(item)
    setExecution(null)
    setCheckNote('')
    setPath(defaultPath(item[0]))
    if (hasRegisteredTicketForm(item[0]) || specializedCodes.includes(item[0])) {
      setResourceName('')
      setResourceLevel('')
      setResourceLine('')
      return
    }
    const first = resourceChoices(item[0])[0]
    setResourceName(first.name)
    setResourceLevel(first.level)
    setResourceLine(first.line)
  }
  if ((ticketType ?? null) !== syncedTicketType) {
    setSyncedTicketType(ticketType ?? null)
    const target = ticketType ? availableTypes.find(item => item[0] === ticketType) : availableTypes[0]
    if (target && target[0] !== selected[0]) applyTypeSelection(target)
  }
  const chooseType = (item: typeof availableTypes[number]) => {
    setSyncedTicketType(item[0])
    applyTypeSelection(item)
    onSelectTicketType?.(item[0])
  }
  const applyResource = (name: string) => {
    const found = resourceChoices(selected[0]).find((item) => item.name === name)
    if (!found) return
    setResourceName(found.name)
    setResourceLevel(found.level)
    setResourceLine(found.line)
  }
  const eventDraft=useApplicationDraft('EVT-01',{resourceId:eventObject,facts,objectType:eventKind},value=>{setEventObject(value.resourceId);setFacts(value.facts);setEventKind(value.objectType);setExecution(null)})
  const note = needsApplicationNote(selected[0], path)
  const chooseLevel = needsLevelPick(selected[0], path)
  const mode = shownMode(selected[0], selected[3], path)
  const filtered = availableTypes.filter((item) =>
    (category === '全部' || item[2] === category) &&
    (`${item[0]}${item[1]}${item[4]}`.toLowerCase().includes(query.toLowerCase()))
  )
  const preferredOrder = ['知识库', '智能体', '插件', 'MCP', 'Skill', '凭证', '工具', '告警', '模型', '账号', '配置']
  const presentCategories = new Set(availableTypes.map((item) => item[2]))
  const categories = [
    '全部',
    ...preferredOrder.filter((c) => presentCategories.has(c)),
    ...[...presentCategories].filter((c) => !preferredOrder.includes(c)),
  ]
  return (
    <>
      <PageHeader view="manual" />
      <div className="manual-layout">
        <aside className="catalog-pane">
          <div className="catalog-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索类型、编码或场景" /></div>
          <div className="category-tabs">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
          <div className="type-list">
            {filtered.map((item) => (
              <button key={item[0]} data-ticket-type={item[0]} className={selected[0] === item[0] ? 'active' : ''} onClick={() => chooseType(item)}>
                <span className="type-code">{item[0]}</span>
                <span><strong>{item[1]}</strong></span>
                <em className={item[3] === '即办' ? 'instant' : ''}>{item[3]}</em>
              </button>
            ))}
          </div>
        </aside>
        <section className="manual-form">
          <div className="form-title">
            <div><span className="type-code large">{selected[0]}</span><div><h3>{selected[1]}</h3></div></div>
            <span className={mode === '即办' ? 'approval instant' : 'approval'}>{mode === '即办' ? <Zap size={14} /> : <Clock3 size={14} />}{mode}</span>
          </div>
          <div className="form-section">
            <div className="section-heading"><span>01</span><div><h4>基本信息</h4></div></div>
            <dl className="application-context">
              <div className="context-title"><dt>工单标题</dt><dd>{selected[1]} · {resourceName || '未选择资源'}</dd></div>
              <div><dt>申请人</dt><dd>{person.name} · {person.account}</dd></div>
              <div><dt>{selected[0] === 'KB-02' ? '申请部门' : '申请组织'}</dt><dd>{person.org}</dd></div>
            </dl>
            <RecordedBoundary key={`${selected[0]}-${path}-${resourceName}`} role={role} resourceLevel={resourceLevel} resourceLine={resourceLine} choose={chooseLevel && !hasRegisteredTicketForm(selected[0])} />
            {selected[0] === 'EVT-01' ? (
              <FormField label="人工事实说明" source="用户" required><textarea value={facts} onChange={e=>setFacts(e.target.value)} placeholder="写一句看到的事实" /></FormField>
            ) : note ? (
              <FormField label="申请说明" source="用户" required><textarea placeholder="写一句申请原因" /></FormField>
            ) : null}
          </div>
          {renderTicketForm(selected[0], {account: person.account, onMeta}) ?? (
          <div className="form-section">
            <div className="section-heading"><span>02</span><div><h4>申请对象</h4></div></div>
            {selected[0] === 'KEY-01' && (
              <FormField label="调用方" source="用户" required>
                <select value={path} onChange={(event) => setPath(event.target.value)}><option>本人</option><option>对外</option></select>
              </FormField>
            )}
            {(selected[0] === 'PLG-01' || selected[0] === 'SKL-01' || selected[0] === 'MCP-01') && (
              <FormField label="给谁用" source="用户" required>
                <select value={path} onChange={(event) => setPath(event.target.value)}><option>本人</option><option>分享</option></select>
              </FormField>
            )}
            {selected[0] === 'MCP-03' && (
              <FormField label="处置类型" source="用户" required>
                <select value={path} onChange={(event) => setPath(event.target.value)}><option>解绑</option><option>隔离</option><option>下架</option></select>
              </FormField>
            )}
            {selected[0] === 'EVT-01' ? <><label>事件对象类型<select value={eventKind} onChange={e=>setEventKind(e.target.value)}>{['知识库','智能体','插件','MCP','智能体仓库','账号与集成'].map(k=><option key={k}>{k}</option>)}</select></label><FormField label="事件对象标识" source="用户" required><input aria-label="事件对象标识" value={eventObject} onChange={e=>setEventObject(e.target.value)} /></FormField></> : selected[2] === '账号' ? (
              <div className="form-row">
                <FormField label="目标人员" source="用户" required>
                  <select value={resourceName} onChange={(event) => applyResource(event.target.value)}>
                    {resourceChoices(selected[0]).map((item) => <option key={item.name}>{item.name}</option>)}
                  </select>
                </FormField>
                <FormField label="操作类型" source="用户" required><select><option>开通</option><option>停用</option><option>组织变更</option><option>角色变更</option></select></FormField>
              </div>
            ) : (
              <div className="form-row">
                <FormField label="来源系统" source={manualSources(selected[0], selected[2]).length === 1 ? manualSources(selected[0], selected[2])[0] : '用户'} required>
                  <select key={selected[0]} disabled={manualSources(selected[0], selected[2]).length === 1} defaultValue={manualSources(selected[0], selected[2])[0] === '本平台' ? '本平台' : '请选择'}>
                    {manualSources(selected[0], selected[2]).length > 1 && <option>请选择</option>}
                    {manualSources(selected[0], selected[2]).map((item) => <option key={item}>{item}</option>)}
                  </select>
                </FormField>
                <FormField label={`${selected[2]}资源`} source="用户" required>
                  <select value={resourceName} onChange={(event) => applyResource(event.target.value)}>
                    {resourceChoices(selected[0]).map((item) => <option key={item.name}>{item.name}</option>)}
                  </select>
                </FormField>
              </div>
            )}
            {selected[0]!=='EVT-01' && <div className="read-source"><Activity size={16} /><span><strong>{resourceName || '等待选择资源'}</strong><small>名称、所有者和版本由系统读取。密级和业务线优先用资源上的值。</small></span></div>}
          </div>
          )}
          {execution && (
            <div className={`read-source ${execution.ok ? '' : 'warn'}`}>
              <span>
                <strong>{execution.ok ? `执行完成 · ${execution.resultId}` : execution.downloadUrl ? '等待领取文件' : execution.status === 'reconciling' ? '正在查证安装结果' : execution.status === '未研判' ? '已提交 · 未研判' : execution.status === 'running' ? '执行中' : execution.status === 'queued' ? '等待执行' : '执行失败'}</strong>
                <small>{execution.ok ? `${execution.ticketNo} 已完成` : execution.failureReason}</small>
                {execution.downloadUrl && <button className="secondary-button" disabled={submitting} onClick={async () => {
                  setSubmitting(true)
                  try {
                    const file = await fetch(execution.downloadUrl!)
                    if (!file.ok) throw new Error('文件暂不可领取')
                    const url = URL.createObjectURL(await file.blob())
                    const link = document.createElement('a')
                    link.href = url
                    link.download = /filename="([^"]+)"/.exec(file.headers.get('content-disposition') ?? '')?.[1] ?? 'skill.txt'
                    link.click()
                    setTimeout(() => URL.revokeObjectURL(url), 1000)
                    const state = await fetch('/api/tickets/' + execution.ticketNo)
                    if (!state.ok) throw new Error('回执待核对，可用原流水重试')
                    setExecution(await state.json())
                  } catch (error) {
                    setExecution({...execution, failureReason: error instanceof Error ? error.message : '交付中断，可重试'})
                  } finally { setSubmitting(false) }
                }}>领取文件</button>}
              </span>
            </div>
          )}
          {!hasRegisteredTicketForm(selected[0]) && <div className="manual-actions">
            {selected[0]==='EVT-01' && <ApplicationDrafts draft={eventDraft.controller}/>}
            <button className="secondary-button" onClick={()=>{
              if(selected[0]!=='EVT-01'){setCheckNote('请使用当前类型自己的申请表单检查');return}
              const missing=[!eventObject.trim()&&'事件对象标识',!eventKind&&'事件对象类型',!facts.trim()&&'人工事实说明'].filter(Boolean)
              setCheckNote(missing.length?'还不能提交：'+missing.join('、'):'必填项已填写，尚未提交')
            }}><ClipboardCheck size={15} /> 检查</button>
            {checkNote && <p role="status">{checkNote}</p>}
            <button className="primary-button" disabled={submitting} onClick={async () => {
              const ticketNo = eventDraft.ticketNo
              setSubmitting(true)
              try {
                if(selected[0]==='EVT-01') {
                  const response=await eventDraft.submit('/api/events',{resourceId:eventObject.trim(),objectType:eventKind,facts})
                  const data=await response.json()
                  if(!response.ok) throw Error(data.error?.message ?? '提交失败')
                  setExecution({ticketNo,status:data.status,ok:false,resultId:'',failureReason:ticketNo})
                  return
                }
                throw Error('请从对应的专用申请表单提交')
              } catch (error) {
                setExecution({ok:false, resultId:'', ticketNo, failureReason:error instanceof Error ? error.message : '执行服务没有响应'})
              } finally {
                setSubmitting(false)
              }
            }}>提交申请 <ArrowRight size={16} /></button>
          </div>}
        </section>
      </div>
    </>
  )
}

export function TicketList({ view, role }: { view: 'mine' | 'todo' | 'query'; role: Role }) {
  const [activeTab,setActiveTab] = useState<'applications'|'tickets'|'events'|'accounts'|'skills'>('applications')
  const [items,setItems] = useState<string[][]>([])
  const [query,setQuery] = useState('')
  const [status,setStatus] = useState('')
  const [selected,setSelected] = useState('')
  const [error,setError] = useState('')
  const [reload,setReload] = useState(0)
  useEffect(()=>{ setActiveTab('applications') },[view,role])
  useEffect(()=>{
    if(view==='todo') return
    let active=true
    const params=view==='query'?'view=query':'account='+encodeURIComponent(personOf(role).account)
    fetch('/api/tickets?'+params).then(async response=>{
      if(!response.ok) throw Error('读取工单失败')
      const {items:tickets}=await response.json()
      const labels:Record<string,string>={succeeded:'已完成',failed:'执行失败',cancelled:'已终止',queued:'等待执行',running:'执行中',reconciling:'正在查证',awaiting_delivery:'待领取文件'}
      if(active) {
        setItems(tickets.map((t:{ticketNo:string;ticketType:string;selection:string;resourceName?:string;status:string;account:string;updatedAt:string;cancelStatus?:string;deliveryClosed?:boolean})=>
          [t.ticketNo,t.ticketType,t.resourceName || t.selection,t.status==='awaiting_delivery' && (t.cancelStatus || t.deliveryClosed)?t.cancelStatus?'取消待查证':'交付已封存':labels[t.status] ?? t.status,t.account,Number.isFinite(Date.parse(t.updatedAt))?new Date(t.updatedAt).toLocaleString('zh-CN',{hour12:false}):t.updatedAt]))
        setError('')
      }
    }).catch(()=>{if(active)setError('读取工单失败，请刷新重试')})
    return ()=>{active=false}
  },[role,view,reload])
  const rows=items.filter(row=>(!status || row[3]===status) && row.some(cell=>cell.toLowerCase().includes(query.trim().toLowerCase())))
  const details=rows.find(row=>row[0]===selected)
  const columns=['工单号','工单类型','申请对象','当前状态','申请人','最后更新']
  const tabs: {id:'applications'|'tickets'|'events'|'accounts'|'skills'; label:string; badge?:number}[] = [
    {id:'applications', label:'业务审批申请'},
    ...(view !== 'todo' ? [{id:'tickets' as const, label:'即办执行工单', badge:items.length}] : []),
    {id:'events', label:'异常事件处置'},
    ...(role === 'admin' ? [{id:'accounts' as const, label:'账号变更工单'}] : []),
    ...((role === 'ops' || role === 'admin') && view === 'todo' ? [{id:'skills' as const, label:'Skill 文件待办'}] : []),
  ]
  return <>
    <PageHeader view={view}/>
    <nav className="workorder-tabs" role="tablist" aria-label="工单分类">
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`workorder-tab ${activeTab === tab.id ? 'is-active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span>{tab.label}</span>
          {typeof tab.badge === 'number' && <span className="workorder-tab-badge">{tab.badge}</span>}
        </button>
      ))}
    </nav>
    {activeTab === 'applications' && <ApplicationDesk view={view} account={personOf(role).account}/>}
    {activeTab === 'events' && <EventDesk view={view} account={personOf(role).account}/>}
    {activeTab === 'accounts' && role === 'admin' && <AccountDesk view={view}/>}
    {activeTab === 'skills' && (role === 'ops' || role === 'admin') && view === 'todo' && <SkillCancellationDesk/>}
    {activeTab === 'tickets' && view !== 'todo' && <section className="panel list-panel">
      <div className="panel-header"><div><h3>即办执行工单</h3></div></div>
      <div className="list-toolbar"><input aria-label="搜索执行工单" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索工单号、类型或申请对象"/>
      <select aria-label="执行状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{[...new Set(items.map(row=>row[3]))].map(s=><option key={s}>{s}</option>)}</select>
      <button className="secondary-button" onClick={()=>setReload(v=>v+1)}>刷新</button></div>
      {error && <p role="alert">{error}</p>}
      <DataTable columns={columns} rows={rows} onAction={row=>setSelected(row[0])}/>
      {details && <section className="editor-section"><h3>执行工单详情</h3>
        {columns.map((label,i)=><p key={label}>{label} · {details[i]}</p>)}
        {view==='mine' && details[3]==='待领取文件' && <a href={'/api/tickets/'+encodeURIComponent(details[0])+'/file'}>领取文件</a>}
        <button className="secondary-button" onClick={()=>setSelected('')}>关闭详情</button></section>}
      <p>共 {rows.length} 条执行工单</p>
    </section>}
  </>
}

export function TicketTypes() {
  const names = Object.fromEntries([...ticketTypes, ...adminTicketTypes].map(row=>[row[0],row[1]]))
  names['KB-04']='知识库内容变更再审'
  names['PLG-04']='插件自动禁用与恢复'
  return <><PageHeader view="types"/><TypeRegistry names={names}/></>
}

export function WorkOrderDrawer({ title, role: _role, onClose }: { title: string; role: Role; onClose: () => void }) {
  const readonly = false
  const [data, setData] = useState<{
    ticketNo: string
    ticketType: string
    status: string
    account: string
    resourceId?: string
    workspaceId?: string
    facts?: string
    updatedAt?: string
    history?: { at: string; actor: string; action: string; note?: string }[]
  } | null>(null)

  const ticketMatch = /(?:AG|KB|MCP|SKL|KEY|TOL|PLG|ACC|EVT)-\d{4,8}-[\w-]+|EVT-01-[\w-]+|(?:AG|KB|MCP|SKL|KEY|TOL|PLG|ACC)-\d{8}-\d+|ACC-[\w-]+/.exec(title)
  const ticketNo = ticketMatch ? ticketMatch[0] : ''

  useEffect(() => {
    if (!ticketNo) return
    let active = true

    const fetchSources = async () => {
      try {
        if (ticketNo.startsWith('EVT-')) {
          const res = await fetch('/api/events?view=query')
          if (res.ok) {
            const json = await res.json()
            const found = json.items?.find((item: { ticketNo: string }) => item.ticketNo === ticketNo)
            if (found && active) {
              setData({
                ticketNo: found.ticketNo,
                ticketType: 'EVT-01',
                status: found.status,
                account: found.account,
                resourceId: found.resourceId,
                facts: found.facts,
                updatedAt: found.lastOccurredAt || found.firstOccurredAt,
                history: found.history,
              })
              return
            }
          }
        }
        const res = await fetch('/api/applications?view=query')
        if (res.ok) {
          const json = await res.json()
          const found = json.items?.find((item: { ticketNo: string }) => item.ticketNo === ticketNo)
          if (found && active) {
            setData({
              ticketNo: found.ticketNo,
              ticketType: found.ticketType,
              status: found.status,
              account: found.account,
              resourceId: found.resourceId,
              workspaceId: found.workspaceId,
              facts: found.fields?.facts || found.fields?.reason || found.fields?.changeDescription || found.fields?.purpose,
              updatedAt: found.updatedAt,
              history: found.history,
            })
            return
          }
        }
        const tRes = await fetch('/api/tickets?view=query')
        if (tRes.ok) {
          const json = await tRes.json()
          const found = json.items?.find((item: { ticketNo: string }) => item.ticketNo === ticketNo)
          if (found && active) {
            setData({
              ticketNo: found.ticketNo,
              ticketType: found.ticketType,
              status: found.status,
              account: found.account,
              resourceId: found.selection,
              updatedAt: found.updatedAt,
            })
            return
          }
        }
      } catch {
        // Ignored
      }
    }

    fetchSources()
    return () => { active = false }
  }, [ticketNo])

  const typeCode = data?.ticketType || (
    title.includes('plugin') || title.includes('PLG') || title.includes('插件') ? 'PLG-03' :
    title.includes('账号') || title.includes('ACC') ? 'ACC-01' :
    title.includes('AG-05') ? 'AG-05' :
    title.includes('AG-04') ? 'AG-04' :
    title.includes('KB') ? 'KB-03' :
    title.includes('MCP') ? 'MCP-02' :
    title.includes('SKL') ? 'SKL-04' : 'EVT-01'
  )

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="work-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div><span className="mini-label">关联工单</span><h3>{title}</h3></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭工单抽屉"><X size={18} /></button>
        </div>
        <div className="drawer-banner">
          <span className="type-code large">{typeCode}</span>
          <div>
            <strong>{readonly ? '只读详情' : data ? `当前状态：${data.status}` : '工单动作已就绪'}</strong>
            <small>{readonly ? '系统管理员不能办理业务工单或系统事件' : data ? `工单号：${data.ticketNo}` : '资源信息与流转上下文'}</small>
          </div>
        </div>
        <div className="drawer-timeline">
          {data?.history && data.history.length > 0 ? (
            data.history.slice(-3).map((item, idx) => (
              <div key={idx} className={idx === data.history!.length - 1 ? 'active' : 'done'}>
                <span>{idx === data.history!.length - 1 ? idx + 1 : <Check size={13} />}</span>
                <p>
                  <strong>{item.action}</strong>
                  <small>{item.at ? item.at.slice(0, 16).replace('T', ' ') : ''} · {item.actor}</small>
                </p>
              </div>
            ))
          ) : (
            <>
              <div className="done"><span><Check size={13} /></span><p><strong>动作触发</strong><small>已就绪</small></p></div>
              <i />
              <div className="active"><span>2</span><p><strong>{readonly ? '等待运维办理' : '待处理'}</strong><small>当前节点</small></p></div>
            </>
          )}
        </div>
        <div className="drawer-section">
          <h4>对象信息</h4>
          <dl className="detail-list">
            <div><dt>关联标的</dt><dd>{data?.resourceId || title.replace(/^.*?·\s*/, '')}</dd></div>
            {data?.workspaceId && <div><dt>Workspace</dt><dd>{data.workspaceId}</dd></div>}
            {data?.account && <div><dt>经办人/申请人</dt><dd>{data.account}</dd></div>}
            {data?.updatedAt && <div><dt>更新时间</dt><dd>{data.updatedAt.slice(0, 19).replace('T', ' ')}</dd></div>}
          </dl>
        </div>
        {data?.facts && (
          <div className="drawer-section">
            <h4>依据与事实</h4>
            <div className="evidence-box">
              <AlertTriangle size={18} />
              <span><strong>{data.facts}</strong></span>
            </div>
          </div>
        )}
        <div className="drawer-section">
          <h4>办理意见</h4>
          <textarea placeholder={readonly ? '当前角色仅可查看' : '填写研判结论与处置意见'} disabled={readonly} />
        </div>
        <div className="drawer-actions">
          <button className="secondary-button" onClick={onClose}>{readonly ? '关闭' : '退回补正'}</button>
          {!readonly && <button className="primary-button" onClick={onClose}>进入工单办理 <ArrowRight size={16} /></button>}
        </div>
      </aside>
    </div>
  )
}
