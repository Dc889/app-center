type Dependency={kind:string;id:string;name:string;change:string;approved:boolean;externalAllowed:boolean;fingerprint:string}
type Inventory={state:'collected'|'unavailable';count:number|null;revision:number|null;reasonCode?:string}
export type AgentImpact={resourceId:string;appId:string;workspaceId:string;snapshotId:string;capturedAt:string;grants:Inventory;keys:Inventory;dependencies:Inventory&{items:Dependency[]|null};calls30d:{state:'collected'|'unavailable';count:number|null;from:string|null;to:string|null;source?:string;reasonCode?:string}}
const kinds:Record<string,string>={tool:'工具',plugin:'插件',mcp:'MCP',dataset:'知识库',skill:'Skill'}
const changes:Record<string,string>={added:'新增',removed:'删除',changed:'变更',unchanged:'保留'}
export function AgentImpactPanel({impact}:{impact:AgentImpact}){
  const dependencies=impact.dependencies.items ?? []
  const current=dependencies.filter(row=>row.change!=='removed')
  const rows=([['当前有效授权数',impact.grants],['当前有效密钥数',impact.keys],['近30天调用数',impact.calls30d]] as const)
  return <fieldset><legend>依赖与影响依据</legend>
    <div className="impact-header-note">采集时间 · {impact.capturedAt}</div>
    <div className="form-grid-3">
      {rows.map(([label,group])=><label key={label}>{label}<input aria-label={label} readOnly value={group.state==='collected'?String(group.count):'未采集'}/></label>)}
    </div>
    {impact.calls30d.state==='collected' && <div className="detail-callout">调用统计窗口 · {impact.calls30d.from} 至 {impact.calls30d.to} · 来源 {impact.calls30d.source}</div>}
    <label className="full-width">未批准或禁止对外资源数<input aria-label="未批准或禁止对外资源数" readOnly value={impact.dependencies.state==='collected'?String(current.filter(row=>!row.approved || !row.externalAllowed).length):'未采集'}/></label>
    <div className="diff-summary">资源差异 · {impact.dependencies.state==='unavailable'?'未采集':dependencies.some(row=>row.change!=='unchanged')?'见下表':'无差异'}</div>
    {dependencies.filter(row=>row.change!=='unchanged').map(row=><div className="diff-item" key={row.kind+':'+row.id}>{changes[row.change]} · {kinds[row.kind]} · {row.name} · {row.id} · {row.approved?'已批准':'未批准'} · {row.externalAllowed?'允许对外':'禁止对外'}</div>)}
    {(['plugin','tool','mcp'] as const).map(kind=><div key={kind}><div className="inventory-title">新{kinds[kind]}清单 · {impact.dependencies.state==='unavailable'?'未采集':current.some(row=>row.kind===kind)?'如下':'无'}</div>{current.filter(row=>row.kind===kind).map(row=><div className="inventory-item" key={row.id}>{row.name} · {row.id} · 配置指纹 {row.fingerprint} · {row.approved?'已批准':'未批准'} · {row.externalAllowed?'允许对外':'禁止对外'}</div>)}</div>)}
  </fieldset>
}
