import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARK_PATH } from '@shared/brand'
import { splashHtml } from '../src/main/splash-page'

const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8')

describe('the Kasboek mark', () => {
  it('is the serif K of the app icon everywhere it is drawn', () => {
    expect(read('assets/brand/icon.svg')).toContain(MARK_PATH)
    expect(read('assets/brand/mark.svg')).toContain(MARK_PATH)
    expect(read('resources/splash.html')).toContain(MARK_PATH)
    expect(splashHtml(false)).toContain(MARK_PATH)
  })
})
