import assert from 'node:assert/strict'
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {gzipSync} from 'node:zlib'

// Own only objects created by this invocation. The journal survives interruption.
export function liveProducts({dir, credentials}) {
  const runId = randomUUID(), resources = [], cleanup = [], prefix = `verify-${runId.slice(0, 8)}`
  const file = join(dir, `live-resources-${runId}.json`)
  mkdirSync(dir, {recursive: true})
  const save = () => writeFileSync(file, JSON.stringify({runId, resources, cleanup}, null, 2) + '\n')
  let refreshed = false
  async function api(product, path, {method = 'GET', body} = {}) {
    const cfg = credentials[product]
    const res = await fetch(cfg.base + path, {method, headers: {authorization: `Bearer ${product === 'dify' ? cfg.token : cfg.apiKey}`,
      ...(body && !(body instanceof FormData) ? {'content-type': 'application/json'} : {})},
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000)})
    const data = await res.json().catch(() => null)
    if (product === 'dify' && res.status === 401 && !refreshed && cfg.email && cfg.password) {
      refreshed = true
      const login = await fetch(cfg.base + '/console/api/login', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({email: cfg.email, password: cfg.password, remember_me: true}), signal: AbortSignal.timeout(15000)})
      const result = await login.json().catch(() => null)
      if (!login.ok || result?.result !== 'success' || typeof result?.data?.access_token !== 'string') throw new Error('Dify local verification login failed')
      cfg.token = result.data.access_token
      process.env.DIFY_CONSOLE_TOKEN = cfg.token
      return api(product, path, {method, body})
    }
    if (!res.ok || product === 'ragflow' && data?.code !== 0) {
      throw Object.assign(new Error(`${product} ${method} ${path.split('?')[0]} HTTP ${res.status}; business ${typeof data?.code === 'number' ? data.code : 'n/a'}`), {status: res.status})
    }
    return data
  }
  function own(product, kind, id) {
    assert.ok(typeof id === 'string' && id)
    resources.push({product, kind, id}); save(); return id
  }
  async function app() {
    const created = await api('dify', '/console/api/apps', {method: 'POST', body: {name: `${prefix}-${resources.length}`, mode: 'workflow', icon_type: 'emoji', icon: '🧪', icon_background: '#E4FBCC'}})
    own('dify', 'app', created.id)
    const graph = {
      nodes: [
        {id: 'start', type: 'custom', position: {x: 0, y: 0}, data: {type: 'start', title: 'Start', variables: [{variable: 'query', label: 'Query', type: 'text-input', required: true, max_length: 256}]}},
        {id: 'end', type: 'custom', position: {x: 300, y: 0}, data: {type: 'end', title: 'End', outputs: [{variable: 'result', value_selector: ['start', 'query']}]}},
      ], edges: [{id: 'start-end', source: 'start', sourceHandle: 'source', target: 'end', targetHandle: 'target', type: 'custom'}],
    }
    await api('dify', `/console/api/apps/${created.id}/workflows/draft`, {method: 'POST', body: {graph, features: {}, environment_variables: [], conversation_variables: []}})
    await api('dify', `/console/api/apps/${created.id}/workflows/publish`, {method: 'POST', body: {}})
    await api('dify', `/console/api/apps/${created.id}/site-enable`, {method: 'POST', body: {enable_site: false}})
    const detail = await api('dify', `/console/api/apps/${created.id}`)
    assert.ok(detail.workflow?.id)
    return detail
  }
  async function addDifyDocument(datasetId, suffix = 'initial') {
    assert.ok(resources.some(r => r.product === 'dify' && r.kind === 'dataset' && r.id === datasetId))
    const form = new FormData()
    form.append('file', new Blob([`Isolated live verification ${runId} ${suffix}.`], {type: 'text/plain'}), `${prefix}-${suffix}.txt`)
    form.append('source', 'datasets')
    const file = await api('dify', '/console/api/files/upload', {method: 'POST', body: form})
    const docs = await api('dify', `/console/api/datasets/${datasetId}/documents`, {method: 'POST', body: {
      indexing_technique: 'economy', doc_form: 'text_model', data_source: {info_list: {data_source_type: 'upload_file', file_info_list: {file_ids: [file.id]}}}, process_rule: {mode: 'automatic'},
    }})
    assert.ok(docs.documents?.[0]?.id)
    const deadline = Date.now() + 45000
    for (;;) {
      const found = await api('dify', `/console/api/datasets/${datasetId}/documents`)
      const doc = found.data.find(item => item.id === docs.documents[0].id)
      if (doc?.indexing_status === 'completed') return doc
      if (doc?.indexing_status === 'error' || Date.now() > deadline) throw new Error('Isolated Dify document indexing failed')
      await new Promise(resolve => setTimeout(resolve, 400))
    }
  }
  async function dataset(product) {
    const ds = await api(product, product === 'dify' ? '/console/api/datasets' : '/api/v1/datasets', {method: 'POST', body: {name: `${prefix}-${resources.length}`, ...(product === 'dify' ? {indexing_technique: 'economy'} : {})}})
    const id = own(product, 'dataset', product === 'dify' ? ds.id : ds.data.id)
    if (product === 'dify') await addDifyDocument(id)
    else {
      const form = new FormData(); form.append('file', new Blob([`Isolated live check ${runId}`], {type: 'text/plain'}), `${prefix}.txt`)
      await api(product, `/api/v1/datasets/${id}/documents`, {method: 'POST', body: form})
    }
    return id
  }
  async function close() {
    for (const item of [...resources].reverse()) {
      try {
        if (item.product === 'dify') {
          if (item.kind === 'app') {
            const keys = await api('dify', `/console/api/apps/${item.id}/api-keys`)
            for (const key of keys.data) await api('dify', `/console/api/apps/${item.id}/api-keys/${key.id}`, {method: 'DELETE'})
          }
          const path = `/console/api/${item.kind === 'app' ? 'apps' : 'datasets'}/${item.id}`
          await api('dify', path, {method: 'DELETE'})
          await assert.rejects(() => api('dify', path), error => error.status === 404)
        } else {
          await api('ragflow', '/api/v1/datasets', {method: 'DELETE', body: {ids: [item.id]}})
          for (let page = 1;;page++) {
            const list = await api('ragflow', `/api/v1/datasets?page=${page}&page_size=100`)
            assert.ok(!list.data.some(row => row.id === item.id))
            if (list.data.length < 100) break
            assert.ok(page < 10000)
          }
        }
        cleanup.push({...item, ok: true})
      } catch {cleanup.push({...item, ok: false})}
      save()
    }
    return cleanup.every(row => row.ok)
  }
  save()
  return {api, own, app, dataset, addDifyDocument, close, runId, resources: () => structuredClone(resources)}
}

export function readLocalProducts(file) {return JSON.parse(readFileSync(file, 'utf8'))}


// A deterministic, valid tar.gz containing a real SKILL.md, not a renamed text file.
export function skillArchive(version) {
  const content = Buffer.from(`---\nname: live-skill\ndescription: Isolated verification\n---\n# Live Skill v${version}\n`)
  const header = Buffer.alloc(512)
  header.write('SKILL.md', 0)
  header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116)
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124)
  header.write('00000000000\0', 136); header.fill(32, 148, 156)
  header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
  return gzipSync(Buffer.concat([header, content, Buffer.alloc((512 - content.length % 512) % 512 + 1024)]))
}
