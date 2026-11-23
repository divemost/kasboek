package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

type fakePlatform struct {
	events      []string
	openErr     error
	image       string
	imageErr    error
	exits       bool
	othersLeft  int   // polls that still see another Kasboek process
	othersErr   error // every look at the running programs fails
	lockErr     error
	codes       []int
	hang        bool // Windows Installer never finishes: it is ended after the timeout
	msiexecRuns [][]string
	timeouts    []time.Duration
	started     [][]string
	// bridges that run from the install folder (listed until they are ended) and one that does not.
	bridges    []bridgeProc
	bridgesErr error
	ended      []bridgeProc
	onRun      func() // called by every run of Windows Installer (moves a fake clock)
}

func (f *fakePlatform) log(s string) { f.events = append(f.events, s) }

func (f *fakePlatform) openProcess(pid int) (procHandle, error) {
	f.log("open")
	return 7, f.openErr
}
func (f *fakePlatform) closeProcess(procHandle) { f.log("close") }
func (f *fakePlatform) waitExit(procHandle, time.Duration) (bool, error) {
	f.log("wait")
	return f.exits, nil
}
func (f *fakePlatform) imagePath(procHandle) (string, error) {
	f.log("image")
	return f.image, f.imageErr
}
func (f *fakePlatform) othersRunning(string) (bool, error) {
	f.log("others")
	if f.othersErr != nil {
		return false, f.othersErr
	}
	if f.othersLeft > 0 {
		f.othersLeft--
		return true, nil
	}
	return false, nil
}
func (f *fakePlatform) bridgesRunning(dir string) ([]bridgeProc, error) {
	f.log("bridges")
	if f.bridgesErr != nil {
		return nil, f.bridgesErr
	}
	var in []bridgeProc
	for _, b := range f.bridges {
		if pathInside(b.image, dir, samePath) {
			in = append(in, b)
		}
	}
	return in, nil
}
func (f *fakePlatform) endBridges(procs []bridgeProc) error {
	f.log("end-bridges")
	f.ended = append(f.ended, procs...)
	var left []bridgeProc
	for _, b := range f.bridges {
		kept := true
		for _, e := range procs {
			if e == b {
				kept = false
			}
		}
		if kept {
			left = append(left, b)
		}
	}
	f.bridges = left
	return nil
}
func (f *fakePlatform) lockAndHash(path string) (string, func(), error) {
	f.log("lock")
	if f.lockErr != nil {
		return "", nil, f.lockErr
	}
	file, err := os.Open(path)
	if err != nil {
		return "", nil, err
	}
	defer file.Close()
	sum, err := sha256Hex(file)
	return sum, func() { f.log("unlock") }, err
}
func (f *fakePlatform) runMsiexec(args []string, timeout time.Duration) (int, error) {
	f.log("msiexec")
	f.msiexecRuns = append(f.msiexecRuns, args)
	f.timeouts = append(f.timeouts, timeout)
	if f.onRun != nil {
		f.onRun()
	}
	if f.hang {
		f.log("killed")
		return 0, errMsiexecTimeout
	}
	code := f.codes[0]
	if len(f.codes) > 1 {
		f.codes = f.codes[1:]
	}
	return code, nil
}
func (f *fakePlatform) start(exe string, args []string) error {
	f.log("start")
	f.started = append(f.started, append([]string{exe}, args...))
	return nil
}

type fakeUI struct{ events []string }

func (u *fakeUI) waiting()             { u.events = append(u.events, "waiting") }
func (u *fakeUI) disconnecting()       { u.events = append(u.events, "disconnecting") }
func (u *fakeUI) logActivity(a string) { u.events = append(u.events, "log:"+a) }
func (u *fakeUI) installing()          { u.events = append(u.events, "installing") }
func (u *fakeUI) starting()            { u.events = append(u.events, "starting") }
func (u *fakeUI) failed(m string)      { u.events = append(u.events, "failed:"+m) }
func (u *fakeUI) close()               { u.events = append(u.events, "close") }

// runPlan is the update as applyWith does it: Kasboek's process is opened first.
func runPlan(f *fakePlatform, u ui, pl updatePlan, t timing, passive bool) error {
	return runUpdate(f, u, pl, t, passive, openKasboek(f, pl.PID))
}

