import { describe, expect, it } from 'vitest'
import { PENDING_GRACE_MS, buildUpdatePlan, relaunchAfterExit, failedUpdateMessage, installKind, installStep, msiOutcome, msiOutcomeMessage, newer, oneAtATime, pickAsset, updateMayStillBeRunning, waitForHelperStart, type HelperProbe, type MsiOutcome, type UpdatePlanInput } from '@core/update'

const files = ['Kasboek-0.12.0-win-x64.msi', 'Kasboek-0.12.0-win-arm64.msi', 'Kasboek-0.12.0-mac-arm64.dmg', 'Kasboek-0.12.0-mac-x64.dmg', 'Kasboek-0.12.0-x86_64.AppImage', 'Kasboek-0.12.0-arm64.AppImage', 'Kasboek-0.12.0-amd64.deb', 'Kasboek-0.12.0-arm64.deb', 'SHA256SUMS.txt'].map((name) => ({ name }))

describe('updates', () => {
  it('compares versions', () => {
    expect(newer('v0.12.0', '0.11.2')).toBe(true)
    expect(newer('0.11.10', '0.11.9')).toBe(true)
    expect(newer('v0.11.2', '0.11.2')).toBe(false)
    expect(newer('0.11.1', '0.11.2')).toBe(false)
    expect(newer('1.0', '0.99.99')).toBe(true)
  })

  it('knows how this copy was installed', () => {
    expect(installKind('win32', {})).toBe('msi')
    expect(installKind('darwin', {})).toBe('dmg')
    expect(installKind('linux', { APPIMAGE: '/home/a/Kasboek.AppImage' })).toBe('appimage')
    expect(installKind('linux', {})).toBe('deb')
  })

  it('picks the file for this system and processor', () => {
    expect(pickAsset(files, 'msi', 'x64')?.name).toBe('Kasboek-0.12.0-win-x64.msi')
    expect(pickAsset(files, 'msi', 'arm64')?.name).toBe('Kasboek-0.12.0-win-arm64.msi')
    expect(pickAsset(files, 'dmg', 'arm64')?.name).toBe('Kasboek-0.12.0-mac-arm64.dmg')
    expect(pickAsset(files, 'appimage', 'x64')?.name).toBe('Kasboek-0.12.0-x86_64.AppImage')
    expect(pickAsset(files, 'deb', 'x64')?.name).toBe('Kasboek-0.12.0-amd64.deb')
    expect(pickAsset(files, 'deb', 'arm64')?.name).toBe('Kasboek-0.12.0-arm64.deb')
    expect(pickAsset([{ name: 'Kasboek-0.12.0-win-x64.exe' }], 'msi', 'x64')).toBeNull()
  })
})

const texts = { waiting: 'w', installing: 'i', starting: 's', failed: 'f', cancelled: 'c', notClosed: 'n', disconnecting: 'd', stillWorking: 'sw', noProgress: 'np', slow: 'sl' }
const hash = 'ab'.repeat(32)
const winPlan = (over: Partial<UpdatePlanInput> = {}): UpdatePlanInput => ({
  platform: 'win32',
  pid: 4242,
  exe: 'C:\\Program Files\\Kasboek\\Kasboek.exe',
  args: [],
  msi: 'C:\\Users\\Jérôme Dupont\\AppData\\Roaming\\Kasboek\\updates\\Kasboek-0.12.0-win-x64.msi',
  sha256: hash,
  log: 'C:\\Users\\Jérôme Dupont\\AppData\\Roaming\\Kasboek\\updates\\install.log',
  result: 'C:\\Users\\Jérôme Dupont\\AppData\\Roaming\\Kasboek\\updates\\result.json',
  updatesDir: 'C:\\Users\\Jérôme Dupont\\AppData\\Roaming\\Kasboek\\updates',
  toVersion: '0.12.0',
  theme: 'dark',
  texts,
  ...over
})

