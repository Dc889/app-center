// Explicit test data. Production services never import this module.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {ledger, digest} from '../../runtime/http.mjs'

const seedAgents = [
  {
    resourceId: 'app-police-query',
    name: '警情摘要与案情研判助手',
    status: 'active',
    revision: 1,
    appId: 'app-dify-police-01',
    workspaceId: 'ws-default',
    version: 'v1.0.0',
    publicationVersionId: 'pub-police-v1',
    workflowSnapshotId: 'wf-police-snap-1',
    policyRef: 'pol-police-v1',
    scope: 'org',
    targetOrgs: ['业务一部'],
    targetAccounts: [],
    boundaryOrgs: ['业务一部'],
    usages: ['web'],
    ownerAccount: 'chen.yu',
    versions: [{publicationVersionId: 'pub-police-v1', version: 'v1.0.0', workflowSnapshotId: 'wf-police-snap-1', status: 'active'}],
  },
  {
    resourceId: 'app-doc-assistant',
    name: '智能政务公文问答助手',
    status: 'active',
    revision: 1,
    appId: 'app-dify-doc-02',
    workspaceId: 'ws-default',
    version: 'v1.2.0',
    publicationVersionId: 'pub-doc-v1',
    workflowSnapshotId: 'wf-doc-snap-1',
    policyRef: 'pol-doc-v1',
    scope: 'public',
    targetOrgs: [],
    targetAccounts: [],
    boundaryOrgs: [],
    usages: ['web', 'api'],
    ownerAccount: 'zhou.min',
    versions: [{publicationVersionId: 'pub-doc-v1', version: 'v1.2.0', workflowSnapshotId: 'wf-doc-snap-1', status: 'active'}],
  },
]


const seedMcps = [
  {
    resourceId: 'mcp-archive-search',
    name: '档案检索与卷宗服务 MCP',
    status: 'active',
    revision: 1,
    transport: 'sse',
    toolNames: ['search_archive', 'get_archive_detail'],
    urlFingerprint: digest(Buffer.from('http://mcp.internal/archive')),
    bindingAccess: 'approval',
    provider: 'internal-archive',
    ownerAccount: 'zhou.min',
  },
  {
    resourceId: 'mcp-corp-search',
    name: '企业信息与信用核查 MCP',
    status: 'active',
    revision: 1,
    transport: 'stream',
    toolNames: ['query_company', 'verify_credit'],
    urlFingerprint: digest(Buffer.from('http://mcp.internal/corp')),
    bindingAccess: 'instant',
    provider: 'internal-corp',
    ownerAccount: 'zhou.min',
  },
  {
    resourceId: 'mcp-map-service',
    name: '空间地理与地图定位 MCP',
    status: 'active',
    revision: 1,
    transport: 'sse',
    toolNames: ['get_coordinates', 'route_planning'],
    urlFingerprint: digest(Buffer.from('http://mcp.internal/map')),
    bindingAccess: 'approval',
    provider: 'internal-map',
    ownerAccount: 'chen.yu',
  },
]


function seedDocBytes() {
  return readFileSync(new URL('./document-parser.txt', import.meta.url))
}

function buildSeedPlugins() {
  const docBytes = seedDocBytes()
  const docSha = digest(docBytes)
  return [
    {
      resourceId: 'document-parser',
      uniqueIdentifier: 'document-parser',
      name: '文档解析与抽取插件 (Document Parser)',
      status: 'approved',
      revision: 1,
      version: 'v2.4.1',
      sha256: docSha,
      sizeBytes: docBytes.length,
      upgradePolicy: '逐个工单升级',
      installAccess: 'approval',
      versions: [
        {version: 'v2.4.1', sha256: docSha, sizeBytes: docBytes.length, seed: true, status: 'approved'},
      ],
    },
    {
      resourceId: 'web-search-pro',
      uniqueIdentifier: 'web-search-pro',
      name: '联网专业搜索插件 (Web Search Pro)',
      status: 'approved',
      revision: 1,
      version: 'v1.5.0',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 0,
      upgradePolicy: '逐个工单升级',
      installAccess: 'instant',
      versions: [
        {
          version: 'v1.5.0',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          sizeBytes: 0,
          empty: true,
          status: 'approved',
        },
      ],
    },
    {
      resourceId: 'browser-agent',
      uniqueIdentifier: 'browser-agent',
      name: '网页浏览自动化插件 (Browser Agent)',
      status: 'approved',
      revision: 1,
      version: 'v1.2.0',
      sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      sizeBytes: 1,
      upgradePolicy: '逐个工单升级',
      installAccess: 'approval',
      versions: [
        {
          version: 'v1.2.0',
          sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
          sizeBytes: 1,
          empty: true,
          status: 'approved',
        },
      ],
    },
  ]
}


const seedCatalog = [
  {resourceId: 'skl_doc', name: '公文摘要 Skill', version: 'v2.1.0', orgs: [], ownerAccount: 'zhou.min'},
  {resourceId: 'skl_sheet', name: '表格分析 Skill', version: 'v1.8.2', orgs: ['业务一部'], ownerAccount: 'chen.yu'},
]

function seedObject(resourceId) {
  const bytes = readFileSync(new URL('./' + resourceId + '.txt', import.meta.url))
  return {bytes, sha256: digest(bytes), sizeBytes: bytes.length, filename: resourceId + '.txt', contentType: 'text/plain; charset=utf-8'}
}


export function seedRepositoryFixtures(dir) {
  for (const [name, items] of [['agents', seedAgents], ['mcps', seedMcps]]) {
    const db = ledger(dir, name)
    for (const item of items) if (!db.get(item.resourceId)) db.put(item.resourceId, item)
    db.close()
  }
  for (const [name, folder, items] of [
    ['plugin-catalog', 'plugin-objects', buildSeedPlugins()],
    ['skill-catalog', 'skill-objects', seedCatalog.map(seed => {
      const obj = seedObject(seed.resourceId)
      return {...seed, ...obj, status: 'available', revision: 1, versions: [{...obj, version: seed.version, status: 'available'}]}
    })],
  ]) {
    const db = ledger(dir, name)
    mkdirSync(join(dir, folder), {recursive: true})
    for (const item of items) {
      if (db.get(item.resourceId)) continue
      for (const version of item.versions) {
        const bytes = name === 'skill-catalog' ? seedObject(item.resourceId).bytes
          : item.resourceId === 'document-parser' ? seedDocBytes() : Buffer.alloc(item.sizeBytes, 0)
        const blobName = `${item.resourceId}_${version.version}.bin`
        writeFileSync(join(dir, folder, blobName), bytes)
        delete version.seed; delete version.empty; delete version.bytes
        version.blobName = blobName
      }
      delete item.bytes
      db.put(item.resourceId, item)
    }
    db.close()
  }
}
