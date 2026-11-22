/**
 * The short text the error screen can copy for support: which files exist, how big they are and when they changed.
 * Names, sizes and dates only: never what is inside a file. Kept free of Electron so it can be tested.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface DiagnosticsInput {
  dataDir: string
  appVersion: string
  platform: string
  arch: string
  osRelease: string
  error: { code: string; seal: string } | null
  now?: Date
}

const FILES = ['account.json', 'account.json.tmp', 'account.json.bak', 'kasboek.db', 'Local State', 'prefs.json']
const FOLDERS = ['safety-backups', 'erased']
/** Enough to see what is there, not a listing of everything. */
const MAX_LISTED = 30

function describe(path: string): string {
  try {
    const st = statSync(path)
    return st.isDirectory() ? `folder, modified ${st.mtime.toISOString()}` : `${st.size} bytes, modified ${st.mtime.toISOString()}`
  } catch {
    return 'missing'
  }
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function buildDiagnostics(i: DiagnosticsInput): string {
  const lines = [
    `Kasboek ${i.appVersion} on ${i.platform} ${i.arch} (${i.osRelease})`,
    `Created ${(i.now ?? new Date()).toISOString()}`,
    `Error: ${i.error?.code ?? 'none'}; seal: ${i.error?.seal ?? 'n/a'}`,
    '',
    'Data folder (names, sizes and dates only):'
  ]
  const damaged = names(i.dataDir).filter((n) => n.startsWith('account.json.damaged-'))
  for (const name of [...FILES, ...damaged]) lines.push(`  ${name}: ${describe(join(i.dataDir, name))}`)
  for (const folder of FOLDERS) {
    const dir = join(i.dataDir, folder)
    lines.push(`  ${folder}/: ${describe(dir)}`)
    const children = names(dir)
    for (const child of children.slice(0, MAX_LISTED)) lines.push(`    ${child}: ${describe(join(dir, child))}`)
    if (children.length > MAX_LISTED) lines.push(`    … and ${children.length - MAX_LISTED} more`)
  }
  return lines.join('\n')
}