describe('update plan', () => {
  it('keeps paths with accents and spaces', () => {
    const plan = buildUpdatePlan(winPlan())
    expect(plan.v).toBe(1)
    expect(plan.msi).toContain('Jérôme Dupont')
    expect(plan.sha256).toBe(hash)
    expect(plan.texts).toEqual(texts)
  })

  it('refuses a plan the helper would refuse, before Kasboek closes', () => {
    expect(() => buildUpdatePlan(winPlan({ exe: 'C:\\Dev\\node_modules\\electron\\dist\\electron.exe' }))).toThrow(/installed Kasboek/)
    expect(() => buildUpdatePlan(winPlan({ exe: 'C:\\Program Files\\Kasboek\\KASBOEK.EXE' }))).not.toThrow()
    expect(() => buildUpdatePlan(winPlan({ args: ['C:\\dev\\kasboek'] }))).toThrow(/arguments/)
    expect(() => buildUpdatePlan(winPlan({ args: ['--background'] }))).toThrow(/arguments/)
  })

  it('refuses unsafe file names', () => {
    const dir = 'C:\\Users\\a\\updates'
    for (const name of ['evil name.msi', 'a&b.msi', 'a"b.msi', 'a%b.msi', '..']) {
      expect(() => buildUpdatePlan(winPlan({ updatesDir: dir, msi: `${dir}\\${name}` }))).toThrow(/unsafe name/)
    }
  })

  it('refuses a checksum that is not 64 hex characters', () => {
    for (const sha256 of ['', 'abc', 'g'.repeat(64), hash + 'a', ` ${hash}`]) expect(() => buildUpdatePlan(winPlan({ sha256 }))).toThrow(/SHA-256/)
  })

  it('refuses paths outside the updates folder', () => {
    const dir = 'C:\\Users\\a\\updates'
    const ok = { updatesDir: dir, msi: `${dir}\\x.msi`, log: `${dir}\\install.log`, result: `${dir}\\result.json` }
    expect(() => buildUpdatePlan(winPlan(ok))).not.toThrow()
    const outside = ['C:\\Users\\a\\x.msi', `${dir}\\..\\x.msi`, `${dir}\\..\\updates2\\x.msi`, 'C:\\Users\\a\\updates-evil\\x.msi', 'D:\\updates\\x.msi', dir, 'x.msi', `${dir}/../x.msi`]
    for (const path of outside) {
      expect(() => buildUpdatePlan(winPlan({ ...ok, msi: path })), `msi ${path}`).toThrow(/outside|unsafe/)
      expect(() => buildUpdatePlan(winPlan({ ...ok, log: path })), `log ${path}`).toThrow(/outside/)
      expect(() => buildUpdatePlan(winPlan({ ...ok, result: path })), `result ${path}`).toThrow(/outside/)
    }
  })

  it('compares Windows paths without case and with either separator', () => {
    const plan = buildUpdatePlan(winPlan({ updatesDir: 'c:\\users\\a\\UPDATES', msi: 'C:/Users/a/updates/x.msi', log: 'C:\\USERS\\a\\updates\\i.log', result: 'C:\\Users\\a\\updates\\sub\\r.json' }))
    expect(plan.msi).toBe('C:/Users/a/updates/x.msi')
  })

  it('compares other systems’ paths with case', () => {
    const o = { platform: 'linux' as const, updatesDir: '/home/a/updates', msi: '/home/a/updates/x.msi', log: '/home/a/updates/i.log', result: '/home/a/updates/r.json' }
    expect(() => buildUpdatePlan(winPlan(o))).not.toThrow()
    expect(() => buildUpdatePlan(winPlan({ ...o, msi: '/home/a/Updates/x.msi' }))).toThrow(/outside/)
    expect(() => buildUpdatePlan(winPlan({ ...o, msi: '/home/a/updates/../x.msi' }))).toThrow(/outside/)
  })
})

