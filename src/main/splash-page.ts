/**
 * The launch window's page, built as one string: nothing to read from disk, no script, so it can show
 * at once. The theme is part of the page (no light flash in dark mode). Progress is set from the main
 * process with progressScript().
 */

import { MARK_PATH, MARK_VIEWBOX } from '@shared/brand'

const COLORS = {
  light: { bg: '#fafaf8', text: '#18201b', muted: '#5f6b63', track: '#e6e8e4', accent: '#15803d' },
  dark: { bg: '#0e110f', text: '#e7ece8', muted: '#8e9a92', track: '#262c28', accent: '#3fcf8e' }
} as const

/** The first bar position and text, before the main process sends the first update. */
const FIRST_PERCENT = 6
const FIRST_TEXT = 'Starting…'

export function splashHtml(dark: boolean): string {
  const c = COLORS[dark ? 'dark' : 'light']
  return `<!doctype html>
<html lang="en" class="${dark ? 'dark' : 'light'}" style="background:${c.bg}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="color-scheme" content="${dark ? 'dark' : 'light'}">
<title>Kasboek</title>
<style>
:root { --bg: ${c.bg}; --text: ${c.text}; --muted: ${c.muted}; --track: ${c.track}; --accent: ${c.accent}; color-scheme: ${dark ? 'dark' : 'light'}; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; -webkit-user-select: none; user-select: none; cursor: default; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; -webkit-app-region: drag; }
.logo { display: flex; align-items: center; gap: 12px; }
.name { font-family: Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 600; letter-spacing: -0.01em; }
svg path { opacity: 0; animation: appear 0.9s ease-out forwards; }
svg { animation: breathe 2.4s ease-in-out 1.6s infinite; }
@keyframes appear { to { opacity: 1; } }
@keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.bar { position: relative; width: 240px; height: 6px; border-radius: 6px; background: var(--track); overflow: hidden; }
.fill { position: absolute; inset: 0 auto 0 0; width: ${FIRST_PERCENT}%; border-radius: 6px; background: var(--accent); transition: width 0.35s ease; }
.shine { position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent); width: 40%; animation: shine 1.3s ease-in-out infinite; }
@keyframes shine { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
.step { font-size: 13px; color: var(--muted); min-height: 18px; }
@media (prefers-reduced-motion: reduce) { svg, svg path, .shine { animation: none !important; } svg path { opacity: 1; } .fill { transition: none; } }
</style>
</head>
<body>
<div class="logo" aria-hidden="true">
<svg width="34" height="34" viewBox="${MARK_VIEWBOX}" fill="var(--accent)"><path d="${MARK_PATH}" /></svg>
<span class="name">Kasboek</span>
</div>
<div class="bar" role="progressbar" aria-label="Loading Kasboek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${FIRST_PERCENT}">
<div class="fill" id="fill"><div class="shine"></div></div>
</div>
<div class="step" id="step">${FIRST_TEXT}</div>
</body>
</html>`
}

/** The address that loads the page. */
export function splashUrl(dark: boolean): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml(dark))
}

/** Sets the bar and the text in the loaded page. Runs through executeJavaScript, so the page needs no script of its own. */
export function progressScript(fraction: number, text: string): string {
  const pct = Math.max(FIRST_PERCENT, Math.min(100, Math.round(fraction * 100)))
  return `(function () {
  var fill = document.getElementById('fill'), step = document.getElementById('step'), bar = document.querySelector('.bar');
  if (fill) fill.style.width = '${pct}%';
  if (bar) bar.setAttribute('aria-valuenow', '${pct}');
  if (step) step.textContent = ${JSON.stringify(text)};
})()`
}

/** Resolves when the page has produced two frames, i.e. the person can really see it. */
export const PAINTED_SCRIPT = 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'
