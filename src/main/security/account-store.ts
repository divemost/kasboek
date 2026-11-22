/**
 * Reads and writes account.json, sealed by the operating system (DPAPI on Windows,
 * Keychain on macOS, Secret Service on Linux). This seal is what binds the data to this
 * computer and user account: a copied file can't be opened elsewhere, even with the password.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'
import type { AccountData } from '@core/account'
import { AppError } from '@core/errors'
import type { KeyProtection } from '@shared/types'
import { errCode, fsErrorText } from '../fs-error'
import { startupLog } from '../graphics'
import { paths } from '../paths'

interface AccountFile {
  format: 'kasboek-account'
  version: 2
  seal: 'os' | 'none'
  data: string
}

export type SealType = 'os' | 'none' | 'unknown'

/**
 * Why account.json could not be opened. The message is technical (English, no paths, no file contents); the page shows
 * its own text per code and the message only under "Details".
 *  - auth.other_device: sealed by the operating system, which can't unseal it here (another computer or login)
 *  - auth.key_missing: same, on Windows with no `Local State` file (the key Windows keeps next to the data)
 *  - auth.corrupt: the file is empty, cut off or not an account file
 *  - auth.unreadable: the file couldn't be read right now (busy, antivirus, permissions, disk)
 */
export class AccountReadError extends AppError {
  constructor(
    code: 'auth.other_device' | 'auth.key_missing' | 'auth.corrupt' | 'auth.unreadable',
    message: string,
    public readonly seal: SealType,
    /** The file has no usable JSON in it: account.json.bak may still be good. */
    public readonly recoverable = false
  ) {
    super(code, message)
    this.name = 'AccountReadError'
  }
}

/** Waits before the 2nd and 3rd attempt to unseal: the async encryptor starts up lazily. */
export const DECRYPT_RETRY_DELAYS_MS = [250, 750]

const bakFile = (): string => paths.accountFile + '.bak'
const localStateFile = (): string => join(paths.dataDir, 'Local State')

let available: boolean | null = null

async function osAvailable(): Promise<boolean> {
  if (available === null) available = await safeStorage.isAsyncEncryptionAvailable()
  return available
}

export async function keyProtection(): Promise<KeyProtection> {
  if (!(await osAvailable())) return 'weak'
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return 'weak'
  return 'os'
}

export function accountExists(): boolean {
  return existsSync(paths.accountFile)
}

async function decryptWithRetry(data: Buffer): Promise<string> {
  let last: unknown
  for (const delay of [0, ...DECRYPT_RETRY_DELAYS_MS]) {
    if (delay) await new Promise((r) => setTimeout(r, delay))
    try {
      return (await safeStorage.decryptStringAsync(data)).result
    } catch (err) {
      last = err
    }
  }
  const tries = DECRYPT_RETRY_DELAYS_MS.length + 1
  const why = last instanceof Error ? last.message.slice(0, 120) : ''
  if (process.platform === 'win32' && !existsSync(localStateFile())) {
    throw new AccountReadError('auth.key_missing', `The Windows key file (Local State) is missing; unsealing failed after ${tries} tries${why ? `: ${why}` : ''}`, 'os')
  }
  throw new AccountReadError('auth.other_device', `The operating system could not unseal the account after ${tries} tries${why ? `: ${why}` : ''}`, 'os')
}

/** Opens the text of an account file: JSON, then the OS seal. Raises AccountReadError. */
async function openSealed(raw: string, name: string): Promise<AccountData> {
  if (!raw.trim()) throw new AccountReadError('auth.corrupt', `${name} is empty`, 'unknown', true)
  let file: AccountFile
  try {
    file = JSON.parse(raw) as AccountFile
  } catch {
    throw new AccountReadError('auth.corrupt', `${name} is not valid JSON (cut off or damaged)`, 'unknown', true)
  }
  if (!file || typeof file !== 'object') throw new AccountReadError('auth.corrupt', `${name} does not hold an account`, 'unknown', true)
  if (file.format !== 'kasboek-account' || typeof file.data !== 'string' || (file.seal !== 'os' && file.seal !== 'none')) {
    throw new AccountReadError('auth.corrupt', `${name} is not a Kasboek account file (format ${typeof file.format === 'string' ? 'differs' : 'missing'})`, 'unknown')
  }
  const json = file.seal === 'os' ? await decryptWithRetry(Buffer.from(file.data, 'base64')) : Buffer.from(file.data, 'base64').toString('utf8')
  try {
    return JSON.parse(json) as AccountData
  } catch {
    throw new AccountReadError('auth.other_device', `The unsealed ${name} is not account data (seal ${file.seal})`, file.seal)
  }
}

