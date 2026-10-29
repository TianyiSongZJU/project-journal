package main

import (
	"encoding/json"
	"flag"
	"fmt"
	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// The Windows resource compiler assigns ID 1 to the manifest, then ID 2 to the icon group.
const windowsAppIconID = 2

var windowsWarmOpen bool

func init() {
	runtime.LockOSThread()
	flag.BoolVar(&backgroundOnly, "background", false, "登录后仅在后台运行")
	flag.BoolVar(&windowsWarmOpen, "warm-open", false, "从托盘重新打开窗口")
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
	var launchCover *windowsLaunchCover
	w := webview2.NewWithOptions(webview2.WebViewOptions{DataPath: filepath.Join(cache, "ProjectJournal", "WebView2"), AutoFocus: true, WindowOptions: webview2.WindowOptions{Title: "项目手记", IconId: windowsAppIconID, Width: 1120, Height: 740, Center: true, OnCreated: func(hwnd uintptr) { launchCover = newWindowsLaunchCover(hwnd, windowsWarmOpen) }}})
	if w == nil {
		windowsMessage("项目手记", "无法创建窗口，请确认 WebView2 Runtime 已安装。")
		return
	}
	defer w.Destroy()
	defer launchCover.dismiss()
	nativeFramesBeforeWebview := 0
	if launchCover != nil {
		nativeFramesBeforeWebview = launchCover.paintedFrames
	}
	w.Bind("journalLaunchPainted", func() map[string]any {
		// WebView2 message callbacks already run on this window's UI thread.
		mode := ""
		frames := 0
		if launchCover != nil {
			mode = launchCover.mode
			frames = launchCover.paintedFrames
		}
		return map[string]any{"removed": launchCover == nil || launchCover.hwnd == 0, "error": windowsCoverError, "mode": mode, "frames": frames, "beforeWebview": nativeFramesBeforeWebview, "native": true}
	})
	if launchCover != nil {
		launchCover.onDone = func() {
			w.Eval("window.journalLaunchNativeMetrics=" + fmt.Sprintf(`{"frames":%d,"averageMs":%.3f,"maxMs":%.3f}`, launchCover.paintedFrames, float64(launchCover.totalFrame)/float64(time.Millisecond)/float64(max(1, launchCover.paintedFrames)), float64(launchCover.maxFrame)/float64(time.Millisecond)) + ";window.journalLaunchCoverReleased=true;window.dispatchEvent(new Event('journal-native-launch-finished'));")
		}
	}
	w.Bind("journalFinishLaunch", func(reduced bool) bool {
		if launchCover == nil || launchCover.hwnd == 0 {
			return false
		}
		launchCover.finish(reduced)
		return true
	})
	// Keep display preferences local and stable across the backend's random ports.
	viewPath := filepath.Join(autoHome(flag.Lookup("data-dir").Value.String(), flag.Lookup("auto-home").Value.String()), "windows-view.json")
	var viewMu sync.Mutex
	w.Bind("journalLoadHiddenClients", func() ([]string, error) {
		viewMu.Lock()
		defer viewMu.Unlock()
		b, err := os.ReadFile(viewPath)
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		if err != nil {
			return nil, err
		}
		var hidden []string
		err = json.Unmarshal(b, &hidden)
		return hidden, err
	})
	w.Bind("journalSaveHiddenClients", func(hidden []string) error {
		viewMu.Lock()
		defer viewMu.Unlock()
		b, err := json.Marshal(hidden)
		if err != nil {
			return err
		}
		if err = os.MkdirAll(filepath.Dir(viewPath), 0755); err != nil {
			return err
		}
		return atomicWrite(viewPath, b)
	})
	w.SetSize(720, 550, webview2.HintMin)
	// Keep native Windows presentation separate from the shared macOS styles.
	started := int64(0)
	if launchCover != nil {
		started = launchCover.started.UnixMilli()
	}
	w.Init(`window.journalLaunchNative = true;window.journalLaunchStarted = ` + strconv.FormatInt(started, 10) + `;window.journalLaunchWarm = ` + map[bool]string{true: "true", false: "false"}[windowsWarmOpen] + `;window.journalWindowsHost = true;
	document.addEventListener("DOMContentLoaded", () => {
		document.documentElement.classList.add("native-windows");
		const style = document.createElement("link");
		style.rel = "stylesheet";
		style.href = "windows.css";
		document.head.appendChild(style);
	}, { once: true });`)
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
