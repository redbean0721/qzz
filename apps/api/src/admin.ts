// 管理員工具：yarn workspace @qzz/api admin <command> …
// 正式環境：kubectl -n qzz exec deploy/qzz-api -- node dist/admin.js disable https://qzz.tw/abc1234
import { pool } from './db/index.js'
import {
  disableByIp,
  formatContentRow,
  formatTime,
  isGroupPrefix,
  listByIp,
  listRecent,
  parseDuration,
  parseIpFilter,
  topIps,
  type ContentRow,
  type Kind,
} from './lib/investigate.js'
import { listReports, reportsOf, resolveReports } from './lib/reports.js'
import { describeTarget, parseTarget, setDisabled, type Target } from './lib/takedown.js'

const USAGE = `usage:
  admin reports [--all]                 reported content, most reports first (--all includes resolved)
  admin show <target>                   details and reports
  admin disable <target>                take down and mark its reports resolved
  admin enable <target>                 restore
  admin resolve <target>                mark its reports resolved without taking it down

  admin recent [links|pastes] [--since 24h] [--limit 50]
                                        newest content with creator IPs
  admin ips [--since 24h] [--limit 20] [--v4 24] [--v6 48]
                                        ranges that created the most content (IPv4 per /24, IPv6 per /48;
                                        --v4 32 lists single addresses), with how many addresses each
  admin by-ip <ip|cidr> [links|pastes]  everything created from an IP or range
  admin disable-ip <ip|cidr> [--yes]    take all of it down and resolve its reports
                                        (without --yes: only list what would be taken down)

target:
  https://qzz.tw/<code>            short link
  https://qzz.tw/p/<code>          paste (also /v1/pastes/<code>/raw)
  link <code> | paste <code>

ip | cidr:  203.0.113.7, 2001:db8::1, 203.0.113.0/24 (≥ /16), 2001:db8:1:2::/64 (≥ /32)
duration:   30m, 24h, 7d`

const TARGET_COMMANDS = ['show', 'disable', 'enable', 'resolve']

const [command, ...rest] = process.argv.slice(2)

function usage(): never {
  console.error(USAGE)
  process.exit(2)
}

const time = formatTime

type Options = { kind?: Kind; sinceMs?: number; limit?: number; v4?: number; v6?: number; yes: boolean; positional: string[] }

// [links|pastes] --since <duration> --limit <n> --v4 <prefix> --v6 <prefix> --yes，加上其他位置參數；看不懂就印用法
function parseOptions(args: string[], allowed: Array<'kind' | '--since' | '--limit' | '--v4' | '--v6' | '--yes'>): Options {
  const options: Options = { yes: false, positional: [] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--since' && allowed.includes('--since')) {
      options.sinceMs = parseDuration(args[++i] ?? '') ?? usage()
    } else if (arg === '--limit' && allowed.includes('--limit')) {
      const limit = Number(args[++i])
      options.limit = Number.isInteger(limit) && limit >= 1 && limit <= 1000 ? limit : usage()
    } else if ((arg === '--v4' || arg === '--v6') && allowed.includes(arg)) {
      const family = arg === '--v4' ? 4 : 6
      const prefix = Number(args[++i])
      options[arg === '--v4' ? 'v4' : 'v6'] = isGroupPrefix(family, prefix) ? prefix : usage()
    } else if (arg === '--yes' && allowed.includes('--yes')) {
      options.yes = true
    } else if ((arg === 'links' || arg === 'pastes') && allowed.includes('kind') && !options.kind) {
      options.kind = arg === 'links' ? 'link' : 'paste'
    } else if (arg.startsWith('--')) {
      usage()
    } else {
      options.positional.push(arg)
    }
  }
  return options
}

function ipArgument(options: Options): string {
  if (options.positional.length !== 1) usage()
  const filter = parseIpFilter(options.positional[0]!)
  if (!filter) {
    console.error(`not an IP address or a small enough range: ${options.positional[0]}`)
    process.exit(2)
  }
  return filter
}

function printContent(rows: ContentRow[], empty: string) {
  if (rows.length === 0) console.log(empty)
  for (const row of rows) console.log(formatContentRow(row))
}

async function runInvestigation(args: string[]) {
  if (command === 'recent') {
    const options = parseOptions(args, ['kind', '--since', '--limit'])
    if (options.positional.length > 0) usage()
    printContent(await listRecent(options), 'nothing created')
  } else if (command === 'ips') {
    const options = parseOptions(args, ['--since', '--limit', '--v4', '--v6'])
    if (options.positional.length > 0) usage()
    const sinceMs = options.sinceMs ?? 86_400_000
    const rows = await topIps({ sinceMs, limit: options.limit, v4: options.v4, v6: options.v6 })
    if (rows.length === 0) console.log('nothing created')
    for (const row of rows) {
      const disabled = row.disabled > 0 ? `  ${row.disabled} disabled` : ''
      console.log(
        `${row.network.padEnd(24)}  ${String(row.addresses).padStart(4)} address(es)  ` +
          `${String(row.links).padStart(4)} link(s)  ${String(row.pastes).padStart(4)} paste(s)` +
          `${disabled}  ${time(row.firstAt)} … ${time(row.lastAt)}`,
      )
    }
  } else if (command === 'by-ip') {
    const options = parseOptions(args, ['kind'])
    const filter = ipArgument(options)
    printContent(await listByIp(filter, { kind: options.kind }), `nothing created from ${filter}`)
  } else if (command === 'disable-ip') {
    const options = parseOptions(args, ['--yes'])
    const filter = ipArgument(options)
    if (!options.yes) {
      // 先列出來，確認後再加 --yes
      const rows = (await listByIp(filter)).filter((row) => !row.disabled)
      printContent(rows, `nothing to take down from ${filter}`)
      if (rows.length > 0) {
        const count = (kind: Kind) => rows.filter((row) => row.kind === kind).length
        console.log(`\n${count('link')} link(s) and ${count('paste')} paste(s) would be disabled; run again with --yes`)
      }
      return
    }
    const result = await disableByIp(filter)
    console.log(`disabled ${result.links.length} link(s): ${result.links.join(' ') || '-'}`)
    console.log(`disabled ${result.pastes.length} paste(s): ${result.pastes.join(' ') || '-'}`)
    console.log(`${result.reportsResolved} report(s) resolved`)
  }
}

const INVESTIGATION_COMMANDS = ['recent', 'ips', 'by-ip', 'disable-ip']

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
  } else if (command && INVESTIGATION_COMMANDS.includes(command)) {
    await runInvestigation(rest)
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
