# 审批前资源选择

## AG-04/AG-05依赖与影响依据（目标24）

管理端`GET /api/agent-impact?resourceId=...&workspaceId=...&action=republish|withdraw_app`按会话身份读取。先核验对应目录管理动作，读原生应用快照，再核验目录资格/映射/原发布版本/工作流/策略，变化403/409，不回退旧数据。普通可运行/可见权不足以读取管理影响。内部资源请求为`/resources/dify_app/{appId}?workspaceId=...&catalogResourceId=...`，catalogResourceId为仓库目录ID，避免同原生应用的多目录统计混淆；AG-04/05受理时也必须传。

原生快照data.agentImpact必须精确对应目录ID、appId、workspaceId，含snapshotId和UTC capturedAt。采集不超过5分钟，未来时钟偏差不超过5秒。grants、keys、dependencies三份清单分别有state、count、revision和items。collected表示读完实际权威清单，count等于items长度且成员唯一；真实空清单才能为0。缺来源或未读完返回unavailable、count/revision/items全部null及reasonCode，禁止拿缺采集冒充空。

grants.items为当前有效授权登记ID，keys.items为当前有效密钥登记ID（不含明文/产品秘密）；来源分别是完整授权台账、密钥登记及实际产品状态，过期、撤销、轮换、失效不得计入。清单及资格/映射变化必须递增修订。dependencies.items按kind+id唯一，含kind/id/name/change/approved/externalAllowed/fingerprint；kind为tool/plugin/mcp/dataset/skill，change为added/removed/changed/unchanged，指纹64位。组件比较原已发布与新工作流，读取真实批准目录/工具配置指纹，不得凭“已可见”认定批准。内部也白名单复制，不落凭证、正文或工作流秘密。

calls30d单独为带来源的UTC固定30天窗口，含state/count/from/to/source。窗口结束不晚于capturedAt且相差最多5分钟，次数含成功、失败、超时，跨运行/嵌入/API按实际调用标识去重；来源需明确真实渠道。不可采集时count/from/to为null并给reasonCode，页面显示未采集，不填0。调用统计不决定授权/密钥处置对象，可以缺采集；实际采集和去重待能力组适配。

页面与待办共用AgentImpactPanel，显示当前授权/密钥数、调用窗口及来源、资源差异、新插件/工具/MCP清单、配置指纹和未批准/禁止对外资源数。删除资源不计当前发布告警。AG-04必须完整依赖清单，AG-05必须三份关键清单齐全才能提交/批准；缺关键清单可浏览并保存草稿，不能形成无依据的执行。恢复、刷新或换源清空影响依据，重新读取；统计/清单不从草稿恢复。

受理冻结规范化agentImpact，追加agent_grants/agent_keys/agent_dependencies前置条件（只对collected组）；与原agent目录、可选agent_replacement前置条件并列。审批重新读应用/影响，要求新发布版本、工作流、目录修订与已冻结产品快照相同；任一授权/密钥清单、依赖指纹/批准状态/权限或组修订变化返回409 STALE_AGENT_IMPACT，即使旧风险决定为继续也不能覆盖新事实。AG-04既有风险仍须显式继续及办理说明，冻结warningNote。

capturedAt、调用数量和窗口的自然更新不作为影响范围相等条件，批准时保存最新approvedImpact和获准输入的影响依据，保留受理时agentImpact作为历史。执行前能力端必须原子比较组修订及目录/产品状态；未来生效工单同样不得沿旧库存撤权或撤钥。真实分组清单、修订、调用去重、工作流差异与产品执行待联调；tests/support/agent-impact.mjs只用于明确的模拟测试，绝不作为生产默认。

## KB-02随应用发布和AG-05替代目录（目标23）

KB-02的关联对象是Dify原生应用，使用`application-targets`新增purpose=dataset_publication，不复用绑定配置资格。允许有合法关联发布资格的待发布应用，以支持先完成KB-02文档审查、再首次AG-02上架，避免依赖环。表单新增relatedWorkspaceId，单独读取可配置Dify工作区；源RAG tenant或源Dify知识库工作区不能冒充关联工作区。relatedAppId为原生应用ID，与relatedWorkspaceId成对选择，详情仍必须eligible=true及稳定targetRef/revision。

选择随应用发布时两项必填。恢复、换源/区/分享方式或重新读审查依据后重新核验；源变化中止旧审查与关联读取。受理/审批按dataset_publication重读，冻结targetApplication与application_target修订；撤权403、映射/修订变化409。获准输入包含关联原生ID、关联Dify工作区、登记ID/名称，源租户单列；policy.scope=app保存同一关联。未关联分享方式不产生应用前置条件。

