# 安全事件监控与证据读取

## 权限与接口

GET /api/event-monitor 接受 range=1h/24h/7d、q、status、objectType、severity、page、limit，只允许有效运维和管理员；用户、未登录、限制中账号403。窗口/筛选/分页非法400。q最多200字符，匹配事件ID、工单号、对象ID/名称。page正整数，limit默认50、范围1–100。统计与分页使用同一筛选全集，首次时间降序、工单号升序，首次时间缺失排最后。

GET /api/event-monitor/{ticketNo} 读取指定EVT-01的五块证据；格式错误400，不存在404。两个接口均只读，不调用能力组件、不下发动作。运维从原待办办理，仍遵守独立复核；管理员只读。运维裁剪ACC关联号和执行，管理员可见已关联ACC；事件范围与既有事件查询一致。

## 六个区块的数据口径

1. 未研判/处理中/待复核取当前状态；紧急取研判级别优先、原始级别兜底且未关闭的事件；今日关闭为当前已关闭、最近关闭发生在今日的事件数，业务日按Asia/Shanghai。重复读取不增加计数。
2. 趋势新增按firstOccurredAt、关闭/重开按真实历史转换计次，入库端仍须按原告警ID去重。1h/24h为5分钟桶、7d为1小时，首尾为部分桶；UTC左闭右开，to为当前读取时刻加1毫秒。未知首次时间不猜，返回unknownTrendTimes。轮询不增加转换次数。
3. 分布以研判后级别优先、原始级别兜底，均缺失单列未采集；对象为设计规定六类，统计当前筛选全集。
4. 平均时长/P95仅使用已关闭且首次到最近关闭时间完整有序的样本，包含观察和重处置历时；P95采用最近秩ceil(0.95*n)。返回有效count及缺失excluded，无样本均值/P95为null，不填0。台账进行中历时截至读取时刻，不混入关闭样本。
5. 台账显示事件ID、首次时间、对象类型/名称、规则、原始/研判后级别、结论、状态、办理人、时长及关联单号；名称缺失以已知ID显示。分页仅影响台账，不缩小统计全集。
6. 证据固定基本信息、指标阈值、脱敏日志、API动作、状态时间线五块；来源缺失有空态，人工报告无时序指标，不拼造曲线，不提供桌面推演或独立执行入口。

新创建、处置、复核和观察到期动作写入fromStatus/toStatus。旧历史不可变，只按已知动作推导，无法推导显示未采集。缺首次时间可用已知创建动作兜底，不能用任意历史首条替代。lastOccurredAt保留原始最近发生时间，不取最新审批时间。

## 证据来源限制

可选evidence.metrics为{resourceId,alertId,unit,points:[{at,value,threshold}]}，对象和事件必须精确匹配，最多2000点，UTC递增且非未来，数值有限。按规则原始单位展示，不把单个窗口扩为连续观测。错事件/倒序整组拒绝。当前人工报告及禁用失败升级通常无该序列，真实采集仍待生产接线，测试样本不代表已接通。

evidence.logs只接受redacted=true、同对象、UTC非未来、INFO/WARN/ERROR/FATAL级别的日志，投影at/source/level/message，最多200条，并遮蔽常见Bearer/token/password/secret/api_key形式。未知字段、连接配置、工作区凭证、原始payload/details不输出。无合格日志显示未采集，不宣称零日志。

API动作区目前显示同对象已关联执行的持久结果摘要，按executionId去重，当前最新结果优先，旧尝试逆序补充；排除未关联、异对象及不可见ACC。不把下发意图当执行成功。at为结果updatedAt，adapter=null，actionSource=linked_execution_snapshots。真实逐步API调用、适配器和原始调用时间仍待能力端可信证据，不以结果摘要冒充。

## 验收

tests/integration/event-monitor.test.mjs覆盖统计、日期边界、分布、均值/P95、缺失时间、筛选分页、证据校验/脱敏、执行去重、账号隔离、只读权限、独立关闭和重启。tests/event-monitor-browser.mjs覆盖六区块、五块证据、分页筛选刷新、原始单位、人工空态和管理员只读。tests/event-workflow-browser.mjs保留报告到双人复核关闭流程。整单及真实产品采集完成度另行统计。

## 返回结构

汇总返回source/capturedAt/timezone、window、cards、trend、distribution、durations、unknownTrendTimes、total/page/limit/items。window含range/from/to/bucketMs/partialBoundaryBuckets；cards键为unassessed/handling/review/urgent/closedToday；trend每桶为at/added/closed/reopened；distribution每行为severity及六类对象计数；durations每行为objectType/count/excluded/meanMinutes/p95Minutes。

items每项含ticketNo/eventId/creationMode/objectType/resourceId/name/ruleCode/originalSeverity/assessedSeverity/severity/conclusion/status/handler/firstOccurredAt/lastOccurredAt/closedAt/durationMinutes/durationKind/revision/relatedTicketNos。缺事实为null，severity缺失单列未采集，durationKind为closed或elapsed，revision为原事件修订。没有事件时items为空、可确定的计数为0，时长仍null。

详情返回source/capturedAt/basic/facts/metrics/metricState/logs/logsState/actions/actionSource/timeline。basic为同一事件投影并附history；metrics缺采集为null，metricState为collected/not_collected；logs缺采集为空数组且logsState=not_collected；actions每项为executionId/ticketNo/at/adapter/resourceId/action/result/errorCode；timeline每项为id/at/actor/action/fromStatus/toStatus/note，未知状态或时间为null。actions为空只表示没有已采集关联结果，不表示没有发生下游调用。
