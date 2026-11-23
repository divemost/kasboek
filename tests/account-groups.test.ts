import { describe, expect, it } from 'vitest'
import { archivedOnly, groupAccounts, staysInGroup } from '@shared/account-groups'
import type { AccountKind } from '@shared/types'

const groups: { key: string; kinds: AccountKind[] }[] = [
  { key: 'everyday', kinds: ['current', 'cash', 'other'] },
  { key: 'savings', kinds: ['savings'] },
  { key: 'debts', kinds: ['credit_card', 'loan'] }
]
const a = (kind: AccountKind, valueCents: number, archived = false) => ({ kind, valueCents, archived })

describe('Accounts page groups', () => {
  it('keeps an archived account with a value in its group, so the sums reconcile with net worth', () => {
    const all = [a('current', 1000), a('current', 500, true), a('savings', -200, true)]
    const grouped = groupAccounts(all, groups)
    expect(grouped.map((g) => g.group.key)).toEqual(['everyday', 'savings'])
    expect(grouped[0]!.accounts.reduce((s, x) => s + x.valueCents, 0)).toBe(1500)
    expect(grouped.flatMap((g) => g.accounts).reduce((s, x) => s + x.valueCents, 0)).toBe(1300)
  })
  it('lists an archived account without a value only in the archived list', () => {
    const empty = a('current', 0, true)
    expect(staysInGroup(empty)).toBe(false)
    expect(groupAccounts([empty], groups)).toEqual([])
    expect(archivedOnly([empty, a('current', 5, true), a('current', 0)])).toEqual([empty])
  })
  it('leaves out groups without accounts', () => {
    expect(groupAccounts([a('loan', -900)], groups).map((g) => g.group.key)).toEqual(['debts'])
  })
})
