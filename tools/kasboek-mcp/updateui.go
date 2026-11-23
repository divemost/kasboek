package main

// The parts of the update window that need no Windows: what the bar shows over time, the colours,
// the texts, and how a failing or panicking window is kept from stopping the update. The window
// itself is in updatewin_windows.go; it follows resources/splash.html (the launch window).

import (
	"fmt"
	"math"
	"strings"
	"time"
)

type step int

const (
	stepWaiting step = iota
	stepDisconnecting
	stepInstalling
	stepStarting
	stepFailed
)

const (
	// The bar moves toward installBarMax over about this many seconds while Windows Installer runs.
	installSeconds = 40
	waitingBar     = 0.1
	installBarMax  = 0.9
	// What the person gets to read when the update did not go in.
	failedShown = 5 * time.Second
	// The window has this long to show up, else the update runs with Windows Installer's own dialog.
	windowStartTimeout = 2 * time.Second
	shineCycle         = 1300 * time.Millisecond

	// Windows Installer can take minutes. The curve above only fits a normal install: after
	// movingAfter the bar stops claiming a share and just moves, and the window says so. After
	// noProgressAfter without anything new in the install log it adds a hint, and after slowAfter
	// it points to the release page.
	movingAfter     = 45 * time.Second
	noProgressAfter = 60 * time.Second
	slowAfter       = 3 * time.Minute
	movingCycle     = 1800 * time.Millisecond
	movingShare     = 0.35 // the moving piece's share of the bar
	// releaseURL is where the person can get the installer by hand.
	releaseURL = "https://github.com/divemost/kasboek/releases/latest"
)

// progressAt is how far the bar is in a step, `elapsed` after the step began. It is honest about
// phases and does not follow msiexec: waiting 0.1, installing slowly toward 0.9 (never past it),
// starting 1. A failed step has no curve of its own (see uiModel).
func progressAt(s step, elapsed time.Duration) float64 {
	switch s {
	case stepWaiting, stepDisconnecting:
		return waitingBar
	case stepInstalling:
		if elapsed < 0 {
			elapsed = 0
		}
		p := waitingBar + (installBarMax-waitingBar)*(1-math.Exp(-3*elapsed.Seconds()/installSeconds))
		return math.Min(p, installBarMax)
	case stepStarting:
		return 1
	}
	return 0
}

// shinePos is where the moving shine is, as a multiple of its own width from the left edge of the
// bar's fill: the same movement as splash.html's `shine` animation (translateX -100% to 260%
// every 1.3 s, ease-in-out).
func shinePos(elapsed time.Duration) float64 {
	phase := float64(elapsed%shineCycle) / float64(shineCycle)
	if phase < 0 {
		phase += 1
	}
	return -1 + 3.6*(phase*phase*(3-2*phase))
}

// uiModel is what the window shows. The worker thread changes it, the window thread reads it.
type uiModel struct {
	step   step
	text   string
	since  time.Time
	frozen float64 // the bar when the update failed
	// The install log: when it last changed, and the Windows Installer action it names.
	lastLog time.Time
	action  string
}

// withLog records that the install log moved on.
func (m uiModel) withLog(action string, now time.Time) uiModel {
	m.lastLog = now
	if action != "" {
		m.action = action
	}
	return m
}

// view is what the window draws at `now`.
type view struct {
	progress float64
	moving   bool   // the bar only moves, it shows no share
	text     string // the main line
	detail   string // time elapsed and Windows Installer's action
	hint     string // nothing new in the log for a while
	slow     string // a long wait: the release page
	url      string
}

// elapsedText is a duration as m:ss (h:mm:ss from an hour).
func elapsedText(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	s := int(d.Seconds())
	if s >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", s/3600, s%3600/60, s%60)
	}
	return fmt.Sprintf("%d:%02d", s/60, s%60)
}

