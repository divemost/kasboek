import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DownloadError, downloadFile, limits, type DownloadRequest } from '../src/main/update-download'

// A small file; the "server" can stop in the middle of it. All data here is invented.
const BODY = Buffer.from('kasboek-update-'.repeat(4000))
const SHA = createHash('sha256').update(BODY).digest('hex')
const HALF = Math.floor(BODY.length / 2)

type Mode = 'ok' | 'stall-then-ok' | 'stall-always' | 'silent' | 'range-ignored' | 'bad-bytes' | 'not-found'
let mode: Mode = 'ok'
let requests: { range: string | undefined }[] = []
let server: Server
let base = ''
const sockets = new Set<Socket>()

function serve(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? ''
  if (url === '/latest') {
    const names = ['Kasboek-9.9.9-win-x64.msi', 'Kasboek-9.9.9-win-arm64.msi', 'Kasboek-9.9.9-mac-arm64.dmg', 'Kasboek-9.9.9-mac-x64.dmg', 'Kasboek-9.9.9-x86_64.AppImage', 'Kasboek-9.9.9-arm64.AppImage', 'Kasboek-9.9.9-amd64.deb', 'Kasboek-9.9.9-arm64.deb']
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ tag_name: 'v9.9.9', body: '## What’s new\nTest', html_url: 'https://github.com/divemost/kasboek/releases/tag/v9.9.9', assets: names.map((name) => ({ name, size: BODY.length, browser_download_url: `${base}/dl/${name}`, digest: `sha256:${SHA}` })) }))
    return
  }
  const range = req.headers.range
  requests.push({ range })
  if (mode === 'not-found') {
    res.statusCode = 404
    res.end()
    return
  }
  if (mode === 'silent') return // never answers
  const stall = mode === 'stall-always' || (mode === 'stall-then-ok' && requests.length === 1)
  const start = range ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0
  if (range && mode !== 'range-ignored') {
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${start}-${BODY.length - 1}/${BODY.length}`)
    res.setHeader('content-length', BODY.length - start)
    res.end(BODY.subarray(start))
    return
  }
  res.setHeader('content-length', BODY.length)
  if (stall) {
    res.write(BODY.subarray(0, HALF)) // and then nothing, with the connection kept open
    return
  }
  res.end(mode === 'bad-bytes' ? Buffer.alloc(BODY.length, 1) : BODY)
}

beforeAll(async () => {
  server = createServer(serve)
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  for (const s of sockets) s.destroy()
  await new Promise((r) => server.close(r))
})

const saved = { ...limits }
beforeEach(() => {
  mode = 'ok'
  requests = []
  // Small limits, so a stalled server is noticed in a fraction of a second and the tests stay quick.
  Object.assign(limits, { headersMs: 400, stallNoticeMs: 100, stallMs: 300, attempts: 1, retryDelayMs: 10 })
})
afterEach(() => Object.assign(limits, saved))

const dir = (): string => mkdtempSync(join(tmpdir(), 'kasboek-dl-'))
const request = (partial: string, over: Partial<DownloadRequest> = {}): DownloadRequest => ({
  url: `${base}/dl/file`,
  partial,
  sha256: SHA,
  size: BODY.length,
  fetch: (url, init) => fetch(url, init),
  cancel: new AbortController().signal,
  onProgress: () => undefined,
  onRetry: () => undefined,
  onStall: () => undefined,
  ...over
})
const failure = async (p: Promise<unknown>): Promise<DownloadError> => {
  try {
    await p
  } catch (e) {
    return e as DownloadError
  }
  throw new Error('expected the download to fail')
}

describe('download engine', () => {
  it('downloads and checks the whole file', async () => {
    const partial = join(dir(), 'a.partial')
    const progress: number[] = []
    await downloadFile(request(partial, { onProgress: (got) => progress.push(got) }))
    expect(readFileSync(partial).equals(BODY)).toBe(true)
    expect(progress.at(-1)).toBe(BODY.length)
  })

  it('ends a transfer that stops in the middle, within the watchdog time, and says it went quiet first', async () => {
    mode = 'stall-always'
    const stalls: boolean[] = []
    const t0 = Date.now()
    const err = await failure(downloadFile(request(join(dir(), 'a.partial'), { onStall: (s) => stalls.push(s) })))
    expect(err.code).toBe('stalled')
    expect(Date.now() - t0).toBeLessThan(limits.stallMs + 5000) // generous: the point is that it ends
    expect(stalls[0]).toBe(true)
  })

  it('tries again and carries on from the part it has (HTTP Range), then checks the whole file', async () => {
    mode = 'stall-then-ok'
    limits.attempts = 3
    const partial = join(dir(), 'a.partial')
    const retries: string[] = []
    await downloadFile(request(partial, { onRetry: (r) => retries.push(r) }))
    expect(retries).toEqual(['stalled'])
    expect(requests[1]?.range).toMatch(/^bytes=\d+-$/)
    expect(Number(/bytes=(\d+)-/.exec(requests[1]!.range!)?.[1])).toBeGreaterThan(0)
    expect(readFileSync(partial).equals(BODY)).toBe(true)
  })

  it('starts the file again when the server ignores the range', async () => {
    mode = 'range-ignored'
    const partial = join(dir(), 'a.partial')
    writeFileSync(partial, BODY.subarray(0, 1000))
    await downloadFile(request(partial))
    expect(readFileSync(partial).equals(BODY)).toBe(true)
  })

  it('gives up on a server that never answers (connect timeout)', async () => {
    mode = 'silent'
    const err = await failure(downloadFile(request(join(dir(), 'a.partial'))))
    expect(err.code).toBe('timeout')
  })

  it('removes a file with the wrong checksum and does not retry it', async () => {
    mode = 'bad-bytes'
    limits.attempts = 3
    const partial = join(dir(), 'a.partial')
    const err = await failure(downloadFile(request(partial)))
    expect(err.code).toBe('checksum')
    expect(existsSync(partial)).toBe(false)
    expect(requests).toHaveLength(1)
  })

  it('does not retry an answer that retrying will not change', async () => {
    mode = 'not-found'
    limits.attempts = 3
    const err = await failure(downloadFile(request(join(dir(), 'a.partial'))))
    expect(err.code).toBe('http')
    expect(requests).toHaveLength(1)
  })

  it('rejects when the file cannot be written, instead of hanging', async () => {
    const err = await failure(downloadFile(request(join(dir(), 'missing-folder', 'a.partial'))))
    expect(err.code).toBe('write')
  })

  it('stops at once on cancel', async () => {
    mode = 'stall-always'
    limits.stallMs = 10_000
    limits.stallNoticeMs = 10_000
    const cancel = new AbortController()
    const p = failure(downloadFile(request(join(dir(), 'a.partial'), { cancel: cancel.signal, onProgress: () => cancel.abort() })))
    expect((await p).code).toBe('cancelled')
  })
})

// The same through the app's update code, against a stand-in for GitHub (KASBOEK_UPDATE_API).
const env = vi.hoisted(() => ({ data: '' }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '0.0.1', quit: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) },
  shell: { openPath: vi.fn(), openExternal: vi.fn() }
}))
vi.mock('../src/main/paths', () => ({ paths: { get dataDir() { return env.data }, get safetyDir() { return join(env.data, 'safety') } } }))
vi.mock('../src/main/prefs', () => ({ getPrefs: () => ({ theme: 'light', language: 'en', welcomeDone: true, updateCheck: true }) }))
vi.mock('../src/main/session', () => ({ broadcast: vi.fn(), isUnlocked: () => false }))
vi.mock('../src/main/transfer/service', () => ({ stamp: () => 'x', writeTransfer: vi.fn() }))
vi.mock('../src/main/mcp/channel', () => ({ helperPath: () => '' }))

describe('update download through the app', () => {
  beforeEach(() => {
    env.data = mkdtempSync(join(tmpdir(), 'kasboek-data-'))
    process.env['KASBOEK_UPDATE_API'] = `${base}/latest`
    vi.resetModules()
  })
  afterEach(() => {
    delete process.env['KASBOEK_UPDATE_API']
    rmSync(env.data, { recursive: true, force: true })
  })

  // vi.resetModules gives the app code its own copy of the limits: the small ones go there.
  const freshUpdate = async (extra: Partial<typeof limits> = {}): Promise<typeof import('../src/main/update')> => {
    const download = await import('../src/main/update-download')
    Object.assign(download.limits, { headersMs: 400, stallNoticeMs: 100, stallMs: 300, attempts: 1, retryDelayMs: 10 }, extra)
    return import('../src/main/update')
  }

  it('reaches the error state when the transfer stops, and "try again" carries on', async () => {
    const update = await freshUpdate()
    expect((await update.checkForUpdate()).state).toBe('available')
    mode = 'stall-then-ok'
    const failed = await update.downloadUpdate()
    expect(failed.state).toBe('error')
    expect(failed.error).toMatch(/no data came in/)
    expect(failed.downloadNote).toBeNull()
    // The part stays on disk and the next try asks for the rest.
    expect(readdirSync(join(env.data, 'updates')).some((f) => f.endsWith('.partial'))).toBe(true)
    const ready = await update.downloadUpdate()
    expect(ready.state).toBe('ready')
    expect(requests.at(-1)?.range).toMatch(/^bytes=\d+-$/)
    const files = readdirSync(join(env.data, 'updates'))
    expect(files.some((f) => f.endsWith('.partial'))).toBe(false)
    expect(readFileSync(join(env.data, 'updates', files[0]!)).equals(BODY)).toBe(true)
  })

  it('goes back to "available" when the person cancels, and removes the part', async () => {
    const update = await freshUpdate({ stallMs: 10_000, stallNoticeMs: 20 })
    await update.checkForUpdate()
    mode = 'stall-always'
    const running = update.downloadUpdate()
    // Cancel once the note about silence shows (the transfer is then certainly under way).
    for (let i = 0; i < 400 && update.updateStatus().downloadNote !== 'stalled'; i++) await new Promise((r) => setTimeout(r, 25))
    expect(update.updateStatus().downloadNote).toBe('stalled')
    update.cancelDownload()
    const done = await running
    expect(done.state).toBe('available')
    expect(readdirSync(join(env.data, 'updates')).filter((f) => f.endsWith('.partial'))).toEqual([])
  })

  it('keeps the logs of the last update, cut to a limit', async () => {
    const update = await freshUpdate()
    const from = mkdtempSync(join(tmpdir(), 'kasboek-from-'))
    const to = join(mkdtempSync(join(tmpdir(), 'kasboek-to-')), 'updates-last')
    writeFileSync(join(from, 'install.log'), Buffer.alloc(update.KEPT_LOG_BYTES + 1000, 65))
    writeFileSync(join(from, 'helper.log'), 'small')
    writeFileSync(join(from, 'MSI1234.msi'), 'not a log')
    update.keepLogs(from, to)
    expect(readdirSync(to).sort()).toEqual(['helper.log', 'install.log'])
    expect(readFileSync(join(to, 'install.log')).length).toBe(update.KEPT_LOG_BYTES)
    // The next update replaces them.
    rmSync(join(from, 'install.log'))
    update.keepLogs(from, to)
    expect(readdirSync(to)).toEqual(['helper.log'])
  })
})
