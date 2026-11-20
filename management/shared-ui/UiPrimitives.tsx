import {ArrowRight} from 'lucide-react'

export function ChartPanel({ title, subtitle, wide, children }: { title: string; subtitle: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`panel chart-panel ${wide ? 'wide' : ''}`}>
      <div className="panel-title">
        <div><h3>{title}</h3><p>{subtitle}</p></div>
        <button className="more-button">•••</button>
      </div>
      <div className="chart-body">{children}</div>
    </section>
  )
}

export function DataTable({ columns, rows, onAction }: { columns: string[]; rows: string[][]; onAction?: (row: string[]) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}{onAction && <th>操作</th>}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`}>
                  {cell === '能用' ? <span className="status success">{cell}</span>
                    : cell === '不能用' ? <span className="status danger">{cell}</span>
                    : /(正常|成功|已完成|一致|已批准|允许|已恢复|已关闭)/.test(cell) ? <span className="status success">{cell}</span>
                    : /(严重|紧急|失败|异常|冲突|未批准|禁止|停滞)/.test(cell) ? <span className="status danger">{cell}</span>
                    : /(进行中|审核中|待|观察|一般|波动)/.test(cell) ? <span className="status warning">{cell}</span>
                    : cell}
                </td>
              ))}
              {onAction && <td><button className="row-action" onClick={() => onAction(row)}>打开工单 <ArrowRight size={13} /></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FormField({ label, source, required, children }: { label: string; source: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}{required && <b>*</b>}<em>{source}</em></span>
      {children}
    </label>
  )
}
