package main

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

// startNoWindow is a window that "starts" without showing anything (for tests of the whole update).
func startNoWindow(updatePlan) (ui, error) { return &fakeUI{}, nil }

// panicUI is a window that panics in every call.
type panicUI struct{}

func (panicUI) waiting()           { panic("waiting") }
func (panicUI) disconnecting()     { panic("disconnecting") }
func (panicUI) logActivity(string) { panic("logActivity") }
func (panicUI) installing()        { panic("installing") }
func (panicUI) starting()          { panic("starting") }
func (panicUI) failed(string)      { panic("failed") }
func (panicUI) close()             { panic("close") }

func TestProgressCurve(t *testing.T) {
	if progressAt(stepWaiting, time.Hour) != 0.1 || progressAt(stepStarting, 0) != 1 {
		t.Fatal("waiting must be 0.1 and starting 1")
	}
	if progressAt(stepInstalling, 0) != 0.1 || progressAt(stepInstalling, -time.Second) != 0.1 {
		t.Fatal("installing starts where waiting ended")
	}
	prev := -1.0
	for ms := 0; ms <= 10*60*1000; ms += 250 {
		p := progressAt(stepInstalling, time.Duration(ms)*time.Millisecond)
		if p < prev {
			t.Fatalf("went back at %d ms: %v < %v", ms, p, prev)
		}
		if p < 0 || p > 0.9 {
			t.Fatalf("out of range at %d ms: %v", ms, p)
		}
		prev = p
	}
	if p := progressAt(stepInstalling, 40*time.Second); p < 0.8 || p > 0.9 {
		t.Fatalf("after the expected 40 s it should be near the end of its range, got %v", p)
	}
	if progressAt(stepInstalling, 5*time.Second) != progressAt(stepInstalling, 5*time.Second) || progressAt(stepInstalling, 5*time.Second) >= progressAt(stepInstalling, 6*time.Second) {
		t.Fatal("same input, same output; and it keeps moving while installing")
	}
	if progressAt(stepFailed, time.Second) < 0 {
		t.Fatal("negative")
	}
}

func TestModelNeverGoesBackAndFailureStays(t *testing.T) {
	t0 := time.Now()
	m := uiModel{step: stepWaiting, text: "w", since: t0}
	m = m.to(stepInstalling, "i", t0.Add(time.Second))
	if m.step != stepInstalling || m.since != t0.Add(time.Second) {
		t.Fatalf("%+v", m)
	}
	// The same step again changes the text, not the clock.
	m = m.to(stepInstalling, "i2", t0.Add(5*time.Second))
	if m.text != "i2" || m.since != t0.Add(time.Second) {
		t.Fatalf("%+v", m)
	}
	at := t0.Add(20 * time.Second)
	before := m.progress(at)
	m = m.to(stepFailed, "failed", at)
	if m.progress(at.Add(time.Hour)) != before {
		t.Fatalf("a failed bar must stay where it was: %v vs %v", m.progress(at.Add(time.Hour)), before)
	}
	m = m.to(stepStarting, "starting", at.Add(time.Second))
	if m.step != stepFailed || m.text != "failed" {
		t.Fatalf("starting replaced the message: %+v", m)
	}
}

func TestEaseTowardIsMonotonicAndLands(t *testing.T) {
	shown := 0.0
	for i := 0; i < 200; i++ {
		next := easeToward(shown, 0.9)
		if next < shown || next > 0.9 {
			t.Fatalf("step %d: %v -> %v", i, shown, next)
		}
		shown = next
	}
	if shown != 0.9 {
		t.Fatalf("did not arrive: %v", shown)
	}
	if easeToward(0.8, 0.5) != 0.8 {
		t.Fatal("went back")
	}
}

func TestShinePosStaysInItsRange(t *testing.T) {
	for ms := 0; ms < 5000; ms += 7 {
		if p := shinePos(time.Duration(ms) * time.Millisecond); p < -1 || p > 2.6 {
			t.Fatalf("%d ms: %v", ms, p)
		}
	}
	if shinePos(0) != -1 || shinePos(shineCycle) != -1 {
		t.Fatal("a cycle starts fully to the left")
	}
}

func TestPaletteFollowsTheTheme(t *testing.T) {
	// splash.html: --bg #fafaf8 / #0e110f, --accent #15803d / #3fcf8e. COLORREF is 0x00BBGGRR.
	if p := paletteFor("light"); p.bg != 0xf8fafa || p.accent != 0x3d8015 {
		t.Fatalf("light %+v", p)
	}
	if p := paletteFor("dark"); p.bg != 0x0f110e || p.accent != 0x8ecf3f {
		t.Fatalf("dark %+v", p)
	}
	for _, theme := range []string{"", "system", "nonsense"} {
		if paletteFor(theme) != lightPalette {
			t.Errorf("%q should be light", theme)
		}
	}
	if blend(0x123456, 0) != 0x123456 || blend(0x123456, 1) != 0xffffff {
		t.Fatal("blend ends")
	}
}

