// 檢查每個 workspace 是否宣告了自己用到的所有套件。
// 完整安裝 monorepo 時，沒宣告的套件常會從別的 workspace 提升到根目錄而「剛好能用」，
// 但 CI / Docker / AMO 審核用 `yarn workspaces focus` 只裝部分 workspace，就會壞掉
// （曾經發生過：extension 漏了 vite、@types/node）。
//   node tools/check-deps.ts            檢查全部 workspace
//   node tools/check-deps.ts api web    只檢查指定的 workspace
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const WORKSPACES = {
  shared: 'packages/shared',
  api: 'apps/api',
  web: 'apps/web',
  extension: 'apps/extension',
} as const
export type WorkspaceKey = keyof typeof WORKSPACES

const SOURCE_EXT = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.vue', '.css'])
const TS_EXT = new Set(['.ts', '.mts', '.cts', '.tsx', '.vue'])
const BUILTINS = new Set(builtinModules)

type Manifest = {
  name: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const IMPORT_PATTERNS = [
  // import x from 'y' / import type { x } from 'y' / export * from 'y'（可跨行）
  /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
  // import 'y'（只為了副作用）
  /\bimport\s*['"]([^'"]+)['"]/g,
  // import('y') / require('y')
  /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CSS: @import "tailwindcss"
  /@import\s+['"]([^'"]+)['"]/g,
]

function specifiersOf(code: string): string[] {
  // 去掉註解，避免把註解裡的範例當成 import
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')
  const found = new Set<string>()
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of stripped.matchAll(pattern)) found.add(match[1]!)
  }
  return [...found]
}

// 'wxt/browser' → 'wxt'、'@nuxt/ui/vite' → '@nuxt/ui'；不是套件的回傳 null
function packageNameOf(specifier: string): string | null {
  if (/^(\.|\/|~|#|@\/|virtual:|https?:|data:)/.test(specifier) || specifier.startsWith('\0')) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

const isBuiltin = (specifier: string) =>
  specifier.startsWith('node:') || BUILTINS.has(specifier.split('/')[0]!)

function gitFiles(dir: string): string[] {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', dir], { cwd: ROOT, encoding: 'utf8' })
  return out.split('\n').filter((file) => file && SOURCE_EXT.has(extname(file)) && existsSync(join(ROOT, file)))
}

// workspace 的檔案，加上它們用相對路徑引用到 workspace 外面的檔案（例如設定檔引用的 tools/）
function filesOf(workspaceDir: string): string[] {
  const files = new Set(gitFiles(workspaceDir))
  const queue = [...files]
  while (queue.length > 0) {
    const file = queue.pop()!
    for (const specifier of specifiersOf(readFileSync(join(ROOT, file), 'utf8'))) {
      if (!specifier.startsWith('.')) continue
      const target = relative(ROOT, resolve(ROOT, dirname(file), specifier))
      if (target.startsWith(`${workspaceDir}/`) || target.startsWith('..')) continue
      for (const candidate of [target, `${target}.ts`, `${target}.js`]) {
        if (existsSync(join(ROOT, candidate)) && SOURCE_EXT.has(extname(candidate)) && !files.has(candidate)) {
          files.add(candidate)
          queue.push(candidate)
          break
        }
      }
    }
  }
  return [...files]
}

export function checkImports(key: WorkspaceKey): string[] {
  const dir = WORKSPACES[key]
  const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as Manifest
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])

  const missing = new Map<string, Set<string>>()
  const note = (name: string, file: string) => missing.set(name, (missing.get(name) ?? new Set()).add(file))

  for (const file of filesOf(dir)) {
    const ts = TS_EXT.has(extname(file))
    for (const specifier of specifiersOf(readFileSync(join(ROOT, file), 'utf8'))) {
      if (isBuiltin(specifier)) {
        // 用到 Node 內建模組的 TypeScript 需要 @types/node
        if (ts && !declared.has('@types/node')) note('@types/node', file)
        continue
      }
      const name = packageNameOf(specifier)
      if (name && !declared.has(name)) note(name, file)
    }
  }

  return [...missing].map(([name, files]) => `${manifest.name}: uses "${name}" without declaring it (${[...files].slice(0, 3).join(', ')})`)
}

// yarn 的 peer 依賴檢查：只看「我們自己的 workspace 沒提供」的那種（第三方之間的不歸我們管）
export function checkPeers(keys: WorkspaceKey[]): string[] {
  let out: string
  try {
    out = execFileSync('yarn', ['explain', 'peer-requirements'], { cwd: ROOT, encoding: 'utf8' })
  } catch (err) {
    out = (err as { stdout?: string }).stdout ?? ''
  }
  const names = keys.map((key) => JSON.parse(readFileSync(join(ROOT, WORKSPACES[key], 'package.json'), 'utf8')).name as string)
  return out
    .split('\n')
    .filter((line) => line.includes('✘') && names.some((name) => line.includes(`✘ ${name}@workspace:`)))
    .map((line) => `${line.replace(/^.*?✘\s*/, '').trim()} (yarn explain peer-requirements ${line.trim().split(/\s/)[0]})`)
}

export function checkDeps(keys: WorkspaceKey[]): string[] {
  return [...keys.flatMap(checkImports), ...checkPeers(keys)]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2) as WorkspaceKey[]
  const keys = args.length > 0 ? args : (Object.keys(WORKSPACES) as WorkspaceKey[])
  const problems = checkDeps(keys)
  if (problems.length > 0) {
    console.error(`Undeclared dependencies:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`dependencies OK (${keys.join(', ')})`)
}
