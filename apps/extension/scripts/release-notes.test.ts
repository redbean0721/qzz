import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { changelogSection, releaseNotes } from './release-notes'

const changelog = `# 更新紀錄

說明文字，不屬於任何版本

## 0.2.0

### 新功能

- B

## 0.1.10

### 變更

- A2

## 0.1.1

- A1
`

test('changelogSection takes exactly the section of that version', () => {
  assert.deepEqual(changelogSection(changelog, '0.2.0'), { body: '## 新功能\n\n- B', previous: '0.1.10' })
  assert.deepEqual(changelogSection(changelog, '0.1.10'), { body: '## 變更\n\n- A2', previous: '0.1.1' })
  // 最舊的版本沒有上一版
  assert.deepEqual(changelogSection(changelog, '0.1.1'), { body: '- A1', previous: null })
})

test('changelogSection returns null for a missing or empty section and does not match prefixes', () => {
  assert.equal(changelogSection(changelog, '0.3.0'), null)
  assert.equal(changelogSection(changelog, '0.1'), null)
  assert.equal(changelogSection('## 1.0.0\n\n  \n## 0.9.0\n- x', '1.0.0'), null)
})

test('changelogSection accepts CRLF line endings', () => {
  assert.deepEqual(changelogSection('## 1.0.0\r\n\r\n- x\r\n', '1.0.0'), { body: '- x', previous: null })
})

test('releaseNotes wraps the section with install links, attachments and the compare link', () => {
  const notes = releaseNotes({ body: '## 新功能\n\n- B', previous: '0.1.10' }, '0.2.0', 'owner/repo')
  assert.match(notes, /^qzz 瀏覽器擴充功能 0\.2\.0。/)
  assert.ok(notes.includes('\n## 新功能\n\n- B\n\n## 附件\n'))
  for (const file of ['qzz-0.2.0-firefox.zip', 'qzz-0.2.0-chrome.zip', 'qzz-0.2.0-sources.zip']) {
    assert.ok(notes.includes(`| ${file} |`), file)
  }
  assert.ok(notes.endsWith('https://github.com/owner/repo/compare/extension-v0.1.10...extension-v0.2.0\n'))
  assert.ok(!releaseNotes({ body: '- A', previous: null }, '0.1.0', 'owner/repo').includes('完整變更'))
})

test('the real CHANGELOG has a section for the current package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  const real = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  assert.ok(changelogSection(real, pkg.version), `CHANGELOG.md needs a "## ${pkg.version}" section`)
})
