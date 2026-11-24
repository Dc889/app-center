const DIFY_BASE = process.env.DIFY_BASE || 'http://localhost:8080'
const PASSWORD = process.env.TENANT_PASSWORD || 'Kpw@2026!'

const TENANTS = [
  {email: 'tenant01@kpw.com', user: '张伟', dept: '刑侦一支队', prefix: '刑侦', domain: '刑事案件侦查、现场勘查与串并案研判'},
  {email: 'tenant02@kpw.com', user: '王芳', dept: '经侦支队', prefix: '经侦', domain: '经济犯罪资金穿透、涉税涉众风险排查'},
  {email: 'tenant03@kpw.com', user: '刘洋', dept: '网安支队', prefix: '网安', domain: '网络安全态势感知、电子数据取证与黑灰产治理'},
  {email: 'tenant04@kpw.com', user: '赵敏', dept: '治安支队', prefix: '治安', domain: '重点场所治安防控、大型活动安保与矛盾化解'},
  {email: 'tenant05@kpw.com', user: '孙强', dept: '交警支队', prefix: '交管', domain: '道路交通事故深度研判、拥堵治理与隐患排查'},
  {email: 'tenant06@kpw.com', user: '周磊', dept: '指挥中心', prefix: '指挥', domain: '110接处警情分级调度、应急处突与值班研判'},
  {email: 'tenant07@kpw.com', user: '吴静', dept: '综合法制', prefix: '法制', domain: '执法规范化审核、法条适用校验与卷宗质量评查'},
  {email: 'tenant08@kpw.com', user: '郑涛', dept: '科信研发', prefix: '科信', domain: '警务大数据治理、智能体运维监控与系统集成'},
  {email: 'tenant09@kpw.com', user: '冯雪', dept: '反诈中心', prefix: '反诈', domain: '电信网络诈骗预警劝阻、涉诈资金止付冻结与线索研判'},
  {email: 'tenant10@kpw.com', user: '褚明', dept: '督察审计', prefix: '督察', domain: '警务效能督察、执法问题核查与专项内控审计'}
]

async function api(token, path, options = {}) {
  const headers = {...(options.headers || {})}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${DIFY_BASE}${path}`, {...options, headers})
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = {raw: text}
  }
  return {ok: res.ok, status: res.status, data: json}
}

async function login(email) {
  const r = await api(null, '/console/api/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email, password: PASSWORD})
  })
  if (!r.ok || !r.data?.data?.access_token) {
    throw new Error(`Login failed for ${email}: ${r.status}`)
  }
  return r.data.data.access_token
}

function buildDocsForKb(tenant, kbName) {
  const isCaseKb = kbName.includes('案例') || kbName.includes('战法')
  if (!isCaseKb) {
    return [
      {
        filename: `${tenant.dept}-业务操作规范指引.md`,
        content: [
          `# ${tenant.dept}业务操作规范指引（2026版）`,
          `## 第一章 总则\n为进一步提升${tenant.dept}在「${tenant.domain}」方向的规范化与智能化水平，确保接警受理、线索研判、证据固定与审核报批全流程可追溯、零疏漏，制定本操作指引。`,
          `## 第二章 研判受理标准\n1. 警情与线索录入须完整包含发生时间、地点坐标、涉案主体要素、核心行为特征及初步风险等级。\n2. 涉及跨区域、跨警种协查的事项，应在受理后 2 小时内通过合成作战平台发起联动核查单。`,
          `## 第三章 审核与合规要求\n1. 所有对外输出或归档的研判报告必须经过法制合规核验，严禁引用失效法规条款。\n2. 涉密与个人敏感信息在生成摘要和共享流转前必须执行脱敏处理，留存完整审计日志。`,
          `## 第四章 时限与复盘机制\n普通线索 24 小时内形成初研结论，高风险预警 30 分钟内启动闭环处置，每周五汇总形成部门研判周报并沉淀至知识库。`
        ].join('\n\n')
      },
      {
        filename: `${tenant.dept}-常见风险核查清单.md`,
        content: [
          `# ${tenant.dept}常见风险核查清单`,
          `## 一、核心核查维度\n针对${tenant.domain}中的高频风险点，研判人员应重点核查主体身份一致性、时间线连续性、证据链闭环度及关联历史警情。`,
          `## 二、分级处置规范\n- **一级（紧急高危）**：立即上报值班领导并同步推送处置指令，全程跟踪至风险解除。\n- **二级（重点关注）**：纳入专班台账，48 小时内完成多源数据交叉核验。\n- **三级（常规监测）**：自动归集标签并进入周度趋势分析视图。`,
          `## 三、质量评查指标\n文书要素完整率不低于 98%，法条引用准确率 100%，历史串并案召回率持续优化。`
        ].join('\n\n')
      }
    ]
  }
  return [
    {
      filename: `${tenant.dept}-典型实战案例复盘汇编.md`,
      content: [
        `# ${tenant.dept}典型实战案例复盘汇编`,
        `## 案例一：多源线索串并快速破案复盘\n**背景**：围绕${tenant.domain}，近期辖区内连续出现多起作案手法高度相似的警情。\n**研判过程**：专班通过提取时间规律、活动轨迹与通联特征，借助智能体完成跨库比对，成功锁定核心团伙落脚点。\n**经验总结**：标准化要素抽取配合结构化知识检索，可将串并研判耗时从 3 天压缩至 2 小时以内。`,
        `## 案例二：高风险预警提前干预处置\n**背景**：系统监测到异常聚集与高频试探行为，触发二级风险预警。\n**处置措施**：第一时间联动基层单位核实情况并落实针对性防控措施，成功避免重大损失。\n**可复用要点**：将关键特征固化为规则模板与提示词约束，实现同类风险自动识别。`
      ].join('\n\n')
    },
    {
      filename: `${tenant.dept}-高频研判战法手册.md`,
      content: [
        `# ${tenant.dept}高频研判战法手册`,
        `## 战法一：五维要素交叉核验法\n围绕「人、案、物、地、网」五个维度自动抽取关键实体，通过知识库历史案件比对快速识别隐藏关联。`,
        `## 战法二：时间轴还原与异常突变定位法\n将笔录、台账与监控记录按时间戳对齐，自动标出逻辑断层与高频异常节点，辅助民警快速制定下一步侦查与核查方案。`
      ].join('\n\n')
    }
  ]
}

