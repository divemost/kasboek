//go:build windows

package main

// The update window: Win32 from Go without cgo, drawn with GDI to look like resources/splash.html
// (the launch window). It runs on its own OS thread with its own message loop. The worker thread
// (the update itself) only changes a small mutex-protected model and posts a message; it never
// touches the window directly, and every wait on the window has a timeout, so a window that dies or
// hangs cannot stop the install.
//
// Sizes below are CSS pixels from splash.html (380x240 window, 240x6 bar, 13 px text, 28 px title),
// multiplied by the screen scale.

import (
	"errors"
	"fmt"
	"math"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

var (
	dllUser32   = syscall.NewLazyDLL("user32.dll")
	dllGdi32    = syscall.NewLazyDLL("gdi32.dll")
	dllShell32  = syscall.NewLazyDLL("shell32.dll")
	dllKernel32 = syscall.NewLazyDLL("kernel32.dll")

	procRegisterClassEx        = dllUser32.NewProc("RegisterClassExW")
	procUnregisterClass        = dllUser32.NewProc("UnregisterClassW")
	procCreateWindowEx         = dllUser32.NewProc("CreateWindowExW")
	procDestroyWindow          = dllUser32.NewProc("DestroyWindow")
	procIsWindow               = dllUser32.NewProc("IsWindow")
	procDefWindowProc          = dllUser32.NewProc("DefWindowProcW")
	procGetMessage             = dllUser32.NewProc("GetMessageW")
	procTranslateMessage       = dllUser32.NewProc("TranslateMessage")
	procDispatchMessage        = dllUser32.NewProc("DispatchMessageW")
	procPostMessage            = dllUser32.NewProc("PostMessageW")
	procSendMessage            = dllUser32.NewProc("SendMessageW")
	procPostQuitMessage        = dllUser32.NewProc("PostQuitMessage")
	procShowWindow             = dllUser32.NewProc("ShowWindow")
	procSetWindowPos           = dllUser32.NewProc("SetWindowPos")
	procSetForegroundWindow    = dllUser32.NewProc("SetForegroundWindow")
	procSetTimer               = dllUser32.NewProc("SetTimer")
	procKillTimer              = dllUser32.NewProc("KillTimer")
	procInvalidateRect         = dllUser32.NewProc("InvalidateRect")
	procBeginPaint             = dllUser32.NewProc("BeginPaint")
	procEndPaint               = dllUser32.NewProc("EndPaint")
	procFillRect               = dllUser32.NewProc("FillRect")
	procDrawText               = dllUser32.NewProc("DrawTextW")
	procLoadCursor             = dllUser32.NewProc("LoadCursorW")
	procDestroyIcon            = dllUser32.NewProc("DestroyIcon")
	procGetDC                  = dllUser32.NewProc("GetDC")
	procReleaseDC              = dllUser32.NewProc("ReleaseDC")
	procSystemParametersInfo   = dllUser32.NewProc("SystemParametersInfoW")
	procGetSystemMetrics       = dllUser32.NewProc("GetSystemMetrics")
	procSetProcessDpiAwareCtx  = dllUser32.NewProc("SetProcessDpiAwarenessContext")
	procSetProcessDPIAware     = dllUser32.NewProc("SetProcessDPIAware")
	procCreateCompatibleDC     = dllGdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = dllGdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = dllGdi32.NewProc("SelectObject")
	procDeleteObject           = dllGdi32.NewProc("DeleteObject")
	procDeleteDC               = dllGdi32.NewProc("DeleteDC")
	procBitBlt                 = dllGdi32.NewProc("BitBlt")
	procGetStockObject         = dllGdi32.NewProc("GetStockObject")
	procSetDCBrushColor        = dllGdi32.NewProc("SetDCBrushColor")
	procRoundRect              = dllGdi32.NewProc("RoundRect")
	procCreateRoundRectRgn     = dllGdi32.NewProc("CreateRoundRectRgn")
	procSelectClipRgn          = dllGdi32.NewProc("SelectClipRgn")
	procCreateFont             = dllGdi32.NewProc("CreateFontW")
	procSetTextColor           = dllGdi32.NewProc("SetTextColor")
	procSetBkColor             = dllGdi32.NewProc("SetBkColor")
	procSetBkMode              = dllGdi32.NewProc("SetBkMode")
	procGetDeviceCaps          = dllGdi32.NewProc("GetDeviceCaps")
	procExtractIconEx          = dllShell32.NewProc("ExtractIconExW")
	procShellExecute           = dllShell32.NewProc("ShellExecuteW")
	procGetModuleHandle        = dllKernel32.NewProc("GetModuleHandleW")
)

const (
	wmDestroy    = 0x0002
	wmPaint      = 0x000F
	wmClose      = 0x0010
	wmEraseBkgnd = 0x0014
	wmLButtonUp  = 0x0202
	wmSetIcon    = 0x0080
	wmTimer      = 0x0113
	wmApp        = 0x8000
	// Worker thread to window: the step changed; close the window.
	wmStateChanged = wmApp + 1
	wmCloseWindow  = wmApp + 2

	wsPopup                   = 0x80000000
	wsExAppWindow             = 0x00040000
	swShowNormal              = 1
	swpNoSize                 = 0x0001
	swpNoMove                 = 0x0002
	swpShowWindow             = 0x0040
	srccopy                   = 0x00CC0020
	dcBrush                   = 18
	nullPen                   = 8
	defaultGuiFont            = 17
	idcArrow                  = 32512
	logPixelsX                = 88
	spiGetWorkArea            = 0x0030
	spiGetClientAreaAnimation = 0x1042
	smCxScreen                = 0
	smCyScreen                = 1
	opaque                    = 2
	cleartypeQuality          = 5
	defaultCharset            = 1
	fwNormal                  = 400
	fwSemibold                = 600
	dtCenter                  = 0x0001
	dtVCenter                 = 0x0004
	dtWordBreak               = 0x0010
	dtSingleLine              = 0x0020
	dtNoPrefix                = 0x0800
	timerID                   = 1
	timerMs                   = 30
	iconSmall                 = 0
	iconBig                   = 1

	className = "KasboekUpdateWindow"

	// CSS pixels, from resources/splash.html (a 380x240 window: a 36 px title row, 18 px gap, 6 px
	// bar, 18 px gap, then the 13 px text). This window is taller, because while Windows Installer
	// takes long it shows more lines under the bar: the text (two lines), the time and action, a
	// hint (two lines), and the release page line with its address.
	cssWidth, cssHeight = 380, 300
	cssTitleTop         = 56
	cssTitleHeight      = 36
	cssBarWidth         = 240
	cssBarHeight        = 6
	cssBarTop           = 110
	cssTextTop          = 134
	cssTextHeight       = 34
	cssDetailTop        = 170
	cssHintTop          = 190
	cssHintHeight       = 34
	cssSlowTop          = 228
	cssLineHeight       = 18
	cssTextMargin       = 20
	cssTitleFont        = 28
	cssTextFont         = 13
	minFillShare        = 0.04 // the fill starts at 4%, as in splash.html
	shineWidthShare     = 0.4
	shineAlpha          = 0.45
)

type point struct{ x, y int32 }
type rect struct{ left, top, right, bottom int32 }

type winMsg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

type paintStruct struct {
	hdc         uintptr
	erase       int32
	paint       rect
	restore     int32
	incUpdate   int32
	rgbReserved [32]byte
}

type wndClassEx struct {
	size       uint32
	style      uint32
	wndProc    uintptr
	clsExtra   int32
	wndExtra   int32
	instance   uintptr
	icon       uintptr
	cursor     uintptr
	background uintptr
	menuName   *uint16
	className  *uint16
	iconSmall  uintptr
}

// The window procedure is called by Windows on the window's thread. There is only one window per
// process, so it finds it here.
var (
	currentWindow atomic.Pointer[window]
	procOnce      sync.Once
	procCallback  uintptr
)

type window struct {
	pl      updatePlan
	palette palette
	// Where the window thread tells startWindow it is ready (buffered, written at most once).
	ready chan error
	// Closed when the window thread has ended.
	done      chan struct{}
	closeOnce sync.Once

	mu        sync.Mutex
	model     uiModel
	hwnd      uintptr // set once the window exists, cleared when its thread ends
	abandoned bool    // startWindow gave up waiting: the thread must not leave a window behind

	// Only the window thread uses these.
	urlRect             rect // where the release page address was drawn (window thread only)
	born                time.Time
	animate             bool
	scale               float64
	width, height       int32
	shown               float64
	titleFont, stepFont uintptr
}

func utf16Ptr(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(strings.ReplaceAll(s, "\x00", ""))
	return p
}

// startWindow opens the update window and waits (at most windowStartTimeout) until it is on screen.
func startWindow(pl updatePlan) (ui, error) {
	w := &window{
		pl:      pl,
		palette: paletteFor(pl.Theme),
		ready:   make(chan error, 1),
		done:    make(chan struct{}),
		born:    time.Now(),
		model:   uiModel{step: stepWaiting, text: pl.text(textWaiting), since: time.Now()},
	}
	go w.run()
	select {
	case err := <-w.ready:
		if err != nil {
			return nil, err
		}
		return w, nil
	case <-time.After(windowStartTimeout):
		w.mu.Lock()
		w.abandoned = true
		h := w.hwnd
		w.mu.Unlock()
		if h != 0 {
			procPostMessage.Call(h, wmCloseWindow, 0, 0)
		}
		return nil, errors.New("the window did not appear in time")
	}
}

func (w *window) signalReady(err error) {
	select {
	case w.ready <- err:
	default:
	}
}

// run is the window thread: it creates the window, runs its message loop and cleans up.
func (w *window) run() {
	runtime.LockOSThread()
	defer close(w.done)
	defer runtime.UnlockOSThread()
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "kasboek-mcp: update window thread: %v\n", r)
			w.signalReady(fmt.Errorf("panic: %v", r))
		}
	}()
	var res winResources
	defer res.release(w)

	if err := w.setup(&res); err != nil {
		w.signalReady(err)
		return
	}
	w.mu.Lock()
	if w.abandoned {
		w.mu.Unlock()
		return
	}
	w.hwnd = res.hwnd
	w.mu.Unlock()
	w.signalReady(nil)

	var m winMsg
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 { // 0: the window was destroyed (WM_QUIT); -1: error
			return
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
}

