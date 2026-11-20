import test from 'node:test'
import assert from 'node:assert/strict'
import {zipSync, strToU8} from 'fflate'
import {inspectPluginArchive} from '../adapters/package-archive.mjs'
import {parsePluginMetadata, storePluginIntake} from '../adapters/intake-store.mjs'
import {testPluginArchive} from '../../../../tests/fixtures/plugin-archive.mjs'

const errorCode = code => error => error.code === code

test('插件身份来自 ZIP 内原始 manifest，文件名和外部 JSON 不能冒充', () => {
  const bytes = testPluginArchive({uniqueIdentifier: 'publisher/actual', name: 'Actual label', version: '1.2.3', dependencies: [{name: 'dify_plugin', version: '0.2.0'}]})
  assert.deepEqual(parsePluginMetadata(bytes, 'fake@9.9.9.difypkg'), {uniqueIdentifier: 'publisher/actual', name: 'Actual label', version: '1.2.3', dependencies: [{name: 'dify_plugin', version: '==0.2.0', license: 'UNKNOWN'}]})
  assert.equal(parsePluginMetadata(Buffer.from(JSON.stringify({uniqueIdentifier: 'fake', name: 'fake', version: '1.0.0'})), 'fake@1.0.0.difypkg'), null)
  assert.equal(parsePluginMetadata(Buffer.from('arbitrary bytes'), 'fake@1.0.0.difypkg'), null)
})

test('缺少真实 manifest 或伪造版本与缺失提供者文件不可解析为就绪插件', () => {
  assert.throws(() => inspectPluginArchive(Buffer.from(zipSync({'payload.py': strToU8('pass')}))), errorCode('MISSING_PLUGIN_MANIFEST'))
  assert.throws(() => inspectPluginArchive(testPluginArchive({version: 'v1.0.0'})), errorCode('INVALID_PLUGIN_IDENTITY'))
  assert.throws(() => inspectPluginArchive(testPluginArchive({}, {'manifest.yaml': strToU8('type: plugin\nname: x\nversion: 1.0.0\n')})), errorCode('INCOMPLETE_PLUGIN_MANIFEST'))
})

test('ZIP 内恶意测试特征必须扫描展开内容，不能只扫描压缩字节', () => {
  const signature = Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
  const bytes = testPluginArchive({}, {'compressed.txt': strToU8(('X5O!' + signature.toString()).repeat(1000))})
  assert.ok(!bytes.includes(signature))
  assert.throws(() => inspectPluginArchive(bytes), errorCode('PLUGIN_SCAN_REJECTED'))
})

test('路径穿越和重复根清单在解码时拒绝，不存在文件名覆盖歧义', () => {
  assert.throws(() => inspectPluginArchive(testPluginArchive({}, {'../outside.py': strToU8('pass')})), errorCode('INVALID_PLUGIN_PATH'))
  const original = testPluginArchive({}, {'manifest.yam2': strToU8('version: 999.0.0')})
  const duplicate = Buffer.from(original)
  let offset = duplicate.indexOf('manifest.yam2')
  while (offset >= 0) {duplicate.write('manifest.yaml', offset); offset = duplicate.indexOf('manifest.yam2', offset + 1)}
  assert.throws(() => inspectPluginArchive(duplicate), errorCode('INVALID_PLUGIN_PATH'))
})

test('声明巨量展开字节的ZIP在分配正文前拒绝', () => {
  const bytes = Buffer.from(zipSync({'large.txt': strToU8('x')}))
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(central >= 0)
  bytes.writeUInt32LE(512 * 1024 * 1024, central + 24)
  assert.throws(() => inspectPluginArchive(bytes), errorCode('PLUGIN_ARCHIVE_TOO_LARGE'))
})

test('重复 YAML 键和不支持的外部依赖声明拒绝，不能悄悄变为空依赖', () => {
  const duplicate = 'type: plugin\nname: first\nname: second\nversion: 1.0.0\n'
  assert.throws(() => inspectPluginArchive(testPluginArchive({}, {'manifest.yaml': strToU8(duplicate)})), errorCode('INVALID_PLUGIN_MANIFEST'))
  assert.throws(() => inspectPluginArchive(testPluginArchive({}, {'requirements.txt': strToU8('-r secret-requirements.txt')})), errorCode('UNSUPPORTED_PLUGIN_DEPENDENCY'))
})

test('被拒的假包保留 intake 记录及实际拒绝原因，不产生 ready 与 passed', () => {
  const records = new Map(), db = {get: key => records.get(key), put: (key, row) => records.set(key, row)}
  const result = storePluginIntake(db, {idempotencyKey: 'bad-json', identity: {account: 'test'}, filename: 'fake@1.0.0.difypkg', contentType: 'application/octet-stream', bytes: Buffer.from('{}')})
  assert.equal(result.record.status, 'rejected')
  assert.notEqual(result.record.scan.verdict, 'passed')
  assert.ok(result.record.scan.findings.includes('INVALID_PLUGIN_ARCHIVE'))
})
