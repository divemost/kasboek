/**
 * Why Kasboek can't open its data (the error codes of the account file), as the kind of text the error screen shows.
 * The code comes from the main process; the wording is the page's own, in the person's language.
 */
export type OpenFailureKind = 'keyMissing' | 'sealed' | 'damaged' | 'busy' | 'other'

export function openFailureKind(code: string): OpenFailureKind {
  switch (code) {
    case 'auth.key_missing':
      return 'keyMissing'
    case 'auth.other_device':
      return 'sealed'
    case 'auth.corrupt':
      return 'damaged'
    case 'auth.unreadable':
      return 'busy'
    default:
      return 'other'
  }
}

/** The text keys of the error screen, under `auth.open`. */
export const OPEN_FAILURE_KEYS = ['keyMissing', 'sealed', 'damaged', 'busy', 'other'] as const satisfies readonly OpenFailureKind[]