async function uploadDatasetFile(token, filename, content) {
  const form = new FormData()
  form.append('file', new Blob([content], {type: 'text/markdown;charset=utf-8'}), filename)
  const r = await api(token, '/console/api/files/upload?source=datasets', {
    method: 'POST',
    body: form
  })
  if (!r.ok || !r.data?.id) {
    throw new Error(`Upload file failed (${filename}): ${r.status} ${JSON.stringify(r.data)}`)
  }
  return r.data.id
}

function buildAdvancedChatDraft(tenant, app, datasetIds) {
  const startId = '1730000000001'
  const krId = '1730000000002'
  const llmId = '1730000000003'
  const ansId = '1730000000004'
  return {
    graph: {
      nodes: [
        {
          id: startId,
          type: 'custom',
          position: {x: 80, y: 260},
          positionAbsolute: {x: 80, y: 260},
          sourcePosition: 'right',
          targetPosition: 'left',
          width: 244,
          height: 54,
          selected: false,
          data: {
            type: 'start',
            title: '开始',
            desc: `接收${tenant.dept}研判提问`,
            variables: [
              {
                variable: 'case_category',
                label: '业务分类',
                type: 'select',
                required: false,
                options: ['日常研判', '专班核查', '风险预警', '法制复核'],
                max_length: 48
              }
            ],
            selected: false
          }
        },
        {
          id: krId,
          type: 'custom',
          position: {x: 380, y: 260},
          positionAbsolute: {x: 380, y: 260},
          sourcePosition: 'right',
          targetPosition: 'left',
          width: 244,
          height: 92,
          selected: false,
          data: {
            type: 'knowledge-retrieval',
            title: '知识库检索',
            desc: `检索${tenant.dept}规范与案例知识库`,
            query_variable_selector: ['sys', 'query'],
            dataset_ids: datasetIds,
            retrieval_mode: 'multiple',
            multiple_retrieval_config: {
              top_k: 4,
              score_threshold: null,
              reranking_enable: false
            },
            selected: false
          }
        },
        {
          id: llmId,
          type: 'custom',
          position: {x: 680, y: 260},
          positionAbsolute: {x: 680, y: 260},
          sourcePosition: 'right',
          targetPosition: 'left',
          width: 244,
          height: 98,
          selected: false,
          data: {
            type: 'llm',
            title: '研判分析生成',
            desc: `结合检索依据输出${app.name}专业结论`,
            model: {
              provider: 'openai',
              name: 'gpt-4o-mini',
              mode: 'chat',
              completion_params: {temperature: 0.3}
            },
            prompt_template: [
              {
                id: 'sys-prompt-1',
                role: 'system',
                text: `你是${tenant.dept}资深研判专家，专注于${tenant.domain}。请严格依据检索到的部门规范与典型案例，按【核心事实】【依据条文】【风险研判】【处置建议】四部分输出清晰、规范的中文结论。\n\n参考知识库片段：\n{{#context#}}`
              },
              {
                id: 'user-prompt-1',
                role: 'user',
                text: '业务分类：{{#1730000000001.case_category#}}\n用户问题：{{#sys.query#}}'
              }
            ],
            context: {
              enabled: true,
              variable_selector: [krId, 'result']
            },
            vision: {enabled: false},
            memory: {
              window: {enabled: true, size: 10},
              query_prompt_template: '{{#sys.query#}}'
            },
            variables: [],
            selected: false
          }
        },
        {
          id: ansId,
          type: 'custom',
          position: {x: 980, y: 260},
          positionAbsolute: {x: 980, y: 260},
          sourcePosition: 'right',
          targetPosition: 'left',
          width: 244,
          height: 105,
          selected: false,
          data: {
            type: 'answer',
            title: '直接回复',
            desc: '向一线办案人员输出研判结果',
            variables: [],
            answer: `{{#${llmId}.text#}}`,
            selected: false
          }
        }
      ],
      edges: [
        {
          id: 'e-start-kr',
          type: 'custom',
          source: startId,
          sourceHandle: 'source',
          target: krId,
          targetHandle: 'target',
          data: {sourceType: 'start', targetType: 'knowledge-retrieval', isInIteration: false, isInLoop: false}
        },
        {
          id: 'e-kr-llm',
          type: 'custom',
          source: krId,
          sourceHandle: 'source',
          target: llmId,
          targetHandle: 'target',
          data: {sourceType: 'knowledge-retrieval', targetType: 'llm', isInIteration: false, isInLoop: false}
        },
        {
          id: 'e-llm-ans',
          type: 'custom',
          source: llmId,
          sourceHandle: 'source',
          target: ansId,
          targetHandle: 'target',
          data: {sourceType: 'llm', targetType: 'answer', isInIteration: false, isInLoop: false}
        }
      ],
      viewport: {x: 0, y: 0, zoom: 0.9}
    },
    features: {
      opening_statement: `你好，我是${app.name}，已关联${tenant.dept}专属规范与案例知识库，请输入需要研判的案情或线索。`,
      suggested_questions: [
        `请梳理${tenant.dept}常见高风险线索的核查要点`,
        '请按规范格式生成一份初步研判摘要',
        '列出本部门重点业务的操作时限与审批要求'
      ],
      suggested_questions_after_answer: {enabled: true},
      speech_to_text: {enabled: false},
      text_to_speech: {enabled: false, voice: '', language: ''},
      retriever_resource: {enabled: true},
      sensitive_word_avoidance: {enabled: false, type: '', configs: []},
      file_upload: {
        image: {enabled: false, number_limits: 3, detail: 'high', transfer_methods: ['local_file', 'remote_url']}
      }
    },
    environment_variables: [],
    conversation_variables: []
  }
}

