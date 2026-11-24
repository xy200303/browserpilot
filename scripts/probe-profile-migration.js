// 验证三件事，用 PROBE_MODE 选：
//   partition-set   用 fromPartition 写 cookie 并 flush
//   partition-read  重启后用 fromPartition 读回来（对照组：证明持久化本身可行）
//   frompath        用 fromPath 读写
// PROBE_ROOT 指定临时根目录，PROBE_SET=1 时额外写一个 cookie。
const fs = require('node:fs')
const path = require('node:path')

const root = process.env.PROBE_ROOT
const mode = process.env.PROBE_MODE
const logFile = root ? path.join(root, 'probe.log') : null
const log = (...parts) => {
  if (logFile) fs.appendFileSync(logFile, `${parts.join(' ')}\n`)
}

if (!root || !mode || !path.isAbsolute(root)) {
  console.error('需要 PROBE_ROOT（绝对路径）和 PROBE_MODE（partition-set | partition-read | frompath）')
  process.exit(2)
}

const dump = async (ses) => {
  const all = await ses.cookies.get({})
  const byUrl = await ses.cookies.get({ url: 'https://example.com' })
  return `all=[${all.map((c) => `${c.name}=${c.value}`).join(',')}] url=[${byUrl.map((c) => `${c.name}=${c.value}`).join(',')}]`
}

try {
  const { app, session } = require('electron')
  app.setPath('userData', root)

  app.whenReady().then(async () => {
    try {
      log(`mode=${mode}`)
      // 注意：不带 expirationDate 的是会话 cookie，Chromium 不落盘，看起来就像"持久化失效"。
      const expires = Date.now() / 1000 + 86_400
      if (mode === 'partition-set') {
        const ses = session.fromPartition('persist:probe-env')
        await ses.cookies.set({ url: 'https://example.com', name: 'probe', value: 'from-partition', expirationDate: expires })
        await ses.cookies.flushStore()
        log(`partition-set ${await dump(ses)}`)
      } else if (mode === 'partition-read') {
        const ses = session.fromPartition('persist:probe-env')
        log(`partition-read ${await dump(ses)}`)
      } else {
        const ses = session.fromPath(path.join(root, 'profiles', 'probe-env'))
        log(`frompath-before ${await dump(ses)}`)
        if (process.env.PROBE_SET === '1') {
          await ses.cookies.set({ url: 'https://example.com', name: 'second', value: 'from-path', expirationDate: expires })
          await ses.cookies.flushStore()
          log(`frompath-after-write ${await dump(ses)}`)
        }
      }
      log('exit=0')
      app.exit(0)
    } catch (error) {
      log(`error=${error && error.stack ? error.stack : error}`)
      app.exit(1)
    }
  })
} catch (error) {
  log(`boot-error=${error && error.stack ? error.stack : error}`)
  process.exit(1)
}
