/** Below this window width (CSS pixels, so zoom counts) the assistant panel floats over the page instead of taking a column. */
export const PANEL_OVERLAY_BELOW = 1100
/** Below this width the sidebar shows only icons. */
export const SIDEBAR_COMPACT_BELOW = 700

export function shellLayout(width: number): { overlay: boolean; compact: boolean } {
  return { overlay: width < PANEL_OVERLAY_BELOW, compact: width < SIDEBAR_COMPACT_BELOW }
}

/**
 * Whether the assistant panel shows: the remembered choice, else open only when there is an assistant to talk to
 * and the window is wide enough for it to sit beside the page (a floating panel is never opened on its own).
 */
export function assistantPanelOpen(remembered: boolean | null, assistantEnabled: boolean, overlay = false): boolean {
  return assistantEnabled && (remembered ?? !overlay)
}
