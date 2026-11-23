package main

// The Windows update, run by a copy of this helper (kasboek-mcp --apply-update <plan.json>) that
// Kasboek starts just before it quits. The steps are wait -> verify -> install -> relaunch, written
// against the small platform interface so the order and the failure paths are tested everywhere;
// apply_windows.go holds the real Windows implementation.
//
// Kasboek always opens again: after a successful install, after a failed one, and when it never
// closed (then nothing is installed; if an instance really still runs, the new start only hands
// over to it and shows its window).

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// startedFile is written next to apply.json once the plan is checked and Kasboek's process is open:
// Kasboek quits only after it has seen this file (see startUpdateHelper in src/main/update.ts).
const startedFile = "started"

// updatePlan is apply.json, written by Kasboek (see buildUpdatePlan in src/core/update.ts).
type updatePlan struct {
	V         int      `json:"v"`
	PID       int      `json:"pid"`
	Exe       string   `json:"exe"`
	Args      []string `json:"args"`
	MSI       string   `json:"msi"`
	SHA256    string   `json:"sha256"`
	Log       string   `json:"log"`
	Result    string   `json:"result"`
	ToVersion string   `json:"toVersion"`
	Theme     string   `json:"theme"`
	Texts     struct {
		Waiting    string `json:"waiting"`
		Installing string `json:"installing"`
		Starting   string `json:"starting"`
		Failed     string `json:"failed"`
		Cancelled  string `json:"cancelled"`
		NotClosed  string `json:"notClosed"`
		// Disconnecting: Claude apps are being disconnected. StillWorking, NoProgress and Slow are
		// shown while Windows Installer takes long (see viewAt in updateui.go).
		Disconnecting string `json:"disconnecting"`
		StillWorking  string `json:"stillWorking"`
		NoProgress    string `json:"noProgress"`
		Slow          string `json:"slow"`
	} `json:"texts"`
}

// updateResult is result.json: what Kasboek reads at its next start. Code is msiexec's exit code,
// or -1 when msiexec did not run.
type updateResult struct {
	Code      int    `json:"code"`
	Outcome   string `json:"outcome"`
	ToVersion string `json:"toVersion"`
	At        string `json:"at"`
}

// ui shows the person what is going on: the progress window (updatewin_windows.go), or nothing.
type ui interface {
	waiting()
	disconnecting()
	installing()
	starting()
	failed(message string)
	// logActivity: the install log moved on; action is the last Windows Installer action in it ("" if none yet).
	logActivity(action string)
	close()
}

type noUI struct{}

func (noUI) waiting()           {}
func (noUI) disconnecting()     {}
func (noUI) installing()        {}
func (noUI) starting()          {}
func (noUI) failed(string)      {}
func (noUI) logActivity(string) {}
func (noUI) close()             {}

// procHandle is an open process (a Windows handle).
type procHandle uintptr

type platform interface {
	// openProcess opens the process right away, so its id can't be taken over by another program.
	openProcess(pid int) (procHandle, error)
	closeProcess(h procHandle)
	// waitExit blocks until the process ends (true) or the timeout passes (false). No polling.
	waitExit(h procHandle, timeout time.Duration) (bool, error)
	imagePath(h procHandle) (string, error)
	// othersRunning: is any process running from this program file (the same file, however the path is spelled)?
	othersRunning(exePath string) (bool, error)
	// bridgesRunning: the kasboek-mcp programs (not this process) whose program file is inside dir.
	bridgesRunning(dir string) ([]bridgeProc, error)
	// endBridges ends these programs and waits a short time for them to be gone.
	endBridges(procs []bridgeProc) error
	// lockAndHash reads the file and returns its SHA-256. Until release is called nobody can change
	// or delete it, so what was checked is what gets installed. release is nil when err is not.
	lockAndHash(path string) (sum string, release func(), err error)
	// runMsiexec runs Windows Installer with these arguments and returns its exit code. After the
	// timeout it ends the program and returns errMsiexecTimeout.
	runMsiexec(args []string, timeout time.Duration) (int, error)
	// start starts a program that shows its window, and does not wait for it.
	start(exe string, args []string) error
}

var errMsiexecTimeout = errors.New("windows installer did not finish in time")

// kasboekProc is Kasboek's process, opened as early as possible (open is false when it could not
// be, for instance because it had ended already).
type kasboekProc struct {
	h    procHandle
	open bool
}

func openKasboek(p platform, pid int) kasboekProc {
	h, err := p.openProcess(pid)
	return kasboekProc{h: h, open: err == nil}
}

// baseName is the last part of a Windows or other path.
func baseName(path string) string { return path[strings.LastIndexAny(path, `\/`)+1:] }

var hex64 = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

