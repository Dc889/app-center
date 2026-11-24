const labels: Record<string,string> = {
  account:'账户名',oldAccount:'原账户名',newAccount:'新账户名',roles:'平台角色',org:'组织',businessLine:'业务线',active:'启用状态',
  ragflowPermission:'RAGFlow 权限',difyRole:'Dify 角色',workspaceId:'工作区',resourceId:'资源',sourceSystem:'来源系统',
  purpose:'申请用途',reason:'申请依据',explanation:'原因说明',name:'名称',description:'功能说明',instructions:'使用说明',
  scenario:'业务场景',classification:'密级',scope:'开放范围',boundaryOrgs:'组织边界',targetOrgs:'目标组织',targetAccounts:'目标人员',
  permission:'使用权限',operation:'操作类型',effectiveAt:'生效时间',expiresAt:'失效时间',startsAt:'开始时间',
  version:'版本',newVersion:'新版本',changeDescription:'变更说明',compatibility:'兼容性',license:'许可证',tags:'标签',
  shareMode:'分享方式',targetAppId:'目标应用',relatedAppId:'关联应用',relatedWorkspaceId:'应用工作区',
  usages:'使用方式',dispositionActions:'处置动作',facts:'事实说明',target:'处置范围',documents:'文档',documentIds:'目标文档',
  callerName:'调用方',callerOrg:'调用组织',environment:'运行环境',allowedCidrs:'允许网段',peakQps:'峰值 QPS',
}
const roles: Record<string,string> = {admin:'系统管理员',operator:'运维人员',user:'用户'}
const scopes: Record<string,string> = {all:'全网段公开',orgs:'指定组织',accounts:'指定人员'}
const usages: Record<string,string> = {run:'运行',embed:'嵌入网站',api:'访问 API'}
function word(value:string,key:string) {
  if (key === 'roles') return roles[value] ?? value
  if (key === 'scope') return scopes[value] ?? value
  if (key === 'usages') return usages[value] ?? value
  return value
}
function format(value:unknown,key:string):string {
  if (value == null || value === '') return '未填写'
  if (typeof value === 'boolean') return key === 'active' ? value ? '启用' : '停用' : value ? '是' : '否'
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? '明细' : word(String(item),key)).join('、') || '未填写'
  return word(String(value),key)
}
export function RecordDetails({title,values}:{title:string;values:unknown}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  const entries = Object.entries(values).filter(([key]) => labels[key] || /[\u3400-\u9fff]/.test(key))
  if (!entries.length) return null
  return <section className="record-details" aria-label={title}><h4>{title}</h4><dl className="record-grid">
    {entries.map(([key,value])=><div key={key}><dt>{labels[key] ?? key}</dt><dd>{value && typeof value === 'object' && !Array.isArray(value)
      ? <details className="record-value-details"><summary>查看明细</summary><details className="technical-details"><summary>详细信息</summary><pre>{JSON.stringify(value,null,2)}</pre></details></details>
      : format(value,key)}</dd></div>)}
  </dl></section>
}
