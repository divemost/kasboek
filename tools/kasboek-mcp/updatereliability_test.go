package main

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
)

func TestBridgeInInstallFolderIsEndedBeforeTheInstallAndOneOutsideIsLeftAlone(t *testing.T) {
	pl := testPlan(t)
	inside := bridgeProc{pid: 11, image: filepath.Join(filepath.Dir(pl.Exe), "resources", "kasboek-mcp.exe")}
	outside := bridgeProc{pid: 12, image: filepath.Join(t.TempDir(), "elsewhere", "kasboek-mcp.exe")}
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{0}, bridges: []bridgeProc{inside, outside}}
	u := &fakeUI{}
	if err := runPlan(f, u, pl, testTiming(new([]time.Duration)), true); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.ended, []bridgeProc{inside}) {
		t.Fatalf("ended %v, want only %v", f.ended, inside)
	}
	var order []string
	for _, e := range f.events {
		if e == "end-bridges" || e == "lock" || e == "msiexec" {
			order = append(order, e)
		}
	}
	if want := []string{"end-bridges", "lock", "msiexec"}; !reflect.DeepEqual(order, want) {
		t.Fatalf("order %v, want %v", order, want)
	}
	if want := []string{"waiting", "disconnecting", "installing", "starting", "close"}; !reflect.DeepEqual(u.events, want) {
		t.Fatalf("ui %v, want %v", u.events, want)
	}
}

func TestNoBridgeMeansNoDisconnectingMessage(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{0}}
	u := &fakeUI{}
	if err := runPlan(f, u, pl, testTiming(new([]time.Duration)), true); err != nil {
		t.Fatal(err)
	}
	for _, e := range u.events {
		if e == "disconnecting" {
			t.Fatal("nothing was disconnected, nothing should be said")
		}
	}
}

func TestBridgeThatReturnsIsEndedAgainAndFailuresDoNotStopTheUpdate(t *testing.T) {
	dir := t.TempDir()
	b := bridgeProc{pid: 5, image: filepath.Join(dir, "resources", "kasboek-mcp.exe")}
	f := &fakePlatform{bridges: []bridgeProc{b}}
	var slept []time.Duration
	if got := closeBridgesIn(f, dir, testTiming(&slept), nil); len(got) != 1 {
		t.Fatalf("ended %v", got)
	}
	// The listing itself fails: logged, and the update goes on.
	pl := testPlan(t)
	f = &fakePlatform{image: pl.Exe, exits: true, codes: []int{0}, bridgesErr: os.ErrPermission}
	if err := runPlan(f, &fakeUI{}, pl, testTiming(&slept), true); err != nil {
		t.Fatal(err)
	}
	if len(f.msiexecRuns) != 1 {
		t.Fatal("the install did not run")
	}
}

func TestPathInside(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "Users", "a", "Programs", "Kasboek")
	for _, c := range []struct {
		image string
		want  bool
	}{
		{filepath.Join(root, "resources", "kasboek-mcp.exe"), true},
		{filepath.Join(root, "kasboek-mcp.exe"), true},
		{filepath.Join(root+"-old", "resources", "kasboek-mcp.exe"), false},
		{filepath.Join(string(filepath.Separator), "Users", "a", "kasboek-mcp.exe"), false},
		{"", false},
	} {
		if got := pathInside(c.image, root, samePath); got != c.want {
			t.Errorf("%q: %v, want %v", c.image, got, c.want)
		}
	}
}

