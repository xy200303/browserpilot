// 验证工作流存储：老 workflows.json 拆分、slug 去重、冲突拒绝、导出字节一致。
// 需要真实的 Electron（模块里用了 app.getPath），用 --user-data-dir 指到临时目录跑：
//   & electron.exe --no-sandbox scripts\probe-workflow-store.js --user-data-dir=<tmp>
// 前置：先把 src/main/services/workflow-store.ts 用 esbuild 打成 .tmp/wf-store.cjs
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const store = require('../.tmp/wf-store.cjs')
const root = app.getPath('userData')
const logFile = path.join(root, 'probe.log')
const log = (...parts) => fs.appendFileSync(logFile, `${parts.join(' ')}\n`)

function node(id) {
  return { id, data: { type: 'click', selector: '#go' } }
}

function makeWorkflow(id, name) {
  return {
    id,
    kind: 'app',
    version: '0.3.0',
    app: { name, mode: 'workflow', description: '', },
    workflow: { environment_variables: [], conversation_variables: [], graph: { nodes: [node('n1')], edges: [] } }
  }
}

try {
  app.whenReady().then(async () => {
    try {
      fs.mkdirSync(root, { recursive: true })
      // 1. 造一份老格式：两条同名的（验证撞 slug 加后缀）和两条唯一的
      fs.writeFileSync(
        path.join(root, 'workflows.json'),
        JSON.stringify([
          makeWorkflow('wf-dup-1', 'duplicate name'),
          makeWorkflow('wf-dup-2', 'duplicate name'),
          makeWorkflow('wf-1', 'boss auto apply'),
          makeWorkflow('wf-3', '大表抓取')
        ], null, 2)
      )

      const migrated = store.migrateLegacyWorkflows()
      log(`migrated=${migrated.moved} renamed=${JSON.stringify(migrated.renamed)}`)
      log(`files=${fs.readdirSync(store.workflowsDir()).filter((f) => f.endsWith('.json')).sort().join(',')}`)
      log(`legacyGone=${!fs.existsSync(path.join(root, 'workflows.json'))} marker=${fs.existsSync(path.join(root, 'workflows.json.migrated'))}`)
      log(`listed=${store.listWorkflows().length}`)

      // 2. 同 slug 不同名 -> 必须拒绝
      let conflict = 'none'
      try {
        store.saveWorkflow(makeWorkflow('wf-x', '完全不同的名字'), { slug: 'boss-auto-apply' })
      } catch (error) {
        conflict = error.message
      }
      log(`conflict=${conflict}`)

      // 3. 同 slug 同名 -> 覆盖，且目录里不留 .tmp
      store.saveWorkflow(makeWorkflow('wf-1', 'boss auto apply'), { slug: 'boss-auto-apply' })
      const dir = store.workflowsDir()
      log(`tmpLeft=${fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')).length}`)

      // 4. 按 slug / id / 名字都能找到同一个
      const bySlug = store.findWorkflow('boss-auto-apply')
      const byId = store.findWorkflow('wf-1')
      const byName = store.findWorkflow('boss auto apply')
      log(`findSame=${bySlug?.id === byId?.id && byId?.id === byName?.id}`)

      // 5. 删除
      store.removeWorkflow('boss-auto-apply')
      log(`afterRemove=${fs.existsSync(path.join(dir, 'boss-auto-apply.json'))} listed=${store.listWorkflows().length}`)

      log('exit=0')
      app.exit(0)
    } catch (error) {
      log(`error=${error && error.stack ? error.stack : error}`)
      app.exit(1)
    }
  })
} catch (error) {
  fs.mkdirSync(root, { recursive: true })
  log(`boot-error=${error && error.stack ? error.stack : error}`)
  process.exit(1)
}
