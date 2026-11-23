/**
 * Updates from the project's GitHub releases. Kasboek asks GitHub for the latest release (at start
 * and once a day, when the person allows it), downloads the file for this computer, checks it
 * against the SHA-256 that GitHub reports for it, makes a backup and installs it:
 * - Windows: a helper installs the MSI after Kasboek closes (it shows its own progress window), then Kasboek opens again;
 * - Linux AppImage: the file is replaced and started again;
 * - Linux .deb and macOS .dmg: the file is opened, and the person finishes the install.
 * Only release files of this repository are downloaded; nothing about the person's data is sent.
 */
import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app, nativeTheme, net, shell } from 'electron'
import { AppError } from '@core/errors'
import type { UpdateStatus } from '@shared/types'
import { buildUpdatePlan, checksumFromSums, failedUpdateMessage, installKind, installStep, newer, oneAtATime, pickAsset, relaunchAfterExit, safeAssetName, updateMayStillBeRunning, waitForHelperStart, type UpdatePlan } from '@core/update'
import { helperPath } from './mcp/channel'
import { paths } from './paths'
import { getPrefs } from './prefs'
import { broadcast, isUnlocked } from './session'
import { stamp, writeTransfer } from './transfer/service'
import { DownloadError, downloadFile, limits } from './update-download'
import { updateTexts } from './update-texts'
import { TRANSFER_EXTENSION } from '@core/transfer-format'

const REPO = 'divemost/kasboek'
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES = `https://github.com/${REPO}/releases/latest`
const DAY = 24 * 60 * 60 * 1000

/** Development runs only: a stand-in for the GitHub API (tests). Packaged builds always use GitHub. */
const override = (): string | null => (app.isPackaged ? null : process.env['KASBOEK_UPDATE_API'] || null)
const supported = (): boolean => app.isPackaged || !!override()
const updatesDir = (): string => join(paths.dataDir, 'updates')
/** The logs of the last update, kept after it went in (see keepLogs). */
const lastUpdateDir = (): string => join(paths.dataDir, 'updates-last')
const pendingFile = (): string => join(updatesDir(), 'pending.json')

interface Asset {
  name: string
  url: string
  size: number
  sha256: string | null
}

let status: UpdateStatus = { state: 'idle', current: app.getVersion(), latest: null, notes: null, pageUrl: null, kind: null, sizeBytes: null, progress: 0, downloadNote: null, error: null, lastCheckedAt: null, supported: supported() }
let asset: Asset | null = null
let file: string | null = null
let busy = false
/** Cancels the running download (the Cancel button). */
let downloadCancel: AbortController | null = null
/** Kept after a restart where the update didn't install, until it installs. */
let failedInstall: string | null = null
let lastSent = 0

function set(patch: Partial<UpdateStatus>, now = true): UpdateStatus {
  status = { ...status, ...patch }
  // Progress is sent at most a few times a second.
  if (now || Date.now() - lastSent > 250) {
    lastSent = Date.now()
    broadcast({ type: 'update.changed', status })
  }
  return status
}

export function updateStatus(): UpdateStatus {
  return status
}

const allowedDownload = (url: string): boolean => {
  const o = override()
  return o ? url.startsWith(new URL(o).origin + '/') : url.startsWith(`https://github.com/${REPO}/releases/download/`)
}

async function getJson(url: string): Promise<unknown> {
  const res = await net.fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Kasboek' }, cache: 'no-store', signal: AbortSignal.timeout(limits.headersMs) })
  if (res.status === 404) return null
  if (!res.ok) throw new AppError('update.http', `GitHub answered ${res.status}.`)
  return res.json()
}