describe('Windows Installer outcomes', () => {
  it('maps exit codes', () => {
    const expected: [number, MsiOutcome][] = [[0, 'ok'], [3010, 'reboot'], [1641, 'reboot'], [1602, 'cancelled'], [1618, 'busy'], [1625, 'blocked'], [1643, 'blocked'], [1603, 'failed'], [1, 'failed'], [-1, 'failed']]
    for (const [code, outcome] of expected) expect(msiOutcome(code), String(code)).toBe(outcome)
  })

  it('has a message for every outcome', () => {
    const all: MsiOutcome[] = ['ok', 'reboot', 'cancelled', 'busy', 'blocked', 'failed', 'not_closed', 'checksum']
    const messages = all.map((o) => msiOutcomeMessage(o, '0.12.0'))
    for (const m of messages) expect(m).toContain('0.12.0')
    expect(new Set(messages.filter((_, i) => all[i] !== 'ok' && all[i] !== 'failed')).size).toBe(6)
    expect(msiOutcomeMessage('busy', '1.0.0')).toMatch(/Another installation/)
    expect(msiOutcomeMessage('cancelled', '1.0.0')).toMatch(/cancelled/)
    expect(msiOutcomeMessage('not_closed', '1.0.0')).toMatch(/opened again/)
  })
})

describe('after a restart', () => {
  it('counts a newer version as success, whatever the result says', () => {
    expect(failedUpdateMessage('0.12.0', '0.12.0', { outcome: 'failed' })).toBeNull()
    expect(failedUpdateMessage('0.12.0', '0.12.1', null)).toBeNull()
  })

  it('explains a failed install from the helper’s result', () => {
    expect(failedUpdateMessage('0.12.0', '0.11.0', { code: 1618, outcome: 'busy' })).toBe(msiOutcomeMessage('busy', '0.12.0'))
    expect(failedUpdateMessage('0.12.0', '0.11.0', { outcome: 'not_closed' })).toBe(msiOutcomeMessage('not_closed', '0.12.0'))
  })

  it('falls back to the general message without a usable result', () => {
    const general = msiOutcomeMessage('failed', '0.12.0')
    for (const result of [null, undefined, {}, { outcome: 'nonsense' }, { outcome: 7 }, 'text']) expect(failedUpdateMessage('0.12.0', '0.11.0', result)).toBe(general)
  })
})

describe('update that may still be installing', () => {
  const now = Date.parse('2026-01-01T12:00:00Z')
  const at = (msAgo: number): string => new Date(now - msAgo).toISOString()

  it('is left alone when the note is young, nothing is installed and there is no result', () => {
    expect(updateMayStillBeRunning('0.12.0', '0.11.0', null, at(60_000), now)).toBe(true)
    expect(updateMayStillBeRunning('0.12.0', '0.11.0', undefined, at(15 * 60_000), now)).toBe(true)
    // Longer than the helper's own limit for Windows Installer (12 minutes).
    expect(PENDING_GRACE_MS).toBeGreaterThan(12 * 60_000)
  })

  it('is decided once the note is old, there is a result, or the version is already there', () => {
    expect(updateMayStillBeRunning('0.12.0', '0.11.0', null, at(PENDING_GRACE_MS), now)).toBe(false)
    expect(updateMayStillBeRunning('0.12.0', '0.11.0', { outcome: 'failed' }, at(1000), now)).toBe(false)
    expect(updateMayStillBeRunning('0.12.0', '0.12.0', null, at(1000), now)).toBe(false)
  })

  it('does not wait on a note without a usable time, or from the future', () => {
    for (const bad of [undefined, null, 'yesterday', 7, at(-60_000)]) expect(updateMayStillBeRunning('0.12.0', '0.11.0', null, bad, now)).toBe(false)
  })

  it('still reports an old, failed install the usual way', () => {
    expect(failedUpdateMessage('0.12.0', '0.11.0', null)).toBe(msiOutcomeMessage('failed', '0.12.0'))
  })
})