// loadPlan reads and checks the plan: it came from a file on disk, so nothing in it is trusted
// beyond what is checked here.
func loadPlan(path string) (updatePlan, error) {
	var p updatePlan
	raw, err := os.ReadFile(path)
	if err != nil {
		return p, err
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return p, fmt.Errorf("plan: %w", err)
	}
	return p, validatePlan(p, filepath.Dir(path))
}

func validatePlan(p updatePlan, dir string) error {
	if p.V != 1 {
		return errors.New("plan: unknown version")
	}
	if p.PID <= 0 {
		return errors.New("plan: bad process id")
	}
	if !hex64.MatchString(p.SHA256) {
		return errors.New("plan: bad checksum")
	}
	for _, f := range []string{p.Exe, p.MSI, p.Log, p.Result} {
		if !filepath.IsAbs(f) {
			return errors.New("plan: paths must be absolute")
		}
	}
	for _, f := range []string{p.MSI, p.Log, p.Result} {
		if !samePath(filepath.Dir(f), dir) {
			return errors.New("plan: files must be in the plan's folder")
		}
	}
	if !strings.EqualFold(filepath.Ext(p.MSI), ".msi") {
		return errors.New("plan: not an msi file")
	}
	if !strings.EqualFold(filepath.Base(p.Exe), "Kasboek.exe") {
		return errors.New("plan: not Kasboek")
	}
	if st, err := os.Stat(p.Exe); err != nil || st.IsDir() {
		return errors.New("plan: Kasboek not found")
	}
	// The installed Kasboek has no start arguments (see writeAppCommand in src/main/app.ts); anything
	// in the file could only be somebody else's.
	if len(p.Args) != 0 {
		return errors.New("plan: Kasboek is started without arguments")
	}
	// The installed layout: Kasboek.exe with resources next to it (launch.go relies on it too).
	if st, err := os.Stat(filepath.Join(filepath.Dir(p.Exe), "resources")); err != nil || !st.IsDir() {
		return errors.New("plan: not an installed Kasboek")
	}
	return nil
}

// msiexecArgs: /passive shows Windows Installer's own small progress dialog (used only when our own
// window could not be shown), /qn shows nothing (our window shows the progress).
func msiexecArgs(msi, log string, passive bool) []string {
	mode := "/qn"
	if passive {
		mode = "/passive"
	}
	return []string{"/i", msi, mode, "/norestart", "/l*v", log}
}

// msiOutcome mirrors msiOutcome in src/core/update.ts.
func msiOutcome(code int) string {
	switch code {
	case 0:
		return "ok"
	case 3010, 1641:
		return "reboot"
	case 1602:
		return "cancelled"
	case 1618:
		return "busy"
	case 1625, 1643:
		return "blocked"
	}
	return "failed"
}

type timing struct {
	exitWait    time.Duration // Kasboek closing
	othersWait  time.Duration // its helper processes closing
	othersPoll  time.Duration
	busyRetries int // another installation running (1618)
	busyWait    time.Duration
	// snapshotTries: how many times in a row the list of processes may fail before we stop waiting for it.
	snapshotTries int
	// msiexecTimeout: how long one run of Windows Installer may take.
	msiexecTimeout time.Duration
	// installDeadline: how long the installation may take in all, retries (1618) included. A run is
	// never given more than what is left, and no retry starts when too little is left.
	installDeadline time.Duration
	// logPoll: how often the install log is looked at for the window (0: never).
	logPoll time.Duration
	sleep   func(time.Duration)
	// now is the clock (nil: the real one); tests move it.
	now func() time.Time
}

func (t timing) clock() time.Time {
	if t.now != nil {
		return t.now()
	}
	return time.Now()
}

// minRetryTime: a busy installer (1618) is only tried again when this much time (plus the pause)
// is left of installDeadline.
const minRetryTime = time.Minute

var realTiming = timing{exitWait: 120 * time.Second, othersWait: 30 * time.Second, othersPoll: 500 * time.Millisecond, busyRetries: 3, busyWait: 10 * time.Second, snapshotTries: 3, msiexecTimeout: 10 * time.Minute, installDeadline: 12 * time.Minute, logPoll: 2 * time.Second, sleep: time.Sleep}

func sha256Hex(r io.Reader) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// writeResult replaces result.json in one step, so Kasboek never reads half of it.
func writeResult(pl updatePlan, code int, outcome string) error {
	raw, _ := json.Marshal(updateResult{Code: code, Outcome: outcome, ToVersion: pl.ToVersion, At: time.Now().UTC().Format(time.RFC3339)})
	tmp := pl.Result + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, pl.Result)
}