func TestNoLaunchWhileAnUpdateIsInProgress(t *testing.T) {
	data := t.TempDir()
	updates := filepath.Join(data, "updates")
	if err := os.MkdirAll(updates, 0o700); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if updateInProgress(data, now) {
		t.Fatal("no update files, nothing in progress")
	}
	started := filepath.Join(updates, startedFile)
	if err := os.WriteFile(started, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !updateInProgress(data, now) {
		t.Fatal("a fresh started file means an update is running")
	}
	if startApp(data) {
		t.Fatal("Kasboek was started during an update")
	}
	old := now.Add(-updateGrace - time.Minute)
	if err := os.Chtimes(started, old, old); err != nil {
		t.Fatal(err)
	}
	if updateInProgress(data, now) {
		t.Fatal("an old started file is a leftover")
	}
	apply := filepath.Join(updates, "apply.json")
	if err := os.WriteFile(apply, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !updateInProgress(data, now) {
		t.Fatal("a fresh apply.json means an update is starting")
	}
	if err := os.WriteFile(filepath.Join(updates, "result.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if updateInProgress(data, now) {
		t.Fatal("with a result the update is over")
	}
}

// The deadline: retries of a busy Windows Installer (1618) share one limit, measured on a fake clock.
func TestRetriesShareOneDeadline(t *testing.T) {
	pl := testPlan(t)
	clock := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{1618}}
	f.onRun = func() { clock = clock.Add(4 * time.Minute) } // every run is busy for 4 minutes
	tm := realTiming
	tm.logPoll = 0
	tm.now = func() time.Time { return clock }
	tm.sleep = func(d time.Duration) { clock = clock.Add(d) }
	start := clock
	if err := runPlan(f, &fakeUI{}, pl, tm, true); err != nil {
		t.Fatal(err)
	}
	if len(f.msiexecRuns) < 2 || len(f.msiexecRuns) > 3 {
		t.Fatalf("%d runs; retries must stop at the deadline, not after busyRetries", len(f.msiexecRuns))
	}
	for i, to := range f.timeouts {
		if to > tm.msiexecTimeout {
			t.Fatalf("run %d got %v, more than one run may take", i, to)
		}
	}
	if f.timeouts[1] >= f.timeouts[0] {
		t.Fatalf("a retry must get less time than the first run: %v", f.timeouts)
	}
	// Each run's limit ends within the deadline.
	if total := clock.Sub(start); total > tm.installDeadline+tm.msiexecTimeout {
		t.Fatalf("took %v", total)
	}
	if r := readResult(t, pl); r.Outcome != "busy" {
		t.Fatalf("result %+v", r)
	}
	if len(f.started) != 1 {
		t.Fatal("Kasboek was not opened again")
	}
}

func TestRealTimingLimits(t *testing.T) {
	if realTiming.msiexecTimeout != 10*time.Minute || realTiming.installDeadline <= realTiming.msiexecTimeout {
		t.Fatalf("%+v", realTiming)
	}
	if updateGrace < realTiming.installDeadline {
		t.Fatal("Kasboek must stay away for as long as the helper may take")
	}
}

func TestWindowTellsTheTruthWhenWindowsInstallerTakesLong(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	pl := testPlan(t)
	m := uiModel{step: stepWaiting, text: "w", since: t0}.to(stepInstalling, "installing text", t0)
	at := func(d time.Duration) view { return m.viewAt(t0.Add(d), pl) }

	if v := at(10 * time.Second); v.moving || v.text != "installing text" || v.detail != "" || v.hint != "" || v.slow != "" {
		t.Fatalf("a normal install shows the curve only: %+v", v)
	}
	v := at(movingAfter + time.Second)
	if !v.moving || !strings.Contains(v.text, "still working") || v.detail != "0:46" {
		t.Fatalf("after the curve: %+v", v)
	}
	if v.hint != "" {
		t.Fatalf("no hint before a minute: %+v", v)
	}
	if v := at(noProgressAfter + time.Second); v.hint == "" || v.slow != "" {
		t.Fatalf("a minute without log progress: %+v", v)
	}
	// Log progress resets the quiet time and names the action.
	m = m.withLog("InstallFiles", t0.Add(70*time.Second))
	if v := at(80 * time.Second); v.hint != "" || !strings.HasSuffix(v.detail, "InstallFiles") {
		t.Fatalf("log moved: %+v", v)
	}
	if v := at(slowAfter + time.Second); v.slow == "" || v.url != releaseURL || v.hint == "" {
		t.Fatalf("after three minutes: %+v", v)
	}
	if v := (uiModel{step: stepStarting, text: "s", since: t0}).viewAt(t0.Add(time.Hour), pl); v.moving || v.slow != "" {
		t.Fatalf("only the install step is honest about waiting: %+v", v)
	}
}

func TestMovingPositionStaysOnTheBar(t *testing.T) {
	for ms := 0; ms < 20000; ms += 37 {
		if p := movingPos(time.Duration(ms) * time.Millisecond); p < 0 || p > 1 {
			t.Fatalf("%d ms: %v", ms, p)
		}
	}
	if movingPos(0) != 0 || movingPos(movingCycle/2) != 1 {
		t.Fatal("the piece should go from one end to the other")
	}
}

func TestElapsedText(t *testing.T) {
	for d, want := range map[time.Duration]string{-time.Second: "0:00", 5 * time.Second: "0:05", 125 * time.Second: "2:05", time.Hour + 62*time.Second: "1:01:02"} {
		if got := elapsedText(d); got != want {
			t.Errorf("%v: %q, want %q", d, got, want)
		}
	}
}

func TestNewTextsFallBackToEnglishAndFillInNothingElse(t *testing.T) {
	pl := testPlan(t)
	if got := pl.text(textDisconnecting); got != "Disconnecting Claude from Kasboek…" {
		t.Fatal(got)
	}
	pl.Texts.Slow = "  Lent ?   "
	if got := pl.text(textSlow); got != "Lent ?" {
		t.Fatal(got)
	}
}

func TestInstallLogTailReadsAnsiAndUtf16(t *testing.T) {
	body := "MSI (s) [10:15:01]: stuff\r\nAction start 10:15:02: RemoveExistingProducts.\r\nAction start 10:15:09: InstallFiles.\r\nMSI (s): more\r\n"
	dir := t.TempDir()
	ansi := filepath.Join(dir, "ansi.log")
	if err := os.WriteFile(ansi, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if size, act, ok := readLogTail(ansi); !ok || act != "InstallFiles" || size != int64(len(body)) {
		t.Fatalf("%d %q %v", size, act, ok)
	}
	// A long UTF-16 log: only the tail is read, from an even offset.
	long := strings.Repeat("x", 40000) + "\r\n" + body
	u := utf16.Encode([]rune(long))
	raw := []byte{0xFF, 0xFE}
	for _, c := range u {
		raw = binary.LittleEndian.AppendUint16(raw, c)
	}
	wide := filepath.Join(dir, "wide.log")
	if err := os.WriteFile(wide, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, act, ok := readLogTail(wide); !ok || act != "InstallFiles" {
		t.Fatalf("%q %v", act, ok)
	}
	if _, _, ok := readLogTail(filepath.Join(dir, "none.log")); ok {
		t.Fatal("a missing log is not readable")
	}
}

func TestInstallLogWatcherReportsChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "install.log")
	got := make(chan string, 16)
	stop := watchInstallLog(path, 5*time.Millisecond, func(a string) { got <- a })
	defer stop()
	if err := os.WriteFile(path, []byte("Action start 1:02:03: CostFinalize.\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case a := <-got:
		if a != "CostFinalize" {
			t.Fatalf("action %q", a)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the log change was not seen")
	}
	stop()
	stop = watchInstallLog(path, 0, func(string) { t.Error("must not watch") })
	stop()
}
