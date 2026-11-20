// CAP-FIN-01: isolated live write/readback checks; never emits deployment eligibility evidence.
import assert from 'node:assert/strict'
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createDifyApiKey} from '../capability/modules/keys/public.mjs'
import {disableDifyDocument, getDifyDatasetDetail} from '../capability/modules/knowledge/adapters/dify-datasets.mjs'
import {disableRagflowDocument, getRagflowDatasetDetail} from '../capability/modules/knowledge/adapters/ragflow-datasets.mjs'

const dir = resolve(process.env.APP_DATA_DIR ?? '.local-data')
const products = JSON.parse(readFileSync(resolve(dir, 'local-products.json'), 'utf8'))
Object.assign(process.env, {
  DIFY_API_BASE: products.dify.base, DIFY_CONSOLE_TOKEN: products.dify.token,
  DIFY_WORKSPACE_ID: products.dify.workspaceId,
  RAGFLOW_API_BASE: products.ragflow.base, RAGFLOW_API_KEY: products.ragflow.apiKey,
  RAGFLOW_TENANT_ID: products.ragflow.tenantId,
})
const runId = `cap-fin-01-${randomUUID()}`
const report = {runId, generatedAt: new Date().toISOString(), scope: 'isolated adapter writes; not full work-order acceptance', checks: [], resources: [], cleanup: [], ok: false}
const file = resolve(dir, 'cap-fin-01-live-report.json')
mkdirSync(dir, {recursive: true})
const save = () => {
  const content = JSON.stringify(report, null, 2) + '\n'
  writeFileSync(file, content)
  writeFileSync(resolve(dir, `${runId}.json`), content)
}
const check = (name, fn) => fn().then(() => {report.checks.push({name, ok: true}); save(); console.log(`PASS ${name}`)})
async function api(product, path, {method = 'GET', body} = {}) {
  const config = products[product]
  const response = await fetch(config.base + path, {
    method, headers: {authorization: `Bearer ${product === 'dify' ? config.token : config.apiKey}`,
      ...(body && !(body instanceof FormData) ? {'content-type': 'application/json'} : {})},
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || (product === 'ragflow' && data?.code !== 0)) {
    // Avoid upstream text: it may include credentials or document content.
    throw Object.assign(new Error(`${product} ${method} ${path.split('?')[0]} HTTP ${response.status}; business code ${typeof data?.code === 'number' ? data.code : 'n/a'}`), {status: response.status})
  }
  return data
}
const created = (product, kind, id, parentId) => {
  assert.equal(typeof id, 'string')
  assert.ok(id)
  const item = {product, kind, id, ...(parentId ? {parentId} : {})}
  report.resources.push(item); save()
  return item
}
const form = () => {const f = new FormData(); f.append('file', new Blob(['CAP-FIN-01 isolated protocol verification.\nNo business records.'], {type: 'text/plain'}), `${runId}.txt`); return f}
let difyDataset, ragDataset, key
try {
  await check('Dify create dataset and upload document', async () => {
    const ds = await api('dify', '/console/api/datasets', {method: 'POST', body: {name: runId.slice(0, 40), indexing_technique: 'economy'}})
    difyDataset = created('dify', 'dataset', ds.id)
    const upload = form(); upload.append('source', 'datasets')
    const f = await api('dify', '/console/api/files/upload', {method: 'POST', body: upload})
    created('dify', 'upload', f.id, ds.id)
    const docs = await api('dify', `/console/api/datasets/${ds.id}/documents`, {method: 'POST', body: {
      indexing_technique: 'economy', doc_form: 'text_model',
      data_source: {info_list: {data_source_type: 'upload_file', file_info_list: {file_ids: [f.id]}}},
      process_rule: {mode: 'automatic'},
    }})
    created('dify', 'document', docs.documents?.[0]?.id, ds.id)
  })
  await check('Dify batch disable, enable and readback', async () => {
    const doc = report.resources.find(r => r.product === 'dify' && r.kind === 'document')
    const deadline = Date.now() + 45000
    for (;;) {
      const docs = await api('dify', `/console/api/datasets/${difyDataset.id}/documents`)
      const state = docs.data.find(d => d.id === doc.id)
      if (!['waiting', 'parsing', 'cleaning', 'splitting', 'indexing'].includes(state?.indexing_status)) break
      if (Date.now() >= deadline) throw new Error('Dify document indexing did not settle within 45s')
      await new Promise(r => setTimeout(r, 500))
    }
    await disableDifyDocument({datasetId: difyDataset.id, documentId: doc.id, workspaceId: products.dify.workspaceId})
    let detail = await getDifyDatasetDetail(difyDataset.id, products.dify.workspaceId)
    assert.equal(detail.documents.find(d => d.documentId === doc.id)?.disabled, true)
    await api('dify', `/console/api/datasets/${difyDataset.id}/documents/status/enable/batch?document_id=${doc.id}`, {method: 'PATCH'})
    detail = await getDifyDatasetDetail(difyDataset.id, products.dify.workspaceId)
    assert.equal(detail.documents.find(d => d.documentId === doc.id)?.disabled, false)
  })
  await check('Dify create real API key and revoke only newly created key', async () => {
    const apps = await api('dify', '/console/api/apps?page=1&limit=100')
    assert.ok(apps.data[0]?.id)
    const appId = apps.data[0].id
    const createdKey = await createDifyApiKey({resourceId: appId})
    key = created('dify', 'key', createdKey.keyId, appId)
    assert.equal(createdKey.lastFour, createdKey.secret.slice(-4))
    const before = await api('dify', `/console/api/apps/${appId}/api-keys`)
    assert.ok(before.data.some(k => k.id === key.id))
    await api('dify', `/console/api/apps/${appId}/api-keys/${key.id}`, {method: 'DELETE'})
    const after = await api('dify', `/console/api/apps/${appId}/api-keys`)
    assert.ok(!after.data.some(k => k.id === key.id))
    report.cleanup.push({product: 'dify', kind: 'key', id: key.id, verifiedAbsent: true}); key = null; save()
  })
  await check('RAGFlow create dataset and upload document', async () => {
    const result = await api('ragflow', '/api/v1/datasets', {method: 'POST', body: {name: runId}})
    ragDataset = created('ragflow', 'dataset', result.data.id)
    const docs = await api('ragflow', `/api/v1/datasets/${ragDataset.id}/documents`, {method: 'POST', body: form()})
    created('ragflow', 'document', docs.data[0]?.id, ragDataset.id)
  })
  await check('RAGFlow enabled=false, enabled=true and readback', async () => {
    const doc = report.resources.find(r => r.product === 'ragflow' && r.kind === 'document')
    await disableRagflowDocument({datasetId: ragDataset.id, documentId: doc.id})
    let detail = await getRagflowDatasetDetail(ragDataset.id)
    assert.equal(detail.documents.find(d => d.documentId === doc.id)?.disabled, true)
    await api('ragflow', `/api/v1/datasets/${ragDataset.id}/documents/${doc.id}`, {method: 'PUT', body: {enabled: true}})
    detail = await getRagflowDatasetDetail(ragDataset.id)
    assert.equal(detail.documents.find(d => d.documentId === doc.id)?.disabled, false)
  })
  report.ok = true
} catch (error) {
  report.error = error.code === 'ERR_ASSERTION' ? 'Live readback assertion failed' : error.message
  console.error(report.error)
} finally {
  for (const resource of [key, ragDataset, difyDataset].filter(Boolean)) {
    try {
      if (resource.kind === 'key') {
        await api('dify', `/console/api/apps/${resource.parentId}/api-keys/${resource.id}`, {method: 'DELETE'})
        const keys = await api('dify', `/console/api/apps/${resource.parentId}/api-keys`)
        assert.ok(!keys.data.some(k => k.id === resource.id))
      } else if (resource.product === 'dify') {
        await api('dify', `/console/api/datasets/${resource.id}`, {method: 'DELETE'})
        await assert.rejects(() => api('dify', `/console/api/datasets/${resource.id}`), error => error.status === 404)
      } else {
        await api('ragflow', '/api/v1/datasets', {method: 'DELETE', body: {ids: [resource.id]}})
        let page = 1
        for (;;) {
          const found = await api('ragflow', `/api/v1/datasets?page=${page}&page_size=100`)
          assert.ok(!found.data.some(ds => ds.id === resource.id))
          if (found.data.length < 100) break
          assert.ok(page++ < 10000)
        }
      }
      report.cleanup.push({...resource, verifiedAbsent: true})
    } catch {
      report.ok = false
      report.cleanup.push({...resource, verifiedAbsent: false})
    }
    save()
  }
  report.finishedAt = new Date().toISOString(); save()
}
console.log(`Live checks ${report.checks.length}/5; cleanup ${report.cleanup.filter(c => c.verifiedAbsent).length}/${report.cleanup.length}; ${report.ok ? 'PASS' : 'FAIL'}`)
if (!report.ok) process.exitCode = 1
