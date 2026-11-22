/**
 * Login state. While locked, the database is closed and no key is held in memory.
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { BrowserWindow, powerMonitor } from 'electron'
import {
  checkThrottle,
  createAccount,
  forgetRemembered,
  rememberedUntil,
  recordFailure,
  rotateRecoveryKey,
  setPassword,
  setPasswordless,
  setTwoFactor,
  storeVault,
  throttleSeconds,
  unlockWithDevice,
  unlockWithPassword,
  unlockWithRecovery,
  type AccountData,
  type AuthMode,
  type Vault
} from '@core/account'
import { openSlot } from '@core/crypto'
import { openDatabase, type Db } from '@core/database'
import { AppError } from '@core/errors'
import { newTotpSecret, otpauthUri, verifyTotp } from '@core/totp'
import type { AppEvent } from '@shared/contract'
import { checkPassword } from '@shared/password'
import type { AuthStatus, ErasedCopy } from '@shared/types'
import { startupLog } from './graphics'
import { paths } from './paths'
import { getPrefs } from './prefs'
import { accountExists, AccountReadError, describeReadFailure, keyProtection, loadAccount, readLegacyDbKey, removeAccountSideFiles, removeLegacyKeystore, saveAccount, type SealType } from './security/account-store'
import { deviceAuthKind, peekDeviceAuthKind, releaseDeviceCheck, verifyDeviceUser } from './security/device-auth'
import { keyIsOsProtected } from './security/device-mode'
import { listErased, purgeErased, quarantineData, restoreErased } from './quarantine'

interface Open {
  master: Buffer
  vault: Vault
  db: Db
}

let account: AccountData | null = null
let loadError: AppError | null = null
let open: Open | null = null
/** Unlocked with the recovery key: the next password change needs no current password. */
let recovered = false
let pendingTotp: string | null = null
/** Unlocked with a password that predates the current rules. */
let weakPassword = false
const lockListeners: (() => void)[] = []

export function broadcast(event: AppEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('kasboek:event', event)
}

export function onLock(fn: () => void): void {
  lockListeners.push(fn)
}

let startupInit: Promise<void> | null = null

/** Reads the account at start-up. Operations that need it wait for it with whenSessionReady(). */
export function startSession(): Promise<void> {
  startupInit ??= initSession()
  return startupInit
}

/** Resolves once the account has been read at start-up (at once when that was never started). */
export function whenSessionReady(): Promise<void> {
  return startupInit ? startupInit.catch(() => undefined) : Promise.resolve()
}

let initRunning: Promise<void> | null = null

/** Reads the account file. Calls that overlap share one read; the previous result stays in place until the new one is known. */
export function initSession(): Promise<void> {
  initRunning ??= readAccount().finally(() => (initRunning = null))
  return initRunning
}

async function readAccount(): Promise<void> {
  try {
    account = await loadAccount()
    loadError = null
  } catch (err) {
    // Never the raw error as the message: the page shows its own text per code, and this only under "Details".
    const failure = err instanceof AppError ? err : new AccountReadError('auth.unreadable', `unexpected error (${err instanceof Error ? err.name : 'unknown'})`, 'unknown')
    loadError = failure
    startupLog(await describeReadFailure(err).catch(() => `account read failed: ${failure.code}`))
  }
  // Erased copies are kept for 30 days, then removed.
  await purgeErased(paths).catch((err: unknown) => console.warn('[auth] could not clean up erased data:', err))
  // Checking for Windows Hello takes a moment (PowerShell): never let the first screen wait for it. Only a
  // passwordless account needs it for the Lock screen; for the others it waits for startDeferredChecks().
  peekDeviceAuthKind(() => broadcast({ type: 'auth.refresh' }), { deviceMode: account?.mode === 'device' })
}

/** After the first screen: starts the Windows Hello / Touch ID check that was held back, and tells the page when it has an answer. */
export function startDeferredChecks(): void {
  releaseDeviceCheck()
  peekDeviceAuthKind(() => broadcast({ type: 'auth.refresh' }))
}

