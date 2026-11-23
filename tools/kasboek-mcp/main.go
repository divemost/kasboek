// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 divemost
//
// kasboek-mcp: the Model Context Protocol server for Kasboek, for Claude Desktop, Claude Code or
// any MCP client.
//
// It is a small console program on purpose: MCP clients talk to servers over stdin/stdout, and a
// windowed Electron app on Windows has no usable stdin. It holds no keys and opens no database.
// Every tool call is forwarded to the running, unlocked Kasboek app over a local channel (a named
// pipe on Windows, a Unix socket elsewhere), where it is validated, and where changes wait for the
// person's approval.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

var version = "dev"

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type server struct {
	bridge  *bridge
	out     *json.Encoder
	outMu   sync.Mutex
	started sync.Once
	// Whether the last tool list came from a reachable, unlocked app.
	connected bool
	connMu    sync.Mutex
}

var supportedVersions = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

const instructions = "Kasboek is the person's private budget. Amounts are integer cents (negative = money out). " +
	"Changes need the person's approval inside the Kasboek app; if they decline, accept it."

func (s *server) send(v any) {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	if err := s.out.Encode(v); err != nil {
		fmt.Fprintln(os.Stderr, "kasboek-mcp: write:", err)
	}
}

func (s *server) reply(id json.RawMessage, result any) {
	s.send(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}

func (s *server) fail(id json.RawMessage, code int, msg string) {
	s.send(map[string]any{"jsonrpc": "2.0", "id": id, "error": rpcError{code, msg}})
}

// statusTool is offered when Kasboek can't be reached, so the person learns why there are no tools.
var statusTool = map[string]any{
	"name":        "kasboek_status",
	"description": "Explains how to connect to Kasboek. Call it if the other Kasboek tools are missing.",
	"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false},
	"annotations": map[string]any{"readOnlyHint": true},
}

func (s *server) toolList() []any {
	tools, err := s.bridge.list()
	s.setConnected(err == nil)
	if err != nil {
		return []any{statusTool}
	}
	out := make([]any, 0, len(tools))
	for _, t := range tools {
		desc := t.Description
		if t.Mutates {
			desc += " (Asks the person to approve in Kasboek.)"
		}
		out = append(out, map[string]any{
			"name":        t.Name,
			"description": desc,
			"inputSchema": t.InputSchema,
			"annotations": map[string]any{"readOnlyHint": !t.Mutates},
		})
	}
	return out
}

func (s *server) setConnected(c bool) (changed bool) {
	s.connMu.Lock()
	defer s.connMu.Unlock()
	changed = s.connected != c
	s.connected = c
	return changed
}

// watch tells the client when Kasboek becomes reachable (or stops being), so it refreshes the tools.
func (s *server) watch() {
	for {
		time.Sleep(5 * time.Second)
		_, err := s.bridge.list()
		if s.setConnected(err == nil) {
			s.send(map[string]any{"jsonrpc": "2.0", "method": "notifications/tools/list_changed"})
		}
	}
}

func text(t string, isError bool) map[string]any {
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": t}}, "isError": isError}
}

func (s *server) handle(m rpcMessage) {
	isRequest := len(m.ID) > 0
	switch m.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
			ClientInfo      struct {
				Name string `json:"name"`
			} `json:"clientInfo"`
		}
		_ = json.Unmarshal(m.Params, &p)
		if len(p.ClientInfo.Name) <= 64 {
			s.bridge.setClient(p.ClientInfo.Name)
		}
		v := supportedVersions[0]
		for _, sv := range supportedVersions {
			if sv == p.ProtocolVersion {
				v = sv
			}
		}
		s.reply(m.ID, map[string]any{
			"protocolVersion": v,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": true}},
			"serverInfo":      map[string]any{"name": "kasboek", "version": version},
			"instructions":    instructions,
		})
	case "notifications/initialized":
		s.started.Do(func() {
			go func() {
				if _, err := s.bridge.list(); err != nil {
					startApp(s.bridge.dataDir)
				}
			}()
			go s.watch()
		})
	case "ping":
		s.reply(m.ID, map[string]any{})
	case "tools/list":
		s.reply(m.ID, map[string]any{"tools": s.toolList()})
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(m.Params, &p); err != nil {
			s.fail(m.ID, -32602, "invalid params")
			return
		}
		if p.Name == "kasboek_status" {
			_, err := s.bridge.list()
			if err == nil {
				s.reply(m.ID, text("Kasboek is open, unlocked and connected.", false))
			} else {
				s.reply(m.ID, text(err.Error(), false))
			}
			return
		}
		// Each call runs on its own connection, so a change waiting for approval doesn't block reads.
		go func() {
			result, err := s.bridge.call(p.Name, p.Arguments)
			if err != nil {
				s.reply(m.ID, text(err.Error(), true))
				return
			}
			s.reply(m.ID, text(result, false))
		}()
	default:
		if isRequest {
			s.fail(m.ID, -32601, "method not found: "+m.Method)
		}
	}
}

// defaultDataDir mirrors Electron's userData folder for the app name "Kasboek".
func defaultDataDir() string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		if d := os.Getenv("APPDATA"); d != "" {
			return filepath.Join(d, "Kasboek")
		}
		return filepath.Join(home, "AppData", "Roaming", "Kasboek")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Kasboek")
	default:
		if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
			return filepath.Join(d, "Kasboek")
		}
		return filepath.Join(home, ".config", "Kasboek")
	}
}

func main() {
	dataDir := flag.String("data-dir", "", "Kasboek's data folder (default: the standard location for this OS)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	cleanup := flag.Bool("uninstall-cleanup", false, "used by the uninstaller: remove Kasboek from the Claude apps' settings and delete caches")
	removeData := flag.Bool("remove-data", false, "with --uninstall-cleanup: also delete Kasboek's data folder")
	apply := flag.String("apply-update", "", "used by Kasboek's updater (Windows): install the update described by this plan file, then open Kasboek again")
	closeBridges := flag.String("close-bridges", "", "used by the Windows installer: end the kasboek-mcp programs that run from this install folder, so the update can replace them")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	if *closeBridges != "" {
		closeBridgesFlag(*closeBridges)
		return
	}
	if *apply != "" {
		if err := applyUpdate(*apply); err != nil {
			fmt.Fprintln(os.Stderr, "kasboek-mcp:", err)
			os.Exit(1)
		}
		return
	}
	if *dataDir == "" {
		*dataDir = defaultDataDir()
	}
	if *cleanup {
		uninstallCleanup(*dataDir, *removeData)
		return
	}
	s := &server{bridge: &bridge{dataDir: *dataDir}, out: json.NewEncoder(os.Stdout)}
	serve(s, os.Stdin)
}

func serve(s *server, in io.Reader) {
	r := bufio.NewReaderSize(in, 1<<20)
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			var m rpcMessage
			if jerr := json.Unmarshal(line, &m); jerr != nil {
				s.fail(json.RawMessage("null"), -32700, "parse error")
			} else {
				s.handle(m)
			}
		}
		if err != nil {
			return // stdin closed: the client is done with us
		}
	}
}
