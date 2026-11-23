import { z } from 'zod'
import { contract, type OpName, type OpOutput, type OpParsedInput, type OpResult } from '@shared/contract'
import type { Account, AccountWithBalance, Actor, Category, FxStatus, ImportPreview } from '@shared/types'
import type { Db } from './database'
import { auditDetails } from './audit'
import { AppError } from './errors'
import { getSettings, updateSettings } from './settings'
import * as fin from './finance'
import * as imp from './import'
import { openXmlSession } from './camt/open'
import * as fx from './fx'
import * as wealth from './wealth'
import { listBankBalances, setBankBalance } from './balance'
import { findTransfers, pairTransfers, setTransferCost, transferCostInfo, unpairTransfer } from './transfers'
import { findRecurring, setRecurringHidden } from './recurring'
import { monthReview } from './review'
import { listAlerts } from './alerts'
import { giveFeedback, insightsView, restoreDismissed } from './insights'
import { createGoal, deleteGoal, listGoals, updateGoal } from './goals'
import { forget, forgetAll, memoryState, remember, setMemoryEnabled, updateMemory } from './memory'

export function fxStatus(db: Db): FxStatus {
  const s = getSettings(db)
  return { main: s.currency, currencies: fx.currencyInfo(db, s.currency), lastEcbUpdateAt: s.fxLastEcbUpdateAt, autoUpdate: s.fxAutoUpdate }
}

export interface OpContext {
  db: Db
  actor: Actor
}

export interface OpDef<K extends OpName> {
  handler: (ctx: OpContext, input: OpParsedInput<K>) => OpOutput<K> | Promise<OpOutput<K>>
  /** Writes to the database. Mutating calls are recorded in the audit log. */
  mutates: boolean
  /** Offered to Claude as a tool (Phase 4). Desktop-only actions like file dialogs are not. */
  assistant: boolean
}

export type OpTable = { [K in OpName]?: OpDef<K> }

interface AccountRow {
  id: number
  name: string
  bank: string
  iban: string | null
  currency: string
  kind: Account['kind']
  opening_balance_cents: number
  archived: number
  created_at: string
  fx_cost_pct: number | null
}

interface CategoryRow {
  id: number
  name: string
  kind: Category['kind']
  parent_id: number | null
  color: string | null
  sort_order: number
  archived: number
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  bank: r.bank,
  iban: r.iban,
  currency: r.currency,
  kind: r.kind,
  openingBalanceCents: r.opening_balance_cents,
  archived: r.archived === 1,
  createdAt: r.created_at,
  fxCostPct: r.fx_cost_pct ?? null
})

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  parentId: r.parent_id,
  color: r.color,
  sortOrder: r.sort_order,
  archived: r.archived === 1
})

/** Removes spaces and upper-cases an IBAN, e.g. `be68 5390 0754 7034` → `BE68539007547034`. */
export function normalizeIban(iban: string | null | undefined): string | null {
  if (!iban) return null
  const v = iban.replace(/\s+/g, '').toUpperCase()
  return v.length ? v : null
}

