// 管理員工具：yarn workspace @qzz/api admin <command> …
// 正式環境：kubectl -n qzz exec deploy/qzz-api -- node dist/admin.js disable https://qzz.tw/abc1234
import { pool } from './db/index.js'
import { listReports, reportsOf, resolveReports } from './lib/reports.js'
import { describeTarget, parseTarget, setDisabled, type Target } from './lib/takedown.js'

const USAGE = `usage:
  admin reports [--all]                 reported content, most reports first (--all includes resolved)
  admin show <target>                   details and reports
  admin disable <target>                take down and mark its reports resolved
  admin enable <target>                 restore
  admin resolve <target>                mark its reports resolved without taking it down

target:
  https://qzz.tw/<code>            short link
  https://qzz.tw/p/<code>          paste (also /v1/pastes/<code>/raw)
  link <code> | paste <code>`

const TARGET_COMMANDS = ['show', 'disable', 'enable', 'resolve']

const [command, ...rest] = process.argv.slice(2)

function usage(): never {
  console.error(USAGE)
  process.exit(2)
}

const time = (date: Date | null) => date?.toISOString().replace(/\.\d+Z$/, 'Z') ?? '-'

async function printReports(all: boolean) {
  const groups = await listReports({ all })
  if (groups.length === 0) {
    console.log(all ? 'no reports' : 'no open reports')
    return
  }
  for (const group of groups) {
    const status = group.disabled ? ' [disabled]' : ''
    console.log(
      `${group.kind} ${group.code}${status}  ${group.reports} report(s), ${group.open} open  ` +
        `[${group.reasons.join(', ')}]  ${time(group.firstAt)} … ${time(group.lastAt)}`,
    )
    console.log(`  ${JSON.stringify(group.target)}`)
  }
}

async function runTargetCommand(target: Target) {
  if (command === 'disable' || command === 'enable') {
    const found = await setDisabled(target, command === 'disable')
    if (!found) {
      console.error(`${target.kind} ${target.code} not found`)
      process.exitCode = 1
      return
    }
    console.log(`${target.kind} ${target.code} ${command === 'disable' ? 'disabled' : 'enabled'}`)
  }
  // 下架就代表檢舉處理完了
  if (command === 'disable' || command === 'resolve') {
    console.log(`${await resolveReports(target)} report(s) resolved`)
  }

  const row = await describeTarget(target)
  if (!row) {
    console.error(`${target.kind} ${target.code} not found`)
    process.exitCode = 1
    return
  }
  const reports = await reportsOf(target)
  console.log(JSON.stringify({ kind: target.kind, ...row, reports }, null, 2))
}

try {
  if (command === 'reports') {
    if (rest.length > 1 || (rest.length === 1 && rest[0] !== '--all')) usage()
    await printReports(rest[0] === '--all')
  } else if (command && TARGET_COMMANDS.includes(command)) {
    const target = parseTarget(rest)
    if (!target) usage()
    await runTargetCommand(target)
  } else {
    usage()
  }
} finally {
  await pool.end()
}