随应用发布不是独立共享授权。内部policy-decisions对scope=app必须接收匹配targetAppId/targetWorkspaceId，否则APPLICATION_CONTEXT_MISMATCH；KB有效期届满POLICY_EXPIRED。关联应用未有生效AG发布记录返回APPLICATION_NOT_PUBLISHED。生效后同时核验知识库和关联应用的实时账户、组织边界、业务线、密级及发布策略，取交集；应用下架/撤权或新策略覆盖后旧访问自动失效。一个请求使用同一账户资料快照，策略记录仍按当前生效事实核验，并拒绝循环关联。

KB-03使用此类应用关联库时，预览、受理、审批向bind_dataset上下文传可选targetAppId。选择来源后可先选目标应用，目标详情通过后自动按该应用重读知识库依据，解决必须先有应用上下文才能核验的依赖；不使用无目标时的旧依据。能力端必须按所选应用和目标工作区核验关联策略，不能把关联库当普通共享库授权。MCP流程不变。

AG-05替代对象为active仓库智能体目录，不是Dify原生应用。使用`GET /api/agent-replacements?sourceResourceId=...&q=...&cursor=...&limit=...`及`GET /api/agent-replacements/{resourceId}?sourceResourceId=...`，代理能力端同名路径。候选按可信申请人对原目录的处置资格及原/替代受众兼容性过滤，不仅检查申请人个人可见权；完整分页后展示，ID唯一、nextCursor显式下一游标或null。

详情必须eligible=true、status=active、audienceCompatible=true，回显sourceResourceId、源原生appId/工作区、替代resourceId/名称/原生appId/工作区、publicationVersionId、policyRef及非负revision。自替代400；同一源原生应用的别名409；资格或范围不兼容403。管理端将源映射与已核验原目录再比较，并在读取替代依据后复核原处置资格，避免预检中撤权。提交后的并发/类型版本门禁在所有异步读取后执行。

受理冻结replacementApplication及agent_replacement修订，与原目录前置条件并列；审批再次比较版本、策略、资格和修订，变化409，不下发。冻结替代目录ID和脱敏映射供执行器原子核验；不自动给用户授予替代应用权限，不允许因推荐替代而扩大公开范围。恢复/换原目录后保留替代ID为待重选提示，可显式清除；不指定替代时保持原下架流程。两选择器使用独立组件键，防止恢复期间残留旧目录控件。

真实dataset_publication关联资格与修订、目标应用上下文、替代目录范围比较及产品原子执行仍待能力端适配；管理策略联动和模拟页面通过不等于生产整单完成。

## KB-03/MCP-02目标Dify应用选择与修订（目标22）

两类绑定的可选目标是原生Dify应用，不是仓库智能体目录。使用`GET /api/application-targets?purpose=dataset_binding|mcp_binding&workspaceId=...&q=...&cursor=...&limit=...`及`GET /api/application-targets/{appId}?purpose=...&workspaceId=...`，分别代理能力端同名路径。purpose/workspaceId必填，候选必须按可信身份、指定工作区和对应绑定用途的配置资格过滤。普通可见/可运行权限、知识库或MCP的使用权限都不足以配置目标应用；未适配501。

列表返回`{items:[{appId,name,workspaceId}],nextCursor}`，三字段1–200字符，所有行属于所选工作区，appId跨页唯一，nextCursor必须非空游标或null；不完整分页/错区/重复整体失败。仅转发已知业务参数，浏览器身份参数不转发，未知凭证和工作流正文不返回。详情必须有同appId/workspaceId/purpose、eligible=true、名称、跨区无歧义targetRef及非负安全整数revision。管理端核验后仅保留appId/name/workspaceId/purpose/targetRef/revision。

MCP表单先选择来源并读取绑定依据，再可选择目标应用；KB选择来源后可先选目标应用，详情通过后按该目标自动重读知识库依据，以支持应用关联库。保存草稿只留targetAppId引用，不保存资格/修订。恢复、切区/申请权限、重新选来源或读取绑定依据后清空目标核验，原ID保留为待重选提示，不能自动放行。用户可显式清除关联后只绑定到工作区。离页/换范围中止旧读取，避免迟到结果恢复旧资格。没有目标应用时不发目标查询、不新增应用前置条件，保持可选语义。

