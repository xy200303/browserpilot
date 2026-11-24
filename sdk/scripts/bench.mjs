// 并行度基准：同一个窗口里开 N 个标签，比较串行与并发的墙钟时间。
//   node sdk/scripts/bench.mjs [N]
// 会临时把 maxLiveTabs 调高、关掉休眠，跑完恢复原值并删掉临时环境。
import { connect } from '../node/dist/index.js'

const count = Math.max(2, Math.min(20, Number(process.argv[2] ?? 8)))
const bp = await connect()

const before = (await bp.call('settings_get')).settings
const restore = { maxLiveTabs: before.maxLiveTabs, tabHibernateMinutes: before.tabHibernateMinutes }
console.log(`当前 maxLiveTabs=${restore.maxLiveTabs} 休眠=${restore.tabHibernateMinutes} 分钟，本次测 ${count} 个标签`)

let envId
const pages = []
try {
  await bp.call('settings_set', { maxLiveTabs: count + 2, tabHibernateMinutes: 0 })
  const created = await bp.call('env_create', { name: `并行基准 ${count}`, remark: '临时性能测试' })
  envId = String(created.env)

  const opened = Date.now()
  for (let index = 0; index < count; index += 1) {
    pages.push(await bp.newPage({ env: envId }))
  }
  console.log(`开 ${count} 个标签：${Date.now() - opened}ms`)

  const html = (index) =>
    'data:text/html,' +
    encodeURIComponent(
      `<!doctype html><title>标签 ${index}</title>` +
        `<h1 id="h">第 ${index} 行</h1>`.repeat(1) + `<p class="row">文字</p>`.repeat(40) +
        `<input id="v" value="${index}"><button>ok</button>`
    )

  // 每个标签的工作量：导航 + 读标题 + 数元素 + 取文本 + 无障碍树 + 截图
  const work = async (page, index) => {
    await page.goto(html(index))
    await page.title()
    await page.count('div')
    await page.textContent('#h')
    await page.snapshot()
    await page.screenshot()
  }

  const sequential = Date.now()
  for (let index = 0; index < count; index += 1) await work(pages[index], index)
  const sequentialMs = Date.now() - sequential

  const concurrent = Date.now()
  await Promise.all(pages.map((page, index) => work(page, index)))
  const concurrentMs = Date.now() - concurrent

  console.log(`\n串行 ${count} 个任务：${sequentialMs}ms（平均 ${Math.round(sequentialMs / count)}ms/个）`)
  console.log(`并发 ${count} 个任务：${concurrentMs}ms（平均 ${Math.round(concurrentMs / count)}ms/个）`)
  console.log(`加速比：${(sequentialMs / concurrentMs).toFixed(2)}x`)

  const tabs = await bp.call('tab_list', {})
  console.log(`环境内标签数：${tabs.tabs.filter((tab) => tab.envId === envId).length}`)
} finally {
  for (const page of pages) await page.close().catch(() => undefined)
  if (envId) await bp.call('env_delete', { env: envId }).catch(() => undefined)
  await bp.call('settings_set', restore).catch(() => undefined)
  console.log(`设置已恢复：maxLiveTabs=${restore.maxLiveTabs} 休眠=${restore.tabHibernateMinutes}`)
  await bp.close()
}
