# 执行响应校验契约

管理端在账号、业务及文件三个台账的接单/查询，以及文件回执/取消响应上统一使用 `runtime/execution-state.mjs`。旧自动投递缺执行ID或缺结果字段的兼容已移除；提供方必须直接返回完整响应，管理端不猜ID、不补时间、不生成默认业务成功。旧已存历史保留原样，不借升级回填事实。

## 公共信封

`executionId,ticketNo,status,updatedAt,delivery,result` 全部必填，前两项必须精确匹配已冻结命令。updatedAt为有效UTC RFC3339时间（Z或+00:00，最多三位毫秒），不接受无时区、非法日期、倒退时间。状态仅queued/running/awaiting_delivery/reconciling/succeeded/failed/cancelled。

| 状态 | delivery | result |
| --- | --- | --- |
| queued/running/reconciling | null | null |
| awaiting_delivery | 完整Skill交付对象，仅SKL-03/download | null |
| succeeded/failed/cancelled | null | 完整结果对象 |

非终态带result、终态缺result、非交付状态带delivery均拒绝。已确认终态不能回退、改变结果或换流水。读取到过响应但解析/校验失败，也保存已观察执行的事实；后续404不据此重新POST。错误响应原文及夹带秘密不保存到历史，只保存错误码/时间；获准输入和既有有效结果保持不变。

## 终态结果

`ok,failureCode,failureReason,retryable,resultId,version,sha256,details` 全部必填。ok/retryable是布尔值，details为对象；其余是字符串。成功必须ok=true、retryable=false、失败码和原因均空字符串。失败或取消必须ok=false、失败码/原因非空，resultId/version/sha256为空字符串；取消不可重试。非文件成功的无适用版本/摘要使用空字符串，非空摘要须为64位小写SHA-256。每个动作仍需核对专用业务结果，此公共结构不代替KB-04/PLG-04等成功判据。

下载成功的resultId必须非空并匹配已知原预约，版本与摘要必须精确匹配原命令。本地没有完整发送记录或待回执事实时，不因组件单独声称成功就完成下载工单，返回LOCAL_DELIVERY_REQUIRED。回执响应只接受符合上述结构且属于原执行/工单/流水的succeeded；错误或丢失响应保留待回执和receiptError，继续幂等结算。

## 等待文件的元数据

delivery包含 `resultId,version,sha256,filename,contentType,sizeBytes`。resultId为1–160字符，仅ASCII字母、数字、下划线和连字符，不允许拼接路径；版本、摘要等于原命令；filename为1–255字符，禁止路径分隔符及控制字符；contentType为有效MIME形式、最多255字符且无控制字符；sizeBytes为0到9007199254740991的安全整数。首次有效交付元数据冻结，之后同预约的名称、类型、大小、版本、摘要、流水ID不能变化。

发给浏览器前核对实际文件摘要、实际长度及下游摘要/长度头，并要求长度与原交付元数据一致。旧成功记录没有原交付元数据时拒绝重新取文件（DELIVERY_METADATA_REQUIRED），不以当前文件猜补旧事实。

## 错误与恢复

| 错误码 | 含义 |
| --- | --- |
| EXECUTION_MISMATCH | 执行ID或工单号缺失/不符 |
| INVALID_EXECUTION_STATE | JSON、状态、时间或公共必填字段非法 |
| INVALID_EXECUTION_RESULT | 终态/非终态结果组合或必填结果字段非法 |
| INVALID_EXECUTION_DELIVERY | 交付状态、版本、摘要或元数据非法 |
| DELIVERY_RESULT_MISMATCH | 下载成功流水/版本/摘要与原预约不符 |
| DELIVERY_METADATA_CHANGED | 同预约冻结元数据变化 |
| STALE_EXECUTION_RESULT / EXECUTION_TERMINAL_CHANGED | 时间或已确认终态倒退/改写 |
| LOCAL_DELIVERY_REQUIRED / DELIVERY_METADATA_REQUIRED | 缺本地发送证明 / 缺原交付元数据 |

错误均按409记录并阻止错误回写。业务及账号通过原查证入口恢复；文件协议错误会保存protocolBlocked，停止后台自动轮询，但运维可在“Skill文件执行待办”填写意见，调用只读 `POST /api/tickets/{ticketNo}/reconcile`，正文 `{executionId,note}`。该入口只GET原执行，不POST重建或cancel，也不提交回执；缺执行返回404保留限制。合法响应恢复原状态，身份必须仍为当前有效运维。管理员及用户不能代办。已获准取消的执行可在只读模式核对原终态，不额外发cancel。

KEY-01/02在通过公共结构校验后仍只保存脱敏白名单，保留完整公共协议字段，不保存secret或原始details；既有规则、人员、节点和审批校验不变。模拟对端由测试侧从实际接单命令显式构造完整对象，负向用例直接发送缺字段/错误对象；测试构造器不会进入生产解码路径。

验收见execution-state.test.mjs及三个台账的缺字段/错流水集成场景；实际本地Skill交付与受影响的Edge流程单列。公共协议通过不能替代真实产品操作或27种工单全部分支验收。
