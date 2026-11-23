package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// updateGrace is how long an update counts as running after its `started` (or `apply.json`) file
// was written. It matches PENDING_GRACE_MS in src/core/update.ts: longer than the helper's own
// deadline for Windows Installer.
const updateGrace = 20 * time.Minute

// updateInProgress: is Kasboek's update helper installing right now? Then Kasboek must not be
// started (a running Kasboek.exe blocks the install, and the helper opens it when it is done).
// A finished update (result.json) or a file older than updateGrace is a leftover of one that is over.
func updateInProgress(dataDir string, now time.Time) bool {
	dir := filepath.Join(dataDir, "updates")
	if _, err := os.Stat(filepath.Join(dir, "result.json")); err == nil {
		return false
	}
	for _, name := range []string{startedFile, "apply.json"} {
		if st, err := os.Stat(filepath.Join(dir, name)); err == nil && !st.IsDir() {
			if age := now.Sub(st.ModTime()); age < updateGrace {
				return true
			}
		}
	}
	return false
}

// appCommand is how to start Kasboek: from app.json, which the app writes at every start, or else
// the Kasboek program installed next to this helper.
func appCommand(dataDir string) (string, []string) {
	var a struct {
		Exe  string   `json:"exe"`
		Args []string `json:"args"`
	}
	if raw, err := os.ReadFile(filepath.Join(dataDir, "app.json")); err == nil && json.Unmarshal(raw, &a) == nil && a.Exe != "" {
		if _, err := os.Stat(a.Exe); err == nil {
			return a.Exe, a.Args
		}
	}
	self, err := os.Executable()
	if err != nil {
		return "", nil
	}
	dir := filepath.Dir(self) // resources/ (Windows, Linux) or Contents/Resources (macOS)
	var exe string
	switch runtime.GOOS {
	case "windows":
		exe = filepath.Join(dir, "..", "Kasboek.exe")
	case "darwin":
		exe = filepath.Join(dir, "..", "MacOS", "Kasboek")
	default:
		exe = filepath.Join(dir, "..", "kasboek")
	}
	if _, err := os.Stat(exe); err != nil {
		return "", nil
	}
	return exe, nil
}

// startApp starts Kasboek in the background (only its tray icon, locked) when a Claude app starts
// this helper and Kasboek isn't running, so the person sees that Claude can reach Kasboek and can
// unlock it from there. If Kasboek already runs, the second copy hands over and quits at once.
func startApp(dataDir string) bool {
	if os.Getenv("KASBOEK_MCP_NO_LAUNCH") == "1" {
		return false
	}
	if updateInProgress(dataDir, time.Now()) {
		return false
	}
	exe, args := appCommand(dataDir)
	if exe == "" {
		return false
	}
	cmd := exec.Command(exe, append(args, "--background")...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return false
	}
	_ = cmd.Process.Release()
	return true
}