// winResources are the Windows objects of the window thread, released when it ends.
type winResources struct {
	hwnd                 uintptr
	instance             uintptr
	classRegistered      bool
	iconLarge, iconSmall uintptr
}

func (r *winResources) release(w *window) {
	w.mu.Lock()
	w.hwnd = 0
	w.mu.Unlock()
	currentWindow.CompareAndSwap(w, nil)
	if r.hwnd != 0 {
		if ok, _, _ := procIsWindow.Call(r.hwnd); ok != 0 {
			procDestroyWindow.Call(r.hwnd)
		}
	}
	for _, f := range []uintptr{w.titleFont, w.stepFont} {
		if f != 0 {
			procDeleteObject.Call(f)
		}
	}
	for _, i := range []uintptr{r.iconLarge, r.iconSmall} {
		if i != 0 {
			procDestroyIcon.Call(i)
		}
	}
	if r.classRegistered {
		procUnregisterClass.Call(uintptr(unsafe.Pointer(utf16Ptr(className))), r.instance)
	}
}

// setDPIAware makes the process per-monitor v2 aware (Windows 10 1703 and later), else system aware,
// so the window is drawn sharp and not stretched. The helper has no manifest that does it.
func setDPIAware() {
	if procSetProcessDpiAwareCtx.Find() == nil {
		const perMonitorV2 = ^uintptr(3) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 is (HANDLE)-4
		if r, _, _ := procSetProcessDpiAwareCtx.Call(perMonitorV2); r != 0 {
			return
		}
	}
	if procSetProcessDPIAware.Find() == nil {
		procSetProcessDPIAware.Call()
	}
}

