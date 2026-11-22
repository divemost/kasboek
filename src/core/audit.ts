import { contract } from '@shared/contract'
import type { Db } from './database'

/**
 * Operations whose input is never written to the audit log (only who did what, and when): passwords, recovery keys, codes, provider API keys,
 * sync (WebDAV) passwords, chat text, remembered facts, and account numbers (accounts, rules on an account number).
 */
const REDACTED = /^(auth|transfer|backup|prefs|insights|assistant|sync|memory|accounts|rules)\./

export const isRedacted = (action: string): boolean => REDACTED.test(action)

/** What the audit log stores for an operation. */
export function auditDetails(action: string, input: unknown): string {
  return isRedacted(action) ? '{}' : JSON.stringify(input)
}

/**
 * Empties the details that older versions stored for operations that are redacted now (the provider API key among them). Safe to repeat: once
 * the rows are empty it only reads the table. Deliberately not a schema migration. A busy or read-only database only skips the clean-up
 * (it is tried again at the next unlock): it never keeps the person out.
 */
export function scrubAuditLog(db: Db): void {
  try {
    const actions = Object.keys(contract).filter(isRedacted)
    const marks = actions.map(() => '?').join(', ')
    db.prepare(`UPDATE audit_log SET details = '{}' WHERE action IN (${marks}) AND details <> '{}'`).run(...actions)
  } catch (err) {
    console.warn('[db] could not clean the audit log:', (err as { code?: string } | undefined)?.code ?? 'unknown')
  }
}
