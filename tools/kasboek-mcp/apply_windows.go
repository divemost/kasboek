//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	processSynchronize      = 0x00100000
	processQueryLimitedInfo = 0x00001000
	waitObject0             = 0
	waitTimeout             = 0x102
	th32csSnapProcess       = 0x2
	maxLongPath             = 32768
)

var (
	procQueryFullProcessImageName = syscall.NewLazyDLL("kernel32.dll").NewProc("QueryFullProcessImageNameW")
	procGetSystemDirectory        = syscall.NewLazyDLL("kernel32.dll").NewProc("GetSystemDirectoryW")
)

type winPlatform struct {
	// msiexec is Windows Installer's program; tests replace it. Empty when it could not be found.
	msiexec string
}

// systemMsiexec is msiexec.exe in Windows' own system folder, as GetSystemDirectoryW reports it:
// not from an environment variable that the person's account could have changed.
func systemMsiexec() (string, error) {
	buf := make([]uint16, syscall.MAX_PATH)
	n, _, err := procGetSystemDirectory.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 || int(n) >= len(buf) {
		return "", fmt.Errorf("the system folder is not known (%d, %v)", n, err)
	}
	dir := syscall.UTF16ToString(buf[:n])
	if !filepath.IsAbs(dir) {
		return "", fmt.Errorf("the system folder %q is not an absolute path", dir)
	}
	return filepath.Join(dir, "msiexec.exe"), nil
}

func newWinPlatform() winPlatform {
	exe, err := systemMsiexec()
	if err != nil {
		logf("windows installer not found: %v", err)
	}
	return winPlatform{msiexec: exe}
}

func (winPlatform) openProcess(pid int) (procHandle, error) {
	h, err := syscall.OpenProcess(processSynchronize|processQueryLimitedInfo, false, uint32(pid))
	return procHandle(h), err
}

func (winPlatform) closeProcess(h procHandle) { _ = syscall.CloseHandle(syscall.Handle(h)) }

func (winPlatform) waitExit(h procHandle, timeout time.Duration) (bool, error) {
	ev, err := syscall.WaitForSingleObject(syscall.Handle(h), uint32(timeout.Milliseconds()))
	if err != nil {
		return false, err
	}
	switch ev {
	case waitObject0:
		return true, nil
	case waitTimeout:
		return false, nil
	}
	return false, errors.New("unexpected wait result")
}

func (winPlatform) imagePath(h procHandle) (string, error) {
	buf := make([]uint16, maxLongPath)
	n := uint32(len(buf))
	r, _, err := procQueryFullProcessImageName.Call(uintptr(h), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n)))
	if r == 0 {
		return "", err
	}
	return syscall.UTF16ToString(buf[:n]), nil
}

// fileIdentity is what Windows knows a file by: the volume and the index on it. Two paths with the
// same identity are the same file (8.3 names, subst and mapped drives, junctions, hard links).
func fileIdentity(path string) (volume uint32, index uint64, err error) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, err
	}
	// No access rights are asked for (only the file's attributes), and everything may be shared,
	// so this works on a program that is running. The backup flag lets it open folders too.
	h, err := syscall.CreateFile(p, 0, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE, nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL|syscall.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return 0, 0, err
	}
	defer syscall.CloseHandle(h)
	var info syscall.ByHandleFileInformation
	if err := syscall.GetFileInformationByHandle(h, &info); err != nil {
		return 0, 0, err
	}
	return info.VolumeSerialNumber, uint64(info.FileIndexHigh)<<32 | uint64(info.FileIndexLow), nil
}

// sameFile compares the files themselves; only when one of them can't be opened does it fall back
// to comparing the cleaned paths without regard to case.
func sameFile(a, b string) bool {
	va, ia, errA := fileIdentity(a)
	vb, ib, errB := fileIdentity(b)
	if errA != nil || errB != nil {
		return samePath(a, b)
	}
	return va == vb && ia == ib
}

// runningImage is the program file of the running process pid, or "" when it can't be opened, has
// ended already (an ended process stays in the list while someone holds a handle to it) or its
// path can't be read.
func (w winPlatform) runningImage(pid uint32) string {
	h, err := w.openProcess(int(pid))
	if err != nil {
		return ""
	}
	defer w.closeProcess(h)
	if ended, werr := w.waitExit(h, 0); werr == nil && ended {
		return ""
	}
	img, err := w.imagePath(h)
	if err != nil {
		return ""
	}
	return img
}

// eachProcess calls f for every process in a snapshot of the running programs, until f returns
// true. It returns an error only when the snapshot itself can't be made or read.
func eachProcess(f func(pid uint32, name string) (stop bool)) error {
	snap, err := syscall.CreateToolhelp32Snapshot(th32csSnapProcess, 0)
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(snap)
	var e syscall.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	if err := syscall.Process32First(snap, &e); err != nil {
		return err
	}
	for {
		if f(e.ProcessID, syscall.UTF16ToString(e.ExeFile[:])) {
			return nil
		}
		if err := syscall.Process32Next(snap, &e); err != nil {
			return nil // no more processes
		}
	}
}

