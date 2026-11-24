// 对着真实的 BrowserPilot 跑一遍：连端点、开页、导航、截图、收事件。
// 用法：
//   node sdk/scripts/smoke.mjs                       # 读默认的 mcp.json
//   BROWSERPILOT_MCP_FILE=... node sdk/scripts/smoke.mjs
// 先构建 SDK：cd sdk/node && node build.mjs
import { readFileSync } from 'node:fs'
import { launch, mcpFile } from '../node/dist/index.js'

const file = process.env.BROWSERPILOT_MCP_FILE || mcpFile()
const saved = JSON.parse(readFileSync(file, 'utf8'))
if (!saved.api) {
  console.error(`✗ ${file} 里没有 api 字段：装的是旧版 App`)
  process.exit(1)
}

const log = (message) => console.log(message)
const started = Date.now()

const bp = await launch({ endpoint: { url: saved.url ?? '', api: saved.api, token: saved.token } })
let page
try {
  const envs = await bp.environments()
  log(`✓ 连上端点，环境 ${envs.length} 套：${envs.map((env) => env.id).join(', ')}`)

  page = await bp.newPage()
  log(`✓ 新标签 ${page.id}`)

  const before = await bp.call('env_list')
  await page.goto('https://example.com')
  log(`✓ 导航到 example.com，标题「${await page.title()}」`)

  const shot = await page.screenshot()
  log(`✓ 截图 ${shot.length} 字节`)

  await page.waitForText('Example', { timeout: 10 })
  log('✓ waitForText 找到 Example')

  // example.com 的版式会变（2026 年是 SVG + 段落，没有 h1），这里只验"能数出元素"
  const found = await page.count('p')
  log(`✓ count('p') = ${found}`)
  if (found === 0) console.error('⚠ 一个段落都没数到，页面可能没加载完')

  const events = await bp.transport.events({ since: before.seq, wait: 3 })
  const types = [...new Set(events.events.map((event) => event.type))]
  log(`✓ 事件 ${events.events.length} 条，类型：${types.join(', ') || '（无）'}`)
  const sawNavigation = events.events.some((event) => event.type === 'tab.navigation')
  if (!sawNavigation) console.error('⚠ 没收到 tab.navigation')

  log(`\n冒烟通过，用时 ${Date.now() - started}ms`)
} catch (error) {
  console.error('✗ 冒烟失败：', error)
  process.exitCode = 1
} finally {
  await page?.close().catch(() => undefined)
  await bp.close()
}
