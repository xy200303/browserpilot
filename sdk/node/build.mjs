// 只用 tsc，不引入 bundler：ESM 走 dist/，CJS 走 dist/cjs/（配一个 type:commonjs 的包描述）。
// tsc 从仓库根目录的 node_modules 取，SDK 自己不重复装一份。
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
process.chdir(here)
const tsc = join(here, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc')

rmSync('dist', { recursive: true, force: true })
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' })
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.cjs.json'], { stdio: 'inherit' })
writeFileSync(join(here, 'dist', 'cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2))
