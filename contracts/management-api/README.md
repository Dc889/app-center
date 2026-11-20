# 管理端回调

管理员页面的类型版本复制、组织范围及新旧申请边界见[类型版本契约](type-versions.md)。

人工表单工作区/资源目录的会话代理与恢复重选规则见[资源选择契约](resource-selection.md)。

人工草稿的会话API、字段白名单、提交来源和恢复流程见[申请草稿契约](application-drafts.md)。25种人工表单已接入完整页面链路。上传和证据恢复时重新读取引用，不保存产品快照。

页面端业务工单“查证原执行”的权限、请求、结果判定及重启语义见[业务查证契约](reconciliation.md)，它不是服务回调，也不提供产品补偿入口。

独立管理服务按执行 ID 返回冻结输入，服务身份及响应见 [OpenAPI](openapi.json)。策略复核、账号最终提交及交付关闭查证已有管理端实现，真实身份目录、完整资源映射和产品适配仍待接入。Skill关闭/取消及发送证据语义见[交付关闭契约](delivery-close.md)，真实组件cancel与仓库终结尚待实现。

KB-02/04的冻结文档结论使用 /approved-inputs/{executionId}/documents 分页读取。KB-04系统起草入口为 /dataset-changes，KB-05告警入口为 /dataset-alerts，均要求服务token，普通页面不能调用。管理端已实现幂等与持久关联，真实检测器及证据适配尚待接入。

PLG-04入口为 /plugin-alerts，服务端读取可信比例、实例与禁用周期后去重。恢复和观察通过同一工单生成独立执行节点；失败禁用记录紧急EVT-01。状态和请求见OpenAPI及能力组件分工文档，真实采集/定向适配未完成。

ACC使用 /subjects/{subjectId} 读取非秘密身份映射；两产品核验后调用 PUT /account-changes/{executionId}/commit。回调只接受四个映射字段，本平台角色/组织等从同一活动执行的获准输入提交。相同内容重放返回原修订，旧执行、错对象、错工作区及改内容重放返回冲突。身份登记当前仍由可信启动数据初始化，登录仍是演示入口。

ACC查证与安全解锁为管理端会话入口 `/api/account-applications/transition`，不对组件开放。管理员只能要求后端读取原执行或核验能力端封存证明；恢复证明从服务接口直接获取，不能由浏览器提交。完整请求、错误与跨服务字段见[账号恢复契约](../capability-api/account-recovery.md)，组件真实证明接口待实现。

总览实时台账与产品采集边界见[overview.md](overview.md)；能力聚合使用独立overview-summary端点，原observations事件分页不变。

安全事件监控、统计窗口、处置时长及五块证据读取见[event-monitor.md](event-monitor.md)。逐步产品API证据尚未采集，关联执行摘要不得冒充调用日志。

审计追踪汇总、来源区分、排重与同范围导出见[audit-report.md](audit-report.md)。能力侧观测沿用既有 `/observations?view=audit` 协议，目录变更及真实产品审计采集仍待能力组联调。

Skill 监控真实结算流水、生效目录指标与去重下载人统计见[skill-monitor.md](skill-monitor.md)。普通用户拒绝访问，运维限制所属组织，管理员支持全量审计。

知识库监控两产品库盘点、来源分布、构建任务趋势与追踪、嵌入模型核对、逐文档审查台账及处置告警见[knowledge-monitor.md](knowledge-monitor.md)。普通用户拒绝访问，运维限制所属组织，管理员支持全量审计。能力侧未采集安全降级为 null。

插件监控工作区安装实例、容器内存趋势、调用失败率、错误排行、自动禁用记录及Daemon探测见[plugin-monitor.md](plugin-monitor.md)。普通用户拒绝访问，运维限制所属组织，管理员支持全量审计。未采集指标安全降级为 null。

MCP 监控目录盘点、五卡指标、调用与延迟切桶趋势、异常排行、调用明细追踪台账、工作区绑定台账及告警处置追踪见[mcp-monitor.md](mcp-monitor.md)。普通用户拒绝访问，运维限制所属组织，管理员支持全量审计。能力侧未采集安全降级为 null。

智能体监控（Dify 全量）盘点全部开发账户与应用树、未进仓库应用、多维调用审计（支持 IP、模型、知识库、MCP 与插件过滤及全文搜索）与逐条调用依赖溯源见[agent-monitor.md](agent-monitor.md)。普通用户拒绝访问，运维限制所属组织，管理员支持全量审计。未采集指标安全降级为 null。

账号与集成监控平台三方映射核对、接口健康与耗时趋势、账号差异分布、适配同步作业台账与接口探针健康探测见[account-monitor.md](account-monitor.md)。普通用户拒绝访问，运维限制所属组织，管理员支持全量审计及跨组织核对。未采集指标安全降级为 null。

智能体仓库目录盘点、四卡指标、调用排行、使用方式开通与迭代历史（支持用户组织隔离、工单号遮蔽、可用性筛选与下架/再发布工单联动）见[agent-warehouse.md](agent-warehouse.md)。全量消除前端静态Mock。
