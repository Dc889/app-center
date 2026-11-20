import {pageMeta} from './UiContextData'
import type {View} from './UiContextData'
export function PageHeader({ view, action }: { view: View; action?: React.ReactNode }) {
  const meta = pageMeta[view]
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{meta.eyebrow}</span>
        <h1>{meta.title}</h1>
        <p>{meta.desc}</p>
      </div>
      {action}
    </div>
  )
}
