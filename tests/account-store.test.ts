import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountData } from '@core/account'

// All data here is invented. The operating system seal is faked: "sealed:" in front of the text.
const mocks = vi.hoisted(() => ({
  dataDir: '',
  decrypt: vi.fn<(data: Buffer) => Promise<{ result: string }>>(),
  failRead: null as string | null,
  steps: [] as string[],
  opened: [] as { name: string; flags: unknown; mode: unknown }[],
  failWrite: null as string | null
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.dataDir },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (s: string) => Buffer.from(`sealed:${s}`),
    decryptStringAsync: (b: Buffer) => mocks.decrypt(b),
    getSelectedStorageBackend: () => 'gnome_libsecret'
  }
}))
vi.mock('../src/main/graphics', () => ({ startupLog: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    readFile: (path: string, ...rest: unknown[]) => {
      if (mocks.failRead && String(path).endsWith('account.json')) return Promise.reject(Object.assign(new Error(`${mocks.failRead}: cannot open '${String(path)}'`), { code: mocks.failRead, syscall: 'open' }))
      return (real.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest)
    },
    rename: async (from: string, to: string) => {
      const plain = (p: string): string | undefined => p.split(/[\\/]/).pop()?.replace(/\.tmp-[0-9a-f-]{36}$/, '.tmp')
      mocks.steps.push(`rename ${plain(from)} -> ${plain(to)}`)
      return real.rename(from, to)
    },
    open: async (path: string, ...rest: unknown[]) => {
      const name = String(path).split(/[\\/]/).pop()?.replace(/\.tmp-[0-9a-f-]{36}$/, '.tmp')
      mocks.opened.push({ name: name!, flags: rest[0], mode: rest[1] })
      if (mocks.failWrite && name === mocks.failWrite) throw Object.assign(new Error(`EIO: cannot write '${String(path)}'`), { code: 'EIO', syscall: 'open' })
      const handle = await (real.open as (...a: unknown[]) => Promise<import('node:fs/promises').FileHandle>)(path, ...rest)
      const sync = handle.sync.bind(handle)
      handle.sync = async () => {
        mocks.steps.push(`fsync ${name}`)
        return sync()
      }
      return handle
    }
  }
})

const account = (tag: string): AccountData => ({ version: 2, mode: 'password', tag }) as unknown as AccountData
const sealed = (tag: string): string => JSON.stringify({ format: 'kasboek-account', version: 2, seal: 'os', data: Buffer.from(`sealed:${JSON.stringify(account(tag))}`).toString('base64') })

