import type { AccountKind } from './types'

/** The part of an account the Accounts page groups by. `valueCents` is what it is worth now, in its own currency. */
export interface GroupedAccount {
  kind: AccountKind
  archived: boolean
  valueCents: number
}

/**
 * An archived account with a value still counts in net worth, so it stays in its group (shown muted) and the group sums add up to the
 * total. One without a value only appears in the archived list.
 */
export const staysInGroup = (a: Pick<GroupedAccount, 'archived' | 'valueCents'>): boolean => !a.archived || a.valueCents !== 0

export function groupAccounts<T extends GroupedAccount, G extends { kinds: readonly AccountKind[] }>(accounts: readonly T[], groups: readonly G[]): { group: G; accounts: T[] }[] {
  return groups.map((group) => ({ group, accounts: accounts.filter((a) => group.kinds.includes(a.kind) && staysInGroup(a)) })).filter((g) => g.accounts.length > 0)
}

/** The archived accounts that are in no group: the ones without a value. */
export const archivedOnly = <T extends GroupedAccount>(accounts: readonly T[]): T[] => accounts.filter((a) => a.archived && !staysInGroup(a))
