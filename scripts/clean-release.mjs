#!/usr/bin/env node
// 清理 release/ 里旧版本的安装包，只保留最近 N 个版本；win-unpacked 等当前产物不动。
// 用法: node scripts/clean-release.mjs [--keep 2] [--dry-run]
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const keepAt = args.indexOf('--keep')
const keep = Math.max(1, Number(keepAt >= 0 ? args[keepAt + 1] : 2) || 2)
const dryRun = args.includes('--dry-run')
const dir = 'release'

function versionOf(name) {
  let match = name.match(/^BrowserPilot Setup (\d+\.\d+\.\d+)\.exe(?:\.blockmap)?$/)
  if (match) return match[1]
  match = name.match(/^BrowserPilot-(\d+\.\d+\.\d+)-win\.zip$/)
  if (match) return match[1]
  return null
}

function compare(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i]
  }
  return 0
}

const files = readdirSync(dir)
const versions = [...new Set(files.map(versionOf).filter(Boolean))].sort(compare)
const keepVersions = new Set(versions.slice(0, keep))
let freed = 0
let removed = 0

for (const name of files) {
  const version = versionOf(name)
  if (!version || keepVersions.has(version)) continue
  const path = join(dir, name)
  const stat = statSync(path)
  if (dryRun) {
    console.log(`[dry-run] ${name} (${(stat.size / 1048576).toFixed(0)} MB)`)
  } else {
    unlinkSync(path)
    console.log(`removed ${name} (${(stat.size / 1048576).toFixed(0)} MB)`)
  }
  freed += stat.size
  removed += 1
}

console.log(`versions kept: ${[...keepVersions].join(', ') || '(none)'}`)
console.log(`${dryRun ? 'would remove' : 'removed'} ${removed} files, ${(freed / 1073741824).toFixed(2)} GB`)