function buildWorkflowDraft(tenant, app, datasetIds) {
  const startId = '1730000001001'
  const krId = '1730000001002'
  const tplId = '1730000001003'
  const endId = '1730000001004'
  return {
    graph: {
      nodes: [
        {
          id: startId,
          type: 'custom',
          position: {x: 80, y: 260},
          positionAbsolute: {x: 80, y: 260},
          sourcePosition: 'right',
          targetPosition: 'left',
          width: 244,
          height: 112,
          selected: false,
          data: {
            type: 'start',
            title: '开始',
            desc: `输入${tenant.dept}待处理线索或台账文本`,
            variables: [
              {variable: 'title', label: '事项标题', type: 'text-input', required: true, max_length: 120},
              {variable: 'content', label: '原始文本', type: 'paragraph', required: true, max_length: 4000},
              {variable: 'priority', label: '紧急程度', type: 'select', required: false, options: ['一级紧急', '二级重点', '三级常规'], max_length: 32}
            ],
            selected: false
          }
        },
        {
          id: krId,
          type: 'custom',
          position: {x: 380, y: 260},
          positionAbsolute: {x: 380, y: 260},
          sourcePosition: 'right',
          targetPosition: 'left',
          width: 244,
          height: 92,
          selected: false,
          data: {
            type: 'knowledge-retrieval',
            title: '规范知识匹配',
            desc: `自动匹配${tenant.dept}规范依据`,
            query_variable_selector: [startId, 'content'],
            dataset_ids: datasetIds,
            retrieval_mode: 'multiple',
            multiple_retrieval_config: {
              top_k: 3,
              score_threshold: null,
              reranking_enable: false
            },
            selected: false
          }
        },
        {
          id: tplId,
          type: 'custom',
          position: {x: 680, y: 260},
          positionAbsolute: {x: 680, y: 260},
          sourcePosition: 'right',
          targetPosition: 'left',
          width: 244,
          height: 92,
          selected: false,
          data: {
            type: 'template-transform',
            title: '标准报告排版',
            desc: '将要素与规范依据汇总为标准 Markdown 汇报',
            variables: [
              {variable: 'title', value_selector: [startId, 'title']},
              {variable: 'priority', value_selector: [startId, 'priority']},
              {variable: 'content', value_selector: [startId, 'content']}
            ],
            template: `# ${tenant.dept}·{{ title }}\n\n- **紧急程度**：{{ priority or '三级常规' }}\n- **应用流水线**：${app.name}\n\n## 原始线索内容\n{{ content }}\n\n## 规范核查提示\n已自动关联${tenant.dept}知识库完成合规依据比对，请复核后归档。`,
            selected: false
          }
        },
        {
          id: endId,
          type: 'custom',
          position: {x: 980, y: 260},
          positionAbsolute: {x: 980, y: 260},
          sourcePosition: 'right',
          targetPosition: 'left',
          width: 244,
          height: 90,
          selected: false,
          data: {
            type: 'end',
            title: '结束',
            desc: '输出结构化研判报告',
            outputs: [
              {variable: 'report', value_selector: [tplId, 'output']}
            ],
            selected: false
          }
        }
      ],
      edges: [
        {
          id: 'e-wf-1',
          type: 'custom',
          source: startId,
          sourceHandle: 'source',
          target: krId,
          targetHandle: 'target',
          data: {sourceType: 'start', targetType: 'knowledge-retrieval', isInIteration: false, isInLoop: false}
        },
        {
          id: 'e-wf-2',
          type: 'custom',
          source: krId,
          sourceHandle: 'source',
          target: tplId,
          targetHandle: 'target',
          data: {sourceType: 'knowledge-retrieval', targetType: 'template-transform', isInIteration: false, isInLoop: false}
        },
        {
          id: 'e-wf-3',
          type: 'custom',
          source: tplId,
          sourceHandle: 'source',
          target: endId,
          targetHandle: 'target',
          data: {sourceType: 'template-transform', targetType: 'end', isInIteration: false, isInLoop: false}
        }
      ],
      viewport: {x: 0, y: 0, zoom: 0.9}
    },
    features: {
      retriever_resource: {enabled: true},
      sensitive_word_avoidance: {enabled: false, type: '', configs: []}
    },
    environment_variables: [],
    conversation_variables: []
  }
}

