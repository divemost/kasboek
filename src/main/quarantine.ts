/**
 * "Erase" does not delete: the database, the account file and the safety copies are moved into
 * erased/<time>/ inside the data folder, and Kasboek starts fresh. Everything stays encrypted, so
 * nothing is exposed; the original password or recovery key brings it back (restoreErased). After
 * 30 days the whole entry, safety copies included, is removed for good. Kept free of Electron so it can be tested.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { AppError } from '@core/errors'
import { fsErrorText } from './fs-error'

export interface DataLayout {
  dataDir: string
  dbFile: string
  accountFile: string
  /** Phase 1 key file: without it the old database can't be opened, so it travels with the database. */
  legacyKeystoreFile: string
  safetyDir: string
}

export const QUARANTINE_DAYS = 30
const DAY = 24 * 60 * 60 * 1000
/** An entry is named after the time it was set aside; only such names are ever resolved. */
export const ENTRY = /^\d{10,}$/
const quarantineDir = (l: DataLayout): string => join(l.dataDir, 'erased')

/** The files that belong to one copy, by their name inside an entry. */
const parts = (l: DataLayout): { name: string; live: string }[] => [
  { name: 'account.json', live: l.accountFile },
  { name: 'kasboek.db', live: l.dbFile },
  { name: 'keystore.json', live: l.legacyKeystoreFile }
]

/**
 * Files that sit next to account.json and hold the same sealed secrets: the safety copy (.bak), a damaged one kept
 * after a recovery (.damaged-<time>) and leftovers of a write (.tmp). They are set aside and brought back with it.
 */
async function accountSideFiles(dir: string, accountFile: string): Promise<string[]> {
  const prefix = `${basename(accountFile)}.`
  try {
    return (await readdir(dir)).filter((n) => n.startsWith(prefix))
  } catch {
    return []
  }
}

/** Every entry folder under erased/, newest first, whatever it holds. */
async function entryNames(l: DataLayout): Promise<{ name: string; erasedAt: number }[]> {
  let names: string[]
  try {
    names = await readdir(quarantineDir(l))
  } catch {
    return []
  }
  return names
    .filter((n) => ENTRY.test(n))
    .map((name) => ({ name, erasedAt: Number(name) }))
    .sort((a, b) => b.erasedAt - a.erasedAt)
}

/** Data that can be opened again: a database together with its account file (or the old key file). Anything else is useless. */
function restorable(dir: string): boolean {
  return existsSync(join(dir, 'kasboek.db')) && (existsSync(join(dir, 'account.json')) || existsSync(join(dir, 'keystore.json')))
}

/** Quarantined copies that can be restored, newest first. Empty entry folders are removed on the way. */
export async function listErased(l: DataLayout): Promise<{ name: string; erasedAt: number }[]> {
  const found: { name: string; erasedAt: number }[] = []
  for (const e of await entryNames(l)) {
    const dir = join(quarantineDir(l), e.name)
    if (restorable(dir)) found.push(e)
    // rmdir only removes an empty folder.
    else await rmdir(dir).catch(() => undefined)
  }
  return found
}

/**
 * Moves the data aside. Returns the entry name, or null when there was nothing to move. All or nothing:
 * when a move fails, the ones already done are undone and the error is raised. Whatever can't be moved back is
 * reported to `log`. Two erases in the same millisecond get different entries.
 */
