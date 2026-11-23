package main

// The MCP bridge is this same program (kasboek-mcp) running for Claude Desktop or Claude Code. While
// one runs from the install folder, Windows Installer can't replace the file, and a silent install
// (/qn) can't ask the person to close it: it just waits. So an update ends the bridges that run from
// the install folder first; the Claude apps start them again when they need Kasboek.

import (
	"path/filepath"
	"strings"
)

// bridgeProc is a running kasboek-mcp program.
type bridgeProc struct {
	pid   int
	image string // its program file, as Windows reports it
}

// bridgeProgram is the file name of the bridge on Windows (the only system with these updates).
const bridgeProgram = "kasboek-mcp.exe"

// bridgeRounds: how many times in a row bridges are looked for and ended, so one that a Claude app
// starts again right away is ended as well.
const bridgeRounds = 3

// pathInside: is image in dir or in a folder below it? `same` says whether two folders are the same
// one (on Windows by file identity, so 8.3 names, junctions and subst drives count).
func pathInside(image, dir string, same func(a, b string) bool) bool {
	if image == "" || dir == "" {
		return false
	}
	for p := filepath.Dir(image); ; {
		if same(p, dir) {
			return true
		}
		next := filepath.Dir(p)
		if next == p {
			return false
		}
		p = next
	}
}

// isBridgeName: is this process name the bridge program (case does not matter)?
func isBridgeName(name string) bool { return strings.EqualFold(name, bridgeProgram) }

// closeBridgesIn ends the bridges that run from dir. onFound is called once, with the first bridges
// found and before they are ended (nil is fine). Failures are logged and never stop the update:
// a bridge that stays only means Windows Installer has to deal with it.
func closeBridgesIn(p platform, dir string, t timing, onFound func([]bridgeProc)) []bridgeProc {
	var ended []bridgeProc
	for round := 0; round < bridgeRounds; round++ {
		procs, err := p.bridgesRunning(dir)
		if err != nil {
			logf("cannot list the Claude bridges: %v", err)
			break
		}
		if len(procs) == 0 {
			break
		}
		if round == 0 && onFound != nil {
			onFound(procs)
		}
		for _, b := range procs {
			logf("ending the Claude bridge %s (process %d)", b.image, b.pid)
		}
		if err := p.endBridges(procs); err != nil {
			logf("could not end every Claude bridge: %v", err)
		}
		ended = append(ended, procs...)
		if round < bridgeRounds-1 {
			t.sleep(t.othersPoll)
		}
	}
	return ended
}
