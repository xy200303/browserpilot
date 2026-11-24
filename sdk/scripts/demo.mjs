// 对着已安装的 BrowserPilot 跑一遍 SDK 的能力演示。
//   node sdk/scripts/demo.mjs
// 会新建一套临时环境，跑完删掉，不碰你正在用的环境。
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { connect } from '../node/dist/index.js'

const results = []
const step = async (name, fn) => {
  const started = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - started, detail })
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
    return detail
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: error.message })
    console.log(`✗ ${name} — ${error.message}`)
    return undefined
  }
}

const html = `<!doctype html><meta charset="utf-8"><title>SDK 演示页</title>
<input id="name" placeholder="名字">
<button id="go" onclick="document.getElementById('out').textContent='hello '+document.getElementById('name').value">Go</button>
<p id="out">waiting</p>`

const bp = await connect()
let envId
let page
try {
  const envs = await step('列出环境', async () => {
    const list = await bp.environments()
    return `${list.length} 套：${list.map((item) => item.id).join(', ')}`
  })

  envId = await step('新建临时环境', async () => {
    const created = await bp.call('env_create', { name: `SDK 演示 ${Date.now() % 10000}`, remark: 'SDK 能力演示，跑完就删' })
    return String(created.env ?? created.id ?? '')
  })

  await step('打开标签页', async () => {
    page = await bp.newPage({ env: envId })
    return page.id
  })

  await step('导航到本地页面', async () => {
    await page.goto('data:text/html,' + encodeURIComponent(html))
    return `标题「${await page.title()}」`
  })

  await step('填表单并点击', async () => {
    await page.fill('#name', '小明')
    await page.click('#go')
    await page.waitForText('hello 小明', { timeout: 5 })
    return await page.textContent('#out')
  })

  await step('数元素 / 可见性', async () => `${await page.count('input')} 个 input，按钮可见=${await page.isVisible('#go')}`)

  await step('执行脚本', async () => {
    const data = await page.call('page_script', { source: "document.getElementById('out').textContent" })
    return String(data.value)
  })

  await step('无障碍快照', async () => {
    const snapshot = await page.snapshot()
    return `${snapshot.split('\n').length} 行`
  })

  await step('截图', async () => {
    const shot = await page.screenshot()
    const file = join(tmpdir(), `browserpilot-demo-${Date.now()}.png`)
    writeFileSync(file, shot)
    return `${shot.length} 字节 → ${file}`
  })

  await step('页面 console', async () => {
    await page.call('page_script', { source: "console.error('演示用的错误日志')" })
    const logs = await page.consoleLogs()
    return `${logs.length} 条，最后一条：${logs[0]?.message ?? '无'}`
  })

  await step('等待超时会抛错', async () => {
    try {
      await page.waitForText('这段文字永远不会出现', { timeout: 1 })
      throw new Error('应该超时但没超时')
    } catch (error) {
      return `按预期失败（${error.constructor.name}）：${error.message.slice(0, 24)}…`
      throw error
    }
  })

  await step('事件通道', async () => {
    const before = await bp.call('env_list')
    await page.goto('data:text/html,<title>事件测试</title><p>hi</p>')
    const result = await bp.transport.events({ since: before.seq, wait: 2000 })
    const types = [...new Set(result.events.map((event) => event.type))]
    return `${result.events.length} 条：${types.slice(0, 5).join(', ')}`
  })

  await step('网络抓包', async () => {
    await bp.call('net_start', { tabId: page.id })
    await page.goto('https://example.com')
    const list = await bp.call('net_list', { tabId: page.id, urlContains: 'example.com' })
    await bp.call('net_stop', { tabId: page.id })
    return `${list.requests.length} 个请求`
  })

  await step('环境隔离（历史）', async () => {
    const history = await bp.call('history_list', { env: envId })
    return `${history.history.length} 条记录`
  })

  await step('每环境网络配置', async () => {
    const before = await bp.call('network_get', { env: envId })
    await bp.call('network_set', { env: envId, proxy: { mode: 'direct' }, acceptLanguages: 'zh-CN' })
    const after = await bp.call('network_get', { env: envId })
    return `${JSON.stringify(before.config.proxy)} → ${JSON.stringify(after.config.proxy)}，语言=${after.config.acceptLanguages}`
  })
} finally {
  await page?.close().catch(() => undefined)
  if (envId) await bp.call('env_delete', { env: envId }).catch(() => undefined)
  await bp.close()
}

const passed = results.filter((item) => item.ok).length
console.log(`\n${passed}/${results.length} 步通过，总耗时 ${results.reduce((sum, item) => sum + item.ms, 0)}ms`)
if (passed !== results.length) process.exitCode = 1
