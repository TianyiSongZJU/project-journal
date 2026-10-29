package main

import (
	"bytes"
	_ "embed"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"sync"
)

// These two small textures are exported from the existing relief artwork.
// Geometry, motion, compositing and readiness-driven reveal run entirely in Go.
//
//go:embed windows/launch-native/tileTexture.png
var nativeTilePNG []byte

//go:embed windows/launch-native/featherTexture.png
var nativeFeatherPNG []byte

type nativeLaunchRenderer struct {
	scene                           *nativeReliefScene
	exit                            *nativeReliefExit
	frame, sprite, texture, feather *image.RGBA
	background                      []byte
	light                           []uint8
	mask                            []byte
	maskPoints                      []reliefPoint
	mw, mh                          int
	sx, sy                          int
	warm                            bool
	pixelMask                       []byte
	maskX, maskY                    []nativeMaskAxis
}

type nativeMaskAxis struct {
	low, high int
	fraction  float64
}

func nativeMaskAxes(count, small int) []nativeMaskAxis {
	axes := make([]nativeMaskAxis, count)
	for i := range axes {
		p := (float64(i)+.5)*float64(small)/float64(count) - .5
		low := int(math.Floor(p))
		axes[i] = nativeMaskAxis{max(0, min(small-1, low)), max(0, min(small-1, low+1)), p - float64(low)}
	}
	return axes
}
func sampleNativeGray(img *image.RGBA, x, y float64) float64 {
	x0, y0 := int(math.Floor(x)), int(math.Floor(y))
	fx, fy := x-float64(x0), y-float64(y0)
	x1, y1 := max(0, min(255, x0+1)), max(0, min(255, y0+1))
	x0, y0 = max(0, min(255, x0)), max(0, min(255, y0))
	a, b := float64(img.Pix[y0*img.Stride+x0*4]), float64(img.Pix[y0*img.Stride+x1*4])
	c, d := float64(img.Pix[y1*img.Stride+x0*4]), float64(img.Pix[y1*img.Stride+x1*4])
	return (a+(b-a)*fx)*(1-fy) + (c+(d-c)*fx)*fy
}
func newNativeLaunchRenderer(w, h int, warm bool) (*nativeLaunchRenderer, error) {
	r := &nativeLaunchRenderer{warm: warm}
	for i, data := range [][]byte{nativeTilePNG, nativeFeatherPNG} {
		decoded, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		rgba := image.NewRGBA(decoded.Bounds())
		draw.Draw(rgba, rgba.Bounds(), decoded, decoded.Bounds().Min, draw.Src)
		if i == 0 {
			r.texture = rgba
		} else {
			r.feather = rgba
		}
	}
	r.resize(w, h)
	return r, nil
}

