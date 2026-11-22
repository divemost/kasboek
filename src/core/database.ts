import Database from 'better-sqlite3-multiple-ciphers'
import { scrubAuditLog } from './audit'
import { AppError } from './errors'
import { installFx } from './fx'
import { migrate } from './migrations'

export type Db = Database.Database

const KEY_HEX = /^[0-9a-f]{64}$/

/** Applies the cipher settings and key. Must run before any other statement. */
function unlock(db: Db, keyHex: string): void {
  if (!KEY_HEX.test(keyHex)) throw new AppError('db.bad_key', 'Database key must be 32 bytes of hex.')
  // ChaCha20-Poly1305: authenticated encryption, so tampering is detected.
  db.pragma(`cipher='chacha20'`)
  db.pragma(`hexkey='${keyHex}'`)
}

/**
 * Opens (or creates) the encrypted database and brings the schema up to date.
 * Throws `db.locked` if the key is wrong or the file is not a Kasboek database.
 */
export function openDatabase(file: string, keyHex: string, opts: { migrate?: boolean } = {}): Db {
  const db = new Database(file)
  try {
    unlock(db, keyHex)
    // Reading the schema is the first real access; it fails if the key is wrong.
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch (err) {
    db.close()
    if (err instanceof AppError) throw err
    throw new AppError('db.locked', 'The database could not be unlocked. The key does not match this file.')
  }
  db.pragma('foreign_keys = ON')
  db.pragma('secure_delete = ON')
  db.pragma('journal_mode = DELETE')
  try {
    if (opts.migrate !== false) {
      migrate(db)
      scrubAuditLog(db)
    }
    installFx(db)
  } catch (err) {
    // A handle left open would keep the file locked (on Windows it cannot even be deleted).
    db.close()
    throw err
  }
  return db
}

/**
 * A consistent, still-encrypted copy of the live database (same cipher, same key).
 * Nothing is written to disk unencrypted.
 */
export function snapshotEncrypted(db: Db, targetFile: string): void {
  db.prepare('VACUUM INTO ?').run(targetFile)
}

export function integrityOk(db: Db): boolean {
  const rows = db.pragma('quick_check') as { quick_check: string }[]
  return rows.length === 1 && rows[0]?.quick_check === 'ok'
}
