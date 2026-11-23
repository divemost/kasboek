/**
 * Bank balances: the balance the bank showed on a day (end of that day), recorded by the person or
 * read from a CSV. An account's balance on any day follows from the nearest of these checkpoints
 * and the transactions in between, so the starting balance never has to be known, and importing
 * older or newer history later doesn't shift it. Checkpoints are stored as valuations, the same as
 * recorded values of investment accounts.
 */
import type { BankBalance, BankBalanceResult } from '@shared/types'
import type { Db } from './database'
import { AppError } from './errors'
import { setValuation } from './wealth'
import { localToday } from '@shared/month'

interface Checkpoint {
  date: string
  value: number
  note: string | null
}

function account(db: Db, id: number): { currency: string; opening: number; kind: string } {
  const a = db.prepare('SELECT currency, opening_balance_cents AS opening, kind FROM accounts WHERE id = ?').get(id) as { currency: string; opening: number; kind: string } | undefined
  if (!a) throw new AppError('accounts.not_found', 'Account not found.')
  return a
}

function checkpoints(db: Db, accountId: number): Checkpoint[] {
  return db.prepare('SELECT date, value_cents AS value, note FROM valuations WHERE account_id = ? ORDER BY date').all(accountId) as Checkpoint[]
}

/** Sum of the account's transactions after `after` up to and including `upTo` (either end open when null), in the account's currency. */
function txSum(db: Db, accountId: number, currency: string, after: string | null, upTo: string | null): number {
  const r = db
    .prepare(
      `SELECT coalesce(sum(coalesce(fx(amount_cents, currency, booking_date, ?), 0)), 0) AS s FROM transactions
       WHERE account_id = ? AND (? IS NULL OR booking_date > ?) AND (? IS NULL OR booking_date <= ?)`
    )
    .get(currency, accountId, after, after, upTo, upTo) as { s: number }
  return r.s
}

/**
 * The balance at the end of `date`: from the latest checkpoint on or before it, else back from the
 * first one after it, else the opening balance plus everything up to that day.
 */
export function balanceOn(db: Db, accountId: number, date: string, opts: { ignoreDate?: string } = {}): { cents: number; basis: Checkpoint | null } {
  const a = account(db, accountId)
  const cps = checkpoints(db, accountId).filter((c) => c.date !== opts.ignoreDate)
  const prev = cps.filter((c) => c.date <= date).at(-1)
  if (prev) return { cents: prev.value + txSum(db, accountId, a.currency, prev.date, date), basis: prev }
  const next = cps.find((c) => c.date > date)
  if (next) return { cents: next.value - txSum(db, accountId, a.currency, date, next.date), basis: next }
  return { cents: a.opening + txSum(db, accountId, a.currency, null, date), basis: null }
}

/** The balance now: the latest checkpoint plus every transaction after it (also ones dated later). */
export function currentBalance(db: Db, accountId: number): number {
  const a = account(db, accountId)
  const last = checkpoints(db, accountId).at(-1)
  return last ? last.value + txSum(db, accountId, a.currency, last.date, null) : a.opening + txSum(db, accountId, a.currency, null, null)
}

/**
 * Records what the bank showed on a day and compares it with what Kasboek expected from the other
 * checkpoints, so a missing or doubled transaction shows up as a difference.
 */
export function setBankBalance(db: Db, input: { accountId: number; date: string; balanceCents: number; note?: string | null }, today = localToday()): BankBalanceResult {
  const a = account(db, input.accountId)
  if (a.kind === 'investment') throw new AppError('balance.investment', 'An investment account has a value, not a bank balance: record it as a value (valuations.set, or Set value on the Accounts page).')
  if (input.date > today) throw new AppError('balance.future', 'Enter the balance of today or an earlier day.')
  const others = checkpoints(db, input.accountId).filter((c) => c.date !== input.date)
  let expectedCents: number | null = null
  if (others.length || a.opening !== 0) expectedCents = balanceOn(db, input.accountId, input.date, { ignoreDate: input.date }).cents
  setValuation(db, { accountId: input.accountId, date: input.date, valueCents: input.balanceCents, note: input.note ?? null })
  return {
    date: input.date,
    balanceCents: input.balanceCents,
    expectedCents,
    differenceCents: expectedCents === null ? null : input.balanceCents - expectedCents
  }
}

/** The recorded balances, newest first, each compared with the one before it. */
export function listBankBalances(db: Db, accountId: number): BankBalance[] {
  const a = account(db, accountId)
  const cps = checkpoints(db, accountId)
  return cps
    .map((c, i) => {
      const prev = cps[i - 1]
      const expected = prev ? prev.value + txSum(db, accountId, a.currency, prev.date, c.date) : null
      return {
        date: c.date,
        balanceCents: c.value,
        note: c.note,
        expectedCents: expected,
        differenceCents: expected === null || a.kind === 'investment' ? null : c.value - expected,
        since: prev?.date ?? null
      }
    })
    .reverse()
}
