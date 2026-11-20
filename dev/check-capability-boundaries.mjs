import {readdirSync,readFileSync,existsSync} from 'node:fs'
import {resolve,dirname,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export function capabilityBoundaryViolation(from,to) {
  if(from.includes('/tests/') || from.startsWith('tests/'))return null
  if(to.startsWith('management/'))return '能力组件不得导入管理系统实现，回调使用HTTP契约'
  if(from.startsWith('capability/platform/') && (to.startsWith('capability/modules/') || to.startsWith('capability/app/') || to.startsWith('capability/repositories/')))return '平台依赖通过注入，不得反向引用业务或仓库'
  const unit=p=>/^capability\/(modules|platform|repositories)\/([^/]+)/.exec(p)?.[0]
  if(from.startsWith('capability/modules/') && to.startsWith('capability/app/'))return '业务模块不得导入应用装配'
  if(unit(to) && unit(from)!==unit(to) && !to.endsWith('/public.mjs'))return '跨目录必须使用public.mjs'
  if(from.startsWith('capability/modules/') && to.startsWith('capability/repositories/'))return '业务执行经仓库HTTP接口，不得导入仓库服务'
  if(from.startsWith('capability/repositories/') && (to.startsWith('capability/modules/') || to.startsWith('capability/app/')))return '仓库不依赖业务执行与装配'
  return null
}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)])}
export function checkCapabilityBoundaries() {
  const failures=[],files=walk(resolve(root,'capability')).filter(f=>f.endsWith('.mjs')),edges=new Map()
  const moduleNames=readdirSync(resolve(root,'capability/modules'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name)
  for(const name of moduleNames)for(const required of ['public.mjs','README.md','handlers','adapters','queries','tests'])if(!existsSync(resolve(root,'capability/modules',name,required)))failures.push(`${name}: missing ${required}`)
  for(const file of files) {
    const from=relative(root,file).replaceAll('\\','/'),source=readFileSync(file,'utf8')
    for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.[^'"\r\n]+)\1/g)) {
      const target=resolve(dirname(file),match[2]),to=relative(root,target).replaceAll('\\','/')
      if(!existsSync(target))failures.push(`${from}: unresolved ${match[2]}`)
      const error=capabilityBoundaryViolation(from,to);if(error)failures.push(`${from} -> ${to}: ${error}`)
      if(!from.includes('/tests/')){const a=/^capability\/modules\/([^/]+)/.exec(from)?.[1],b=/^capability\/modules\/([^/]+)/.exec(to)?.[1];if(a&&b&&a!==b){if(!edges.has(a))edges.set(a,new Set());edges.get(a).add(b)}}
    }
  }
  function visit(id,path=[]){if(path.includes(id)){failures.push('Capability module cycle: '+[...path,id].join(' -> '));return}for(const next of edges.get(id) ?? [])visit(next,[...path,id])}
  for(const id of edges.keys())visit(id)
  if(failures.length)throw Error(failures.join('\n'))
  console.log(`PASS capability boundaries: ${files.length} files, ${moduleNames.length} modules`)
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))checkCapabilityBoundaries()
