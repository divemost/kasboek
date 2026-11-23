import type { ReactNode } from 'react'
import { Mark } from '../../components/Mark'

/** Centered card used by setup, lock and import screens. */
export function AuthLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="drag h-11 shrink-0" />
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 pb-16">
        <div className={wide ? 'w-full max-w-xl' : 'w-full max-w-sm'}>
          <div className="mb-8 flex items-center justify-center gap-2.5">
            <Mark size={20} className="text-accent" />
            <span className="font-serif text-[24px] font-semibold tracking-[-0.01em]">Kasboek</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

export function AuthCard({ title, body, children }: { title: ReactNode; body?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h1 className="font-serif text-[22px] leading-tight font-semibold">{title}</h1>
      {body && <p className="mt-1.5 text-[13px] text-muted">{body}</p>}
      <div className="mt-5">{children}</div>
    </div>
  )
}