func screenScale() float64 {
	dc, _, _ := procGetDC.Call(0)
	if dc == 0 {
		return 1
	}
	defer procReleaseDC.Call(0, dc)
	dpi, _, _ := procGetDeviceCaps.Call(dc, logPixelsX)
	if dpi < 96 {
		return 1
	}
	return float64(dpi) / 96
}

// animationsOn is false when the person turned animations off in Windows (the reduced-motion setting).
func animationsOn() bool {
	var on int32 = 1
	if r, _, _ := procSystemParametersInfo.Call(spiGetClientAreaAnimation, 0, uintptr(unsafe.Pointer(&on)), 0); r == 0 {
		return true
	}
	return on != 0
}

func (w *window) px(css float64) int32 { return int32(math.Round(css * w.scale)) }

func (w *window) makeFont(face string, cssSize float64, weight int) uintptr {
	h := -w.px(cssSize)
	f, _, _ := procCreateFont.Call(uintptr(h), 0, 0, 0, uintptr(weight), 0, 0, 0, defaultCharset, 0, 0, cleartypeQuality, 0, uintptr(unsafe.Pointer(utf16Ptr(face))))
	if f == 0 {
		f, _, _ = procGetStockObject.Call(defaultGuiFont)
	}
	return f
}

func (w *window) setup(res *winResources) error {
	setDPIAware()
	w.scale = screenScale()
	w.animate = animationsOn()
	w.width, w.height = w.px(cssWidth), w.px(cssHeight)
	w.titleFont = w.makeFont("Georgia", cssTitleFont, fwSemibold)
	w.stepFont = w.makeFont("Segoe UI", cssTextFont, fwNormal)

	inst, _, _ := procGetModuleHandle.Call(0)
	res.instance = inst
	// The icon is Kasboek's own; without it the window just has the default one.
	procExtractIconEx.Call(uintptr(unsafe.Pointer(utf16Ptr(w.pl.Exe))), 0, uintptr(unsafe.Pointer(&res.iconLarge)), uintptr(unsafe.Pointer(&res.iconSmall)), 1)
	cursor, _, _ := procLoadCursor.Call(0, idcArrow)

	procOnce.Do(func() { procCallback = syscall.NewCallback(windowProc) })
	class := wndClassEx{wndProc: procCallback, instance: inst, cursor: cursor, className: utf16Ptr(className)}
	class.size = uint32(unsafe.Sizeof(class))
	if atom, _, err := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
		return fmt.Errorf("RegisterClassEx: %w", err)
	}
	res.classRegistered = true

	x, y := w.centre()
	currentWindow.Store(w)
	hwnd, _, err := procCreateWindowEx.Call(wsExAppWindow, uintptr(unsafe.Pointer(utf16Ptr(className))), uintptr(unsafe.Pointer(utf16Ptr("Kasboek"))), wsPopup,
		uintptr(x), uintptr(y), uintptr(w.width), uintptr(w.height), 0, 0, inst, 0)
	if hwnd == 0 {
		return fmt.Errorf("CreateWindowEx: %w", err)
	}
	res.hwnd = hwnd
	if res.iconLarge != 0 {
		procSendMessage.Call(hwnd, wmSetIcon, iconBig, res.iconLarge)
	}
	if res.iconSmall != 0 {
		procSendMessage.Call(hwnd, wmSetIcon, iconSmall, res.iconSmall)
	}
	if r, _, err := procSetTimer.Call(hwnd, timerID, timerMs, 0); r == 0 {
		return fmt.Errorf("SetTimer: %w", err)
	}

	// Shown twice: the first ShowWindow of a process can be overridden by how the process was
	// started (hidden), the second one cannot. Topmost for a moment so it comes to the front even
	// when Windows would not let a background process take the focus.
	topmost, notTopmost := ^uintptr(0), ^uintptr(1)
	procShowWindow.Call(hwnd, swShowNormal)
	procSetWindowPos.Call(hwnd, topmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpShowWindow)
	procSetForegroundWindow.Call(hwnd)
	procSetWindowPos.Call(hwnd, notTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpShowWindow)
	procShowWindow.Call(hwnd, swShowNormal)
	return nil
}

