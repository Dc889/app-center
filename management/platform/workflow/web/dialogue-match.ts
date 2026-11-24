export type CatalogType = { code: string; name: string; mode: string; scene: string }
export type DialogueMatch = CatalogType & { confidence: number; hits: string[] }
const hints: Record<string, string[]> = {
  'KB-02': ['知识库', '分享', '发布'],
  'KB-03': ['知识库', '绑定', '授权'],
  'KB-05': ['知识库', '下架', '违规', '处置'],
  'AG-01': ['智能体', '同步', '纳管'],
  'AG-02': ['智能体', '发布', '分享'],
  'AG-03': ['智能体', '授权', '使用'],
  'AG-04': ['智能体', '变更', '再发布'],
  'AG-05': ['智能体', '下架'],
  'KEY-01': ['密钥', '创建', '登记'],
  'KEY-02': ['密钥', '轮换', '撤销'],
  'TOL-01': ['工具', '批准'],
  'PLG-01': ['插件', '上架'],
  'PLG-02': ['插件', '变更', '再审'],
  'PLG-03': ['插件', '安装', '卸载', '升级'],
  'SKL-01': ['Skill', '上架'],
  'SKL-02': ['Skill', '变更', '再审'],
  'SKL-03': ['Skill', '下载'],
  'SKL-04': ['Skill', '下架'],
  'MCP-01': ['MCP', '上架', '登记'],
  'MCP-02': ['MCP', '绑定', '使用'],
  'MCP-03': ['MCP', '解绑', '隔离'],
  'EVT-01': ['告警', '研判', '报告', '安全', '事件'],
  'ACC-01': ['账号', '开通', '权限'],
  'ACC-02': ['账号', '改名', '账户名'],
}
export function matchDialogue(message: string, catalog: CatalogType[]) {
  const text = message.trim()
  const scored = catalog.map(item => {
    const keys = [...new Set([item.code, ...(hints[item.code] ?? [])])].filter(key => key.length >= 2)
    const hits = keys.filter(key => text.includes(key))
    const confidence = text.includes(item.code) ? 1 : hits.length === 0 ? 0 : Math.min(1, hits.length / 3)
    return { ...item, confidence, hits }
  }).filter(item => item.confidence > 0).sort((a, b) => b.confidence - a.confidence || b.hits.length - a.hits.length)
  const [top, second] = scored
  const selected = top && top.confidence >= 0.75 && (!second || top.confidence - second.confidence >= 0.2) ? top : null
  return { selected, candidates: scored.slice(0, 3) }
}
export function statedResource(message: string) {
  return /(?:资源|对象)(?:ID|标识)?是\s*([A-Za-z0-9._-]{1,80})/.exec(message)?.[1] ?? ''
}
