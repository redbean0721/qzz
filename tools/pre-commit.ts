// husky pre-commit：只檢查這次 commit 暫存的檔案影響到的 workspace。
// 檢查的是工作目錄的內容（不是只有暫存的部分）；真的要跳過可以 git commit --no-verify
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkDeps, WORKSPACES, type WorkspaceKey } from './check-deps.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function staged(): string[] {
  const out = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRD'], { cwd: ROOT, encoding: 'utf8' })
  return out.stdout.split('\n').filter(Boolean)
}

function affected(files: string[]): Set<WorkspaceKey> {
  const keys = new Set<WorkspaceKey>()
  const all = Object.keys(WORKSPACES) as WorkspaceKey[]
  for (const file of files) {
    if (['package.json', 'yarn.lock', '.yarnrc.yml', '.node-version'].includes(file)) all.forEach((k) => keys.add(k))
    // shared 被其他所有 workspace 使用
    else if (file.startsWith('packages/shared/')) all.forEach((k) => keys.add(k))
    // tools/ 被網站和擴充功能的設定檔使用
    else if (file.startsWith('tools/')) ['web', 'extension'].forEach((k) => keys.add(k as WorkspaceKey))
    else for (const key of all) if (file.startsWith(`${WORKSPACES[key]}/`)) keys.add(key)
  }
  return keys
}

function reachable(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port, timeout: 500 })
    socket.once('connect', () => (socket.destroy(), done(true)))
    socket.once('timeout', () => (socket.destroy(), done(false)))
    socket.once('error', () => done(false))
  })
}

function run(label: string, command: string, args: string[]): void {
  const started = Date.now()
  // 終端機才顯示「進行中」再覆蓋成結果；Git 圖形介面等非終端機只印結果
  const tty = process.stdout.isTTY
  if (tty) process.stdout.write(`  … ${label}`)
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (result.status === 0) {
    process.stdout.write(`${tty ? '\r' : ''}  ✔ ${label} (${seconds}s)\n`)
    return
  }
  process.stdout.write(`${tty ? '\r' : ''}  ✘ ${label} (${seconds}s)\n`)
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n')
  console.error(output.slice(-80).join('\n'))
  console.error(`\npre-commit failed: ${label}\n(fix it, or skip once with git commit --no-verify)`)
  process.exit(1)
}

const skip = (message: string) => console.log(`  - ${message}`)

const files = staged()
const keys = affected(files)
const workflows = files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f) && existsSync(join(ROOT, f)))

if (keys.size === 0 && workflows.length === 0) process.exit(0)

console.log(`pre-commit: ${[...keys].join(', ') || 'workflows'}`)

if (keys.size > 0) {
  // 1. 依賴宣告：CI / Docker / AMO 只裝部分 workspace，沒宣告的套件在那裡會找不到
  const started = Date.now()
  const problems = checkDeps([...keys])
  if (problems.length > 0) {
    console.error(`  ✘ dependencies declared\n${problems.map((p) => `    - ${p}`).join('\n')}`)
    console.error('\npre-commit failed: add the missing packages to that workspace\'s package.json')
    process.exit(1)
  }
  console.log(`  ✔ dependencies declared (${((Date.now() - started) / 1000).toFixed(1)}s)`)

  // 2. shared 要先 build，其他 workspace 才拿得到最新的型別
  if (keys.has('shared') || !existsSync(join(ROOT, 'packages/shared/dist/index.d.ts'))) {
    run('shared: build', 'yarn', ['build:shared'])
  }

  if (keys.has('api')) {
    run('api: typecheck', 'yarn', ['workspace', '@qzz/api', 'typecheck'])
    // API 的測試需要本機的 Postgres + Valkey（yarn db:up）和 apps/api/.env（從 .env.example 複製）
    if (!existsSync(join(ROOT, 'apps/api/.env'))) {
      skip('api: test skipped (no apps/api/.env — copy apps/api/.env.example; CI still runs it)')
    } else if ((await reachable(5432)) && (await reachable(6379))) {
      run('api: test', 'yarn', ['workspace', '@qzz/api', 'test'])
    } else {
      skip('api: test skipped (Postgres/Valkey not running — `yarn db:up` to include it; CI still runs it)')
    }
  }

  if (keys.has('web')) {
    run('web: typecheck', 'yarn', ['workspace', '@qzz/web', 'typecheck'])
    run('web: lint', 'yarn', ['workspace', '@qzz/web', 'lint'])
  }

  if (keys.has('extension')) {
    run('extension: typecheck', 'yarn', ['workspace', '@qzz/extension', 'typecheck'])
    run('extension: test', 'yarn', ['workspace', '@qzz/extension', 'test'])
  }
}

// 3. workflow：用 Docker 跑 actionlint（含 shellcheck）
if (workflows.length > 0) {
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0) {
    run('workflows: actionlint', 'docker', [
      'run', '--rm', '-v', `${ROOT}:/repo`, '-w', '/repo', 'rhysd/actionlint:latest', '-no-color', ...workflows,
    ])
  } else {
    skip('workflows: actionlint skipped (Docker not available)')
  }
}