describe('account file', () => {
  let store: typeof import('../src/main/security/account-store')
  const file = (n: string): string => join(mocks.dataDir, n)
  const tagOf = (a: AccountData | null): unknown => (a as unknown as { tag: string } | null)?.tag

  beforeEach(async () => {
    mocks.dataDir = mkdtempSync(join(tmpdir(), 'kb-acct-'))
    mocks.failRead = null
    mocks.steps.length = 0
    mocks.opened.length = 0
    mocks.failWrite = null
    mocks.decrypt.mockReset().mockImplementation(async (b) => ({ result: b.toString().replace(/^sealed:/, '') }))
    store = await import('../src/main/security/account-store')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** Runs a load whose unsealing never works, through the waits (only setTimeout is faked: the file I/O is real). */
  const failingLoad = async (): Promise<unknown> => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const result = store.loadAccount().catch((e: unknown) => e)
    await vi.waitFor(() => expect(mocks.decrypt).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(250)
    await vi.waitFor(() => expect(mocks.decrypt).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(750)
    return result
  }

  it('saves, reads back, and keeps a safety copy equal to the file', async () => {
    await store.saveAccount(account('one'))
    expect(tagOf(await store.loadAccount())).toBe('one')
    expect(readFileSync(file('account.json.bak'), 'utf8')).toBe(readFileSync(file('account.json'), 'utf8'))
    expect(readdirSync(mocks.dataDir).sort()).toEqual(['account.json', 'account.json.bak'])
  })

  it('writes the temporary file, flushes it, renames it, then flushes the folder', async () => {
    await store.saveAccount(account('one'))
    const main = mocks.steps.slice(0, mocks.steps.indexOf('fsync ' + mocks.dataDir.split(/[\\/]/).pop()) + 1)
    expect(main).toEqual(['fsync account.json.tmp', 'rename account.json.tmp -> account.json', `fsync ${mocks.dataDir.split(/[\\/]/).pop()}`])
    // The safety copy is written the same way, after the account itself.
    expect(mocks.steps.indexOf('fsync account.json.bak.tmp')).toBeGreaterThan(main.length - 1)
    expect(mocks.steps).toContain('rename account.json.bak.tmp -> account.json.bak')
  })

  it('recovers an empty account file from the safety copy and keeps the damaged file', async () => {
    await store.saveAccount(account('one'))
    writeFileSync(file('account.json'), '')
    expect(tagOf(await store.loadAccount())).toBe('one')
    expect(readFileSync(file('account.json'), 'utf8')).toBe(sealed('one'))
    const damaged = readdirSync(mocks.dataDir).filter((n) => n.startsWith('account.json.damaged-'))
    expect(damaged).toHaveLength(1)
    expect(readFileSync(file(damaged[0]!), 'utf8')).toBe('')
  })

  it('recovers a cut-off account file the same way', async () => {
    await store.saveAccount(account('one'))
    writeFileSync(file('account.json'), sealed('one').slice(0, 40))
    expect(tagOf(await store.loadAccount())).toBe('one')
    expect(readdirSync(mocks.dataDir).some((n) => n.startsWith('account.json.damaged-'))).toBe(true)
  })

  it('never uses an older safety copy while account.json can be read', async () => {
    writeFileSync(file('account.json.bak'), sealed('old'))
    writeFileSync(file('account.json'), sealed('new'))
    expect(tagOf(await store.loadAccount())).toBe('new')
    expect(readFileSync(file('account.json'), 'utf8')).toBe(sealed('new'))
    // The copy follows the file, not the other way round.
    expect(readFileSync(file('account.json.bak'), 'utf8')).toBe(sealed('new'))
    expect(readdirSync(mocks.dataDir).some((n) => n.includes('damaged'))).toBe(false)
  })

  it('does not replace a readable account.json that only the OS can’t unseal', async () => {
    writeFileSync(file('account.json.bak'), sealed('old'))
    writeFileSync(file('account.json'), sealed('new'))
    mocks.decrypt.mockRejectedValue(new Error('cannot decrypt'))
    expect(await failingLoad()).toMatchObject({ code: 'auth.other_device' })
    expect(readFileSync(file('account.json'), 'utf8')).toBe(sealed('new'))
    expect(readFileSync(file('account.json.bak'), 'utf8')).toBe(sealed('old'))
  })

  it('says so, without file contents, when the damaged file has no usable safety copy', async () => {
    writeFileSync(file('account.json'), '{"format": "secret-looking-text')
    const err = await store.loadAccount().catch((e: unknown) => e as Error)
    expect(err).toMatchObject({ code: 'auth.corrupt' })
    expect((err as Error).message).toContain('account.json.bak is not available')
    expect((err as Error).message).not.toContain('secret-looking-text')
    expect(readFileSync(file('account.json'), 'utf8')).toBe('{"format": "secret-looking-text')
  })

  it('does not treat a valid file of another kind as recoverable', async () => {
    writeFileSync(file('account.json.bak'), sealed('old'))
    writeFileSync(file('account.json'), JSON.stringify({ format: 'something-else' }))
    await expect(store.loadAccount()).rejects.toMatchObject({ code: 'auth.corrupt' })
    expect(readdirSync(mocks.dataDir).some((n) => n.includes('damaged'))).toBe(false)
  })

  it('tries to unseal again after 250 ms and 750 ms before giving up, and succeeds when a later try works', async () => {
    writeFileSync(file('account.json'), sealed('one'))
    mocks.decrypt.mockRejectedValueOnce(new Error('not ready')).mockRejectedValueOnce(new Error('not ready'))
    const wait = vi.spyOn(globalThis, 'setTimeout')
    const result = await store.loadAccount()
    expect(wait.mock.calls.map((c) => c[1]).filter((ms) => ms === 250 || ms === 750)).toEqual([250, 750])
    expect(tagOf(result)).toBe('one')
    expect(mocks.decrypt).toHaveBeenCalledTimes(3)
  })

  describe('when the unsealing always fails', () => {
    const platform = process.platform
    afterEach(() => Object.defineProperty(process, 'platform', { value: platform }))
    const fail = async (): Promise<unknown> => {
      writeFileSync(file('account.json'), sealed('one'))
      mocks.decrypt.mockRejectedValue(new Error('Decryption failed'))
      return failingLoad()
    }

    it('names the missing Windows key file (Local State)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const err = await fail()
      expect(err).toMatchObject({ code: 'auth.key_missing', seal: 'os' })
      expect((err as Error).message).toContain('Local State')
      expect(mocks.decrypt).toHaveBeenCalledTimes(3)
    })

    it('is "other device" when Local State is there', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      writeFileSync(file('Local State'), '{}')
      expect(await fail()).toMatchObject({ code: 'auth.other_device', seal: 'os' })
    })

    it('is "other device" elsewhere, where Local State means nothing', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      expect(await fail()).toMatchObject({ code: 'auth.other_device' })
    })
  })

  it('reports a file that can’t be read right now as busy, never as the raw error', async () => {
    writeFileSync(file('account.json'), sealed('one'))
    mocks.failRead = 'EPERM'
    const err = (await store.loadAccount().catch((e: unknown) => e)) as Error & { code: string }
    expect(err.code).toBe('auth.unreadable')
    expect(err.message).toBe('account.json could not be read (EPERM, open)')
    expect(err.message).not.toContain(mocks.dataDir)
    // No safety copy is tried: the file is there, it is just busy.
    expect(existsSync(file('account.json.bak'))).toBe(false)
  })

  it('describes a failed read for the log without secrets or contents', async () => {
    writeFileSync(file('account.json'), sealed('one'))
    const line = await store.describeReadFailure(new store.AccountReadError('auth.other_device', 'could not unseal', 'os'))
    expect(line).toContain('auth.other_device: could not unseal')
    expect(line).toContain(`account.json size ${sealed('one').length}`)
    expect(line).toContain('seal os')
    expect(line).toContain('safeStorage available true')
    expect(line).not.toContain(Buffer.from('sealed:').toString('base64'))
  })

  it('lists and removes the files that belong to the account', async () => {
    for (const n of ['account.json.bak', 'account.json.damaged-1', 'account.json.tmp', 'prefs.json']) writeFileSync(file(n), 'x')
    expect((await store.accountSideFiles()).sort()).toEqual(['account.json.bak', 'account.json.damaged-1', 'account.json.tmp'])
    await store.removeAccountSideFiles()
    expect(readdirSync(mocks.dataDir).sort()).toEqual(['account.json.bak', 'prefs.json'])
    await store.removeAccountSideFiles(true)
    expect(readdirSync(mocks.dataDir)).toEqual(['prefs.json'])
  })

  it('uses a temporary file of its own for every write, created new and private', async () => {
    await store.saveAccount(account('one'))
    await store.saveAccount(account('two'))
    const tmps = mocks.opened.filter((o) => o.name.endsWith('.tmp'))
    expect(tmps.length).toBeGreaterThanOrEqual(4)
    for (const o of tmps) expect(o).toMatchObject({ flags: 'wx', mode: 0o600 })
    expect(readdirSync(mocks.dataDir).filter((n) => n.includes('.tmp'))).toEqual([])
    if (process.platform !== 'win32') expect(statSync(file('account.json')).mode & 0o777).toBe(0o600)
  })

  it('never reuses a temporary name: a leftover of an earlier write does not get in the way', async () => {
    writeFileSync(file('account.json.tmp'), 'leftover')
    await store.saveAccount(account('one'))
    expect(tagOf(await store.loadAccount())).toBe('one')
    expect(readFileSync(file('account.json.tmp'), 'utf8')).toBe('leftover')
    expect((await store.accountSideFiles()).sort()).toEqual(['account.json.bak', 'account.json.tmp'])
  })

  it('runs overlapping saves one after the other, so the last one asked for wins in both files', async () => {
    await Promise.all([1, 2, 3, 4, 5].map((n) => store.saveAccount(account(`v${n}`))))
    expect(tagOf(await store.loadAccount())).toBe('v5')
    expect(readFileSync(file('account.json.bak'), 'utf8')).toBe(readFileSync(file('account.json'), 'utf8'))
    // Each save finished (renamed) before the next one opened its temporary file.
    const order = mocks.steps.filter((s) => s.startsWith('rename account.json.tmp -> account.json') && !s.endsWith('.bak'))
    expect(order).toHaveLength(5)
    const firstRename = mocks.steps.indexOf('rename account.json.tmp -> account.json')
    expect(mocks.steps.slice(0, firstRename).filter((s) => s === 'fsync account.json.tmp')).toHaveLength(1)
  })

  it('removes the safety copy when it can’t be refreshed, so an outdated one is never restored later', async () => {
    await store.saveAccount(account('one'))
    mocks.failWrite = 'account.json.bak.tmp'
    await store.saveAccount(account('two'))
    expect(tagOf(await store.loadAccount())).toBe('two')
    expect(existsSync(file('account.json.bak'))).toBe(false)
    const logged = vi.mocked((await import('../src/main/graphics')).startupLog).mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('could not update account.json.bak (EIO, open)')
    expect(logged).not.toContain(mocks.dataDir)
  })

  it('a change of credentials removes the old safety copy first, and fails before writing when it can’t', async () => {
    await store.saveAccount(account('one'))
    await store.saveAccount(account('two'), { credentials: true })
    expect(tagOf(await store.loadAccount())).toBe('two')
    expect(readFileSync(file('account.json.bak'), 'utf8')).toBe(readFileSync(file('account.json'), 'utf8'))

    // A safety copy that can’t be removed (here a folder in its place).
    rmSync(file('account.json.bak'))
    mkdirSync(file('account.json.bak'))
    writeFileSync(file('account.json.bak/inner'), 'x')
    const before = readFileSync(file('account.json'), 'utf8')
    const err = (await store.saveAccount(account('three'), { credentials: true }).catch((e: unknown) => e)) as Error & { code: string }
    expect(err.code).toBe('auth.save_failed')
    expect(err.message).not.toContain(mocks.dataDir)
    expect(readFileSync(file('account.json'), 'utf8')).toBe(before)
  })

  it('says what happened, without paths, when a save fails', async () => {
    mocks.failWrite = 'account.json.tmp'
    const err = (await store.saveAccount(account('one')).catch((e: unknown) => e)) as Error & { code: string }
    expect(err).toMatchObject({ code: 'auth.save_failed' })
    expect(err.message).toBe('The account file could not be saved (EIO, open).')
  })

  it('hands out a notice with the date of the safety copy after restoring from it, once', async () => {
    await store.saveAccount(account('one'))
    const when = new Date('2026-03-04T10:20:30Z')
    utimesSync(file('account.json.bak'), when, when)
    writeFileSync(file('account.json'), '')
    expect(tagOf(await store.loadAccount())).toBe('one')
    expect(store.takeRestoreNotice()).toBe(when.toISOString())
    expect(store.takeRestoreNotice()).toBeNull()
  })

  it('gives no notice for an account file that opens', async () => {
    await store.saveAccount(account('one'))
    await store.loadAccount()
    expect(store.takeRestoreNotice()).toBeNull()
  })

  it('restores a missing account.json from the safety copy like an empty one, keeping nothing damaged', async () => {
    await store.saveAccount(account('one'))
    const when = new Date('2026-03-04T10:20:30Z')
    utimesSync(file('account.json.bak'), when, when)
    rmSync(file('account.json'))
    expect(tagOf(await store.loadAccount())).toBe('one')
    expect(readFileSync(file('account.json'), 'utf8')).toBe(sealed('one'))
    expect(readdirSync(mocks.dataDir).some((n) => n.includes('damaged'))).toBe(false)
    expect(store.takeRestoreNotice()).toBe(when.toISOString())
  })

  it('reports a missing account.json with an unusable safety copy as an error, never as "no account"', async () => {
    writeFileSync(file('account.json.bak'), 'not an account')
    const err = await store.loadAccount().catch((e: unknown) => e as Error)
    expect(err).toMatchObject({ code: 'auth.corrupt' })
    expect((err as Error).message).toContain('account.json is missing')
    expect(existsSync(file('account.json'))).toBe(false)
  })

  it('has no account when neither file is there', async () => {
    expect(await store.loadAccount()).toBeNull()
  })
})
