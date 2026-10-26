package main

import (
	"golang.org/x/sys/windows"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"unsafe"
)

var trayUser = syscall.NewLazyDLL("user32.dll")

func winstr(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

type trayClass struct {
	Size, Style                   uint32
	Proc                          uintptr
	ClsExtra, WndExtra            int32
	Instance, Icon, Cursor, Brush uintptr
	Menu, Name                    *uint16
	SmallIcon                     uintptr
}
type trayMessage struct {
	Window         uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	X, Y           int32
	Private        uint32
}
type trayNotify struct {
	Size               uint32
	Window             uintptr
	ID, Flags, Message uint32
	Icon               uintptr
	Tip                [128]uint16
	State, StateMask   uint32
	Info               [256]uint16
	Timeout            uint32
	Title              [64]uint16
	InfoFlags          uint32
	GUID               windows.GUID
	BalloonIcon        uintptr
}

func runWindow(address string) {
	if uiOnly || currentAuto == nil {
		runWindowUI(address)
		return
	}
	var child *exec.Cmd
	var mu sync.Mutex
	open := func() {
		mu.Lock()
		defer mu.Unlock()
		if child != nil && child.Process != nil {
			pid := uint32(child.Process.Pid)
			callback := syscall.NewCallback(func(h, lp uintptr) uintptr {
				var wp uint32
				trayUser.NewProc("GetWindowThreadProcessId").Call(h, uintptr(unsafe.Pointer(&wp)))
				if wp == pid {
					trayUser.NewProc("ShowWindow").Call(h, 9)
					trayUser.NewProc("SetForegroundWindow").Call(h)
				}
				return 1
			})
			trayUser.NewProc("EnumWindows").Call(callback, 0)
			return
		}
		exe, _ := os.Executable()
		cmd := exec.Command(exe, "--ui-only", "--data-dir", currentAuto.store.dir)
		if cmd.Start() == nil {
			child = cmd
			go func() {
				cmd.Wait()
				mu.Lock()
				if child == cmd {
					child = nil
				}
				mu.Unlock()
			}()
		}
	}
	instance, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	var hwnd uintptr
	shell := syscall.NewLazyDLL("shell32.dll")
	notify := trayNotify{ID: 1, Flags: 7, Message: 0x8001}
	notify.Size = uint32(unsafe.Sizeof(notify))
	copy(notify.Tip[:], syscall.StringToUTF16("项目手记 · 后台记录"))
	notify.Icon, _, _ = trayUser.NewProc("LoadIconW").Call(instance, 1)
	quit := func() {
		mu.Lock()
		running := child != nil
		mu.Unlock()
		if running {
			open()
			windowsMessage("项目手记", "请在主窗口的更多菜单中选择“退出软件”，以便保存当前编辑。")
			return
		}
		trayUser.NewProc("PostMessageW").Call(hwnd, 0x10, 0, 0)
	}
	proc := syscall.NewCallback(func(h uintptr, msg uint32, wp, lp uintptr) uintptr {
		switch msg {
		case 0x8001:
			if lp == 0x203 || lp == 0x202 {
				open()
			}
			if lp == 0x205 {
				menu, _, _ := trayUser.NewProc("CreatePopupMenu").Call()
				trayUser.NewProc("AppendMenuW").Call(menu, 0, 1, uintptr(unsafe.Pointer(winstr("打开项目手记"))))
				c, _ := currentAuto.configSnapshot()
				currentAuto.mu.Lock()
				stats := currentAuto.stats
				currentAuto.mu.Unlock()
				stats = effectiveAutoStats(c, stats)
				status := "● " + stats.Status
				if stats.Status == "监听中" {
					if c.Activity {
						status += " · 文件＋时长辅助"
					} else {
						status += " · 仅文件活动"
					}
				}
				trayUser.NewProc("AppendMenuW").Call(menu, 2, 0, uintptr(unsafe.Pointer(winstr(status))))
				label := "继续自动记录"
				if c.Enabled {
					label = "暂停自动记录"
				}
				trayUser.NewProc("AppendMenuW").Call(menu, 0, 2, uintptr(unsafe.Pointer(winstr(label))))
				trayUser.NewProc("AppendMenuW").Call(menu, 0, 3, uintptr(unsafe.Pointer(winstr("退出项目手记"))))
				var pt struct{ X, Y int32 }
				trayUser.NewProc("GetCursorPos").Call(uintptr(unsafe.Pointer(&pt)))
				trayUser.NewProc("SetForegroundWindow").Call(h)
				action, _, _ := trayUser.NewProc("TrackPopupMenu").Call(menu, 0x100, uintptr(pt.X), uintptr(pt.Y), 0, h, 0)
				trayUser.NewProc("DestroyMenu").Call(menu)
				switch action {
				case 1:
					open()
				case 2:
					c, r := currentAuto.configSnapshot()
					c.Enabled = !c.Enabled
					currentAuto.saveConfig(c, r)
				case 3:
					quit()
				}
			}
			return 0
		case 0x10:
			shell.NewProc("Shell_NotifyIconW").Call(2, uintptr(unsafe.Pointer(&notify)))
			trayUser.NewProc("DestroyWindow").Call(h)
			return 0
		case 2:
			trayUser.NewProc("PostQuitMessage").Call(0)
			return 0
		}
		v, _, _ := trayUser.NewProc("DefWindowProcW").Call(h, uintptr(msg), wp, lp)
		return v
	})
	cls := trayClass{Proc: proc, Instance: instance, Name: winstr("ProjectJournalV2Tray")}
	cls.Size = uint32(unsafe.Sizeof(cls))
	trayUser.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&cls)))
	hwnd, _, _ = trayUser.NewProc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(cls.Name)), uintptr(unsafe.Pointer(winstr("项目手记后台"))), 0, 0, 0, 0, 0, 0, 0, instance, 0)
	if hwnd == 0 {
		windowsMessage("项目手记", "无法建立后台窗口")
		return
	}
	notify.Window = hwnd
	shell.NewProc("Shell_NotifyIconW").Call(0, uintptr(unsafe.Pointer(&notify)))
	nativeClose = func() {
		mu.Lock()
		var pid uint32
		if child != nil && child.Process != nil {
			pid = uint32(child.Process.Pid)
		}
		mu.Unlock()
		if pid != 0 {
			callback := syscall.NewCallback(func(h, lp uintptr) uintptr {
				var wp uint32
				trayUser.NewProc("GetWindowThreadProcessId").Call(h, uintptr(unsafe.Pointer(&wp)))
				if wp == pid {
					trayUser.NewProc("PostMessageW").Call(h, 0x10, 0, 0)
				}
				return 1
			})
			trayUser.NewProc("EnumWindows").Call(callback, 0)
		}
		trayUser.NewProc("PostMessageW").Call(hwnd, 0x10, 0, 0)
	}
	open()
	var msg trayMessage
	for {
		result, _, _ := trayUser.NewProc("GetMessageW").Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) <= 0 {
			break
		}
		trayUser.NewProc("TranslateMessage").Call(uintptr(unsafe.Pointer(&msg)))
		trayUser.NewProc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&msg)))
	}
}
func windowsChooseFolder(owner uintptr) []string {
	type browseInfo struct {
		Owner, Root     uintptr
		Display         *uint16
		Title           *uint16
		Flags           uint32
		Callback, Param uintptr
		Image           int32
	}
	display := make([]uint16, 260)
	info := browseInfo{Owner: owner, Display: &display[0], Title: winstr("选择项目资料夹（可多次添加）"), Flags: 0x41}
	shell := syscall.NewLazyDLL("shell32.dll")
	item, _, _ := shell.NewProc("SHBrowseForFolderW").Call(uintptr(unsafe.Pointer(&info)))
	if item == 0 {
		return []string{}
	}
	defer syscall.NewLazyDLL("ole32.dll").NewProc("CoTaskMemFree").Call(item)
	path := make([]uint16, 32768)
	ok, _, _ := shell.NewProc("SHGetPathFromIDListW").Call(item, uintptr(unsafe.Pointer(&path[0])))
	if ok == 0 {
		return []string{}
	}
	return []string{syscall.UTF16ToString(path)}
}
