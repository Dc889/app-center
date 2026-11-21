import {useState} from 'react'
import {ArrowRight, Send, Sparkles, WandSparkles} from 'lucide-react'
import fieldSchemas from '../../../contracts/management-api/draft-fields.json'
import {matchDialogue, statedResource, type CatalogType, type DialogueMatch} from '../../platform/workflow/public.web'
type Role = 'user' | 'ops' | 'admin'
type Fields = Record<string, string>
const schemas = fieldSchemas as Record<string, { strings?: string; dates?: string; lists?: string }>
const labels: Record<string, string> = {
  resourceId: '资源 ID', workspaceId: '工作区 ID', purpose: '使用目的', reason: '申请依据', facts: '事实说明',
  objectType: '事件对象类型', subjectId: '稳定人员 ID', newAccount: '新账户名', name: '名称', description: '功能说明',
  scenario: '业务场景', instructions: '使用说明', explanation: '原因说明', sourceSystem: '来源系统',
}
const intakeTypes = new Set(['SKL-01', 'SKL-02', 'PLG-01', 'PLG-02'])
const objectTypes = ['知识库', '智能体', '插件', 'MCP', '智能体仓库', '账号与集成']
function keysOf(type: string) {
  const schema = schemas[type] ?? {}
  return [...(schema.strings ?? '').split(' '), ...(schema.dates ?? '').split(' '), ...(schema.lists ?? '').split(' ')].filter(Boolean)
}
function seed(type: string, message: string): Fields {
  const value: Fields = {}
  for (const key of keysOf(type)) value[key] = ''
  const resource = statedResource(message)
  if (resource && 'resourceId' in value) value.resourceId = resource
  if (value.objectType !== undefined) value.objectType = objectTypes.find(item => message.includes(item)) ?? '插件'
  for (const key of ['facts', 'purpose', 'reason', 'explanation', 'instructions', 'description']) {
    if (value[key] !== undefined) value[key] = message.trim()
  }
  if (value.sourceSystem !== undefined) value.sourceSystem = message.includes('RAGFlow') ? 'RAGFlow' : 'Dify'
  if (value.operation !== undefined && type === 'KEY-02') value.operation = message.includes('撤销') ? '撤销' : '轮换'
  if (value.operation !== undefined && type === 'PLG-03') value.operation = message.includes('卸载') ? '卸载' : message.includes('升级') ? '升级' : '安装'
  if (value.operation !== undefined && type === 'MCP-03') value.operation = message.includes('隔离') ? '隔离' : message.includes('下架') ? '下架' : '解绑'
  return value
}
function problemsOf(type: string, fields: Fields) {
  const missing = ['resourceId', 'subjectId', 'facts', 'purpose', 'reason', 'objectType', 'newAccount', 'effectiveAt']
    .filter(key => keysOf(type).includes(key) && !fields[key]?.trim())
  const problems = missing.map(key => `请填写${labels[key] ?? key}`)
  if (intakeTypes.has(type)) problems.push('待审文件须在手工申请上传并完成扫描，对话不能代替扫描结果')
  return problems
}
export function ChatApplication({ role, account, catalog }: { role: Role; account: string; catalog: CatalogType[] }) {
  const [draftText, setDraftText] = useState('')
  const [turns, setTurns] = useState<{ speaker: 'user' | 'assistant'; text: string }[]>([
    { speaker: 'assistant', text: '请描述要办理的事项。我只在当前角色可申请的类型里匹配，不代替审批，也不填写产品快照。' },
  ])
  const [selected, setSelected] = useState<DialogueMatch | null>(null)
  const [candidates, setCandidates] = useState<DialogueMatch[]>([])
  const [fields, setFields] = useState<Fields>({})
  const [draftId, setDraftId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState('')
  function apply(match: DialogueMatch, source: string) {
    setSelected(match)
    setFields(seed(match.code, source))
    setDraftId(null)
    setRevision(0)
    setSubmitted('')
    setMessage('')
  }
  function send() {
    const text = draftText.trim()
    if (!text || text.length > 2000) return
    const result = matchDialogue(text, catalog)
    const reply = result.selected
      ? `识别目标：${text}\n匹配类型：${result.selected.code} ${result.selected.name}\n置信度：${Math.round(result.selected.confidence * 100)}%\n仍需回答：右侧带星号的空字段。产品目录和快照需要重新读取，不能沿用这句话里的猜测。`
      : result.candidates.length
        ? `识别目标：${text}\n置信度低于 75%，请从候选类型中选择。我不会替你提交。`
        : '没有匹配到当前目录中的工单类型。请换一种说法，或改用手工申请。'
    setTurns(old => [...old, { speaker: 'user', text }, { speaker: 'assistant', text: reply }])
    setCandidates(result.selected ? [] : result.candidates)
    if (result.selected) apply(result.selected, text)
    setDraftText('')
  }
  function editable() {
    if (!selected) return {}
    const allowed = new Set(keysOf(selected.code))
    return Object.fromEntries(Object.entries(fields).filter(([key, value]) => allowed.has(key) && value.trim()).map(([key, value]) => {
      const dates = (schemas[selected.code].dates ?? '').split(' ')
      const lists = (schemas[selected.code].lists ?? '').split(' ')
      if (dates.includes(key)) return [key, new Date(value).toISOString()]
      if (lists.includes(key)) return [key, value.split(',').map(item => item.trim()).filter(Boolean)]
      return [key, value.trim()]
    }))
  }
  async function persist() {
    if (!selected) throw Error('请先匹配工单类型')
    const response = await fetch('/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      draftId: draftId ?? crypto.randomUUID(), revision, ticketType: selected.code, fields: editable() }) })
    const data = await response.json()
    if (!response.ok) throw Error(data.error?.message ?? '保存草稿失败')
    setDraftId(data.draftId)
    setRevision(data.revision)
    return data as { draftId: string; revision: number }
  }
  async function save() {
    setBusy(true)
    try { await persist(); setMessage('申请草稿已保存。草稿不是已获准输入。') }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存草稿失败') }
    finally { setBusy(false) }
  }
  function check() {
    if (!selected) return setMessage('请先匹配工单类型')
    const problems = problemsOf(selected.code, fields)
    setMessage(problems.length ? problems.join('；') : '必填项已填写。提交时仍由原接口重新核验资源和权限。')
  }
  async function submit() {
    if (!selected) return
    const problems = problemsOf(selected.code, fields)
    if (problems.length) return setMessage(problems.join('；'))
    setBusy(true)
    try {
      const saved = await persist()
      const ticketNo = selected.code + '-' + crypto.randomUUID()
      const common = { ticketNo, draft: { draftId: saved.draftId, revision: saved.revision } }
      const payload = selected.code === 'EVT-01'
        ? { ...common, resourceId: fields.resourceId.trim(), objectType: fields.objectType, facts: fields.facts.trim() }
        : selected.code === 'SKL-03'
          ? { ...common, ticketType: 'SKL-03', action: 'download', resourceId: fields.resourceId.trim(), account }
          : selected.code.startsWith('ACC-')
            ? { ...common, ticketType: selected.code, subjectId: fields.subjectId.trim(), fields: editable() }
            : { ...common, ticketType: selected.code, resourceId: fields.resourceId.trim(), workspaceId: fields.workspaceId?.trim() ?? '', fields: editable() }
      const endpoint = selected.code === 'EVT-01' ? '/api/events' : selected.code.startsWith('ACC-') ? '/api/account-applications' : selected.code === 'SKL-03' ? '/api/tickets' : '/api/applications'
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '提交失败')
      setSubmitted(data.ticketNo ?? ticketNo)
      setTurns(old => [...old, { speaker: 'assistant', text: `已提交 ${data.ticketNo ?? ticketNo}，当前状态 ${data.status ?? '已受理'}。聊天内容没有被当作审批结论。` }])
    } catch (error) { setMessage(error instanceof Error ? error.message : '提交失败') }
    finally { setBusy(false) }
  }
  return <>
    <div className="page-header"><div><h1>对话申请</h1></div></div>
    <div className="application-split">
      <section className="chat-pane">
        <div className="pane-head"><div><span className="assistant-avatar"><Sparkles size={17} /></span><div><strong>申请助手</strong><small>仅匹配和填表，不代替审批 · {role === 'admin' ? '含账号类工单' : '不含账号类工单'}</small></div></div>
          <button className="text-button" onClick={() => { setTurns(old => [old[0]]); setSelected(null); setCandidates([]); setFields({}); setDraftId(null); setRevision(0); setSubmitted(''); setMessage('') }}>清空未提交会话</button></div>
        <div className="chat-stream">{turns.map((turn, index) => <div key={index} className={`chat-row ${turn.speaker === 'user' ? 'me' : 'assistant'}`}><div className="bubble">{turn.text}</div></div>)}
          {candidates.map(item => <button key={item.code} className="secondary-button" onClick={() => apply(item, turns.filter(turn => turn.speaker === 'user').at(-1)?.text ?? '')}>候选 · {item.code} · {Math.round(item.confidence * 100)}%</button>)}
        </div>
        <div className="chat-composer">
          <textarea aria-label="申请描述" value={draftText} maxLength={2000} onChange={event => setDraftText(event.target.value)} placeholder="说明对象、动作和用途" />
          <div><span>{draftText.length} / 2000</span><button className="send-button" aria-label="发送申请描述" onClick={send}><Send size={17} /></button></div>
        </div>
      </section>
      <section className="draft-pane">
        <div className="draft-head"><div><span className="mini-label">实时生成</span><h3>工单草稿</h3></div><span className={`draft-state ${selected ? 'ready' : ''}`}>{submitted ? '已提交' : selected ? '填写中' : '等待描述'}</span></div>
        <div className="match-summary"><div><small>匹配工单类型</small><strong>{selected ? `${selected.code} ${selected.name}` : '尚未匹配'}</strong></div>
          <div><span><small>审批模式</small><strong>{selected?.mode ?? '—'}</strong></span><span><small>置信度</small><strong>{selected ? `${Math.round(selected.confidence * 100)}%` : '—'}</strong></span></div></div>
        {selected ? <div className="form-body">{keysOf(selected.code).map(key => <label className="form-field" key={key}><span>{labels[key] ?? key}{['resourceId', 'subjectId', 'facts', 'purpose', 'reason', 'objectType', 'newAccount', 'effectiveAt'].includes(key) && <b>*</b>}<em>用户</em></span>
          {key === 'objectType' ? <select aria-label="事件对象类型" value={fields.objectType ?? ''} onChange={event => setFields({ ...fields, objectType: event.target.value })}>{objectTypes.map(item => <option key={item}>{item}</option>)}</select>
            : (schemas[selected.code].dates ?? '').split(' ').includes(key) ? <input aria-label={labels[key] ?? key} type="datetime-local" value={fields[key] ?? ''} onChange={event => setFields({ ...fields, [key]: event.target.value })} />
              : <input aria-label={labels[key] ?? key} value={fields[key] ?? ''} onChange={event => setFields({ ...fields, [key]: event.target.value })} />}</label>)}
          </div>
          : <div className="draft-empty"><div><WandSparkles size={28} /></div><strong>从一句话开始</strong></div>}
        <div className="draft-actions">
          <button className="secondary-button" disabled={!selected || busy || !!submitted} onClick={save}>保存草稿</button>
          <button className="secondary-button" disabled={!selected || busy} onClick={check}>检查</button>
          <button className="primary-button" disabled={!selected || busy || !!submitted} onClick={submit}>{submitted ? '已提交' : '提交申请'} <ArrowRight size={16} /></button>
        </div>
        <p role="status">{submitted ? `已提交 ${submitted}` : message}</p>
      </section>
    </div>
  </>
}