export const coreOps: OpTable = {
  'settings.get': {
    mutates: false,
    assistant: true,
    handler: ({ db }) => getSettings(db)
  },
  'settings.update': {
    mutates: true,
    assistant: false,
    handler: ({ db }, patch) => updateSettings(db, patch)
  },
  'networth.summary': { mutates: false, assistant: true, handler: ({ db }, input) => wealth.netWorth(db, input) },
  'valuations.list': { mutates: false, assistant: true, handler: ({ db }, input) => wealth.listValuations(db, input.accountId) },
  'valuations.set': {
    mutates: true,
    assistant: true,
    handler: ({ db }, input) => {
      // A value is the market value of an investment; for a bank account it is the bank balance.
      const kind = (db.prepare('SELECT kind FROM accounts WHERE id = ?').get(input.accountId) as { kind: string } | undefined)?.kind
      if (kind && kind !== 'investment')
        throw new AppError('valuations.bank_account', 'For a bank account, record the balance the bank shows instead (balances.set, or Bank balance on the Accounts page).')
      return wealth.setValuation(db, input)
    }
  },
  'valuations.delete': { mutates: true, assistant: false, handler: ({ db }, input) => wealth.deleteValuation(db, input) },
  'summary.year': { mutates: false, assistant: true, handler: ({ db }, input) => wealth.yearSummary(db, input.year) },
  'fx.status': { mutates: false, assistant: true, handler: ({ db }) => fxStatus(db) },
  'fx.rates': { mutates: false, assistant: true, handler: ({ db }, input) => fx.listManualRates(db, input.currency) },
  'fx.setRate': {
    mutates: true,
    assistant: true,
    handler: ({ db }, input) => {
      fx.setManualRate(db, input)
      return fxStatus(db)
    }
  },
  'fx.deleteRate': {
    mutates: true,
    assistant: false,
    handler: ({ db }, input) => {
      fx.deleteManualRate(db, input)
      return fxStatus(db)
    }
  },
  'accounts.list': {
    mutates: false,
    assistant: true,
    handler: ({ db }): AccountWithBalance[] => {
      const bal = fin.accountBalances(db)
      // The latest recorded bank balance, and whether it matches what Kasboek counted.
      const last = new Map(
        (db.prepare('SELECT DISTINCT account_id AS id FROM valuations').all() as { id: number }[]).map(({ id }) => {
          const b = listBankBalances(db, id)[0]!
          return [id, { date: b.date, balanceCents: b.balanceCents, differenceCents: b.differenceCents }]
        })
      )
      return (db.prepare('SELECT * FROM accounts ORDER BY archived, name').all() as AccountRow[]).map((r) => ({
        ...toAccount(r),
        balanceCents: bal.get(r.id)?.balance ?? r.opening_balance_cents,
        balanceMainCents: bal.get(r.id)?.balanceMain ?? null,
        transactionCount: bal.get(r.id)?.count ?? 0,
        lastBankBalance: last.get(r.id) ?? null
      }))
    }
  },
  'accounts.update': {
    mutates: true,
    assistant: false,
    handler: ({ db }, input) => {
      const cur = db.prepare('SELECT * FROM accounts WHERE id = ?').get(input.id) as AccountRow | undefined
      if (!cur) throw new AppError('accounts.not_found', 'Account not found.')
      db.transaction(() => {
        db.prepare('UPDATE accounts SET name = ?, bank = ?, iban = ?, currency = ?, kind = ?, archived = ?, fx_cost_pct = ? WHERE id = ?').run(
          input.name ?? cur.name,
          input.bank ?? cur.bank,
          input.iban !== undefined ? normalizeIban(input.iban) : cur.iban,
          input.currency ?? cur.currency,
          input.kind ?? cur.kind,
          input.archived !== undefined ? (input.archived ? 1 : 0) : cur.archived,
          input.fxCostPct !== undefined ? input.fxCostPct : cur.fx_cost_pct,
          input.id
        )
        // Changing the currency corrects it: amounts that were in the old one now count in the new one.
        if (input.currency && input.currency !== cur.currency)
          db.prepare('UPDATE transactions SET currency = ? WHERE account_id = ? AND currency = ?').run(input.currency, input.id, cur.currency)
      })()
      return toAccount(db.prepare('SELECT * FROM accounts WHERE id = ?').get(input.id) as AccountRow)
    }
  },
  'accounts.create': {
    mutates: true,
    assistant: true,
    handler: ({ db }, input) => {
      const iban = normalizeIban(input.iban)
      try {
        // Account and its first bank balance together: a refused balance leaves no account behind.
        return db.transaction(() => {
          const row = db
            .prepare(
              `INSERT INTO accounts (name, bank, iban, currency, kind, opening_balance_cents, fx_cost_pct)
               VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
            )
            .get(input.name, input.bank, iban, input.currency, input.kind, input.openingBalanceCents, input.fxCostPct ?? null) as AccountRow
          // The balance the bank shows now: the starting point for the balance from here on.
          if (input.bankBalance && input.kind === 'investment') wealth.setValuation(db, { accountId: row.id, date: input.bankBalance.date, valueCents: input.bankBalance.cents })
          else if (input.bankBalance) setBankBalance(db, { accountId: row.id, date: input.bankBalance.date, balanceCents: input.bankBalance.cents })
          return toAccount(row)
        })()
      } catch (err) {
        if (err instanceof Error && /UNIQUE/.test(err.message)) {
          throw new AppError('accounts.duplicate_iban', 'An account with this IBAN already exists.')
        }
        throw err
      }
    }
  },
  'balances.list': { mutates: false, assistant: true, handler: ({ db }, { accountId }) => listBankBalances(db, accountId) },
  'balances.set': { mutates: true, assistant: true, handler: ({ db }, input) => setBankBalance(db, input) },
  'categories.list': { mutates: false, assistant: true, handler: ({ db }) => listCategories(db) },
  'categories.create': {
    mutates: true,
    assistant: true,
    handler: ({ db }, input) => {
      fin.createCategory(db, input)
      return listCategories(db)
    }
  },
  'categories.update': {
    mutates: true,
    assistant: false,
    handler: ({ db }, input) => {
      fin.updateCategory(db, input)
      return listCategories(db)
    }
  },

  'transactions.list': { mutates: false, assistant: true, handler: ({ db }, f) => fin.listTransactions(db, f) },
  'transactions.create': { mutates: true, assistant: false, handler: ({ db }, t) => fin.createTransaction(db, t) },
  'transactions.update': { mutates: true, assistant: false, handler: ({ db }, t) => fin.updateTransaction(db, t) },
  'transactions.edit': { mutates: true, assistant: true, handler: ({ db }, t) => fin.updateTransaction(db, t) },
  'transactions.splits': { mutates: false, assistant: true, handler: ({ db }, { id }) => fin.listSplits(db, id) },
  'transactions.split': { mutates: true, assistant: true, handler: ({ db }, { id, parts }) => fin.setSplits(db, id, parts) },
  'transactions.rename': { mutates: true, assistant: true, handler: ({ db }, i) => fin.renameTransactions(db, i.ids, i.counterpartyName) },
  'searches.save': {
    mutates: true,
    assistant: false,
    handler: ({ db }, { name, filter }) => {
      // Saving under an existing name replaces it; the newest first.
      const list = getSettings(db).savedSearches.filter((s) => s.name !== name)
      return updateSettings(db, { savedSearches: [{ name, filter }, ...list].slice(0, 30) }).savedSearches
    }
  },
  'searches.delete': {
    mutates: true,
    assistant: false,
    handler: ({ db }, { name }) => updateSettings(db, { savedSearches: getSettings(db).savedSearches.filter((s) => s.name !== name) }).savedSearches
  },
  'transactions.categorize': { mutates: true, assistant: true, handler: ({ db }, i) => fin.categorizeTransactions(db, i.ids, i.categoryId) },
  'transactions.delete': { mutates: true, assistant: false, handler: ({ db }, i) => fin.deleteTransactions(db, i.ids) },

  'goals.list': { mutates: false, assistant: true, handler: ({ db }) => listGoals(db) },
  'goals.create': { mutates: true, assistant: true, handler: ({ db }, g) => createGoal(db, g) },
  'goals.update': { mutates: true, assistant: false, handler: ({ db }, g) => updateGoal(db, g) },
  'goals.delete': { mutates: true, assistant: false, handler: ({ db }, { id }) => deleteGoal(db, id) },
  'memory.list': { mutates: false, assistant: false, handler: ({ db }) => memoryState(db) },
  'memory.remember': { mutates: true, assistant: true, handler: ({ db }, { text }) => remember(db, text, 'assistant') },
  'memory.add': { mutates: true, assistant: false, handler: ({ db }, { text }) => remember(db, text, 'person') },
  'memory.update': { mutates: true, assistant: false, handler: ({ db }, { id, text }) => updateMemory(db, id, text) },
  'memory.forget': { mutates: true, assistant: true, handler: ({ db }, { ids }) => forget(db, ids) },
  'memory.forgetAll': { mutates: true, assistant: false, handler: ({ db }) => forgetAll(db) },
  'memory.setEnabled': { mutates: true, assistant: false, handler: ({ db }, { enabled }) => setMemoryEnabled(db, enabled) },
  'alerts.list': { mutates: false, assistant: true, handler: ({ db }) => listAlerts(db) },
  'summary.review': { mutates: false, assistant: true, handler: ({ db }, { month }) => monthReview(db, month) },
  // Tips for the Overview: found locally, never offered to the assistant; feedback stays on this computer.
  // The desktop app replaces insights.get with one that also knows the interface language; preview, run and cancel are desktop operations.
  'insights.get': { mutates: false, assistant: false, handler: ({ db }, { month }) => insightsView(db, month, null) },
  'insights.feedback': { mutates: true, assistant: false, handler: ({ db }, { key, verdict }) => giveFeedback(db, key, verdict) },
  'insights.restoreDismissed': { mutates: true, assistant: false, handler: ({ db }) => restoreDismissed(db) },
  'recurring.list': { mutates: false, assistant: true, handler: ({ db }) => findRecurring(db) },
  'recurring.hide': { mutates: true, assistant: true, handler: ({ db }, { key, hidden }) => setRecurringHidden(db, key, hidden) },
  'transfers.find': { mutates: false, assistant: true, handler: ({ db }) => findTransfers(db) },
  'transfers.pair': { mutates: true, assistant: true, handler: ({ db }, { pairs }) => pairTransfers(db, pairs) },
  'transfers.cost': { mutates: false, assistant: false, handler: ({ db }, { id }) => transferCostInfo(db, id) },
  'transfers.setCost': { mutates: true, assistant: true, handler: ({ db }, { id, costCents }) => setTransferCost(db, id, costCents) },
  'transfers.unpair': {
    mutates: true,
    assistant: false,
    handler: ({ db }, { id }) => {
      unpairTransfer(db, id)
      return { ok: true as const }
    }
  },
  'rules.list': { mutates: false, assistant: true, handler: ({ db }) => fin.listRules(db) },
  'rules.create': {
    mutates: true,
    assistant: true,
    handler: ({ db, actor }, { fromTransactionId, pattern, ...i }) => {
      const p = fin.rulePattern(db, { field: i.field, pattern, fromTransactionId }, actor === 'assistant')
      if (p === undefined) throw new AppError('rules.pattern', 'Give the text the rule looks for (pattern).')
      return fin.createRule(db, { ...i, pattern: p })
    }
  },
  'rules.preview': {
    mutates: false,
    assistant: true,
    handler: ({ db, actor }, { fromTransactionId, pattern, ...i }) => {
      const p = fin.rulePattern(db, { field: i.field, pattern, fromTransactionId }, actor === 'assistant')
      if (p === undefined) throw new AppError('rules.pattern', 'Give the text the rule looks for (pattern).')
      return fin.previewRule(db, { ...i, pattern: p })
    }
  },
  'rules.update': {
    mutates: true,
    assistant: true,
    handler: ({ db, actor }, { fromTransactionId, pattern, ...i }) => {
      const old = fin.listRules(db).find((r) => r.id === i.id)
      const field = i.field ?? old?.field
      // The assistant can't see the stored account number: moving the rule to another field without a new text would keep it as that text.
      if (actor === 'assistant' && old?.field === 'iban' && field !== 'iban' && pattern === undefined)
        throw new AppError('rules.iban_field', 'This rule looks for an account number, which is hidden from you. To change where it looks, also give the new text (pattern).')
      return fin.updateRule(db, { ...i, pattern: fin.rulePattern(db, { field, pattern, fromTransactionId }, actor === 'assistant') })
    }
  },
  'rules.reorder': { mutates: true, assistant: false, handler: ({ db }, { ids }) => fin.reorderRules(db, ids) },
  'rules.delete': {
    mutates: true,
    assistant: true,
    handler: ({ db }, { id }) => {
      fin.deleteRule(db, id)
      return fin.listRules(db)
    }
  },

  'budgets.list': { mutates: false, assistant: true, handler: ({ db }, { month }) => fin.listBudgets(db, month) },
  'budgets.set': { mutates: true, assistant: true, handler: ({ db }, i) => fin.setBudget(db, i) },
  'budgets.copyPrevious': { mutates: true, assistant: false, handler: ({ db }, { month }) => fin.copyBudgets(db, month) },

  'summary.month': { mutates: false, assistant: true, handler: ({ db }, { month }) => fin.monthSummary(db, month) },

  'import.analyze': {
    mutates: false,
    assistant: false,
    handler: ({ db }, i) => imp.analyze(db, { fileName: i.fileName, accountId: i.accountId, bytes: new Uint8Array(Buffer.from(i.contentBase64, 'base64')) })
  },
  'import.analyzeXml': {
    mutates: false,
    assistant: false,
    handler: ({ db }, i) => openXmlSession(db, { fileName: i.fileName, accountId: i.accountId, bytes: new Uint8Array(Buffer.from(i.contentBase64, 'base64')) })
  },
  'import.preview': { mutates: false, assistant: false, handler: ({ db }, { sessionId }) => imp.preview(db, sessionId) },
  'import.current': {
    mutates: false,
    assistant: true,
    handler: ({ db, actor }) => {
      const id = imp.latestSession()
      return id ? forActor(actor, imp.preview(db, id)) : null
    }
  },
  'import.raw': { mutates: false, assistant: true, handler: (_c, { from, count }) => imp.rawWindow(openSession(), from, count) },
  'import.remap': { mutates: false, assistant: true, handler: ({ db, actor }, i) => forActor(actor, imp.remap(db, i.sessionId ?? openSession(), i.mapping, actor === 'assistant' ? 'assistant' : 'manual')) },
  'import.updateRows': {
    mutates: false,
    assistant: true,
    handler: ({ db, actor }, i) =>
      forActor(
        actor,
        imp.updateRows(
          db,
          i.sessionId ?? openSession(),
          i.changes.map((c) => ({ ...c, ...(c.categoryId !== undefined ? { categorySource: actor === 'assistant' ? ('assistant' as const) : ('user' as const) } : {}) }))
        )
      )
  },
  'import.commit': { mutates: true, assistant: true, handler: ({ db }, i) => imp.commit(db, i.sessionId ?? openSession(), i.saveProfile) },
  'import.checkApply': { mutates: true, assistant: false, handler: ({ db }, { sessionId, rules, existing }) => imp.applyCheckProposals(db, sessionId, { rules, existing }) },
  'import.checkUndo': { mutates: false, assistant: false, handler: ({ db }, { sessionId, part }) => imp.undoCheck(db, sessionId, part) },
  'import.discard': {
    mutates: false,
    assistant: false,
    handler: (_c, { sessionId }) => {
      imp.discard(sessionId)
      return { ok: true as const }
    }
  },
  'import.batches': { mutates: false, assistant: false, handler: ({ db }) => imp.listBatches(db) },
  'import.undo': { mutates: true, assistant: false, handler: ({ db }, { batchId }) => imp.undoBatch(db, batchId) }
}

/** An import preview as the caller may see it: the assistant gets nothing from above the header row found on opening. */
const forActor = (actor: OpContext['actor'], p: ImportPreview): ImportPreview => (actor === 'assistant' ? imp.assistantView(p) : p)

function openSession(): string {
  const id = imp.latestSession()
  if (!id) throw new AppError('import.none', 'No CSV import is open. Ask the person to choose a file on the Import page.')
  return id
}

function listCategories(db: Db): Category[] {
  return (db.prepare('SELECT * FROM categories ORDER BY kind, sort_order, name').all() as CategoryRow[]).map(toCategory)
}

/** Validates input against the contract, runs the operation and records changes. */
export async function runOp<K extends OpName>(
  table: OpTable,
  ctx: OpContext,
  name: K,
  rawInput: unknown
): Promise<OpResult<OpOutput<K>>> {
  const def = table[name] as OpDef<K> | undefined
  if (!def || !Object.hasOwn(contract, name)) {
    return { ok: false, error: { code: 'op.unknown', message: `Unknown operation: ${String(name)}` } }
  }
  const parsed = contract[name].input.safeParse(rawInput ?? {})
  if (!parsed.success) {
    return { ok: false, error: { code: 'op.invalid_input', message: z.prettifyError(parsed.error) } }
  }
  try {
    const data = await def.handler(ctx, parsed.data as OpParsedInput<K>)
    if (def.mutates) {
      try {
        ctx.db.prepare('INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)').run(ctx.actor, name, auditDetails(name, parsed.data))
      } catch (err) {
        // Locked (e.g. right after "erase"): nothing to log into.
        if (!(err instanceof AppError && err.code === 'auth.locked')) throw err
      }
    }
    return { ok: true, data }
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) } }
    console.error(`[op ${String(name)}]`, err)
    return { ok: false, error: { code: 'op.failed', message: 'Something went wrong. Details are in the log.' } }
  }
}