func testTiming(slept *[]time.Duration) timing {
	t := realTiming
	t.sleep = func(d time.Duration) { *slept = append(*slept, d) }
	return t
}

// A plan with a real msi file (any bytes) next to it in a folder with a space and an accent.
func testPlan(t *testing.T) updatePlan {
	dir := filepath.Join(t.TempDir(), "Jérôme Dupont", "updates")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	msi := filepath.Join(dir, "Kasboek-1.2.0-win-x64.msi")
	body := []byte("not really an installer")
	if err := os.WriteFile(msi, body, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	exe := filepath.Join(dir, "Kasboek.exe")
	if err := os.WriteFile(exe, nil, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "resources"), 0o700); err != nil {
		t.Fatal(err)
	}
	pl := updatePlan{V: 1, PID: 4242, Exe: exe, Args: []string{}, MSI: msi, SHA256: hex.EncodeToString(sum[:]), Log: filepath.Join(dir, "install.log"), Result: filepath.Join(dir, "result.json"), ToVersion: "1.2.0"}
	pl.Texts.Failed, pl.Texts.Cancelled, pl.Texts.NotClosed = "failed text", "cancelled text", "not closed text"
	return pl
}

func readResult(t *testing.T, pl updatePlan) updateResult {
	raw, err := os.ReadFile(pl.Result)
	if err != nil {
		t.Fatal(err)
	}
	var r updateResult
	if err := json.Unmarshal(raw, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestUpdateStepsInOrder(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{0}}
	u := &fakeUI{}
	var slept []time.Duration
	if err := runPlan(f, u, pl, testTiming(&slept), true); err != nil {
		t.Fatal(err)
	}
	want := []string{"open", "image", "wait", "close", "others", "bridges", "lock", "msiexec", "unlock", "start"}
	if !reflect.DeepEqual(f.events, want) {
		t.Fatalf("steps %v, want %v", f.events, want)
	}
	if !reflect.DeepEqual(u.events, []string{"waiting", "installing", "starting", "close"}) {
		t.Fatalf("ui %v", u.events)
	}
	if !reflect.DeepEqual(f.started, [][]string{{pl.Exe}}) {
		t.Fatalf("started %v", f.started)
	}
	r := readResult(t, pl)
	if r.Code != 0 || r.Outcome != "ok" || r.ToVersion != "1.2.0" {
		t.Fatalf("result %+v", r)
	}
	if _, err := time.Parse(time.RFC3339, r.At); err != nil {
		t.Fatalf("at %q: %v", r.At, err)
	}
}

func TestReusedProcessIdIsNotWaitedFor(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: `C:\Windows\notepad.exe`, codes: []int{0}}
	if err := runPlan(f, &fakeUI{}, pl, testTiming(new([]time.Duration)), true); err != nil {
		t.Fatal(err)
	}
	for _, e := range f.events {
		if e == "wait" {
			t.Fatalf("waited on a process that is not Kasboek: %v", f.events)
		}
	}
	if len(f.msiexecRuns) != 1 {
		t.Fatal("did not install")
	}
}

func TestKasboekNeverClosesMeansNoInstallButStillARelaunch(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: false, codes: []int{0}}
	u := &fakeUI{}
	if err := runPlan(f, u, pl, testTiming(new([]time.Duration)), true); err == nil {
		t.Fatal("expected an error")
	}
	if len(f.msiexecRuns) != 0 {
		t.Fatalf("installed: %v", f.msiexecRuns)
	}
	if !reflect.DeepEqual(f.started, [][]string{{pl.Exe}}) {
		t.Fatalf("Kasboek was not started: %v", f.started)
	}
	if r := readResult(t, pl); r.Outcome != "not_closed" || r.Code != -1 {
		t.Fatalf("result %+v", r)
	}
	if !reflect.DeepEqual(u.events, []string{"waiting", "failed:not closed text", "starting", "close"}) {
		t.Fatalf("ui %v", u.events)
	}
}

