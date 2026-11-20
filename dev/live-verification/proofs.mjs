import {mkdirSync, writeFileSync, renameSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {check} from '../../runtime/http.mjs'

const branchKey = item => JSON.stringify([item.ticketType, item.ticketTypeVersion ?? '1', item.action, item.variant ?? null])
const globalTypes = new Set(['SKL-01', 'SKL-02', 'SKL-03', 'SKL-04', 'PLG-01', 'PLG-02', 'MCP-01', 'MCP-03'])
export const proofScope = (ticketType, workspaceId) => globalTypes.has(ticketType) ? null : workspaceId

export function createProofJournal({dir, modules, workspaceId, resourceRunId = null, now = () => new Date().toISOString()}) {
  check(typeof workspaceId === 'string' && workspaceId, 400, 'MISSING_WORKSPACE')
  const runId = randomUUID(), createdAt = now(), rows = new Map(), checks = []
  for (const module of modules) for (const spec of module.actions ?? []) for (const variant of spec.variants) {
    const row = {ticketType: spec.ticketType, ticketTypeVersion: spec.ticketTypeVersion, action: spec.action, variant,
      workspaceId: proofScope(spec.ticketType, workspaceId), state: 'unverified', reasonCode: 'NOT_RUN', checkedAt: createdAt}
    check(!rows.has(branchKey(row)), 500, 'DUPLICATE_PROOF_BRANCH')
    rows.set(branchKey(row), row)
  }
  mkdirSync(dir, {recursive: true})
  function save() {
    const evidence = [...rows.values()]
    const summary = {generatedAt: now(), runId, resourceRunId, workspaceId, total: evidence.length,
      verified: evidence.filter(row => row.state === 'verified').length, report: checks}
    // The report is durable before eligibility is published. Every check replaces one branch only.
    for (const [name, data] of [[`live-verification-${runId}.json`, summary], ['live-verification-report.json', summary], ['capability-evidence.json', evidence]]) {
      const tmp = join(dir, `${name}.${runId}.tmp`)
      writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
      renameSync(tmp, join(dir, name))
    }
    return summary
  }
  function record(meta, {ok = false, reasonCode = 'CHECK_FAILED', detail = '', witnesses = []} = {}) {
    if (meta.ticketType === 'EVT-01') {
      checks.push({...meta, ok, detail, witnesses, checkedAt: now(), scope: 'manual lifecycle; no execution capability'})
      return save()
    }
    const row = rows.get(branchKey(meta))
    check(row, 400, 'UNKNOWN_PROOF_BRANCH')
    check(meta.workspaceId === row.workspaceId, 400, 'WRONG_PROOF_WORKSPACE')
    const validWitnesses = Array.isArray(witnesses) && witnesses.length > 0 && witnesses.every(item =>
      item && typeof item.source === 'string' && item.source && typeof item.resourceId === 'string' && item.resourceId &&
      typeof item.assertion === 'string' && item.assertion && item.passed === true)
    const verified = ok && validWitnesses
    Object.assign(row, {state: verified ? 'verified' : 'unverified',
      reasonCode: verified ? 'LIVE_STATE_READBACK_PASSED' : ok ? 'MISSING_STATE_READBACK' : reasonCode, checkedAt: now()})
    checks.push({...row, ok: verified, detail, witnesses})
    return save()
  }
  function invalidate(reasonCode) {
    for (const row of rows.values()) Object.assign(row, {state: 'unverified', reasonCode, checkedAt: now()})
    return save()
  }
  save()
  return {runId, record, save, invalidate, evidence: () => structuredClone([...rows.values()])}
}
