import {useEffect, useState} from 'react'
import {ApplicationDrafts, useApplicationDraft} from '../../../platform/workflow/public.web'
import {readyToSubmit, submissionGaps} from '../../../shared-ui/form-check'
import {ResourcePicker} from '../../../shared-ui/ResourcePicker'
import {useResourceSnapshot} from '../../../shared-ui/useResourceSnapshot'

const SCENARIO_PRESETS = [
  '用于刑侦民警快速提炼笔录要素并生成初版案情研判摘要',
  '用于法律法规条文精准检索与办案程序合规问答',
  '用于警情要素结构化抽取与研判工作流自动流转',
  '用于公文通知、会议纪要规范起草与格式校对',
  '用于涉企风险线索多步分析与研判辅助',
]

const INSTRUCTION_PRESETS = [
  '输入案情文本或上传笔录材料，30 秒内输出关键时间线、人物关系与研判建议',
  '输入具体问题或法条关键词，系统自动检索权威知识库并返回带出处引用的解答',
  '粘贴原始警情文本，点击运行即可输出标准结构化 JSON 与研判摘要',
  '输入公文主题、主送机关与要点，自动生成符合内网规范的初稿',
]

const BUSINESS_LINE_PRESETS = ['刑侦', '经侦', '治安', '网安', '平台运营', '系统管理', '综合办公']
const ACCOUNT_PRESETS = ['chen.yu', 'zhou.min', 'li.qiang']

type OrgRow = {orgId: string; code: string; placeholderKey: string; name: string; enabled: boolean}

function parseList(raw: string): string[] {
  return raw.split(/[,，]/).map(s => s.trim()).filter(Boolean)
}

function toggleInList(raw: string, item: string): string {
  const arr = parseList(raw)
  const next = arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]
  return next.join(', ')
}

function defaultUserOrg(): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem('session-person') ?? 'null')
    if (typeof saved?.org === 'string' && saved.org.trim()) return saved.org.trim()
  } catch {
    // ignore
  }
  return '业务一部'
}

