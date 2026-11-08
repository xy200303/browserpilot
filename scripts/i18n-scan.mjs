// 统计渲染层还有多少写死的中文文案，用来跟 i18n 迁移进度。
// 用法：npm run i18n:scan
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const root = join(process.cwd(), 'src/renderer/src')
const han = /[\u4e00-\u9fff]/
const literal = /(['"`])((?:(?!\1).)*[\u4e00-\u9fff](?:(?!\1).)*)\1/g

const rows = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) {
      walk(path)
      continue
    }
    if (!name.endsWith('.tsx') && !name.endsWith('.ts')) continue
    if (path.endsWith('i18n.ts')) continue
    const source = readFileSync(path, 'utf8')
    const hits = [...source.matchAll(literal)].map((match) => match[2].trim()).filter((text) => text && han.test(text))
    if (hits.length) rows.push({ file: relative(root, path).replace(/\\/g, '/'), count: hits.length, sample: hits[0] })
  }
}
walk(root)
rows.sort((a, b) => b.count - a.count)
const total = rows.reduce((sum, row) => sum + row.count, 0)
for (const row of rows) console.log(`${String(row.count).padStart(4)}  ${row.file.padEnd(28)} ${row.sample.slice(0, 40)}`)
console.log(`\n共 ${total} 条待迁移，涉及 ${rows.length} 个文件`)
