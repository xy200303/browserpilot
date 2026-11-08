// 校验代码里用到的 i18n key 都在中文资源里存在。
// 用法：npm run i18n:check
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const root = process.cwd()
const locales = join(root, 'src/shared/i18n/zh-CN')

function collectKeys() {
  const keys = new Set()
  for (const name of readdirSync(locales)) {
    if (!name.endsWith('.ts')) continue
    const source = readFileSync(join(locales, name), 'utf8')
    const stack = []
    for (const line of source.split('\n')) {
      const indent = line.match(/^\s*/)[0].length
      const level = Math.floor(indent / 2)
      const object = line.match(/^\s*([A-Za-z0-9_]+):\s*\{/)
      if (object) {
        stack.length = level - 1
        stack[level - 1] = object[1]
      }
      // 一行里可能写好几个短键（a: 'x', b: 'y'），全部收下
      const body = object ? line.slice(line.indexOf('{') + 1) : line
      const owner = object ? level : level - 1
      for (const leaf of body.matchAll(/([A-Za-z0-9_]+):\s*(['"`])/g)) {
        keys.add([...stack.slice(0, owner), leaf[1]].join('.'))
      }
    }
  }
  return keys
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, files)
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) files.push(path)
  }
  return files
}

// 主进程代码里不允许硬编码中文（注释和 i18n-ignore 区段除外）。
function hardcodedChinese() {
  const hits = []
  for (const file of walk(join(root, 'src/main'))) {
    let ignoring = false
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (line.includes('i18n-ignore-start') || line.includes('i18n-ignore-end')) {
        ignoring = !ignoring
        return
      }
      if (ignoring || line.includes('i18n-ignore')) return
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return
      const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '')
      if (/[一-鿿]/.test(code)) hits.push(`${relative(root, file)}:${index + 1}`)
    })
  }
  return hits
}

const keys = collectKeys()
const used = new Set()
for (const dir of ['src/renderer/src', 'src/main']) {
  for (const file of walk(join(root, dir))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?:\bt|i18n\.t|\bmt)\(\s*['"`]([a-zA-Z0-9_.]+)['"`]/g)) used.add(match[1])
  }
}

const missing = [...used].filter((key) => !keys.has(key))
const unused = [...keys].filter((key) => !used.has(key))

console.log(`资源 key ${keys.size} 条，代码引用 ${used.size} 条`)
if (missing.length) {
  console.log(`\n引用了但资源里没有（${missing.length}）：`)
  for (const key of missing) console.log('  ' + key)
}
if (process.argv.includes('--unused')) {
  console.log(`\n资源里有但代码没引用（${unused.length}）：`)
  for (const key of unused) console.log('  ' + key)
}
const chinese = hardcodedChinese()
if (chinese.length) {
  console.log(`
主进程里还有硬编码中文（${chinese.length} 行）：`)
  for (const line of chinese) console.log('  ' + line)
}

if (missing.length || chinese.length) process.exit(1)
