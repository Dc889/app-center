import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {localStack} from '../../../dev/services.mjs'
import {resolveProductOwner} from '../../platform/dify/public.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {listCatalog as pluginList, catalogItem as pluginItem} from '../../modules/plugins/queries/catalog.mjs'
import {listCatalog as mcpList} from '../../modules/mcp/queries/catalog.mjs'
import {listCatalog as agentList} from '../../modules/agents/queries/catalog.mjs'
import {listDifyApps, readDifyApp} from '../../modules/agents/adapters/agent-store.mjs'
import {listWorkspaceTools} from '../../modules/tools/adapters/tool-store.mjs'
import {getAllRegistrations, findRegistration} from '../../modules/mcp/adapters/mcp-store.mjs'
import {listDifyDatasets} from '../../modules/knowledge/adapters/dify-datasets.mjs'
import {listRagflowDatasets, getRagflowDatasetDetail} from '../../modules/knowledge/adapters/ragflow-datasets.mjs'
import {listDifyWorkspaces} from '../../modules/integrations/adapters/dify-workspaces.mjs'
import {fetchAllModels} from '../../modules/integrations/adapters/dify-models.mjs'
import {createDifyApiKey} from '../../modules/keys/adapters/createDifyApiKey.mjs'
import {normalizeDocument} from '../../modules/knowledge/adapters/knowledge-store.mjs'
import {listen, json} from '../../../runtime/http.mjs'

function environment(t, values) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}
const capture = result => ({writeHead() {}, end(value) { result.value = JSON.parse(value) }})

test('未配置上游时，非严格模式也不返回演示工作区、模型、应用、工具或知识库', async t => {
  environment(t, Object.fromEntries(['DIFY_API_BASE', 'DIFY_API_URL', 'DIFY_CONSOLE_TOKEN', 'DIFY_API_KEY', 'RAGFLOW_API_BASE', 'RAGFLOW_API_URL', 'RAGFLOW_API_KEY', 'CAPABILITY_STRICT_UPSTREAM'].map(key => [key, undefined])))
  for (const read of [listDifyApps, listWorkspaceTools.bind(null, {}), listDifyDatasets, listRagflowDatasets, listDifyWorkspaces, fetchAllModels]) {
    await assert.rejects(read, error => error.status === 501)
  }
  assert.deepEqual(getAllRegistrations(), [])
  assert.equal(findRegistration(null, 'mcp-archive-reg'), null)
})

test('仓库缺失、故障或列表格式错误必须报错，真实空列表保持为空', async () => {
  for (const [list, name] of [[pluginList, 'plugin'], [mcpList, 'mcp'], [agentList, 'agent']]) {
    const params = {query: new URLSearchParams(), res: {}}
    const client = data => async () => ({json: async () => data})
    const withClient = fn => ({...params, [name]: fn, clients: {[name]: fn}})
    await assert.rejects(() => list(params), error => error.code === 'REPOSITORY_UNCONFIGURED')
    await assert.rejects(() => list(withClient(client({}))), error => error.status === 502)
    const outage = Object.assign(new Error('unavailable'), {status: 503, code: 'REPOSITORY_UNCONFIGURED'})
    await assert.rejects(() => list(withClient(async () => {throw outage})), error => error === outage)
    const result = {}
    await list({...withClient(client({items: []})), res: capture(result)})
    assert.deepEqual(result.value.items, [])
  }
  const paths = []
  await assert.rejects(() => pluginItem({resourceId: 'document-parser', plugin: async path => {
    paths.push(path)
    throw Object.assign(new Error('missing'), {status: 404})
  }}), error => error.status === 404)
  assert.deepEqual(paths, ['/plugins/document-parser'])
})

test('没有实际安装或绑定台账时不补造安装ID、绑定ID或智能体访问权限', async () => {
  const result = {}
  const empty = () => ({all: () => [], get: () => null})
  await pluginList({query: new URLSearchParams('workspaceId=ws-default'), res: capture(result), openLedger: empty,
    plugin: async () => ({json: async () => ({items: [{resourceId: 'document-parser', status: 'approved'}]})})})
  assert.equal(result.value.items[0].data.installed, false)
  assert.equal(result.value.items[0].data.installationId, '')
  await mcpList({query: new URLSearchParams('workspaceId=ws-default'), res: capture(result), openLedger: empty,
    clients: {mcp: async () => ({json: async () => ({items: [{resourceId: 'mcp-corp-search', status: 'active'}]})})}})
  assert.equal(result.value.items[0].data.bound, false)
  assert.equal(result.value.items[0].data.bindingId, '')
  await agentList({query: new URLSearchParams(), res: capture(result),
    clients: {agent: async () => ({json: async () => ({items: [{resourceId: 'agent-a', status: 'active'}]})})}})
  assert.equal(result.value.items[0].data.scope, null)
  assert.deepEqual(result.value.items[0].data.usages, [])
  assert.deepEqual(result.value.items[0].actions, ['view'])
})

