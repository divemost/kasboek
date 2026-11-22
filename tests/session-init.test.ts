import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadAccount: vi.fn<() => Promise<unknown>>()
}))

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, powerMonitor: { on: vi.fn() }, app: { getPath: () => '' } }))
vi.mock('../src/main/graphics', () => ({ startupLog: vi.fn() }))
vi.mock('../src/main/prefs', () => ({ getPrefs: () => ({}) }))
vi.mock('../src/main/quarantine', () => ({ listErased: async () => [], purgeErased: async () => undefined, quarantineData: vi.fn(), restoreErased: vi.fn() }))
vi.mock('../src/main/security/device-auth', () => ({ deviceAuthKind: async () => null, peekDeviceAuthKind: () => null, releaseDeviceCheck: vi.fn(), verifyDeviceUser: vi.fn() }))
vi.mock('../src/main/security/device-mode', () => ({ keyIsOsProtected: async () => false }))
vi.mock('../src/main/security/account-store', () => ({
  accountExists: () => false,
  AccountReadError: class extends Error {},
  describeReadFailure: async () => 'account read failed',
  removeAccountSideFiles: vi.fn(),
  keyProtection: async () => 'file',
  loadAccount: mocks.loadAccount,
  readLegacyDbKey: async () => null,
  removeLegacyKeystore: vi.fn(),
  saveAccount: vi.fn()
}))

describe('reading the account', () => {
  it('shares one read between calls that overlap', async () => {
    const { initSession } = await import('../src/main/session')
    let release: (v: null) => void = () => undefined
    mocks.loadAccount.mockReset()
    mocks.loadAccount.mockImplementation(() => new Promise((resolve) => (release = resolve)))
    const [a, b] = [initSession(), initSession()]
    expect(a).toBe(b)
    release(null)
    await Promise.all([a, b])
    expect(mocks.loadAccount).toHaveBeenCalledTimes(1)
  })

  it('keeps an account file that failed to read "locked" while it is read again, and joins that read', async () => {
    const { initSession, status } = await import('../src/main/session')
    mocks.loadAccount.mockReset()
    mocks.loadAccount.mockRejectedValue(new Error('keyring locked'))
    await initSession()
    expect((await status()).state).toBe('locked')

    // "Try again": while the second read is busy, asking for the status waits for it instead of saying "setup".
    let release: (v: null) => void = () => undefined
    mocks.loadAccount.mockReset()
    mocks.loadAccount.mockImplementation(() => new Promise((resolve) => (release = resolve)))
    const retry = initSession()
    const states: string[] = []
    const asked = status().then((s) => states.push(s.state))
    await new Promise((r) => setTimeout(r, 20))
    expect(states).toEqual([])
    release(null)
    await Promise.all([retry, asked])
    expect(states).toEqual(['setup'])
    expect(mocks.loadAccount).toHaveBeenCalledTimes(1)
  })
})
