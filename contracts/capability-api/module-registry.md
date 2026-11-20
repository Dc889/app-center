# 能力组件内部模块登记

对外GET /internal/v1/capabilities字段不变，接口实现从模块描述符和部署证据共同生成。目录、动作、上下文、执行及状态协议继续遵守本目录OpenAPI与actions.json。

内部契约、字段、状态判据、目录归属、兼容入口及验收命令见[能力组件结构与分工](../../分工文档/能力组件结构与分工.md)。实现位于capability/platform/registry，组合位于capability/app/modules.mjs，各业务只维护capability/modules/<领域>/public.mjs及本目录内实现。未实现动作显式登记；未登记、重复拥有者及遗漏契约动作启动失败。

新增原因码IMPLEMENTATION_INCOMPLETE用于已有处理草稿但完整成功判据尚未实现的动作，此时state=unsupported、checkedAt=null，禁止分发到草稿。不能通过添加verified证据启用ready:false动作。NO_HANDLER、NO_DEPLOYMENT_EVIDENCE及AMBIGUOUS_EVIDENCE继续使用。

27工单定义不变，EVT-01仍无直接执行动作；KB-03三分支各有部署核验记录。未经真实联调不能将结构迁移计为业务完成。
