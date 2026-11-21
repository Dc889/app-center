import {readdirSync,readFileSync,existsSync} from 'node:fs'
import {resolve,relative,dirname,extname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const portable=p=>p.replaceAll('\\','/')
export function boundaryViolation(from,to) {
  const f=portable(from),t=portable(to),a=/^management\/(modules|platform)\/([^/]+)/.exec(f),b=/^management\/(modules|platform)\/([^/]+)/.exec(t)
  if(f.includes('/tests/') || f.startsWith('tests/'))return null
  if((f.includes('/web/') || f.startsWith('management/shared-ui/') || f.endsWith('/public.web.ts')) &&
    (t.includes('/server/') || t.endsWith('/public.server.mjs') || t.startsWith('runtime/') || t.startsWith('capability/')))return '浏览器禁止依赖服务端实现'
  if(f.startsWith('management/platform/') && (t.startsWith('management/modules/') || t.startsWith('management/app/')))return '公共基础禁止反向依赖业务或应用装配'
  if(f.startsWith('management/shared-ui/') && (t.startsWith('management/modules/') || t.startsWith('management/app/')))return '公共控件禁止依赖业务或应用装配'
  if(f.startsWith('management/modules/') && t.startsWith('management/app/'))return '业务模块禁止依赖应用装配'
  if(b && (!a || a[0]!==b[0]) && !/^public\.(server\.mjs|web\.ts)$/.test(t.split('/').at(-1)))return '跨模块只能使用 public.server/public.web 入口'
  if(t.startsWith('management/api/') || t.startsWith('management/web/src/'))return '旧目录已停用'
  if(f.startsWith('management/') && (t.startsWith('capability/') || t.startsWith('connectors/')))return '管理系统只能通过能力接口调用，不可导入能力实现或连接器'
  return null
}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)])}
function checkModuleStructure(failures) {
  const modulesDir=resolve(root,'management/modules')
  const moduleNames=readdirSync(modulesDir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort()
  const required=['README.md','public.server.mjs','public.web.ts','web','server','tests']
  for(const name of moduleNames) {
    const dir=resolve(modulesDir,name)
    for(const item of required) {
      if(!existsSync(resolve(dir,item)))failures.push(`management/modules/${name}: 缺少必需结构 ${item}`)
    }
    const serverPub=resolve(dir,'public.server.mjs')
    if(existsSync(serverPub) && !/\bexport\s+const\s+moduleServer\b/.test(readFileSync(serverPub,'utf8'))) {
      failures.push(`management/modules/${name}/public.server.mjs: 缺少导出 moduleServer 描述符`)
    }
    const webPub=resolve(dir,'public.web.ts')
    if(existsSync(webPub) && !/\bexport\s+const\s+moduleWeb\b/.test(readFileSync(webPub,'utf8'))) {
      failures.push(`management/modules/${name}/public.web.ts: 缺少导出 moduleWeb 描述符`)
    }
  }
  return moduleNames
}
export function checkBoundaries() {
  const failures=[],edges=new Map(),files=walk(resolve(root,'management')).filter(p=>['.mjs','.ts','.tsx'].includes(extname(p)))
  const moduleNames=checkModuleStructure(failures)
  for(const file of files){
    const from=portable(relative(root,file)),source=readFileSync(file,'utf8')
    const refs=[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.[^'"\r\n]+)\1/g)].map(m=>m[2])
    for(const ref of refs){const base=resolve(dirname(file),ref),target=['','.ts','.tsx','.mjs','.json','.css'].map(e=>base+e).find(existsSync)
      if(!target){failures.push(`${from}: unresolved ${ref}`);continue}
      const to=portable(relative(root,target)),error=boundaryViolation(from,to)
      if(error)failures.push(`${from} -> ${to}: ${error}`)
      if(!from.includes('/tests/')){const a=/^management\/modules\/([^/]+)/.exec(from)?.[1],b=/^management\/modules\/([^/]+)/.exec(to)?.[1];if(a&&b&&a!==b){if(!edges.has(a))edges.set(a,new Set());edges.get(a).add(b)}}
    }
  }
  function visit(node,trail=[]){if(trail.includes(node)){failures.push('模块循环依赖: '+[...trail,node].join(' -> '));return}for(const to of edges.get(node) ?? [])visit(to,[...trail,node])}
  for(const node of edges.keys())visit(node)
  if(failures.length)throw Error(failures.join('\n'))
  console.log(`PASS boundaries: ${files.length} files, ${moduleNames.length} modules; structure, manifests, public entry points, browser/server separation, dependency direction and module cycles`)
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))checkBoundaries()
