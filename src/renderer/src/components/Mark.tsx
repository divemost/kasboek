import { MARK_ASPECT, MARK_PATH, MARK_VIEWBOX } from '@shared/brand'

/** The Kasboek mark: the serif K of the app icon (see assets/brand/mark.svg). Uses the current text colour. */
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size * MARK_ASPECT} viewBox={MARK_VIEWBOX} fill="currentColor" aria-hidden="true" className={className}>
      <path d={MARK_PATH} />
    </svg>
  )
}