export function PublishResource({onMeta, ticketType = 'AG-02'}: {ticketType?: 'AG-01' | 'AG-02'; onMeta: (meta: {name: string; level: string; line: string}) => void}) {
  const [workspace, setWorkspace] = useState('')
  const resource = useResourceSnapshot()
  const {snapshot} = resource
  const [pickerKey, setPickerKey] = useState(0)
  const [message, setMessage] = useState('')
  const [usages, setUsages] = useState(['run', 'embed'])
  const [orgOptions, setOrgOptions] = useState<string[]>(['业务一部', '平台运营组', '系统管理组'])
  const [fields, setFields] = useState(() => {
    const org = defaultUserOrg()
    return {
      scenario: '',
      instructions: '',
      businessLine: '刑侦',
      classification: '内部',
      scope: 'orgs',
      boundaryOrgs: org,
      targetOrgs: org,
      targetAccounts: '',
    }
  })
  const [draftResourceId, setDraftResourceId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/organizations')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!active || !Array.isArray(data?.items)) return
        const names = (data.items as OrgRow[])
          .filter(o => o.enabled)
          .map(o => o.name || o.placeholderKey)
          .filter(Boolean)
        if (names.length > 0) setOrgOptions([...new Set(names)])
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const draft = useApplicationDraft(
    ticketType,
    {...fields, usages, workspaceId: workspace, resourceId: draftResourceId},
    ({resourceId, workspaceId, usages: restoredUsages, ...value}) => {
      setFields(value)
      setUsages(restoredUsages)
      setWorkspace(workspaceId)
      setDraftResourceId(resourceId)
      setPickerKey(key => key + 1)
      resource.reset()
      setMessage('')
      onMeta({name: '', level: '', line: ''})
    },
  )
  const {ticketNo} = draft

  async function submit() {
    const gap = submissionGaps([
      ['本人应用', snapshot?.resourceId ?? ''],
      ...(ticketType === 'AG-02'
        ? ([
            ['业务场景', fields.scenario],
            ['使用说明', fields.instructions],
            ['业务线', fields.businessLine],
            ['组织边界', fields.boundaryOrgs],
            ['开放使用方式', usages.join(',')],
          ] as [string, string][])
        : []),
    ])
    if (gap) { setMessage(gap); return }
    if (!snapshot) return
    setBusy(true)
    try {
      const response = await draft.submit('/api/applications', {
        ticketNo,
        ticketType,
        resourceId: snapshot.resourceId,
        workspaceId: workspace,
        fields: ticketType === 'AG-01'
          ? {}
          : {
              ...fields,
              boundaryOrgs: parseList(fields.boundaryOrgs),
              targetOrgs: parseList(fields.targetOrgs),
              targetAccounts: parseList(fields.targetAccounts),
              usages,
            },
      })
      const data = await response.json()
      if (!response.ok) throw Error(data.error?.message ?? '提交失败')
      setMessage(data.ticketNo + ' · ' + data.status)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  const boundaryList = parseList(fields.boundaryOrgs)
  const targetOrgList = parseList(fields.targetOrgs)
  const targetAccList = parseList(fields.targetAccounts)

  return (
    <fieldset className="form-section" disabled={busy || resource.busy || draft.controller.busy}>
      <legend>Dify 应用与发布快照</legend>
      <ResourcePicker
        key={pickerKey}
        kind="dify_app"
        value={{resourceId: draftResourceId, workspaceId: workspace}}
        onChange={(value, verified) => {
          resource.reset()
          setWorkspace(value.workspaceId)
          setDraftResourceId(value.resourceId)
          setMessage('')
          onMeta({name: '', level: '', line: ''})
          if (verified) {
            void resource.read('dify_app', value.resourceId, value.workspaceId).then(snap => {
              if (snap) onMeta({name: snap.resourceId, level: '', line: ''})
            })
          }
        }}
      />
      {snapshot && (
        <div>
          <p>资源 · {snapshot.resourceId}</p>
          <p>快照 · {snapshot.snapshotId} · {snapshot.capturedAt}</p>
          <details className="technical-details">
            <summary>详细信息</summary>
            <pre>{JSON.stringify(snapshot.data, null, 2)}</pre>
          </details>
        </div>
      )}
      {snapshot && ticketType === 'AG-01' && (
        <button className="primary-button" disabled={busy || draft.controller.busy} onClick={submit}>提交本人纳管同步</button>
      )}
      {snapshot && ticketType === 'AG-02' && (
        <fieldset disabled={busy || draft.controller.busy}>
          <legend>发布申请</legend>

          <label>
            业务场景
            <input
              list="ag02-scenario-options"
              placeholder="可下拉选择常用场景，或直接输入自定义场景"
              value={fields.scenario}
              onChange={e => setFields({...fields, scenario: e.target.value})}
            />
            <datalist id="ag02-scenario-options">
              {SCENARIO_PRESETS.map(s => <option key={s} value={s} />)}
            </datalist>
          </label>

          <label>
            使用说明
            <input
              list="ag02-instruction-options"
              placeholder="可下拉选择常用说明，或直接输入自定义指引"
              value={fields.instructions}
              onChange={e => setFields({...fields, instructions: e.target.value})}
            />
            <datalist id="ag02-instruction-options">
              {INSTRUCTION_PRESETS.map(s => <option key={s} value={s} />)}
            </datalist>
          </label>

          <label>
            业务线
            <input
              list="ag02-line-options"
              placeholder="可下拉选择业务线，或直接输入"
              value={fields.businessLine}
              onChange={e => setFields({...fields, businessLine: e.target.value})}
            />
            <datalist id="ag02-line-options">
              {BUSINESS_LINE_PRESETS.map(s => <option key={s} value={s} />)}
            </datalist>
          </label>

          <label>
            组织边界（逗号分隔）
            <input
              list="ag02-org-options"
              placeholder="点击下方组织标签多选，或手动逗号分隔填写"
              value={fields.boundaryOrgs}
              onChange={e => setFields({...fields, boundaryOrgs: e.target.value})}
            />
          </label>
          <div className="draft-toolbar" style={{marginBottom: 8}}>
            {orgOptions.map(org => (
              <button
                key={'b-' + org}
                type="button"
                className={boundaryList.includes(org) ? 'primary-button' : 'secondary-button'}
                onClick={() => setFields({...fields, boundaryOrgs: toggleInList(fields.boundaryOrgs, org)})}
              >
                {boundaryList.includes(org) ? '✓ ' : '+ '}{org}
              </button>
            ))}
          </div>

          <label>
            密级
            <select value={fields.classification} onChange={e => setFields({...fields, classification: e.target.value})}>
              {['公开', '内部', '敏感', '机密'].map(s => <option key={s}>{s}</option>)}
            </select>
          </label>

          <label>
            目标用户范围
            <select value={fields.scope} onChange={e => setFields({...fields, scope: e.target.value})}>
              <option value="all">全网段</option>
              <option value="orgs">指定组织</option>
              <option value="accounts">指定人员</option>
            </select>
          </label>

          {fields.scope === 'orgs' && (
            <>
              <label>
                目标组织（逗号分隔）
                <input
                  list="ag02-org-options"
                  placeholder="点击下方组织标签多选，或手动填写"
                  value={fields.targetOrgs}
                  onChange={e => setFields({...fields, targetOrgs: e.target.value})}
                />
              </label>
              <div className="draft-toolbar" style={{marginBottom: 8}}>
                {orgOptions.map(org => (
                  <button
                    key={'t-' + org}
                    type="button"
                    className={targetOrgList.includes(org) ? 'primary-button' : 'secondary-button'}
                    onClick={() => setFields({...fields, targetOrgs: toggleInList(fields.targetOrgs, org)})}
                  >
                    {targetOrgList.includes(org) ? '✓ ' : '+ '}{org}
                  </button>
                ))}
              </div>
            </>
          )}

          {fields.scope === 'accounts' && (
            <>
              <label>
                目标人员（逗号分隔）
                <input
                  list="ag02-account-options"
                  placeholder="点击下方账号标签多选，或手动填写"
                  value={fields.targetAccounts}
                  onChange={e => setFields({...fields, targetAccounts: e.target.value})}
                />
              </label>
              <div className="draft-toolbar" style={{marginBottom: 8}}>
                {ACCOUNT_PRESETS.map(acc => (
                  <button
                    key={'a-' + acc}
                    type="button"
                    className={targetAccList.includes(acc) ? 'primary-button' : 'secondary-button'}
                    onClick={() => setFields({...fields, targetAccounts: toggleInList(fields.targetAccounts, acc)})}
                  >
                    {targetAccList.includes(acc) ? '✓ ' : '+ '}{acc}
                  </button>
                ))}
              </div>
            </>
          )}

          <datalist id="ag02-org-options">
            {orgOptions.map(o => <option key={o} value={o} />)}
          </datalist>
          <datalist id="ag02-account-options">
            {ACCOUNT_PRESETS.map(a => <option key={a} value={a} />)}
          </datalist>

          <fieldset>
            <legend>开放使用方式</legend>
            {[['run', '运行'], ['embed', '嵌入网站'], ['api', '访问 API']].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={usages.includes(key)}
                  onChange={e => setUsages(items => (e.target.checked ? [...items, key] : items.filter(item => item !== key)))}
                />
                {label}
              </label>
            ))}
          </fieldset>

          <button className="primary-button" disabled={!usages.length} onClick={submit}>提交发布审批</button>
        </fieldset>
      )}
      <button
        className="secondary-button"
        onClick={() =>
          setMessage(
            submissionGaps([
              ['本人应用', snapshot?.resourceId ?? ''],
              ...(ticketType === 'AG-02'
                ? ([
                    ['业务场景', fields.scenario],
                    ['使用说明', fields.instructions],
                    ['业务线', fields.businessLine],
                    ['组织边界', fields.boundaryOrgs],
                    ['开放使用方式', usages.join(',')],
                  ] as [string, string][])
                : []),
            ]) || readyToSubmit,
          )
        }
      >
        检查
      </button>
      <ApplicationDrafts draft={draft.controller} />
      <p role="status">{resource.error || message}</p>
    </fieldset>
  )
}
