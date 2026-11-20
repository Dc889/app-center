# 工单类型版本与启用组织

页面接口使用管理端会话，仅当前管理员角色可读写；POST校验同源。能力组件的内网接口保持原契约。

- `GET /api/types`：返回 `routes,versions,organizations`，组织选项取管理端可信目录。
- `POST /api/types/draft`：`code,version,revision,name,workspaceId,actions,branchFlows?,enabledOrgs?`。enabledOrgs为去重组织数组，只接受目录值；省略或空数组表示全部组织。发布/停用后配置不可覆盖。
- `POST /api/types/copy`：`code,version,revision,newVersion`，源版本必须已发布或停用，修订必须匹配。newVersion为1至999999的十进制字符串，必须大于该类型所有已有版本（含草稿），不可覆盖目标。返回201及修订1的新草稿，保留名称、工作区、动作、分支流程及组织范围；只保存copiedFrom来源，不继承发布时刻、已核验分支和原审计历史。复制有独立审计记录。
- `POST /api/types/check|publish|disable`：携带`code,version,revision`。新版本发布必须重新读取对应工作区、类型版本与动作的全部能力分支，不能沿用源版本的核验结果。停用版本可复制后重新发布。

新申请先按类型和工作区选择最高已发布/停用版本。若最高版本停用，拒绝申请；若其组织范围未包含会话当前组织，返回403 TYPE_ORGANIZATION_DISABLED，不回退更早版本。角色和组织取后端会话，浏览器的org字段不能放宽范围。草稿保存、恢复及新提交也执行相同校验；异步资源预检后的现有类型版本复核会再次检查组织范围。

已有受理工单的办理、幂等重放、查询和执行重试继续使用受理时冻结版本，不因后续范围修改而更换版本。系统服务产生的告警/转单不使用人工申请组织限制，仍执行其服务鉴权和类型/分支检查。

当前目录使用现有身份目录中的组织名称，尚未接入正式组织ID及组织改名同步。后续接入正式目录时需迁移配置值；不能把组织显示名称当作产品workspace或tenant标识。

验收：tests/integration/management-workflow.test.mjs的类型复制两项用例和tests/type-registry-browser.mjs；覆盖权限、重复复制冲突、新版本能力重新核验、停用源复制、组织伪造、重启、既有工单重放与源版本不变。
