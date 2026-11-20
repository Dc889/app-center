# ACC失败查证与安全解锁契约

本契约对应管理端已实现的恢复入口。能力端的真实RAGFlow/Dify查证、补偿与封存仍待实现，不能把模拟对端通过当作生产完成。数据结构见[OpenAPI](openapi.yaml)的AccountRecoveryBaseline与AccountRestorationProof。

## 原执行查询

管理员在 `/api/account-applications/transition` 提交 `{ticketNo,revision,action:"查证原执行",note}`。仅查询当前非终态执行，沿用原executionId调用 `GET /internal/v1/executions/{executionId}`，本次办理绝不POST执行。原执行已接单后再404会停止自动投递并保持目标限制；重启同样不重建。结果为reconciling时继续等待；上游成功必须已有同执行的本地commit才进入结果确认。查证入口不生成新执行、不改获准输入、不直接提交身份。

## 审批前产品基线

能力端 `GET /execution-contexts/ACC-01` 或 `ACC-02` 可返回recoveryBaseline，必须从真实产品读取，禁止用管理端角色默认值推断产品状态：

```json
{"ragflow":{"accountId":"rag-person-chen-yu","account":"chen.yu","active":true,"permission":"个人"},"dify":{"accountId":"dify-person-chen-yu","workspaceId":"ws","account":"chen.yu","active":true,"role":"成员"}}
```

管理端只冻结这些白名单字段，同时核对产品ID、workspace及原权限与上下文fields一致。`ragflow.account` 与 `dify.account` 表示产品侧登录标识（Dify、RAGFlow 原生为登录邮箱），不要求等于本平台账户名；`ACC-02` 仅修改本平台账户名，两端保留原登录邮箱并按稳定用户 ID 关联，不向 Dify/RAGFlow 发起改名写请求。批准时重读且完全一致。原产品账户不存在时accountId为null、active为false、权限/角色为null，account仍为原申请账户名或待开通标识。已存在账户必须有实际权限。Dify工作区无适用值传null。产品端“active”必须表示实际可用/停用状态，不能只证明账户对象存在。若部署无法查清这些事实，省略recoveryBaseline并阻止后续解锁；不能生成假基线。

## 恢复证明及执行封存

失败后的补偿由能力组件按获准输入和原执行负责，管理页面没有补偿参数入口。能力端完成查证后，提供只读服务接口 `GET /internal/v1/executions/{executionId}/account-consistency`，Bearer服务鉴权。响应字段全部必填：

| 字段 | 含义 |
| --- | --- |
| proofId | 1–160字符的持久证明编号，关联内部产品任务和查证记录，不含凭证 |
| executionId / ticketNo / subjectId | 原执行、原工单、目标稳定人员ID，不能使用旧名作唯一关联 |
| identityRevision / productMappingRevision | 原执行获准preconditions中的identity_mapping与product_account_mapping修订，并非补偿后的最新修订 |
| executionStatus | failed或reconciling；只有failed可解锁 |
| sealed | 只有true可解锁：原执行与其下游任务已停止，迟到写入、重放和自动重试不会继续改变产品；必须持久化，重启不能恢复写入 |
| outcome | restored、partial或unknown；只有restored可解锁 |
| checkedAt | 本次请求重新查证的UTC时间，允许两端最多60秒时钟偏差；不可直接返回过期缓存时间 |
| products | 与recoveryBaseline同结构的本次实际产品事实；两端全部字段须等于原基线 |

sealed证明必须同时覆盖原执行的所有尝试步骤、下游任务及已发出但尚未确认的请求。若仍有迟到副作用或无法核实缺失账户已删除，返回unknown/partial或sealed=false。不得只因本地worker退出就封存。服务不得把本地缓存的期望值作为products实际值。权限恢复、账户名恢复、启停状态、产品映射、工作区归属任一项未知都不能返回restored。

## 管理端解锁

管理员提交 `{ticketNo,revision,action:"核验恢复并解锁",note}`。浏览器提交的proof/products不作为证据；管理后端直接查询上述服务。条件为当前工单执行失败、当前目标锁与原身份修订匹配、没有本地commit、有审批前基线、可信证明全部匹配。等待期间账号办理互斥；返回后在事务内重新核验管理员仍有权限、工单修订与目标锁。

满足条件时，原子释放目标锁及新名预约，工单置已终止，保存恢复证明与管理员审计；原failed结果及历史尝试保持原样，本平台身份修订、账户名、角色与会话不变。原执行后续commit或工单重试返回409。新业务需要重新申请、重新预检。重复旧版本请求返回409，不能重复解锁。未知、部分恢复、旧基线缺失、错对象、过期、网络失败或接口不支持均保留限制。已本地commit的执行只能按原执行继续核对结果，不能使用此入口回退身份。

此管理端接口只服务ACC，不替代SKL交付取消、通用业务查证、产品补偿操作或正式SSO同步。

## 执行写入与最终提交的不确定性（2026-11-20）

能力端在首个产品写请求之前持久化 `reconciling` 和逐步写入意图。重启后的原执行查询不重新运行产品写入。稳定产品 UUID 已存在时，UUID 查不到不能退回同名账户；缺少稳定人员映射的同名账户也不能自动接管。当前可用状态、角色或产品账户名未知时不生成恢复基线；显示名、昵称和邮箱分别记录，不能代替未经定义的平台唯一账户名。

两端写后必须从产品重新读取并逐项核对目标账户 ID、工作区、账户名、启停及权限，再提交本平台身份。HTTP 200 内的业务失败、不完整列表、重复 ID 或响应成功但实际未变化都不能作为成功依据。审批修订必须唯一且为非负安全整数。

产品写入超时、5xx、断连或响应无法解析时，逐步记录保留 `unknown`；即使此刻读回旧值，也不能证明迟到请求不会生效。此时不自动补偿、不封存解锁。明确拒绝且没有未确认写入时，补偿只还原本次写过的字段；改名补偿不能覆盖权限或启停状态。补偿后仍须完整读回基线。

最终 `PUT /account-changes/{executionId}/commit` 返回丢失时，保留 `reconciling`，不能假定平台未提交而反向回滚产品。能力端只读调用管理端同路径的 GET，取得 `{executionId,request,response}`，核对原执行、原映射、人员修订及当前产品目标状态后完成本地记录。GET 不触发产品写入或再次 PUT。404、查证失败或实际漂移均保留限制；不能以“暂时没有提交记录”证明原请求不会迟到。

真实产品状态无法读取时，一致性证明路由返回 503 `ACCOUNT_FACTS_UNAVAILABLE`，不填造空账户/停用事实。已提交或最终提交待查证的执行拒绝回滚解锁证明（409）。这些防护与模拟对端回归已实现，两个 ACC 分支的原生写接口适配仍未完成，不据此生成 verified 部署证据。
