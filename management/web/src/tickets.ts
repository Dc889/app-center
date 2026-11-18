export type TicketResult = {
  ticketNo: string
  ok: boolean
  status?: string
  resultId: string
  failureReason: string
  downloadUrl?: string
}

export async function submitTicket(ticketNo: string, ticketType: string, action: string, resourceId: string, account: string): Promise<TicketResult> {
  const response = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticketNo, ticketType, action, resourceId, account }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message ?? '提交失败')
  return data
}
