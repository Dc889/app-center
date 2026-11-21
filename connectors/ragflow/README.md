# RAGFlow Connector (`app-center-connector-ragflow`)

独立的 RAGFlow 协议适配微服务（无状态，无需数据库）。

- **职责**：隔离所有 RAGFlow API 凭据、端点协议与版本差异（如 RAGFlow 0.22.1 → 后续版本）。
- **安全边界**：全平台唯一持有 `RAGFLOW_*` 外部凭据的容器；对外通过内网 `Bearer INTERNAL_TOKEN` 向 `app-center-executor` 暴露 `/connector/v1/*`。
- **独立升级**：当目标分区升级 RAGFlow 版本时，仅需升级并滚动替换 `app-center-connector-ragflow` 镜像，无需改动或重启其他服务。