describe('waiting for the helper to start', () => {
  /** A fake clock: sleeping moves time on, and `events` says what is true at which time. */
  function probe(o: { startedAt?: number; exitedAt?: number }): HelperProbe & { slept: number } {
    let t = 0
    const p = {
      slept: 0,
      started: () => o.startedAt !== undefined && t >= o.startedAt,
      exited: () => o.exitedAt !== undefined && t >= o.exitedAt,
      sleep: async (ms: number) => {
        t += ms
        p.slept += ms
      },
      now: () => t
    }
    return p
  }

  it('resolves when `started` shows up', async () => {
    const p = probe({ startedAt: 450 })
    expect(await waitForHelperStart(p)).toBe('started')
    expect(p.slept).toBe(500)
  })

  it('fails as soon as the helper ends without `started`', async () => {
    const p = probe({ exitedAt: 300 })
    expect(await waitForHelperStart(p)).toBe('exited')
    expect(p.slept).toBe(300)
  })

  it('fails after eight seconds without a sign', async () => {
    const p = probe({})
    expect(await waitForHelperStart(p)).toBe('timeout')
    expect(p.slept).toBe(8000)
  })

  it('counts `started` even when the helper has ended too', async () => {
    expect(await waitForHelperStart(probe({ startedAt: 0, exitedAt: 0 }))).toBe('started')
  })
})

describe('one install at a time', () => {
  it('turns a second call away while the first runs, and tells nothing worse than the status', async () => {
    let release: () => void = () => {}
    let runs = 0
    const install = oneAtATime(
      () => {
        runs++
        return new Promise<string>((resolve) => (release = () => resolve('installing')))
      },
      (r) => r === 'installing',
      () => 'busy'
    )
    const first = install()
    expect(await install()).toBe('busy')
    release()
    expect(await first).toBe('installing')
    // Kasboek is quitting: still no second install.
    expect(await install()).toBe('busy')
    expect(runs).toBe(1)
  })

  it('allows another try after a failure, and after a run that leaves Kasboek open', async () => {
    let n = 0
    const install = oneAtATime(
      async () => {
        n++
        if (n === 1) throw new Error('no helper')
        return 'opened'
      },
      (r) => r === 'installing',
      () => 'busy'
    )
    await expect(install()).rejects.toThrow('no helper')
    expect(await install()).toBe('opened')
    expect(await install()).toBe('opened')
    expect(n).toBe(3)
  })

  it('shows "preparing" at once, closes on success and goes back to ready with the reason on failure', () => {
    expect(installStep('prepare')).toEqual({ state: 'preparing', error: null })
    expect(installStep('close')).toEqual({ state: 'installing' })
    expect(installStep('opened')).toEqual({ state: 'opened' })
    expect(installStep('fail', 'The update could not be started.')).toEqual({ state: 'ready', error: 'The update could not be started.' })
    expect(installStep('fail')).toEqual({ state: 'ready', error: null })
  })

  it('keeps the one-at-a-time guard through the preparing state', async () => {
    let state = 'ready'
    let release!: () => void
    const run = oneAtATime(
      async () => {
        state = installStep('prepare').state as string
        await new Promise<void>((r) => (release = r))
        state = installStep('close').state as string
        return state
      },
      (s) => s === 'installing',
      () => state
    )
    const first = run()
    expect(await run()).toBe('preparing')
    release()
    expect(await first).toBe('installing')
    expect(await run()).toBe('installing')
  })
})

describe('AppImage relaunch', () => {
  it('waits for the old process and passes the path as an argument, not inside the script', () => {
    const { command, args } = relaunchAfterExit(4321, "/home/a b/it's.AppImage")
    expect(command).toBe('/bin/sh')
    expect(args.slice(3)).toEqual(['4321', "/home/a b/it's.AppImage"])
    expect(args[1]).toContain('kill -0 "$1"')
    expect(args[1]).toContain('exec "$2"')
    expect(args[1]).not.toContain('AppImage')
  })
})