/** The checksum from GitHub's own record of the file, else from a SHA256SUMS.txt in the release. */
async function checksum(assets: { name: string; browser_download_url: string; digest?: string | null }[], name: string): Promise<string | null> {
  const own = assets.find((x) => x.name === name)?.digest
  if (own?.startsWith('sha256:')) return own.slice(7).toLowerCase()
  const sums = assets.find((x) => /^SHA256SUMS(\.txt)?$/i.test(x.name))
  if (!sums || !allowedDownload(sums.browser_download_url)) return null
  const res = await net.fetch(sums.browser_download_url, { signal: AbortSignal.timeout(limits.headersMs) })
  if (!res.ok) return null
  return checksumFromSums(await res.text(), name)
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!supported()) return set({ state: 'idle', supported: false })
  if (busy || status.state === 'downloading' || status.state === 'preparing' || status.state === 'installing') return status
  busy = true
  set({ state: 'checking', error: failedInstall })
  try {
    const r = (await getJson(override() ?? LATEST)) as {
      tag_name?: string
      body?: string
      html_url?: string
      draft?: boolean
      prerelease?: boolean
      assets?: { name: string; browser_download_url: string; size: number; digest?: string | null }[]
    } | null
    const lastCheckedAt = new Date().toISOString()
    if (!r || !r.tag_name || r.draft || r.prerelease || !newer(r.tag_name, app.getVersion())) {
      asset = null
      return set({ state: 'none', error: null, latest: r?.tag_name?.replace(/^v/, '') ?? null, lastCheckedAt })
    }
    const kind = installKind()
    const found = kind ? pickAsset(r.assets ?? [], kind) : null
    // A file name ends up on disk and in the Windows update plan: refuse anything but plain names.
    asset = found && safeAssetName(found.name) && allowedDownload(found.browser_download_url) ? { name: found.name, url: found.browser_download_url, size: found.size, sha256: await checksum(r.assets ?? [], found.name) } : null
    // Downloaded before (e.g. "Later" after the download): ready again.
    const have = asset && existsSync(join(updatesDir(), asset.name)) && status.state === 'ready' && file
    return set({ state: have ? 'ready' : 'available', error: failedInstall, latest: r.tag_name.replace(/^v/, ''), notes: r.body ?? null, pageUrl: r.html_url ?? null, kind: asset ? kind : null, sizeBytes: asset?.size ?? null, progress: have ? 1 : 0, lastCheckedAt })
  } catch (err) {
    return set({ state: 'error', error: err instanceof AppError ? err.message : 'Could not reach GitHub to look for updates.', lastCheckedAt: new Date().toISOString() })
  } finally {
    busy = false
  }
}

/** What the person is told when a download ends in `err`. */
function downloadMessage(err: unknown): string {
  if (!(err instanceof DownloadError)) return 'The download stopped. Check the connection and try again.'
  if (err.code === 'stalled' || err.code === 'timeout') return 'The download stopped because no data came in. Check the connection and try again.'
  if (err.code === 'network') return 'The download stopped. Check the connection and try again.'
  return err.message
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!asset) throw new AppError('update.none', 'There is no update file for this computer in the latest release.')
  if (!asset.sha256) throw new AppError('update.no_checksum', 'The release has no checksum for this file, so Kasboek won’t install it. Download it from the release page instead.')
  if (status.state === 'downloading') return status
  const target = asset
  const sha256 = asset.sha256
  mkdirSync(updatesDir(), { recursive: true })
  const dest = join(updatesDir(), basename(target.name))
  const partial = dest + '.partial'
  const cancel = new AbortController()
  downloadCancel = cancel
  // Carries on from a part that is already on disk (an earlier try that stopped).
  const have = existsSync(partial) ? statSync(partial).size : 0
  set({ state: 'downloading', progress: target.size && have ? Math.min(1, have / target.size) : 0, downloadNote: null, error: null })
  try {
    await downloadFile({
      url: target.url,
      partial,
      sha256,
      size: target.size,
      fetch: (url, init) => net.fetch(url, init),
      cancel: cancel.signal,
      onProgress: (got, total) => set({ progress: total ? Math.min(1, got / total) : 0, downloadNote: null }, false),
      onRetry: () => set({ downloadNote: 'retrying' }),
      onStall: (stalled) => set({ downloadNote: stalled ? 'stalled' : null })
    })
    renameSync(partial, dest)
    file = dest
    return set({ state: 'ready', progress: 1, downloadNote: null })
  } catch (err) {
    if (err instanceof DownloadError && err.code === 'cancelled') {
      rmSync(partial, { force: true })
      return set({ state: 'available', progress: 0, downloadNote: null, error: null })
    }
    // A part that is on disk stays, so "Try again" carries on from it (a checksum that didn't match removes it).
    return set({ state: 'error', downloadNote: null, error: downloadMessage(err) })
  } finally {
    downloadCancel = null
  }
}

/** The Cancel button: stops the download and removes what was downloaded. */
export function cancelDownload(): UpdateStatus {
  downloadCancel?.abort()
  return status
}

/**
 * Windows: starts a copy of the kasboek-mcp helper that waits for Kasboek to close, installs the MSI
 * and opens Kasboek again, showing a progress window in the meantime. It runs from a copy because the MSI replaces the original in resources.
 * No console is wanted, and `detached` on Windows gives the helper none (so windowsHide isn't set).
 *
 * Kasboek may only quit when the helper is really running: the helper writes `started` once it has
 * checked its plan, and this resolves only then. If the helper ends first, or `started` doesn't show
 * up, this throws and Kasboek stays open (details in helper.log).
 */
