`accounts.test.mjs` 覆盖模拟对端的双端执行、明确拒绝后的补偿、写后状态不符时拒绝提交，以及最终提交响应丢失后重启只读恢复；原生账号写适配尚未完成，这些不是原生部署证据。

`account-facts.test.mjs` 覆盖稳定 UUID、同名冲突、未知事实、真实工作区核对、HTTP200业务失败、未确认写入不解锁和仅补偿本次字段。运行 `npm.cmd run test:capability -- accounts`。