export function db(): Db {
  if (!open) throw new AppError('auth.locked', 'Kasboek is locked.')
  return open.db
}

/** The account file exists but can't be opened: the first screen is the error card, and a backup may replace the data. */
export function accountUnreadable(): boolean {
  return !open && loadError !== null
}

/** What the diagnostic text says about the failed read; null when there is none. */
export function readFailure(): { code: string; seal: SealType } | null {
  return loadError ? { code: loadError.code, seal: loadError instanceof AccountReadError ? loadError.seal : 'unknown' } : null
}

export function isUnlocked(): boolean {
  return open !== null
}

/** For exports and backups while unlocked. */
export function secrets(): { account: AccountData; master: Buffer; vault: Vault } {
  if (!open || !account) throw new AppError('auth.locked', 'Kasboek is locked.')
  return { account, master: open.master, vault: open.vault }
}

export async function status(): Promise<AuthStatus> {
  // "Try again" after e.g. unlocking the system keyring.
  if (loadError && !open) await initSession()
  const peek = peekDeviceAuthKind(() => broadcast({ type: 'auth.refresh' }), { deviceMode: account?.mode === 'device' })
  const device = peek ?? null
  return {
    // An account file that can't be read is 'locked' with an error, never 'setup': setup would replace it.
    state: open ? 'unlocked' : account || loadError ? 'locked' : 'setup',
    mode: account?.mode ?? null,
    twoFactor: account?.twoFactor ?? false,
    rememberedUntil: account ? rememberedUntil(account) : null,
    device,
    deviceChecking: peek === undefined,
    throttleSeconds: account ? throttleSeconds(account) : 0,
    recovered,
    weakPassword: !!open && weakPassword,
    legacyData: !account && (await readLegacyDbKey()) !== null,
    erased: await erasedCopies(),
    keyProtection: await keyProtection(),
    error: loadError ? { code: loadError.code, message: loadError.message } : null
  }
}

function openWith(master: Buffer, vault: Vault): void {
  const database = openDatabase(paths.dbFile, vault.dbKey)
  open = { master, vault, db: database }
}

/** Saves first and only then replaces the copy in memory, so a failed write never leaves memory ahead of the file. */
async function persist(next: AccountData): Promise<void> {
  await saveAccount(next)
  account = next
}

/**
 * For the failed-attempt counter (and the reset after a correct login): memory is updated first, so
 * guesses are counted even when the file can't be written; a failed write is logged, not raised.
 */
async function persistCounter(next: AccountData): Promise<void> {
  account = next
  try {
    await saveAccount(next)
  } catch (err) {
    console.warn('[auth] could not save the login attempts:', err instanceof Error ? err.message : err)
  }
}

async function erasedCopies(): Promise<ErasedCopy[]> {
  return (await listErased(paths)).map((e) => ({ name: e.name, erasedAt: new Date(e.erasedAt).toISOString() }))
}

/** Passwordless mode keeps the key in the account file: only safe when the operating system seals that file. */
async function requireOsProtection(): Promise<void> {
  if (!(await keyIsOsProtected())) {
    throw new AppError('auth.device_unprotected', 'Windows Hello or Touch ID can only replace the password when this computer protects Kasboek’s key (Windows account, macOS Keychain or a Linux keyring). Choose a password instead.')
  }
}

async function requireDevice(reason: string): Promise<void> {
  if (!(await deviceAuthKind())) throw new AppError('auth.no_device', 'Windows Hello or Touch ID is not available on this computer.')
  if (!(await verifyDeviceUser(reason))) throw new AppError('auth.device_failed', 'Verification was cancelled or failed.')
}

/* ---------- Setup, unlock, lock ---------- */

