import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DESCRIPTION_CHARS, markdownBlocks, pasteDescription } from './paste-summary.js'

test('markdownBlocks turns markdown into simple blocks', () => {
  const blocks = markdownBlocks(
    [
      '# Title',
      '',
      'Some **bold**, `code`, ~~gone~~ and a [link](https://example.com) ![alt](https://example.com/a.png)',
      '',
      '> quoted',
      '',
      '3. three',
      '4. four',
      '   - nested',
      '',
      '```js',
      'let a = 1',
      '```',
      '',
      '---',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n'),
  )

  assert.deepEqual(blocks[0], { type: 'heading', level: 1, inlines: [{ text: 'Title', bold: false, link: false, strike: false }] })

  const paragraph = blocks[1]
  assert.equal(paragraph?.type, 'text')
  if (paragraph?.type !== 'text') return
  assert.deepEqual(
    paragraph.inlines.map((inline) => [inline.text, Object.keys(inline).filter((key) => key !== 'text' && inline[key as 'bold'])]),
    [
      ['Some ', []],
      ['bold', ['bold']],
      [', ', []],
      ['code', ['code']],
      [', ', []],
      ['gone', ['strike']],
      [' and a ', []],
      ['link', ['link']],
      [' [圖片：alt]', []],
    ],
  )

  assert.deepEqual(
    blocks.slice(2).map((block) => (block.type === 'text' ? [block.type, block.marker, block.indent, block.quote] : [block.type])),
    [
      ['text', undefined, 0, true],
      ['text', '3.', 1, false],
      ['text', '4.', 1, false],
      ['text', '•', 2, false],
      ['code'],
      ['rule'],
      ['text', undefined, 0, false],
      ['text', undefined, 0, false],
    ],
  )
  assert.deepEqual(blocks[6], { type: 'code', text: 'let a = 1', indent: 0, quote: false })
})

test('markdownBlocks keeps raw HTML as text and drops invisible characters', () => {
  const [block] = markdownBlocks('<b>hi</b>‮!')
  assert.equal(block?.type === 'text' && block.inlines.map((inline) => inline.text).join(''), '<b>hi</b>!')
})

test('pasteDescription strips markdown but keeps other languages verbatim', () => {
  assert.equal(pasteDescription('## Hi\n\n- **a**\n- b\n1. c', 'markdown'), 'Hi a b 1. c')
  assert.equal(pasteDescription('## Hi\n\n- **a**', 'text'), '## Hi - **a**')
  assert.equal(pasteDescription('a\u0000b\t\n c', null), 'ab c')

  const long = pasteDescription('字'.repeat(500), null)
  assert.equal(long, '字'.repeat(DESCRIPTION_CHARS) + '…')
})
