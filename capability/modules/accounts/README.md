# 账号能力模块（accounts）

负责人角色：能力-accounts。请在分工时绑定实际开发者；每个目录指定一位主维护者。

工单范围：ACC-01, ACC-02。

- `public.mjs`：唯一跨模块入口；维护capabilityModule的动作、资源、目录及路由登记。
- `handlers/`：动作处理、结果构造；`adapters/`：本领域产品协议适配。
- `queries/`：候选、目录、快照等读取；人员从管理端可信 `/subjects/{subjectId}` 获取，不由调用者的账户名参数代替。
- `tests/`：本模块测试。空测试目录不计验收通过；新增实现须添加真实断言。

修改本模块已有动作或添加读取路由，只改本目录和相应契约。启动、执行台账、公共鉴权和登记引擎归公共负责人，禁止自行复制实现。跨业务依赖只使用其他模块public.mjs；仓库通过HTTP访问，不导入仓库service。

执行处理器存在且未设置ready:false时，只表示接线；没有目标部署核验仍返回unverified。未实现动作为unsupported/NO_HANDLER，现有不完整Dify草稿ready:false为unsupported/IMPLEMENTATION_INCOMPLETE。不能在模块中硬写verified或伪造结果来通过验收。

独立验证：`npm.cmd run test:capability -- accounts`；没有测试时命令明确失败。跨模块回归：`npm.cmd run check`。现有公共注册与HTTP测试：`npm.cmd run test:capability`。完整开发规范见[能力组件结构与分工](../../../分工文档/能力组件结构与分工.md)。

## 当前实现范围

双端流程原型、按 UUID 匹配、可信人员查询、完整事实校验、逐步写入意图、写后读回、限定字段补偿及丢失最终提交响应后的只读恢复均有定向测试。原生账号开通/停用/跨用户改名适配仍未完成；原型测试中的自定义用户 CRUD 接口不能当作 Dify/RAGFlow 原生接口或真实部署证据。

Dify 1.7.1 成员读取先 GET 核对 `/workspaces/current`，工作区不一致拒绝。真实角色修改走 `PUT /members/{id}/update-role`，邀请走 `/members/invite-email`；邀请可能生成待激活账户并发送邮件，不能冒充“账户已开通”。自助 `/account/name` 只改当前用户显示名，不等于管理员修改任意用户登录名。

RAGFlow 0.22.1 团队成员接口为控制台会话域 `/v1/tenant/{tenantId}/user/list`；数据集 API Key 不能视为全局用户管理员会话。当前用户 `/v1/user/setting` 排除邮箱及启停等字段，不能当作任意人员账号管理。原型的 `/api/v1/system/users` 在当前真机不提供有效结果，明确报错；不以空列表掩盖错误，也不把团队角色或昵称当作全局账号权限或登录名。

`DIFY_ACCOUNT_IDENTITY_MAP` / `RAGFLOW_ACCOUNT_IDENTITY_MAP` 可按产品 UUID 显式提供 `{subjectId}`，仅建立稳定人员关联，不能用配置值伪造产品当前账户名。显示名、登录邮箱与平台唯一账户名的变更语义待明确；尚未实现的操作保持 unverified。只读核对命令：`node dev/verify-live-account-protocol.mjs`，只验证读取与拒绝行为，不执行账号写入，不产生 ACC verified 证据。

写入与恢复规范见[账号恢复契约](../../../contracts/capability-api/account-recovery.md)。产品请求未知时保留限制，不自动重试或回滚；最终平台提交响应丢失时通过只读原提交证明核对。中断在产品写入阶段但没有确定完成证明的执行仍需进一步查证，不能自动当作完成或已恢复。
