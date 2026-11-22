/**
 * Export (move to another computer), automatic backups and import. All use the same
 * .kasboek format, which opens only through Import with the login credentials.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { AccountData } from '@core/account'
import { makeSlot } from '@core/crypto'
import { integrityOk, openDatabase, snapshotEncrypted } from '@core/database'
import { AppError } from '@core/errors'
import { MIGRATIONS, schemaVersion } from '@core/migrations'
import { getSetting, getSettings, resetImportedSettings, updateSettings } from '@core/settings'
import { encodeTransfer, openTransfer, readTransferHeader, TRANSFER_EXTENSION } from '@core/transfer-format'
import { planRetention, timeFromName, type Tier } from '@core/backup-tiers'
import type { BackupEntryInfo, BackupStatus, ImportReset, PickedTransfer } from '@shared/types'
import { paths } from '../paths'
import { startupLog } from '../graphics'
import { quarantineData, restoreErased } from '../quarantine'
import { removeAccountSideFiles } from '../security/account-store'
import { canUseDeviceMode } from '../security/device-mode'
import { accountUnreadable, adopt, closeForReplace, db, initSession, isUnlocked, secrets } from '../session'

const AUTO_FILE = new RegExp(`^kasboek-backup-[0-9_-]+\\.${TRANSFER_EXTENSION}$`)

export function stamp(date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

export const exportFileName = (): string => `kasboek-export-${stamp()}.${TRANSFER_EXTENSION}`
const backupFileName = (): string => `kasboek-backup-${stamp()}.${TRANSFER_EXTENSION}`

export function backupStatus(): BackupStatus {
  const s = getSettings(db())
  return { autoEnabled: s.autoBackupEnabled, folder: s.autoBackupFolder, keep: s.autoBackupKeep, lastBackupAt: s.lastBackupAt, lastBackupFile: s.lastBackupFile }
}

/** Writes an export/backup of the live data to `file`. Needs Kasboek to be unlocked. */
/** Empties tables in a snapshot copy (e.g. the assistant's memory, which stays on its own computer). */
function leaveOut(tmp: string, dbKey: string, tables: string[]): void {
  if (!tables.length) return
  const copy = openDatabase(tmp, dbKey, { migrate: false })
  try {
    for (const t of tables) copy.exec(`DELETE FROM ${t}`)
    copy.exec('VACUUM')
  } finally {
    copy.close()
  }
}

export async function writeTransfer(file: string, kind: 'export' | 'backup', opts: { leaveOut?: string[] } = {}): Promise<string> {
  const { account, master, vault } = secrets()
  const live = db()
  const tmp = join(paths.dataDir, `snapshot-${randomUUID()}.tmp`)
  // Read and encrypt in one synchronous step: locking wipes the master key, which must not happen halfway
  // (a file encrypted with a zeroed key could never be opened). Only writing the finished bytes waits.
  let bytes: Buffer
  try {
    snapshotEncrypted(live, tmp)
    leaveOut(tmp, vault.dbKey, opts.leaveOut ?? [])
    bytes = encodeTransfer({ kind, account, master, vault, dbFile: readFileSync(tmp), appVersion: app.getVersion(), schemaVersion: schemaVersion(live) })
  } finally {
    rmSync(tmp, { force: true })
  }
  const partial = file + '.partial'
  try {
    await writeFile(partial, bytes, { mode: 0o600 })
    await rename(partial, file)
  } catch (err) {
    await rm(partial, { force: true })
    throw err
  }
  // Locked while writing: the file is complete, but the database it came from is closed.
  if (kind === 'backup' && isUnlocked() && db() === live) updateSettings(live, { lastBackupAt: new Date().toISOString(), lastBackupFile: file })
  return file
}

/** Same as writeTransfer, but synchronous: used when locking or quitting, right before the database closes. */
export function writeTransferSync(file: string, kind: 'export' | 'backup'): string {
  const { account, master, vault } = secrets()
  const live = db()
  const tmp = join(paths.dataDir, `snapshot-${randomUUID()}.tmp`)
  try {
    snapshotEncrypted(live, tmp)
    const bytes = encodeTransfer({ kind, account, master, vault, dbFile: readFileSync(tmp), appVersion: app.getVersion(), schemaVersion: schemaVersion(live) })
    writeFileSync(file + '.partial', bytes, { mode: 0o600 })
    renameSync(file + '.partial', file)
  } finally {
    rmSync(tmp, { force: true })
  }
  if (kind === 'backup') updateSettings(live, { lastBackupAt: new Date().toISOString(), lastBackupFile: file })
  return file
}

