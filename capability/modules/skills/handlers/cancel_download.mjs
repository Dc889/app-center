export async function cancel(context) {
  const {state, row, skill, clients, stamp} = context
  const delivery = row.reservation ?? state.delivery
  let cancelledAt = stamp()

  if (delivery?.resultId) {
    if (clients?.management) {
      try {
        await clients.management('/delivery-checks/' + encodeURIComponent(delivery.resultId) + '/close', 'POST', {})
      } catch (err) {
        if (err.code !== 'REPOSITORY_UNCONFIGURED') throw err
      }
    }
    const confirmed = await (
      await skill('/deliveries/' + encodeURIComponent(delivery.resultId) + '/cancel', 'POST', {})
    ).json()
    cancelledAt = confirmed.cancelledAt ?? cancelledAt
  }

  state.status = 'cancelled'
  state.delivery = null
  state.result = {
    ok: false,
    failureCode: 'CANCELLED_BEFORE_DELIVERY',
    failureReason: '文件交付前已取消',
    retryable: false,
    resultId: '',
    version: '',
    sha256: '',
    details: {
      cancelledAt,
      cancelledResultId: delivery?.resultId ?? null,
      version: delivery?.version ?? null,
      sha256: delivery?.sha256 ?? null,
    },
  }
}