受理按工单固定用途重读目标：KB-03为dataset_binding，MCP-02为mcp_binding。保存脱敏targetApplication并追加唯一`{kind:application_target,id:targetRef,revision}`；冻结原生目标ID、名称、目标区和登记引用。审批按原申请人身份再次读取，撤权403，目标映射/用途/名称/修订变化409；不沿用旧快照。旧待审批单若含目标ID却无已核验targetApplication，须重新申请，不能猜补原目标。

KB-03沿decisionRef回读冻结应用字段及合并前置条件。MCP-02此前payload未带目标ID，现选择应用时必须带targetAppId和decisionRef，即办/审批分支一致；执行器必须回读同执行的获准输入和application_target前置条件，核对原生ID及工作区并原子验证资格/修订，再配置指定应用。不能只把provider加到工作区后宣称目标应用已配置成功；结果证明须覆盖所选目标。目标配置、权限依据或映射变化必须更新登记修订，使旧执行失效。无目标应用继续仅绑定到工作区。MCP来源上下文也按白名单裁剪，未知凭证不落单。

真实Dify按用途的目标候选、资格、targetRef/修订登记和应用配置/证明仍待能力组实现联调；模拟管理端验证不计生产整单。KB-02随应用发布与AG-05替代应用语义不同，另行补齐，不套用这两个绑定用途。

## KB-05处置候选、完整文档清单和范围（目标21）

`GET /api/execution-candidates?ticketType=KB-05&action=dispose_dataset&q=...&cursor=...&limit=...`代理`/internal/v1/execution-contexts/KB-05/candidates`。只列当前可信身份有人工处置申请资格的纳管/共享目录，不能从普通使用或绑定权限推断；不依赖本人当前可配置目标工作区。未知动作或越界分页参数400，未适配501。

响应`{items:[{resourceId,name,source,sourceScopeId,sourceResourceId}],nextCursor}`，source为Dify/RAGFlow，其余四项1–200字符。sourceScopeId是源workspace/tenant，sourceResourceId为原生知识库ID；resourceId为稳定目录ID。ID跨页唯一，nextCursor显式给下一游标或null；完整分页后才展示，重复/循环游标整体失败。身份取服务端会话，浏览器身份参数不转发，未知凭证字段裁剪。

选择后GET `/api/execution-contexts?ticketType=KB-05&action=dispose_dataset&resourceId=...`，同datasetDispositionContext用于预览/受理/审批。资格必须eligible=true，明确知识库名称、来源系统、源workspace/tenant ID、源知识库ID、文档清单快照ID、清单完整=true、唯一文档ID/64位正文指纹、真实影响授权/智能体非负安全整数，以及可执行处置目标清单。前置条件恰一条同目录dataset非负修订和恰一条同文档清单dataset_manifest/sha256。清单哈希由能力端基于完整源文档映射生成，不能拿部分页冒充完整；未知、负或重复前置条件及重复执行目标拒绝。

管理端预览只返回脱敏目录事实、文档ID/指纹和影响数，移除处置目标清单中的产品执行对象；另提供availableActions和disposableDocumentIds（由真实停用映射去重得到）。不支持停用的文档仍列在完整清单中并标为不可选，不能形成无法执行的文档申请。候选与上下文源系统/源范围/原生ID须匹配。嵌套文档、处置目标、告警证据也按白名单复制，不把正文、额外凭证或路径存入工单。

指定文档从清单多选，最多100个；以数组保存，ID即使含逗号也不拆分。草稿增加documentIds引用列表，旧documents文本仍可读取但恢复后不自动带回核验或勾选；恢复、刷新或换目录清空选择/完整清单，须重选，附件仍按本人引用单独重读。切整库/指定文档清空文档选择。证据按设计仅内容违规/权限越界必填，其余可不附；已提供的任何附件仍必须全部通过本人归属核验。

受理重读资格、完整清单及每个选中文档的真实停用映射；无映射409，撤权403。审批重读并比较事实/前置条件，修订或正文/影响变化要求重新申请，均不执行。人工只保存目标、文档数组、原因、事实及附件ID；未知浏览器字段删除。告警由可信sourceEventId和告警证据单独授权，先pause_share成功后才能人工dispose_dataset，保留暂停后的新修订冻结规则和节点查证/重试。公共预览不允许pause_share或携带浏览器告警身份。真实候选/处置申请资格、完整统计/映射、告警和产品原子执行仍待能力组联调。

## KB-03知识库使用/绑定候选与来源依据（目标20）

