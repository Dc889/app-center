import { readFileSync } from 'node:fs'
import { check, digest, json, listen, prefix } from '../../../runtime/http.mjs'

export function startPlugin(options) {
  return listen(async (req,res,path) => {
    const base = prefix + '/plugins/document-parser/versions/v2.4.1'
    check(req.method === 'GET' && (path === base || path === base+'/file'),404,'NOT_FOUND')
    const bytes = readFileSync(new URL('./packages/document-parser.txt',import.meta.url))
    if (path === base) return json(res,{resourceId:'document-parser',version:'v2.4.1',sha256:digest(bytes),sizeBytes:bytes.length})
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':bytes.length})
    res.end(bytes)
  },options)
}
