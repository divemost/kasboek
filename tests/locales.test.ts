import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANGUAGE_CODES } from '@shared/languages'

const dir = join(__dirname, '../src/renderer/src/i18n/locales')
const load = (code: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const walk = (o: Record<string, unknown>, p: string): void => {
    for (const [k, v] of Object.entries(o)) typeof v === 'object' && v ? walk(v as Record<string, unknown>, `${p}${k}.`) : (out[p + k] = String(v))
  }
  walk(JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')), '')
  return out
}
const codes = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
/** Regional variants hold only what differs from their base language. */
const BASE: Record<string, string> = { 'es-419': 'es', 'pt-BR': 'pt-PT' }
const full = codes.filter((c) => c !== 'en' && !BASE[c])
const vars = (s: string): string => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',')
const plural = (k: string): string => k.replace(/_(zero|one|two|few|many|other)$/, '')

const en = load('en')

describe('locale files', () => {
  it('ships the expected languages', () => {
    expect([...codes].sort()).toEqual([...LANGUAGE_CODES].sort())
  })

  for (const code of full) {
    it(`${code} has every English key, no extra ones, and the same placeholders`, () => {
      const tr = load(code)
      const baseKeys = (k: string): boolean => k in en || `${plural(k)}_other` in en
      expect(Object.keys(en).filter((k) => !(k in tr))).toEqual([])
      expect(Object.keys(tr).filter((k) => !baseKeys(k))).toEqual([])
      const differ = Object.keys(tr).filter((k) => k in en && vars(en[k]!) !== vars(tr[k]!) && !(k.endsWith('_one') && vars(tr[k]!) === ''))
      expect(differ).toEqual([])
    })
  }

  for (const [code, base] of Object.entries(BASE)) {
    it(`${code} only overrides keys that exist and keeps their placeholders (its base language is ${base})`, () => {
      const tr = load(code)
      expect(Object.keys(tr).filter((k) => !(k in en) && !(`${plural(k)}_other` in en))).toEqual([])
      expect(Object.keys(tr).filter((k) => k in en && vars(en[k]!) !== vars(tr[k]!))).toEqual([])
    })
  }

  it('no longer holds the keys of the removed Settings accounts tab and Net worth page entry', () => {
    const removed = ['nav.networth', 'tour.step.networth', 'settings.tab.accounts', 'settings.accounts', 'settings.accountsHint', 'settings.noAccounts', 'import.addAccount', 'overview.stepImport', 'overview.stepImportBody']
    for (const code of codes) {
      const tr = load(code)
      expect(removed.filter((k) => k in tr), code).toEqual([])
    }
  })

  it('has the keys of the Accounts page and the get-started screen in English', () => {
    const needed = ['nav.accounts', 'nav.importHint', 'nav.importBar', 'tour.step.accounts', 'tour.step.importBar', 'overview.add', 'overview.firstTip', 'accounts.title', 'accounts.archive', 'accounts.archivedToast', 'accounts.showTransactions', 'overview.start.title', 'overview.start.doneBody_one', 'overview.start.doneBody_other', 'overview.start.accountStep']
    expect(needed.filter((k) => !(k in en))).toEqual([])
  })
})
