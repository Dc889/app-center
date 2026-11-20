# 业务工单原执行查证

该入口属于管理端会话API，覆盖applications台账的业务工单。ACC使用[账号恢复契约](../capability-api/account-recovery.md)，SKL-03文件交付台账及关闭/取消另行处理。

`POST /api/applications/transition`，同源请求、当前有效运维身份，JSON如下：

```json
{"ticketNo":"KB-04-example","revision":4,"action":"查证原执行","note":"核对原目录审查结果"}
```

工单必须有当前command且尚无已确认终态result。管理端先按revision核验，保存办理人、原executionId、意见、前次错误码及审计快照，再以服务身份调用 `GET /internal/v1/executions/{executionId}`。本次查证不调用POST执行、cancel、产品接口或密钥明文接口，不接受浏览器提交的执行结果，不改获准输入。每单与自动投递/轮询共享互斥锁；重复旧版本返回409 VERSION_CONFLICT，查询正在进行时返回409 EXECUTION_BUSY。管理员和申请人都不能办理此动作；返回前重新检查运维身份修订，已失效则403 OPERATOR_SESSION_CHANGED。

200返回当前管理工单，**不表示查证已经成功**。页面读取deliveryBlocked、lastError、execution.status和业务状态；404/权限/冲突/非法结果保持阻塞，503/网络异常保留最近错误及重试可能性。所有接单和查询都必须返回原executionId、ticketNo及完整公共字段，缺ID兼容已移除。非终态result必须为null，终态必须有完整result，时间不得倒退；全部字段及错误见[执行响应校验契约](../capability-api/execution-response.md)。KEY结果通过结构校验后继续按白名单脱敏。

所有原有成功判据照常运行：KB-04目录状态须等于批准的新目录状态；PLG-04须是同安装实例的已禁用/已启用状态；密钥结果只保存原脱敏白名单，不保存或返回组件夹带的secret。合法非终态恢复轮询，合法终态进入原办理节点并写入当前attempt；不能覆盖已确认终态、改写成功前序节点或生成新executionId。已确认failed的业务重试仍走单独“重试执行”，并核验retryable。

从服务成功读取或接到执行响应后保存executionKnown；即使随后业务结果校验失败，也不能在后续404时重建执行。重启保留这一事实。新业务尝试及KB-05二次处置、PLG-04新的禁用/恢复节点使用新执行ID时重置此标记。旧记录已有execution同样视为已接单。只有从未观察到执行的原待发记录，才允许在404后校验当前有效申请人、下架交付条件并以原ID补投。

读取已接单结果使用服务身份，可以在申请人改名或受限后继续；这不授予申请人新写入或下载权限。Skill下架的活动交付条件阻止新下发，但不阻止读取已接单下架执行。待办包括阻塞及仍有非终态当前执行的工单，运维在详情填写办理意见后查证；管理员在查询中只读。

验收：dataset-changes.test.mjs覆盖结果不符、错误/缺失执行ID、错误工单、非法状态、过早result、404重启、原执行恢复、并发和终态不可覆盖；plugin-safety.test.mjs覆盖原安装实例成功判据及紧急事件保留；application-reconciliation.test.mjs覆盖旧名不重建、已接单结果继续读取和密钥明文不落盘；dataset-changes-browser.mjs覆盖实际页面办理和管理员只读。产品侧真实查证来源仍由能力组件实现及联调，管理端不据模拟结果宣称产品副作用已验收。
