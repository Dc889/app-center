import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {zipSync, strToU8} from 'fflate'
import {stringify} from 'yaml'
import {check} from '../../runtime/http.mjs'

// An inspectable local echo tool. No model access, credentials or external I/O in plugin code.
export function buildLivePlugin(name, version) {
  check(/^[a-z0-9_]{1,64}$/.test(name) && /^\d+\.\d+\.\d+$/.test(version), 400, 'INVALID_LIVE_PLUGIN_IDENTITY')
  const label = {en_US: 'Capability verification echo', zh_Hans: '能力组件联调回声工具'}
  const identity = {author: 'appcenter', name, label, description: {en_US: 'Isolated local echo test'}, icon: 'icon.svg'}
  const manifest = {type: 'plugin', author: 'appcenter', name, version, label, description: identity.description,
    icon: 'icon.svg', created_at: '2025-01-01T00:00:00Z', resource: {memory: 268435456}, plugins: {tools: ['provider/verify.yaml']},
    meta: {version: '0.0.1', arch: ['amd64', 'arm64'], runner: {language: 'python', version: '3.12', entrypoint: 'main'}}}
  const provider = {identity, tools: ['tools/echo.yaml'], extra: {python: {source: 'provider/verify.py'}}}
  const tool = {identity: {author: 'appcenter', name: 'echo', label}, description: {human: {en_US: 'Return test input locally'}, llm: 'Local echo for deployment verification'},
    parameters: [{name: 'text', type: 'string', required: false, form: 'llm', label: {en_US: 'Text'}, human_description: {en_US: 'Test input'}}],
    extra: {python: {source: 'tools/echo.py'}}}
  const files = {
    'manifest.yaml': stringify(manifest), 'provider/verify.yaml': stringify(provider), 'tools/echo.yaml': stringify(tool),
    'requirements.txt': 'dify_plugin==0.2.0\n',
    'main.py': "from dify_plugin import Plugin, DifyPluginEnv\nplugin = Plugin(DifyPluginEnv(MAX_REQUEST_TIMEOUT=120))\nif __name__ == '__main__':\n    plugin.run()\n",
    'provider/verify.py': 'from dify_plugin import ToolProvider\nclass VerificationProvider(ToolProvider):\n    def _validate_credentials(self, credentials):\n        pass\n',
    'tools/echo.py': `from dify_plugin import Tool\nclass EchoTool(Tool):\n    def _invoke(self, tool_parameters):\n        yield self.create_text_message(${JSON.stringify(version + ': ')} + str(tool_parameters.get('text', 'ok')))\n`,
    '_assets/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2463eb"/></svg>',
  }
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)]))))
}


// Reuse only this test namespace; native installation checks still refuse an existing instance.
export function loadLivePluginName(dir) {
  const file = resolve(dir, 'live-plugin-namespace.json')
  if (existsSync(file)) {
    const state = JSON.parse(readFileSync(file, 'utf8'))
    check(state.owner === 'appcenter-capfin' && /^capfin_[a-f0-9]{8}$/.test(state.name), 409, 'INVALID_TEST_PLUGIN_NAMESPACE')
    return state.name
  }
  let name
  const previous = resolve(dir, 'live-plugin-native-report.json')
  if (existsSync(previous)) {
    const report = JSON.parse(readFileSync(previous, 'utf8'))
    if (report.ok && report.cleanupOk && /^capfin_[a-f0-9]{8}$/.test(report.pluginName)) name = report.pluginName
  }
  name ??= `capfin_${randomUUID().slice(0, 8)}`
  writeFileSync(file, JSON.stringify({owner: 'appcenter-capfin', name}, null, 2) + '\n')
  return name
}
