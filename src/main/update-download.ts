/**
 * Downloads the update file: with a time limit for the connection, a watchdog for a transfer that
 * goes quiet, a retry that carries on from what is on disk (HTTP Range), and a write error that
 * ends the download instead of hanging it. No Electron in here, so it can be tested with a plain
 * HTTP server. The SHA-256 is always taken over the whole file, resumed or not.
 */
import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, rmSync, statSync } from 'node:fs'
import { setTimeout as sleepFor } from 'node:timers/promises'

/** The limits. Tests make them small. */
export const limits = {
  /** The server must answer (headers) within this time. */
  headersMs: 30_000,
  /** Nothing received for this long: the person is told (see `onStall`). */
  stallNoticeMs: 30_000,
  /** Nothing received for this long: the attempt is ended and tried again. */
  stallMs: 60_000,
  /** Tries in all, the first one included. */
  attempts: 4,
  /** Pause before a retry (times the number of the try). */
  retryDelayMs: 2_000
}

export type DownloadFailure = 'http' | 'checksum' | 'stalled' | 'timeout' | 'network' | 'write' | 'cancelled'

export class DownloadError extends Error {
  constructor(
    readonly code: DownloadFailure,
    message: string,
    /** The HTTP status, for `http`. */
    readonly status?: number
  ) {
    super(message)
  }
}

export interface DownloadRequest {
  url: string
  /** The `.partial` file: kept when a try fails, so the next one carries on from it. */
  partial: string
  sha256: string
  /** Size from the release, used when the server doesn't say. */
  size: number
  /** `net.fetch` in the app. */
  fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal; cache: 'no-store' }) => Promise<Response>
  /** The person pressed Cancel. */
  cancel: AbortSignal
  onProgress: (got: number, total: number) => void
  /** A try failed and another follows; `reason` says why. */
  onRetry: (reason: DownloadFailure) => void
  /** The transfer went quiet for `limits.stallNoticeMs` (true), or data came again (false). */
  onStall: (stalled: boolean) => void
}

const retryable = (status: number): boolean => status >= 500 || status === 408 || status === 429

async function hashFile(file: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
}

