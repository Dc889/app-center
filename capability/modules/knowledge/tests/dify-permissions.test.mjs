import test from 'node:test'
import assert from 'node:assert/strict'
import {listen, json, body} from '../../../../runtime/http.mjs'
import {grantDifySameWorkspaceAccess, revokeDifyDatasetAccess, copyDifyDatasetCrossWorkspace} from '../adapters/dify-datasets.mjs'

async function setup(t) {
  let dataset = {id: 'ds-real', name: 'Keep name', description: 'Keep description', provider: 'vendor', permission: 'partial_members',
    partial_member_list: ['member-existing'], retrieval_model_dict: {search_method: 'hybrid_search', top_k: 7, reranking_enable: true}}
  const writes = []
  let ignoreWrites = false
  const server = await listen(async (req, res, path) => {
    if (path === '/console/api/workspaces/current/members') return json(res, {accounts: [
      {id: 'member-new', email: 'new@test.invalid', status: 'active'},
      {id: 'member-existing', email: 'existing@test.invalid', status: 'active'},
    ]})
    assert.equal(path, '/console/api/datasets/ds-real')
    if (req.method === 'PATCH') {
      const payload = await body(req); writes.push(payload)
      assert.ok(!Object.hasOwn(payload, 'name') && !Object.hasOwn(payload, 'description'))
      assert.deepEqual(payload.retrieval_model, dataset.retrieval_model_dict)
      if (!ignoreWrites) dataset = {...dataset, permission: payload.permission,
        partial_member_list: payload.partial_member_list.map(item => item.user_id)}
    }
    return json(res, dataset)
  })
  const values = {DIFY_API_BASE: server.url, DIFY_CONSOLE_TOKEN: 'test', DIFY_WORKSPACE_ID: 'real-ws',
    DIFY_OWNER_ACCOUNT_MAP: JSON.stringify({'member-new': 'new.user', 'member-existing': 'existing.user'})}
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(async () => {
    await server.close()
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  return {writes, get dataset() {return dataset}, set dataset(value) {dataset = value}, ignore() {ignoreWrites = true}}
}
const command = {datasetId: 'ds-real', workspaceId: 'real-ws', granteeAccount: 'new.user', permission: '检索使用'}

test('原生指定成员授权保留原成员和检索配置；撤销只移除本次新增对象', async t => {
  const app = await setup(t)
  const grant = await grantDifySameWorkspaceAccess(command)
  assert.deepEqual(app.dataset.partial_member_list, ['member-existing', 'member-new'])
  assert.deepEqual(grant.addedMemberIds, ['member-new'])
  assert.equal(app.writes[0].permission, 'partial_members')
  await revokeDifyDatasetAccess({...command, grantRef: grant})
  assert.deepEqual(app.dataset.partial_member_list, ['member-existing'])
  assert.equal(app.dataset.permission, 'partial_members')
  assert.equal(app.writes.length, 2)
})

test('既有指定成员或工作区共享访问不归本次绑定所有，撤销不能收走旧权限', async t => {
  const app = await setup(t)
  for (const permission of ['partial_members', 'all_team_members']) {
    app.dataset = {...app.dataset, permission}
    const grant = await grantDifySameWorkspaceAccess({...command, granteeAccount: 'existing.user'})
    assert.deepEqual(grant.addedMemberIds, [])
    await revokeDifyDatasetAccess({...command, grantRef: grant})
    assert.equal(app.writes.length, 0)
  }
})

test('移除最后一个本次成员恢复only_me；产品范围外部改变时不能覆盖成更窄范围', async t => {
  const app = await setup(t)
  app.dataset = {...app.dataset, permission: 'only_me', partial_member_list: []}
  const grant = await grantDifySameWorkspaceAccess(command)
  await revokeDifyDatasetAccess({...command, grantRef: grant})
  assert.equal(app.dataset.permission, 'only_me')
  assert.deepEqual(app.dataset.partial_member_list, [])
  app.dataset = {...app.dataset, permission: 'all_team_members'}
  await assert.rejects(() => revokeDifyDatasetAccess({...command, grantRef: grant}), error => error.code === 'PERMISSION_SCOPE_CHANGED')
  assert.equal(app.writes.length, 2)
})

test('缺少成员映射、错误工作区、应用编排与跨区复制在任何写入之前拒绝', async t => {
  const app = await setup(t)
  await assert.rejects(() => grantDifySameWorkspaceAccess({...command, granteeAccount: 'unknown.user'}), error => error.code === 'DIFY_GRANTEE_UNRESOLVED')
  await assert.rejects(() => grantDifySameWorkspaceAccess({...command, workspaceId: 'other-ws'}), error => error.status === 501)
  await assert.rejects(() => grantDifySameWorkspaceAccess({...command, permission: '编排绑定', targetAppId: 'app-a'}), error => error.status === 501)
  await assert.rejects(() => copyDifyDatasetCrossWorkspace({targetWorkspaceId: 'other-ws'}), error => error.status === 501)
  await assert.rejects(() => revokeDifyDatasetAccess(command), error => error.status === 501)
  assert.equal(app.writes.length, 0)
})

test('HTTP成功但产品未实际写入权限时失败，不登记虚假授权成功', async t => {
  const app = await setup(t); app.ignore()
  await assert.rejects(() => grantDifySameWorkspaceAccess(command), error => error.code === 'PERMISSION_READBACK_FAILED')
  assert.deepEqual(app.dataset.partial_member_list, ['member-existing'])
})
