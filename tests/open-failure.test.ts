import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LANGUAGE_CODES } from '@shared/languages'
import { OPEN_FAILURE_KEYS, openFailureKind } from '@shared/open-failure'
import i18n from '../src/renderer/src/i18n'

const noop = (): void => undefined
// The page is a .tsx file: loaded by a computed name so the Node-side type check doesn't pull the page's DOM types in.
const page = 'OpenFailure'
const { OpenFailureView } = (await import(`../src/renderer/src/pages/auth/${page}.tsx`)) as { OpenFailureView: FunctionComponent<Record<string, unknown>> }
const render = (code: string, more: boolean): string =>
  renderToStaticMarkup(
    createElement(OpenFailureView, {
      error: { code, message: 'technical text' },
      more,
      onToggleMore: noop,
      onRetry: noop,
      onImport: noop,
      onShowFolder: noop,
      onCopy: noop,
      erase: createElement('button', null, 'ERASE-FORM')
    })
  )

describe('the "Kasboek can’t open its data" screen', () => {
  it('maps every account error code to its own text, and unknown ones to the general one', () => {
    expect(openFailureKind('auth.other_device')).toBe('sealed')
    expect(openFailureKind('auth.key_missing')).toBe('keyMissing')
    expect(openFailureKind('auth.corrupt')).toBe('damaged')
    expect(openFailureKind('auth.unreadable')).toBe('busy')
    expect(openFailureKind('auth.something')).toBe('other')
  })

  it('offers import first, then try again, the data folder and the diagnostic text; Erase is not shown', () => {
    const html = render('auth.other_device', false)
    for (const label of ['Import a backup or export', 'Try again', 'Show data folder', 'Copy diagnostic info', 'More options']) expect(html).toContain(label)
    expect(html.indexOf('Import a backup or export')).toBeLessThan(html.indexOf('Try again'))
    expect(html).not.toContain('ERASE-FORM')
    expect(html).not.toContain('Erase hides')
    expect(html).toContain('aria-expanded="false"')
  })

  it('keeps the technical text under Details and shows a plain message for each cause', () => {
    const html = render('auth.unreadable', false)
    expect(html).toContain('<summary')
    expect(html).toContain('Details')
    expect(html).toContain('auth.unreadable: technical text')
    expect(html).toContain('Try again in a moment')
    expect(render('auth.corrupt', false)).toContain('empty or damaged')
    expect(render('auth.key_missing', false)).toContain('(Local State)')
    expect(render('auth.other_device', false)).toContain('this computer or user account')
  })

  it('shows Erase, with what it does, only after More options', () => {
    const html = render('auth.corrupt', true)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('ERASE-FORM')
    expect(html).toContain('“erased” folder for 30 days')
    expect(html).toContain('A backup or export is needed to get your data back')
  })
})

describe('texts of that screen', () => {
  const dir = join(process.cwd(), 'src/renderer/src/i18n/locales')
  const auth = (code: string): { open?: Record<string, string> } => (JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as { auth: { open?: Record<string, string> } }).auth
  const keys = Object.keys(auth('en').open!)

  it('has a text for each failure kind', () => {
    for (const k of OPEN_FAILURE_KEYS) expect(keys).toContain(k)
    expect(i18n.exists('auth.open.sealed')).toBe(true)
  })

  // The regional variants (es-419, pt-BR) hold only what differs and fall back to their base language.
  it.each(LANGUAGE_CODES.filter((c) => c !== 'es-419' && c !== 'pt-BR'))('is complete in %s', (code) => {
    const open = auth(code).open
    expect(Object.keys(open ?? {}).sort()).toEqual([...keys].sort())
    for (const k of keys) expect(open![k], `${code} ${k}`).toBeTruthy()
  })
})
