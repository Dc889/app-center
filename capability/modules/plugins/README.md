# 插件能力模块（plugins）

负责人角色：能力-plugins。请在分工时绑定实际开发者；每个目录指定一位主维护者。

工单范围：PLG-01, PLG-02, PLG-03, PLG-04。

- `public.mjs`：唯一跨模块入口；维护capabilityModule的动作、资源、目录及路由登记。
- `handlers/`：动作处理、结果构造；`adapters/`：本领域产品协议适配。
- `queries/`：候选、目录、快照等读取；现有legacy-catalog/resources文件保留原演示数据，不代表生产发现接口已完成。
- `tests/`：本模块测试。空测试目录不计验收通过；新增实现须添加真实断言。

修改本模块已有动作或添加读取路由，只改本目录和相应契约。启动、执行台账、公共鉴权和登记引擎归公共负责人，禁止自行复制实现。跨业务依赖只使用其他模块public.mjs；仓库通过HTTP访问，不导入仓库service。

执行处理器存在且未设置ready:false时，只表示接线；没有目标部署核验仍返回unverified。未实现动作为unsupported/NO_HANDLER，现有不完整Dify草稿ready:false为unsupported/IMPLEMENTATION_INCOMPLETE。不能在模块中硬写verified或伪造结果来通过验收。

独立验证：`npm.cmd run test:capability -- plugins`；没有测试时命令明确失败。跨模块回归：`npm.cmd run check`。现有公共注册与HTTP测试：`npm.cmd run test:capability`。完整开发规范见[能力组件结构与分工](../../../分工文档/能力组件结构与分工.md)。
