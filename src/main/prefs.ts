/** Non-sensitive interface preferences, readable before login (theme, language, formats, auto-lock). */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import { DEFAULT_FORMATS, formatsFromLegacyLocale, normalizeFormats, type FormatPrefs } from '@shared/format'
import { LANGUAGE_CODES, pickLanguage, type LanguageCode } from '@shared/languages'
import type { Prefs, PrefsPatch } from '@shared/types'
import { paths } from './paths'

export const DEFAULT_PREFS: Prefs = { theme: 'system', language: 'en', formats: DEFAULT_FORMATS, autoLockMinutes: 10, updateCheck: true, welcomeDone: false, graphics: 'auto', graphicsFailed: false, keepInTray: false, insights: true, firstTipDone: true, assistantOpen: null }

type StoredPrefs = Partial<Omit<Prefs, 'formats'>> & { formats?: Partial<FormatPrefs>; formatLocale?: string }

let cache: Prefs | null = null

function systemLanguage(): LanguageCode {
  try {
    return pickLanguage(app.getPreferredSystemLanguages())
  } catch {
    return 'en'
  }
}

export function getPrefs(): Prefs {
  if (cache) return cache
  let raw: StoredPrefs = {}
  try {
    if (existsSync(paths.prefsFile)) raw = JSON.parse(readFileSync(paths.prefsFile, 'utf8')) as StoredPrefs
  } catch {
    raw = {}
  }
  // Older versions stored one "format locale"; turn it into the separate choices once.
  const formats = raw.formats ? normalizeFormats(raw.formats) : formatsFromLegacyLocale(raw.formatLocale)
  const { formatLocale: _legacy, ...rest } = raw
  cache = { ...DEFAULT_PREFS, ...rest, formats }
  // First start: follow the system language when Kasboek has it.
  if (!raw.language || !LANGUAGE_CODES.includes(raw.language as never)) cache.language = raw.language && !LANGUAGE_CODES.includes(raw.language as never) ? 'en' : systemLanguage()
  return cache
}

export function updatePrefs(patch: PrefsPatch): Prefs {
  const current = getPrefs()
  const formats = patch.formats ? normalizeFormats({ ...current.formats, ...patch.formats }, current.formats) : current.formats
  cache = { ...current, ...patch, formats }
  const tmp = paths.prefsFile + '.tmp'
  writeFileSync(tmp, JSON.stringify(cache, null, 2))
  renameSync(tmp, paths.prefsFile)
  return cache
}
