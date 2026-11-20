import assert from 'node:assert/strict'
import {readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {liveProducts} from './live-verification/products.mjs'
import {listDifyMembers, listRagflowUsers, buildBaselineFact} from '../capability/modules/accounts/adapters/account-products.mjs'

// Read-only protocol guards, deliberately NOT execution evidence for ACC-01/02.
const dir = resolve(process.env.APP_DATA_DIR ?? '.local-data')
const credentials = JSON.parse(readFileSync(resolve(dir, 'local-products.json'), 'utf8'))
const {dify, ragflow} = credentials
Object.assign(process.env, {DIFY_API_BASE: dify.base, DIFY_CONSOLE_TOKEN: dify.token, DIFY_WORKSPACE_ID: dify.workspaceId,
  RAGFLOW_API_BASE: ragflow.base, RAGFLOW_API_KEY: ragflow.apiKey})
delete process.env.DIFY_ACCOUNT_IDENTITY_MAP
delete process.env.RAGFLOW_ACCOUNT_IDENTITY_MAP
const products = liveProducts({dir, credentials})
const checks = []
const current = await products.api('dify', '/console/api/workspaces/current')
assert.equal(current.id, dify.workspaceId)
const members = await listDifyMembers(dify.workspaceId)
assert.ok(members.length)
checks.push({name: 'Dify native GET current workspace + complete member list', passed: true, count: members.length})
await assert.rejects(() => listDifyMembers('not-the-configured-workspace'), {code: 'ACCESS_DENIED'})
checks.push({name: 'Wrong workspace rejected before treating members as target facts', passed: true})
assert.ok(members.every(row => row.account === null))
assert.throws(() => buildBaselineFact({difyAccount: members[0], workspaceId: dify.workspaceId}), {code: 'INCOMPLETE_ACCOUNT_FACTS'})
checks.push({name: 'Display name/email not fabricated into canonical account or recovery baseline', passed: true})
let ragRejection
await assert.rejects(() => listRagflowUsers(), error => {
  ragRejection = {code: error.code, status: error.status}
  return ['UPSTREAM_UNSUPPORTED', 'UPSTREAM_BUSINESS_ERROR'].includes(error.code)
})
checks.push({name: 'Stock RAGFlow global user-admin query is unavailable, never an empty success', passed: true, rejection: ragRejection})

function inspect(container, files) {
  const script = "import json,hashlib,pathlib; files=" + JSON.stringify(files) + "; print(json.dumps([{'file':p,'sha256':hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()} for p in files]))"
  return JSON.parse(execFileSync('docker', ['exec', container, 'python', '-c', script], {encoding: 'utf8', windowsHide: true}))
}
const sourceFiles = {dify: inspect('dify171-api-1', ['/app/api/controllers/console/workspace/members.py', '/app/api/controllers/console/workspace/account.py']),
  ragflow: inspect('ragflow-ragflow-cpu-1', ['/ragflow/api/apps/tenant_app.py', '/ragflow/api/apps/user_app.py'])}
const report = {checkedAt: new Date().toISOString(), scope: 'read-only account protocol guards; no account execution acceptance',
  versions: {dify: '1.7.1', ragflow: '0.22.1'}, checks, sourceFiles, accountWriteRequests: 0, deploymentActionsVerified: 0,
  limitations: ['Canonical platform account name versus product login email is not yet defined.',
    'Dify role changes use PUT update-role; invitations create pending members and send email, not active-account provisioning.',
    'RAGFlow dataset API keys are not console user sessions; stock team membership and current-user settings are not global user CRUD.',
    'Two ACC branches remain unverified.']}
writeFileSync(resolve(dir, 'live-account-protocol-report.json'), JSON.stringify(report, null, 2) + '\n')
await products.close()
console.log(`Account protocol guards ${checks.length}/${checks.length}; account writes 0; ACC execution branches verified 0.`)
