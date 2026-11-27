import {useState} from 'react'
import {Clock3} from 'lucide-react'

function openPendingDialog(dialog: HTMLDialogElement | null) {
  dialog?.showModal()
}

export function useConfigTicketSubmission(
  ticketType: 'CFG-01' | 'CFG-02' | 'CFG-03',
  setNotice: (message: string) => void,
  setBusy: (busy: boolean) => void,
) {
  const [pendingMessage, setPendingMessage] = useState('')

  async function submitTicket(reason: string, payload: Record<string, unknown>): Promise<string | undefined> {
    setBusy(true)
    try {
      const res = await fetch('/api/config-tickets', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ticketType, reason, payload}),
      })
      const data = await res.json()
      if (res.ok) return data.ticketNo
      const message = data.error?.message ?? '提交失败'
      setNotice(message)
      if (data.error?.code === 'ORG_CHANGE_PENDING' || data.error?.code === 'CONFIG_CHANGE_PENDING') {
        setPendingMessage(message)
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  const pendingDialog = pendingMessage && (
    <dialog ref={openPendingDialog} className="org-pending-dialog" role="alertdialog"
      aria-labelledby="config-pending-title" aria-describedby="config-pending-message"
      onClose={() => setPendingMessage('')}>
      <div className="org-card">
        <header className="org-card-head">
          <span className="org-kpi-icon amber" aria-hidden="true"><Clock3 size={20} /></span>
          <h3 id="config-pending-title">已有待审批工单</h3>
        </header>
        <p id="config-pending-message">{pendingMessage}</p>
        <form method="dialog"><button type="submit" className="primary-button">知道了</button></form>
      </div>
    </dialog>
  )
  return {submitTicket, pendingDialog}
}
