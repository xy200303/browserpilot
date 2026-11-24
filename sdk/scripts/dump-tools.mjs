// 从运行中的 App 抓一份工具目录快照，落到 sdk/spec/tools.json。
// 用法：node sdk/scripts/dump-tools.mjs [输出路径]
// 先构建 SDK：cd sdk/node && node build.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mcpFile } from '../node/dist/index.js'

// 用 fileURLToPath，别用 URL.pathname：后者会把中文路径百分号编码，
// 在 Windows 上会造出一个叫 %E6%B5%8F... 的目录。
const out = process.argv[2] || fileURLToPath(new URL('../spec/tools.json', import.meta.url))
const file = process.env.BROWSERPILOT_MCP_FILE || mcpFile()
const saved = JSON.parse(readFileSync(file, 'utf8'))

const response = await fetch(`${saved.api}/tools`, {
  headers: { Authorization: `Bearer ${saved.token}` }
})
if (!response.ok) {
  console.error(`✗ 拿工具目录失败：HTTP ${response.status}`)
  process.exit(1)
}
const payload = await response.json()
const tools = (payload.tools ?? []).map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema
}))

mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  JSON.stringify({ appVersion: payload.version, count: tools.length, tools }, null, 2) + '\n',
  'utf8'
)
console.log(`✓ ${tools.length} 个工具 → ${out}（App v${payload.version}）`)
