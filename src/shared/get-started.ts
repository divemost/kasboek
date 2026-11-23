/** When the Overview shows the get-started screen, and when an import or a new transaction is the very first one. */

/**
 * The part of an account these rules read. Archived accounts are in the list too: their transactions count.
 * `lastBankBalance` is set once a balance or an investment value was recorded for the account.
 */
export interface CountedAccount {
  transactionCount: number
  lastBankBalance?: unknown
}

export type OverviewScreen = 'loading' | 'start' | 'overview'

/** True when at least one account holds a transaction. */
export const hasTransactions = (accounts: readonly CountedAccount[]): boolean => accounts.some((a) => a.transactionCount > 0)

/** True when there is anything to show: a transaction, or a recorded balance or value (an investment account may only have values). */
export const hasData = (accounts: readonly CountedAccount[]): boolean => hasTransactions(accounts) || accounts.some((a) => a.lastBankBalance != null)

/**
 * Which Overview to show. The get-started screen needs the account list to have loaded and no transaction, balance or value anywhere;
 * when the list can't be read the normal Overview is shown rather than a screen that may be wrong.
 */
export function overviewScreen(accounts: readonly CountedAccount[] | null, failed: boolean): OverviewScreen {
  if (failed) return 'overview'
  if (!accounts) return 'loading'
  return hasData(accounts) ? 'overview' : 'start'
}

/** The first transaction ever (an import or one typed in): only known once the accounts are loaded. */
export const isFirstTransaction = (accounts: readonly CountedAccount[] | null): boolean => accounts !== null && !hasTransactions(accounts)

/** The month the Overview opens on after a first import: the newest one with transactions, which is the last day in that file. */
export function monthAfterFirstImport(lastDate: string | null, thisMonth: string): string {
  return lastDate && /^\d{4}-\d{2}/.test(lastDate) ? lastDate.slice(0, 7) : thisMonth
}

/** Which privacy line the get-started screen shows: plain when the assistant is off or unknown, else by where the assistant's model runs (company null = this computer or network). */
export function startPrivacyKey(assistantEnabled: boolean, assistant: { company: string | null } | null): 'overview.start.privacy' | 'assistant.privacyLocal' | 'overview.start.privacyCloud' {
  if (!assistantEnabled || !assistant) return 'overview.start.privacy'
  return assistant.company === null ? 'assistant.privacyLocal' : 'overview.start.privacyCloud'
}
