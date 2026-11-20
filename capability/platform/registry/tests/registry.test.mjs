import test from 'node:test'
import assert from 'node:assert/strict'
import {createRegistry} from '../public.mjs'

const action = {ticketType: 'TEST-01', ticketTypeVersion: '1', action: 'run', variants: [null], execute: async () => {}}
const actions = {'TEST-01': ['run']}
const module = {id: 'test', actions: [action]}
const now = Date.parse('2026-11-20T00:00:00Z')
const proof = {...action, workspaceId: 'ws', variant: null, state: 'verified', reasonCode: 'DEPLOYMENT_CHECKED', checkedAt: new Date(now).toISOString()}

function registry(modules = [module], proofs = []) {
  return createRegistry(modules, {actions, now: () => now, evidence: () => proofs})
}

test('同一登记驱动执行和能力查询，代码存在不冒充部署核验，工作区与版本严格匹配', () => {
  const r = registry()
  assert.equal(r.capabilities('ws').items[0].state, 'unverified')
  assert.equal(r.handler(action), action.execute)
  assert.equal(r.handler({...action, ticketTypeVersion: '2'}), null)
  const verified = registry([module], [proof])
  assert.equal(verified.capabilities('ws').items[0].state, 'verified')
  assert.equal(verified.capabilities('other').items[0].state, 'unverified')
  assert.equal(verified.capabilities().items[0].state, 'unverified')
  assert.equal(registry([module], [{...proof, ticketTypeVersion: '2'}]).capabilities('ws').items[0].state, 'unverified')
})

test('重复模块/处理器/提供方/路由、未登记动作和无人负责的契约在启动时拒绝', () => {
  for (const modules of [
    [module, module],
    [module, {...module, id: 'another'}],
    [{id: 'empty', actions: []}],
    [{id: 'bad', actions: [{...action, action: 'unknown'}]}],
  ]) {
    assert.throws(() => registry(modules))
  }
  for (const [name, value] of [
    ['resources', {kind: () => []}],
    ['catalogs', {kind: {list: () => {}}}],
  ]) {
    assert.throws(() => registry([{...module, [name]: value}, {id: 'other', [name]: value}]))
  }
  const route = {method: 'GET', path: '/internal/v1/same', handle: () => {}}
  assert.throws(() => registry([{...module, routes: [route]}, {id: 'other', routes: [route]}]), e => e.code === 'DUPLICATE_ROUTE')
  // 动态路由参数名不同但形态相同也必须视为冲突
  assert.throws(
    () =>
      registry([
        {...module, routes: [{method: 'POST', path: '/internal/v1/items/:id/reveal', handle: () => {}}]},
        {id: 'other', routes: [{method: 'POST', path: '/internal/v1/items/:itemId/reveal', handle: () => {}}]},
      ]),
    e => e.code === 'DUPLICATE_ROUTE',
  )
  for (const reserved of [
    '/internal/v1/capabilities',
    '/internal/v1/resources/dify_app/:id',
    '/internal/v1/catalog/skill/:id',
    '/internal/v1/executions',
    '/internal/v1/executions/:id',
    '/internal/v1/executions/:id/cancel',
    '/internal/v1/downloads/:id',
  ]) {
    assert.throws(() => registry([{...module, routes: [{...route, path: reserved}]}]), e => e.code === 'RESERVED_ROUTE')
  }
})

test('动态路由参数解析与执行只读子资源放行', () => {
  const reveal = () => {}
  const consistency = () => {}
  const r = registry([
    {
      ...module,
      routes: [
        {method: 'POST', path: '/internal/v1/key-registrations/:registrationId/reveal', handle: reveal},
        {method: 'GET', path: '/internal/v1/executions/:executionId/account-consistency', handle: consistency},
      ],
    },
  ])
  const m1 = r.matchRoute('POST', '/internal/v1/key-registrations/reg%2D1/reveal')
  assert.equal(m1.handle, reveal)
  assert.deepEqual(m1.params, {registrationId: 'reg-1'})
  assert.equal(m1.moduleId, 'test')

  const m2 = r.matchRoute('GET', '/internal/v1/executions/exec-99/account-consistency')
  assert.equal(m2.handle, consistency)
  assert.deepEqual(m2.params, {executionId: 'exec-99'})
  assert.equal(r.matchRoute('POST', '/internal/v1/executions/exec-99/account-consistency'), null)
})

test('部署证据冲突返回503；不完整实现和无处理器不能被证据提升为verified', () => {
  assert.throws(() => registry([module], [proof, proof]).capabilities('ws'), e => e.status === 503 && e.code === 'AMBIGUOUS_EVIDENCE')
  const missing = registry([{...module, actions: [{...action, execute: undefined}]}], [proof])
  assert.equal(missing.capabilities('ws').items[0].reasonCode, 'NO_HANDLER')
  assert.equal(missing.handler(action), null)
  const incomplete = registry([{...module, actions: [{...action, ready: false}]}], [proof])
  assert.equal(incomplete.capabilities('ws').items[0].reasonCode, 'IMPLEMENTATION_INCOMPLETE')
  assert.equal(incomplete.handler(action), null)
  assert.equal(registry([module], [{...proof, checkedAt: '2099-01-01T00:00:00Z'}]).capabilities('ws').items[0].state, 'unverified')
})

test('三种KB绑定分支独立核验，生产模块包含全部契约动作、EVT无执行动作且无证据不自称verified', async () => {
  const r = registry([{...module, actions: [{...action, variants: ['a', 'b', 'c']}]}], [{...proof, variant: 'b'}])
  assert.deepEqual(
    r.capabilities('ws').items.map(x => x.state),
    ['unverified', 'verified', 'unverified'],
  )
  const {registry: actual} = await import('../../../app/modules.mjs')
  const items = actual.capabilities().items
  assert.equal(items.filter(i => i.ticketType === 'KB-03').length, 3)
  assert.ok(!items.some(i => i.ticketType === 'EVT-01'))
  assert.equal(items.find(i => i.action === 'download').state, 'unverified')
  assert.ok(items.every(i => ['unverified', 'unsupported'].includes(i.state)))
})
