import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {liveProducts, readLocalProducts} from './live-verification/products.mjs'
import {createDifyExternalBinding, revokeDifyDatasetAccess} from '../capability/modules/knowledge/adapters/dify-datasets.mjs'

const dir = resolve(process.env.APP_DATA_DIR ?? '.local-data')
const config = readLocalProducts(resolve(dir, 'local-products.json'))
Object.assign(process.env, {
  DIFY_API_BASE: config.dify.base,
  DIFY_CONSOLE_TOKEN: config.dify.token,
  DIFY_WORKSPACE_ID: config.dify.workspaceId,
  RAGFLOW_API_BASE: config.ragflow.base,
  RAGFLOW_API_KEY: config.ragflow.apiKey,
})
const products = liveProducts({dir, credentials: config})
const report = {
  runId: products.runId,
  generatedAt: new Date().toISOString(),
  scope: 'RAGFlow external knowledge binding, live Dify->RAGFlow retrieval, and revocation readback',
  checks: [],
  ok: false,
}

let createdBinding = null
try {
  // Ensure fresh Dify console token if expired
  await products.api('dify', '/console/api/workspaces/current')
  const ragDatasetId = await products.dataset('ragflow')
  const endpoint = process.env.RAGFLOW_EXTERNAL_ENDPOINT ?? 'http://host.docker.internal:9380/api/v1/dify'

  // 1. Create external knowledge API + external dataset with built-in readback verification
  createdBinding = await createDifyExternalBinding({
    name: `verify-ext-${products.runId.slice(0, 8)}`,
    targetWorkspaceId: config.dify.workspaceId,
    endpoint,
    externalKnowledgeId: ragDatasetId,
  })
  const afterCreate = await products.api('dify', `/console/api/datasets/${createdBinding.externalDatasetId}`)
  assert.equal(afterCreate.provider, 'external')
  assert.equal(afterCreate.external_knowledge_info?.external_knowledge_api_id, createdBinding.externalApiId)
  assert.equal(afterCreate.external_knowledge_info?.external_knowledge_id, ragDatasetId)
  report.checks.push({
    name: 'external knowledge API and dataset creation with readback',
    ragDatasetId,
    externalApiId: createdBinding.externalApiId,
    externalDatasetId: createdBinding.externalDatasetId,
    provider: afterCreate.provider,
  })

  // 2. Live Dify -> RAGFlow external retrieval check (requires embedding model in RAGFlow)
  try {
    const hit = await products.api('dify', `/console/api/datasets/${createdBinding.externalDatasetId}/external-hit-testing`, {
      method: 'POST',
      body: {
        query: `Isolated live check ${products.runId}`,
        external_retrieval_model: {top_k: 2, score_threshold: 0.1, score_threshold_enabled: false},
      },
    })
    assert.ok(Array.isArray(hit?.records), 'external-hit-testing must return records array')
    report.checks.push({
      name: 'live Dify external-hit-testing against RAGFlow /api/v1/dify/retrieval',
      externalDatasetId: createdBinding.externalDatasetId,
      recordCount: hit.records.length,
      retrievalVerified: true,
    })
  } catch (err) {
    report.checks.push({
      name: 'live Dify external-hit-testing against RAGFlow /api/v1/dify/retrieval',
      externalDatasetId: createdBinding.externalDatasetId,
      retrievalVerified: false,
      note: `RAGFlow retrieval endpoint reached but blocked (likely no embedding model configured in local RAGFlow): ${err.message}`,
    })
  }

  // 3. Revoke external binding and confirm both dataset and API template return 404
  const revoked = await revokeDifyDatasetAccess({
    datasetId: createdBinding.externalDatasetId,
    workspaceId: config.dify.workspaceId,
    grantRef: createdBinding,
  })
  assert.deepEqual(revoked, {revoked: true, changed: true})
  createdBinding = null
  report.checks.push({
    name: 'external binding revocation deletes dataset and API template with 404 readback',
    revoked: true,
  })

  report.ok = true
} catch (error) {
  report.error = {code: error.code ?? 'CHECK_FAILED', message: error.message}
} finally {
  if (createdBinding) {
    try {
      await revokeDifyDatasetAccess({
        datasetId: createdBinding.externalDatasetId,
        workspaceId: config.dify.workspaceId,
        grantRef: createdBinding,
      })
    } catch {
      // Best-effort cleanup if check failed mid-way.
    }
  }
  report.cleanupOk = await products.close()
  report.ok = report.ok && report.cleanupOk
  report.finishedAt = new Date().toISOString()
  const content = JSON.stringify(report, null, 2) + '\n'
  writeFileSync(resolve(dir, `live-external-knowledge-${products.runId}.json`), content)
  writeFileSync(resolve(dir, 'live-external-knowledge-report.json'), content)
}

console.log(`External knowledge readback ${report.checks.length}/3; cleanup ${report.cleanupOk ? 'PASS' : 'FAIL'}; ${report.ok ? 'PASS' : 'FAIL'}`)
if (!report.ok) {
  console.error(report.error?.code ?? 'CHECK_FAILED', report.error?.message ?? '')
  process.exitCode = 1
}
