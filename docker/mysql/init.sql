-- AI 运营管理平台（app-center）MySQL 8.0 初始化脚本
-- 单实例三逻辑库 + 最小权限三账号隔离（管理端 / 能力编排端 / 四大仓库）

CREATE DATABASE IF NOT EXISTS app_center_mgmt CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS app_center_exec CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS app_center_repo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'ac_mgmt'@'%' IDENTIFIED BY 'ac_mgmt_change_me';
CREATE USER IF NOT EXISTS 'ac_exec'@'%' IDENTIFIED BY 'ac_exec_change_me';
CREATE USER IF NOT EXISTS 'ac_repo'@'%' IDENTIFIED BY 'ac_repo_change_me';

GRANT ALL PRIVILEGES ON app_center_mgmt.* TO 'ac_mgmt'@'%';
GRANT ALL PRIVILEGES ON app_center_exec.* TO 'ac_exec'@'%';
GRANT ALL PRIVILEGES ON app_center_repo.* TO 'ac_repo'@'%';

FLUSH PRIVILEGES;