export async function quarantineData(l: DataLayout, now = Date.now(), log: (text: string) => void = () => undefined): Promise<string | null> {
  // The account goes first: if this stops half-way, Kasboek sees "no account" and keeps the old database aside, never pairs it with a new key.
  const items = parts(l)
    .filter((p) => existsSync(p.live))
    .map((p) => ({ from: p.live, name: p.name }))
  const sides = (await accountSideFiles(l.dataDir, l.accountFile)).map((name) => ({ from: join(l.dataDir, name), name }))
  items.splice(items.findIndex((i) => i.name === 'account.json') + 1, 0, ...sides)
  if (existsSync(l.safetyDir)) items.push({ from: l.safetyDir, name: 'safety-backups' })
  if (!items.length) return null

  let name = String(now)
  let dir = join(quarantineDir(l), name)
  const moved: { from: string; to: string }[] = []
  try {
    await mkdir(quarantineDir(l), { recursive: true })
    // Not recursive: an existing entry is never reused, the next free number is taken.
    for (;;) {
      try {
        await mkdir(dir)
        break
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        name = String(Number(name) + 1)
        dir = join(quarantineDir(l), name)
      }
    }
    for (const item of items) {
      const to = join(dir, item.name)
      await rename(item.from, to)
      moved.push({ from: item.from, to })
    }
  } catch (err) {
    for (const m of moved.reverse()) {
      await rename(m.to, m.from).catch((e: unknown) => log(`erase rollback: could not move ${basename(m.from)} back (${fsErrorText(e)}); it stays in erased/${basename(dirname(m.to))}`))
    }
    // Only empty folders are removed here: anything that could not be moved back stays in the entry.
    await rmdir(dir).catch(() => undefined)
    await rmdir(quarantineDir(l)).catch(() => undefined)
    throw err
  }
  return name
}

/** A name that is free in `dir`: the file's own, else prefixed with "restored-" (and a number if needed). */
function freeName(dir: string, file: string): string {
  let candidate = file
  for (let i = 0; existsSync(join(dir, candidate)); i++) candidate = `restored-${i ? `${i}-` : ''}${file}`
  return candidate
}

/** Brings one copy back. Only when no account exists here: it would replace it. */
export async function restoreErased(l: DataLayout, name: string): Promise<void> {
  if (existsSync(l.accountFile)) throw new AppError('auth.restore_blocked', 'Kasboek is already set up. Restoring erased data is only possible on the first screen.')
  // The name decides which folder is read: only a plain timestamp, only directly under erased/.
  const dir = join(quarantineDir(l), name)
  if (!ENTRY.test(name) || !existsSync(dir)) throw new AppError('auth.nothing_erased', 'There is no erased data to restore.')
  // Without its database, or without an account or key file for it, there is nothing that can be opened.
  if (!restorable(dir)) throw new AppError('auth.nothing_erased', 'This erased copy is incomplete and can’t be restored.')
  const stamp = Date.now()
  // The safety copies first: if this fails, no account is back yet and the copy stays whole enough to try again.
  const safety = join(dir, 'safety-backups')
  if (existsSync(safety)) {
    await mkdir(l.safetyDir, { recursive: true })
    for (const f of await readdir(safety)) await rename(join(safety, f), join(l.safetyDir, freeName(l.safetyDir, f)))
  }
  // Files that are here without an account can't be opened by anyone: keep them aside, as setup does. Never overwrite them.
  if (existsSync(l.dbFile) && existsSync(join(dir, 'kasboek.db'))) await rename(l.dbFile, `${l.dbFile}.orphaned-${stamp}`)
  if (existsSync(l.legacyKeystoreFile) && existsSync(join(dir, 'keystore.json'))) await rename(l.legacyKeystoreFile, `${l.legacyKeystoreFile}.orphaned-${stamp}`)
  // The account comes back last: an account without its database would start an empty one.
  for (const p of [...parts(l)].reverse()) {
    if (existsSync(join(dir, p.name))) await rename(join(dir, p.name), p.live)
  }
  // The copies that belong to the account (.bak, .damaged-*): only where nothing of that name is here now.
  for (const name of await accountSideFiles(dir, l.accountFile)) {
    if (!existsSync(join(l.dataDir, name))) await rename(join(dir, name), join(l.dataDir, name))
  }
  await rm(dir, { recursive: true, force: true })
}

/** Removes copies older than 30 days, whole: database, account and safety copies. */
export async function purgeErased(l: DataLayout, opts: { now?: number } = {}): Promise<number> {
  const now = opts.now ?? Date.now()
  let removed = 0
  for (const e of await entryNames(l)) {
    if (now - e.erasedAt < QUARANTINE_DAYS * DAY) continue
    await rm(join(quarantineDir(l), e.name), { recursive: true, force: true })
    removed++
  }
  return removed
}
