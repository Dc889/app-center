import {readdirSync,existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),module=process.argv[2]
const names=readdirSync(resolve(root,'capability/modules'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name)
if(module && !names.includes(module)){console.error('Unknown capability module: '+module);process.exit(2)}
function walk(dir){return existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]):[]}
const files=walk(resolve(root,module?'capability/modules/'+module+'/tests':'capability')).filter(f=>f.endsWith('.test.mjs')).sort()
if(!files.length){console.error('No tests in this module; not a passed verification.');process.exit(2)}
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,env:process.env,stdio:'inherit'});process.exit(result.status ?? 1)
