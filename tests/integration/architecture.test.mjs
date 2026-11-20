import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {boundaryViolation,checkBoundaries} from '../../dev/check-boundaries.mjs'
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
