import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(__dirname, '../src/renderer/src/i18n/locales')
const load = (code: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const walk = (o: Record<string, unknown>, p: string): void => {
    for (const [k, v] of Object.entries(o)) typeof v === 'object' && v ? walk(v as Record<string, unknown>, `${p}${k}.`) : (out[p + k] = String(v))
  }
  walk(JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')), '')
  return out
}

describe('one form of address and one word per idea', () => {
  it('de speaks to the reader as "du" in the lock screen, graphics, assistant, sync and WebDAV texts', () => {
    const de = load('de')
    const keys = Object.keys(de).filter((k) => /^(auth\.open\.|auth\.recoveryHidden|settings\.graphics\.|ai\.(chatDesc|pdfDesc|noModelList|reloadHint)|welcome\.syncHint|webdav\.)/.test(k))
    expect(keys.length).toBeGreaterThan(10)
    const formal = keys.filter((k) => /\b(Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)\b|\b(Wählen|Versuchen|Starten|Geben|Löschen|Sehen|Verwenden) Sie\b|\b(wie|dass|wenn|ob) Sie\b/.test(de[k]!))
    expect(formal).toEqual([])
  })

  it('fr uses "vous" in the consent and PDF-reading dialogs', () => {
    const fr = load('fr')
    const keys = Object.keys(fr).filter((k) => /^import\.(consent|pdf\.ai)\./.test(k))
    expect(keys.filter((k) => /(?<![\p{L}’'])(tu|te|t’|ton|ta|tes|toi)(?![\p{L}])/iu.test(fr[k]!))).toEqual([])
  })

  it('nl and fr name a transaction like the navigation does', () => {
    expect(Object.entries(load('nl')).filter(([k, v]) => !k.startsWith('nav.') && /transactie|boeking(?!en)/i.test(v) && !/overboeking/i.test(v)).map(([k]) => k).filter((k) => !/_list|_categorize$/.test(k))).toEqual([])
    expect(Object.entries(load('fr')).filter(([, v]) => /\btransactions?\b/i.test(v)).map(([k]) => k)).toEqual([])
  })

  it('the amount example is filled in from the chosen decimal separator, in every language', () => {
    for (const code of ['en', 'nl', 'de', 'fr', 'es', 'pt-PT', 'pt-BR']) {
      const text = load(code)['transactions.amountHint']!
      expect(text, code).toContain('{{example}}')
      expect(text, code).not.toMatch(/12,50/)
    }
  })

  it('the Overview banner has its own button text, not "Review with the assistant"', () => {
    for (const code of ['en', 'nl', 'de', 'fr', 'es', 'pt-PT']) {
      const tr = load(code)
      expect(tr['overview.categorise'], code).toBeTruthy()
      expect(tr['overview.categorise'], code).not.toBe(tr['overview.review'])
    }
  })
})
