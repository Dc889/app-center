import {unzipSync} from 'fflate'
import {parseDocument} from 'yaml'
import {check} from '../../../../runtime/http.mjs'

const EICAR = Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
const MAX_TOTAL = 100 * 1024 * 1024
const safePath = name => typeof name === 'string' && name && !name.includes('\\') && !name.includes('\0') &&
  !name.startsWith('/') && !/^[a-z]:/i.test(name) && name.replace(/\/$/, '').split('/').every(part => part && !['.', '..', '__proto__', 'constructor', 'prototype'].includes(part))
const text = value => typeof value === 'string' && value.trim() && value.length <= 1024

// Read-only ZIP inspection, aligned with Dify Plugin Daemon 0.2.0's root manifest.yaml.
// No package code is imported or executed. Runtime/signature validation remains with Dify.
export function inspectPluginArchive(bytes) {
  check(Buffer.isBuffer(bytes) && bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50, 400, 'INVALID_PLUGIN_ARCHIVE', '插件必须是实际 ZIP 格式的 difypkg')
  let total = 0, count = 0
  const names = new Set()
  let files
  try {
    files = unzipSync(bytes, {filter(file) {
      check(safePath(file.name) && !names.has(file.name), 400, 'INVALID_PLUGIN_PATH', '插件包含非法或重复路径')
      names.add(file.name)
      total += file.originalSize; count++
      check(Number.isSafeInteger(file.originalSize) && file.originalSize >= 0 && file.originalSize <= 32 * 1024 * 1024 && total <= MAX_TOTAL && count <= 2048,
        413, 'PLUGIN_ARCHIVE_TOO_LARGE', '插件展开内容超过限制')
      if (file.name === 'manifest.yaml') check(file.originalSize <= 512 * 1024, 413, 'PLUGIN_MANIFEST_TOO_LARGE')
      return true
    }})
  } catch (error) {
    if (error.status) throw error
    check(false, 400, 'INVALID_PLUGIN_ARCHIVE', '插件 ZIP 无法完整解码')
  }
  check(Object.hasOwn(files, 'manifest.yaml'), 400, 'MISSING_PLUGIN_MANIFEST', '插件缺少根目录 manifest.yaml')
  for (const file of Object.values(files)) check(!Buffer.from(file).includes(EICAR), 400, 'PLUGIN_SCAN_REJECTED', '插件内容包含恶意测试特征')
  let manifest
  try {
    const document = parseDocument(new TextDecoder('utf-8', {fatal: true}).decode(files['manifest.yaml']), {uniqueKeys: true, schema: 'core'})
    check(!document.errors.length && !document.warnings.length, 400, 'INVALID_PLUGIN_MANIFEST', 'manifest.yaml 语法或标签不受支持')
    manifest = document.toJS({maxAliasCount: 20})
  } catch (error) {
    if (error.status) throw error
    check(false, 400, 'INVALID_PLUGIN_MANIFEST', 'manifest.yaml 无法解析')
  }
  const validName = value => typeof value === 'string' && /^[a-z0-9_-]{1,128}$/.test(value)
  check(manifest && !Array.isArray(manifest) && manifest.type === 'plugin' && validName(manifest.name) &&
    (!manifest.author || typeof manifest.author === 'string' && /^[a-z0-9_-]{1,64}$/.test(manifest.author)) &&
    typeof manifest.version === 'string' && /^\d{1,4}(\.\d{1,4}){2}(-\w{1,16})?$/.test(manifest.version), 400, 'INVALID_PLUGIN_IDENTITY', '插件清单缺少有效身份或版本')
  const label = manifest.label?.zh_Hans || manifest.label?.en_US
  check(text(label) && text(manifest.description?.en_US) && text(manifest.icon) && safePath(manifest.icon) &&
    (Object.hasOwn(files, '_assets/' + manifest.icon) || Object.hasOwn(files, manifest.icon)), 400, 'INCOMPLETE_PLUGIN_MANIFEST', '插件名称、描述或图标不完整')
  check(manifest.meta?.runner?.language === 'python' && text(manifest.meta.runner.version) && text(manifest.meta.runner.entrypoint) &&
    safePath(manifest.meta.runner.entrypoint) && Object.hasOwn(files, manifest.meta.runner.entrypoint.replaceAll('.', '/') + '.py'),
    400, 'INCOMPLETE_PLUGIN_RUNNER', '插件运行入口不完整')
  const kinds = ['tools', 'models', 'endpoints', 'agent_strategies']
  check(manifest.plugins && kinds.every(kind => manifest.plugins[kind] === undefined || Array.isArray(manifest.plugins[kind])), 400, 'INCOMPLETE_PLUGIN_PROVIDERS')
  check(Number.isSafeInteger(manifest.resource?.memory) && manifest.resource.memory > 0 && Array.isArray(manifest.meta.arch) && manifest.meta.arch.length &&
    manifest.meta.arch.every(arch => ['amd64', 'arm64'].includes(arch)) && typeof manifest.created_at === 'string' && Number.isFinite(Date.parse(manifest.created_at)),
    400, 'INCOMPLETE_PLUGIN_RUNTIME', '插件资源或平台声明不完整')
  const references = kinds.flatMap(kind => manifest.plugins[kind] ?? [])
  check(references.length > 0 && references.every(name => safePath(name) && Object.hasOwn(files, name)), 400, 'INCOMPLETE_PLUGIN_PROVIDERS', '插件提供者清单或文件不完整')
  const dependencies = []
  const requirements = files['requirements.txt'] ? new TextDecoder('utf-8', {fatal: true}).decode(files['requirements.txt']) : ''
  for (const raw of requirements.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\[[a-zA-Z0-9_,.-]+\])?)\s*(.*)$/.exec(line)
    check(match && (!match[2] || /^(?:==|~=|>=|<=|>|<|!=|;)/.test(match[2])), 400, 'UNSUPPORTED_PLUGIN_DEPENDENCY', '依赖声明格式尚不支持完整核对')
    dependencies.push({name: match[1], version: match[2] || 'unconstrained', license: 'UNKNOWN'})
  }
  return {uniqueIdentifier: manifest.author ? `${manifest.author}/${manifest.name}` : manifest.name,
    name: label.trim(), version: manifest.version, dependencies}
}
