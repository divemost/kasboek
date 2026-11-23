package main

// The install log (msiexec /l*v) tells whether Windows Installer is still moving: its size changes
// and it names the action it is in ("Action start 10:15:02: InstallFiles."). The window shows the
// action and, when nothing changes for a while, a hint. Windows Installer writes the log in the
// system's ANSI code page, or in UTF-16 with a byte order mark; both are read.

import (
	"io"
	"os"
	"regexp"
	"sync"
	"time"
	"unicode/utf16"
)

const logTailBytes = 16 << 10

var actionLine = regexp.MustCompile(`Action start \d+:\d+:\d+: (\w+)\.`)

// decodeLog turns bytes of the log into text. For UTF-16 the bytes must start at an even offset
// from the start of the file.
func decodeLog(b []byte, wide bool) string {
	if !wide {
		return string(b)
	}
	u := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		u = append(u, uint16(b[i])|uint16(b[i+1])<<8)
	}
	return string(utf16.Decode(u))
}

// lastAction is the name of the last action in the text, or "".
func lastAction(text string) string {
	all := actionLine.FindAllStringSubmatch(text, -1)
	if len(all) == 0 {
		return ""
	}
	return all[len(all)-1][1]
}

// readLogTail is the log's size and its last action; ok is false when it can't be read (yet).
func readLogTail(path string) (size int64, action string, ok bool) {
	f, err := os.Open(path)
	if err != nil {
		return 0, "", false
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return 0, "", false
	}
	size = st.Size()
	var bom [2]byte
	wide := false
	if n, _ := f.ReadAt(bom[:], 0); n == 2 && bom[0] == 0xFF && bom[1] == 0xFE {
		wide = true
	}
	start := size - logTailBytes
	if start < 0 {
		start = 0
	}
	if wide {
		start &^= 1
		if start == 0 {
			start = 2 // after the byte order mark
		}
	}
	buf := make([]byte, size-start)
	n, err := f.ReadAt(buf, start)
	if err != nil && err != io.EOF {
		return size, "", true
	}
	return size, lastAction(decodeLog(buf[:n], wide)), true
}

// watchInstallLog calls report whenever the log grows or its last action changes, until stop is
// called. every <= 0 means no watching.
func watchInstallLog(path string, every time.Duration, report func(action string)) (stop func()) {
	if every <= 0 {
		return func() {}
	}
	quit := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		var lastSize int64 = -1
		lastAct := ""
		tick := time.NewTicker(every)
		defer tick.Stop()
		for {
			select {
			case <-quit:
				return
			case <-tick.C:
				size, act, ok := readLogTail(path)
				if !ok || (size == lastSize && (act == "" || act == lastAct)) {
					continue
				}
				lastSize = size
				if act != "" {
					lastAct = act
				}
				report(lastAct)
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() { close(quit) })
		<-done
	}
}
