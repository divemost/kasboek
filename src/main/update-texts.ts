/** The words in the Windows update window, in the person's language (the helper shows them as they are). */
import { FALLBACKS, type LanguageCode } from '@shared/languages'
import type { UpdatePlan } from '@core/update'
import { update as de } from '../renderer/src/i18n/locales/de.json'
import { update as en } from '../renderer/src/i18n/locales/en.json'
import { update as es } from '../renderer/src/i18n/locales/es.json'
import { update as es419 } from '../renderer/src/i18n/locales/es-419.json'
import { update as fr } from '../renderer/src/i18n/locales/fr.json'
import { update as nl } from '../renderer/src/i18n/locales/nl.json'
import { update as ptBR } from '../renderer/src/i18n/locales/pt-BR.json'
import { update as ptPT } from '../renderer/src/i18n/locales/pt-PT.json'

export type UpdateTexts = UpdatePlan['texts']
export const UPDATE_TEXT_KEYS: readonly (keyof UpdateTexts)[] = ['waiting', 'installing', 'starting', 'failed', 'cancelled', 'notClosed', 'disconnecting', 'stillWorking', 'noProgress', 'slow']

/** Regional files hold only what differs, so `helper` may be missing. */
type Section = { helper?: Partial<UpdateTexts> }
export const BY_LANGUAGE: Record<LanguageCode, Section> = { en, nl, fr, de, es, 'es-419': es419 as Section, 'pt-PT': ptPT, 'pt-BR': ptBR as Section }

/**
 * The texts for `language`; anything missing comes from its base language, then English.
 * `{{version}}` is left in for the helper to fill in.
 */
export function updateTexts(language: string): UpdateTexts {
  const known = language in BY_LANGUAGE ? (language as LanguageCode) : 'en'
  const chain: LanguageCode[] = [known, ...(FALLBACKS[known] ?? []), 'en']
  const pick = (key: keyof UpdateTexts): string => {
    for (const l of chain) {
      const text = BY_LANGUAGE[l].helper?.[key]
      if (text) return text
    }
    return ''
  }
  return { waiting: pick('waiting'), installing: pick('installing'), starting: pick('starting'), failed: pick('failed'), cancelled: pick('cancelled'), notClosed: pick('notClosed'), disconnecting: pick('disconnecting'), stillWorking: pick('stillWorking'), noProgress: pick('noProgress'), slow: pick('slow') }
}
