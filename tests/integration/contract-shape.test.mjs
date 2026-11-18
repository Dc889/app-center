import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localStack } from '../../dev/services.mjs'

const hash = '656085df494bea2c4bec3c08e164ff66927cd3373abbc3b6e1e5451ffcf0a1e1'

function hasKeys(value, keys) {
  for (const key of keys) assert.equal(Object.hasOwn(value, key), true, '缺少 ' + key)
}

test('运行结果符合两份已接通的 OpenAPI', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'app-center-contract-'))
  const stack = await localStack(dir)
  t.after(async () => { await stack.close(); await rm(dir, { recursive: true, force: true }) })
  const auth = { authorization: 'Bearer ' + stack.token, 'content-type': 'application/json' }
  const owner = { ...auth, 'x-account': 'chen.yu', 'x-org': encodeURIComponent('业务一部') }

  const skills = await (await fetch(stack.skill + '/internal/v1/skills', { headers: auth })).json()
  hasKeys(skills, ['items', 'nextCursor'])
  hasKeys(skills.items[0], ['resourceId', 'name', 'version', 'orgs', 'sha256', 'sizeBytes', 'status', 'revision'])

  const reserved = await fetch(stack.skill + '/internal/v1/deliveries', {
    method: 'POST',
    headers: { ...auth, 'idempotency-key': 'shape:reserve' },
    body: JSON.stringify({ executionId: 'shape-1', resourceId: 'skl_doc', account: 'chen.yu', org: '业务一部', version: 'v2.1.0', sha256: hash }),
  })
  assert.equal(reserved.status, 200)
  const delivery = await reserved.json()
  hasKeys(delivery, ['resultId', 'version', 'sha256', 'filename', 'contentType', 'sizeBytes'])

  const created = await fetch(stack.executor + '/internal/v1/executions', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      executionId: 'shape-exec', ticketNo: 'SKL-03-shape', ticketType: 'SKL-03', ticketTypeVersion: '1',
      action: 'download', resourceId: 'skl_doc', account: 'chen.yu', org: '业务一部',
      payload: { version: 'v2.1.0', sha256: hash },
    }),
  })
  assert.equal(created.status, 202)
  const state = await created.json()
  hasKeys(state, ['executionId', 'ticketNo', 'status', 'updatedAt'])
  assert.equal(state.status, 'awaiting_delivery')
  hasKeys(state.delivery, ['resultId', 'version', 'sha256', 'filename', 'contentType', 'sizeBytes'])

  const catalog = await (await fetch(stack.executor + '/internal/v1/catalog?kind=skill', { headers: owner })).json()
  hasKeys(catalog, ['items', 'nextCursor'])
  hasKeys(catalog.items[0], ['resourceId', 'name', 'status', 'actions', 'data'])
  hasKeys(catalog.items[0].data, ['version', 'sha256', 'sizeBytes'])

  const file = await fetch(stack.executor + '/internal/v1/downloads/' + state.delivery.resultId, { headers: owner })
  assert.equal(file.status, 200)
  assert.equal(typeof file.headers.get('x-content-sha256'), 'string')
  await file.arrayBuffer()

  const done = await fetch(stack.executor + '/internal/v1/downloads/' + state.delivery.resultId + '/receipt', {
    method: 'PUT',
    headers: owner,
    body: JSON.stringify({ sha256: hash, bytesSent: 99 }),
  })
  assert.equal(done.status, 200)
  const finished = await done.json()
  hasKeys(finished.result, ['ok', 'failureCode', 'failureReason', 'retryable', 'resultId', 'version', 'sha256'])
  assert.equal(finished.status, 'succeeded')
})