`GET /api/execution-candidates?ticketType=KB-03&action=bind_dataset&workspaceId=...&permission=检索使用|编排绑定&q=...&cursor=...&limit=...`代理`/internal/v1/execution-contexts/KB-03/candidates`。目标工作区必填，从本人当前可配置Dify工作区选择；permission缺省检索使用。候选仅包含本人已经KB-01纳管的私有目录条目、或当前身份可申请使用的KB-02已发布共享条目。不能用普通个人产品库列表替代共享目录，也不能因源库在他人工作区而要求申请人加入该源区。能力端按目标区、申请权限、可信身份和边界过滤，不支持501。

返回`{items:[{resourceId,name,workspaceId,source,sourceSystem,sourceScopeId,sourceResourceId,ownerAccount}],nextCursor}`。resourceId是纳管/共享目录稳定ID；workspaceId始终为所选目标区，sourceScopeId另存源workspace/tenant，sourceResourceId另存真实产品知识库ID。source枚举本人纳管/已发布共享，sourceSystem为Dify/RAGFlow；本人纳管必须ownerAccount等于可信申请账户。字段非空、最多200字符，ID跨页唯一，分页终点必须null；错区、他人私有库、重复或异常游标整体失败。只返回这八项，未知凭证删除；浏览器身份参数不转发。

选择后显式读取`/api/execution-contexts?ticketType=KB-03&action=bind_dataset&resourceId=...&workspaceId=...&permission=...`。管理端与受理/审批共用bindingContext，要求eligible=true、同目录ID/目标区，以及目录来源、知识库名称、源系统/原生ID/源范围/所有者、组织边界/密级/业务线、允许申请权限、符合的边界匹配结果和policyRef。私人目录必须本人所有，申请权限必须在当前允许列表内。页面核对所选候选的来源、系统、原生ID、源范围和所有者；错配不展示可提交依据。未知字段不返回页面或落单，技术policyRef不在申请表显示。

前置条件必有且仅有一条同目录ID的非负安全整数`dataset_catalog/revision`，代表纳管记录或已发布共享记录当前修订；目录更新/撤销、所有者映射或边界/权限变化必须使其失效。Dify跨workspace复制另须文档清单快照ID、64位源文档版本指纹和恰一条该清单ID的dataset_manifest/sha256相同。拒绝歧义/负修订或任意额外凭证键。能力端按源系统和源/目标范围返回实现方式，管理端重新推导：RAGFlow外部知识库、Dify同workspace授权、Dify跨workspace复制；不得由浏览器指定实现方式。RAGFlow方式必须读取并冻结外部知识库API地址，只接受无用户凭证、查询串或片段的HTTP/HTTPS地址；认证凭证由能力端内部解析，不进入工单。

刷新候选、切目标区/申请权限、恢复草稿清空已验证选择与上下文，须重新选择读取；源快照不保存在草稿。受理重读并冻结；源所有者为本人走即办，否则运维审批。审批重读资格、来源、边界、权限和目录/清单前置条件，撤权403、事实变化409，不下发。申请只保存用途、权限、可选目标智能体和期限，不接受浏览器私带配置。冻结输入带回来源事实、名称/边界/密级/业务线、期限、实现方式、policyRef及全部前置条件。能力端执行时原子复核目录、策略、目标区资格及复制清单，复制映射/查证/结果证明继续按总设计C07处理。

真实私有/共享目录合并枚举、按动作资格、目录修订、文档映射和三种Dify/RAGFlow绑定执行待能力端实现联调；目前的接口/Edge证据使用模拟能力服务，不计生产整单。可选目标智能体当前仍为ID录入，其选择器另行补齐。

## PLG-03插件操作候选与实例依据（目标19）

复用`GET /api/execution-candidates?ticketType=PLG-03&action=install|upgrade|uninstall&operation=安装|升级|卸载&workspaceId=...&q=...&cursor=...&limit=...`，action必须与operation对应，代理`/internal/v1/execution-contexts/PLG-03/candidates`。安装/升级必须先选择本人可配置工作区；卸载可省略工作区，从有处置资格的真实安装登记中发现旧实例，工作区从所选行只读带回。目录下架、当前批准版本消失或本人退出原可配置区不能自动抹去有清理资格的卸载入口，实际清理资格仍由能力端判定。

列表为`{items:[{resourceId,name,source,workspaceId,installationId}],nextCursor}`。安装的installationId必须null，升级/卸载为非空实例ID，其余四个字段均为1–200字符；下一游标必须非空或null。同一插件可有多个实例，以`resourceId+workspaceId+installationId`三元组唯一，不能以resourceId去重而丢掉某个实例。跨页重复三元组、错工作区、缺实例或异常分页整体失败。候选只包含当前身份该操作有资格的对象，未适配501，不能拿普通目录可见权代替。

