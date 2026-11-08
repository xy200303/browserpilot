// 校验 tool-catalog 里的检索别名表：键必须对应真实工具，别名必须是描述里没有的新词。
// 用法：npm run tools:check
import { readFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const source = readFileSync(join(root, 'src/main/services/tool-catalog.ts'), 'utf8')

function fail(message) {
  console.error(`  ✗ ${message}`)
  process.exitCode = 1
}

const tools = new Map()
for (const match of source.matchAll(/^tool\('([a-z0-9_]+)',\s*'([^']*)'/gm)) {
  tools.set(match[1], match[2])
}

const block = source.match(/const TOOL_KEYWORDS: Record<string, string> = \{([\s\S]*?)\n\}/)
if (!block) {
  console.error('找不到 TOOL_KEYWORDS')
  process.exit(1)
}

const aliases = new Map()
for (const match of block[1].matchAll(/^\s{2}([a-z0-9_]+): '([^']*)'/gm)) {
  if (aliases.has(match[1])) fail(`别名重复：${match[1]}`)
  aliases.set(match[1], match[2])
}

const groups = [...source.matchAll(/\['([a-z_]+)', '([A-Za-z ]+)'\]/g)].map((item) => [item[1], item[2]])
const groupOf = (name) => groups.find(([prefix]) => name.startsWith(prefix))?.[1] ?? 'Other'

let redundantWords = 0
let aliased = 0
const missing = []

for (const name of aliases.keys()) {
  if (!tools.has(name)) fail(`别名表里的 ${name} 没有对应工具（改名或删除了？）`)
}

for (const [name, description] of tools) {
  const alias = aliases.get(name)
  if (!alias) {
    missing.push(name)
    continue
  }
  aliased += 1
  if (/[一-鿿]/.test(alias)) fail(`${name} 的别名里有中文：${alias}`)
  const hay = `${name} ${description} ${groupOf(name)}`.toLowerCase()
  const words = alias.toLowerCase().split(/[,\s]+/).filter(Boolean)
  if (!words.length) {
    fail(`${name} 的别名为空`)
    continue
  }
  const repeated = words.filter((word) => hay.includes(word))
  redundantWords += repeated.length
  if (repeated.length === words.length) {
    fail(`${name} 的别名全是描述里已有的词，删掉或换成同义词：${alias}`)
  }
}

console.log(`工具 ${tools.size} 条，带别名 ${aliased} 条，无别名 ${missing.length} 条（${missing.join(', ') || '无'}）`)
console.log(`其中 ${redundantWords} 个词与描述重复`)
if (process.exitCode) console.error('工具检索别名校验失败')
else console.log('工具检索别名校验通过')