// centre is the top-left corner that centres the window on the primary monitor's work area.
func (w *window) centre() (int32, int32) {
	var wa rect
	if r, _, _ := procSystemParametersInfo.Call(spiGetWorkArea, 0, uintptr(unsafe.Pointer(&wa)), 0); r == 0 || wa.right <= wa.left || wa.bottom <= wa.top {
		cx, _, _ := procGetSystemMetrics.Call(smCxScreen)
		cy, _, _ := procGetSystemMetrics.Call(smCyScreen)
		wa = rect{0, 0, int32(cx), int32(cy)}
	}
	x := wa.left + (wa.right-wa.left-w.width)/2
	y := wa.top + (wa.bottom-wa.top-w.height)/2
	return max(x, wa.left), max(y, wa.top)
}

// windowProc handles the window's messages. It never lets a panic out into Windows.
func windowProc(hwnd, msg, wParam, lParam uintptr) (result uintptr) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "kasboek-mcp: update window: %v\n", r)
			result, _, _ = procDefWindowProc.Call(hwnd, msg, wParam, lParam)
		}
	}()
	if w := currentWindow.Load(); w != nil {
		switch msg {
		case wmEraseBkgnd:
			return 1 // painted in full by wmPaint, without flicker
		case wmClose:
			return 0 // nobody closes it while the update runs; close() destroys it
		case wmPaint:
			w.paint(hwnd)
			return 0
		case wmTimer:
			w.tick()
			procInvalidateRect.Call(hwnd, 0, 0)
			return 0
		case wmStateChanged:
			w.tick()
			procInvalidateRect.Call(hwnd, 0, 0)
			return 0
		case wmLButtonUp:
			w.click(int32(int16(lParam&0xFFFF)), int32(int16((lParam>>16)&0xFFFF)))
			return 0
		case wmCloseWindow:
			procDestroyWindow.Call(hwnd)
			return 0
		case wmDestroy:
			procKillTimer.Call(hwnd, timerID)
			procPostQuitMessage.Call(0)
			return 0
		}
	}
	result, _, _ = procDefWindowProc.Call(hwnd, msg, wParam, lParam)
	return result
}