`GET /api/plugin-operation-context?resourceId=...&workspaceId=...&operation=...&installationId=...`返回脱敏操作依据。升级/卸载installationId必填，不允许从同插件多个实例中任取一个；安装必须为空。安装沿用按目标区的`catalog/plugin/{resourceId}`可信详情，批准目录版本/哈希、名称和installAccess必须有效。升级/卸载读取`execution-contexts/PLG-03?action=...&resourceId=...&workspaceId=...&installationId=...`，必须回显同插件、目标工作区和实例，eligible=true，并提供插件名称、批准版本号/版本指纹、原安装版本号/原安装指纹及权限匹配结果。升级策略必须允许逐个工单升级，且目标版本哈希须有同插件前置条件；卸载的版本/哈希取所选原实例，必须与原安装事实相同，不强求仍存在当前目录版本。

前置条件必须各自合法：恰一条同实例的非负安全整数plugin_installation修订，升级另有同插件plugin/sha256等于目标指纹。拒绝重复实例修订、负值、错误映射和任意额外凭证键。管理端只返回白名单数据；申请仅保存operation、purpose、installationId，忽略浏览器私带配置或凭证。草稿增加installationId引用，但恢复、刷新候选、切工作区/操作均清空依据，必须重新选择；离页中止旧读取。

受理与审批复用同一核验函数，审批同时比较原/目标版本、权限、实例及全部前置条件；撤权403、事实变化409，不下发。升级/卸载通过decisionRef回读冻结实例/工作区/原版本/目标版本/哈希及前置条件；执行器须原子比较并作用于该实例。安装仍走现有批准版本/目标区payload，执行器再次核验安装资格与目标状态，重复安装或在途冲突不得新建第二份实例。真实目录、实例发现、逐动作资格、登记修订和Dify执行适配待能力组联调，模拟页面通过不计生产整单。

## TOL-01工具审批候选与配置依据（目标18）

`GET /api/execution-candidates?ticketType=TOL-01&action=set_tool_approval&operation=首次批准|变更再审|撤销批准&workspaceId=...&q=...&cursor=...&limit=...`代理能力端`/execution-contexts/TOL-01/candidates`。operation必填；首次/变更必须先选本人可配置的工作区，撤销可省略工作区，从当前身份有资格处置的批准登记发现旧工具。撤销的来源工作区从所选候选只读带回，即使产品工具或工作区已不存在也应支持清理登记。未适配501，不回退应用可见目录。

列表只保留`{resourceId,name,source,workspaceId}`；四项均非空且最多200字符，ID不重复，指定工作区时每项必须同区；nextCursor必须为下一游标或null。页面读完分页再展示，循环游标/跨页重复整体失败。仅转发已知业务参数，可信身份由服务端覆盖。resourceId是工作区+提供者+原生工具的稳定候选标识，原生工具ID不能保证跨提供者唯一，不可将二者视为相等。

选定后GET `/api/execution-contexts?ticketType=TOL-01&action=set_tool_approval&operation=...&resourceId=...&workspaceId=...`。同一toolContext函数用于预览、受理和审批。必须回显operation且eligible=true，明确返回原生Dify工具ID、提供者ID/名称、工具名称/版本、schema、输出说明及64位配置指纹。配置来源首次/变更只能为产品现状；撤销可为批准登记，禁止将旧登记伪称当前产品。schema、输出说明和差异摘要由能力适配器脱敏，不得带凭证或秘密默认值。

前置条件必须各有且仅有一条同候选ID的`tool_configuration/sha256`和`tool_approval/revision`：配置哈希须与字段一致，首次批准登记revision=0且无原批准工单，变更/撤销revision>0且必须有原批准工单。变更还必须有原版本、原64位指纹及配置差异数组（每项只含差异项/原值摘要/新值摘要）。上下文未知字段被删除，前置条件不接受任意凭证字段。空差异数组仅表示技术配置未变，业务权限/用途变化仍须人工再审。

刷新目录、切区、切操作及恢复草稿均清空配置依据，必须重选；离页中止旧读取。页面展示脱敏事实，保存草稿只留人工业务字段与候选引用。受理从能力端重读并冻结，安全审批必填结果/意见/对外权限，审批再次比对fields和两个前置条件；撤权403、快照或登记修订变化409，不下发。冻结输入保留原生工具和提供者ID、来源、技术配置、差异及人工审查；执行器写登记前必须原子比较两个前置条件，防止两张审批相互覆盖。撤销无论对外使用选择如何都冻结空使用授权。

管理端有模拟服务下的接口和Edge证据；真实Dify工具枚举、操作资格、批准登记及原子执行适配尚未完成，不能计为生产整单验收。

