package main

import (
	"encoding/binary"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

func fileCreationTime(info os.FileInfo) time.Time {
	if v, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		return time.Unix(0, v.CreationTime.Nanoseconds())
	}
	return time.Time{}
}

// Each root waits in the kernel. No periodic directory walks or idle timer.
func startAutoPlatform(a *AutoCollector, c AutoConfig) func() {
	stop, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return func() {}
	}
	var wg sync.WaitGroup
	for _, b := range c.Bindings {
		root := b.Path
		wg.Add(1)
		go func() { defer wg.Done(); watchDirectory(a, root, stop) }()
	}
	stopActivity := func() {}
	if c.Activity {
		stopActivity = startWindowsActivity(a)
	}
	var once sync.Once
	return func() {
		once.Do(func() { windows.SetEvent(stop); stopActivity(); go func() { wg.Wait(); windows.CloseHandle(stop) }() })
	}
}
func watchDirectory(a *AutoCollector, root string, stop windows.Handle) {
	path, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return
	}
	h, err := windows.CreateFile(path, windows.FILE_LIST_DIRECTORY, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OVERLAPPED, 0)
	if err != nil {
		a.mu.Lock()
		a.stats.Error = "文件夹监听失败：" + root
		a.mu.Unlock()
		return
	}
	a.mu.Lock()
	a.stats.Watching++
	a.mu.Unlock()
	defer windows.CloseHandle(h)
	ev, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return
	}
	defer windows.CloseHandle(ev)
	buffer := make([]byte, 32768)
	for {
		windows.ResetEvent(ev)
		over := windows.Overlapped{HEvent: ev}
		var count uint32
		err = windows.ReadDirectoryChanges(h, &buffer[0], uint32(len(buffer)), true, windows.FILE_NOTIFY_CHANGE_FILE_NAME|windows.FILE_NOTIFY_CHANGE_DIR_NAME|windows.FILE_NOTIFY_CHANGE_SIZE|windows.FILE_NOTIFY_CHANGE_LAST_WRITE|windows.FILE_NOTIFY_CHANGE_CREATION, &count, &over, 0)
		if err != nil && err != windows.ERROR_IO_PENDING {
			a.mu.Lock()
			a.stats.Error = "文件夹监听中断：" + root
			a.mu.Unlock()
			return
		}
		which, e := windows.WaitForMultipleObjects([]windows.Handle{stop, ev}, false, windows.INFINITE)
		if e != nil || which == windows.WAIT_OBJECT_0 {
			windows.CancelIoEx(h, &over)
			windows.GetOverlappedResult(h, &over, &count, true)
			return
		}
		if e = windows.GetOverlappedResult(h, &over, &count, false); e != nil {
			a.reconcile()
			continue
		}
		if count == 0 {
			a.reconcile()
			continue
		}
		paths := []string{}
		for offset := uint32(0); offset+12 <= count; {
			next := binary.LittleEndian.Uint32(buffer[offset:])
			action := binary.LittleEndian.Uint32(buffer[offset+4:])
			n := binary.LittleEndian.Uint32(buffer[offset+8:])
			if offset+12+n > count || n%2 != 0 {
				a.reconcile()
				break
			}
			units := make([]uint16, n/2)
			for i := range units {
				units[i] = binary.LittleEndian.Uint16(buffer[offset+12+uint32(i*2):])
			}
			p := filepath.Join(root, string(utf16.Decode(units)))
			if action != 2 && action != 4 {
				if c, _ := a.configSnapshot(); a.ignored(p, c) {
				} else if st, e := os.Stat(p); e == nil && st.IsDir() {
					a.reconcile()
				} else {
					paths = append(paths, p)
				}
			}
			if next == 0 {
				break
			}
			offset += next
		}
		if len(paths) > 0 {
			a.ingestPaths(paths)
		}
	}
}
func startWindowsActivity(a *AutoCollector) func() {
	ready := make(chan uint32, 1)
	done := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(done)
		user := syscall.NewLazyDLL("user32.dll")
		var msg trayMessage
		// Create the thread message queue before advertising its id.
		user.NewProc("PeekMessageW").Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0, 0)
		id := windows.GetCurrentThreadId()
		ready <- id
		last := time.Time{}
		callback := syscall.NewCallback(func(h uintptr, event uint32, hwnd uintptr, object, child int32, thread, tick uint32) uintptr {
			front, _, _ := user.NewProc("GetForegroundWindow").Call()
			if hwnd == front && time.Since(last) > time.Second {
				last = time.Now()
				captureWindowsActivity(a)
			}
			return 0
		})
		foreground, _, _ := user.NewProc("SetWinEventHook").Call(3, 3, 0, callback, 0, 0, 2)
		title, _, _ := user.NewProc("SetWinEventHook").Call(0x800c, 0x800c, 0, callback, 0, 0, 2)
		timer, _, _ := user.NewProc("SetTimer").Call(0, 0, 60000, 0)
		captureWindowsActivity(a)
		for {
			r, _, _ := user.NewProc("GetMessageW").Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
			if int32(r) <= 0 {
				break
			}
			if msg.Message == 0x113 {
				captureWindowsActivity(a)
			}
			user.NewProc("TranslateMessage").Call(uintptr(unsafe.Pointer(&msg)))
			user.NewProc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&msg)))
		}
		captureWindowsActivity(a)
		if foreground != 0 {
			user.NewProc("UnhookWinEvent").Call(foreground)
		}
		if title != 0 {
			user.NewProc("UnhookWinEvent").Call(title)
		}
		user.NewProc("KillTimer").Call(0, timer)
	}()
	id := <-ready
	return func() { syscall.NewLazyDLL("user32.dll").NewProc("PostThreadMessageW").Call(uintptr(id), 0x12, 0, 0) }
}

// Only the foreground window title and application name are read; input contents are never read.
func captureWindowsActivity(a *AutoCollector) {
	user := syscall.NewLazyDLL("user32.dll")
	hwnd, _, _ := user.NewProc("GetForegroundWindow").Call()
	title := make([]uint16, 1001)
	user.NewProc("GetWindowTextW").Call(hwnd, uintptr(unsafe.Pointer(&title[0])), 1000)
	var pid uint32
	user.NewProc("GetWindowThreadProcessId").Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	app := ""
	if h, e := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid); e == nil {
		buf := make([]uint16, 1024)
		n := uint32(len(buf))
		if ok, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("QueryFullProcessImageNameW").Call(uintptr(h), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n))); ok != 0 {
			app = filepath.Base(windows.UTF16ToString(buf[:n]))
		}
		windows.CloseHandle(h)
	}
	last := struct {
		Size uint32
		Tick uint32
	}{Size: 8}
	user.NewProc("GetLastInputInfo").Call(uintptr(unsafe.Pointer(&last)))
	tick, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetTickCount").Call()
	idle := float64(uint32(tick)-last.Tick) / 1000
	a.ingestActivity(AutoActivity{At: time.Now().UTC().Format(time.RFC3339Nano), App: app, Title: windows.UTF16ToString(title), IdleSeconds: idle, Paused: hwnd == 0, TitleAccess: true})
}

func watchParent(pid int, stop func()) func() { return func() {} }
