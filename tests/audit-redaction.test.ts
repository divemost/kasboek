import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { auditDetails, isRedacted, scrubAuditLog } from '@core/audit'
import { openDatabase, snapshotEncrypted } from '@core/database'
import { coreOps, runOp } from '@core/ops'
import { contract } from '@shared/contract'

const KEY = 'sk-test-0123456789abcdefghijklmnop'

/** Names of input fields that can hold a secret or an account number. */
const SECRET_LIKE = /^(apiKey|password|newPassword|current|next|token|code|recoveryKey|secret|passphrase|iban|webdav)$/i

type Def = { type: string; shape?: Record<string, z.ZodType>; options?: z.ZodType[]; innerType?: z.ZodType; element?: z.ZodType; in?: z.ZodType }

/** Every field name that occurs anywhere in a schema, however deep. */
function fieldNames(schema: z.ZodType, seen = new Set<z.ZodType>()): string[] {
  if (seen.has(schema)) return []
  seen.add(schema)
  const def = (schema as unknown as { _zod: { def: Def } })._zod.def
  const inner = [def.innerType, def.element, def.in, ...(def.options ?? []), ...Object.values(def.shape ?? {})].filter((s): s is z.ZodType => !!s)
  return [...Object.keys(def.shape ?? {}), ...inner.flatMap((s) => fieldNames(s, seen))]
}

const fresh = () => ({ db: openDatabase(join(mkdtempSync(join(tmpdir(), 'kb-audit-')), 'k.db'), randomBytes(32).toString('hex')), actor: 'user' as const })

describe('audit log redaction', () => {
  it('blanks every operation whose input has a secret-like field', () => {
    const leaking = Object.entries(contract)
      .filter(([, def]) => fieldNames(def.input).some((f) => SECRET_LIKE.test(f)))
      .map(([name]) => name)
      .filter((name) => !isRedacted(name))
    expect(leaking).toEqual([])
  })

  it('keeps ordinary operations readable', () => {
    expect(auditDetails('categories.create', { name: 'Fun' })).toBe('{"name":"Fun"}')
    expect(auditDetails('assistant.setKey', { apiKey: KEY })).toBe('{}')
  })

  it('does not store a provider key in the audit log or in an export', async () => {
    const ctx = fresh()
    // The same table the real operation uses; the handler itself needs the desktop, so run its audit step the way runOp does.
    const table = { ...coreOps, 'assistant.setKey': { mutates: true, assistant: false, handler: async () => ({}) as never } }
    const r = await runOp(table as never, ctx, 'assistant.setKey', { apiKey: KEY, provider: 'mistral' })
    expect(r.ok).toBe(true)
    expect(ctx.db.prepare('SELECT action, details FROM audit_log').all()).toEqual([{ action: 'assistant.setKey', details: '{}' }])
    const file = join(mkdtempSync(join(tmpdir(), 'kb-audit-x-')), 'export.db')
    snapshotEncrypted(ctx.db, file)
    // The snapshot is encrypted anyway; check the rows rather than the bytes, and the bytes for good measure.
    expect(readFileSync(file).includes(KEY)).toBe(false)
    expect(JSON.stringify(ctx.db.prepare('SELECT * FROM audit_log').all())).not.toContain(KEY)
  })

  it('removes keys that older versions stored, and leaves other rows alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-audit-old-'))
    const file = join(dir, 'k.db')
    const key = randomBytes(32).toString('hex')
    const db = openDatabase(file, key)
    const add = db.prepare('INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)')
    add.run('user', 'assistant.setKey', JSON.stringify({ apiKey: KEY, provider: 'anthropic' }))
    add.run('user', 'sync.start', JSON.stringify({ webdav: { url: 'https://x.example', user: 'u', password: 'pw-test-1' } }))
    add.run('user', 'categories.create', JSON.stringify({ name: 'Fun', kind: 'expense' }))
    db.close()

    const reopened = openDatabase(file, key)
    expect(reopened.prepare('SELECT action, details FROM audit_log ORDER BY id').all()).toEqual([
      { action: 'assistant.setKey', details: '{}' },
      { action: 'sync.start', details: '{}' },
      { action: 'categories.create', details: '{"name":"Fun","kind":"expense"}' }
    ])
    scrubAuditLog(reopened)
    expect(reopened.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 3 })
  })

  it('opens the database anyway when the clean-up can’t write, and keeps the rows for the next unlock', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'kb-audit-busy-')), 'k.db')
    const key = randomBytes(32).toString('hex')
    const db = openDatabase(file, key)
    db.prepare('INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)').run('user', 'assistant.setKey', JSON.stringify({ apiKey: KEY }))
    // Stands in for a busy or read-only database: every update is refused.
    db.exec("CREATE TEMP TRIGGER refuse BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'database is locked'); END")
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => scrubAuditLog(db)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]!.join(' ')).not.toContain(file)
    db.exec('DROP TRIGGER refuse')
    scrubAuditLog(db)
    scrubAuditLog(db)
    expect(db.prepare('SELECT details FROM audit_log').all()).toEqual([{ details: '{}' }])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    db.close()
  })
})