func TestSameFileSpelledDifferentlyIsStillWaitedFor(t *testing.T) {
	pl := testPlan(t)
	// 8.3 names, a mapped drive or a junction: another spelling of the same Kasboek.exe.
	for _, image := range []string{`C:\PROGRA~1\KASBOEK\KASBOEK.EXE`, `Z:\Kasboek\Kasboek.exe`, `/mnt/link/kasboek.EXE`} {
		f := &fakePlatform{image: image, exits: true, codes: []int{0}}
		if err := runPlan(f, &fakeUI{}, pl, testTiming(new([]time.Duration)), true); err != nil {
			t.Fatal(err)
		}
		waited := false
		for _, e := range f.events {
			waited = waited || e == "wait"
		}
		if !waited {
			t.Fatalf("%s: did not wait: %v", image, f.events)
		}
	}
}

func TestUnreadableImagePathOfARunningKasboekIsStillWaitedFor(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{imageErr: errors.New("access denied"), exits: false, codes: []int{0}}
	if err := runPlan(f, &fakeUI{}, pl, testTiming(new([]time.Duration)), true); err == nil {
		t.Fatal("expected not_closed")
	}
	if len(f.msiexecRuns) != 0 {
		t.Fatalf("installed while Kasboek may still run: %v", f.events)
	}
}

func TestSnapshotThatKeepsFailingIsGivenUpAfterThreeTries(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, othersErr: errors.New("snapshot"), codes: []int{0}}
	var slept []time.Duration
	if err := runPlan(f, &fakeUI{}, pl, testTiming(&slept), true); err != nil {
		t.Fatal(err)
	}
	tries := 0
	for _, e := range f.events {
		if e == "others" {
			tries++
		}
	}
	if tries != 3 || len(slept) != 2 || len(f.msiexecRuns) != 1 {
		t.Fatalf("tries %d, pauses %v, runs %d", tries, slept, len(f.msiexecRuns))
	}
}

func TestMsiexecThatNeverEndsFailsAndRelaunches(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, hang: true, codes: []int{0}}
	u := &fakeUI{}
	if err := runPlan(f, u, pl, realTiming, true); !errors.Is(err, errMsiexecTimeout) {
		t.Fatalf("error %v", err)
	}
	if len(f.timeouts) != 1 || f.timeouts[0] != 10*time.Minute {
		t.Fatalf("timeouts %v", f.timeouts)
	}
	if r := readResult(t, pl); r.Outcome != "failed" || r.Code != -1 {
		t.Fatalf("result %+v", r)
	}
	if len(f.started) != 1 {
		t.Fatal("Kasboek was not opened again")
	}
	if !reflect.DeepEqual(u.events, []string{"waiting", "installing", "failed:failed text", "starting", "close"}) {
		t.Fatalf("ui %v", u.events)
	}
}

func TestChecksummedFileStaysLockedUntilMsiexecReturns(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{1618, 0}}
	if err := runPlan(f, &fakeUI{}, pl, testTiming(new([]time.Duration)), true); err != nil {
		t.Fatal(err)
	}
	var tail []string
	for _, e := range f.events {
		if e == "lock" || e == "msiexec" || e == "unlock" || e == "start" {
			tail = append(tail, e)
		}
	}
	if want := []string{"lock", "msiexec", "msiexec", "unlock", "start"}; !reflect.DeepEqual(tail, want) {
		t.Fatalf("%v, want %v", tail, want)
	}
}

func TestFileThatCannotBeLockedIsNotInstalled(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, lockErr: errors.New("sharing violation"), codes: []int{0}}
	if err := runPlan(f, &fakeUI{}, pl, testTiming(new([]time.Duration)), true); err == nil {
		t.Fatal("expected an error")
	}
	if len(f.msiexecRuns) != 0 || len(f.started) != 1 {
		t.Fatalf("ran %v, started %v", f.msiexecRuns, f.started)
	}
	if r := readResult(t, pl); r.Outcome != "checksum" {
		t.Fatalf("result %+v", r)
	}
}

