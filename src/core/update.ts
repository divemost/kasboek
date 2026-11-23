/** Pure helpers for updates: comparing versions and picking this computer's release file. */
import { posix, win32 } from 'node:path'
import type { UpdateKind, UpdateStatus } from '@shared/types'

/** "0.11.2" > "0.11.1"; a leading "v" and anything after "-" are ignored. */
export function newer(a: string, b: string): boolean {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** How this copy of Kasboek was installed, and so which release file it needs. */
export function installKind(platform = process.platform, env = process.env): UpdateKind | null {
  if (platform === 'win32') return 'msi'
  if (platform === 'darwin') return 'dmg'
  if (platform === 'linux') return env['APPIMAGE'] ? 'appimage' : 'deb'
  return null
}

/** The release file for this system and processor, by the names the build gives them. */
export function pickAsset<T extends { name: string }>(assets: T[], kind: UpdateKind, arch = process.arch): T | null {
  const a = arch === 'arm64' ? '(arm64|aarch64)' : '(x64|x86_64|amd64)'
  const pattern = { msi: `-win-${a}\\.msi$`, dmg: `-mac-${a}\\.dmg$`, appimage: `-${a}\\.AppImage$`, deb: `[-_]${a}\\.deb$` }[kind]
  return assets.find((x) => new RegExp(pattern, 'i').test(x.name)) ?? null
}

/** Release file names are written to disk and into the update plan for the Windows helper: letters, digits, dot, dash and underscore only. */
export const SAFE_ASSET_NAME = /^[A-Za-z0-9._-]+$/

export function safeAssetName(name: string): boolean {
  return SAFE_ASSET_NAME.test(name) && name !== '.' && name !== '..'
}

/** The SHA-256 for `name` from a SHA256SUMS file: lines of `<hash>  <name>` or `<hash> *<name>`, the name compared whole. */
export function checksumFromSums(text: string, name: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim())
    if (m && m[2] === name) return m[1]!.toLowerCase()
  }
  return null
}

/** What the Windows update helper (kasboek-mcp --apply-update) reads from `apply.json`. */
export interface UpdatePlan {
  v: 1
  pid: number
  exe: string
  args: string[]
  msi: string
  sha256: string
  log: string
  result: string
  toVersion: string
  theme: 'light' | 'dark'
  texts: { waiting: string; installing: string; starting: string; failed: string; cancelled: string; notClosed: string; disconnecting: string; stillWorking: string; noProgress: string; slow: string }
}

export interface UpdatePlanInput extends Omit<UpdatePlan, 'v'> {
  /** The folder that holds the downloaded file, the log and the result. */
  updatesDir: string
  /** Decides how paths are compared (case, separators); defaults to this system. */
  platform?: NodeJS.Platform
}

/** `file` is inside `dir` (not `dir` itself), after resolving `..`; case-insensitive on Windows. */
function insideFolder(dir: string, file: string, platform: NodeJS.Platform): boolean {
  const p = platform === 'win32' ? win32 : posix
  if (!p.isAbsolute(dir) || !p.isAbsolute(file)) return false
  const rel = p.relative(p.resolve(dir), p.resolve(file))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel)
}

/** The plan for the update helper; refuses anything that could make it install or write outside the updates folder. */
export function buildUpdatePlan(o: UpdatePlanInput): UpdatePlan {
  const platform = o.platform ?? process.platform
  const p = platform === 'win32' ? win32 : posix
  if (!safeAssetName(p.basename(o.msi))) throw new Error('The update file has an unsafe name.')
  if (!/^[0-9a-fA-F]{64}$/.test(o.sha256)) throw new Error('The update checksum is not a SHA-256.')
  for (const f of [o.msi, o.log, o.result]) if (!insideFolder(o.updatesDir, f, platform)) throw new Error('An update path is outside the updates folder.')
  // The helper checks the same again; here a bad plan is caught before Kasboek closes. The installed Kasboek has no start arguments, and a development run (electron.exe) can't be updated.
  if (win32.basename(o.exe).toLowerCase() !== 'kasboek.exe') throw new Error('Updating works only in the installed Kasboek, not in a development run. Kasboek was left open.')
  if (o.args.length > 0) throw new Error('The update plan has start arguments, which the installed Kasboek does not use. Kasboek was left open.')
  return { v: 1, pid: o.pid, exe: o.exe, args: o.args, msi: o.msi, sha256: o.sha256.toLowerCase(), log: o.log, result: o.result, toVersion: o.toVersion, theme: o.theme, texts: o.texts }
}

/** What Windows Installer's exit code means for the update. The last three are decided by the helper itself. */
export type MsiOutcome = 'ok' | 'reboot' | 'cancelled' | 'busy' | 'blocked' | 'failed' | 'not_closed' | 'checksum'

export function msiOutcome(code: number): MsiOutcome {
  if (code === 0) return 'ok'
  if (code === 3010 || code === 1641) return 'reboot'
  if (code === 1602) return 'cancelled'
  if (code === 1618) return 'busy'
  if (code === 1625 || code === 1643) return 'blocked'
  return 'failed'
}

