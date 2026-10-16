// GitHub release 的說明：CHANGELOG.md 裡這個版本的那一節，加上固定的開頭（安裝）和結尾（附件、隱私權政策、完整變更）。
//   node apps/extension/scripts/release-notes.ts <版本> > notes.md
// 發布流程（.github/workflows/extension-release.yml）用它；CHANGELOG 沒有這個版本就失敗，release 和送審都不會做。
// Node 24 直接執行（去掉型別），所以只能用型別註記，不能用 enum 之類需要轉譯的語法
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type ChangelogSection = {
  /** 這一節的內容（不含版本標題），小標題升一級：CHANGELOG 的 ### → release 的 ## */
  body: string
  /** CHANGELOG 裡的上一個版本（給「完整變更」的比較連結）；第一個版本是 null */
  previous: string | null
}

const VERSION_HEADING = /^## (\S+)\s*$/

/** 找出 `## <version>` 那一節；沒有這一節或內容是空的就回傳 null */
export function changelogSection(changelog: string, version: string): ChangelogSection | null {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) => VERSION_HEADING.exec(line)?.[1] === version)
  if (start === -1) return null

  let end = lines.length
  let previous: string | null = null
  for (let i = start + 1; i < lines.length; i++) {
    const match = VERSION_HEADING.exec(lines[i]!)
    if (match) {
      end = i
      previous = match[1]!
      break
    }
  }

  const body = lines
    .slice(start + 1, end)
    .map((line) => line.replace(/^###(?=\s)/, '##'))
    .join('\n')
    .trim()
  return body ? { body, previous } : null
}

export function releaseNotes(section: ChangelogSection, version: string, repository: string): string {
  const compare = section.previous
    ? `\n\n**完整變更**：https://github.com/${repository}/compare/extension-v${section.previous}...extension-v${version}`
    : ''
  return `qzz 瀏覽器擴充功能 ${version}。各商店審核通過後，已安裝的使用者會自動更新。

## 安裝

請從商店安裝：

- Firefox：https://addons.mozilla.org/firefox/addon/qzz/
- Chrome / Edge：https://chromewebstore.google.com/detail/mjoadeofebgfmgoolhccpefhjicjgpac

${section.body}

## 附件

zip 是送審到商店的原始檔案，未經簽署，僅供對照與存檔：

| 檔案 | 說明 |
| --- | --- |
| qzz-${version}-firefox.zip | Firefox 版（Manifest V2，需要 Firefox 140 以上） |
| qzz-${version}-chrome.zip | Chrome / Edge 版（Manifest V3） |
| qzz-${version}-sources.zip | 原始碼，建置步驟見其中的 apps/extension/README.md |

隱私權政策：https://qzz.tw/privacy${compare}
`
}

// 直接執行時（不是被測試 import）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  if (!version) {
    console.error('usage: node apps/extension/scripts/release-notes.ts <version>')
    process.exit(2)
  }
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  const section = changelogSection(changelog, version)
  if (!section) {
    console.error(`apps/extension/CHANGELOG.md has no "## ${version}" section (or it is empty)`)
    process.exit(1)
  }
  process.stdout.write(releaseNotes(section, version, process.env.GITHUB_REPOSITORY ?? 'redbean0721/qzz'))
}
