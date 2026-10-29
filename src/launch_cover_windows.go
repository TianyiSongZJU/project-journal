package main

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"
)

const launchCoverTimer = 0x4a43
const launchAnimationTimer = 0x4a44

type launchRect struct{ Left, Top, Right, Bottom int32 }
type launchBitmap struct {
	Size                     uint32
	Width, Height            int32
	Planes, Bits             uint16
	Compression, ImageSize   uint32
	XResolution, YResolution int32
	Used, Important          uint32
}
type windowsLaunchCover struct {
	parent, hwnd, previous uintptr
	renderer               *nativeLaunchRenderer
	started                time.Time
	exitClock              time.Time
	mode                   string
	warm, reduced          bool
	paintedFrames          int
	dc, bitmap, oldBitmap  uintptr
	dib                    []byte
	width, height          int
	onDone                 func()
	maxFrame, totalFrame   time.Duration
}

var windowsCoverError string

var coverUser = syscall.NewLazyDLL("user32.dll")
var coverGDI = syscall.NewLazyDLL("gdi32.dll")

// An owned native surface covers the host before WebView2 exists. The host stays
// visible throughout initialization, so the renderer's visibility/paint lifecycle
// is unchanged. A nearly opaque layered surface avoids native occlusion throttling.
func newWindowsLaunchCover(parent uintptr, warm bool) *windowsLaunchCover {
	if parent == 0 {
		return nil
	}
	mode := "cold"
	if warm {
		mode = "warm"
	}
	c := &windowsLaunchCover{parent: parent, mode: mode, warm: warm, started: time.Now()}
	var enabled int32 = 1
	coverUser.NewProc("SystemParametersInfoW").Call(0x1042, 0, uintptr(unsafe.Pointer(&enabled)), 0)
	c.reduced = enabled == 0
	rect := c.bounds()
	var err error
	c.renderer, err = newNativeLaunchRenderer(int(rect.Right-rect.Left), int(rect.Bottom-rect.Top), warm)
	if err != nil {
		windowsCoverError = "native artwork: " + err.Error()
		return nil
	}
	instance, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	brush, _, _ := coverGDI.NewProc("CreateSolidBrush").Call(0x00ebf3ee)
	class := trayClass{Instance: instance, Name: winstr("ProjectJournalLaunchCover"), Brush: brush}
	class.Proc = syscall.NewCallback(func(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
		switch msg {
		case 0x000f:
			coverUser.NewProc("ValidateRect").Call(hwnd, 0)
			return 0
		case 0x0014:
			return 1
		case 0x0082:
			c.hwnd = 0
			c.dib = nil
		}
		r, _, _ := coverUser.NewProc("DefWindowProcW").Call(hwnd, uintptr(msg), wp, lp)
		return r
	})
	class.Size = uint32(unsafe.Sizeof(class))
	registered, _, registerError := coverUser.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&class)))
	if registered == 0 {
		windowsCoverError = fmt.Sprintf("register: %v", registerError)
	}
	rect = c.bounds()
	var createError error
	c.hwnd, _, createError = coverUser.NewProc("CreateWindowExW").Call(0x08080080, uintptr(unsafe.Pointer(class.Name)), uintptr(unsafe.Pointer(winstr("项目手记启动画面"))), 0x90000000, uintptr(rect.Left), uintptr(rect.Top), uintptr(rect.Right-rect.Left), uintptr(rect.Bottom-rect.Top), parent, 0, instance, 0)
	if c.hwnd == 0 {
		windowsCoverError += fmt.Sprintf(" create: %v", createError)
		c.dib = nil
		return nil
	}
	c.render()
	hook := syscall.NewCallback(func(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
		if msg == 0x0113 && wp == launchAnimationTimer {
			if c.hwnd != 0 {
				c.render()
			}
			return 0
		}
		if msg == 0x0113 && wp == launchCoverTimer {
			c.dismiss()
			return 0
		}
		if msg == 0x0002 {
			c.dismiss()
		}
		r, _, _ := coverUser.NewProc("CallWindowProcW").Call(c.previous, hwnd, uintptr(msg), wp, lp)
		if (msg == 0x0005 || msg == 0x0003) && c.hwnd != 0 {
			c.position()
		}
		return r
	})
	c.previous, _, _ = coverUser.NewProc("SetWindowLongPtrW").Call(parent, ^uintptr(3), hook)
	coverUser.NewProc("SetTimer").Call(parent, launchAnimationTimer, 15, 0)
	// Only an emergency fail-open; successful launches remove the cover on paint.
	coverUser.NewProc("SetTimer").Call(parent, launchCoverTimer, 8000, 0)
	return c
}