async function startUpdateHelper(msi: string, sha256: string): Promise<void> {
  const source = helperPath()
  if (!existsSync(source)) throw new AppError('update.helper_missing', `The update helper is missing from this installation. Download the new version from ${RELEASES} and install it yourself.`)
  const copy = join(updatesDir(), 'kasboek-update.exe')
  const planFile = join(updatesDir(), 'apply.json')
  const startedFile = join(updatesDir(), 'started')
  const dark = getPrefs().theme === 'dark' || (getPrefs().theme === 'system' && nativeTheme.shouldUseDarkColors)
  let plan: UpdatePlan
  try {
    plan = buildUpdatePlan({
      pid: process.pid,
      exe: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
      msi,
      sha256,
      log: join(updatesDir(), 'install.log'),
      result: join(updatesDir(), 'result.json'),
      updatesDir: updatesDir(),
      toVersion: status.latest ?? '',
      theme: dark ? 'dark' : 'light',
      texts: updateTexts(getPrefs().language)
    })
  } catch (err) {
    throw new AppError('update.plan', err instanceof Error ? err.message : 'The update plan is not valid.')
  }
  if (!existsSync(plan.exe)) throw new AppError('update.plan', 'Kasboek’s program file was not found, so the update was not started. Kasboek was left open.')
  // Nothing from an earlier attempt may count for this one.
  for (const f of [startedFile, startedFile + '.tmp', plan.result]) rmSync(f, { force: true })
  copyFileSync(source, copy)
  writeFileSync(planFile, JSON.stringify(plan))
  const child = spawn(copy, ['--apply-update', planFile], { detached: true, stdio: 'ignore' })
  let gone = false
  child.once('error', () => (gone = true))
  child.once('exit', () => (gone = true))
  const outcome = await waitForHelperStart({ started: () => existsSync(startedFile), exited: () => gone, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now })
  if (outcome !== 'started') {
    if (outcome === 'timeout') child.kill()
    throw new AppError('update.helper_failed', `The update could not be started, so Kasboek stays open and nothing was changed. Details are in ${join(updatesDir(), 'helper.log')}.`)
  }
  child.unref()
}

/**
 * Replaces the running AppImage with the new one. The new one is started by a small shell command
 * once this process has ended (see relaunchAfterExit), not now: two copies running at once would
 * leave the new one without the single-instance lock, and it would quit at once.
 */
