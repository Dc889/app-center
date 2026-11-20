# Skill交付关闭与取消

本契约覆盖SKL-03独立tickets台账，不替代业务台账或账号恢复。管理端已接关闭回调与运维取消入口，实际能力执行器的cancel路由、仓库预约终结和取消统计仍待能力组实现；本机正常Skill交付已回归，取消通过模拟组件验收。

## 能力组件的关闭回调

`POST /internal/v1/delivery-checks/{resultId}/close`，只接受能力服务Bearer身份，生产仍要求双向TLS。无须请求正文。管理端按流水查找唯一SKL-03，以SQLite事务先封住新领取，再核对持久发送证据；浏览器不能调用。

| 响应 | 含义 |
| --- | --- |
| 200 `{"state":"closed_unserved"}` | 没有在途、完整发送、待回执或未知记录；原子封存新领取，可据此终结未交付预约 |
| 200 `{"state":"receipt_pending"}` | 已完整发送或已经确认，按原流水继续回执结算；不能改算未交付失败 |
| 409 DELIVERY_UNCERTAIN | 在途或证据不完整，已封住新领取，保持查证，不允许假定无副作用 |
| 403 / 404 | 无服务权限 / 流水未知或映射不唯一，不表示从未交付 |

同一流水重放幂等；uncertain可在已开始的发送完整结束后转receipt_pending，或在确认发送前中断后转closed_unserved；closed_unserved保持封存。已开始的传输允许完成并回执。关闭后所有新的领取返回409 DELIVERY_CLOSED，不能绕过预约直接读文件。已发送记录即使回执失败或重启仍由后台幂等补交，首次保存的可信源IP随每次回执用X-Source-IP传递，不信任浏览器X-Forwarded-For。接入反向代理时只能配置可信的服务端resolveSourceIp函数。能力端及仓库仍需实现此IP的真实存储。

## 发送证据及互斥

领取、发送阶段更新、发送完成和关闭检查使用同一个tickets数据库事务。领取写入transferId、当前processId、status=sending及stage=fetching后，才访问下游文件；在首个可能发出的字节之前持久化stage=emitting，完成则写sent及pending_receipt/confirmed。fetching阶段明确断流可标interrupted；emitting后断流保留uncertain，不能按未发送关闭。

启动时不重置仍存活进程的sending记录，另一管理实例无法抢占。可确认进程已退出且仍fetching的记录可记interrupted；没有进程标识的旧发送、emitting阶段或无法核实的记录保留未知。PID复用等无法证明退出时宁可保留限制。已确认同机两服务实例共享SQLite的并发场景；跨主机数据库、进程身份协调及未知证据恢复/重新开放领取仍待实现，不能宣称已支持任意多机部署。

## 运维取消入口

`POST /api/tickets/{ticketNo}/cancel`，同源、当前有效运维会话，正文 `{executionId,note}`。note非空且最多4000字符，executionId必须是当前原执行。用户及系统管理员只读，不允许代办业务取消。运维待办的“Skill文件执行待办”提供办理意见和查证入口。

管理端先在事务中核验无在途/未知/已发或待回执事实，保存cancelRequest和审计，封住新领取；调用 `GET /executions/{executionId}`。已有终态按原状态核对；活动执行才调用 `POST /executions/{executionId}/cancel`，正文为空对象，绝不重建执行。组件200仅在原执行不能继续产生副作用时返回cancelled终态；仍为活动状态或409时继续原ID查询，不能标已终止。失败终态保留真实failed。若组件声称成功交付但本地没有完整发送证据，保持DELIVERY_UNCERTAIN。

响应200返回当前工单，必须检查status、cancelStatus、cancelError，不代表取消成功。丢失响应保存uncertain并保持新领取限制，重启查询原执行；已取消则幂等返回，无须再次POST。组件501保存unsupported，404/网络或错执行返回保持查证，不能当作已取消。此前已有failed的本地终止应走单独管理状态转换，不重发cancel。当前Skill真实执行器尚缺cancel，404会保留未知，不冒充unsupported终态。

取消回调与新领取串行，但已开始或未知交付不开放取消。源数据缺失时不得通过本地“解除限制”按钮清空证据；两侧恢复同一流水领取需后续可信对账流程。

## 验收

delivery-control.test.mjs覆盖服务权限、未知流水、未发送关闭、在途关闭与两实例抢占、发送前断流、旧未知证据重启、取消权限/错执行/响应丢失/重启、组件不支持及错误回执不得清除证据。skill-cancellation-browser.mjs验证运维页面、管理端关闭回调与管理员/用户只读；skill-delivery-browser.mjs验证实际本地Skill下载、回执和审计。未完成的真实组件取消与统计、跨主机互斥、未知证据恢复继续单列，整单验收不提前勾选。
