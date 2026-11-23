import { describe, expect, it } from 'vitest'
import { latestDate } from '@shared/month'
import { startPrivacyKey, hasData, hasTransactions, isFirstTransaction, monthAfterFirstImport, overviewScreen } from '@shared/get-started'

const acc = (transactionCount: number) => ({ transactionCount })

describe('overview screen', () => {
  it('waits for the account list', () => {
    expect(overviewScreen(null, false)).toBe('loading')
  })
  it('shows the normal overview when the account list failed', () => {
    expect(overviewScreen(null, true)).toBe('overview')
    expect(overviewScreen([], true)).toBe('overview')
  })
  it('starts with the get-started screen when there is no account or no transaction', () => {
    expect(overviewScreen([], false)).toBe('start')
    expect(overviewScreen([acc(0), acc(0)], false)).toBe('start')
  })
  it('shows the overview for an account that only has a recorded balance or value', () => {
    const valued = { transactionCount: 0, lastBankBalance: { date: '2026-01-31', balanceCents: 100000, differenceCents: null } }
    expect(overviewScreen([valued], false)).toBe('overview')
    expect(overviewScreen([{ transactionCount: 0, lastBankBalance: null }], false)).toBe('start')
    expect(hasData([valued])).toBe(true)
    // It is still not a transaction: the first one added is "the first".
    expect(isFirstTransaction([valued])).toBe(true)
  })
  it('counts transactions in any account, archived ones included', () => {
    expect(overviewScreen([acc(0), acc(3)], false)).toBe('overview')
    expect(hasTransactions([acc(0)])).toBe(false)
  })
})

describe('first transaction', () => {
  it('is only known once the accounts are loaded', () => {
    expect(isFirstTransaction(null)).toBe(false)
  })
  it('is the first when no account holds a transaction yet', () => {
    expect(isFirstTransaction([])).toBe(true)
    expect(isFirstTransaction([acc(0)])).toBe(true)
    expect(isFirstTransaction([acc(0), acc(1)])).toBe(false)
  })
})

describe('month after the first import', () => {
  it('is the month of the last day in the file', () => {
    expect(monthAfterFirstImport('2025-11-30', '2026-11')).toBe('2025-11')
  })
  it('falls back to this month', () => {
    expect(monthAfterFirstImport(null, '2026-11')).toBe('2026-11')
    expect(monthAfterFirstImport('', '2026-11')).toBe('2026-11')
  })
  it('falls back to this month for a malformed date', () => {
    expect(monthAfterFirstImport('30/11/2025', '2026-11')).toBe('2026-11')
    expect(monthAfterFirstImport('2025-1', '2026-11')).toBe('2026-11')
  })
})

describe('last date of an import', () => {
  it('is the newest date whatever the order of the rows', () => {
    expect(latestDate(['2025-03-02', '2025-11-30', '2025-01-15'])).toBe('2025-11-30')
    expect(latestDate(['2025-11-30', '2025-03-02'])).toBe('2025-11-30')
  })
  it('ignores rows without a date and dates that are not YYYY-MM-DD', () => {
    expect(latestDate([null, undefined, '', '30/11/2025', '2025-1-5', '2025-02-03'])).toBe('2025-02-03')
    expect(latestDate([null, 'x'])).toBeNull()
    expect(latestDate([])).toBeNull()
  })
  it('gives this month after a first import when no date is usable', () => {
    expect(monthAfterFirstImport(latestDate(['bad']), '2026-11')).toBe('2026-11')
  })
})

describe('privacy line of the get-started screen', () => {
  it('is the plain one while the assistant is off or not known yet', () => {
    expect(startPrivacyKey(false, { company: 'Anthropic' })).toBe('overview.start.privacy')
    expect(startPrivacyKey(true, null)).toBe('overview.start.privacy')
  })
  it('names where the data goes for a cloud provider, and keeps it local for a local one', () => {
    expect(startPrivacyKey(true, { company: 'Anthropic' })).toBe('overview.start.privacyCloud')
    expect(startPrivacyKey(true, { company: null })).toBe('assistant.privacyLocal')
  })
})
