package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"image/png"
	"math"
	"syscall"
	"unsafe"
)

//go:embed windows/launch-cover.png
var windowsLaunchCoverPNG []byte

const launchCoverTimer = 0x4a43

type launchRect struct{ Left, Top, Right, Bottom int32 }
type launchPaint struct {
	DC              uintptr
	Erase           int32
	Rect            launchRect
	Restore, Update int32
	Reserved        [32]byte
}
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
	pixels                 []byte
	width, height          int
}

var windowsCoverError string

var coverUser = syscall.NewLazyDLL("user32.dll")
var coverGDI = syscall.NewLazyDLL("gdi32.dll")

// An owned native surface covers the host before WebView2 exists. The host stays
// visible throughout initialization, so the renderer's visibility/paint lifecycle
// is unchanged. A nearly opaque layered surface avoids native occlusion throttling.
func newWindowsLaunchCover(parent uintptr) *windowsLaunchCover {
	if parent == 0 {
		return nil
	}
	image, err := png.Decode(bytes.NewReader(windowsLaunchCoverPNG))
	if err != nil {
		windowsCoverError = "decode: " + err.Error()
		return nil
	}
	c := &windowsLaunchCover{parent: parent, width: image.Bounds().Dx(), height: image.Bounds().Dy()}
	c.pixels = make([]byte, c.width*c.height*4)
	for y := 0; y < c.height; y++ {
		for x := 0; x < c.width; x++ {
			r, g, b, _ := image.At(x, y).RGBA()
			i := (y*c.width + x) * 4
			c.pixels[i], c.pixels[i+1], c.pixels[i+2] = byte(b>>8), byte(g>>8), byte(r>>8)
		}
	}
	instance, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
	brush, _, _ := coverGDI.NewProc("CreateSolidBrush").Call(0x00ebf3ee)
	class := trayClass{Instance: instance, Name: winstr("ProjectJournalLaunchCover"), Brush: brush}
	class.Proc = syscall.NewCallback(func(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
		switch msg {
		case 0x000f:
			c.paint(hwnd)
			return 0
		case 0x0014:
			return 1
		case 0x0082:
			c.hwnd = 0
			c.pixels = nil
		}
		r, _, _ := coverUser.NewProc("DefWindowProcW").Call(hwnd, uintptr(msg), wp, lp)
		return r
	})
	class.Size = uint32(unsafe.Sizeof(class))
	registered, _, registerError := coverUser.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&class)))
	if registered == 0 {
		windowsCoverError = fmt.Sprintf("register: %v", registerError)
	}
	rect := c.bounds()
	var createError error
	c.hwnd, _, createError = coverUser.NewProc("CreateWindowExW").Call(0x08080080, uintptr(unsafe.Pointer(class.Name)), uintptr(unsafe.Pointer(winstr("项目手记启动画面"))), 0x90000000, uintptr(rect.Left), uintptr(rect.Top), uintptr(rect.Right-rect.Left), uintptr(rect.Bottom-rect.Top), parent, 0, instance, 0)
	if c.hwnd == 0 {
		windowsCoverError += fmt.Sprintf(" create: %v", createError)
		c.pixels = nil
		return nil
	}
	coverUser.NewProc("SetLayeredWindowAttributes").Call(c.hwnd, 0, 254, 2)
	coverUser.NewProc("UpdateWindow").Call(c.hwnd)
	hook := syscall.NewCallback(func(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
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
	// Only an emergency fail-open; successful launches remove the cover on paint.
	coverUser.NewProc("SetTimer").Call(parent, launchCoverTimer, 8000, 0)
	return c
}
func (c *windowsLaunchCover) bounds() launchRect {
	var rect launchRect
	coverUser.NewProc("GetClientRect").Call(c.parent, uintptr(unsafe.Pointer(&rect)))
	var point struct{ X, Y int32 }
	coverUser.NewProc("ClientToScreen").Call(c.parent, uintptr(unsafe.Pointer(&point)))
	return launchRect{point.X, point.Y, point.X + rect.Right, point.Y + rect.Bottom}
}
func (c *windowsLaunchCover) position() {
	r := c.bounds()
	coverUser.NewProc("SetWindowPos").Call(c.hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), 0x14)
}
func (c *windowsLaunchCover) paint(hwnd uintptr) {
	var ps launchPaint
	dc, _, _ := coverUser.NewProc("BeginPaint").Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	defer coverUser.NewProc("EndPaint").Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	if len(c.pixels) == 0 {
		return
	}
	var rect launchRect
	coverUser.NewProc("GetClientRect").Call(hwnd, uintptr(unsafe.Pointer(&rect)))
	w, h := int(rect.Right), int(rect.Bottom)
	scale := math.Max(float64(w)/float64(c.width), float64(h)/float64(c.height))
	w2, h2 := int(math.Ceil(float64(c.width)*scale)), int(math.Ceil(float64(c.height)*scale))
	info := launchBitmap{Size: 40, Width: int32(c.width), Height: -int32(c.height), Planes: 1, Bits: 32}
	coverGDI.NewProc("SetStretchBltMode").Call(dc, 4)
	coverGDI.NewProc("StretchDIBits").Call(dc, uintptr((w-w2)/2), uintptr((h-h2)/2), uintptr(w2), uintptr(h2), 0, 0, uintptr(c.width), uintptr(c.height), uintptr(unsafe.Pointer(&c.pixels[0])), uintptr(unsafe.Pointer(&info)), 0, 0x00cc0020)
}
func (c *windowsLaunchCover) dismiss() bool {
	if c == nil || c.hwnd == 0 {
		return false
	}
	coverUser.NewProc("KillTimer").Call(c.parent, launchCoverTimer)
	destroyed, _, _ := coverUser.NewProc("DestroyWindow").Call(c.hwnd)
	if destroyed == 0 {
		return false
	}
	c.hwnd = 0
	c.pixels = nil
	return true
}