/* ---------- Automatic backups ---------- */

/** The backup folder if automatic backups are on and it's reachable (an unplugged drive is skipped, never created). */
export function autoFolder(): string | null {
  if (!isUnlocked()) return null
  const s = getSettings(db())
  if (!s.autoBackupEnabled || !s.autoBackupFolder || !existsSync(s.autoBackupFolder)) return null
  return s.autoBackupFolder
}

export async function runAutoBackupIfDue(maxAgeHours = 24): Promise<string | null> {
  const folder = autoFolder()
  if (!folder) return null
  const newest = (await listBackups(folder))[0]
  if (newest && Date.now() - newest.time < maxAgeHours * 3600_000) return null
  return runAutoBackup()
}

export async function runAutoBackup(): Promise<string> {
  const s = getSettings(db())
  if (!s.autoBackupFolder) throw new AppError('backup.no_folder', 'Choose a backup folder first.')
  if (!existsSync(s.autoBackupFolder)) throw new AppError('backup.folder_missing', 'The backup folder can’t be found. Is the drive connected?')
  const file = await writeTransfer(join(s.autoBackupFolder, backupFileName()), 'backup')
  await prune(s.autoBackupFolder)
  return file
}

/** Synchronous automatic backup for lock/quit. Returns null when backups are off or the folder is missing. */
export function runAutoBackupSync(): string | null {
  const folder = autoFolder()
  if (!folder) return null
  const file = writeTransferSync(join(folder, backupFileName()), 'backup')
  void prune(folder)
  return file
}

async function listBackups(folder: string): Promise<{ name: string; time: number; size: number }[]> {
  const names = (await readdir(folder)).filter((n) => AUTO_FILE.test(n))
  const list = await Promise.all(
    names.map(async (name) => {
      const st = await stat(join(folder, name))
      return { name, time: timeFromName(name) ?? st.mtimeMs, size: st.size }
    })
  )
  return list.sort((a, b) => b.time - a.time)
}

/** Thins out automatic backups by tier. Only touches files Kasboek named. */
async function prune(folder: string): Promise<void> {
  const { remove } = planRetention(await listBackups(folder))
  for (const name of remove) await rm(join(folder, name), { force: true })
}

export async function backupList(): Promise<BackupEntryInfo[]> {
  const s = getSettings(db())
  if (!s.autoBackupFolder || !existsSync(s.autoBackupFolder)) return []
  const list = await listBackups(s.autoBackupFolder)
  const { keep } = planRetention(list)
  return list.map((b) => ({ name: b.name, createdAt: new Date(b.time).toISOString(), size: b.size, tier: (keep.get(b.name) ?? 'recent') as Tier }))
}

/** Prepares one backup from the folder for Import (the page never sends a path). */
export async function pickBackup(name: string): Promise<PickedTransfer> {
  const s = getSettings(db())
  if (!AUTO_FILE.test(name) || !s.autoBackupFolder) throw new AppError('backup.not_found', 'That backup can’t be found.')
  const file = join(s.autoBackupFolder, name)
  if (!existsSync(file) || !statSync(file).isFile()) throw new AppError('backup.not_found', 'That backup can’t be found.')
  return describeTransfer(file)
}

/* ---------- Import ---------- */

// The renderer never sends a file path; it gets a token for a file the user picked.
const picked = new Map<string, string>()

export async function describeTransfer(file: string): Promise<PickedTransfer> {
  const h = readTransferHeader(await readFile(file))
  const token = randomUUID()
  picked.set(token, file)
  return {
    token,
    fileName: basename(file),
    kind: h.kind,
    createdAt: h.createdAt,
    appVersion: h.appVersion,
    mode: h.mode,
    twoFactor: h.twoFactor,
    hasPassword: !!h.slots.password,
    needsNewPassword: h.mode === 'device' && !(await canUseDeviceMode())
  }
}

