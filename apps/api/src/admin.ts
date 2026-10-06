// 管理員下架工具：yarn workspace @qzz/api admin <command> <target>
// 正式環境：kubectl -n qzz exec deploy/qzz-api -- node dist/admin.js disable https://qzz.tw/abc1234
import { pool } from './db/index.js'
import { describeTarget, parseTarget, setDisabled } from './lib/takedown.js'

const USAGE = `usage: admin <show|disable|enable> <target>

target:
  https://qzz.tw/<code>            short link
  https://qzz.tw/p/<code>          paste (also /v1/pastes/<code>/raw)
  link <code> | paste <code>`

const [command, ...rest] = process.argv.slice(2)
const target = parseTarget(rest)

if (!command || !['show', 'disable', 'enable'].includes(command) || !target) {
  console.error(USAGE)
  process.exit(2)
}

try {
  if (command !== 'show') {
    const found = await setDisabled(target, command === 'disable')
    if (!found) {
      console.error(`${target.kind} ${target.code} not found`)
      process.exitCode = 1
    } else {
      console.log(`${target.kind} ${target.code} ${command === 'disable' ? 'disabled' : 'enabled'}`)
    }
  }

  const row = await describeTarget(target)
  if (row) {
    console.log(JSON.stringify({ kind: target.kind, ...row }, null, 2))
  } else if (command === 'show') {
    console.error(`${target.kind} ${target.code} not found`)
    process.exitCode = 1
  }
} finally {
  await pool.end()
}
