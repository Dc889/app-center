# 总览能力快照（新增聚合读取，不改变事件分页协议）

`GET /internal/v1/overview-summary?view=monitor&scope=user_network&range=1h|24h|7d&from=UTC&to=UTC&bucketMs=300000|3600000`，Bearer服务令牌和可信x-account/x-subject-id/x-org/x-role由管理后端生成。只允许运维/管理员，普通用户403。scope指部署的当前用户网络分区，由身份及部署配置限定，不能由浏览器选择其他分区。from/to/bucketMs须对应range完整窗口：1h/24h为5分钟桶，7d为1小时桶。

响应必须回显scope/from/to/bucketMs，包含resources/health/calls/exceptions四组；schema见[overview-summary.schema.json](overview-summary.schema.json)。每组 `{state,source,capturedAt,data}`，state=collected/stale；从未采集或当前无法形成完整快照时返回 `{state:unavailable,source:null,capturedAt:null,data:null,reasonCode}`。有旧完整快照可标stale保留原时间；不得刷新时间冒充新采集。source是采集器/快照来源标识，不能是口令或连接串。每组采集超过5分钟为过期，单项健康checkedAt亦独立检查。future容差5秒。未知组数据不能填0。

先按总设计§2.4身份与分区规则裁剪，再聚合；统计前按(source,eventId)去重，执行/下载按executionId、最终结果按原结算规则。重放、轮询、交付中断、文件重复下载不增加成功；审批驳回不当作执行失败。不得用安装数替代插件调用、绑定数替代MCP调用。不得带ACC账号工单、凭证、检索正文、原始连接地址；总览资源数不包含账号指标。能力组维护可信源到聚合的映射及可复核快照，不要求管理端拉全量调用日志作计数。

- resources：固定agents/datasets/tools/plugins/skills/mcp/keys七项，按总设计已发布/已分享/已批准/已上架/正常/有效口径采集库存。每项state=collected时count为非负整数，yesterdayCount为同分区同指标昨日快照整数或null；该项未接入时state=unavailable且两个数均null。不能从管理工单数量推导产品库存。
- health：固定management/ragflow/dify/plugin_daemon/object_store/database六项。已探测项必须有instance/version/checkedAt/evidenceRef、healthy/degraded/failed状态；latencyMs及consecutiveFailures只能来自真实探测及持久检查历史，无来源为null。未采集服务用status=unavailable，其余六个值均null。管理请求返回成功不能充当全部服务健康证明。详情仅evidenceRef安全编号，不返回URL/凭证/原始错误堆栈。
- calls：完整连续桶，每桶 `{at,agent,retrieval,mcp}`，成功/失败等实际发起调用总量按统一事件来源结算，三序列均有确定采集能力时才标collected；否则整组unavailable或旧完整stale，不拼凑零。
- exceptions：完整连续桶，每桶 `{at,agent,dataset_build,plugin,mcp}`，按可信最终失败事件计数；无真实来源不得标collected。字段表示智能体调用/知识库构建/插件调用/MCP调用失败。

响应不写入工单、不改变目录、不自动处置。管理端对损坏组降级未采集，对过期组明显标注。新端点的生产采集尚待能力组实现；当前执行器404由管理端安全降级。原 `/observations?view=audit|monitor|integration&source=...&limit=...&cursor=...` 继续承担事件分页、审计和监控明细，原 `/inventory` 继续承担产品完整清单及历史库存；聚合可复用它们的可信采集结果。
