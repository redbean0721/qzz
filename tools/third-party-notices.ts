// 產生 THIRD_PARTY_NOTICES.txt：列出實際打包進產物的 npm 套件和它們的授權條款原文。
// MIT / ISC 等授權要求散布時附上聲明，但壓縮後的 bundle 不會保留授權註解，所以另外產生這個檔案。
// 網站（apps/web/nuxt.config.ts）和擴充功能（apps/extension/wxt.config.ts）共用。
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

type PackageInfo = {
  name: string
  version: string
  license: string
  homepage?: string
  licenseText: string | null
}

const LICENSE_FILE = /^(licen[cs]e|copying)([-.].*)?$/i

// npm 上沒附 LICENSE 檔的套件：改用上游 repo 的授權原文（tools/licenses/，從 GitHub 原樣下載）
const UPSTREAM_LICENSES: Array<[RegExp, string]> = [
  // https://github.com/wxt-dev/wxt/blob/main/LICENSE
  [/^(wxt|@wxt-dev\/.+)$/, 'wxt.txt'],
  // https://github.com/lucide-icons/lucide/blob/main/LICENSE（@iconify-json/lucide 的 info.json 指向這份）
  [/^@iconify-json\/lucide$/, 'lucide.txt'],
]
const LICENSES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'licenses')

function upstreamLicense(name: string): string | null {
  const match = UPSTREAM_LICENSES.find(([pattern]) => pattern.test(name))
  return match ? `${readFileSync(join(LICENSES_DIR, match[1]), 'utf8').trim()}\n\n(License text from the upstream repository; the npm package does not include it.)` : null
}

function readPackage(dir: string): PackageInfo | null {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return null
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string
    version?: string
    license?: string | { type?: string }
    homepage?: string
  }
  if (!manifest.name) return null

  const licenseFile = readdirSync(dir).find((file) => LICENSE_FILE.test(file))
  const license = typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? 'UNKNOWN')
  return {
    name: manifest.name,
    version: manifest.version ?? '',
    license,
    homepage: manifest.homepage,
    licenseText: licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').trim() : upstreamLicense(manifest.name),
  }
}

// /x/node_modules/@scope/pkg/dist/a.js → /x/node_modules/@scope/pkg；不在 node_modules 裡的（自己的程式、workspace）回傳 null
export function packageDirOf(moduleId: string): string | null {
  const path = moduleId.replace(/^\0/, '').split('?')[0]!.replaceAll('\\', '/')
  const marker = '/node_modules/'
  const index = path.lastIndexOf(marker)
  if (index < 0) return null
  const rest = path.slice(index + marker.length).split('/')
  const nameParts = rest[0]?.startsWith('@') ? 2 : 1
  if (rest.length <= nameParts) return null
  return path.slice(0, index + marker.length) + rest.slice(0, nameParts).join('/')
}

// 從 fromDir 往上找 node_modules/<name>（跟 Node 解析套件的方式一樣）
function findInstalled(name: string, fromDir: string): string | null {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) return null
  }
}

export function createNoticeCollector(options: {
  title: string
  note?: string
  // 不會出現在 JS chunk 模組清單、但產物裡有它的程式碼的套件（例如 tailwindcss 產生的 CSS）
  alwaysInclude?: string[]
  // 解析 alwaysInclude 的起點，預設是目前的工作目錄（專案目錄）
  cwd?: string
}) {
  const packages = new Map<string, PackageInfo>()
  const seenDirs = new Set<string>()

  for (const name of options.alwaysInclude ?? []) {
    const dir = findInstalled(name, options.cwd ?? process.cwd())
    if (!dir) throw new Error(`third-party notices: package "${name}" is not installed`)
    seenDirs.add(dir)
    const info = readPackage(dir)
    if (info) packages.set(`${info.name}@${info.version}`, info)
  }

  function add(moduleIds: Iterable<string>) {
    for (const id of moduleIds) {
      const dir = packageDirOf(id)
      if (!dir || seenDirs.has(dir)) continue
      seenDirs.add(dir)
      const info = readPackage(dir)
      if (info) packages.set(`${info.name}@${info.version}`, info)
    }
  }

  function render(): string {
    const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))
    const rule = '-'.repeat(72)
    const header = [
      options.title,
      '',
      'This file lists the open-source packages bundled into this build and their licenses.',
      ...(options.note ? ['', options.note] : []),
      '',
      `Packages (${sorted.length}):`,
      ...sorted.map((p) => `  - ${p.name} ${p.version} (${p.license})`),
    ]
    const sections = sorted.map((p) =>
      [
        rule,
        `${p.name} ${p.version}`,
        `License: ${p.license}`,
        ...(p.homepage ? [`Homepage: ${p.homepage}`] : []),
        '',
        p.licenseText ?? `(This package does not ship a license file. Its package.json declares: ${p.license})`,
      ].join('\n'),
    )
    return `${[...header, '', ...sections].join('\n')}\n`
  }

  return {
    add,
    render,
    write(file: string) {
      const missing = [...packages.values()].filter((p) => p.licenseText === null).map((p) => p.name)
      if (missing.length > 0) {
        console.warn(`[third-party-notices] no license text for: ${missing.join(', ')} (add one to tools/licenses/)`)
      }
      writeFileSync(file, render())
    },
    get size() {
      return packages.size
    },
    // 加進 Vite 的 plugins：build 時收集 chunk 裡的模組；filter 決定要收集哪個 environment（例如只要 client）
    vitePlugin(filter: (environmentName: string | undefined) => boolean = () => true): Plugin {
      return {
        name: 'qzz:third-party-notices',
        apply: 'build',
        generateBundle(_options, bundle) {
          if (!filter(this.environment?.name)) return
          for (const output of Object.values(bundle)) {
            if (output.type === 'chunk') add(output.moduleIds)
          }
        },
      }
    },
  }
}