// Bilinear sampling preserves the original rounded edges and shadow softness.
func sampleRelief(img *image.RGBA, x, y float64) [4]float64 {
	x0, y0 := int(math.Floor(x)), int(math.Floor(y))
	fx, fy := x-float64(x0), y-float64(y0)
	var out [4]float64
	for j := 0; j < 2; j++ {
		for i := 0; i < 2; i++ {
			xx, yy := x0+i, y0+j
			if xx < 0 || yy < 0 || xx >= img.Rect.Dx() || yy >= img.Rect.Dy() {
				continue
			}
			weight := fx
			if i == 0 {
				weight = 1 - fx
			}
			if j == 0 {
				weight *= 1 - fy
			} else {
				weight *= fy
			}
			index := yy*img.Stride + xx*4
			for c := 0; c < 4; c++ {
				out[c] += float64(img.Pix[index+c]) * weight
			}
		}
	}
	return out
}
func (r *nativeLaunchRenderer) resize(w, h int) {
	r.scene = newNativeReliefScene(w, h, r.warm)
	s := r.scene
	r.frame = image.NewRGBA(image.Rect(0, 0, w, h))
	r.background = make([]byte, w*h*4)
	r.light = make([]uint8, w*h)
	// Cache full-window gradients and the projected tile; only positions and
	// opacity change per frame. Resizing rebuilds this cache once.
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			vx, vy := float64(w)*.65, float64(h)
			t := reliefClamp(((float64(x)-float64(w)*.2)*vx + float64(y)*vy) / (vx*vx + vy*vy))
			colors := [3][3]float64{{250.7415, 251.991, 250.002}, {238, 243, 235}, {236.2065, 241.893, 232.6875}}
			a, b, f := colors[0], colors[1], t*2
			if t > .5 {
				a, b, f = colors[1], colors[2], (t-.5)*2
			}
			i := (y*w + x) * 4
			for c := 0; c < 3; c++ {
				r.background[i+c] = uint8(math.Round(a[c] + (b[c]-a[c])*f))
			}
			r.background[i+3] = 255
			vx, vy = float64(w)*.5, float64(h)*.8
			t = reliefClamp(((float64(x)-float64(w)*.2)*vx + float64(y)*vy) / (vx*vx + vy*vy))
			r.light[y*w+x] = uint8(math.Round(.28 * (1 - t) * 255))
		}
	}
	ex, ey := (math.Abs(s.a)+math.Abs(s.c))*215, (math.Abs(s.b)+math.Abs(s.d))*215
	r.sx, r.sy = int(math.Floor(-ex))-1, int(math.Floor(-ey))-1
	r.sprite = image.NewRGBA(image.Rect(0, 0, int(math.Ceil(ex))-r.sx+1, int(math.Ceil(ey))-r.sy+1))
	for y := 0; y < r.sprite.Rect.Dy(); y++ {
		for x := 0; x < r.sprite.Rect.Dx(); x++ {
			xx, yy := float64(x+r.sx)+.5, float64(y+r.sy)+.5
			u, v := (s.d*xx-s.c*yy)/s.det, (s.a*yy-s.b*xx)/s.det
			p := sampleRelief(r.texture, (u+215)*2-.5, (v+215)*2-.5)
			i := y*r.sprite.Stride + x*4
			for c := 0; c < 4; c++ {
				r.sprite.Pix[i+c] = uint8(math.Round(p[c]))
			}
		}
	}
	ratio := 320 / math.Max(float64(w), float64(h))
	r.mw, r.mh = int(math.Ceil(float64(w)*ratio)), int(math.Ceil(float64(h)*ratio))
	r.mask = make([]byte, r.mw*r.mh)
	r.pixelMask = make([]byte, w*h)
	for i := range r.pixelMask {
		r.pixelMask[i] = 255
	}
	r.maskX = nativeMaskAxes(w, r.mw)
	r.maskY = nativeMaskAxes(h, r.mh)
	r.maskPoints = make([]reliefPoint, len(r.mask))
	for y := 0; y < r.mh; y++ {
		for x := 0; x < r.mw; x++ {
			r.maskPoints[y*r.mw+x] = s.inverse((float64(x)+.5)*float64(w)/float64(r.mw), (float64(y)+.5)*float64(h)/float64(r.mh))
		}
	}
}
func (r *nativeLaunchRenderer) finish(time float64) {
	if r.exit == nil {
		r.exit = r.scene.finish(time)
	}
}
func (r *nativeLaunchRenderer) updateMask(time float64) {
	for i := range r.mask {
		r.mask[i] = 255
	}
	for _, p := range r.exit.plans {
		radius := p.radius(time)
		if radius <= .5 {
			continue
		}
		alpha := reliefClamp((time - p.begin) / 120)
		for i, point := range r.maskPoints {
			x, y := (point.x-p.tile.source.x)/radius, (point.y-p.tile.source.y)/radius
			if math.Abs(x) >= 1 || math.Abs(y) >= 1 {
				continue
			}
			field := sampleNativeGray(r.feather, (x+1)*128-.5, (y+1)*128-.5)
			v := uint8(math.Round(255 + (field-255)*alpha))
			if v < r.mask[i] {
				r.mask[i] = v
			}
		}
	}
}

