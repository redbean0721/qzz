// Google Safe Browsing v5 urls:search：建立短網址前檢查目標網址
// https://developers.google.com/safe-browsing/reference/rest/v5/urls/search
// v5 只回 protobuf（$alt=json 會得到 400 Unsupported Output Format），所以自己解析回應
const ENDPOINT = 'https://safebrowsing.googleapis.com/v5/urls:search'

export type UrlVerdict =
  | { status: 'safe' }
  | { status: 'unsafe'; threats: string[] }
  // 查不到結果（逾時、Google 回錯誤、回應解析失敗）：呼叫端決定要不要放行
  | { status: 'error'; error: string }

export type UrlChecker = (url: string) => Promise<UrlVerdict>

// ThreatType 的編號：https://developers.google.com/safe-browsing/reference/rest/v5/hashList#ThreatType
const THREAT_TYPES = [
  'THREAT_TYPE_UNSPECIFIED',
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
]

type Field = { field: number; value: number | Uint8Array }

// 最小的 protobuf 讀取器：只處理這個回應會用到的 varint 和 length-delimited，其他型別跳過
class Reader {
  private pos = 0
  constructor(private readonly buf: Uint8Array) {}

  get done() {
    return this.pos >= this.buf.length
  }

  varint(): number {
    let result = 0
    for (let shift = 0; shift < 64; shift += 7) {
      if (this.done) throw new Error('truncated varint')
      const byte = this.buf[this.pos++]!
      result += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) return result
    }
    throw new Error('varint too long')
  }

  bytes(length: number): Uint8Array {
    if (this.pos + length > this.buf.length) throw new Error('truncated field')
    const out = this.buf.subarray(this.pos, this.pos + length)
    this.pos += length
    return out
  }

  *fields(): Generator<Field> {
    while (!this.done) {
      const key = this.varint()
      const field = Math.floor(key / 8)
      switch (key & 7) {
        case 0:
          yield { field, value: this.varint() }
          break
        case 1:
          this.bytes(8)
          break
        case 2:
          yield { field, value: this.bytes(this.varint()) }
          break
        case 5:
          this.bytes(4)
          break
        default:
          throw new Error(`unsupported wire type ${key & 7}`)
      }
    }
  }
}

// SearchUrlsResponse { repeated ThreatUrl threats = 1; Duration cache_duration = 2; }
// ThreatUrl { string url = 1; repeated ThreatType threat_types = 2; }
export function decodeThreatTypes(body: Uint8Array): string[] {
  const threats = new Set<string>()

  for (const top of new Reader(body).fields()) {
    if (top.field !== 1 || typeof top.value === 'number') continue

    for (const { field, value } of new Reader(top.value).fields()) {
      if (field !== 2) continue
      // repeated enum 可能是 packed（一段連續的 varint）或一個一個的 varint
      const types: number[] = []
      if (typeof value === 'number') {
        types.push(value)
      } else {
        const packed = new Reader(value)
        while (!packed.done) types.push(packed.varint())
      }
      // UNSPECIFIED 依文件要忽略
      for (const type of types) {
        if (type !== 0) threats.add(THREAT_TYPES[type] ?? `THREAT_TYPE_${type}`)
      }
    }
  }

  return [...threats]
}

export function createSafeBrowsingChecker(
  apiKey: string,
  opts: { timeoutMs?: number; fetch?: typeof fetch } = {},
): UrlChecker {
  const { timeoutMs = 2000, fetch: doFetch = fetch } = opts

  return async (url) => {
    const params = new URLSearchParams({ key: apiKey, urls: url })
    try {
      const res = await doFetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) {
        return { status: 'error', error: `HTTP ${res.status}` }
      }
      const threats = decodeThreatTypes(new Uint8Array(await res.arrayBuffer()))
      return threats.length > 0 ? { status: 'unsafe', threats } : { status: 'safe' }
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err) }
    }
  }
}
