# 服务监控

`GET /api/service-monitor` 只允许运维人员和系统管理员。普通用户返回 403。

响应说明本次 Docker 巡检：

- `availability` 为 `collected` 或 `not_collected`。未采集时 Dify 与 RAGFlow 的运行中、不可用数量都是 `null`，页面显示未采集。
- `products.Dify` 与 `products.RAGFlow` 只包含对应 Compose 项目里实际存在的容器。应用中心自己的容器不计入。
- 容器状态为 `不可用` 且允许重启时，系统创建 `SVC-01`，审批方式为自动审批，然后只重启该容器。同一容器 5 分钟内不重复创建。
- 初始化或证书任务以退出码 0 结束时状态为 `已结束`，不重启。
- 设置 `SERVICE_AUTO_RESTART=0` 时只巡检，不创建工单，也不重启。