// render returns premultiplied RGBA for UpdateLayeredWindow. The background
// and lighting share one local diffusion mask; tiles retain independent fades.
func (r *nativeLaunchRenderer) render(time float64) uint8 {
	s := r.scene
	pixels := r.frame.Pix
	if r.exit != nil {
		r.updateMask(time)
	}
	tiles, sweep := s.tiles, -1.
	if r.exit != nil {
		tiles, sweep = r.exit.tiles, r.exit.sweep
	}
	type positionedTile struct {
		rect    image.Rectangle
		opacity *image.Uniform
	}
	positioned := make([]positionedTile, 0, len(tiles))
	for _, tile := range tiles {
		lift, opacity := s.wave(tile, time, sweep)
		if r.exit != nil && time >= tile.exit {
			opacity = tile.opacity * (1 - reliefEase((time-tile.exit)/s.fade, .42, .58))
		}
		if opacity <= .001 {
			continue
		}
		x, y := int(math.Round(tile.center.x))+r.sx, int(math.Round(tile.center.y-s.scale*lift))+r.sy
		positioned = append(positioned, positionedTile{r.sprite.Bounds().Add(image.Pt(x, y)), image.NewUniform(color.Alpha{A: uint8(math.Round(opacity * 255))})})
	}
	// Each worker owns disjoint rows through every composition stage. The native
	// UI thread waits for the frame, but never does all pixel work serially.
	const workers = 4
	var group sync.WaitGroup
	var maxima [workers]uint8
	for worker := 0; worker < workers; worker++ {
		group.Add(1)
		go func(worker int) {
			defer group.Done()
			begin, end := s.h*worker/workers, s.h*(worker+1)/workers
			for y := begin; y < end; y++ {
				if r.exit == nil {
					copy(pixels[y*s.w*4:(y+1)*s.w*4], r.background[y*s.w*4:(y+1)*s.w*4])
					continue
				}
				ay := r.maskY[y]
				top, bottom := ay.low*r.mw, ay.high*r.mw
				for x, ax := range r.maskX {
					a, b := float64(r.mask[top+ax.low]), float64(r.mask[top+ax.high])
					c, d := float64(r.mask[bottom+ax.low]), float64(r.mask[bottom+ax.high])
					alpha := uint32(math.Round((a+(b-a)*ax.fraction)*(1-ay.fraction) + (c+(d-c)*ax.fraction)*ay.fraction))
					index := y*s.w + x
					r.pixelMask[index] = uint8(alpha)
					i := index * 4
					pixels[i] = uint8((uint32(r.background[i])*alpha + 127) / 255)
					pixels[i+1] = uint8((uint32(r.background[i+1])*alpha + 127) / 255)
					pixels[i+2] = uint8((uint32(r.background[i+2])*alpha + 127) / 255)
					pixels[i+3] = uint8(alpha)
				}
			}
			stripe := image.Rect(0, begin, s.w, end)
			for _, tile := range positioned {
				clipped := tile.rect.Intersect(stripe)
				if !clipped.Empty() {
					draw.DrawMask(r.frame, clipped, r.sprite, clipped.Min.Sub(tile.rect.Min), tile.opacity, image.Point{}, draw.Over)
				}
			}
			maximum := uint8(0)
			for index := begin * s.w; index < end*s.w; index++ {
				i := index * 4
				alpha := uint32(r.light[index])
				if r.exit != nil {
					alpha = (alpha*uint32(r.pixelMask[index]) + 127) / 255
				}
				inverse := 255 - alpha
				pixels[i] = uint8(alpha + (uint32(pixels[i])*inverse+127)/255)
				pixels[i+1] = uint8(alpha + (uint32(pixels[i+1])*inverse+127)/255)
				pixels[i+2] = uint8((250*alpha + uint32(pixels[i+2])*inverse + 127) / 255)
				pixels[i+3] = uint8(alpha + (uint32(pixels[i+3])*inverse+127)/255)
				maximum = max(maximum, pixels[i+3])
			}
			maxima[worker] = maximum
		}(worker)
	}
	group.Wait()
	return max(maxima[0], maxima[1], maxima[2], maxima[3])
}