func TestPlanTexts(t *testing.T) {
	pl := updatePlan{ToVersion: "1.2.0"}
	for k, want := range map[textKey]string{
		textWaiting:    "Waiting for Kasboek to close…",
		textInstalling: "Installing Kasboek 1.2.0…",
		textStarting:   "Starting Kasboek…",
		textFailed:     "The update could not be installed. Kasboek is starting again.",
		textCancelled:  "The update was cancelled. Kasboek is starting again.",
		textNotClosed:  "Kasboek did not close in time, so the update was not installed. Kasboek is opening again.",
	} {
		if got := pl.text(k); got != want {
			t.Errorf("empty plan, %d: %q, want %q", k, got, want)
		}
	}
	pl.Texts.Installing = "Kasboek {{version}} wordt geïnstalleerd… ({version})"
	pl.Texts.Failed = "   "
	if got := pl.text(textInstalling); got != "Kasboek 1.2.0 wordt geïnstalleerd… (1.2.0)" {
		t.Fatalf("%q", got)
	}
	if !strings.HasPrefix(pl.text(textFailed), "The update could not") {
		t.Fatal("a blank text must fall back")
	}
	pl.Texts.Starting = "Kasboek wordt gestart…"
	if pl.text(textStarting) != "Kasboek wordt gestart…" {
		t.Fatal("no placeholder: unchanged")
	}
	pl.ToVersion = ""
	if got := pl.text(textInstalling); strings.Contains(got, "{") || strings.Contains(got, "  ") {
		t.Fatalf("no version: %q", got)
	}
}

// The three tests below run the whole update with a fake platform and a fake window.

func TestWindowThatWorksMeansSilentMsiexec(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{0}}
	u := &fakeUI{}
	if err := applyPlan(f, pl, testTiming(new([]time.Duration)), func(updatePlan) (ui, error) { return u, nil }, openKasboek(f, pl.PID)); err != nil {
		t.Fatal(err)
	}
	if want := [][]string{{"/i", pl.MSI, "/qn", "/norestart", "/l*v", pl.Log}}; !reflect.DeepEqual(f.msiexecRuns, want) {
		t.Fatalf("msiexec %v, want %v", f.msiexecRuns, want)
	}
	if !reflect.DeepEqual(u.events, []string{"waiting", "installing", "starting", "close"}) {
		t.Fatalf("ui %v", u.events)
	}
}

func TestWindowThatFailsToStartMeansWindowsInstallerShowsItsOwn(t *testing.T) {
	failures := map[string]uiStarter{
		"error":    func(updatePlan) (ui, error) { return nil, errors.New("no desktop") },
		"nil":      func(updatePlan) (ui, error) { return nil, nil },
		"panicked": func(updatePlan) (ui, error) { panic("boom") },
	}
	for name, start := range failures {
		t.Run(name, func(t *testing.T) {
			pl := testPlan(t)
			f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{0}}
			if err := applyPlan(f, pl, testTiming(new([]time.Duration)), start, openKasboek(f, pl.PID)); err != nil {
				t.Fatal(err)
			}
			if want := [][]string{{"/i", pl.MSI, "/passive", "/norestart", "/l*v", pl.Log}}; !reflect.DeepEqual(f.msiexecRuns, want) {
				t.Fatalf("msiexec %v, want %v", f.msiexecRuns, want)
			}
			if len(f.started) != 1 {
				t.Fatal("Kasboek was not opened again")
			}
		})
	}
}

func TestPanickingWindowDoesNotStopInstallOrRelaunch(t *testing.T) {
	for _, code := range []int{0, 1603, 1602} {
		pl := testPlan(t)
		f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{code}}
		if err := applyPlan(f, pl, testTiming(new([]time.Duration)), func(updatePlan) (ui, error) { return panicUI{}, nil }, openKasboek(f, pl.PID)); err != nil {
			t.Fatal(err)
		}
		if len(f.msiexecRuns) != 1 || len(f.started) != 1 {
			t.Fatalf("code %d: ran %v, started %v", code, f.msiexecRuns, f.started)
		}
		if r := readResult(t, pl); r.Code != code {
			t.Fatalf("result %+v", r)
		}
	}
}

func TestPanickingWindowStillAllowsTheChecksumAndNotClosedPaths(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: false, codes: []int{0}}
	if err := applyPlan(f, pl, testTiming(new([]time.Duration)), func(updatePlan) (ui, error) { return panicUI{}, nil }, openKasboek(f, pl.PID)); err == nil {
		t.Fatal("expected an error")
	}
	if r := readResult(t, pl); r.Outcome != "not_closed" {
		t.Fatalf("result %+v", r)
	}
}
