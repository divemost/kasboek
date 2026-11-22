import { resolve } from 'node:path'
import { expect, vi } from 'vitest'

// Applied to every test file. vi.mock factories run again after vi.resetModules(), so a fresh module never loses these.
const testPath = expect.getState().testPath ?? ''
const realKdf = resolve(testPath) === resolve(__dirname, 'crypto-kdf.test.ts')

// Real Argon2id (128 MiB, 3 passes) takes seconds on a busy CI machine; crypto-kdf.test.ts keeps the real cost honest.
vi.mock('@core/crypto', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@core/crypto')>()
  if (!realKdf) mod.setPasswordKdfForTests({ m: 1024, t: 1, p: 1 })
  return mod
})

// Test databases are throwaway: skip fsync (the default synchronous=FULL makes every migration and insert wait for the
// disk, which is very slow on Windows runners). Production defaults are untouched; pragmas are set before migrating.
vi.mock('@core/database', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@core/database')>()
  const { migrate } = await import('@core/migrations')
  const { scrubAuditLog } = await import('@core/audit')
  return {
    ...mod,
    openDatabase(file: string, keyHex: string, opts: { migrate?: boolean } = {}) {
      const db = mod.openDatabase(file, keyHex, { ...opts, migrate: false })
      db.pragma('synchronous = OFF')
      db.pragma('temp_store = MEMORY')
      if (opts.migrate !== false) {
        try {
          migrate(db)
          scrubAuditLog(db)
        } catch (err) {
          db.close()
          throw err
        }
      }
      return db
    }
  }
})
