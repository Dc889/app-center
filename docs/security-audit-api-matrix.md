# AI 应用中心 · 核心接口与安全审查验收矩阵

> **一键巡检命令**：`node scripts/verify-security-apis.mjs`（默认目标 `http://localhost:8088`）
> **设计原则**：每个安全审查接口均同时验证 **正例（合规放行）** 与 **反例（违规拦截）**，确保审查机制真实生效而非“空壳通过”。

---

## 一、六大安全审查与边界接口矩阵

| 序号 | 安全审查接口 | 关联工单 / 页面 | 审查数据源 | 拦截红线与判定标准 | 正例验证 | 反例拦截验证 |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | `GET /api/resources/dify_app/:id` + `POST /api/applications/transition` | `AG-02` / `AG-04` 智能体发布 | Dify 应用 `model_config` + 工作流图节点（`workflows/publish` / `draft`）+ 平台仓库 | 解析知识库、插件、MCP、HTTP 外部节点；未审依赖标记 `未审告警`，未勾选风险确认返回 `400 WARNING_DECISION_REQUIRED` | 无外部高风险依赖应用自动核验通过 | 含外部 HTTP 节点应用未勾选风险确认被 `400` 拦截 |
| **2** | `GET /api/execution-contexts?ticketType=KB-02` + `POST /api/keyword-rules/dry-run` | `KB-02` 知识库分享 / 敏感词库 | RAGFlow 文档 chunks / Dify 文档 segments + `CFG-02` 词库 | 内存流式扫描全部正文切片（零留存、不落盘、不写入快照）；命中 `阻断` 规则标记 `autoVerdict=不通过` | 合规知识库扫描通过并记录 `scannedChunks` | 含 `内部涉密` / `password=` 文本试扫命中阻断 |
| **3** | `POST /api/intake/plugin` | `PLG-01` / `PLG-02` 插件上架 | 上传的 `.difypkg`（ZIP）内 `manifest.yaml`、`requirements.txt` 与全部 `.py` 文件 | 防路径穿越、防 EICAR、静态扫描拦截 `os.system` / `subprocess(..., shell=True)` / `eval` / `exec` / `pickle.loads` | 合规 `.difypkg` 扫描 `ready` 并返回 `codeAudit.passed=true` | 含 `os.system("whoami")` 的恶意 `.difypkg` 返回 `rejected` |
| **4** | `GET /api/resources/mcp_registration/:id` + `POST /api/mcp-test-suites/dry-run` | `MCP-01` MCP 上架 / MCP 题库 | `CFG-03` 预设测试集 + `CFG-02` 词库 + 目标 MCP 实时 `tools/call` 响应 | 向真实 MCP 端点发起 JSON-RPC `tools/call` 试探，扫描实时返回报文与工具声明 | 合规本地 MCP（`:4390/mcp/time`）实时探测通过（`liveProbedCases > 0`） | 响应或工具声明命中阻断词时标记 `不通过` |
| **5** | `POST /api/applications/reveal` | `KEY-01` API 密钥申请 | Dify Console 实时创建密钥（内存暂存，明文不落盘） | 首次领取返回真实 `app-...` 密钥，随后立即销毁内存明文，二次领取返回 `409/403` | 首次领取返回有效 Dify 密钥 | 二次重复领取被拒绝 |
| **6** | `GET /api/keyword-rules` / `GET /api/mcp-test-suites` / `GET /api/organizations` | `CFG-01` / `CFG-02` / `CFG-03` | 平台配置台账 + 统一会话 RBAC | 普通用户（`user`）严禁读写敏感词库与 MCP 题库，返回 `403 ACCESS_DENIED`；管理员与运维正常读取 | 管理员 `li.qiang` 读取全部配置返回 `200` | 普通用户 `chen.yu` 访问 `/api/keyword-rules` 返回 `403` |

---

## 二、一键巡检脚本说明

执行以下命令即可对当前运行中的 `http://localhost:8088` 进行全量接口与安全拦截巡检：

```bash
node scripts/verify-security-apis.mjs
```

- 脚本自动以 `chen.yu@kpw.com`（普通用户）和 `li.qiang@kpw.com`（系统管理员）登录，逐项验证上述 6 大安全审查接口的**正例 + 反例**；
- 所有探针均为**只读或内存临时校验**（除插件恶意包/合规包上传测试外，不产生冗余待办工单）；
- 全部通过时退出码为 `0`，任意一项安全红线失效时退出码为 `1` 并打印失败详情。