/** The message for an update that didn't go in (shown after Kasboek opens again). */
export function msiOutcomeMessage(o: MsiOutcome, version: string): string {
  const retry = 'Try again, or install it from the release page.'
  switch (o) {
    case 'cancelled':
      return `The update to ${version} was cancelled. ${retry}`
    case 'busy':
      return `Another installation was running, so the update to ${version} didn’t install. Try again when it has finished.`
    case 'blocked':
      return `Windows doesn’t allow this computer to install the update to ${version} (a policy blocks it). Ask whoever manages this computer.`
    case 'not_closed':
      return `Kasboek didn’t close in time, so the update to ${version} was not installed and Kasboek was opened again. ${retry}`
    case 'checksum':
      return `The update file for ${version} didn’t match its checksum, so it was not installed. ${retry}`
    case 'reboot':
      return `The update to ${version} needs Windows to restart before it is complete.`
    default:
      return `The update to ${version} didn’t install. ${retry}`
  }
}

const OUTCOMES: readonly string[] = ['ok', 'reboot', 'cancelled', 'busy', 'blocked', 'failed', 'not_closed', 'checksum']

/** After a restart: null when the pending update went in (the version is the truth), else why it didn't. `result` is the helper's result.json, if any. */
export function failedUpdateMessage(pendingVersion: string, current: string, result: unknown): string | null {
  if (!newer(pendingVersion, current)) return null
  const outcome = (result as { outcome?: unknown } | null)?.outcome
  return msiOutcomeMessage(typeof outcome === 'string' && OUTCOMES.includes(outcome) ? (outcome as MsiOutcome) : 'failed', pendingVersion)
}

/**
 * How long a note about an update that is being installed counts as recent: Windows Installer may
 * still be busy. Longer than the helper's own limit for the installation (12 minutes), and the same
 * as `updateGrace` in tools/kasboek-mcp/launch.go, which keeps Claude's bridge from starting Kasboek meanwhile.
 */
export const PENDING_GRACE_MS = 20 * 60 * 1000

/**
 * After a restart: is the update that the note (`pending.json`) talks about probably still being
 * installed? Yes when it isn't the running version yet, the helper has written no result, and the
 * note is younger than five minutes (e.g. Kasboek was started by hand after the old process ended
 * but before the installer finished). Then nothing should be reported or cleaned up: the next start decides.
 */
export function updateMayStillBeRunning(pendingVersion: string, current: string, result: unknown, pendingAt: unknown, now = Date.now()): boolean {
  if (!newer(pendingVersion, current) || (result !== null && result !== undefined)) return false
  const at = typeof pendingAt === 'string' ? Date.parse(pendingAt) : Number.NaN
  const age = now - at
  return Number.isFinite(age) && age >= 0 && age < PENDING_GRACE_MS
}

/**
 * AppImage update: a small shell command that waits until this process has ended and only then starts
 * the new AppImage, so the new instance doesn't find the old one still holding the single-instance
 * lock. The process id and the path are arguments (`$1`, `$2`), never part of the script. It gives up
 * waiting after about a minute (300 x 0.2 s) and starts anyway.
 */
export function relaunchAfterExit(pid: number, appImage: string): { command: string; args: string[] } {
  const script = 'i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 300 ]; do i=$((i+1)); sleep 0.2; done; exec "$2"'
  return { command: '/bin/sh', args: ['-c', script, 'kasboek-relaunch', String(Math.trunc(pid)), appImage] }
}

/** The update helper writes `started` once its plan is checked; Kasboek only quits after seeing it. */
export const HELPER_START_LIMIT_MS = 8000
export const HELPER_START_POLL_MS = 100

export interface HelperProbe {
  /** The `started` file exists. */
  started(): boolean
  /** The helper process has ended (or could not be started). */
  exited(): boolean
  sleep(ms: number): Promise<void>
  now(): number
}

/** Waits for the helper's `started` file: 'started', or why not ('exited' first, or 'timeout'). `started` wins when both are true. */
export async function waitForHelperStart(probe: HelperProbe, limitMs = HELPER_START_LIMIT_MS, pollMs = HELPER_START_POLL_MS): Promise<'started' | 'exited' | 'timeout'> {
  const begin = probe.now()
  for (;;) {
    if (probe.started()) return 'started'
    if (probe.exited()) return 'exited'
    if (probe.now() - begin >= limitMs) return 'timeout'
    await probe.sleep(pollMs)
  }
}

/**
 * One run at a time: while `run` is going, another call gets `whenBusy()` instead of starting a
 * second one. The lock is let go when the run ends, except when `stayLocked(result)` (Kasboek is
 * about to quit, so nothing else may start).
 */
export function oneAtATime<T>(run: () => Promise<T>, stayLocked: (result: T) => boolean, whenBusy: () => T): () => Promise<T> {
  let running = false
  return async () => {
    if (running) return whenBusy()
    running = true
    let keep = false
    try {
      const result = await run()
      keep = stayLocked(result)
      return result
    } finally {
      if (!keep) running = false
    }
  }
}

/**
 * The status changes while "Install and restart" works: `preparing` at once (backup, starting the
 * helper), `installing` when Kasboek is about to close, and back to `ready` with the reason if
 * anything fails, so the button works again.
 */
export function installStep(step: 'prepare' | 'close' | 'fail' | 'opened', message?: string): Partial<UpdateStatus> {
  switch (step) {
    case 'prepare':
      return { state: 'preparing', error: null }
    case 'close':
      return { state: 'installing' }
    case 'opened':
      return { state: 'opened' }
    case 'fail':
      return { state: 'ready', error: message ?? null }
  }
}