func (w winPlatform) othersRunning(exePath string) (bool, error) {
	self := uint32(os.Getpid())
	found := false
	err := eachProcess(func(pid uint32, name string) bool {
		// The name is only a quick filter; the file decides.
		if pid != self && strings.EqualFold(name, filepath.Base(exePath)) {
			if img := w.runningImage(pid); img != "" && sameFile(img, exePath) {
				found = true
			}
		}
		return found
	})
	return found, err
}

// bridgesRunning lists the kasboek-mcp programs, other than this one, that run from a file inside dir.
func (w winPlatform) bridgesRunning(dir string) ([]bridgeProc, error) {
	self := uint32(os.Getpid())
	var out []bridgeProc
	err := eachProcess(func(pid uint32, name string) bool {
		if pid != self && isBridgeName(name) {
			if img := w.runningImage(pid); img != "" && pathInside(img, dir, sameFile) {
				out = append(out, bridgeProc{pid: int(pid), image: img})
			}
		}
		return false
	})
	return out, err
}

const (
	processTerminate = 0x0001
	bridgeEndWait    = 5 * time.Second
)

// endBridges ends the programs (TerminateProcess; a bridge holds nothing that needs closing) and
// waits for each to be gone. A process is only ended when it still runs the same program file as
// when it was listed, so a reused process id is left alone.
func (w winPlatform) endBridges(procs []bridgeProc) error {
	var errs []error
	for _, b := range procs {
		h, err := syscall.OpenProcess(processTerminate|processSynchronize|processQueryLimitedInfo, false, uint32(b.pid))
		if err != nil {
			errs = append(errs, fmt.Errorf("process %d: %w", b.pid, err))
			continue
		}
		if img, err := w.imagePath(procHandle(h)); err != nil || !strings.EqualFold(img, b.image) {
			_ = syscall.CloseHandle(h)
			continue
		}
		if err := syscall.TerminateProcess(h, 1); err != nil {
			errs = append(errs, fmt.Errorf("process %d: %w", b.pid, err))
		} else if gone, _ := w.waitExit(procHandle(h), bridgeEndWait); !gone {
			errs = append(errs, fmt.Errorf("process %d did not end", b.pid))
		}
		_ = syscall.CloseHandle(h)
	}
	return errors.Join(errs...)
}

// lockAndHash opens the file for reading and allows others only to read it (FILE_SHARE_READ, not
// write or delete; Go's os.Open allows writing), hashes it through that handle and keeps the handle
// until release. Windows Installer's own read-only open of the package still works: a new open
// succeeds when its access (reading) is among what our handle shares (reading) and our access
// (reading) is among what its handle shares (reading, which is how installers open a package).
// If Windows Installer can't open the file in some case, the update fails; the lock is not lifted.
func (winPlatform) lockAndHash(path string) (string, func(), error) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return "", nil, err
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ, syscall.FILE_SHARE_READ, nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return "", nil, err
	}
	f := os.NewFile(uintptr(h), path)
	sum, err := sha256Hex(f)
	if err != nil {
		f.Close()
		return "", nil, err
	}
	return sum, func() { f.Close() }, nil
}

// cmdLine quotes every argument exactly (paths with spaces and accents), so msiexec reads what we mean.
func cmdLine(program string, args []string) string {
	parts := make([]string, 0, len(args)+1)
	for _, a := range append([]string{program}, args...) {
		parts = append(parts, syscall.EscapeArg(a))
	}
	return strings.Join(parts, " ")
}

// runMsiexec: whether Windows Installer shows a dialog is up to its arguments (see msiexecArgs).
// Without an absolute path to Windows' own msiexec nothing is run.
func (w winPlatform) runMsiexec(args []string, timeout time.Duration) (int, error) {
	if !filepath.IsAbs(w.msiexec) {
		return 0, errors.New("windows installer was not found")
	}
	cmd := exec.Command(w.msiexec)
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: cmdLine(w.msiexec, args)}
	if err := cmd.Start(); err != nil {
		return 0, err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var err error
	select {
	case err = <-done:
	case <-time.After(timeout):
		_ = cmd.Process.Kill() // TerminateProcess on the program we started
		<-done
		return 0, errMsiexecTimeout
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode(), nil
	}
	return 0, err
}

// start opens Kasboek again with its window visible and independent of this helper.
func (winPlatform) start(exe string, args []string) error {
	cmd := exec.Command(exe, args...)
	detachVisible(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func applyUpdate(path string) error {
	return applyWith(path, newWinPlatform(), realTiming, startWindow)
}

// closeBridgesFlag is --close-bridges <folder>, run by the installer before it checks which files
// are in use: end the bridges that run from the install folder. It never fails the install.
func closeBridgesFlag(dir string) {
	t := realTiming
	closeBridgesIn(newWinPlatform(), dir, t, nil)
}
