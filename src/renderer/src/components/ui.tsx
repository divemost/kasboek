import { createPortal } from 'react-dom'
import { Eye, EyeOff, X } from 'lucide-react'
import { createContext, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { closeAction, tabWrap, type CloseSource } from '@shared/modal-close'
import { revealedAfter, type RevealEvent } from '@shared/password-reveal'

const FOCUSABLE = 'a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
/** The controls of a dialog that can take focus now (not the ones in a hidden part). */
const focusablesIn = (root: HTMLElement | null): HTMLElement[] => (root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]')) : [])

const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  icon,
  busy,
  onClick,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
  /** Looks and reads as disabled and does nothing, but keeps keyboard focus (a disabled button drops it to the page). For a button that was just pressed. */
  busy?: boolean
}) {
  return (
    <button
      type="button"
      {...rest}
      aria-disabled={busy || undefined}
      onClick={(e) => {
        if (busy) e.preventDefault()
        else onClick?.(e)
      }}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-sans font-semibold lining-nums whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-sm',
        variant === 'primary' && 'bg-accent text-accent-fg hover:bg-accent-hover',
        variant === 'secondary' && 'border border-border bg-surface text-text hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-text',
        variant === 'danger' && 'border border-border bg-surface text-negative hover:bg-negative-soft',
        className
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-xl border border-border bg-surface', className)}>{children}</section>
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div>
        <h1 className="font-serif text-[30px] leading-tight font-medium tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

/** An error shown under the field that caused it; read out by screen readers when it appears. */
export function FormError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} role="alert" className="selectable text-[13px] text-negative">
      {children}
    </p>
  )
}

/** The id of the hint under the field, so the control in it can point at it (aria-describedby). */
const HintId = createContext<string | undefined>(undefined)
const describedBy = (own: string | undefined, hint: string | undefined): string | undefined => [own, hint].filter(Boolean).join(' ') || undefined

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <HintId.Provider value={hint ? hintId : undefined}>{children(id)}</HintId.Provider>
      {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

const control =
  'h-9 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const hint = useContext(HintId)
  return <input {...rest} aria-describedby={describedBy(rest['aria-describedby'], hint)} className={cx(control, className)} />
}

