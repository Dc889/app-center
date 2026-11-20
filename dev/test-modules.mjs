import {readdirSync,existsSync} from 'node:fs'
import {resolve,relative,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),kind=args.shift(),module=args.find(a=>!a.startsWith('--'))
const modules=readdirSync(resolve(root,'management/modules'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name)
if(module && !modules.includes(module)){console.error('Unknown module. Choose: '+modules.join(', '));process.exit(2)}
function walk(dir){if(!existsSync(dir))return [];return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)])}
const dirs=module?[resolve(root,'management/modules',module,'tests')]:[resolve(root,'tests'),resolve(root,'management/modules')]
const browser=kind==='browser'||args.includes('--browser'),files=dirs.flatMap(walk).filter(p=>browser?p.endsWith('-browser.mjs'):p.endsWith('.test.mjs')).sort()
if(!files.length){console.error('No tests found; this is not a successful verification.');process.exit(2)}
if(args.includes('--list')){files.forEach(f=>console.log(relative(root,f)));process.exit(0)}
const run=files=>spawnSync(process.execPath,files,{cwd:root,stdio:'inherit',env:process.env})
if(browser){for(const file of files){console.log('Browser: '+relative(root,file));const result=run([file]);if(result.status!==0)process.exit(result.status ?? 1)}}
else {const result=run(['--test',...files]);process.exit(result.status ?? 1)}
