import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {boundaryViolation,checkBoundaries} from '../../dev/check-boundaries.mjs'
import {capabilityBoundaryViolation,checkCapabilityBoundaries} from '../../dev/check-capability-boundaries.mjs'
import {serverModules,executionContextHandlers,executionCandidateHandlers,submissionHandlers,approvalHandlers} from '../../management/app/server/module-registry.mjs'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')

test('模块边界拒绝跨模块私有实现、反向依赖、浏览器服务端混入及管理能力越层',()=>{
  assert.ok(boundaryViolation('management/modules/agents/server/a.mjs','management/modules/knowledge/server/b.mjs'))
  assert.equal(boundaryViolation('management/modules/agents/server/a.mjs','management/modules/knowledge/public.server.mjs'),null)
  assert.ok(boundaryViolation('management/platform/workflow/server/a.mjs','management/modules/agents/public.server.mjs'))
  assert.ok(boundaryViolation('management/modules/agents/web/Page.tsx','management/modules/agents/public.server.mjs'))
  assert.ok(boundaryViolation('management/modules/agents/server/a.mjs','management/app/server/service.mjs'))
  assert.ok(boundaryViolation('management/modules/agents/server/a.mjs','capability/executor/service.mjs'))
  assert.equal(boundaryViolation('management/app/server/service.mjs','management/modules/agents/public.server.mjs'),null)
  checkBoundaries()
})
test('能力模块注册表与 capability/modules 目录完全对齐',async()=>{
  const {capabilityModules}=await import('../../capability/app/modules.mjs')
  const diskModules=readdirSync(resolve(root,'capability/modules'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort()
  const registered=capabilityModules.map(mod=>mod.id).sort()
  assert.deepEqual(registered,diskModules)
})
test('能力模块禁止跨域私有导入、平台反向依赖与管理实现穿透，仓库通过HTTP访问',()=>{
  assert.ok(capabilityBoundaryViolation('capability/modules/keys/handlers/create.mjs','capability/modules/agents/adapters/private.mjs'))
  assert.equal(capabilityBoundaryViolation('capability/modules/keys/handlers/create.mjs','capability/modules/agents/public.mjs'),null)
  assert.ok(capabilityBoundaryViolation('capability/platform/execution/service.mjs','capability/modules/agents/public.mjs'))
  assert.ok(capabilityBoundaryViolation('capability/modules/keys/handlers/create.mjs','management/app/server/service.mjs'))
  assert.ok(capabilityBoundaryViolation('capability/modules/skills/handlers/download.mjs','capability/repositories/skill/public.mjs'))
  assert.equal(capabilityBoundaryViolation('capability/app/modules.mjs','capability/modules/skills/public.mjs'),null)
  checkCapabilityBoundaries()
})

test('服务端模块注册表与 management/modules 目录完全对齐且覆盖已登记扩展点',()=>{
  const diskModules=readdirSync(resolve(root,'management/modules'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort()
  const registered=serverModules.map(mod=>mod.id).sort()
  assert.deepEqual(registered,diskModules)
  for(const type of ['TOL-01','MCP-03','SKL-04','KB-03','KB-05','KEY-02']) {
    assert.equal(typeof executionContextHandlers[type],'function',`missing executionContext handler for ${type}`)
  }
  for(const type of ['KB-03','KB-05']) {
    assert.equal(typeof executionCandidateHandlers[type],'function',`missing executionCandidate handler for ${type}`)
  }
  assert.ok(Object.keys(submissionHandlers).length>=13)
  assert.ok(Object.keys(approvalHandlers).length>=17)
})
