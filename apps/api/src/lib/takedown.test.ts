import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { buildTestApp } from '../testing.js'
import { generateCode } from './code.js'
import { describeTarget, parseTarget, setDisabled } from './takedown.js'

test('parseTarget accepts URLs and explicit kinds', () => {
  const cases: Array<[string[], ReturnType<typeof parseTarget>]> = [
    [['https://qzz.tw/abc1234'], { kind: 'link', code: 'abc1234' }],
    [['https://qzz.tw/abc1234/'], { kind: 'link', code: 'abc1234' }],
    [['qzz.tw/abc1234'], null],
    [['/abc1234'], { kind: 'link', code: 'abc1234' }],
    [['abc1234'], { kind: 'link', code: 'abc1234' }],
    [['https://qzz.tw/v1/links/abc1234'], { kind: 'link', code: 'abc1234' }],
    [['https://qzz.tw/p/abc1234'], { kind: 'paste', code: 'abc1234' }],
    [['http://localhost:3000/p/abc1234'], { kind: 'paste', code: 'abc1234' }],
    [['https://qzz.tw/v1/pastes/abc1234/raw'], { kind: 'paste', code: 'abc1234' }],
    [['link', 'abc1234'], { kind: 'link', code: 'abc1234' }],
    [['paste', 'abc1234'], { kind: 'paste', code: 'abc1234' }],
  ]
  for (const [args, expected] of cases) {
    assert.deepEqual(parseTarget(args), expected, args.join(' '))
  }
})

test('parseTarget rejects anything else', () => {
  for (const args of [[], ['https://qzz.tw/'], ['https://qzz.tw/a/b'], ['bad-code!'], ['file', 'abc1234'], ['link'], ['a'.repeat(17)]]) {
    assert.equal(parseTarget(args), null, JSON.stringify(args))
  }
})

const linkCode = generateCode()
const pasteCode = generateCode()
let app: Awaited<ReturnType<typeof buildTestApp>>

before(async () => {
  app = await buildTestApp()
  await db.insert(schema.links).values({ code: linkCode, url: 'https://example.com/target', deleteTokenHash: 'x' })
  await db.insert(schema.pastes).values({ code: pasteCode, content: 'hello', deleteTokenHash: 'x' })
})

after(async () => {
  await db.delete(schema.links).where(inArray(schema.links.code, [linkCode]))
  await db.delete(schema.pastes).where(inArray(schema.pastes.code, [pasteCode]))
  await app.close()
})

test('setDisabled takes a link down and restores it', async () => {
  const target = { kind: 'link', code: linkCode } as const
  const redirect = () => app.inject({ method: 'GET', url: `/v1/links/${linkCode}` })

  assert.equal((await redirect()).statusCode, 302)
  assert.equal(await setDisabled(target, true), true)
  assert.equal((await redirect()).statusCode, 404)
  assert.equal((await describeTarget(target))?.disabled, true)

  assert.equal(await setDisabled(target, false), true)
  assert.equal((await redirect()).statusCode, 302)
})

test('setDisabled takes a paste down (page and raw)', async () => {
  const target = { kind: 'paste', code: pasteCode } as const
  assert.equal(await setDisabled(target, true), true)
  for (const url of [`/v1/pastes/${pasteCode}`, `/v1/pastes/${pasteCode}/raw`]) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404, url)
  }

  const described = await describeTarget(target)
  assert.equal(described && 'preview' in described && described.preview, 'hello')
})

test('setDisabled reports unknown codes', async () => {
  assert.equal(await setDisabled({ kind: 'link', code: generateCode() }, true), false)
})