管理端会话接口：

- `GET /api/workspaces?product=dify&cursor=...&limit=...`：登录后可读，只转发product=dify及分页参数；limit为1–100，游标最多200字符。后端覆盖账户、稳定人员ID、角色、组织和服务鉴权头。返回`{items:[{workspaceId,name}],nextCursor}`，删除对端返回的额外字段，结构不完整返回503 INVALID_WORKSPACE_DIRECTORY。
- `GET /api/resources?kind=...&workspaceId=...&q=...&cursor=...&limit=...`：既有审批前资源接口，增加列表分页转发，详情请求不转发分页。kind仍限定总设计原有7种，不能用额外身份查询参数改变调用账户。

对应能力接口的参数与响应见[能力OpenAPI](../capability-api/openapi.yaml)。没有真实产品适配时显示读取失败，不填入演示ID，不允许直接手输替代目录选择。

ResourcePicker已接KEY-01的Dify应用和MCP-01的技术注册。KEY-01先读取当前账户可用工作区，然后读取该区资源。目录完整读完才展示选项；循环游标、重复ID、结构不完整、应用工作区不匹配及超过100页均整体失败，不把先前成功页作为完整候选。大目录可缩小q搜索。切换工作区清空资源ID及本次核验；刷新目录清空本次核验；恢复/新建草稿重置选择器并取消旧读取。

AG-01/AG-02的应用和KB-01的Dify/RAGFlow知识库也已接ResourcePicker。Dify应用和知识库使用当前账户可用工作区列表，跨页完整读取。选定后useResourceSnapshot读取详情，校验resourceId、snapshotId、capturedAt、data及工作区；RAGFlow必须workspaceId=null且data.tenantId非空。RAGFlow租户ID从可信快照带回并只读显示，列表按调用人实际权限过滤，不用浏览器手填租户作为查询授权。切换来源系统清空旧工作区/租户、资源与快照；离开页面取消未完成读取。

AG/KB草稿仅带回原始引用和业务字段，不能带回本次快照或已核验标记。恢复后必须重新读取工作区/目录并显式选择；仅重新读取目录不会自动选中旧ID。快照校验失败不能提交。AG-01、KB-01在原受理接口再次检查本人所有权、来源范围并保存新读取的快照；页面展示的快照不作为冻结依据。AG-02的原审批、冻结、下发和结果确认流程保持原契约。

KB-02的源知识库也使用该选择器。先选Dify/RAGFlow来源、工作区及知识库并校验详情快照，再读取publish_dataset的文档审查上下文。页面核对上下文来源、源ID、工作区/租户、快照时间、文档数、逐文档ID/正文指纹及清单前置条件；不匹配时不展示分享提交表单。切换源/工作区/资源即清空依据，受理后锁定来源编辑，新建草稿可重新申请。

KB-02草稿新增可编辑字符串sourceSystem，旧草稿未填写时默认Dify，使用者需重新选择真实来源；sourceSystem不代表已校验的产品事实。恢复后保留业务字段，但重新读取资源和审查上下文。RAGFlow租户只从详情带回。提交仍由原后端重读上下文并核验来源/所有者/范围，审批仍按原文档指纹逐项确认，不因新增选择器跳过模型与文档复核。随应用发布的关联智能体ID选择仍待接入。

AG-03与MCP-02使用/api/catalog而非审批前个人资源列表。ResourcePicker完整读取分页后过滤候选：AG只保留active且有发布使用方式及来源工作区的智能体；MCP只保留active、有bind动作且bindingAccess为instant/approval的条目。隔离、下架或不可绑定条目不可选；重复ID或异常分页整体失败。

AG-03不要求用户加入来源工作区。用户选择仓库应用后，从其目录详情核对ID、状态、appId、来源workspaceId和已发布usages，来源工作区只读；不能拿用户可配置的目标工作区列表限制共享智能体。未发布的运行/嵌入/API方式禁用，切换资源去掉不适用方式。受理仍由原后端重读目录与应用快照、检查发布边界，再走公开即办或受限审批。

MCP-02先选择本人可配置的目标工作区，再按该区读取MCP目录。显式读取/api/mcp-binding-context核验同一资源/工作区和bindingAccess；无当前选择或依据时，页面检查不提交。切换工作区、刷新目录、恢复草稿后清空依据，必须重新选择并读取。页面只显示resourceId/workspaceId/bindingAccess，不展示URL指纹。提交后后端重新检查资格和可信指纹，审批与即办分支维持原契约。目标智能体的可选关联字段目前仍为ID录入，候选选择待接入。

