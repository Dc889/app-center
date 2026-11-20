export function submissionGaps(items:[string,string][]) {
  const missing=items.filter(([,value])=>!String(value ?? '').trim()).map(([label])=>label)
  return missing.length ? '还不能提交：'+missing.join('、') : ''
}
export const readyToSubmit='必填项已填写，尚未提交'
