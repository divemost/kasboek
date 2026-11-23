package main

// Uninstall cleanup, run by the Windows installer while Kasboek is removed (kasboek-mcp
// --uninstall-cleanup [--remove-data]). It takes Kasboek out of the Claude apps' settings (only
// entries that start this helper, so another installation's entry stays), deletes caches and
// temporary files in the data folder, and the data itself only when the person asked for that.
// It never fails the uninstall: every step is best effort.

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Folders in Kasboek's data folder that hold nothing of the person's: browser caches, logs and
// downloaded updates. The database, account, settings and safety backups are elsewhere in it.
var cacheDirs = []string{"Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "Shared Dictionary", "blob_storage", "Crashpad", "logs", "updates", "updates-last"}

func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// desktopConfigs lists Claude Desktop's settings files that exist (same places as Kasboek looks).
func desktopConfigs() []string {
	var out []string
	add := func(p string) {
		if _, err := os.Stat(p); err == nil {
			out = append(out, p)
		}
	}
	home, _ := os.UserHomeDir()
	const name = "claude_desktop_config.json"
	switch runtime.GOOS {
	case "windows":
		if a := os.Getenv("APPDATA"); a != "" {
			add(filepath.Join(a, "Claude", name))
		}
		local := os.Getenv("LOCALAPPDATA")
		if local == "" {
			local = filepath.Join(home, "AppData", "Local")
		}
		for _, pattern := range []string{filepath.Join(local, "Packages", "*Claude_*", "LocalCache", "Roaming", "Claude", name), filepath.Join(local, "Claude-Data", "*", name), filepath.Join(local, "Claude-Data", "*", "Claude", name)} {
			matches, _ := filepath.Glob(pattern)
			for _, m := range matches {
				add(m)
			}
		}
	case "darwin":
		add(filepath.Join(home, "Library", "Application Support", "Claude", name))
	default:
		cfg := os.Getenv("XDG_CONFIG_HOME")
		if cfg == "" {
			cfg = filepath.Join(home, ".config")
		}
		add(filepath.Join(cfg, "Claude", name))
	}
	return out
}

// removeFromDesktopConfig drops mcpServers.kasboek from one file when it starts `self`. A copy of the
// file is kept next to it first. Returns whether the file changed.
func removeFromDesktopConfig(path, self string) bool {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	var cfg map[string]json.RawMessage
	if json.Unmarshal(raw, &cfg) != nil {
		return false
	}
	var servers map[string]json.RawMessage
	if json.Unmarshal(cfg["mcpServers"], &servers) != nil {
		return false
	}
	var entry struct {
		Command string `json:"command"`
	}
	if json.Unmarshal(servers["kasboek"], &entry) != nil || !samePath(entry.Command, self) {
		return false
	}
	delete(servers, "kasboek")
	s, _ := json.Marshal(servers)
	cfg["mcpServers"] = s
	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return false
	}
	_ = os.WriteFile(path+".before-kasboek-uninstall", raw, 0o600)
	return os.WriteFile(path, append(out, '\n'), 0o600) == nil
}

func findClaudeCode() string {
	if p, err := exec.LookPath("claude"); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	names := []string{"claude"}
	if runtime.GOOS == "windows" {
		names = []string{"claude.exe", "claude.cmd"}
	}
	for _, d := range []string{filepath.Join(home, ".local", "bin"), filepath.Join(home, ".claude", "local"), filepath.Join(os.Getenv("APPDATA"), "npm")} {
		for _, n := range names {
			if _, err := os.Stat(filepath.Join(d, n)); err == nil {
				return filepath.Join(d, n)
			}
		}
	}
	return ""
}

// removeFromClaudeCode removes Claude Code's "kasboek" server when it starts `self`.
func removeFromClaudeCode(self string) {
	exe := findClaudeCode()
	if exe == "" {
		return
	}
	run := func(args ...string) (string, error) {
		cmd := exec.Command(exe, args...)
		if strings.HasSuffix(strings.ToLower(exe), ".cmd") {
			cmd = exec.Command("cmd.exe", append([]string{"/d", "/c", exe}, args...)...)
		}
		done := make(chan struct{})
		var out []byte
		var err error
		go func() { out, err = cmd.CombinedOutput(); close(done) }()
		select {
		case <-done:
			return string(out), err
		case <-time.After(30 * time.Second):
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			return "", os.ErrDeadlineExceeded
		}
	}
	out, err := run("mcp", "get", "kasboek")
	norm := func(s string) string { return strings.ToLower(strings.ReplaceAll(s, "\\", "/")) }
	if err != nil || !strings.Contains(norm(out), norm(self)) {
		return
	}
	_, _ = run("mcp", "remove", "--scope", "user", "kasboek")
}

// cleanDataDir deletes caches and temporary files, or (removeData) the whole data folder. The
// folder must be called Kasboek, so a wrong --data-dir can never delete anything else.
func cleanDataDir(dataDir string, removeData bool) {
	if dataDir == "" || !strings.EqualFold(filepath.Base(filepath.Clean(dataDir)), "Kasboek") {
		return
	}
	if removeData {
		_ = os.RemoveAll(dataDir)
		return
	}
	for _, d := range cacheDirs {
		_ = os.RemoveAll(filepath.Join(dataDir, d))
	}
	_ = os.Remove(filepath.Join(dataDir, "mcp-bridge.json"))
}

func uninstallCleanup(dataDir string, removeData bool) {
	self, err := os.Executable()
	if err == nil {
		if resolved, e := filepath.EvalSymlinks(self); e == nil {
			self = resolved
		}
		for _, p := range desktopConfigs() {
			removeFromDesktopConfig(p, self)
		}
		removeFromClaudeCode(self)
	}
	cleanDataDir(dataDir, removeData)
}
