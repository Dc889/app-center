import {closeStorage} from '../runtime/http.mjs'

export function requireEnv(name) {
  const val = process.env[name]?.trim()
  if (!val) {
    console.error(`[fatal] 缺少必需环境变量: ${name}`)
    process.exit(1)
  }
  return val
}

export function attachGracefulShutdown(serviceName, instance) {
  let shuttingDown = false
  const stop = async signal => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[${serviceName}] 收到 ${signal}，正在优雅停机...`)
    try {
      await instance.close()
    } catch (err) {
      console.error(`[${serviceName}] 关闭服务出错:`, err?.message ?? err)
    }
    try {
      closeStorage()
    } catch { /* ignore */ }
    process.exit(0)
  }
  process.on('SIGTERM', () => { void stop('SIGTERM') })
  process.on('SIGINT', () => { void stop('SIGINT') })
}