function buildChatModelConfig(tenant, app, datasetIds) {
  const isAgent = app.mode === 'agent-chat'
  return {
    pre_prompt: `你是「${app.name}」，隶属${tenant.dept}，专注于${tenant.domain}。\n请遵守以下原则：\n1. 回答严谨客观，优先引用已关联的部门业务规范与典型案例知识库。\n2. 涉及研判结论时，按「要点摘录」「依据参考」「处置建议」分条呈现。\n3. 严格保护涉密与个人敏感信息，不编造未核实的事实。`,
    prompt_type: 'simple',
    chat_prompt_config: {},
    completion_prompt_config: {},
    user_input_form: [],
    dataset_query_variable: '',
    opening_statement: `你好，我是${tenant.dept}「${app.name}」。已为您挂载本部门知识库，可直接输入案情要点或查询规范依据。`,
    suggested_questions: [
      `${tenant.dept}接处警研判有哪些必备要素？`,
      '请帮我把这段笔录提炼成时间线与核心事实',
      '高风险预警触发后的标准闭环流程是什么？'
    ],
    more_like_this: {enabled: false},
    suggested_questions_after_answer: {enabled: true},
    speech_to_text: {enabled: false},
    text_to_speech: {enabled: false, voice: '', language: ''},
    retriever_resource: {enabled: true},
    sensitive_word_avoidance: {enabled: false, type: '', configs: []},
    dataset_configs: {
      retrieval_model: 'multiple',
      top_k: 4,
      reranking_enable: false,
      datasets: {
        datasets: datasetIds.map(id => ({dataset: {enabled: true, id}}))
      }
    },
    agent_mode: isAgent
      ? {enabled: true, max_iteration: 5, strategy: 'function_call', tools: []}
      : {enabled: false, max_iteration: 5, strategy: 'function_call', tools: []},
    model: {
      provider: 'openai',
      name: 'gpt-4o-mini',
      mode: 'chat',
      completion_params: {temperature: 0.3, top_p: 1}
    }
  }
}

