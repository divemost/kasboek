import { X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Page } from '../App'
import { useAssistantEnabled } from '../lib/settings'
import { Button } from './ui'

/** The parts of Kasboek the tour points at, in order. Each target carries data-tour="<id>". */
const STEPS: { id: string; page?: Page }[] = [
  { id: 'overview', page: 'overview' },
  { id: 'accounts', page: 'accounts' },
  { id: 'transactions', page: 'transactions' },
  { id: 'budgets', page: 'budgets' },
  { id: 'recurring', page: 'recurring' },
  { id: 'goals', page: 'goals' },
  { id: 'year', page: 'year' },
  { id: 'import', page: 'import' },
  { id: 'importBar' },
  { id: 'assistant' },
  { id: 'settings', page: 'settings' },
  { id: 'lock', page: 'overview' }
]

const EVENT = 'kasboek:tour'
/** Asked for before the main window exists (the welcome window's last button). */
let requested = false

/** Starts the tour (from the welcome window or Settings). */
export function startTour(): void {
  requested = true
  window.dispatchEvent(new Event(EVENT))
}

/** A spotlight on one part of the window at a time, with a short explanation next to it. */
export function Tour({ go, openAssistant }: { go: (p: Page) => void; openAssistant: () => void }) {
  const { t } = useTranslation()
  const assistantEnabled = useAssistantEnabled()
  // Without the assistant the tour has no step about it.
  const steps = assistantEnabled ? STEPS : STEPS.filter((x) => x.id !== 'assistant')
  const [step, setStep] = useState<number | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // What had focus when the tour started: it gets focus back when the tour ends.
  const starter = useRef<HTMLElement | null>(null)
  // Each step takes focus on its heading, so a screen reader reads the step and the keyboard continues at its buttons.
  useEffect(() => {
    if (step !== null) heading.current?.focus()
  }, [step])

  useEffect(() => {
    const start = (): void => {
      requested = false
      starter.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setStep(0)
    }
    if (requested) start()
    window.addEventListener(EVENT, start)
    return () => window.removeEventListener(EVENT, start)
  }, [])

  const current = step === null ? null : steps[step]!
  // Show the page the step is about, and the assistant panel for its step.
  useEffect(() => {
    if (!current) return
    if (current.page) go(current.page)
    if (current.id === 'assistant') openAssistant()
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  const measure = useCallback(() => {
    if (!current) return setRect(null)
    const el = document.querySelector(`[data-tour="${current.id}"]`)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [current])
  useLayoutEffect(() => {
    measure()
    // The page behind may still be laying out.
    const timer = setTimeout(measure, 120)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  const close = useCallback(() => {
    setStep(null)
    go('overview')
    // After the page behind has re-rendered; the starter may be gone with its page.
    setTimeout(() => {
      if (starter.current?.isConnected) starter.current.focus()
      starter.current = null
    }, 0)
  }, [go])
  useEffect(() => {
    if (step === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') setStep((s) => (s === null ? s : Math.min(steps.length - 1, s + 1)))
      if (e.key === 'ArrowLeft') setStep((s) => (s === null ? s : Math.max(0, s - 1)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, steps.length, close])

  if (step === null || !current) return null
  const last = step === steps.length - 1
  const pad = 6
  // Next to targets on the left (the sidebar), below targets on the right (the top bar).
  const onLeft = !rect || rect.left < window.innerWidth / 2
  const cardStyle = rect
    ? onLeft
      ? { left: rect.right + 18, top: Math.min(Math.max(16, rect.top - 24), window.innerHeight - 260) }
      : { right: Math.max(16, window.innerWidth - rect.right), top: rect.bottom + 16 }
    : { left: '50%', top: '40%', transform: 'translateX(-50%)' }
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={t('tour.label')}>
      {/* Click-catcher: the app stays visible but can't be used during the tour. */}
      <div className="absolute inset-0" onClick={close} />
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent transition-all duration-200"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/45" />
      )}
      <div className="absolute w-80 rounded-xl border border-border bg-surface p-4 shadow-xl" style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-muted">{t('tour.progress', { n: step + 1, total: steps.length })}</p>
          <button type="button" aria-label={t('tour.close')} className="-mt-1 -mr-1 rounded p-1 text-muted hover:text-text" onClick={close}>
            <X size={14} />
          </button>
        </div>
        <h2 ref={heading} tabIndex={-1} className="mt-1 font-sans outline-none text-[17px] font-semibold">{t(`nav.${current.id}`)}</h2>
        <p className="mt-1 text-[13px] text-muted">{t(`tour.step.${!assistantEnabled && (current.id === 'import' || current.id === 'settings') ? `${current.id}Local` : current.id}`)}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" className="text-[13px] text-muted hover:text-text" onClick={close}>{t('tour.skip')}</button>
          <div className="flex gap-2">
            {step > 0 && <Button size="sm" onClick={() => setStep(step - 1)}>{t('tour.back')}</Button>}
            <Button size="sm" variant="primary" onClick={() => (last ? close() : setStep(step + 1))}>{last ? t('tour.done') : t('tour.next')}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
