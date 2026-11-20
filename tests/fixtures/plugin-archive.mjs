import {zipSync, strToU8} from 'fflate'
import {stringify} from 'yaml'

// Structural archives for tests with a mocked plugin runtime, not live-install evidence.
export function testPluginArchive({uniqueIdentifier = 'test/example', name = 'Test plugin', version = '1.0.0', dependencies = []} = {}, overrides = {}) {
  const split = uniqueIdentifier.lastIndexOf('/')
  const author = split >= 0 ? uniqueIdentifier.slice(0, split) : ''
  const pluginName = split >= 0 ? uniqueIdentifier.slice(split + 1) : uniqueIdentifier
  const manifest = {type: 'plugin', author, name: pluginName, version,
    label: {en_US: name, zh_Hans: name}, description: {en_US: 'Explicit unit test fixture'}, icon: 'icon.svg',
    created_at: '2025-01-01T00:00:00Z', resource: {memory: 268435456}, plugins: {tools: ['provider/test.yaml']},
    meta: {version: '0.0.1', arch: ['amd64', 'arm64'], runner: {language: 'python', version: '3.12', entrypoint: 'main'}}}
  return Buffer.from(zipSync({'manifest.yaml': strToU8(stringify(manifest)),
    '_assets/icon.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'provider/test.yaml': strToU8('identity: {name: test}\n'), 'main.py': strToU8('# Unit fixture; upstream runtime is mocked\n'),
    'requirements.txt': strToU8(dependencies.map(item => `${item.name}==${item.version}`).join('\n')),
    ...overrides}))
}
