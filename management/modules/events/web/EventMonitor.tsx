import {useEffect,useState} from 'react'
import {Bar,BarChart,CartesianGrid,LabelList,Legend,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
type Row={ticketNo:string;eventId:string;creationMode:string|null;objectType:string|null;resourceId:string|null;name:string|null;ruleCode:string|null;originalSeverity:string|null;assessedSeverity:string|null;conclusion:string|null;status:string|null;handler:string|null;firstOccurredAt:string|null;lastOccurredAt:string|null;durationMinutes:number|null;durationKind:string;relatedTicketNos:string[]}
type Step={id:string;at:string|null;actor:string|null;action:string|null;fromStatus:string|null;toStatus:string|null;note:string|null}
type Detail={basic:Row;facts:string|null;metrics:{unit:string;points:{at:string;value:number;threshold:number}[]}|null;logs:{at:string;source:string;level:string;message:string}[];actions:{executionId:string;ticketNo:string;at:string|null;adapter:string|null;resourceId:string;action:string|null;result:string|null;errorCode:string|null}[];timeline:Step[]}
type Model={capturedAt:string;timezone:string;window:{from:string;to:string;bucketMs:number};cards:{unassessed:number;handling:number;review:number;urgent:number;closedToday:number};trend:{at:string;added:number;closed:number;reopened:number}[];distribution:Record<string,string|number>[];durations:{objectType:string;count:number;excluded:number;meanMinutes:number|null;p95Minutes:number|null}[];unknownTrendTimes:number;total:number;page:number;limit:number;items:Row[]}
const kinds=['知识库','智能体','插件','MCP','智能体仓库','账号与集成'],levels=['提示','一般','严重','紧急','未采集'],states=['未研判','处理中','待复核','观察中','已重开','已关闭'],colors=['#5b6cf9','#22a98a','#ed795e','#a271cf','#d9a124','#4395b9']
const show=(s:string|null)=>s ?? '未采集'
const date=(s:string|null)=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'未采集'
const minutes=(n:number|null)=>n===null?'未采集':n.toFixed(2)+' 分钟'
function Table({headers,children}:{headers:string[];children:React.ReactNode}){return <div className="table-scroll"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
export function EventMonitor({role,onHandle}:{role:'user'|'ops'|'admin';onHandle:()=>void}) {
  const [filters,setFilters]=useState({range:'24h',q:'',status:'',objectType:'',severity:''}),[draft,setDraft]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0)
  const [model,setModel]=useState<Model|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState(''),[detail,setDetail]=useState<Detail|null>(null),[detailError,setDetailError]=useState('')
  useEffect(()=>{
    const c=new AbortController()
    const query=new URLSearchParams({...filters,page:String(page),limit:'25'});for(const [k,v] of [...query])if(!v)query.delete(k)
    fetch('/api/event-monitor?'+query,{signal:c.signal}).then(async r=>{if(!r.ok)throw Error('事件监控读取失败，请刷新重试');return r.json()}).then(data=>{if(!c.signal.aborted)setModel(data)}).catch(e=>{if(!c.signal.aborted)setError(e.message)}).finally(()=>{if(!c.signal.aborted)setLoading(false)})
    return ()=>c.abort()
  },[filters,page,revision,role])
  useEffect(()=>{
    if(!selected)return
    const c=new AbortController()
    fetch('/api/event-monitor/'+encodeURIComponent(selected),{signal:c.signal}).then(async r=>{if(!r.ok)throw Error('事件证据读取失败，请重试');return r.json()}).then(data=>{if(!c.signal.aborted)setDetail(data)}).catch(e=>{if(!c.signal.aborted)setDetailError(e.message)})
    return ()=>c.abort()
  },[selected,revision,role])
  const reset=()=>{setModel(null);setError('');setLoading(true)}
  const open=(id:string)=>{setDetail(null);setDetailError('');setSelected(id)}
  const refresh=()=>{reset();setDetail(null);setDetailError('');setRevision(n=>n+1)}
  const change=(key:string,value:string)=>{reset();setPage(1);setSelected('');setFilters(f=>({...f,[key]:value}))}
  const gotoPage=(value:number)=>{reset();setSelected('');setPage(value)}
  return <div data-testid="event-monitor">
    <div className="page-header"><div><h1>安全事件</h1></div><button onClick={refresh}>刷新事件监控</button></div>
    <section className="panel overview-block"><div className="event-monitor-filters"><label>事件搜索<input aria-label="事件搜索" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={200}/></label><button onClick={()=>change('q',draft)}>查询事件</button>
      <label>趋势范围<select aria-label="趋势范围" value={filters.range} onChange={e=>change('range',e.target.value)}>{[['1h','近1小时'],['24h','近24小时'],['7d','近7天']].map(([v,n])=><option value={v} key={v}>{n}</option>)}</select></label>
      {([['objectType','对象类型',kinds],['status','事件状态',states],['severity','事件级别',levels]] as const).map(([key,label,options])=><label key={key}>{label}<select aria-label={label} value={filters[key]} onChange={e=>change(key,e.target.value)}><option value="">全部</option>{options.map(o=><option key={o}>{o}</option>)}</select></label>)}
    </div><details className="technical-details"><summary>统计口径</summary><p>卡片、分布、处置时长和台账使用同一筛选范围的当前全量记录；趋势范围只限定发生时间。今日按Asia/Shanghai计算。</p></details></section>
    {loading && <p role="status">正在读取事件监控…</p>}{error && <p role="alert">{error}</p>}
    {model && <>
      <details className="technical-details"><summary>数据来源</summary><p>来源：management_reported_events · {date(model.capturedAt)}</p></details>
      <div className="metric-grid five">{([['unassessed','未研判'],['handling','处理中'],['review','待复核'],['urgent','紧急未关闭'],['closedToday','今日关闭']] as const).map(([key,label])=><article className="metric-card" key={key}><span>{label}</span><strong>{model.cards[key]}</strong></article>)}</div>
      <section className="panel overview-block"><h3>事件趋势</h3><details className="technical-details"><summary>统计口径</summary><p>{date(model.window.from)} — {date(model.window.to)}；首尾为部分时间桶。关闭、重开按真实状态转换计次，不按轮询次数。</p></details><div style={{height:260}}><ResponsiveContainer width="100%" height="100%"><LineChart data={model.trend}><CartesianGrid stroke="#edf0f5"/><XAxis dataKey="at" tickFormatter={v=>new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}/><YAxis allowDecimals={false}/><Tooltip labelFormatter={v=>date(String(v))}/><Legend/>{[['added','新增'],['closed','关闭'],['reopened','重开']].map(([key,name],i)=><Line key={key} dataKey={key} name={name} stroke={colors[i]} dot={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>{model.unknownTrendTimes>0 && <p>首次时间未采集：{model.unknownTrendTimes}条，未计入新增趋势。</p>}</section>
      <section className="panel overview-block"><h3>事件级别分布</h3><details className="technical-details"><summary>统计口径</summary><p>研判后级别优先；未研判取原始级别，均缺失时单列未采集。</p></details><div style={{height:260}}><ResponsiveContainer width="100%" height="100%"><BarChart data={model.distribution}><CartesianGrid stroke="#edf0f5"/><XAxis dataKey="severity"/><YAxis allowDecimals={false}/><Tooltip/><Legend/>{kinds.map((kind,i)=><Bar key={kind} dataKey={kind} stackId="count" fill={colors[i]} isAnimationActive={false}/>)}</BarChart></ResponsiveContainer></div></section>
      <section className="panel overview-block"><h3>处置时长</h3><details className="technical-details"><summary>统计口径</summary><p>已关闭事件从首次发生到最近关闭的总历时，包含观察和重处置。P95采用最近秩；缺失或倒序时间不计均值，不填0。</p></details><div style={{height:260}}><ResponsiveContainer width="100%" height="100%"><BarChart data={model.durations}><CartesianGrid stroke="#edf0f5"/><XAxis dataKey="objectType"/><YAxis unit=" 分钟"/><Tooltip/><Bar name="平均处置分钟" dataKey="meanMinutes" fill="#5b6cf9" isAnimationActive={false}><LabelList dataKey="p95Minutes" position="top" formatter={v=>v==null?'未采集':'P95 '+Number(v).toFixed(2)}/></Bar></BarChart></ResponsiveContainer></div>
        <Table headers={['对象类型','有效关闭样本','缺失时间样本','平均处置时长','P95']}>{model.durations.map(r=><tr key={r.objectType}><td>{r.objectType}</td><td>{r.count}</td><td>{r.excluded}</td><td>{minutes(r.meanMinutes)}</td><td>{minutes(r.p95Minutes)}</td></tr>)}</Table></section>
      <section className="panel overview-block"><h3>事件台账</h3><p>共{model.total}条；第{model.page}页。进行中时长为截至本次读取的历时。</p>
        <Table headers={['事件ID','首次时间','对象类型','对象名称','规则','原始级别','研判后级别','研判结论','状态','办理人','处置时长','关联工单','证据']}>{model.items.map(r=><tr key={r.ticketNo}><td>{r.eventId}</td><td>{date(r.firstOccurredAt)}</td><td>{show(r.objectType)}</td><td>{show(r.name)}</td><td>{show(r.ruleCode)}</td><td>{show(r.originalSeverity)}</td><td>{show(r.assessedSeverity)}</td><td>{show(r.conclusion)}</td><td>{show(r.status)}</td><td>{show(r.handler)}</td><td>{minutes(r.durationMinutes)}{r.durationKind==='elapsed'?' · 进行中':''}</td><td>{[r.ticketNo,...r.relatedTicketNos].join('、')}</td><td><button onClick={()=>open(r.ticketNo)} aria-label={'查看证据 '+r.ticketNo}>查看证据</button></td></tr>)}</Table>
        {!model.items.length && <p>当前筛选下没有事件</p>}<button disabled={page<=1} onClick={()=>gotoPage(page-1)}>上一页</button><button disabled={page*model.limit>=model.total} onClick={()=>gotoPage(page+1)}>下一页</button>
      </section>
    </>}
    {selected && <div className="drawer-backdrop" onMouseDown={()=>setSelected('')}><section className="event-evidence-drawer overview-block" role="dialog" aria-modal="true" aria-label="单事件证据" onKeyDown={e=>{if(e.key==='Escape')setSelected('')}} onMouseDown={e=>e.stopPropagation()}><button autoFocus onClick={()=>setSelected('')}>关闭证据</button><h2>单事件证据</h2>
      {detailError?<p role="alert">{detailError}</p>:!detail?<p>正在读取证据…</p>:<>
        <h3>基本信息</h3><Table headers={['字段','事实']}>{[['事件ID',detail.basic.eventId],['创建方式',detail.basic.creationMode],['对象类型',detail.basic.objectType],['对象ID',detail.basic.resourceId],['对象名称',detail.basic.name],['规则编码',detail.basic.ruleCode],['原始级别',detail.basic.originalSeverity],['研判后级别',detail.basic.assessedSeverity],['首次时间',date(detail.basic.firstOccurredAt)],['最近时间',date(detail.basic.lastOccurredAt)],['状态',detail.basic.status],['办理人',detail.basic.handler],['关联工单',[detail.basic.ticketNo,...detail.basic.relatedTicketNos].join('、')]].map(([k,v])=><tr key={k}><td>{k}</td><td>{show(v)}</td></tr>)}</Table><p>报告事实：{show(detail.facts)}</p>
        <h3>指标与阈值</h3>{detail.metrics?<><p>规则原始单位：{detail.metrics.unit}</p><div style={{height:240}}><ResponsiveContainer width="100%" height="100%"><LineChart data={detail.metrics.points}><XAxis dataKey="at" tickFormatter={v=>date(String(v))}/><YAxis/><Tooltip/><Legend/><Line name="实测值" dataKey="value" stroke={colors[0]} isAnimationActive={false}/><Line name="阈值" dataKey="threshold" stroke={colors[2]} isAnimationActive={false}/></LineChart></ResponsiveContainer></div></>:<p>{detail.basic.creationMode==='人工报告'?'无时序指标':'指标未采集'}</p>}
        <h3>证据日志</h3>{detail.logs.length?<Table headers={['时间','来源','级别','消息']}>{detail.logs.map((r,i)=><tr key={i}><td>{date(r.at)}</td><td>{r.source}</td><td>{r.level}</td><td>{r.message}</td></tr>)}</Table>:<p>未采集脱敏日志</p>}
        <h3>API动作</h3><details className="technical-details"><summary>统计口径</summary><p>以下仅为同对象关联执行的最新持久结果摘要；逐步API调用、适配器与原始调用时间未采集，不据此补猜。</p></details>{detail.actions.length?<Table headers={['结果更新时间','适配器','对象','动作','结果','错误码']}>{detail.actions.map(r=><tr key={r.executionId}><td>{date(r.at)}</td><td>{show(r.adapter)}</td><td>{r.resourceId}</td><td>{show(r.action)}</td><td>{show(r.result)}</td><td>{show(r.errorCode)}</td></tr>)}</Table>:<p>没有已采集的关联执行结果</p>}
        <h3>状态时间线</h3><Table headers={['时间','操作者','前状态','后状态','意见']}>{detail.timeline.map(r=><tr key={r.id}><td>{date(r.at)}</td><td>{show(r.actor)}</td><td>{show(r.fromStatus)}</td><td>{show(r.toStatus)}</td><td>{[r.action,r.note].filter(Boolean).join(' · ')}</td></tr>)}</Table>
        {role==='ops'?<button onClick={()=>{setSelected('');onHandle()}}>前往运维待办办理</button>:<p>管理员只读，不办理事件</p>}
      </>}
    </section></div>}
  </div>
}