/** A password field with an eye button: the text is only visible while the button is held down. */
export function PasswordInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  const apply = (event: RevealEvent): void => setShown((s) => revealedAfter(s, event))

  useEffect(() => {
    if (!shown) return
    const onBlur = (): void => apply({ kind: 'window-blur' })
    const onVisibility = (): void => apply({ kind: 'visibility', hidden: document.hidden })
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [shown])

  const label = t('auth.holdToShowPassword')
  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && shown) apply({ kind: 'keydown', key: e.key })
      }}
      onBlur={() => apply({ kind: 'blur' })}
    >
      <Input {...rest} type={shown ? 'text' : 'password'} className={cx('pr-10', className)} />
      <button
        type="button"
        tabIndex={0}
        aria-label={label}
        title={label}
        aria-pressed={shown}
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          apply({ kind: 'pointerdown' })
        }}
        onPointerUp={() => apply({ kind: 'pointerup' })}
        onPointerCancel={() => apply({ kind: 'pointercancel' })}
        onPointerLeave={() => apply({ kind: 'pointerleave' })}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') e.preventDefault()
          apply({ kind: 'keydown', key: e.key })
        }}
        onKeyUp={(e) => apply({ kind: 'keyup', key: e.key })}
        className="absolute top-1/2 right-0.5 inline-flex h-8 w-8 -translate-y-1/2 touch-none items-center justify-center rounded-md text-muted transition-colors select-none hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </div>
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const hint = useContext(HintId)
  return (
    <select {...rest} aria-describedby={describedBy(rest['aria-describedby'], hint)} className={cx(control, 'pr-8', className)}>
      {children}
    </select>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: { value: T; label: string; icon?: ReactNode; disabled?: boolean; title?: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-40',
            value === o.value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-border-strong'
      )}
    >
      <span
        className={cx(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'warning' | 'negative'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-surface-2 text-muted',
        tone === 'accent' && 'bg-accent-soft text-accent-hover',
        tone === 'warning' && 'bg-warning-soft text-warning',
        tone === 'negative' && 'bg-negative-soft text-negative'
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  dismissible = true,
  closeOnBackdrop = false,
  dirty = false
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  dismissible?: boolean
  /** A click on the dimmed background closes it. Off by default: an accidental click must not lose typed text. */
  closeOnBackdrop?: boolean
  /** Something was typed: Escape and the close button ask before closing. */
  dirty?: boolean
}) {
  const { t } = useTranslation()
  const [asking, setAsking] = useState(false)
  // Where focus was when the question came up, for "Keep editing".
  const askedFrom = useRef<HTMLElement | null>(null)
  const request = (source: CloseSource): void => {
    const action = closeAction({ source, dirty, closeOnBackdrop, dismissible })
    if (action === 'close') onClose()
    else if (action === 'confirm') {
      askedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setAsking(true)
    }
  }
  const requestRef = useRef(request)
  requestRef.current = request
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // The opener is noted while rendering: a control with autoFocus has taken focus by the time effects run.
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  if (open && !wasOpen.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  wasOpen.current = open
  // Focus goes into the dialog (the first control, unless something already took it) and back to the opener on close.
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) (focusablesIn(bodyRef.current)[0] ?? dialog).focus()
    return () => {
      if (opener.current?.isConnected) opener.current.focus()
    }
  }, [open])
  // "Keep editing" puts focus back where it was, not on the page behind.
  const wasAsking = useRef(false)
  useEffect(() => {
    if (!asking && wasAsking.current) (askedFrom.current?.isConnected ? askedFrom.current : focusablesIn(bodyRef.current)[0])?.focus()
    wasAsking.current = asking
  }, [asking])
  const onTab = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Tab') return
    // A dialog opened from inside this one is a React child too: its keys are its own.
    if (!dialogRef.current?.contains(e.target as Node)) return
    const items = focusablesIn(dialogRef.current)
    const target = tabWrap(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey)
    if (items.length === 0) e.preventDefault()
    else if (target) {
      e.preventDefault()
      items[target === 'first' ? 0 : items.length - 1]!.focus()
    }
  }
  useEffect(() => {
    if (!open) setAsking(false)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (asking) setAsking(false)
      else requestRef.current('escape')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, asking])
  if (!open) return null
  // On document.body: a modal opened from the title bar (the update button) would otherwise sit inside
  // its window-drag area, where clicks and scrolling don't reach the page.
  return createPortal(
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onMouseDown={() => request('backdrop')}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onTab}
        className="w-full max-w-md outline-none rounded-xl border border-border bg-surface shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 id={titleId} className="font-semibold">{title}</h2>
          {dismissible && (
            <button type="button" aria-label={t('modal.close')} onClick={() => request('button')} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text">
              <X size={16} />
            </button>
          )}
        </div>
        <div ref={bodyRef} className="px-5 py-4">
          {/* Kept mounted while asking, so "Keep editing" returns to exactly what was typed. */}
          <div hidden={asking}>{children}</div>
          {asking && (
            <div role="alertdialog" className="flex flex-col gap-4">
              <p className="text-[13px]">{t('modal.discardAsk')}</p>
              <div className="flex justify-end gap-2">
                <Button autoFocus onClick={() => setAsking(false)}>{t('modal.keepEditing')}</Button>
                <Button variant="danger" onClick={onClose}>{t('modal.discard')}</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export { cx }

export function MonthNav({ month, label, onChange }: { month: string; label: string; onChange: (m: string) => void }) {
  const { t, i18n } = useTranslation()
  const [y, m] = month.split('-').map(Number) as [number, number]
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(y)
  const box = useRef<HTMLDivElement>(null)
  const shift = (n: number): void => {
    const d = new Date(y, m - 1 + n, 1)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  // Closes on a click outside or Escape.
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const names = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(i18n.language, { month: 'short' }).format(new Date(2026, i, 1)))
  const now = new Date()
  return (
    <div ref={box} className="relative inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
      <button type="button" aria-label={t('monthNav.previous')} onClick={() => shift(-1)} className="h-8 w-8 rounded-md text-muted hover:bg-surface-2 hover:text-text">‹</button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('monthNav.pick')}
        onClick={() => {
          setYear(y)
          setOpen(!open)
        }}
        className="h-8 min-w-36 rounded-md px-2 text-center text-[13px] font-medium capitalize hover:bg-surface-2"
      >
        {label}
      </button>
      <button type="button" aria-label={t('monthNav.next')} onClick={() => shift(1)} className="h-8 w-8 rounded-md text-muted hover:bg-surface-2 hover:text-text">›</button>
      {open && (
        <div role="dialog" aria-label={t('monthNav.pick')} className="absolute top-full right-0 z-30 mt-1 w-64 rounded-xl border border-border bg-surface p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label={t('monthNav.previousYear')} onClick={() => setYear(year - 1)} className="h-8 w-8 rounded-md text-muted hover:bg-surface-2 hover:text-text">‹</button>
            <span className="num text-[13px] font-semibold">{year}</span>
            <button type="button" aria-label={t('monthNav.nextYear')} onClick={() => setYear(year + 1)} className="h-8 w-8 rounded-md text-muted hover:bg-surface-2 hover:text-text">›</button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {names.map((name, i) => {
              const selected = year === y && i + 1 === m
              const current = year === now.getFullYear() && i === now.getMonth()
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(`${year}-${String(i + 1).padStart(2, '0')}`)
                    setOpen(false)
                  }}
                  className={cx(
                    'h-9 rounded-md text-[13px] capitalize transition-colors',
                    selected ? 'bg-accent font-medium text-accent-fg' : 'hover:bg-surface-2',
                    !selected && current && 'font-semibold text-accent'
                  )}
                >
                  {name.replace('.', '')}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="mt-2 w-full rounded-md py-1.5 text-xs font-medium text-accent hover:bg-surface-2"
            onClick={() => {
              onChange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
              setOpen(false)
            }}
          >
            {t('monthNav.thisMonth')}
          </button>
        </div>
      )}
    </div>
  )
}
