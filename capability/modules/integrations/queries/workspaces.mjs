import {check, json} from '../../../../runtime/http.mjs'
import {listDifyWorkspaces} from '../adapters/dify-workspaces.mjs'

export async function workspaces({req, res, query}) {
  const params = query ?? new URL(req.url, 'http://localhost').searchParams
  const product = params.get('product')
  check(product === 'dify', 400, 'INVALID_PRODUCT')
  const limitRaw = params.get('limit')
  const limit = limitRaw ? Number(limitRaw) : 50
  check(Number.isInteger(limit) && limit >= 1 && limit <= 100, 400, 'INVALID_QUERY')
  const cursor = params.get('cursor') ?? ''
  const page = await listDifyWorkspaces({cursor, limit})
  return json(res, page)
}