// click opens the release page when the address under the bar was clicked.
func (w *window) click(x, y int32) {
	r := w.urlRect
	if r.right <= r.left || x < r.left || x >= r.right || y < r.top || y >= r.bottom {
		return
	}
	procShellExecute.Call(0, uintptr(unsafe.Pointer(utf16Ptr("open"))), uintptr(unsafe.Pointer(utf16Ptr(releaseURL))), 0, 0, swShowNormal)
}

func (w *window) snapshot() uiModel {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.model
}

// tick moves the shown bar toward where it should be.
func (w *window) tick() {
	w.shown = easeToward(w.shown, w.snapshot().progress(time.Now()))
}

func (w *window) fill(dc uintptr, r rect, c colorRef) {
	brush, _, _ := procGetStockObject.Call(dcBrush)
	procSetDCBrushColor.Call(dc, uintptr(c))
	procFillRect.Call(dc, uintptr(unsafe.Pointer(&r)), brush)
}

// roundBar draws a bar with round ends (a pill) from x to x+width.
func (w *window) roundBar(dc uintptr, x, y, width, height int32, c colorRef) {
	brush, _, _ := procGetStockObject.Call(dcBrush)
	pen, _, _ := procGetStockObject.Call(nullPen)
	procSetDCBrushColor.Call(dc, uintptr(c))
	oldBrush, _, _ := procSelectObject.Call(dc, brush)
	oldPen, _, _ := procSelectObject.Call(dc, pen)
	// With no pen the shape stops one pixel short on the right and bottom.
	procRoundRect.Call(dc, uintptr(x), uintptr(y), uintptr(x+width+1), uintptr(y+height+1), uintptr(height), uintptr(height))
	procSelectObject.Call(dc, oldPen)
	procSelectObject.Call(dc, oldBrush)
}