export async function setup(mode: AuthMode, password?: string): Promise<{ recoveryKey: string }> {
  if (account || loadError || accountExists()) throw new AppError('auth.exists', 'Kasboek is already set up.')
  if (mode === 'password' && !checkPassword(password ?? '').ok) throw new AppError('auth.weak_password', 'Choose a stronger password.')
  if (mode === 'device') {
    await requireOsProtection()
    await requireDevice('Set up Kasboek')
  }
  const legacyKey = await readLegacyDbKey()
  if (!legacyKey && existsSync(paths.dbFile)) {
    // A database without its account can't be opened by anyone: move it aside, don't delete it.
    await rename(paths.dbFile, `${paths.dbFile}.orphaned-${Date.now()}`)
  }
  const created = await createAccount({ mode, password, dbKey: legacyKey ?? randomBytes(32).toString('hex') })
  await persist(created.account)
  openWith(created.master, created.vault)
  if (legacyKey) await removeLegacyKeystore()
  return { recoveryKey: created.recoveryKey }
}

function requireAccount(): AccountData {
  if (!account) throw loadError ?? new AppError('auth.no_account', 'Set up Kasboek first.')
  return account
}

export async function unlock(input: { password?: string; code?: string; remember?: boolean }): Promise<void> {
  const acc = requireAccount()
  let result
  if (acc.mode === 'device') {
    // Check the 2FA code format first so a typo doesn't cost a Hello prompt.
    const needCode = acc.twoFactor && !rememberedUntil(acc)
    if (needCode && !/^\d{6}$/.test((input.code ?? '').trim())) throw new AppError('auth.code_required', 'Enter the 6-digit code from your authenticator app.')
    await requireDevice('Unlock Kasboek')
    result = unlockWithDevice(acc, input.code || undefined, { remember: input.remember })
  } else {
    result = await unlockWithPassword(acc, input.password ?? '', input.code || undefined, { remember: input.remember })
  }
  await persistCounter(result.account)
  if (!result.ok) {
    throw new AppError('auth.failed', acc.twoFactor ? 'The password or code is incorrect.' : 'The password is incorrect.')
  }
  recovered = false
  weakPassword = acc.mode === 'password' && !checkPassword(input.password ?? '').ok
  openWith(result.unlocked.master, result.unlocked.vault)
}

export async function unlockRecovery(recoveryKey: string): Promise<void> {
  const result = await unlockWithRecovery(requireAccount(), recoveryKey)
  await persistCounter(result.account)
  if (!result.ok) throw new AppError('auth.failed', 'That recovery key is not correct.')
  recovered = true
  openWith(result.unlocked.master, result.unlocked.vault)
}

export function lock(reason: 'user' | 'idle' | 'system' = 'user', silent = false): void {
  if (!open) return
  for (const fn of lockListeners) fn()
  open.db.close()
  open.master.fill(0)
  open = null
  pendingTotp = null
  recovered = false
  weakPassword = false
  if (!silent) broadcast({ type: 'auth.locked', reason })
}

/** Closes the database without telling the UI, e.g. right before an import replaces it. */
export function closeForReplace(): void {
  lock('user', true)
}

/**
 * Moves the data into quarantine (see quarantine.ts) and starts fresh. In passwordless mode Windows Hello
 * or Touch ID must confirm first; with no account, or one that can't be read, typing ERASE is all there is.
 */
export async function erase(): Promise<void> {
  if (account?.mode === 'device') await requireDevice('Erase Kasboek')
  lock('user')
  try {
    await quarantineData(paths, Date.now(), startupLog)
  } catch (err) {
    // quarantineData puts back what it moved; reading the account again makes memory match whatever is on disk.
    await initSession().catch((e: unknown) => startupLog(`erase failed, and the data could not be read again: ${e instanceof Error ? e.message : String(e)}`))
    throw new AppError('auth.erase_failed', `Could not set the data aside, so erasing was stopped: ${err instanceof Error ? err.message : String(err)}`)
  }
  account = null
  loadError = null
}

/** Brings back one erased copy, by the name from status().erased. It needs the original password or recovery key to open. */
export async function restoreErasedData(name: string): Promise<void> {
  if (account || loadError || accountExists()) throw new AppError('auth.restore_blocked', 'Kasboek is already set up. Restoring erased data is only possible on the first screen.')
  try {
    await restoreErased(paths, name)
  } finally {
    // Also after a failure: memory has to match what is on disk, or the first screen is stuck on the old state.
    await initSession()
  }
}