async function populateTenant(tenant) {
  const token = await login(tenant.email)
  const report = {
    email: tenant.email,
    dept: tenant.dept,
    docsCreated: 0,
    docsTotal: 0,
    workflowsUpdated: 0,
    chatConfigsUpdated: 0,
    errors: []
  }

  // 1. Populate Knowledge Bases with real Chinese documents (economy mode)
  const kbRes = await api(token, '/console/api/datasets?page=1&limit=50')
  const datasets = kbRes.data?.data || []
  const datasetIds = datasets.map(d => d.id)

  for (const ds of datasets) {
    const existingDocsRes = await api(token, `/console/api/datasets/${ds.id}/documents?page=1&limit=50`)
    const existingDocs = existingDocsRes.data?.data || []
    const existingNames = new Set(existingDocs.map(d => d.name))
    const plannedDocs = buildDocsForKb(tenant, ds.name).filter(d => !existingNames.has(d.filename))

    if (plannedDocs.length > 0) {
      try {
        const fileIds = []
        for (const doc of plannedDocs) {
          const fid = await uploadDatasetFile(token, doc.filename, doc.content)
          fileIds.push(fid)
        }
        const createRes = await api(token, `/console/api/datasets/${ds.id}/documents`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            indexing_technique: 'economy',
            doc_form: 'text_model',
            doc_language: 'Chinese',
            process_rule: {
              mode: 'custom',
              rules: {
                pre_processing_rules: [
                  {id: 'remove_extra_spaces', enabled: true},
                  {id: 'remove_urls_emails', enabled: false}
                ],
                segmentation: {separator: '\n\n', max_tokens: 500, chunk_overlap: 50}
              }
            },
            data_source: {
              type: 'upload_file',
              info_list: {
                data_source_type: 'upload_file',
                file_info_list: {file_ids: fileIds}
              }
            }
          })
        })
        if (createRes.ok) {
          report.docsCreated += fileIds.length
        } else {
          report.errors.push(`kb_docs(${ds.name}): ${createRes.status} ${JSON.stringify(createRes.data).slice(0, 160)}`)
        }
      } catch (e) {
        report.errors.push(`kb_upload(${ds.name}): ${e.message}`)
      }
    }

    const finalDocsRes = await api(token, `/console/api/datasets/${ds.id}/documents?page=1&limit=50`)
    report.docsTotal += (finalDocsRes.data?.total ?? (finalDocsRes.data?.data?.length || 0))
  }

  // 2. Populate all 10 apps with real workflow nodes or prompt/KB configs
  const appsRes = await api(token, '/console/api/apps?page=1&limit=100')
  const apps = appsRes.data?.data || []

  for (const app of apps) {
    if (app.mode === 'advanced-chat' || app.mode === 'workflow') {
      const existingDraft = await api(token, `/console/api/apps/${app.id}/workflows/draft`)
      const payload = app.mode === 'advanced-chat'
        ? buildAdvancedChatDraft(tenant, app, datasetIds)
        : buildWorkflowDraft(tenant, app, datasetIds)
      if (existingDraft.ok && existingDraft.data?.hash) {
        payload.hash = existingDraft.data.hash
      }
      const r = await api(token, `/console/api/apps/${app.id}/workflows/draft`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      })
      if (r.ok) {
        report.workflowsUpdated++
      } else {
        report.errors.push(`wf(${app.name}): ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`)
      }
    } else {
      const payload = buildChatModelConfig(tenant, app, datasetIds)
      const r = await api(token, `/console/api/apps/${app.id}/model-config`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      })
      if (r.ok) {
        report.chatConfigsUpdated++
      } else {
        report.errors.push(`chat(${app.name}): ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`)
      }
    }
  }

  return report
}

async function main() {
  const results = []
  for (const tenant of TENANTS) {
    console.log(`Populating data for ${tenant.email} (${tenant.dept})...`)
    const r = await populateTenant(tenant)
    results.push(r)
  }
  console.log('\n=== POPULATE SUMMARY ===')
  console.log(JSON.stringify(results, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