func (w *window) text(dc uintptr, font uintptr, c colorRef, s string, r rect, flags uintptr) {
	old, _, _ := procSelectObject.Call(dc, font)
	procSetTextColor.Call(dc, uintptr(c))
	procSetBkColor.Call(dc, uintptr(w.palette.bg))
	procSetBkMode.Call(dc, opaque)
	procDrawText.Call(dc, uintptr(unsafe.Pointer(utf16Ptr(s))), ^uintptr(0), uintptr(unsafe.Pointer(&r)), flags)
	procSelectObject.Call(dc, old)
}

// paint draws everything into an off-screen bitmap and copies it to the window in one go.
func (w *window) paint(hwnd uintptr) {
	var ps paintStruct
	hdc, _, _ := procBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	if hdc == 0 {
		return
	}
	defer func() { procEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps))) }()
	mem, _, _ := procCreateCompatibleDC.Call(hdc)
	if mem == 0 {
		return
	}
	defer procDeleteDC.Call(mem)
	bmp, _, _ := procCreateCompatibleBitmap.Call(hdc, uintptr(w.width), uintptr(w.height))
	if bmp == 0 {
		return
	}
	defer procDeleteObject.Call(bmp)
	old, _, _ := procSelectObject.Call(mem, bmp)
	defer procSelectObject.Call(mem, old)

	w.draw(mem, w.snapshot())
	procBitBlt.Call(hdc, 0, 0, uintptr(w.width), uintptr(w.height), mem, 0, 0, srccopy)
}

func (w *window) draw(dc uintptr, m uiModel) {
	p := w.palette
	full := rect{0, 0, w.width, w.height}
	w.fill(dc, full, p.bg)
	// A one pixel edge, so the window stands out on a dark desktop.
	edge := int32(math.Max(1, math.Round(w.scale/1.5)))
	w.fill(dc, rect{0, 0, w.width, edge}, p.track)
	w.fill(dc, rect{0, w.height - edge, w.width, w.height}, p.track)
	w.fill(dc, rect{0, 0, edge, w.height}, p.track)
	w.fill(dc, rect{w.width - edge, 0, w.width, w.height}, p.track)

	w.text(dc, w.titleFont, p.text, "Kasboek", rect{0, w.px(cssTitleTop), w.width, w.px(cssTitleTop + cssTitleHeight)}, dtCenter|dtVCenter|dtSingleLine|dtNoPrefix)

	now := time.Now()
	v := m.viewAt(now, w.pl)
	failed := m.step == stepFailed
	fillColor, textColor := p.accent, p.muted
	if failed {
		fillColor, textColor = p.danger, p.danger
	}
	barX, barY := (w.width-w.px(cssBarWidth))/2, w.px(cssBarTop)
	barW, barH := w.px(cssBarWidth), w.px(cssBarHeight)
	w.roundBar(dc, barX, barY, barW, barH, p.track)
	if v.moving && w.animate {
		// Windows Installer takes long: no share is claimed, a piece of the bar moves back and forth.
		pieceW := int32(math.Round(float64(barW) * movingShare))
		x := barX + int32(math.Round(movingPos(now.Sub(m.since))*float64(barW-pieceW)))
		w.roundBar(dc, x, barY, pieceW, barH, fillColor)
	} else {
		share := math.Max(minFillShare, math.Min(1, w.shown))
		fillW := max(int32(math.Round(float64(barW)*share)), barH)
		w.roundBar(dc, barX, barY, fillW, barH, fillColor)
		if w.animate && !failed {
			w.shine(dc, barX, barY, fillW, barH, fillColor)
		}
	}

	margin := w.px(cssTextMargin)
	line := func(top, height int, c colorRef, s string) rect {
		r := rect{margin, w.px(float64(top)), w.width - margin, w.px(float64(top + height))}
		w.text(dc, w.stepFont, c, s, r, dtCenter|dtWordBreak|dtNoPrefix)
		return r
	}
	line(cssTextTop, cssTextHeight, textColor, v.text)
	w.urlRect = rect{}
	if v.detail != "" {
		line(cssDetailTop, cssLineHeight, textColor, v.detail)
	}
	if v.hint != "" {
		line(cssHintTop, cssHintHeight, textColor, v.hint)
	}
	if v.slow != "" {
		line(cssSlowTop, cssLineHeight, textColor, v.slow)
		// The address is drawn as a link: click it to open the release page.
		w.urlRect = line(cssSlowTop+cssLineHeight, cssLineHeight, p.accent, v.url)
	}
}