/** Re-checks who is at the keyboard before a sensitive change. Wrong passwords count and slow down, as at unlock. */
async function reauth(password?: string): Promise<void> {
  const acc = requireAccount()
  if (recovered) return
  if (acc.mode === 'device') return requireDevice('Confirm it is you')
  checkThrottle(acc)
  if (!password || !acc.slots.password || !(await openSlot(acc.slots.password, password, 'password'))) {
    await persistCounter(recordFailure(acc))
    throw new AppError('auth.failed', 'The current password is incorrect.')
  }
  if (acc.attempts.failed > 0) await persistCounter({ ...acc, attempts: { failed: 0, lastFailedAt: null } })
}

export async function changePassword(current: string | undefined, next: string): Promise<void> {
  const { master } = secrets()
  await reauth(current)
  if (!checkPassword(next).ok) throw new AppError('auth.weak_password', 'Choose a stronger password.')
  await persist(await setPassword(requireAccount(), master, next))
  recovered = false
  weakPassword = false
}

export async function switchToPasswordless(currentPassword?: string): Promise<void> {
  const { master } = secrets()
  await requireOsProtection()
  await reauth(currentPassword)
  await requireDevice('Use Windows Hello or Touch ID for Kasboek')
  await persist(setPasswordless(requireAccount(), master))
  recovered = false
}

export async function newRecoveryKey(password?: string): Promise<string> {
  const { master } = secrets()
  await reauth(password)
  const r = await rotateRecoveryKey(requireAccount(), master)
  await persist(r.account)
  return r.recoveryKey
}

export async function forgetThisComputer(): Promise<void> {
  secrets()
  await persist(forgetRemembered(requireAccount()))
}

export async function totpBegin(): Promise<{ secret: string; uri: string; qrSvg: string }> {
  secrets()
  pendingTotp = newTotpSecret()
  const uri = otpauthUri(pendingTotp)
  const { default: QRCode } = await import('qrcode')
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#18201B', light: '#FFFFFF' } })
  return { secret: pendingTotp.match(/.{1,4}/g)!.join(' '), uri, qrSvg }
}

export async function totpEnable(code: string): Promise<void> {
  const { master, vault } = secrets()
  if (!pendingTotp) throw new AppError('auth.totp_expired', 'Start the set-up again.')
  const step = verifyTotp(pendingTotp, code, -1)
  if (step === null) throw new AppError('auth.failed', 'That code is not correct. Check the time on your phone and try again.')
  const r = setTwoFactor(requireAccount(), master, vault, { secret: pendingTotp, lastStep: step })
  pendingTotp = null
  open!.vault = r.vault
  await persist(r.account)
}

export async function totpDisable(code: string): Promise<void> {
  const { master, vault } = secrets()
  const step = vault.totp ? verifyTotp(vault.totp.secret, code, vault.totp.lastStep) : null
  if (step === null && !recovered) throw new AppError('auth.failed', 'That code is not correct.')
  const r = setTwoFactor(requireAccount(), master, vault, null)
  open!.vault = r.vault
  await persist(r.account)
}

/** Used by import: replaces the account and opens the imported database. */
export async function adopt(next: AccountData, master: Buffer, vault: Vault, wasRecovery: boolean): Promise<void> {
  if (open) closeForReplace()
  await persist(storeVault(next, master, vault))
  // Copies of the account that was replaced (damaged ones, leftovers) hold its sealed secrets: not kept.
  await removeAccountSideFiles().catch((err: unknown) => startupLog(`import: could not remove old account copies: ${err instanceof Error ? err.message : String(err)}`))
  loadError = null
  openWith(master, vault)
  recovered = wasRecovery && next.mode === 'password'
}

/* ---------- Auto-lock ---------- */

export function startAutoLock(): void {
  setInterval(() => {
    const minutes = getPrefs().autoLockMinutes
    if (open && minutes > 0 && powerMonitor.getSystemIdleTime() >= minutes * 60) lock('idle')
  }, 15_000)
  powerMonitor.on('lock-screen', () => lock('system'))
  powerMonitor.on('suspend', () => lock('system'))
}