// viewAt is the window's content: the step's text and bar, and while Windows Installer runs long
// the honest version of it (see movingAfter).
func (m uiModel) viewAt(now time.Time, pl updatePlan) view {
	v := view{progress: m.progress(now), text: m.text}
	if m.step != stepInstalling {
		return v
	}
	elapsed := now.Sub(m.since)
	if elapsed >= movingAfter {
		v.moving = true
		v.text = pl.text(textStillWorking)
		v.detail = elapsedText(elapsed)
		if m.action != "" {
			v.detail += " · " + m.action
		}
	}
	quiet := m.lastLog
	if quiet.Before(m.since) {
		quiet = m.since
	}
	if now.Sub(quiet) >= noProgressAfter {
		v.hint = pl.text(textNoProgress)
	}
	if elapsed >= slowAfter {
		v.slow = pl.text(textSlow)
		v.url = releaseURL
	}
	return v
}

// movingPos is where the moving piece is on the bar, 0 (left end) to 1 (right end), back and forth
// with a smooth turn at both ends.
func movingPos(elapsed time.Duration) float64 {
	phase := float64(elapsed%movingCycle) / float64(movingCycle)
	if phase < 0 {
		phase += 1
	}
	tri := 1 - math.Abs(2*phase-1) // 0 -> 1 -> 0
	return tri * tri * (3 - 2*tri)
}

func (m uiModel) progress(now time.Time) float64 {
	if m.step == stepFailed {
		return m.frozen
	}
	return progressAt(m.step, now.Sub(m.since))
}

// to moves to another step. A failure stays on screen: the steps after it (opening Kasboek again)
// do not replace the message.
func (m uiModel) to(s step, text string, now time.Time) uiModel {
	if m.step == stepFailed && s != stepFailed {
		return m
	}
	if s == m.step {
		m.text = text
		return m
	}
	frozen := m.frozen
	if s == stepFailed {
		frozen = m.progress(now)
	}
	return uiModel{step: s, text: text, since: now, frozen: frozen}
}

// colorRef is a Windows COLORREF: 0x00BBGGRR.
type colorRef uint32

func rgb(r, g, b uint8) colorRef { return colorRef(r) | colorRef(g)<<8 | colorRef(b)<<16 }

// palette is splash.html's :root and :root.dark colours, plus the app's "negative" colour for errors.
type palette struct {
	bg, text, muted, track, accent, danger colorRef
}

var (
	lightPalette = palette{bg: rgb(0xfa, 0xfa, 0xf8), text: rgb(0x18, 0x20, 0x1b), muted: rgb(0x5f, 0x6b, 0x63), track: rgb(0xe6, 0xe8, 0xe4), accent: rgb(0x15, 0x80, 0x3d), danger: rgb(0xb4, 0x23, 0x18)}
	darkPalette  = palette{bg: rgb(0x0e, 0x11, 0x0f), text: rgb(0xe7, 0xec, 0xe8), muted: rgb(0x8e, 0x9a, 0x92), track: rgb(0x26, 0x2c, 0x28), accent: rgb(0x3f, 0xcf, 0x8e), danger: rgb(0xf2, 0x86, 0x7a)}
)

func paletteFor(theme string) palette {
	if theme == "dark" {
		return darkPalette
	}
	return lightPalette
}

// blend mixes white into c: alpha 0 is c, 1 is white.
func blend(c colorRef, alpha float64) colorRef {
	mix := func(v uint8) uint8 { return uint8(math.Round(float64(v)*(1-alpha) + 255*alpha)) }
	return rgb(mix(uint8(c)), mix(uint8(c>>8)), mix(uint8(c>>16)))
}

type textKey int

const (
	textWaiting textKey = iota
	textInstalling
	textStarting
	textFailed
	textCancelled
	textNotClosed
	textDisconnecting
	textStillWorking
	textNoProgress
	textSlow
)