func TestStartedFileIsWrittenAfterThePlanIsChecked(t *testing.T) {
	pl := testPlan(t)
	dir := filepath.Dir(pl.MSI)
	file := filepath.Join(dir, "apply.json")
	started := filepath.Join(dir, "started")
	write := func(p updatePlan) {
		raw, _ := json.Marshal(p)
		if err := os.WriteFile(file, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	bad := pl
	bad.Args = []string{"--evil"}
	write(bad)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{0}}
	if err := applyWith(file, f, testTiming(new([]time.Duration)), startNoWindow); err == nil {
		t.Fatal("a bad plan was accepted")
	}
	if _, err := os.Stat(started); err == nil {
		t.Fatal("started was written for a bad plan")
	}
	if len(f.events) != 0 {
		t.Fatalf("a bad plan touched the system: %v", f.events)
	}

	write(pl)
	f = &fakePlatform{image: pl.Exe, exits: true, codes: []int{0}}
	if err := applyWith(file, f, testTiming(new([]time.Duration)), startNoWindow); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(started); err != nil {
		t.Fatalf("started was not written: %v", err)
	}
	if _, err := os.Stat(started + ".tmp"); err == nil {
		t.Fatal("the temporary file was left behind")
	}
	// Kasboek's process is opened before anything else.
	if len(f.events) == 0 || f.events[0] != "open" {
		t.Fatalf("events %v", f.events)
	}
}

func TestChildProcessesThatStayMeanNotClosed(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, othersLeft: 1 << 30, codes: []int{0}}
	var slept []time.Duration
	if err := runPlan(f, &fakeUI{}, pl, testTiming(&slept), true); err == nil {
		t.Fatal("expected an error")
	}
	var total time.Duration
	for _, d := range slept {
		total += d
	}
	if total != 30*time.Second || len(f.msiexecRuns) != 0 || len(f.started) != 1 {
		t.Fatalf("waited %v, ran %v, started %v", total, f.msiexecRuns, f.started)
	}
	if r := readResult(t, pl); r.Outcome != "not_closed" {
		t.Fatalf("result %+v", r)
	}
}

func TestChildProcessesThatLeaveAreWaitedFor(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, othersLeft: 3, codes: []int{0}}
	if err := runPlan(f, &fakeUI{}, pl, testTiming(new([]time.Duration)), true); err != nil {
		t.Fatal(err)
	}
	if len(f.msiexecRuns) != 1 {
		t.Fatal("did not install")
	}
}

func TestFailedInstallStillRelaunches(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{1603}}
	u := &fakeUI{}
	if err := runPlan(f, u, pl, testTiming(new([]time.Duration)), true); err != nil {
		t.Fatal(err)
	}
	if len(f.started) != 1 {
		t.Fatal("Kasboek was not opened again")
	}
	if r := readResult(t, pl); r.Code != 1603 || r.Outcome != "failed" {
		t.Fatalf("result %+v", r)
	}
	if !reflect.DeepEqual(u.events, []string{"waiting", "installing", "failed:failed text", "starting", "close"}) {
		t.Fatalf("ui %v", u.events)
	}
}

func TestCancelledInstallSaysSo(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{1602}}
	u := &fakeUI{}
	if err := runPlan(f, u, pl, testTiming(new([]time.Duration)), true); err != nil {
		t.Fatal(err)
	}
	if u.events[2] != "failed:cancelled text" || readResult(t, pl).Outcome != "cancelled" {
		t.Fatalf("ui %v", u.events)
	}
}

func TestBusyInstallerIsRetriedThreeTimes(t *testing.T) {
	pl := testPlan(t)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{1618, 1618, 0}}
	var slept []time.Duration
	if err := runPlan(f, &fakeUI{}, pl, testTiming(&slept), true); err != nil {
		t.Fatal(err)
	}
	if len(f.msiexecRuns) != 3 || readResult(t, pl).Outcome != "ok" {
		t.Fatalf("runs %d", len(f.msiexecRuns))
	}

	f = &fakePlatform{image: pl.Exe, exits: true, codes: []int{1618}}
	slept = nil
	if err := runPlan(f, &fakeUI{}, pl, testTiming(&slept), true); err != nil {
		t.Fatal(err)
	}
	if len(f.msiexecRuns) != 4 {
		t.Fatalf("runs %d, want 1 + 3 retries", len(f.msiexecRuns))
	}
	tens := 0
	for _, d := range slept {
		if d == 10*time.Second {
			tens++
		}
	}
	if tens != 3 || len(f.started) != 1 {
		t.Fatalf("pauses %v, started %v", slept, f.started)
	}
	if r := readResult(t, pl); r.Code != 1618 || r.Outcome != "busy" {
		t.Fatalf("result %+v", r)
	}
}

