# 总览台账与产品观测

`GET /api/overview?range=1h|24h|7d` 只允许当前有效运维或管理员会话；普通用户403、非法窗口400，限制中的账号403。浏览器不能用身份头提升角色。异步读取完成后再核对人员状态、修订及账号限制，失效时不返回数据。

管理统计由 applications、tickets、reported-events、identity-workflows 当前持久台账合并，同工单号只计一次，不把执行尝试当新工单。运维不读取/返回账号台账；管理员增加ACC统计和操作记录，但业务办理权限不变。人工上报计事件待办，不冒充系统告警；未关闭系统告警按事件工单计数，关联业务单不再算一条告警。来源采集器须先按原设计以原始告警ID去重。告警分提示/一般/严重/紧急，未研判且无原始等级单列；按对象类型堆叠，对象Top10按告警数降序、资源ID升序，显示最高已知等级。

待办在五种设计状态之外保留实际的执行中、待领取、待确认、待查证等状态，不能静默遗漏。未办结总量不等于当前角色可操作量；明确显示补正/领取/确认可能由申请人办理。终态不计待办。最近20条操作显示历史发生时间、对象、事件级别、当前工单状态、关联单号及当时操作账号；缺历史对象字段不回填猜测，无记录显示0。管理统计刷新即重读，范围是当前全量，不随趋势时间窗过滤。

产品观测调用新增的 `GET /internal/v1/overview-summary`，与已有分页事件 `/observations` 分开。原 observations 的 view、source、分页及 availability 协议不改变。聚合契约见[总览能力快照](../capability-api/overview-summary.md)及同目录schema。管理端目前仅实现消费者；执行器尚无此聚合采集实现，404/501/超时均显示未采集，不算产品联调通过。

返回 `{window,resources,health,calls,exceptions,management}`。管理组响应的产品组为 `{state,source,capturedAt,reasonCode,data}`，state为collected/unavailable/stale。resources每项 `{key,state,count,delta}`：昨日同口径快照缺失则delta=null，未采集count=null。窗口已过部分分钟不参与趋势，1h/24h按5分钟、7d按1小时，均为UTC左闭右开；服务端对齐完整桶并要求下游精确回显from/to/bucketMs及scope。趋势数据必须包含完整连续无重复的桶和规定全部序列；采集到无调用时才为0，部分采集整组不展示为零线。

四个观测组独立校验；一组损坏不影响真实管理台账或其他组。组采集超过5分钟标stale且保留来源/采集时间，健康每项再检查checkedAt，未来超过5秒拒绝。过期探测不得显示正常。六种服务可分别未采集，缺实例/版本/探测证据不补猜；latencyMs、consecutiveFailures缺事实为null。只显示探测依据编号，不生成虚假健康处置或自动执行。未知字段白名单裁剪，凭证/产品正文不返回浏览器。顶部和侧栏不再展示固定待办、告警数或固定健康结论。

验收：tests/integration/overview.test.mjs 与 tests/overview-browser.mjs。浏览器使用显式测试快照，生产代码不导入tests/support/overview.mjs。