/** Seal type of an account file as far as it can be told, for the log and the diagnostic text. */
function sealOf(raw: string): SealType {
  try {
    const seal = (JSON.parse(raw) as { seal?: unknown }).seal
    return seal === 'os' || seal === 'none' ? seal : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Writes through a temporary file with a name of its own (so two writes never share one): created new, flushed to
 * disk, then renamed over the target, then the folder entry is flushed where possible. The name stays under the
 * `account.json.` prefix, so a leftover of a crash is found and removed with the other copies.
 */
async function writeDurable(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${randomUUID()}`
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      if (process.platform !== 'win32') await handle.chmod(0o600)
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
  await syncDirectory(dirname(file))
}

/** Windows (and some file systems) can't flush a folder: that is expected and not an error. */
const NO_DIRECTORY_SYNC = new Set(['EPERM', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EACCES'])

async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (err) {
    if (!NO_DIRECTORY_SYNC.has(errCode(err))) startupLog(`account: could not flush the data folder (${errCode(err)})`)
  }
}

/** Saves and refreshes run one after the other: two overlapping ones could otherwise interleave their files. */
let writes: Promise<unknown> = Promise.resolve()
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writes.then(task, task)
  writes = run.catch(() => undefined)
  return run
}

/**
 * Keeps account.json.bak equal to the sealed account file. When that fails the copy is removed: an old one must not
 * stay behind, or an automatic restore would bring back an outdated account. A failure is logged and never stops the caller.
 */
async function refreshBackup(raw: string): Promise<void> {
  try {
    if (existsSync(bakFile()) && (await readFile(bakFile(), 'utf8')) === raw) return
    await writeDurable(bakFile(), raw)
  } catch (err) {
    startupLog(`account: could not update account.json.bak (${fsErrorText(err)})`)
    await rm(bakFile(), { force: true }).catch((e: unknown) => startupLog(`account: could not remove the outdated account.json.bak (${fsErrorText(e)})`))
  }
}

let restoredAt: string | null = null

/** When the safety copy that replaced a damaged or missing account file was last written (ISO); asking clears it. */
export function takeRestoreNotice(): string | null {
  const at = restoredAt
  restoredAt = null
  return at
}

/**
 * Reads the account. When account.json itself is empty, cut off or missing, account.json.bak is tried: if that opens, it
 * becomes account.json and a damaged file is kept as account.json.damaged-<time>. The backup is never looked at
 * while account.json is readable, so an older copy can't replace a good file.
 */
export async function loadAccount(): Promise<AccountData | null> {
  if (!existsSync(paths.accountFile)) {
    if (!existsSync(bakFile())) return null
    return serialized(() => recoverFromBackup(new AccountReadError('auth.corrupt', 'account.json is missing', 'unknown', true), null))
  }
  let raw: string
  try {
    raw = await readFile(paths.accountFile, 'utf8')
  } catch (err) {
    throw new AccountReadError('auth.unreadable', `account.json could not be read (${fsErrorText(err)})`, 'unknown')
  }
  try {
    const account = await openSealed(raw, 'account.json')
    await serialized(() => refreshBackup(raw))
    return account
  } catch (err) {
    if (!(err instanceof AccountReadError) || !err.recoverable) throw err
    return serialized(() => recoverFromBackup(err, raw))
  }
}

async function recoverFromBackup(damaged: AccountReadError, damagedRaw: string | null): Promise<AccountData> {
  let bak: string
  try {
    bak = await readFile(bakFile(), 'utf8')
  } catch {
    throw new AccountReadError('auth.corrupt', `${damaged.message}; account.json.bak is not available`, damaged.seal)
  }
  let account: AccountData
  try {
    account = await openSealed(bak, 'account.json.bak')
  } catch (err) {
    throw new AccountReadError('auth.corrupt', `${damaged.message}; account.json.bak could not be used (${err instanceof AccountReadError ? err.message : 'unknown'})`, sealOf(bak))
  }
  const bakDate = (await stat(bakFile()).catch(() => null))?.mtime.toISOString() ?? null
  const keep = damagedRaw === null ? null : `${paths.accountFile}.damaged-${Date.now()}`
  if (keep) await rename(paths.accountFile, keep)
  try {
    await writeDurable(paths.accountFile, bak)
  } catch (err) {
    // Put the damaged file back: nothing may be left half-way.
    if (keep) await rename(keep, paths.accountFile).catch(() => undefined)
    throw new AccountReadError('auth.unreadable', `account.json.bak was good but could not be restored (${fsErrorText(err)})`, sealOf(bak))
  }
  restoredAt = bakDate
  const was = damagedRaw === null ? 'missing' : `${damagedRaw.trim() ? 'damaged' : 'empty'} (${damagedRaw.length} bytes)`
  startupLog(`account: account.json was ${was}; restored from account.json.bak${keep ? `, kept the old file as ${keep.split(/[\\/]/).pop()}` : ''}`)
  return account
}

/**
 * Seals and writes the account. A change of credentials (`credentials`) must not leave an older safety copy behind: the
 * copy is removed first, and when that is not possible the save fails before anything was written.
 */
export async function saveAccount(account: AccountData, opts: { credentials?: boolean } = {}): Promise<void> {
  return serialized(async () => {
    try {
      const json = JSON.stringify(account)
      const os = await osAvailable()
      const file: AccountFile = {
        format: 'kasboek-account',
        version: 2,
        seal: os ? 'os' : 'none',
        data: os ? (await safeStorage.encryptStringAsync(json)).toString('base64') : Buffer.from(json).toString('base64')
      }
      const text = JSON.stringify(file)
      if (opts.credentials) await rm(bakFile(), { force: true })
      await writeDurable(paths.accountFile, text)
      await refreshBackup(text)
    } catch (err) {
      throw new AppError('auth.save_failed', `The account file could not be saved (${fsErrorText(err)}).`)
    }
  })
}

/** One line for startup.log about a failed read: codes, sizes and states only, never contents or secrets. */
export async function describeReadFailure(err: unknown): Promise<string> {
  let size = 'missing'
  let seal: SealType = 'unknown'
  try {
    size = String(statSync(paths.accountFile).size)
    seal = err instanceof AccountReadError && err.seal !== 'unknown' ? err.seal : sealOf(await readFile(paths.accountFile, 'utf8'))
  } catch {
    // Size or seal unknown: the line says so.
  }
  let storage = 'unknown'
  try {
    storage = String(await safeStorage.isAsyncEncryptionAvailable())
  } catch {
    // Left as unknown.
  }
  const code = err instanceof AppError ? err.code : 'unexpected'
  const message = err instanceof AppError ? err.message : err instanceof Error ? err.name : 'unknown'
  return `account read failed: ${code}: ${message}; account.json size ${size}; seal ${seal}; safeStorage available ${storage}; Local State ${existsSync(localStateFile()) ? 'present' : 'missing'}`
}

/** Files next to account.json that belong to it (the safety copy, a damaged one, leftovers of a write): names only. */
export async function accountSideFiles(): Promise<string[]> {
  const base = 'account.json.'
  try {
    return (await readdir(paths.dataDir)).filter((n) => n.startsWith(base))
  } catch {
    return []
  }
}

/**
 * Removes damaged copies and leftovers of a write (and the safety copy too, with `withBackup`). Used when the account is
 * replaced by an imported one; the safety copy is rewritten by the save itself, so it is kept unless asked.
 */
export async function removeAccountSideFiles(withBackup = false): Promise<void> {
  for (const name of await accountSideFiles()) {
    if (name === 'account.json.bak' && !withBackup) continue
    await rm(join(paths.dataDir, name), { force: true })
  }
}

/** Phase 1 stored the database key in keystore.json. Returns it so setup can keep the existing data. */
export async function readLegacyDbKey(): Promise<string | null> {
  if (!existsSync(paths.legacyKeystoreFile) || !existsSync(paths.dbFile)) return null
  try {
    const data = JSON.parse(await readFile(paths.legacyKeystoreFile, 'utf8')) as { dbKey?: string }
    const v = data.dbKey ?? ''
    if (v.startsWith('os:')) return (await safeStorage.decryptStringAsync(Buffer.from(v.slice(3), 'base64'))).result
    if (v.startsWith('plain:')) return Buffer.from(v.slice(6), 'base64').toString('utf8')
  } catch {
    // Unreadable: treat as no legacy data.
  }
  return null
}

export async function removeLegacyKeystore(): Promise<void> {
  await rm(paths.legacyKeystoreFile, { force: true })
}