test('Dify 应用分页读取并保留真实版本，旧台账不能覆盖上游现状或补回已删除资源', async t => {
  const server = await listen((req, res, path) => {
    if (path === '/console/api/apps') {
      const page = new URL(req.url, 'http://localhost').searchParams.get('page')
      return json(res, {data: page === '1' ? [{id: 'a', name: 'Current A', workspace_id: 'real-ws'}] : [{id: 'b', name: 'B', workspace_id: 'real-ws'}], has_more: page === '1'})
    }
    return json(res, {id: 'a', mode: 'workflow', workflow: {id: 'real-workflow-id'}, enable_site: true})
  })
  t.after(() => server.close())
  environment(t, {DIFY_API_BASE: server.url, DIFY_CONSOLE_TOKEN: 'test', DIFY_WORKSPACE_ID: 'real-ws'})
  const stale = {all: () => [{resourceId: 'deleted', name: 'Old'}], get: () => ({name: 'Stale A', revision: 2})}
  const apps = await listDifyApps({workspaceId: 'real-ws', openLedger: () => stale})
  assert.deepEqual(apps.map(a => a.resourceId), ['a', 'b'])
  assert.equal(apps[0].name, 'Current A')
  assert.equal(apps[0].publicationVersionId, null)
  assert.equal(apps[0].workflowSnapshotId, null)
  assert.deepEqual(await listDifyApps({workspaceId: 'different-ws'}), [])
  const detail = await readDifyApp('a', 'real-ws')
  assert.equal(detail.publicationVersionId, 'real-workflow-id')
  assert.equal(detail.workflowSnapshotId, 'real-workflow-id')
})

test('Dify 创建密钥缺少真实ID或正文时拒绝伪造成功，缺少应用ID不发起写请求', async t => {
  let response = {}, calls = 0
  const server = await listen((req, res) => {calls++; return json(res, response)})
  t.after(() => server.close())
  environment(t, {DIFY_API_BASE: server.url, DIFY_CONSOLE_TOKEN: 'test'})
  await assert.rejects(() => createDifyApiKey({}), error => error.status === 400)
  assert.equal(calls, 0)
  for (const invalid of [{token: 'real-token'}, {id: 'real-id'}, null, {id: 'real-id', token: 1234}]) {
    response = invalid
    await assert.rejects(() => createDifyApiKey({resourceId: 'app-a'}), error => error.status === 502)
  }
})

test('RAGFlow 查询不存在的ID不能拿第一条资源替代，鉴权失败不能换端点重试', async t => {
  let status = 200
  const paths = []
  const server = await listen((req, res, path) => {paths.push(path); return json(res, {code: 0, data: [{id: 'other'}]}, status)})
  t.after(() => server.close())
  environment(t, {RAGFLOW_API_BASE: server.url, RAGFLOW_API_KEY: 'test'})
  await assert.rejects(() => getRagflowDatasetDetail('missing'), error => error.status === 404)
  assert.deepEqual(paths, ['/api/v1/datasets'])
  status = 401
  await assert.rejects(() => getRagflowDatasetDetail('missing'), error => error.status === 401)
  assert.equal(paths.length, 2)
  assert.equal(normalizeDocument({id: 'doc', status: '0'}).disabled, true)
})


test('新数据目录四个仓库均为空，未登记的样例ID返回404', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cap-fin-01-empty-'))
  const stack = await localStack(dir, 'empty-test', false)
  t.after(async () => {await stack.close(); await rm(dir, {recursive: true, force: true})})
  for (const [service, kind, oldId] of [['agent', 'agents', 'app-police-query'], ['mcp', 'mcps', 'mcp-corp-search'], ['plugin', 'plugins', 'document-parser'], ['skill', 'skills', 'skl_doc']]) {
    const headers = {authorization: 'Bearer empty-test'}
    const list = await fetch(`${stack[service]}/internal/v1/${kind}`, {headers})
    assert.equal(list.status, 200)
    assert.deepEqual((await list.json()).items, [])
    assert.equal((await fetch(`${stack[service]}/internal/v1/${kind}/${oldId}`, {headers})).status, 404)
  }
})

test('产品所有者只使用真实身份或显式逐项映射，不能由统一默认账号冒充', t => {
  environment(t, {DIFY_DEFAULT_OWNER_ACCOUNT: 'requester', DIFY_OWNER_ACCOUNT_MAP: JSON.stringify({'real-owner-uuid': 'mapped.owner'})})
  assert.equal(resolveProductOwner(['real-owner-uuid']), 'mapped.owner')
  assert.equal(resolveProductOwner(['unmapped-uuid']), 'unmapped-uuid')
  assert.equal(resolveProductOwner([]), '')
})
