import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppInfo, Prefs, PrefsPatch, Settings } from '@shared/types'
import { DEFAULT_FORMATS } from '@shared/format'
import { switchLanguage } from '../i18n'
import { call } from './api'
import { formatMoney, type Fmt } from './format'

/* ---------- Preferences: available before login ---------- */

interface PrefsValue {
  prefs: Prefs
  info: AppInfo
  updatePrefs: (patch: PrefsPatch) => Promise<void>
}

const PrefsCtx = createContext<PrefsValue | null>(null)
const systemDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches

export function applyThemeToDocument(theme: Prefs['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && systemDark())
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light'
}

/** Shown when the main process can't answer, so the page still opens (and reports its first screen). */
const FALLBACK_PREFS: Prefs = { theme: 'system', language: 'en', formats: DEFAULT_FORMATS, autoLockMinutes: 10, updateCheck: true, welcomeDone: true, graphics: 'auto', graphicsFailed: false, keepInTray: false, insights: true, firstTipDone: true, assistantOpen: null }
const FALLBACK_INFO: AppInfo = { name: 'Kasboek', version: '', commit: '', platform: 'linux', dataDir: '', graphics: { hardware: true, reason: null }, mcpCommand: { command: '', args: [] } }

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void Promise.all([call('prefs.get'), call('app.info')])
      .catch((err: unknown) => {
        console.error('[prefs] could not load:', err)
        return [FALLBACK_PREFS, FALLBACK_INFO] as const
      })
      .then(async ([p, i]) => {
        // The language is ready before the first screen, so no text shows as a key.
        await switchLanguage(p.language).catch(() => {})
        setPrefs(p)
        setInfo(i)
        void window.kasboek.invoke('app.milestone', { name: 'prefs loaded', ms: Math.round(performance.now()) }).catch(() => {})
      })
  }, [])

  useEffect(() => {
    if (!prefs) return
    applyThemeToDocument(prefs.theme)
    document.documentElement.lang = prefs.language
    void switchLanguage(prefs.language).catch(() => {})
    if (prefs.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyThemeToDocument('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [prefs])

  const updatePrefs = useCallback(async (patch: PrefsPatch) => setPrefs(await call('prefs.update', patch)), [])
  const value = useMemo(() => (prefs && info ? { prefs, info, updatePrefs } : null), [prefs, info, updatePrefs])
  if (!value) return null
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>
}

export function usePrefs(): PrefsValue {
  const v = useContext(PrefsCtx)
  if (!v) throw new Error('usePrefs outside PrefsProvider')
  return v
}

/** Formatting choices, also before login. */
export function usePrefsFmt(): Fmt {
  const { prefs } = usePrefs()
  return useMemo(() => ({ formats: prefs.formats, language: prefs.language }), [prefs.formats, prefs.language])
}

/* ---------- Data settings: only while unlocked ---------- */

interface SettingsValue extends PrefsValue {
  settings: Settings
  update: (patch: { currency?: string; fxAutoUpdate?: boolean; hideAccountNumbers?: boolean; assistantEnabled?: boolean }) => Promise<void>
  /** Money in the main currency, or in `currency` when given. */
  money: (cents: number, currency?: string) => string
  fmt: Fmt
}

const Ctx = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const prefsValue = usePrefs()
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    void call('settings.get').then(setSettings)
  }, [])
  const update = useCallback(async (patch: { currency?: string; fxAutoUpdate?: boolean; hideAccountNumbers?: boolean; assistantEnabled?: boolean }) => setSettings(await call('settings.update', patch)), [])
  const value = useMemo(() => {
    if (!settings) return null
    const fmt: Fmt = { formats: prefsValue.prefs.formats, language: prefsValue.prefs.language }
    return { ...prefsValue, settings, update, fmt, money: (c: number, currency?: string) => formatMoney(c, currency ?? settings.currency, fmt) }
  }, [settings, prefsValue, update])
  if (!value) return null
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettings outside SettingsProvider')
  return v
}

/**
 * Whether the assistant is on ("Use the assistant" in Settings → Assistant). Every piece of the page that belongs to the assistant
 * (the panel, its buttons, checks, tips, texts and consent dialogs) renders only when this is true; tests/assistant-off.test.ts checks it.
 */
export function useAssistantEnabled(): boolean {
  return useSettings().settings.assistantEnabled
}
