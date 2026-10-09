import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_COLUMNS, MAX_LINES, previewLines } from './og-image.js'

test('previewLines keeps short content as is', () => {
  assert.deepEqual(previewLines('a\r\nb\n\n  c  \n\n'), { lines: ['a', 'b', '', '  c'], truncated: false })
})

test('previewLines limits the number of lines', () => {
  const { lines, truncated } = previewLines(Array.from({ length: MAX_LINES + 5 }, (_, i) => `line ${i}`).join('\n'))
  assert.equal(lines.length, MAX_LINES)
  assert.equal(lines.at(-1), `line ${MAX_LINES - 1}`)
  assert.equal(truncated, true)
})

test('previewLines cuts long lines by display width (CJK and emoji count as two)', () => {
  const ascii = previewLines('a'.repeat(MAX_COLUMNS + 10)).lines[0]!
  assert.equal(ascii, 'a'.repeat(MAX_COLUMNS - 1) + '…')

  const wide = previewLines('中'.repeat(MAX_COLUMNS)).lines[0]!
  assert.equal(wide, '中'.repeat(Math.floor((MAX_COLUMNS - 1) / 2)) + '…')

  const emoji = previewLines('✅'.repeat(MAX_COLUMNS)).lines[0]!
  assert.equal(emoji, '✅'.repeat(Math.floor((MAX_COLUMNS - 1) / 2)) + '…')

  assert.equal(previewLines('a'.repeat(MAX_COLUMNS - 1)).truncated, false)
})

test('previewLines expands tabs and drops invisible and direction-control characters', () => {
  const { lines } = previewLines('\tx\u0000y​z‮evil⁦')
  assert.deepEqual(lines, ['    xyzevil'])
})