AG-04/05使用`/api/catalog?kind=agent&action=republish|withdraw_app`及同参数详情。会话代理允许这两个agent管理动作、skill的withdraw_skill，以及mcp的unbind_mcp/isolate_mcp/withdraw_mcp；其他组合或未知动作400 INVALID_CATALOG_ACTION，版本历史路径不接受管理动作。身份仍由后端覆盖，浏览器动作参数只选择业务用途，不能授予管理权限。能力提供方按可信调用人返回动作候选，actions必须明确包含对应动作；不支持资格适配501，不能回退普通可见目录。此扩展已加入能力OpenAPI、总设计和能力组分工，真实适配待联调。

AG-04可选active/unavailable/withdrawn且有republish资格的条目，AG-05可选active/unavailable且有withdraw_app资格的条目；纯使用权不可管理，已下架条目不可再次申请下架。来源工作区从目录只读带回；选择后读取原目录和当前Dify快照，AG-04展示原/新发布版本及工作流。草稿恢复不能带回资格或快照，须重新选择。管理端受理时、异步源快照返回后和审批时重新核验申请人资格；审批前原appId/workspaceId/publicationVersionId/workflowSnapshotId/policyRef变化返回409 STALE_SNAPSHOT，撤权403，均不产生执行。既有原版本/风险确认/处置范围/生效时间及结果回写规则继续生效。AG-05替代应用目前仍为可选ID录入，选择器和完整展示统计待补齐。

SKL-04使用`/api/catalog?kind=skill&action=withdraw_skill`分页选择，只保留available（兼容现有approved状态）、actions包含withdraw_skill且有当前版本的条目，单纯download或withdrawn不进入候选。选定后GET `/api/execution-contexts?ticketType=SKL-04&action=withdraw_skill&resourceId=...`，管理端走skillWithdrawalContext，读取上下文前后两次查询同身份管理详情；下架资格失效403，版本与上下文不一致409。上下文必须有Skill名称、非空当前版本、非负真实历史下载次数/人数，以及恰一条同资源的非负Skill目录修订；缺失统计不得填假0。

页面显示版本与统计，恢复/刷新目录后重新选择，不恢复统计或资格。提交仍从服务端重读，审批再核验资格、版本和原前置修订，即使修订未变化而版本已变也拒绝；历史下载统计可随新下载增长，不作为审批的相等冻结条件。原交付核对门禁保持：在途/未知交付未核对不得下发，获准文件处置为保留审计副本并禁止下载。真实管理目录/统计/下架及仓库交付协调适配仍待联调。

MCP-03按当前处置动作选择目录。解绑允许清理有资格的active/isolated/withdrawn旧绑定；隔离只接受active，下架接受active/isolated。普通bind不代表处置申请资格。选中后GET `/api/execution-contexts?ticketType=MCP-03&action=...&resourceId=...`，管理端发现当前身份该动作的授权候选，返回标准上下文信封，但fields只含绑定清单快照ID、完整标志和去重{account,workspaceId}，前置条件仅返回本MCP目录修订。providerId、任意额外字段及凭证不返回页面。

单用户解绑必须显式选择一个账户/工作区组合，不能手填目标；选项可涉及多个底层provider。隔离/下架展示完整受影响的账户/工作区，完整标志不为true则拒绝。切换动作会清空资源与目标绑定，刷新目录、恢复草稿也清空依据，均需重新选择。工作区取实际绑定，不依赖本人当前可配置工作区列表，避免无法清理旧授权。

受理和审批由mcpDispositionContext重读资格及真实清单，内部单用户请求追加workspaceId和targetAccount，二者只选择目标、不改变调用身份。针对已选目标的provider清单也必须完整；只保存/冻结该账户与工作区条目。隔离/下架冻结该动作完整授权范围，不能沿用单用户子集。拒绝重复三元组、歧义/负修订、未授权绑定及读取期间撤权；只保留必要字段，未知凭证字段不落工单。审批前绑定或前置条件变化要求重新申请。真实候选、资格、共享provider独立撤权能力及产品处置仍待联调。

KEY-02列表使用GET `/api/key-registrations?action=rotate_key|revoke_key&q=...&cursor=...&limit=...`，要求当前活动会话，limit为1–100，文本参数最多200字符。只转发action/q/cursor/limit，身份头由管理端覆盖，浏览器account等参数不转发。响应逐项校验并裁为registrationId/appId/workspaceId/lastFour/status/revision/actions和可选appName/callerName/callerOrg/environment；keyId、明文、凭证及未知字段不返回列表。分页终点必须显式null，错误元数据或单页重复登记ID返回503。未知action及非法limit返回400。

