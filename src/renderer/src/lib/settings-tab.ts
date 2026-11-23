/** The tabs of the Settings page, and which one it opens on. */
export const SETTINGS_TABS = ['general', 'security', 'data', 'assistant', 'about'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

/** The last tab used, or the one a link asked for. Kept while Kasboek runs. */
let current: SettingsTab = 'general'

export function settingsTab(): SettingsTab {
  return current
}

/** For links into Settings ("Add an account", "Turn on backups"): call before going there. */
export function openSettingsTab(tab: SettingsTab): void {
  current = tab
  for (const fn of listeners) fn(tab)
}

const listeners = new Set<(tab: SettingsTab) => void>()
/** For the open Settings page: a link (the version under Lock) can switch its tab. */
export function onSettingsTab(fn: (tab: SettingsTab) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