func TestChecksumMismatchSkipsInstallButRelaunches(t *testing.T) {
	pl := testPlan(t)
	pl.SHA256 = strings.Repeat("0", 64)
	f := &fakePlatform{image: pl.Exe, exits: true, codes: []int{0}}
	if err := runPlan(f, &fakeUI{}, pl, testTiming(new([]time.Duration)), true); err == nil {
		t.Fatal("expected an error")
	}
	if len(f.msiexecRuns) != 0 || len(f.started) != 1 {
		t.Fatalf("ran %v, started %v", f.msiexecRuns, f.started)
	}
	if r := readResult(t, pl); r.Outcome != "checksum" {
		t.Fatalf("result %+v", r)
	}
}

func TestMsiexecArgs(t *testing.T) {
	got := msiexecArgs(`C:\a b\x.msi`, `C:\a b\i.log`, true)
	want := []string{"/i", `C:\a b\x.msi`, "/passive", "/norestart", "/l*v", `C:\a b\i.log`}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%v", got)
	}
	if msiexecArgs("a", "b", false)[2] != "/qn" {
		t.Fatal("expected /qn")
	}
}

func TestMsiOutcome(t *testing.T) {
	cases := map[int]string{0: "ok", 3010: "reboot", 1641: "reboot", 1602: "cancelled", 1618: "busy", 1625: "blocked", 1643: "blocked", 1603: "failed", -1: "failed"}
	for code, want := range cases {
		if got := msiOutcome(code); got != want {
			t.Errorf("%d: %s, want %s", code, got, want)
		}
	}
}

func TestValidatePlan(t *testing.T) {
	pl := testPlan(t)
	dir := filepath.Dir(pl.MSI)
	if err := validatePlan(pl, dir); err != nil {
		t.Fatal(err)
	}
	bad := map[string]func(p *updatePlan){
		"version":     func(p *updatePlan) { p.V = 2 },
		"pid":         func(p *updatePlan) { p.PID = 0 },
		"checksum":    func(p *updatePlan) { p.SHA256 = "abc" },
		"relative":    func(p *updatePlan) { p.Log = "install.log" },
		"other dir":   func(p *updatePlan) { p.MSI = filepath.Join(filepath.Dir(dir), "x.msi") },
		"not msi":     func(p *updatePlan) { p.MSI = filepath.Join(dir, "x.exe") },
		"not Kasboek": func(p *updatePlan) { p.Exe = filepath.Join(dir, "other.exe") },
		"missing exe": func(p *updatePlan) { p.Exe = filepath.Join(dir, "sub", "Kasboek.exe") },
		"args":        func(p *updatePlan) { p.Args = []string{"--x"} },
		"dash arg":    func(p *updatePlan) { p.Args = []string{"-x"} },
		"no resources": func(p *updatePlan) {
			p.Exe = filepath.Join(dir, "plain", "Kasboek.exe")
			if err := os.MkdirAll(filepath.Dir(p.Exe), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(p.Exe, nil, 0o700); err != nil {
				t.Fatal(err)
			}
		},
	}
	for name, mutate := range bad {
		p := pl
		mutate(&p)
		if err := validatePlan(p, dir); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestLoadPlanReadsTheFileNextToIt(t *testing.T) {
	pl := testPlan(t)
	raw, _ := json.Marshal(pl)
	file := filepath.Join(filepath.Dir(pl.MSI), "apply.json")
	if err := os.WriteFile(file, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := loadPlan(file)
	if err != nil || got.MSI != pl.MSI {
		t.Fatalf("%v %v", got, err)
	}
	if _, err := loadPlan(filepath.Join(t.TempDir(), "none.json")); err == nil {
		t.Fatal("expected an error")
	}
}
