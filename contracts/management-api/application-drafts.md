# 人工申请草稿与提交关联

草稿是申请人的可编辑备忘，不是审批依据。适用的25种人工类型及字段白名单见[draft-fields.json](draft-fields.json)；KB-04、PLG-04为系统转单，不允许人工草稿。业务提交仍由原接口重新核验身份、资源、上传、扫描、类型与授权，不接受草稿内的产品事实或凭证。

## 会话接口

| 接口 | 请求与返回 |
| --- | --- |
| GET /api/drafts | 本人列表，含draftId、ticketType、ticketTypeVersion、fields、revision、status、updatedAt、canRestore、canRecover、restoreBlockedCode及提交关联。ACC仅当前管理员身份可见。 |
| POST /api/drafts | `{draftId,ticketType,revision,fields}`；首次revision=0，更新须当前修订，200返回新草稿。 |
| POST /api/drafts/restore | `{draftId,revision}`；200返回当前可编辑草稿，其他人404，修订/状态/类型失效409。此调用不采信或恢复产品快照。 |
| POST /api/drafts/recover | `{draftId,revision}`；仅确认处理已停止且没有来源匹配的受理工单时，解除未受理提交意图并返回可编辑草稿；仍有活跃处理或已受理不得恢复。 |

POST要求同源有效会话；ACC限管理员，目标受限账号仍按管理端原权限规则处理。归属优先用稳定人员ID，旧草稿按可信历史别名识别，不因改名改写原创建账号。保存有当前修订条件和数据库事务；并发旧版本409 VERSION_CONFLICT，不覆盖新版本。

fields只接受每类可编辑字段。secret/token等未知字段、产品snapshot/扫描对象、任意嵌套对象均拒绝；上传和证据只能保存ID引用，最终归属及可用状态由原提交接口重新读取。字符串、列表和网络声明记录受类型/数量及JSON大小限制。说明文本本身仍是用户内容，不能把白名单误解为可自动识别文字中任何秘密。

日期保存为有效UTC RFC3339（Z或+00:00）；页面从datetime-local转UTC，恢复时转回当前浏览器时区，保持同一时刻。类型版本在保存时冻结；停用或版本变化禁止恢复/静默覆盖升级，列表给出阻塞原因，应核对后新建草稿。旧已存事实不回填。

## 提交来源与崩溃恢复

人工提交到 /api/events、/api/applications、/api/account-applications、/api/tickets 或 /api/execute 时，可在原正文增加 `draft:{draftId,revision}`。不带draft的旧客户端仍走原规则；带draft必须本人拥有、类型及工单号匹配、版本有效。草稿开始提交后不可改写字段。

管理端先持久化status=submitting、原工单号、原草稿修订、请求指纹、处理标识和进程。指纹按语义排序后的请求生成，仅保存摘要，不额外保存原始请求或凭证。在受理工单的同一记录写入服务端originDraft，包含草稿ID/修订/请求指纹，客户端不能伪造该来源。后续归档只承认真实工单中匹配的来源证据，不因工单号相同就把其他工单算作本草稿已提交。

草稿库与业务库分别持久化，不宣称跨库事务。来源匹配的工单一旦已落库，即使执行接单响应丢失，草稿也应关联到原工单并置submitted；重启/列表查询会补齐归档。工单未受理的明确校验错误回到draft并增加修订，需使用新修订继续。已受理草稿只查看关联工单，不能恢复编辑或换请求重用。相同原草稿修订、工单号、接口及请求指纹的重试沿原工单执行；变更内容返回DRAFT_SUBMISSION_CONFLICT。

同机多服务实例共享SQLite的提交互斥已测试。活跃claim不允许并发预检或恢复；其他进程存活不明时保留限制。若已确认原处理结束且没有受理记录，recover才释放提交意图，保留审计。由于原处理停止、且所有下发都在工单落库之后，不能从此入口跳过已受理执行查证。跨主机进程协调仍需另行部署验证。

## 页面与当前覆盖

useApplicationDraft提供保存、恢复、UTC转换、提交关联和归档刷新，ApplicationDrafts提供操作入口。发生并发冲突时，刷新列表不把旧编辑内容自动套上新修订；必须显式恢复新版本。恢复调用方必须清除产品上下文/快照和只读结果，并重新读取资源与引用。归档后不能继续提交同一草稿，需明确新建。

25种人工类型的页面均已接入：AG-01至AG-05、KB-01/02/03/05、MCP-01/02/03、SKL-01至SKL-04、PLG-01/02/03、KEY-01/02、TOL-01、ACC-01/02、EVT-01。KB-04和PLG-04仍禁止人工草稿。旧事件草稿控件已移除，EVT-01提交写入来源并归档。仓库卡片上的Skill直接下载仍调用原工单接口，不创建可编辑草稿；手工申请中的SKL-03先按当前目录重新定位资源。

恢复上传时只带回intakeId，并按种类重新读取扫描和归属；扫描未通过时不能提交，也不重新上传文件。恢复证据时只带回附件ID，并用forApplication=1按本人重新读取文件名；缺失或非本人的引用不能提交。文件正文、扫描对象和包身份不写入草稿。

验收：application-drafts.test.mjs覆盖白名单、类型失效、归档/重放、受理响应丢失、跨实例互斥和崩溃窗口。draft-forms-browser.mjs覆盖25种页面的恢复、保存和零执行下发。upload-draft-browser.mjs覆盖Skill与插件待审引用。evidence-draft-browser.mjs覆盖证据引用再读取。application-drafts-browser.mjs覆盖KEY-01的跨页面恢复、UTC、并发冲突及归档。发布、知识库、账号、事件和实际本地Skill交付Edge已回归。
