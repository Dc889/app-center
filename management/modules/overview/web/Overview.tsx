import {useEffect,useState} from 'react'
import {Bar,BarChart,CartesianGrid,Legend,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
type Point=Record<string,string|number>
type Resource={key:string;state:string;count:number|null;delta:number|null}
type Health={key:string;instance:string|null;version:string|null;status:string;checkedAt:string|null;latencyMs:number|null;consecutiveFailures:number|null;evidenceRef:string|null}
type Group<T>={state:'collected'|'unavailable'|'stale';source:string|null;capturedAt:string|null;reasonCode:string|null;data:T|null}
type Model={window:{range:string;from:string;to:string;bucketMs:number};resources:Group<Resource[]>;health:Group<Health[]>;calls:Group<Point[]>;exceptions:Group<Point[]>;
  management:{capturedAt:string;source:string;businessPending:number;accountPending:number|null;alertCount:number;pending:Point[];severity:Point[];
    alertObjects:{objectType:string;resourceId:string;count:number;severity:string}[];
    recent:{id:string;at:string;ticketNo:string;category:string;action:string;actor:string;status:string;objectType:string;resourceId:string|null;severity:string|null}[]}}
const resourceNames:Record<string,string>={agents:'已发布智能体',datasets:'已分享知识库',tools:'已批准工具',plugins:'已上架插件',skills:'已上架 Skill',mcp:'正常 MCP',keys:'有效 Dify 密钥'}
const serviceNames:Record<string,string>={management:'应用中心',ragflow:'RAGFlow API',dify:'Dify API',plugin_daemon:'plugin daemon',object_store:'对象存储',database:'数据库'}
const categoryNames:Record<string,string>={KB:'知识库',AG:'智能体',KEY:'密钥',TOL:'工具',PLG:'插件',SKL:'Skill',MCP:'MCP',EVT:'事件',ACC:'账号配置'}
const statusNames:Record<string,string>={healthy:'正常',degraded:'波动',failed:'故障',unavailable:'未采集',stale:'已过期'}
const colors=['#5b6cf9','#22a98a','#ed795e','#a271cf','#d9a124','#4395b9','#c8668a','#737d97','#da594e']
const time=(s:string|null)=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'未采集'
function Source({group}:{group:Group<unknown>}){return <p>{group.state==='unavailable'?'未采集':group.state==='stale'?'数据已过期，仅供参考':'已采集'} · 来源：{group.source ?? '未接入'} · 采集时间：{time(group.capturedAt)}</p>}
function Trend({title,group,series}:{title:string;group:Group<Point[]>;series:Record<string,string>}){return <section className="panel overview-block"><h3>{title}</h3><Source group={group}/>{group.data?<div style={{height:250}}><ResponsiveContainer width="100%" height="100%"><LineChart data={group.data}><CartesianGrid stroke="#edf0f5"/><XAxis dataKey="at" tickFormatter={v=>new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}/><YAxis allowDecimals={false}/><Tooltip labelFormatter={v=>time(String(v))}/><Legend/>{Object.entries(series).map(([key,name],i)=><Line key={key} name={name} dataKey={key} stroke={colors[i]} dot={false} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>:<p>未采集，暂无可展示的趋势；不以零曲线替代。</p>}</section>}
function Stacked({title,data,label,series}:{title:string;data:Point[];label:string;series:Record<string,string>}){return <section className="panel overview-block"><h3>{title}</h3><div style={{height:300}}><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid stroke="#edf0f5"/><XAxis dataKey={label}/><YAxis allowDecimals={false}/><Tooltip/><Legend/>{Object.entries(series).map(([key,name],i)=><Bar key={key} dataKey={key} name={name} stackId="count" fill={colors[i]} isAnimationActive={false}/>)}</BarChart></ResponsiveContainer></div></section>}
export function Overview({role,onNavigate}:{role:'user'|'ops'|'admin';onNavigate:(view:'todo'|'query'|'security')=>void}) {
  const [range,setRange]=useState('24h'),[refresh,setRefresh]=useState(0),[model,setModel]=useState<Model|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[evidence,setEvidence]=useState('')
  useEffect(()=>{
    const controller=new AbortController()
    fetch('/api/overview?range='+range,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('总览读取失败，请刷新重试');return r.json()}).then(data=>{if(!controller.signal.aborted)setModel(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[range,refresh,role])
  function reload(next=range){setModel(null);setError('');setEvidence('');setLoading(true);setRange(next);setRefresh(n=>n+1)}
  const local=model?.management
  return <div data-testid="real-overview">
    <div className="page-header"><div><span className="eyebrow">MONITORING</span><h1>运行总览</h1><p>当前用户网络分区；管理台账与产品观测分别注明来源。</p></div><div className="time-filter">{[['1h','近 1 小时'],['24h','近 24 小时'],['7d','近 7 天']].map(([key,name])=><button key={key} className={key===range?'active':''} onClick={()=>reload(key)}>{name}</button>)}<button onClick={()=>reload()}>刷新总览</button></div></div>
    {loading && <p role="status">正在读取总览…</p>}{error && <p role="alert">{error}</p>}
    {model && <>
      <p>趋势窗口：{time(model.window.from)} — {time(model.window.to)} · {model.window.bucketMs/60000}分钟粒度。待办与告警为当前全量状态，不随趋势窗口截断。</p>
      <Source group={model.resources}/><div className="metric-grid seven">{Object.entries(resourceNames).map(([key,name])=>{const r=model.resources.data?.find(i=>i.key===key);return <article className="metric-card" key={key}><span>{name}</span><strong>{r?.count ?? '未采集'}</strong><small>{model.resources.state==='stale'?'已过期 · ':''}{r?.delta!=null?`${r.delta>=0?'+':''}${r.delta} 较昨日`:'昨日同口径快照未采集'}</small></article>})}</div>
      <section className="panel overview-block"><h3>服务健康矩阵</h3><Source group={model.health}/><div className="table-scroll"><table><thead><tr>{['服务','实例','版本','健康','最近检查','连续失败','延迟','详情'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{Object.entries(serviceNames).map(([key,name])=>{const h=model.health.data?.find(i=>i.key===key);return <tr key={key}><td>{name}</td><td>{h?.instance ?? '未采集'}</td><td>{h?.version ?? '未采集'}</td><td>{model.health.state==='stale'?'已过期':statusNames[h?.status ?? 'unavailable']}</td><td>{time(h?.checkedAt ?? null)}</td><td>{h?.consecutiveFailures ?? '未采集'}</td><td>{h?.latencyMs!=null?h.latencyMs+' ms':'未采集'}</td><td>{h?.evidenceRef?<button onClick={()=>setEvidence(h.evidenceRef!)}>查看探测依据</button>:'未采集'}</td></tr>})}</tbody></table></div>{evidence && <p role="status">探测依据编号：{evidence}</p>}</section>
      <Trend title="调用趋势" group={model.calls} series={{agent:'智能体调用',retrieval:'知识库检索',mcp:'MCP 调用'}}/>
      <Trend title="异常趋势" group={model.exceptions} series={{agent:'智能体调用失败',dataset_build:'知识库构建失败',plugin:'插件失败',mcp:'MCP 调用失败'}}/>
      {local && <>
        <p>管理统计：{local.source} · {time(local.capturedAt)}。普通重试按原工单计一次；最近记录为操作历史，非产品调用日志。</p>
        <Stacked title={`当前未关闭告警：${local.alertCount}`} data={local.severity} label="severity" series={Object.fromEntries(['知识库','智能体','插件','MCP','智能体仓库','账号与集成','其他'].map(k=>[k,k]))}/>
        <section className="panel overview-block"><h3>未关闭告警对象 Top 10</h3>{local.alertObjects.length?<table><thead><tr><th>对象类型</th><th>对象</th><th>告警数</th><th>最高级别</th></tr></thead><tbody>{local.alertObjects.map(r=><tr key={JSON.stringify([r.objectType,r.resourceId])}><td>{r.objectType}</td><td>{r.resourceId}</td><td>{r.count}</td><td>{r.severity}</td></tr>)}</tbody></table>:<p>0 个告警对象</p>}<button onClick={()=>onNavigate('security')}>进入事件中心</button></section>
        <Stacked title="工单待办（按当前原始状态）" data={local.pending} label="status" series={Object.fromEntries(Object.entries(categoryNames).filter(([key])=>role==='admin'||key!=='ACC'))}/>
        <p>业务与事件未办结：{local.businessPending}{role==='admin'?` · 账号配置未办结：${local.accountPending}`:''}。未办结包含申请人补正、结果确认和待领取；不等于当前角色可办理数量。管理员可查看业务统计，仅办理账号配置。</p><button onClick={()=>onNavigate('todo')}>{role==='admin'?'进入账号配置待办':'进入运维待办'}</button>
        <section className="panel overview-block"><h3>最近操作记录</h3>{local.recent.length?<div className="table-scroll"><table><thead><tr>{['时间','对象类型','对象','关联工单','操作','级别','当前工单状态','操作人'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{local.recent.map(r=><tr key={r.id}><td>{time(r.at)}</td><td>{categoryNames[r.objectType] ?? r.objectType}</td><td>{r.resourceId ?? '未采集'}</td><td>{r.ticketNo}</td><td>{r.action}</td><td>{r.severity ?? '不适用'}</td><td>{r.status}</td><td>{r.actor ?? '未采集'}</td></tr>)}</tbody></table></div>:<p>0 条操作记录</p>}<button onClick={()=>onNavigate('query')}>进入工单查询</button></section>
      </>}
    </>}
  </div>
}
