import {spawn, execFileSync} from 'node:child_process'
import {mkdir, writeFile, readFile} from 'node:fs/promises'
import {resolve, basename} from 'node:path'

const root = resolve('.')
const output = resolve('.local-data/ui-browser')
await mkdir(output, {recursive: true})
let files = execFileSync(process.execPath, ['dev/test-modules.mjs', 'browser', '--list'], {encoding: 'utf8', windowsHide: true})
  .trim().split(/\r?\n/).filter(Boolean)
if (process.env.UI_BROWSER_RETRY === '1') {
  const previous = JSON.parse(await readFile(resolve(output, 'report.json'), 'utf8'))
  files = previous.results.filter(row => row.code !== 0).map(row => row.file)
}
const selected = process.env.UI_BROWSER_FILTER
if (selected) files = files.filter(file => file.includes(selected))
const results = process.env.UI_BROWSER_RETRY === '1' ? JSON.parse(await readFile(resolve(output, 'report.json'), 'utf8')).results : []
const total = process.env.UI_BROWSER_RETRY === '1' ? results.length : files.length
const remaining = [...files]
let saveQueue = Promise.resolve()
const save = () => {
  const snapshot = JSON.stringify({checkedAt: new Date().toISOString(), total, completed: results.length, results}, null, 2) + '\n'
  saveQueue = saveQueue.then(() => writeFile(resolve(output, 'report.json'), snapshot))
  return saveQueue
}
async function worker() {
  while (remaining.length) {
    const file = remaining.shift(), started = Date.now(), chunks = []
    const code = await new Promise(done => {
      const child = spawn(process.execPath, [file], {cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe']})
      child.stdout.on('data', data => chunks.push(data)); child.stderr.on('data', data => chunks.push(data))
      const timer = setTimeout(() => child.kill(), 180000)
      child.once('error', () => {clearTimeout(timer); done(-1)})
      child.once('close', code => {clearTimeout(timer); done(code ?? -1)})
    })
    await writeFile(resolve(output, basename(file) + '.log'), Buffer.concat(chunks))
    const next = {file, code, durationMs: Date.now() - started}
    const previous = results.findIndex(row => row.file === file)
    if (previous >= 0) results[previous] = next; else results.push(next)
    await save()
    console.log(`[${code === 0 ? 'PASS' : 'FAIL'}] ${file}`)
  }
}
await Promise.all([worker(), worker()])
console.log(JSON.stringify({total: results.length, passed: results.filter(row => row.code === 0).length, failed: results.filter(row => row.code !== 0).length}))
if (results.some(row => row.code !== 0)) process.exitCode = 1
