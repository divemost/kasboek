// What a dialog does when the person tries to close it. A click on the dimmed background never
// closes a form by accident; Escape and the close button ask first when something was typed.
export type CloseSource = 'backdrop' | 'escape' | 'button'

export function closeAction(o: { source: CloseSource; dirty?: boolean; closeOnBackdrop?: boolean; dismissible?: boolean }): 'close' | 'confirm' | 'ignore' {
  if (o.dismissible === false) return 'ignore'
  if (o.source === 'backdrop' && !o.closeOnBackdrop) return 'ignore'
  return o.dirty ? 'confirm' : 'close'
}

/**
 * Tab inside a dialog stays inside it: from the last control it goes to the first, and Shift+Tab from the first to the last.
 * `index` is the position of the focused control among the dialog's controls (-1 when focus is on the dialog itself or outside).
 * null = let the browser move focus as usual.
 */
export function tabWrap(index: number, count: number, shift: boolean): 'first' | 'last' | null {
  if (count === 0) return null
  if (index === -1) return shift ? 'last' : 'first'
  if (shift && index === 0) return 'last'
  if (!shift && index === count - 1) return 'first'
  return null
}