// waitForKasboek returns true once Kasboek and its helper processes are gone.
func waitForKasboek(p platform, pl updatePlan, t timing, proc kasboekProc) bool {
	if proc.open {
		// Only a different program under this id (the id was reused) means Kasboek is gone. Paths
		// are not compared: 8.3 names, mapped drives and junctions spell one file in several ways,
		// and not being able to read the path says nothing about whether the process still runs.
		reused := false
		if img, err := p.imagePath(proc.h); err == nil && !strings.EqualFold(baseName(img), "Kasboek.exe") {
			reused = true
		}
		exited := true
		if !reused {
			var werr error
			exited, werr = p.waitExit(proc.h, t.exitWait)
			exited = exited && werr == nil
		}
		p.closeProcess(proc.h)
		if !exited {
			return false
		}
	}
	failures := 0
	for waited := time.Duration(0); ; waited += t.othersPoll {
		running, err := p.othersRunning(pl.Exe)
		if err == nil && !running {
			return true
		}
		if err == nil {
			failures = 0
		} else if failures++; failures >= t.snapshotTries {
			// Not knowing is not a reason to wait for the full time.
			logf("cannot list the running programs, not waiting for Kasboek's helper processes: %v", err)
			return true
		}
		if waited >= t.othersWait {
			return false
		}
		t.sleep(t.othersPoll)
	}
}

// runInstaller runs Windows Installer, and again while it says another installation is busy (1618),
// but all within t.installDeadline. While it runs the install log is watched for the window.
func runInstaller(p platform, u ui, pl updatePlan, t timing, passive bool) (int, error) {
	stop := watchInstallLog(pl.Log, t.logPoll, u.logActivity)
	defer stop()
	deadline := t.clock().Add(t.installDeadline)
	run := func() (int, error) {
		limit := t.msiexecTimeout
		if left := deadline.Sub(t.clock()); left < limit {
			limit = max(left, time.Second)
		}
		return p.runMsiexec(msiexecArgs(pl.MSI, pl.Log, passive), limit)
	}
	code, err := run()
	for retry := 0; err == nil && code == 1618 && retry < t.busyRetries; retry++ {
		if left := deadline.Sub(t.clock()); left < t.busyWait+minRetryTime {
			logf("another installation is busy and only %v is left of the time for the update: not trying again", left.Round(time.Second))
			break
		}
		t.sleep(t.busyWait)
		code, err = run()
	}
	return code, err
}

func runUpdate(p platform, u ui, pl updatePlan, t timing, passive bool, proc kasboekProc) error {
	defer u.close()
	u.waiting()
	if !waitForKasboek(p, pl, t, proc) {
		// Nothing is installed. Kasboek is started anyway: when the main process ended but a
		// leftover one kept running, the person would otherwise see no Kasboek at all. If an
		// instance really runs, the new start hands over to it and shows its window.
		u.failed(pl.text(textNotClosed))
		return errors.Join(errors.New("kasboek did not close"), writeResult(pl, -1, "not_closed"), relaunch(p, u, pl))
	}
	// Claude apps keep kasboek-mcp running from the install folder, which Windows Installer can't
	// replace and a silent install can't ask about: end those first.
	closeBridgesIn(p, filepath.Dir(pl.Exe), t, func([]bridgeProc) { u.disconnecting() })
	sum, release, err := p.lockAndHash(pl.MSI)
	if err != nil || !strings.EqualFold(sum, pl.SHA256) {
		if err == nil {
			release()
		}
		u.failed(pl.text(textFailed))
		return errors.Join(errors.New("update file does not match its checksum"), err, writeResult(pl, -1, "checksum"), relaunch(p, u, pl))
	}
	// The file stays locked until Windows Installer is done: no swap between check and install.
	u.installing()
	code, err := runInstaller(p, u, pl, t, passive)
	release()
	if err != nil {
		code = -1
	}
	outcome := msiOutcome(code)
	if outcome == "cancelled" {
		u.failed(pl.text(textCancelled))
	} else if outcome != "ok" && outcome != "reboot" {
		u.failed(pl.text(textFailed))
	}
	werr := writeResult(pl, code, outcome)
	return errors.Join(err, werr, relaunch(p, u, pl))
}

// writeStarted tells Kasboek that this helper has taken over; replaced in one step like the result.
func writeStarted(planPath string) error {
	file := filepath.Join(filepath.Dir(planPath), startedFile)
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, []byte(time.Now().UTC().Format(time.RFC3339)), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

// applyWith is the whole update: check the plan, open Kasboek's process right away (so its id
// can't be taken over while the window starts), tell Kasboek it may quit, then run the steps.
func applyWith(path string, p platform, t timing, start uiStarter) error {
	pl, err := loadPlan(path)
	if err != nil {
		return err
	}
	proc := openKasboek(p, pl.PID)
	if err := writeStarted(path); err != nil {
		if proc.open {
			p.closeProcess(proc.h)
		}
		return fmt.Errorf("handshake: %w", err)
	}
	return applyPlan(p, pl, t, start, proc)
}

func relaunch(p platform, u ui, pl updatePlan) error {
	u.starting()
	return p.start(pl.Exe, pl.Args)
}
