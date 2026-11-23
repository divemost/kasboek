// Takes the README screenshots of the real Kasboek window with invented data.
//
//   npm run build            (once: builds the renderer into out/renderer)
//   npm run screenshots      (all screens, light and dark, into docs/screenshots)
//   npm run screenshots -- --only overview,budgets --out /some/dir
//
// The built renderer runs in Chromium (playwright) with `window.kasboek` replaced by bridge.mjs and a
// fixed clock, so nothing real is read and the pictures are the same on every run. See README.md.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { buildData, TODAY } from './data.mjs'
import { installBridge } from './bridge.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const sharp = require('sharp')

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const outDir = resolve(arg('out') ?? join(root, 'docs', 'screenshots'))
const rendererDir = resolve(arg('renderer') ?? join(root, 'out', 'renderer'))
const only = arg('only')?.split(',')
if (!existsSync(join(rendererDir, 'index.html'))) {
  console.error(`No built renderer in ${rendererDir}. Run "npm run build" first.`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.json': 'application/json' }
const server = createServer((req, res) => {
  const file = join(rendererDir, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]))
  if (!file.startsWith(rendererDir) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`

const data = buildData()
console.log(`${data.stats.transactions} invented transactions`)

const nav = (tour) => async (page) => page.click(`[data-tour="${tour}"]`)
const closePanel = async (page) => {
  if ((await page.getAttribute('[data-tour="assistant"]', 'aria-pressed')) === 'true') await page.click('[data-tour="assistant"]')
}

// name: file name; run(page): what to do after the app has started; panel: leave the assistant panel open.
const SHOTS = [
  { name: 'overview', run: async () => {} },
  {
    name: 'transactions',
    run: async (page) => {
      await nav('transactions')(page)
      await page.locator('select', { has: page.locator('option', { hasText: 'Oct groceries' }) }).selectOption({ label: 'Oct groceries' })
    }
  },
  { name: 'budgets', run: nav('budgets') },
  { name: 'fixed-costs', run: nav('recurring') },
  { name: 'goals', run: nav('goals') },
  { name: 'net-worth', run: nav('accounts') },
  { name: 'year', run: nav('year') },
  { name: 'import-csv', import: 'csv', run: nav('import') },
  { name: 'import-pdf', import: 'pdf', run: nav('import') },
  {
    name: 'settings-assistant',
    run: async (page) => {
      await nav('settings')(page)
      await page.getByRole('tab', { name: 'Assistant' }).click()
    }
  },
  { name: 'assistant', panel: true, run: async () => {} },
  { name: 'lock', auth: { state: 'locked' }, ready: 'form', noShell: true, run: async () => {} }
]

const browser = await chromium.launch()
for (const theme of ['light', 'dark']) {
  for (const shot of SHOTS) {
    if (only && !only.includes(shot.name)) continue
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', colorScheme: theme })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.warn(`[${shot.name}-${theme}] page error:`, e.message))
    await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`))
    await page.addInitScript(installBridge, { data, scenario: { theme, auth: shot.auth, import: shot.import } })
    await page.goto(url)
    await page.waitForSelector(shot.noShell ? 'form' : '[data-tour="overview"]')
    if (!shot.noShell) {
      await page.waitForSelector('main h1')
      if (!shot.panel) await closePanel(page)
      await shot.run(page)
    }
    await page.evaluate(() => document.fonts.ready)
    await page.addStyleTag({ content: '* { caret-color: transparent !important; transition: none !important; animation: none !important; }' })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(600)
    const raw = await page.screenshot()
    // Palette PNG: the same picture at a fraction of the size.
    const file = join(outDir, `${shot.name}-${theme}.png`)
    await sharp(raw).png({ palette: true, quality: 100, dither: 1, effort: 10, compressionLevel: 9 }).toFile(file)
    console.log(`${shot.name}-${theme}.png ${(statSync(file).size / 1024).toFixed(0)} KB`)
    await ctx.close()
  }
}
await browser.close()
server.close()
