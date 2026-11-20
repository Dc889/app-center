import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,createWriteStream} from 'node:fs'
import {resolve,relative,dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn,execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),out=resolve(root,'验收记录',id)
const retestIndex=process.argv.indexOf('--retest'),retestId=retestIndex>=0?process.argv[retestIndex+1]:null
if(retestIndex>=0 && (!retestId || !/^[0-9TZ-]+-[a-f0-9]{8}$/.test(retestId)))throw Error('Invalid retest batch ID')
const previous=retestId?JSON.parse(readFileSync(resolve(root,'验收记录',retestId,'report.json'),'utf8')):null
mkdirSync(out,{recursive:true})
const originalEnv=process.env,env={...originalEnv}
const isolatedKeys=Object.keys(env).filter(k=>/^(DIFY_|RAGFLOW_|CAPABILITY_|SKILL_URL$|PLUGIN_URL$|INTERNAL_TOKEN$|APP_DATA_DIR$|PORT$|NODE_OPTIONS$)/.test(k))
for(const key of isolatedKeys)delete env[key]
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim()
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&!p.startsWith('验收记录/')&&existsSync(join(root,p))).sort()
const manifest=Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]))
writeFileSync(join(out,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n')
const report={id,startedAt:new Date().toISOString(),status:'running',scope:'isolated_local; production not accessed',commit:git('rev-parse','HEAD'),dirty:git('status','--porcelain').length>0,sourceDigest:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),sourceFileCount:files.length,environment:{node:process.version,platform:process.platform,credentials:'product/service environment variables removed from child processes; no credential values retained'},steps:[]}
if(retestId)report.retestOf=retestId
const save=()=>{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');writeFileSync(join(out,'运行状态.md'),`# 工单验收运行状态\n\n批次：${id}\n\n范围：隔离本地服务与模拟对端测试，未访问正式产品。\n\n状态：${report.status}；已结束步骤：${report.steps.filter(s=>s.finishedAt).length}/${report.steps.length}\n\n`+report.steps.map(s=>`- ${s.status}：${s.name}（${s.log}）`).join('\n')+'\n')}
save();console.log('Acceptance output:',out)
async function run(name,args,kind) {
  const index=report.steps.length+1,log=String(index).padStart(2,'0')+'-'+name.replace(/[^a-zA-Z0-9_-]/g,'_')+'.log',entry={name,kind,command:[process.execPath,...args],status:'running',startedAt:new Date().toISOString(),log}
  report.steps.push(entry);save();console.log('RUN',name)
  const stream=createWriteStream(join(out,log)),start=Date.now()
  await new Promise(done=>{const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill()},180000)
    child.stdout.on('data',b=>stream.write(b));child.stderr.on('data',b=>stream.write(b));child.once('error',e=>stream.write(e.message));child.once('close',(code,signal)=>{clearTimeout(timer);stream.end(()=>{entry.finishedAt=new Date().toISOString();entry.durationMs=Date.now()-start;entry.exitCode=code;entry.signal=signal;entry.status=code===0&&!timedOut?'passed':timedOut?'timed_out':'failed';if(kind==='integration'){const logText=readFileSync(join(out,log),'utf8');entry.tests=Number(/^# tests (\d+)$/m.exec(logText)?.[1]??0);entry.passed=Number(/^# pass (\d+)$/m.exec(logText)?.[1]??0);entry.failed=Number(/^# fail (\d+)$/m.exec(logText)?.[1]??0);if(!entry.tests||entry.tests!==entry.passed||entry.failed)entry.status='failed'}save();console.log(entry.status.toUpperCase(),name);done()})})})
}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)])}
const npmCli=process.env.npm_execpath
if(!npmCli)throw Error('Run using npm run accept:work-orders')
try {
  await run('baseline-checks',[npmCli,'run','check'],'integration')
  await run('live-skill-and-event',['dev/acceptance-live.mjs',out],'live-local')
  let browserFiles=[...walk(join(root,'management/modules')),...walk(join(root,'tests'))].filter(p=>p.endsWith('-browser.mjs')).sort()
  if(previous){const failed=new Set(previous.steps.filter(s=>s.kind==='browser-scenario'&&s.status!=='passed').map(s=>s.name));browserFiles=browserFiles.filter(file=>file.replaceAll('\\','/').includes('/management/modules/agents/tests/browser/')||['draft-forms-browser.mjs','form-check-browser.mjs'].includes(file.split(/[\\/]/).at(-1))||failed.has('browser-'+file.split(/[\\/]/).at(-1).replace('.mjs','')));report.browserScope='Failed scenarios, all agents module browser scenarios, draft forms and form checks; full baseline and local live chain repeated';save()}
  for(const file of browserFiles)await run('browser-'+file.split(/[\\/]/).at(-1).replace('.mjs',''),[relative(root,file)],'browser-scenario')
  report.status=report.steps.every(s=>s.status==='passed')?'regression_passed_full_acceptance_pending':'regression_failed_full_acceptance_pending'
}catch(e){report.status='runner_failed';report.error=e.message;process.exitCode=1}finally{report.finishedAt=new Date().toISOString();save();console.log('Acceptance evidence saved:',out);if(report.steps.some(s=>s.status!=='passed'))process.exitCode=1}
