import { CheckCircle2, AlertCircle } from 'lucide-react'
import { createPortal } from 'react-dom'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type Tone = 'success' | 'error'
/** A button in the toast, e.g. "Show". */
export interface ToastAction {
  label: string
  onClick: () => void
}
interface Toast {
  id: number
  tone: Tone
  message: string
  action?: ToastAction
}

const Ctx = createContext<(message: string, tone?: Tone, action?: ToastAction) => void>(() => {})

const lifetime = (t: Toast): number => (t.tone === 'error' || t.action ? 7000 : 3500)

/** One toast. Its time starts over whenever the pointer or keyboard focus leaves it, and stands still while either is on it. */
function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (held) return
    const timer = setTimeout(onClose, lifetime(toast))
    return () => clearTimeout(timer)
  }, [held]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : undefined}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg border border-border bg-surface px-4 py-3 text-[13px] shadow-lg"
    >
      {toast.tone === 'success' ? (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" />
      ) : (
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-negative" />
      )}
      <span className="selectable">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="font-medium text-accent hover:underline"
          onClick={() => {
            toast.action!.onClick()
            onClose()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string, tone: Tone = 'success', action?: ToastAction) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tone, message, action }])
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      {/* On document.body and above the dialogs (z-50, the tour z-60), so an error raised inside a dialog is not hidden behind its backdrop. */}
      {createPortal(
        <div className="pointer-events-none fixed right-5 bottom-5 z-[70] flex flex-col gap-2" aria-live="polite">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onClose={() => setToasts((all) => all.filter((x) => x.id !== t.id))} />
          ))}
        </div>,
        document.body
      )}
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