// Used when the plan has no text (an empty one must not leave the window blank).
var fallbackTexts = map[textKey]string{
	textWaiting:    "Waiting for Kasboek to close…",
	textInstalling: "Installing Kasboek {{version}}…",
	textStarting:   "Starting Kasboek…",
	textFailed:     "The update could not be installed. Kasboek is starting again.",
	textCancelled:  "The update was cancelled. Kasboek is starting again.",
	textNotClosed:  "Kasboek did not close in time, so the update was not installed. Kasboek is opening again.",

	textDisconnecting: "Disconnecting Claude from Kasboek…",
	textStillWorking:  "Windows Installer is still working (this can take several minutes).",
	textNoProgress:    "Nothing new for a minute. If a Claude app is open, closing it may help.",
	textSlow:          "Taking long? Download it from the release page:",
}

// text is the plan's text for a step, or the English one when the plan has none. {{version}} (or
// {version}) becomes the new version; without a version it just disappears.
func (pl updatePlan) text(k textKey) string {
	raw := ""
	switch k {
	case textWaiting:
		raw = pl.Texts.Waiting
	case textInstalling:
		raw = pl.Texts.Installing
	case textStarting:
		raw = pl.Texts.Starting
	case textFailed:
		raw = pl.Texts.Failed
	case textCancelled:
		raw = pl.Texts.Cancelled
	case textNotClosed:
		raw = pl.Texts.NotClosed
	case textDisconnecting:
		raw = pl.Texts.Disconnecting
	case textStillWorking:
		raw = pl.Texts.StillWorking
	case textNoProgress:
		raw = pl.Texts.NoProgress
	case textSlow:
		raw = pl.Texts.Slow
	}
	if strings.TrimSpace(raw) == "" {
		raw = fallbackTexts[k]
	}
	raw = strings.NewReplacer("{{version}}", pl.ToVersion, "{version}", pl.ToVersion).Replace(raw)
	return strings.Join(strings.Fields(raw), " ")
}

// A window is a nicety: whatever goes wrong in it must never stop the install or the relaunch.
type guardedUI struct{ inner ui }

func guard(name string, f func()) {
	defer func() {
		if r := recover(); r != nil {
			logf("update window %s: %v", name, r)
		}
	}()
	f()
}

func (g guardedUI) waiting()             { guard("waiting", g.inner.waiting) }
func (g guardedUI) disconnecting()       { guard("disconnecting", g.inner.disconnecting) }
func (g guardedUI) installing()          { guard("installing", g.inner.installing) }
func (g guardedUI) starting()            { guard("starting", g.inner.starting) }
func (g guardedUI) failed(m string)      { guard("failed", func() { g.inner.failed(m) }) }
func (g guardedUI) logActivity(a string) { guard("logActivity", func() { g.inner.logActivity(a) }) }
func (g guardedUI) close()               { guard("close", g.inner.close) }

// uiStarter shows the update window, or says why it can't.
type uiStarter func(pl updatePlan) (ui, error)

// chooseUI starts the window. The second result is whether Windows Installer must show its own
// progress dialog (/passive): true when there is no window of ours (it did not start, panicked or
// took too long), false when the window is up and msiexec can stay silent (/qn).
func chooseUI(pl updatePlan, start uiStarter) (ui, bool) {
	var u ui
	var err error
	func() {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("panic: %v", r)
			}
		}()
		u, err = start(pl)
	}()
	if err != nil || u == nil {
		logf("no update window, Windows Installer shows its own: %v", err)
		return noUI{}, true
	}
	return guardedUI{u}, false
}

// applyPlan is the update for a checked plan: with our window and a silent msiexec, or with
// Windows Installer's own dialog when there is no window.
func applyPlan(p platform, pl updatePlan, t timing, start uiStarter, proc kasboekProc) error {
	u, passive := chooseUI(pl, start)
	return runUpdate(p, u, pl, t, passive, proc)
}

// easeToward moves the bar that is shown a part of the way to where it should be, like the launch
// window's 0.35 s width transition. It never goes back and never past the target.
func easeToward(shown, target float64) float64 {
	if target <= shown {
		return shown
	}
	next := shown + (target-shown)*0.2
	if target-next < 0.002 {
		return target
	}
	return next
}
