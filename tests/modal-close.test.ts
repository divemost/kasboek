import { describe, expect, it } from 'vitest'
import { closeAction } from '@shared/modal-close'

describe('closing a dialog', () => {
  it('ignores a click on the background unless the dialog opted in', () => {
    expect(closeAction({ source: 'backdrop' })).toBe('ignore')
    expect(closeAction({ source: 'backdrop', dirty: true })).toBe('ignore')
    expect(closeAction({ source: 'backdrop', closeOnBackdrop: true })).toBe('close')
  })

  it('closes on Escape and the close button when nothing was typed', () => {
    expect(closeAction({ source: 'escape' })).toBe('close')
    expect(closeAction({ source: 'button', dirty: false })).toBe('close')
  })

  it('asks first on Escape and the close button when something was typed', () => {
    expect(closeAction({ source: 'escape', dirty: true })).toBe('confirm')
    expect(closeAction({ source: 'button', dirty: true })).toBe('confirm')
  })

  it('never closes a dialog that is not dismissible', () => {
    for (const source of ['backdrop', 'escape', 'button'] as const) {
      expect(closeAction({ source, dismissible: false, closeOnBackdrop: true, dirty: true })).toBe('ignore')
    }
  })
})

describe('Tab inside a dialog', () => {
  it('wraps from the last control to the first and back', async () => {
    const { tabWrap } = await import('@shared/modal-close')
    expect(tabWrap(2, 3, false)).toBe('first')
    expect(tabWrap(0, 3, true)).toBe('last')
  })
  it('lets the browser move between controls in the middle', async () => {
    const { tabWrap } = await import('@shared/modal-close')
    expect(tabWrap(1, 3, false)).toBeNull()
    expect(tabWrap(1, 3, true)).toBeNull()
  })
  it('pulls focus in when it is on the dialog itself or outside', async () => {
    const { tabWrap } = await import('@shared/modal-close')
    expect(tabWrap(-1, 3, false)).toBe('first')
    expect(tabWrap(-1, 3, true)).toBe('last')
    expect(tabWrap(-1, 0, false)).toBeNull()
  })
})
