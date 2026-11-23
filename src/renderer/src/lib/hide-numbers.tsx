import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { fieldView, shownAccount, shownText } from '@shared/hide-numbers'
import { revealedAfter, type RevealEvent } from '@shared/password-reveal'
import { Input, cx } from '../components/ui'
import { useSettings } from './settings'

/**
 * Account numbers (IBANs, card-like numbers) are hidden on screen by default, in case someone is
 * watching. Every place in the renderer that shows one goes through <Iban>, <Masked> or <IbanInput>
 * (tests/hide-numbers.test.ts checks this). A reveal lasts while the eye is held down, never longer.
 * Nothing in the renderer copies an account number; the text on screen is what gets selected.
 */
export const useHideNumbers = (): boolean => useSettings().settings.hideAccountNumbers

/** Hold-to-reveal state: `shown` is true only while the eye is held (same rules as the password field). */
function useHoldReveal(name?: string) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  const apply = (event: RevealEvent): void => setShown((s) => revealedAfter(s, event))
  useEffect(() => {
    if (!shown) return
    const onBlur = (): void => setShown((s) => revealedAfter(s, { kind: 'window-blur' }))
    const onVisibility = (): void => setShown((s) => revealedAfter(s, { kind: 'visibility', hidden: document.hidden }))
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [shown])
  // The label says what the eye reveals; the name in it is masked, so the label itself never shows a number.
  const label = name ? t('settings.holdToShowNumberOf', { name: shownText(name, true).slice(0, 60) }) : t('settings.holdToShowNumber')
  const button = (className?: string): ReactNode => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={shown}
      // The eye can sit in a clickable row: releasing it must not also click the row.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        apply({ kind: 'pointerdown' })
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        apply({ kind: 'pointerup' })
      }}
      onPointerCancel={() => apply({ kind: 'pointercancel' })}
      onPointerLeave={() => apply({ kind: 'pointerleave' })}
      onBlur={() => apply({ kind: 'blur' })}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') e.preventDefault()
        apply({ kind: 'keydown', key: e.key })
      }}
      onKeyUp={(e) => apply({ kind: 'keyup', key: e.key })}
      className={cx('inline-flex h-6 w-6 shrink-0 touch-none items-center justify-center rounded align-middle text-muted select-none hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none', className)}
    >
      {shown ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
    </button>
  )
  return { shown, button }
}

/** One account number (an IBAN): BE…1234 until the eye is held. `name` (whose number it is) goes in the eye's label. */
export function Iban({ value, className, name }: { value: string; className?: string; name?: string }) {
  const hidden = useHideNumbers()
  const { shown, button } = useHoldReveal(name)
  const text = shownAccount(value, hidden && !shown)
  return (
    <span className={cx('num', className)}>
      {text}
      {hidden && <span className="ml-1">{button()}</span>}
    </span>
  )
}

/**
 * A free text that may hold account or card numbers, for a place where the text sits in a button or link: the text to show
 * and the eye to put next to it (null when nothing is hidden). The eye must not be inside the button.
 */
export function useRevealable(text: string, name?: string): { text: string; eye: ReactNode } {
  const hidden = useHideNumbers()
  const { shown, button } = useHoldReveal(name ?? text)
  const masked = shownText(text, hidden)
  const changed = masked !== text
  return { text: changed && !shown ? masked : text, eye: changed ? button() : null }
}

/** A free text that may hold account or card numbers: they show as BE…1234 / …1234 until the eye is held. The eye only appears when something is hidden. */
export function Masked({ text, className, name }: { text: string; className?: string; name?: string }) {
  const { text: shown, eye } = useRevealable(text, name)
  return (
    <span className={className}>
      {shown}
      {eye && <span className="ml-1">{eye}</span>}
    </span>
  )
}

/** Text the person did not choose to see revealed (chat bubbles, summaries): masked, without an eye. */
export function useMasked(text: string): string {
  return shownText(text, useHideNumbers())
}

/** The account number field: masked until it is focused or the eye is held, so editing always works on the real value. */
export function IbanInput({ value, onChange, id, placeholder, className }: { value: string; onChange: (v: string) => void; id?: string; placeholder?: string; className?: string }) {
  const hidden = useHideNumbers()
  const { shown, button } = useHoldReveal()
  const [focused, setFocused] = useState(false)
  const masked = hidden && !focused && !shown && value !== ''
  return (
    <div className="relative">
      <Input
        id={id}
        value={masked ? shownAccount(value, true) : value}
        readOnly={masked}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        autoComplete="off"
        className={cx(hidden && 'pr-10', className)}
      />
      {hidden && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{button('h-7 w-7')}</span>}
    </div>
  )
}

/**
 * A text field (a name, a description, a note) that may hold account numbers: they are hidden until the field is focused or the eye
 * is held. While masked the field is read-only, so only the real value is ever edited and passed to onChange; focusing and leaving it
 * without typing changes nothing. The eye only appears when something in the text is hidden.
 */
export function MaskedInput({ value, onChange, id, className, placeholder, label }: { value: string; onChange: (v: string) => void; id?: string; className?: string; placeholder?: string; label?: string }) {
  const hidden = useHideNumbers()
  const { shown, button } = useHoldReveal(value)
  const [focused, setFocused] = useState(false)
  const view = fieldView(value, { hidden, focused, shown })
  const hasHidden = hidden && fieldView(value, { hidden, focused: false, shown: false }).readOnly
  return (
    <div className="relative">
      <Input id={id} aria-label={label} placeholder={placeholder} value={view.text} readOnly={view.readOnly} onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className={cx(hasHidden && 'pr-10', className)} />
      {hasHidden && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{button('h-7 w-7')}</span>}
    </div>
  )
}