// The native message pump also runs during WebView2 environment creation.
func (c *windowsLaunchCover) elapsed() float64 {
	elapsed := float64(time.Since(c.started)) / float64(time.Millisecond)
	if c.warm && !c.exitClock.IsZero() {
		elapsed += float64(time.Since(c.exitClock)) / float64(time.Millisecond) * .8
	}
	return elapsed
}
func (c *windowsLaunchCover) finish(reduced bool) {
	if c == nil || c.hwnd == 0 {
		return
	}
	if reduced || c.reduced {
		c.dismiss()
		return
	}
	if c.exitClock.IsZero() {
		c.exitClock = time.Now()
		c.renderer.finish(c.elapsed())
	}
}
func (c *windowsLaunchCover) releaseBitmap() {
	if c.dc != 0 {
		coverGDI.NewProc("SelectObject").Call(c.dc, c.oldBitmap)
		coverGDI.NewProc("DeleteObject").Call(c.bitmap)
		coverGDI.NewProc("DeleteDC").Call(c.dc)
	}
	c.dc, c.bitmap, c.oldBitmap = 0, 0, 0
	c.dib = nil
}
func (c *windowsLaunchCover) render() {
	began := time.Now()
	rect := c.bounds()
	w, h := int(rect.Right-rect.Left), int(rect.Bottom-rect.Top)
	if w < 1 || h < 1 {
		return
	}
	if c.dc == 0 || c.width != w || c.height != h {
		c.releaseBitmap()
		if c.renderer.scene.w != w || c.renderer.scene.h != h {
			finishing := c.renderer.exit != nil
			c.renderer.resize(w, h)
			if finishing {
				c.renderer.exit = c.renderer.scene.finish(c.elapsed())
			}
		}
		c.width, c.height = w, h
		c.dc, _, _ = coverGDI.NewProc("CreateCompatibleDC").Call(0)
		info := launchBitmap{Size: 40, Width: int32(w), Height: -int32(h), Planes: 1, Bits: 32}
		var bits uintptr
		c.bitmap, _, _ = coverGDI.NewProc("CreateDIBSection").Call(c.dc, uintptr(unsafe.Pointer(&info)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
		if c.bitmap == 0 || bits == 0 {
			windowsCoverError = "native bitmap allocation failed"
			c.dismiss()
			return
		}
		c.oldBitmap, _, _ = coverGDI.NewProc("SelectObject").Call(c.dc, c.bitmap)
		c.dib = unsafe.Slice((*byte)(unsafe.Pointer(bits)), w*h*4)
	}
	timeMS := c.elapsed()
	if c.reduced {
		timeMS = 0
	}
	maximum := c.renderer.render(timeMS)
	if c.renderer.exit != nil && timeMS >= c.renderer.exit.end && maximum <= 1 {
		c.dismiss()
		return
	}
	pixels := c.renderer.frame.Pix
	for i := 0; i < len(pixels); i += 4 {
		c.dib[i], c.dib[i+1], c.dib[i+2], c.dib[i+3] = pixels[i+2], pixels[i+1], pixels[i], pixels[i+3]
	}
	destination := struct{ X, Y int32 }{rect.Left, rect.Top}
	size := struct{ X, Y int32 }{int32(w), int32(h)}
	source := struct{ X, Y int32 }{}
	// Premultiplied per-pixel alpha provides the actual local dissolve. A constant
	// 254 alpha keeps WebView2 rendering behind the initially opaque artwork.
	blend := struct{ Op, Flags, Alpha, Format byte }{0, 0, 254, 1}
	ok, _, err := coverUser.NewProc("UpdateLayeredWindow").Call(c.hwnd, 0, uintptr(unsafe.Pointer(&destination)), uintptr(unsafe.Pointer(&size)), c.dc, uintptr(unsafe.Pointer(&source)), 0, uintptr(unsafe.Pointer(&blend)), 2)
	if ok == 0 {
		windowsCoverError = fmt.Sprintf("native presentation: %v", err)
		c.dismiss()
		return
	}
	c.paintedFrames++
	duration := time.Since(began)
	c.totalFrame += duration
	if duration > c.maxFrame {
		c.maxFrame = duration
	}
}
func (c *windowsLaunchCover) bounds() launchRect {
	var rect launchRect
	coverUser.NewProc("GetClientRect").Call(c.parent, uintptr(unsafe.Pointer(&rect)))
	var point struct{ X, Y int32 }
	coverUser.NewProc("ClientToScreen").Call(c.parent, uintptr(unsafe.Pointer(&point)))
	return launchRect{point.X, point.Y, point.X + rect.Right, point.Y + rect.Bottom}
}
func (c *windowsLaunchCover) position() {
	if c.hwnd != 0 {
		c.render()
	}
}
func (c *windowsLaunchCover) dismiss() bool {
	if c == nil || c.hwnd == 0 {
		return false
	}
	coverUser.NewProc("KillTimer").Call(c.parent, launchCoverTimer)
	coverUser.NewProc("KillTimer").Call(c.parent, launchAnimationTimer)
	destroyed, _, _ := coverUser.NewProc("DestroyWindow").Call(c.hwnd)
	if destroyed == 0 {
		return false
	}
	c.hwnd = 0
	c.releaseBitmap()
	if c.onDone != nil {
		c.onDone()
	}
	return true
}
