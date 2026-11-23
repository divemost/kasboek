import { type ReactNode } from 'react'

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 border-b border-border px-5 py-4 last:border-b-0 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <div className="mt-0.5 text-[13px] text-muted">{hint}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 @xl:shrink-0">{children}</div>
    </div>
  )
}
