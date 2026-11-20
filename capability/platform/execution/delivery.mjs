import {body, check, json} from '../../../runtime/http.mjs'

export async function handleDownloadRoute({req, res, path, store, skill}) {
  const download = /^\/internal\/v1\/downloads\/(DL-([\w-]+))(\/receipt)?$/.exec(path)
  if (!download) return false
  const row = store.get(download[2])
  check(
    (row && row.reservation?.resultId === download[1]) || (row && row.state.delivery?.resultId === download[1]),
    404,
    'NOT_FOUND',
  )
  check(
    row.command.account === req.headers['x-account'] &&
      row.command.org === decodeURIComponent(req.headers['x-org'] ?? ''),
    404,
    'NOT_FOUND',
  )
  if (!download[3] && req.method === 'GET') {
    const file = await skill('/deliveries/' + download[1] + '/file')
    for (const k of ['content-length', 'content-type', 'content-disposition', 'x-content-sha256']) {
      res.setHeader(k, file.headers.get(k))
    }
    res.end(Buffer.from(await file.arrayBuffer()))
    return true
  }
  check(req.method === 'PUT' && download[3], 405, 'METHOD_NOT_ALLOWED')
  const receipt = await body(req)
  const confirmed = await (await skill('/deliveries/' + download[1] + '/receipt', 'PUT', receipt)).json()
  const delivery = row.reservation ?? row.state.delivery
  row.reservation = delivery
  row.state = {
    ...row.state,
    status: 'succeeded',
    delivery: null,
    updatedAt: confirmed.deliveredAt,
    result: {
      ok: true,
      failureCode: '',
      failureReason: '',
      retryable: false,
      resultId: delivery.resultId,
      version: delivery.version,
      sha256: delivery.sha256,
      details: {deliveredAt: confirmed.deliveredAt},
    },
  }
  store.put(row.command.executionId, row)
  json(res, row.state)
  return true
}