/** One try. Resolves when the whole file is on disk and its checksum matches; throws a DownloadError. */
async function attempt(r: DownloadRequest): Promise<void> {
  let have = existsSync(r.partial) ? statSync(r.partial).size : 0
  let hash = createHash('sha256')
  if (have > 0) await hashFile(r.partial, hash)

  const ctl = new AbortController()
  let why: DownloadFailure | null = null
  const abort = (code: DownloadFailure): void => {
    why ??= code
    ctl.abort()
  }
  const onCancel = (): void => abort('cancelled')
  if (r.cancel.aborted) throw new DownloadError('cancelled', 'The download was cancelled.')
  r.cancel.addEventListener('abort', onCancel, { once: true })
  // Rejects when this try is aborted, whatever the body stream does with the abort.
  const aborted = new Promise<never>((_, reject) => ctl.signal.addEventListener('abort', () => reject(new DownloadError(why ?? 'network', 'The download was stopped.')), { once: true }))
  aborted.catch(() => undefined)

  let headersTimer: NodeJS.Timeout | undefined = setTimeout(() => abort('timeout'), limits.headersMs)
  let noticeTimer: NodeJS.Timeout | undefined
  let stallTimer: NodeJS.Timeout | undefined
  let stalled = false
  const watch = (): void => {
    clearTimeout(noticeTimer)
    clearTimeout(stallTimer)
    if (stalled) {
      stalled = false
      r.onStall(false)
    }
    noticeTimer = setTimeout(() => {
      stalled = true
      r.onStall(true)
    }, limits.stallNoticeMs)
    stallTimer = setTimeout(() => abort('stalled'), limits.stallMs)
  }
  let out: ReturnType<typeof createWriteStream> | null = null
  try {
    let res: Response
    try {
      res = await Promise.race([r.fetch(r.url, { headers: have > 0 ? { range: `bytes=${have}-` } : {}, signal: ctl.signal, cache: 'no-store' }), aborted])
    } catch (err) {
      if (err instanceof DownloadError) throw err
      throw new DownloadError(why ?? 'network', 'The connection failed.')
    }
    clearTimeout(headersTimer)
    headersTimer = undefined
    if (res.status === 416 && have > 0) {
      // The file on disk doesn't fit what the server has: start again from nothing.
      rmSync(r.partial, { force: true })
      throw new DownloadError('network', 'The partly downloaded file did not fit; starting again.')
    }
    if (!res.ok || !res.body) throw new DownloadError('http', `The download failed (${res.status}).`, res.status)
    if (res.status === 200 && have > 0) {
      // The server ignored the range and sends everything: start the file again.
      have = 0
      hash = createHash('sha256')
    }
    const length = Number(res.headers.get('content-length')) || 0
    const total = (res.status === 206 ? have + length : length) || r.size || 0
    out = createWriteStream(r.partial, { flags: have > 0 ? 'a' : 'w' })
    const errored = new Promise<never>((_, reject) => out!.on('error', (e) => reject(new DownloadError('write', `The update file could not be written: ${e.message}`))))
    errored.catch(() => undefined)

    let got = have
    const reader = res.body.getReader()
    watch()
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted, errored])
      if (done) break
      watch()
      hash.update(value)
      got += value.length
      if (!out.write(value)) await Promise.race([new Promise<void>((resolve) => out!.once('drain', () => resolve())), aborted, errored])
      r.onProgress(got, total)
    }
    await Promise.race([new Promise<void>((resolve, reject) => out!.end((e?: Error | null) => (e ? reject(new DownloadError('write', `The update file could not be written: ${e.message}`)) : resolve()))), errored])
    out = null
    if (length && got !== total) throw new DownloadError('network', 'The download ended early.')
    if (hash.digest('hex') !== r.sha256) {
      rmSync(r.partial, { force: true })
      // After a carried-on download the fault may be the old part: one more go from nothing is worth it.
      throw new DownloadError(have > 0 ? 'network' : 'checksum', 'The downloaded file doesn’t match its checksum, so it was deleted. Try again later.')
    }
  } catch (err) {
    out?.destroy()
    if (err instanceof DownloadError) throw err
    throw new DownloadError(why ?? 'network', err instanceof Error ? err.message : 'The download stopped.')
  } finally {
    clearTimeout(headersTimer)
    clearTimeout(noticeTimer)
    clearTimeout(stallTimer)
    if (stalled) r.onStall(false)
    r.cancel.removeEventListener('abort', onCancel)
    ctl.abort()
  }
}

/**
 * Downloads to `r.partial` until the file is complete and its checksum matches, with up to
 * `limits.attempts` tries (a carried-on download after a failed one). Throws the last DownloadError;
 * a cancel, a checksum that doesn't match and an HTTP answer that retrying won't change end it at once.
 */
export async function downloadFile(r: DownloadRequest): Promise<void> {
  let last: DownloadError | null = null
  for (let n = 1; n <= limits.attempts; n++) {
    try {
      await attempt(r)
      return
    } catch (err) {
      last = err instanceof DownloadError ? err : new DownloadError('network', 'The download stopped.')
      if (last.code === 'cancelled' || last.code === 'checksum' || last.code === 'write') throw last
      if (last.code === 'http' && !retryable(last.status ?? 0)) throw last
      if (n === limits.attempts) break
      r.onRetry(last.code)
      try {
        await sleepFor(limits.retryDelayMs * n, undefined, { signal: r.cancel })
      } catch {
        throw new DownloadError('cancelled', 'The download was cancelled.')
      }
    }
  }
  throw last ?? new DownloadError('network', 'The download stopped.')
}