/** The import failed after the old files were set aside: remove what the import wrote and bring the old files back. */
async function putBack(name: string): Promise<void> {
  try {
    closeForReplace()
    await rm(paths.accountFile, { force: true })
    await rm(paths.dbFile, { force: true })
    await removeAccountSideFiles(true)
    await restoreErased(paths, name)
  } catch (err) {
    startupLog(`import failed and the old data could not be put back from erased/${name}: ${err instanceof Error ? err.message : String(err)}`)
  }
  await initSession().catch(() => undefined)
}

export async function importTransfer(input: {
  token: string
  password?: string
  code?: string
  recoveryKey?: string
  newPassword?: string
}, opts: { joining?: boolean } = {}): Promise<ImportReset[]> {
  const file = picked.get(input.token)
  if (!file) throw new AppError('transfer.expired', 'Choose the file again.')
  const contents = await openTransfer(
    await readFile(file),
    input.recoveryKey ? { recoveryKey: input.recoveryKey } : { password: input.password ?? '', code: input.code }
  )
  const { header, master, vault, dbFile, usedRecovery } = contents
  if (header.schemaVersion > MIGRATIONS.length) {
    throw new AppError('transfer.too_new', 'This file was made by a newer version of Kasboek. Update the app first.')
  }

  // Check the database inside before touching anything. The file may come from anywhere: its AI address, permissions,
  // backup folder, assistant memory and API keys are dropped here, on the staged copy, so a failure leaves everything as it was.
  const staged = join(paths.dataDir, `import-${randomUUID()}.db`)
  await writeFile(staged, dbFile, { mode: 0o600 })
  let reset: ImportReset[]
  try {
    const check = openDatabase(staged, vault.dbKey, { migrate: false })
    try {
      if (!integrityOk(check)) throw new AppError('transfer.corrupt', 'The data inside this file is damaged.')
      reset = resetImportedSettings(check, { keepSyncKey: opts.joining, assistantOff: isUnlocked() && !getSetting(db(), 'assistantEnabled') })
    } finally {
      check.close()
    }
  } catch (err) {
    await rm(staged, { force: true })
    throw err
  }

  // Build the account for this computer. The device seal is added when it's saved.
  let next: AccountData = {
    version: 2,
    mode: header.mode,
    createdAt: new Date().toISOString(),
    twoFactor: header.twoFactor,
    slots: { recovery: header.slots.recovery, ...(header.slots.password ? { password: header.slots.password } : {}) },
    vault: { iv: '', ct: '' },
    attempts: { failed: 0, lastFailedAt: null }
  }
  if (header.mode === 'device') {
    if (await canUseDeviceMode()) {
      next.slots.device = master.toString('base64')
    } else {
      if (!input.newPassword) {
        await rm(staged, { force: true })
        throw new AppError('transfer.needs_new_password', 'Windows Hello and Touch ID aren’t available here. Choose a password for this computer.')
      }
      next = { ...next, mode: 'password', slots: { ...next.slots, password: await makeSlot(master, input.newPassword, 'password') } }
    }
  }

  // Replacing data on this computer: keep a safety copy of what's here first.
  if (isUnlocked()) {
    mkdirSync(paths.safetyDir, { recursive: true })
    await writeTransfer(join(paths.safetyDir, `before-import-${stamp()}.${TRANSFER_EXTENSION}`), 'backup')
  }
  closeForReplace()
  // An account file that can't be opened: the old files go to erased/<time> first (as Erase does), so nothing is lost.
  // This is only reached once the imported file has opened and its database checked out.
  let aside: string | null = null
  if (accountUnreadable()) {
    try {
      aside = await quarantineData(paths, Date.now(), startupLog)
    } catch (err) {
      await rm(staged, { force: true })
      throw new AppError('auth.erase_failed', `Could not set the old data aside, so nothing was imported: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  try {
    await rename(staged, paths.dbFile)
    await adopt(next, master, vault, usedRecovery)
  } catch (err) {
    if (aside) await putBack(aside)
    throw err
  }
  picked.delete(input.token)
  // The staged database has sync off; the place file (URL, user name) and outbox next to it are stale now.
  if (!opts.joining && reset.includes('sync')) (await import('../sync/service')).removeSyncLeftovers()
  return reset
}
