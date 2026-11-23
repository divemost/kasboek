import { describe, expect, it } from 'vitest'
import { assistantPanelOpen } from '@shared/assistant-panel'

describe('assistantPanelOpen', () => {
  it('follows the remembered choice when the assistant is on', () => {
    expect(assistantPanelOpen(true, true)).toBe(true)
    expect(assistantPanelOpen(false, true)).toBe(false)
  })
  it('is open by default only when the assistant is on', () => {
    expect(assistantPanelOpen(null, true)).toBe(true)
    expect(assistantPanelOpen(null, false)).toBe(false)
  })
  it('never shows without an assistant, whatever was remembered', () => {
    expect(assistantPanelOpen(true, false)).toBe(false)
  })
})

describe('shell layout', () => {
  it('floats the panel over the page below 1100 px and shrinks the sidebar below 700 px', async () => {
    const { shellLayout } = await import('@shared/assistant-panel')
    expect(shellLayout(1280)).toEqual({ overlay: false, compact: false })
    expect(shellLayout(1099)).toEqual({ overlay: true, compact: false })
    expect(shellLayout(960)).toEqual({ overlay: true, compact: false })
    expect(shellLayout(699)).toEqual({ overlay: true, compact: true })
  })
  it('does not open a floating panel by itself, but keeps a remembered choice', () => {
    expect(assistantPanelOpen(null, true, true)).toBe(false)
    expect(assistantPanelOpen(true, true, true)).toBe(true)
    expect(assistantPanelOpen(false, true, false)).toBe(false)
  })
})
