// 把根 package.json 的版本号同步到三个 SDK，并写出一份版本映射。
// 发版前跑一次：node sdk/scripts/sync-version.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

const touched = []

function replace(file, pattern, value) {
  if (!existsSync(file)) {
    console.log(`跳过（不存在）${file}`)
    return
  }
  const before = readFileSync(file, 'utf8')
  const after = before.replace(pattern, value)
  if (after === before) {
    console.log(`没变化 ${file}`)
    return
  }
  writeFileSync(file, after)
  touched.push(file)
  console.log(`更新 ${file}`)
}

const sdk = (...parts) => join(root, 'sdk', ...parts)

// Node：package.json + 版本常量
replace(sdk('node', 'package.json'), /"version": "[^"]+"/, `"version": "${version}"`)
replace(sdk('node', 'src', 'version.ts'), /APP_VERSION = '[^']+'/, `APP_VERSION = '${version}'`)
replace(sdk('node', 'src', 'version.ts'), /SDK_VERSION = '[^']+'/, `SDK_VERSION = '${version}'`)

// Python：pyproject + browserpilot/install.py 里的两个常量
replace(sdk('python', 'pyproject.toml'), /^version = "[^"]+"/m, `version = "${version}"`)
replace(sdk('python', 'browserpilot', 'install.py'), /^APP_VERSION = '[^']+'/m, `APP_VERSION = '${version}'`)
replace(sdk('python', 'browserpilot', 'install.py'), /^SDK_VERSION = '[^']+'/m, `SDK_VERSION = '${version}'`)

// Go：version.go 里是大写的 APPVersion / SDKVersion
replace(sdk('go', 'version.go'), /APPVersion = "[^"]+"/, `APPVersion = "${version}"`)
replace(sdk('go', 'version.go'), /SDKVersion = "[^"]+"/, `SDKVersion = "${version}"`)

mkdirSync(sdk('spec'), { recursive: true })
writeFileSync(
  sdk('spec', 'versions.json'),
  JSON.stringify({ sdk: version, app: version, note: 'SDK 与 App 同号；连上别人实例时不猜版本' }, null, 2) + '\n'
)
console.log(touched.length ? `\n改了 ${touched.length} 个文件，全部对齐到 v${version}` : `\n无需改动，已经是 v${version}`)
