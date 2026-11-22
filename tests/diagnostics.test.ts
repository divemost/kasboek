import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDiagnostics } from '../src/main/diagnostics'

// All data here is invented.
describe('diagnostic text', () => {
  const base = { appVersion: '9.9.9', platform: 'win32', arch: 'arm64', osRelease: '10.0.26100', now: new Date('2026-11-22T10:00:00Z') }

  it('lists names, sizes and dates, the error and the seal, and never what is inside a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-diag-'))
    const put = (name: string, text: string): void => {
      writeFileSync(join(dir, name), text)
      utimesSync(join(dir, name), new Date('2026-05-01T08:00:00Z'), new Date('2026-05-01T08:00:00Z'))
    }
    put('account.json', 'TOP-SECRET-ACCOUNT')
    put('account.json.bak', 'TOP-SECRET-BACKUP')
    put('account.json.damaged-1700000000000', 'TOP-SECRET-DAMAGED')
    put('kasboek.db', 'TOP-SECRET-DB')
    put('prefs.json', '{"language":"PREFS-CONTENT"}')
    mkdirSync(join(dir, 'safety-backups'))
    put(join('safety-backups', 'before-import-2026-05-01_080000.kasboek'), 'TOP-SECRET-SAFETY')
    mkdirSync(join(dir, 'erased', '1700000000000'), { recursive: true })

    const text = buildDiagnostics({ ...base, dataDir: dir, error: { code: 'auth.other_device', seal: 'os' } })
    expect(text).toContain('Kasboek 9.9.9 on win32 arm64 (10.0.26100)')
    expect(text).toContain('Error: auth.other_device; seal: os')
    expect(text).toContain('account.json: 18 bytes, modified 2026-05-01T08:00:00.000Z')
    expect(text).toContain('account.json.bak: 17 bytes')
    expect(text).toContain('account.json.damaged-1700000000000: 18 bytes')
    expect(text).toContain('account.json.tmp: missing')
    expect(text).toContain('Local State: missing')
    expect(text).toContain('before-import-2026-05-01_080000.kasboek: 17 bytes')
    expect(text).toContain('1700000000000: folder')
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('PREFS-CONTENT')
    expect(text).not.toContain(dir)
  })

  it('copes with a data folder that is not there', () => {
    const text = buildDiagnostics({ ...base, dataDir: join(tmpdir(), 'kb-diag-nothing-here'), error: null })
    expect(text).toContain('Error: none; seal: n/a')
    expect(text).toContain('account.json: missing')
    expect(text).toContain('safety-backups/: missing')
  })
})