// shine is the light band that sweeps over the fill, drawn as one pixel wide columns, clipped to
// the fill's rounded shape.
func (w *window) shine(dc uintptr, barX, barY, fillW, barH int32, base colorRef) {
	bandW := float64(fillW) * shineWidthShare
	if bandW < 1 {
		return
	}
	left := float64(barX) + shinePos(time.Since(w.born))*bandW
	from, to := int32(math.Max(left, float64(barX))), int32(math.Min(left+bandW, float64(barX+fillW)))
	if from >= to {
		return
	}
	region, _, _ := procCreateRoundRectRgn.Call(uintptr(barX), uintptr(barY), uintptr(barX+fillW+1), uintptr(barY+barH+1), uintptr(barH), uintptr(barH))
	if region == 0 {
		return
	}
	defer procDeleteObject.Call(region)
	procSelectClipRgn.Call(dc, region)
	defer procSelectClipRgn.Call(dc, 0)
	for x := from; x < to; x++ {
		u := (float64(x) + 0.5 - left) / bandW
		alpha := shineAlpha * (1 - math.Abs(2*u-1))
		w.fill(dc, rect{x, barY, x + 1, barY + barH}, blend(base, alpha))
	}
}

// set is called by the update (the worker thread): the model changes and the window is told.
func (w *window) set(s step, text string) {
	w.mu.Lock()
	w.model = w.model.to(s, text, time.Now())
	h := w.hwnd
	w.mu.Unlock()
	if h != 0 {
		procPostMessage.Call(h, wmStateChanged, 0, 0)
	}
}

func (w *window) waiting()       { w.set(stepWaiting, w.pl.text(textWaiting)) }
func (w *window) disconnecting() { w.set(stepDisconnecting, w.pl.text(textDisconnecting)) }

// logActivity records that the install log moved on (called from the worker thread).
func (w *window) logActivity(action string) {
	w.mu.Lock()
	w.model = w.model.withLog(action, time.Now())
	w.mu.Unlock()
}
func (w *window) installing()     { w.set(stepInstalling, w.pl.text(textInstalling)) }
func (w *window) starting()       { w.set(stepStarting, w.pl.text(textStarting)) }
func (w *window) failed(m string) { w.set(stepFailed, m) }

// close gives the person time to read an error, then destroys the window and waits (at most a few
// seconds) until its thread has ended. Calling it again does nothing.
func (w *window) close() {
	w.closeOnce.Do(func() {
		m := w.snapshot()
		if m.step == stepFailed {
			if rest := failedShown - time.Since(m.since); rest > 0 {
				select {
				case <-w.done:
				case <-time.After(rest):
				}
			}
		}
		w.mu.Lock()
		h := w.hwnd
		w.mu.Unlock()
		if h != 0 {
			procPostMessage.Call(h, wmCloseWindow, 0, 0)
		}
		select {
		case <-w.done:
		case <-time.After(3 * time.Second):
			fmt.Fprintln(os.Stderr, "kasboek-mcp: the update window did not close in time")
		}
	})
}
