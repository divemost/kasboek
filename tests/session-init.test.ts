import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startupLog } from '../src/main/graphics'

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
  saveAccount: vi.fn(),
  takeRestoreNotice: () => null
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

  describe('after a failed read', () => {
    const fail = (code = 'auth.other_device', message = 'could not unseal'): void => {
      mocks.loadAccount.mockReset().mockRejectedValue(Object.assign(new Error(message), { code }))
    }
    beforeEach(() => {
      vi.mocked(startupLog).mockClear()
    })

    it('does not read the file again on every status call, only on "Try again"', async () => {
      vi.resetModules()
      const session = await import('../src/main/session')
      fail()
      await session.initSession()
      mocks.loadAccount.mockClear()
      for (let i = 0; i < 3; i++) expect((await session.status()).state).toBe('locked')
      expect(mocks.loadAccount).not.toHaveBeenCalled()
      expect((await session.retryRead()).state).toBe('locked')
      expect(mocks.loadAccount).toHaveBeenCalledTimes(1)
      mocks.loadAccount.mockResolvedValue(null)
      expect((await session.retryRead()).state).toBe('setup')
    })

    it('writes an identical failure to startup.log once', async () => {
      vi.resetModules()
      const session = await import('../src/main/session')
      fail()
      await session.initSession()
      await session.retryRead()
      await session.retryRead()
      expect(vi.mocked(startupLog)).toHaveBeenCalledTimes(1)
    })
  })

  describe('replacing the data', () => {
    it('refuses while locked when the account turned out fine, but goes ahead when it still can’t be read', async () => {
      vi.resetModules()
      const session = await import('../src/main/session')
      mocks.loadAccount.mockReset().mockRejectedValue(new Error('keyring locked'))
      await session.initSession()
      expect(session.beginReplace().wasUnlocked).toBe(false)

      mocks.loadAccount.mockReset().mockResolvedValue({ mode: 'password', twoFactor: false, attempts: { failed: 0, lastFailedAt: null }, slots: {} })
      await session.retryRead()
      await session.initSession()
      expect((await session.status()).state).toBe('locked')
      expect(() => session.beginReplace()).toThrow(expect.objectContaining({ code: 'auth.locked' }))
    })

    it('throws away a read that began before the data was replaced', async () => {
      vi.resetModules()
      const session = await import('../src/main/session')
      let release: (v: unknown) => void = () => undefined
      mocks.loadAccount.mockReset().mockImplementation(() => new Promise((resolve) => (release = resolve)))
      const late = session.initSession()
      session.beginReplace()
      release({ mode: 'password', twoFactor: false, attempts: { failed: 0, lastFailedAt: null }, slots: {} })
      await late
      expect((await session.status()).state).toBe('setup')
    })

    it('runs one import at a time and keeps status() from reading the account meanwhile', async () => {
      vi.resetModules()
      const session = await import('../src/main/session')
      mocks.loadAccount.mockReset().mockRejectedValue(new Error('keyring locked'))
      await session.initSession()
      mocks.loadAccount.mockClear()
      const end = session.beginImport()
      expect(() => session.beginImport()).toThrow(expect.objectContaining({ code: 'transfer.busy' }))
      await expect(session.setup('password', 'a long strong passphrase 2026!')).rejects.toMatchObject({ code: 'transfer.busy' })
      await session.retryRead()
      expect(mocks.loadAccount).not.toHaveBeenCalled()
      end()
      expect(() => session.beginImport()()).not.toThrow()
    })
  })
})