KeyRegistrationPicker使用共用directory-pages完整读取，拒绝跨页重复ID和循环游标；只展示active/expired且允许当前动作的登记。revoked/rotated/reconciling不作为新操作候选。选择后读取KEY-02的执行依据，显示登记关联的工作区、Dify应用ID、产品密钥对象ID及后四位。恢复草稿或切换动作必须重新选择，草稿只保存原可编辑字段。

keyContext在上下文前后调用能力端登记详情，核验动作资格，并比较appId/workspaceId/keyId/lastFour/revision；上下文应用ID/产品密钥ID/后四位须与详情一致，key_registration前置修订恰一条且相符。工作区从详情读取，上下文若也提供则须一致。未知上下文字段不落工单，前置条件限已知字段。受理和审批重读，撤权403、映射/修订变化409。轮换新钥仍仅由申请人通过原获批工单一次性领取，关闭展示后不再保存明文，不自动再建一把。真实登记/资格/轮换撤销适配仍待联调。

草稿仍只保存资源ID、工作区及可编辑字段。恢复的ID作为待核验提示，不作为已选资源；需重新读取并显式选择，提交前检查阻止未重选的申请。选择结果不等于授权，KEY-01后端重新读取execution-contexts/KEY-01；MCP-01重新读取技术注册快照；无权限、已删除或已失效由原受理逻辑拒绝，不下发能力命令。

本接口不把Dify工具、密钥登记或已安装实例混入dify_app列表。TOL-01、PLG-03等专用候选接口/选择器仍待逐项接入；KB-03/05尚需对应目录与上下文。真实能力端workspaces/resources、登记及管理资格适配仍须产品联调，模拟对端验收不计生产整单完成。

验证：tests/integration/resource-selection.test.mjs；tests/resource-picker-browser.mjs；tests/key-workflow-browser.mjs；tests/application-drafts-browser.mjs。覆盖当前会话身份、分页、异常目录、恢复重选、切区、提交时权限变化及一次性领取。

AG/KB验收：tests/source-resources-browser.mjs，覆盖三种来源的末页、切区/切源、恢复重选、错误快照、所有者变化、服务端新快照冻结及RAGFlow租户；tests/publish-workflow-browser.mjs回归AG-02审批闭环，tests/draft-forms-browser.mjs验证全部25种草稿保留可编辑字段。

KB-02验收：tests/dataset-selection-browser.mjs，覆盖分页、四类依据错配、切区失效、RAG草稿重选、受理时范围变化拒绝与受理后锁定；tests/dataset-workflow-browser.mjs验证未逐文档确认不得执行、确认后审批执行及申请人确认结果。

AG-03/MCP-02验收：tests/access-selection-browser.mjs覆盖来源/目标工作区区别、目录分页过滤、未发布方式禁用、草稿重选、错区详情、绑定资格变化及运维审批下发。原110项接口测试仍覆盖公开即办、MCP即办、审批时指纹变化及真实身份冻结。

AG-04/05验收：tests/integration/agent-management.test.mjs覆盖无资格、预检中撤权、已下架再发布、重复下架拒绝、审批撤权、原版本变化及动作查询限制；tests/agent-management-browser.mjs覆盖分页筛选、版本预览、恢复重选、提交/审批撤权及两类运维审批下发。

SKL-04验收：tests/integration/skill-withdrawal-selection.test.mjs覆盖仅下载权拒绝、依据中撤权/版本变化、负统计、歧义修订、审批撤权与版本变化、动作参数隔离；tests/skill-withdrawal-browser.mjs覆盖分页/资格筛选、统计、草稿重选、审批下发、保留审计副本冻结及结果确认。原management-workflow测试保留在途交付核对门禁，skill-delivery-browser验证实际本地正常下载不受影响。

MCP-03验收：tests/integration/mcp-disposition-selection.test.mjs及tests/mcp-disposition-browser.mjs。覆盖三动作分页、provider裁剪、精确绑定选择、恢复重选、不完整/歧义范围、撤权/绑定变化拒绝、三类审批下发及单用户/完整范围冻结区别。

KEY-02验收：tests/integration/key-registration-selection.test.mjs及tests/key-registration-browser.mjs，覆盖分页/终态过滤、身份与动作隔离、明文裁剪、恢复/切动作重选、读取中撤权/错钥/修订变化、审批复核、轮换撤销下发与一次性领取。共用分页器抽为directory-pages.ts，并回归AG/KB、MCP、Skill选择器及25类草稿。
