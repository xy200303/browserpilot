// 验证「改架构前必须先确认的一件事」：userData 目录不同，单实例锁是否互不影响。
// 结论决定「每套环境一个 user-data-dir」能不能成立。
//
// 用法（不要在 DSH 这类 ELECTRON_RUN_AS_NODE=1 的 shell 里直接跑，先清掉）：
//   $env:ELECTRON_RUN_AS_NODE = $null
//   $env:PROBE_OUT = "$PWD\lock.log"
//   $env:PROBE_SPAWN_DIRS = "$PWD\.probe-a;$PWD\.probe-b"
//   & node_modules\electron\dist\electron.exe scripts\probe-userdata-lock.js --user-data-dir="$PWD\.probe-a"
//
// 父进程持锁期间会用 spawn 起两个子实例（同目录 / 不同目录），各写一个 child-*.log：
//   child-0（同一个 user-data-dir）应当 lock=false —— 单实例锁生效
//   child-1（不同的 user-data-dir）应当 lock=true  —— 两个进程能并存
// 不创建任何窗口。
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const path = require('node:path')

const out = process.env.PROBE_OUT
if (!out) {
  console.error('需要 PROBE_OUT（日志文件绝对路径），用法见文件头部注释')
  process.exit(2)
}
const line = (text) => fs.appendFileSync(out, `${text}\n`)

try {
  const { app } = require('electron')
  line(`pid=${process.pid} userData=${app.getPath('userData')} lock=${app.requestSingleInstanceLock()}`)

  const dirs = (process.env.PROBE_SPAWN_DIRS || '').split(';').filter(Boolean)
  // 有些环境（容器、受限会话）里 Chromium 沙箱起不来，子进程也要带同样的开关。
  const extra = (process.env.PROBE_EXEC_ARGS || '').split(' ').filter(Boolean)
  app.whenReady().then(async () => {
    for (const [index, dir] of dirs.entries()) {
      const childOut = path.join(path.dirname(out), `child-${index}.log`)
      fs.writeFileSync(childOut, '')
      const child = spawn(process.execPath, [...extra, __filename, `--user-data-dir=${dir}`], {
        stdio: 'ignore',
        env: { ...process.env, PROBE_OUT: childOut, PROBE_MS: '800', PROBE_SPAWN_DIRS: '' }
      })
      child.unref()
      await new Promise((resolve) => setTimeout(resolve, 1800))
    }
    line('quit=done')
    app.exit(0)
  })
} catch (error) {
  line(`error=${error && error.stack ? error.stack : error}`)
  process.exit(1)
}
