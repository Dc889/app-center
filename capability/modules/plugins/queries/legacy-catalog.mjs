import {json} from '../../../../runtime/http.mjs'

// Existing sample directory responses; production discovery is still a separate acceptance item.
export async function listCatalog({res,query}) {
const q=(query.get('q') ?? '').trim().toLowerCase(),workspaceId=query.get('workspaceId');


        const plugins = [

          {

            resourceId: 'document-parser',

            name: '文档解析与抽取插件 (Document Parser)',

            status: 'approved',

            actions: ['install'],

            data: {

              version: 'v2.4.1',

              sha256: '8d531a547622d26892fe15fbad1cddfc62163cbacc7822da985ab1c18aaed2c5',

              uniqueIdentifier: 'document-parser:v2.4.1',

              installed: workspaceId === 'ws-default',

              installationId: workspaceId === 'ws-default' ? 'inst-doc-01' : '',

            },

          },

          {

            resourceId: 'web-search-pro',

            name: '联网专业搜索插件 (Web Search Pro)',

            status: 'approved',

            actions: ['install'],

            data: {

              version: 'v1.5.0',

              sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',

              uniqueIdentifier: 'web-search-pro:v1.5.0',

              installed: false,

            },

          },

          {

            resourceId: 'browser-agent',

            name: '网页浏览自动化插件 (Browser Agent)',

            status: 'approved',

            actions: ['install'],

            data: {

              version: 'v1.2.0',

              sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',

              uniqueIdentifier: 'browser-agent:v1.2.0',

              installed: false,

            },

          },

        ]

        const matched = q ? plugins.filter(p => (p.name + p.resourceId).toLowerCase().includes(q)) : plugins

        return json(res, { items: matched, nextCursor: null })

      
}
export async function catalogItem({res,plugin,resourceId}) {



        if (resourceId === 'document-parser') {

          const info = await (await plugin('/plugins/document-parser/versions/v2.4.1')).json()

          return json(res, { resourceId: info.resourceId, name: '文档解析与抽取插件 (Document Parser)', status: 'approved', actions: ['install'], data: info })

        }

        return json(res, {

          resourceId,

          name: resourceId,

          status: 'approved',

          actions: ['install'],

          data: { version: 'v1.0.0', sha256: '8d531a547622d26892fe15fbad1cddfc62163cbacc7822da985ab1c18aaed2c5', uniqueIdentifier: `${resourceId}:v1.0.0` },

        })

      
}
