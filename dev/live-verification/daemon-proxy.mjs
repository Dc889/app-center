import {execFileSync} from 'node:child_process'
import {createServer} from 'node:net'
import {writeFileSync, unlinkSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {check} from '../../runtime/http.mjs'

const docker = args => execFileSync('docker', args, {windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})

// Local test transport only. Production can supply a stable daemon URL/key on its private network.
export async function startLocalDaemonProxy({dir, difyBase}) {
  check(['localhost', '127.0.0.1', '[::1]'].includes(new URL(difyBase).hostname), 501, 'LOCAL_DAEMON_ONLY')
  const info = JSON.parse(docker(['inspect', 'dify171-plugin_daemon-1']))[0]
  const nginx = JSON.parse(docker(['inspect', 'dify171-nginx-1']))[0]
  const env = Object.fromEntries(info.Config.Env.map(item => {const i = item.indexOf('='); return [item.slice(0, i), item.slice(i + 1)]}))
  const network = Object.keys(info.NetworkSettings.Networks).find(name => Object.hasOwn(nginx.NetworkSettings.Networks, name))
  check(network && env.SERVER_KEY, 501, 'DAEMON_CONFIG_MISSING')
  const runId = randomUUID(), name = `capfin-daemon-${runId.slice(0, 8)}`
  const reservation = createServer()
  await new Promise((done, fail) => {reservation.once('error', fail); reservation.listen(0, '127.0.0.1', done)})
  const port = reservation.address().port
  await new Promise(done => reservation.close(done))
  const config = resolve(dir, `${name}.conf`), journal = resolve(dir, `${name}.json`)
  const status = {runId, name, port, created: false, closed: false}
  const save = () => writeFileSync(journal, JSON.stringify(status, null, 2) + '\n')
  writeFileSync(config, `server { listen 8080; location / { proxy_pass http://dify171-plugin_daemon-1:${env.SERVER_PORT || '5002'}; proxy_http_version 1.1; proxy_read_timeout 180s; } }\n`)
  let closed = false
  async function close() {
    if (closed) return
    if (status.created) {
      const current = JSON.parse(docker(['inspect', name]))[0]
      check(current.Config.Labels['appcenter.capfin.run'] === runId, 409, 'PROXY_OWNERSHIP_MISMATCH')
      docker(['rm', '--force', name])
    }
    closed = true; status.closed = true; save(); unlinkSync(config)
  }
  try {
    docker(['run', '--detach', '--rm', '--name', name, '--label', `appcenter.capfin.run=${runId}`, '--network', network,
      '--publish', `127.0.0.1:${port}:8080`, '--mount', `type=bind,source=${config},target=/etc/nginx/conf.d/default.conf,readonly`, '--pull=never', nginx.Image])
    status.created = true; save()
    const base = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 15000
    for (;;) {
      try {const response = await fetch(base + '/health/check', {signal: AbortSignal.timeout(1000)}); if (response.ok) break} catch {}
      check(Date.now() < deadline, 503, 'DAEMON_PROXY_NOT_READY')
      await new Promise(done => setTimeout(done, 200))
    }
    return {base, token: env.SERVER_KEY, close, runId}
  } catch (error) {await close(); throw error}
}
