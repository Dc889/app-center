# CAP-FIN-03：真实插件归档与上架再审

2026-11-20。子目标完成；当前部署证据 **20/35 verified**，原子任务仍 **56/59**，整单仍 **0/27**。MCP 模型中心接口由用户明确确认暂未提供，相关五个分支作为外部依赖保留未核验。

## 本次实现

插件 intake 不再接受 JSON 冒充 difypkg，也不从 `<id>@<version>` 文件名猜身份。按 [Dify Plugin Daemon 0.2.0 根清单实现](https://github.com/langgenius/dify-plugin-daemon/blob/0.2.0/pkg/plugin_packager/decoder/helper.go) 和 [原生版本格式](https://github.com/langgenius/dify-plugin-daemon/blob/0.2.0/pkg/entities/manifest_entities/version.go)，只读解析 ZIP 根目录 `manifest.yaml` 的真实 author/name/version、标签和依赖。拒绝缺失声明、非法路径、重复清单、不完整运行入口或提供者、过量展开内容、重复 YAML 键及无法完整核对的依赖声明；基础特征扫描覆盖解压后的内容，不只扫描压缩字节。不执行包内代码。新增固定版本 fflate 0.8.3、yaml 2.9.1。

既有会调用真实 intake 的测试改用实际 ZIP 夹具；夹具明确只用于模拟上游运行时，不作为真机安装证据。

新增可检查的真实联调插件构造器 `dev/live-verification/plugin-package.mjs`：仅含本地回声工具，不读取凭证、调用模型或在工具代码中访问外部网络；Python SDK 固定 0.2.0。真实依赖安装由 Dify 原生安装器执行。

## 真机结果

- 管理端 PLG-01 上架与 PLG-02 再审分别使用实际 1.0.0 / 1.1.0 插件包。读回仓库版本与原始字节摘要，重新解析包内清单，并将仓库实际返回的字节提交 Dify 原生上传验证；两条新分支通过，18/35 增至 **20/35**。
- `node dev/verify-live-plugin.mjs` 另行在独立命名空间验证实际包上传、SDK 环境初始化、原生安装完成和真实产品实例 ID。**2/2 通过**，随后调用真实卸载接口并从列表确认该实例已不存在。该单独探针不提前将能力组件 install/upgrade/uninstall 标为 verified。
- 安装沿用现有本地 `FORCE_VERIFYING_SIGNATURE=false` 设置，没有修改服务部署或签名策略。这里证明的是当前本地配置，正式签名策略需按目标环境核验。卸载验证针对产品安装记录，包缓存和 SDK 环境缓存由 Dify 自身管理，不声称物理缓存已清空。
- 同一部署核验运行的两套应用、两套知识库 **4/4 清理确认**。完整脱敏事实见 [插件归档记录](CAP-FIN-03-插件归档.json)。

## 检查与接续

插件模块 **12/12**、能力全量 **61/61**、全量门禁 **222/222** 通过；边界、lint、构建通过。

复现：`node dev/verify-live-deployment.mjs`（尚未35/35，按约定退出码1）；独立安装探针 `node dev/verify-live-plugin.mjs`。探针会真实安装本地测试插件并跟踪终态，随后按本次实际 UID/实例ID卸载；超时会保留待查证任务，不将“列表暂不存在”假报为清理完成。

下一步接通能力组件原生安装实例 ID、包升级和卸载。现有平台安装 ID 与 Dify 产品实例 ID 不应混用；Dify 1.7.1 Console 路由也没有通用插件 disable/enable，不能以本地账面禁用冒充产品效果。剩余 PLG 三个安装动作和两个安全状态动作继续核验，CAP-FIN-03 不打整体完成勾。