function installAppImage(downloaded: string): void {
  const current = process.env['APPIMAGE']!
  const next = join(dirname(current), `.${basename(current)}.new`)
  try {
    copyFileSync(downloaded, next)
    chmodSync(next, 0o755)
    renameSync(next, current)
  } catch {
    rmSync(next, { force: true })
    throw new AppError('update.not_writable', `Kasboek can’t replace ${current}. Download the new AppImage from the release page and replace it yourself.`)
  }
  const { command, args } = relaunchAfterExit(process.pid, current)
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

/** Gives the window time to show the new state before the backup holds the main process (the database export and encryption run synchronously). */
const letWindowPaint = (): Promise<void> => new Promise((r) => setTimeout(r, 100))

async function install(): Promise<UpdateStatus> {
  if (status.state !== 'ready' || !file || !existsSync(file) || !status.kind) throw new AppError('update.not_ready', 'Download the update first.')
  set(installStep('prepare'))
  await letWindowPaint()
  try {
    return await prepareAndClose(file)
  } catch (err) {
    set(installStep('fail', err instanceof AppError ? err.message : 'The update couldn’t be started.'))
    throw err
  }
}

async function prepareAndClose(downloaded: string): Promise<UpdateStatus> {
  // A copy of the data as it is now, in case the new version needs to be undone.
  if (isUnlocked()) {
    mkdirSync(paths.safetyDir, { recursive: true })
    await writeTransfer(join(paths.safetyDir, `before-update-${stamp()}.${TRANSFER_EXTENSION}`), 'backup')
  }
  if (status.kind === 'dmg' || status.kind === 'deb') {
    const err = await shell.openPath(downloaded)
    if (err) throw new AppError('update.open', `The update was downloaded but couldn’t be opened: ${err}`)
    return set(installStep('opened'))
  }
  if (status.kind === 'msi' && !asset?.sha256) throw new AppError('update.no_checksum', 'The release has no checksum for this file, so Kasboek won’t install it. Download it from the release page instead.')
  // The note lets the next start tell whether the update went in.
  writeFileSync(pendingFile(), JSON.stringify({ version: status.latest, at: new Date().toISOString() }))
  try {
    if (status.kind === 'msi') await startUpdateHelper(downloaded, asset!.sha256!)
    else installAppImage(downloaded)
  } catch (err) {
    rmSync(pendingFile(), { force: true })
    rmSync(join(updatesDir(), 'apply.json'), { force: true })
    throw err
  }
  set(installStep('close'))
  // Closing locks Kasboek (and makes the usual backup on quit).
  setTimeout(() => app.quit(), 300)
  return status
}

/**
 * One install at a time: a second click while the first is still making its backup or starting the
 * helper gets the current status. After a start that closes Kasboek the guard stays on.
 */
export const installUpdate = oneAtATime(install, (s) => s.state === 'installing', () => status)

export function openReleasePage(): void {
  const url = status.pageUrl ?? RELEASES
  if (url.startsWith('https://github.com/')) void shell.openExternal(url)
}

/** Removes the updates folder. The note (`pending.json`) goes last, so an interrupted clean-up is tried again at the next start. */
function cleanUpdatesDir(): void {
  for (const name of readdirSync(updatesDir())) if (name !== 'pending.json') rmSync(join(updatesDir(), name), { recursive: true, force: true })
  rmSync(updatesDir(), { recursive: true, force: true })
}

/** At most this much of each log is kept (the end of it, which is where a freeze shows). */
export const KEPT_LOG_BYTES = 256 * 1024
const KEPT_LOGS = ['install.log', 'helper.log', 'result.json']

/**
 * Keeps the logs of the update that just ran, in `updates-last` (replaced by every update, each file
 * cut to its last 256 KB), so a freeze can be looked into after the updates folder is cleaned up.
 * The logs hold paths and Windows Installer's messages, no keys or data; they stay on this computer.
 */
export function keepLogs(from = updatesDir(), to = lastUpdateDir()): void {
  try {
    const present = KEPT_LOGS.filter((n) => existsSync(join(from, n)))
    if (present.length === 0) return
    rmSync(to, { recursive: true, force: true })
    mkdirSync(to, { recursive: true })
    for (const name of present) {
      let raw = readFileSync(join(from, name))
      // An even start keeps a UTF-16 log (Windows Installer's) readable.
      if (raw.length > KEPT_LOG_BYTES) raw = raw.subarray(raw.length - KEPT_LOG_BYTES)
      writeFileSync(join(to, name), raw)
    }
  } catch {
    // Keeping logs is a courtesy: never let it stop Kasboek from starting.
  }
}

/** After an update: clean up, or tell the person it didn't install. */
function afterRestart(): void {
  if (!existsSync(pendingFile())) return
  try {
    const { version, at } = JSON.parse(readFileSync(pendingFile(), 'utf8')) as { version: string; at?: unknown }
    let result: unknown = null
    try {
      result = JSON.parse(readFileSync(join(updatesDir(), 'result.json'), 'utf8'))
    } catch {
      // No result: the helper hasn't finished, or never got as far as writing one.
    }
    // Started by hand while the installer still works: say nothing and touch nothing, the next start decides.
    if (updateMayStillBeRunning(version, app.getVersion(), result, at)) return
    keepLogs()
    const message = failedUpdateMessage(version, app.getVersion(), result)
    if (message) {
      failedInstall = message
      set({ state: 'error', latest: version, error: failedInstall })
      rmSync(pendingFile(), { force: true })
      return
    }
  } catch {
    // An unreadable note: just clean up.
  }
  try {
    cleanUpdatesDir()
  } catch {
    // The helper may still hold its program for a moment: the next start cleans up.
  }
}

let started = false
export function startUpdateChecks(): void {
  if (started) return
  started = true
  try {
    afterRestart()
    // Leftovers from a download that never finished.
    if (existsSync(updatesDir())) for (const f of readdirSync(updatesDir())) if (f.endsWith('.partial')) rmSync(join(updatesDir(), f), { force: true })
  } catch {
    // Never let cleaning up stop Kasboek from starting.
  }
  if (!supported()) return
  // Only once the person has made the choice in the welcome window.
  const due = (): boolean => getPrefs().welcomeDone && getPrefs().updateCheck && (!status.lastCheckedAt || Date.now() - Date.parse(status.lastCheckedAt) > DAY)
  setTimeout(() => void (due() && checkForUpdate()), 15_000)
  setInterval(() => void (due() && checkForUpdate()), 60 * 60 * 1000)
}
