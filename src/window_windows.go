package main

import (
	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
)

func init() {
	runtime.LockOSThread()
	showLaunchError = func(message string) { windowsMessage("项目手记 · 无法启动", message) }
}
func windowsMessage(title, message string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(message)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x10)
}
func runWindowUI(address string) {
	if version, e := webviewloader.GetInstalledVersion(); e != nil || version == "" {
		windowsMessage("项目手记 · 缺少系统组件", "请先安装 Microsoft WebView2 Runtime，再重新打开项目手记。\n\n官方下载：https://developer.microsoft.com/microsoft-edge/webview2/\n\n这只需安装一次，项目数据不会上传。")
		return
	}
	cache, _ := os.UserCacheDir()
	w := webview2.NewWithOptions(webview2.WebViewOptions{DataPath: filepath.Join(cache, "ProjectJournal", "WebView2"), AutoFocus: true, WindowOptions: webview2.WindowOptions{Title: "项目手记", IconId: 1, Width: 1120, Height: 740, Center: true}})
	if w == nil {
		windowsMessage("项目手记", "无法创建窗口，请确认 WebView2 Runtime 已安装。")
		return
	}
	defer w.Destroy()
	w.SetSize(720, 550, webview2.HintMin)
	nativeClose = func() { w.Dispatch(w.Terminate) }
	// Wait for the renderer to finish saving before accepting native window close.
	closing, closeApproved := false, false
	w.Bind("journalNativeCloseReady", func(ok bool) {
		w.Dispatch(func() {
			closing = false
			if ok {
				closeApproved = true
				w.Destroy()
			}
		})
	})
	user32 := syscall.NewLazyDLL("user32.dll")
	setProc := user32.NewProc("SetWindowLongPtrW")
	callProc := user32.NewProc("CallWindowProcW")
	var previous uintptr
	hook := syscall.NewCallback(func(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
		if msg == 0x0010 && !closeApproved {
			if !closing {
				closing = true
				w.Eval("Promise.resolve(window.journalFlush ? window.journalFlush() : true).then(ok => window.journalNativeCloseReady(!!ok)).catch(() => window.journalNativeCloseReady(false));")
			}
			return 0
		}
		value, _, _ := callProc.Call(previous, hwnd, uintptr(msg), wp, lp)
		return value
	})
	previous, _, _ = setProc.Call(uintptr(w.Window()), ^uintptr(3), hook)
	w.Bind("journalChooseFolder", func() []string { return windowsChooseFolder(uintptr(w.Window())) })
	w.Navigate(address)
	w.Run()
}
