# 插件能力模块（plugins）

负责人角色：能力-plugins。请在分工时绑定实际开发者；每个目录指定一位主维护者。

工单范围：PLG-01, PLG-02, PLG-03, PLG-04。

- `public.mjs`：唯一跨模块入口；维护capabilityModule的动作、资源、目录及路由登记。
- `handlers/`：动作处理、结果构造；`adapters/`：本领域产品协议适配。
- `queries/`：候选、目录、快照等读取；没有真实资源时返回空或明确错误，不自动填充演示数据。
- `tests/`：本模块测试。空测试目录不计验收通过；新增实现须添加真实断言。

修改本模块已有动作或添加读取路由，只改本目录和相应契约。启动、执行台账、公共鉴权和登记引擎归公共负责人，禁止自行复制实现。跨业务依赖只使用其他模块public.mjs；仓库通过HTTP访问，不导入仓库service。

执行处理器存在且未设置ready:false时，只表示接线；没有目标部署核验仍返回unverified。未实现动作为unsupported/NO_HANDLER，现有不完整Dify草稿ready:false为unsupported/IMPLEMENTATION_INCOMPLETE。不能在模块中硬写verified或伪造结果来通过验收。

独立验证：`npm.cmd run test:capability -- plugins`；没有测试时命令明确失败。跨模块回归：`npm.cmd run check`。现有公共注册与HTTP测试：`npm.cmd run test:capability`。完整开发规范见[能力组件结构与分工](../../../分工文档/能力组件结构与分工.md)。

## Dify 1.7.1 实例协议

`installationId` 是平台安装台账 ID；`productInstallationId` 是 Dify 列表中的原生 `id`，不得互换。版本身份使用原生 `plugin_unique_identifier`（包括内容摘要）。安装/升级必须读回实际工作区、原生实例和目标版本后才能成功；卸载先核对原生 ID 与版本，再发送 `plugin_installation_id` 并确认实例已消失。旧台账缺少原生映射时明确拒绝操作，需要先人工查证并补齐，不能猜 ID 或自动接管同名实例。已确认失败的原生任务进入失败终态，不重新创建任务掩盖失败。

连接使用 `DIFY_API_BASE`、`DIFY_CONSOLE_TOKEN`、`DIFY_WORKSPACE_ID`，安装身份还需显式配置 `DIFY_INSTALL_ACCOUNT`。本地包升级使用原生 Plugin Daemon `/plugin/{workspaceId}/management/install/upgrade`，另需私网 `DIFY_PLUGIN_DAEMON_BASE` 和 `DIFY_PLUGIN_DAEMON_KEY`；不能冒充 Github/Marketplace 来源。密钥保存在忽略的本地配置或环境变量中。

`npm.cmd run dev:live` 支持忽略文件 `local-products.json` 的 `dify.installAccount`、`dify.pluginDaemon.{base,key}`。仅本地 Docker 联调可显式设 `DIFY_LOCAL_DAEMON_PROXY=1` 或 `dify.pluginDaemon.mode="local-docker-proxy"`：启动一台本次独占、仅绑定回环地址的临时代理，沿用已有镜像和网络，退出时核对所有权并删除；不会重启既有 Dify 服务。正式环境应使用私网稳定地址。

`node dev/verify-live-deployment.mjs` 在临时应用台账中预置带 `verificationFixture` 标记的 PLG-03 流程配置，随后真实提交、审批、执行并读回产品效果；这是分支核验的前置配置，不算正式类型发布验收，也不伪造部署证据。正式发布仍要求三个分支的真实部署证据齐备。脚本只清理本次登记的原生 UID/资源；中断日志保存在忽略目录中。证据未齐时按约定退出码 1。

Dify 1.7.1 没有通用插件 disable/enable 接口；缺失时返回 501。PLG-04 仍需真实调用阻断与恢复机制，不能仅改台账、改观测记录或用卸载重装代替安全禁用。
