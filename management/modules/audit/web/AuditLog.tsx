import {useEffect,useState} from 'react'
import {Bar,BarChart,CartesianGrid,Legend,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'

type Availability='collected'|'not_collected'|'stale'
type MetricCard={availability:Availability;count:number|null;todayCount?:number;asOf:string|null}
type SourceState={availability:Availability;asOf:string|null;reasonCode:string|null}
type TrendPoint={at:string;workflow:number;api:number|null;catalog:null;download:number|null;access:number|null}
type DistItem={category:string;availability:Availability;count:number|null}
type RankItem={actor:string;count:number}
type ManagementEntry={
  id:string;at:string|null;actor:string|null;action:string|null;reference:string|null;source:string;org:string|null;note:string|null;
  actorSubjectId:string|null;actorRole:string|null;actorRevision:number|null;actorSource:string;sourceIp:string|null;
  ticketNo:string|null;objectType:string|null;resourceId:string|null;beforeSummary:string|null;afterSummary:string|null;
  result:string|null;errorCode:string|null;category:string
}
type AccessEntry={
  id:string;at:string;source:string;mode:'广场Web'|'外部API';account:string|null;org:string|null;
  keyRegistrationId:string|null;callerName:string|null;callerOrg:string|null;sourceIp:string|null;
  path:string|null;appId:string|null;runId:string|null;latencyMs:number|null;httpStatus:number|null;
  result:string;errorCode:string|null
}
type AuditReport={
  filter:{range:string;from:string;to:string;q:string;source:string;page:number;accessPage:number;limit:number};
  source:string;capturedAt:string;timezone:string;scope:string;org:string|null;partialBoundaryBuckets:boolean;
  metrics:{workflow:MetricCard;api:MetricCard;catalog:MetricCard;download:MetricCard;access:MetricCard};
  trend:TrendPoint[];bucketMs:number;distribution:DistItem[];
  sources:Record<'execution'|'skill_delivery'|'dify_run'|'external_api',SourceState>;
  ranking:RankItem[];managementTotal:number;accessTotal:number;
  managementItems:ManagementEntry[];accessItems:AccessEntry[];
}

const sourceOptions=['申请草稿','事件办理','类型版本','执行工单','能力执行','Skill交付','广场Web','外部API']
const actorRoles:Record<string,string>={admin:'系统管理员',operator:'运维人员',user:'用户',system:'system_event'}
const actorSources:Record<string,string>={session_snapshot:'会话快照',directory_at_write:'登记快照',service:'系统服务',not_collected:'未采集'}
const availabilityLabels:Record<Availability,string>={collected:'已采集',stale:'数据已过期',not_collected:'未采集'}
const outcomeLabels:Record<string,string>={success:'成功',failure:'失败',pending:'进行中',unknown:'未知'}
const nativeNames:Record<'execution'|'skill_delivery'|'dify_run'|'external_api',string>={execution:'能力执行',skill_delivery:'Skill交付',dify_run:'广场Web',external_api:'外部API'}
const colors=['#5b6cf9','#22a98a','#ed795e','#d9a124','#a271cf']
const show=(v:string|number|null|undefined,fallback='未采集')=>v===null || v===undefined || v===''?fallback:String(v)
const date=(s:string|null|undefined)=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'未采集'
const toUtc=(value:string)=>{if(!value)return '';const ms=Date.parse(value);return Number.isFinite(ms)?new Date(ms).toISOString():''}

function buildQuery(params:{range:string;from:string;to:string;source:string;q:string;page:number;accessPage:number;limit:number},extra?:Record<string,string>) {
  const query=new URLSearchParams({range:params.range,page:String(params.page),accessPage:String(params.accessPage),limit:String(params.limit)})
  const fromUtc=toUtc(params.from),toUtcVal=toUtc(params.to)
  if(fromUtc)query.set('from',fromUtc)
  if(toUtcVal)query.set('to',toUtcVal)
  if(params.source)query.set('source',params.source)
  if(params.q.trim())query.set('q',params.q.trim())
  if(extra)for(const [k,v] of Object.entries(extra))query.set(k,v)
  return query
}

export function AuditLog({role}:{role:'user'|'ops'|'admin'}) {
  const [range,setRange]=useState('24h')
  const [from,setFrom]=useState('')
  const [until,setUntil]=useState('')
  const [source,setSource]=useState('')
  const [query,setQuery]=useState('')
  const [page,setPage]=useState(1)
  const [accessPage,setAccessPage]=useState(1)
  const [reload,setReload]=useState(0)
  const [report,setReport]=useState<AuditReport|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [exportError,setExportError]=useState('')
  const [exporting,setExporting]=useState<''|'management'|'access'>('')

  const fromUtc=toUtc(from),untilUtc=toUtc(until)
  const invalidWindow=(!!from && !fromUtc) || (!!until && !untilUtc) || (!!fromUtc && !!untilUtc && Date.parse(fromUtc)>=Date.parse(untilUtc))

  useEffect(()=>{
    if(invalidWindow)return
    const controller=new AbortController()
    const params=buildQuery({range,from,to:until,source,q:query,page,accessPage,limit:50})
    fetch('/api/audit-report?'+params,{signal:controller.signal}).then(async response=>{
      if(!response.ok){
        const problem=await response.json().catch(()=>({}))
        throw Error(problem?.error?.message ?? '审计报告读取失败，请刷新重试')
      }
      return response.json()
    }).then((data:AuditReport)=>{
      if(!controller.signal.aborted){setReport(data);setError('')}
    }).catch(e=>{
      if(!controller.signal.aborted){setError(e.message || '审计报告读取失败');setReport(null)}
    }).finally(()=>{
      if(!controller.signal.aborted)setLoading(false)
    })
    return ()=>controller.abort()
  },[range,from,until,source,query,page,accessPage,reload,role,invalidWindow])

  function updateFilter(apply:()=>void) {
    setLoading(true);setError('');setExportError('');setPage(1);setAccessPage(1);apply()
  }

  function refresh() {
    setLoading(true);setError('');setExportError('');setReload(n=>n+1)
  }

  async function exportTable(table:'management'|'access') {
    if(invalidWindow)return
    setExportError('');setExporting(table)
    try {
      const params=buildQuery({range,from,to:until,source,q:query,page:1,accessPage:1,limit:50},{table})
      const response=await fetch('/api/audit-report/export?'+params)
      if(!response.ok){
        const problem=await response.json().catch(()=>({}))
        throw Error(problem?.error?.message ?? '审计导出失败')
      }
      const rows=await response.json()
      const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json;charset=utf-8'}))
      const link=document.createElement('a')
      link.href=url;link.download=table==='management'?'管理审计.json':'访问审计.json';link.click()
      setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(e){
      setExportError(e instanceof Error?e.message:'审计导出失败')
    }finally{
      setExporting('')
    }
  }

  const metrics=report?.metrics
  const distChartData=(report?.distribution ?? []).map(d=>({category:d.category,count:d.count}))

  return <div data-testid="audit-report">
    <div className="page-header">
      <div>
        <span className="eyebrow">全程留痕</span>
        <h1>审计追踪</h1>
        <p>{role==='admin'?'当前权限：系统管理员（本网络分区全部审计，含账号类配置工单）。':'当前权限：运维人员（仅本组织且排除账号类配置工单）。'}页面汇总、趋势、分布、排行、明细与导出使用同一权限范围与筛选条件。</p>
      </div>
      <div className="time-filter">
        {[['today','今日'],['1h','近 1 小时'],['24h','近 24 小时'],['7d','近 7 天']].map(([key,label])=>
          <button key={key} className={!from && !until && range===key?'active':''} onClick={()=>updateFilter(()=>{setRange(key);setFrom('');setUntil('')})}>{label}</button>
        )}
        <button className="secondary-button" onClick={refresh}>刷新</button>
      </div>
    </div>

    <section className="panel overview-block">
      <div className="event-monitor-filters">
        <label>搜索审计记录<input aria-label="搜索审计记录" value={query} onChange={e=>updateFilter(()=>setQuery(e.target.value))} placeholder="工单、人员ID、操作者、组织或路径" maxLength={200}/></label>
        <label>审计来源<select aria-label="审计来源" value={source} onChange={e=>updateFilter(()=>setSource(e.target.value))}><option value="">全部来源</option>{sourceOptions.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
        <label>开始时间<input type="datetime-local" value={from} onChange={e=>updateFilter(()=>setFrom(e.target.value))}/></label>
        <label>结束时间<input type="datetime-local" value={until} onChange={e=>updateFilter(()=>setUntil(e.target.value))}/></label>
      </div>
      {invalidWindow && <p role="alert">时间范围无效：开始时间必须早于结束时间。</p>}
      {report && <p>统计窗口：{date(report.filter.from)} — {date(report.filter.to)}（{report.timezone}） · 采集时间：{date(report.capturedAt)} · 来源状态：管理台账（已采集）、目录变更（未采集）、{(['execution','skill_delivery','dify_run','external_api'] as const).map(k=>`${nativeNames[k]}（${availabilityLabels[report.sources[k].availability]}${report.sources[k].asOf?' · '+date(report.sources[k].asOf):''}）`).join('、')}</p>}
    </section>

    {loading && !invalidWindow && <p role="status">正在读取审计追踪…</p>}
    {error && <p role="alert">{error}</p>}
    {exportError && <p role="alert">{exportError}</p>}

    {report && metrics && <>
      <div className="metric-grid five" data-testid="audit-metrics">
        <article className="metric-card">
          <span>今日工单动作</span>
          <strong>{metrics.workflow.todayCount ?? 0}</strong>
          <small>当前筛选窗口：{metrics.workflow.count ?? 0} · 管理台账（已采集）</small>
        </article>
        <article className="metric-card">
          <span>API 执行</span>
          <strong>{metrics.api.count ?? '未采集'}</strong>
          <small>{availabilityLabels[metrics.api.availability]}{metrics.api.asOf?` · ${date(metrics.api.asOf)}`:' · 不从工单动作推算'}</small>
        </article>
        <article className="metric-card">
          <span>目录变更</span>
          <strong>{metrics.catalog.count ?? '未采集'}</strong>
          <small>未采集 · 暂无独立目录变更审计源</small>
        </article>
        <article className="metric-card">
          <span>下载</span>
          <strong>{metrics.download.count ?? '未采集'}</strong>
          <small>{availabilityLabels[metrics.download.availability]}{metrics.download.asOf?` · ${date(metrics.download.asOf)}`:' · 按执行ID去重，不从工单推算'}</small>
        </article>
        <article className="metric-card">
          <span>访问日志</span>
          <strong>{metrics.access.count ?? '未采集'}</strong>
          <small>{availabilityLabels[metrics.access.availability]}{metrics.access.asOf?` · ${date(metrics.access.asOf)}`:' · 广场Web与外部API，排除双源重复'}</small>
        </article>
      </div>

      <section className="panel overview-block" data-testid="audit-trend">
        <h3>审计事件趋势</h3>
        <p>粒度：{report.bucketMs/60000} 分钟{report.partialBoundaryBuckets?'；首尾为部分时间桶':''}。未采集序列不绘制零曲线（目录变更：未采集；API：{availabilityLabels[metrics.api.availability]}；下载：{availabilityLabels[metrics.download.availability]}；访问：{availabilityLabels[metrics.access.availability]}）。</p>
        <div style={{height:260}}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={report.trend}>
              <CartesianGrid stroke="#edf0f5"/>
              <XAxis dataKey="at" tickFormatter={v=>new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}/>
              <YAxis allowDecimals={false}/>
              <Tooltip labelFormatter={v=>date(String(v))}/>
              <Legend/>
              <Line dataKey="workflow" name="工单" stroke={colors[0]} dot={false} isAnimationActive={false}/>
              {metrics.api.availability!=='not_collected' && <Line dataKey="api" name="API" stroke={colors[1]} dot={false} isAnimationActive={false}/>}
              {metrics.download.availability!=='not_collected' && <Line dataKey="download" name="下载" stroke={colors[3]} dot={false} isAnimationActive={false}/>}
              {metrics.access.availability!=='not_collected' && <Line dataKey="access" name="访问" stroke={colors[4]} dot={false} isAnimationActive={false}/>}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel overview-block" data-testid="audit-distribution">
        <h3>操作类型分布</h3>
        <p>创建、提交、审批、补偿及其他来自管理台账；执行、下载、访问仅取对应能力观测源，未采集不填 0。</p>
        <div style={{height:260}}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distChartData}>
              <CartesianGrid stroke="#edf0f5"/>
              <XAxis dataKey="category"/>
              <YAxis allowDecimals={false}/>
              <Tooltip/>
              <Bar dataKey="count" name="事件数" fill={colors[0]} isAnimationActive={false}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p>{report.distribution.map(d=>`${d.category}：${d.count===null?'未采集':d.count}${d.availability==='stale'?'（已过期）':''}`).join(' · ')}</p>
      </section>

      <section className="panel overview-block" data-testid="audit-ranking">
        <h3>操作者排行</h3>
        <p>仅统计当前筛选范围内管理台账的人工操作（前 20 名）；后台任务与运行调用不计入管理操作排行。</p>
        {report.ranking.length?<div style={{height:Math.max(180,report.ranking.length*32+40)}}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={report.ranking} layout="vertical" margin={{left:24,right:24}}>
              <CartesianGrid stroke="#edf0f5"/>
              <XAxis type="number" allowDecimals={false}/>
              <YAxis type="category" dataKey="actor" width={120}/>
              <Tooltip/>
              <Bar dataKey="count" name="管理操作数" fill={colors[1]} isAnimationActive={false}/>
            </BarChart>
          </ResponsiveContainer>
        </div>:<p>当前筛选下无人工管理操作</p>}
      </section>

      <section className="panel overview-block" data-testid="audit-management-table">
        <div className="list-toolbar">
          <h3>管理端审计记录</h3>
          <button className="secondary-button" disabled={!!error || invalidWindow || exporting==='management'} onClick={()=>exportTable('management')}>{exporting==='management'?'正在导出…':'导出当前筛选'}</button>
        </div>
        <p>共 {report.managementTotal} 条记录 · 第 {report.filter.page} 页 · 操作者 {new Set(report.managementItems.map(r=>r.actor).filter(Boolean)).size}</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>{['审计ID','时间','来源','账户名','角色','人员ID','当时组织','身份修订','身份依据','来源IP','工单号','对象类型','对象ID','动作','变更前摘要','变更后摘要','结果','错误码','办理依据'].map(label=><th key={label}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {report.managementItems.map(row=><tr key={row.source+'/'+row.id}>
                <td>{row.id}</td>
                <td>{date(row.at)}</td>
                <td>{row.source}</td>
                <td>{show(row.actor)}</td>
                <td>{row.actorRole?(actorRoles[row.actorRole] ?? '未采集'):'未采集'}</td>
                <td>{show(row.actorSubjectId)}</td>
                <td>{show(row.org)}</td>
                <td>{show(row.actorRevision)}</td>
                <td>{actorSources[row.actorSource] ?? '未采集'}</td>
                <td>{show(row.sourceIp,'—')}</td>
                <td>{show(row.ticketNo ?? row.reference,'—')}</td>
                <td>{show(row.objectType,'—')}</td>
                <td>{show(row.resourceId,'—')}</td>
                <td>{show(row.action)}</td>
                <td>{show(row.beforeSummary,'—')}</td>
                <td>{show(row.afterSummary,'—')}</td>
                <td>{row.result?(outcomeLabels[row.result] ?? row.result):'未采集'}</td>
                <td>{show(row.errorCode,'—')}</td>
                <td>{show(row.note,'—')}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {!report.managementItems.length && <p>当前筛选下没有管理审计记录</p>}
        <div className="list-toolbar">
          <button className="secondary-button" disabled={page<=1} onClick={()=>{setLoading(true);setPage(p=>p-1)}}>上一页</button>
          <button className="secondary-button" disabled={page*report.filter.limit>=report.managementTotal} onClick={()=>{setLoading(true);setPage(p=>p+1)}}>下一页</button>
        </div>
      </section>

      <section className="panel overview-block" data-testid="audit-access-table">
        <div className="list-toolbar">
          <h3>访问审计记录</h3>
          <button className="secondary-button" disabled={!!error || invalidWindow || exporting==='access'} onClick={()=>exportTable('access')}>{exporting==='access'?'正在导出…':'导出访问审计'}</button>
        </div>
        <p>广场Web：{availabilityLabels[report.sources.dify_run.availability]} · 外部API：{availabilityLabels[report.sources.external_api.availability]}。广场Web行的密钥字段为“—”；外部API行的账户名和用户组织为“—”；不包含模型中心身份和traceId。</p>
        <p>共 {report.accessTotal} 条访问记录 · 第 {report.filter.accessPage} 页</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>{['平台记录ID','时间','访问方式','账户名','用户组织','密钥登记ID','调用方名称','调用方组织','来源IP','API路径','应用ID','Dify运行ID','耗时','HTTP响应状态','业务状态','错误码'].map(label=><th key={label}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {report.accessItems.map(row=><tr key={row.source+'/'+row.id}>
                <td>{row.id}</td>
                <td>{date(row.at)}</td>
                <td>{row.mode}</td>
                <td>{row.mode==='外部API'?'—':show(row.account)}</td>
                <td>{row.mode==='外部API'?'—':show(row.org)}</td>
                <td>{row.mode==='广场Web'?'—':show(row.keyRegistrationId)}</td>
                <td>{row.mode==='广场Web'?'—':show(row.callerName)}</td>
                <td>{row.mode==='广场Web'?'—':show(row.callerOrg)}</td>
                <td>{show(row.sourceIp,'—')}</td>
                <td>{show(row.path,'—')}</td>
                <td>{show(row.appId,'—')}</td>
                <td>{show(row.runId,'—')}</td>
                <td>{row.latencyMs!==null?row.latencyMs+' ms':'未采集'}</td>
                <td>{show(row.httpStatus)}</td>
                <td>{outcomeLabels[row.result] ?? row.result}</td>
                <td>{show(row.errorCode,'—')}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {!report.accessItems.length && <p>{metrics.access.availability==='not_collected'?'访问审计来源未采集或当前筛选下无记录':'当前筛选下没有访问审计记录'}</p>}
        <div className="list-toolbar">
          <button className="secondary-button" disabled={accessPage<=1} onClick={()=>{setLoading(true);setAccessPage(p=>p-1)}}>访问上一页</button>
          <button className="secondary-button" disabled={accessPage*report.filter.limit>=report.accessTotal} onClick={()=>{setLoading(true);setAccessPage(p=>p+1)}}>访问下一页</button>
        </div>
      </section>
    </>}
  </div>
}
