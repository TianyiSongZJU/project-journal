package main

import (
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNativeLaunchRenderer(t *testing.T) {
	for _, warm := range []bool{false, true} {
		r, err := newNativeLaunchRenderer(1120, 740, warm)
		if err != nil {
			t.Fatal(err)
		}
		if r.render(0) != 255 {
			t.Fatal("initial artwork must cover the page")
		}
		r.finish(350)
		began := time.Now()
		for i := 0; i < 10; i++ {
			r.render(350 + float64(i)*50)
		}
		t.Logf("warm=%t native reveal average %.2fms/frame", warm, float64(time.Since(began))/float64(time.Millisecond)/10)
		for _, p := range r.exit.plans {
			for time := p.begin; time < r.exit.end; time += 17 {
				radius := p.radius(time)
				for _, other := range r.exit.tiles {
					if time <= other.exit+r.scene.fade*.5+.000001 {
						dx := math.Max(0, math.Abs(other.x-p.tile.source.x)-167)
						dy := math.Max(0, math.Abs(other.y-p.tile.source.y)-167)
						if radius > math.Max(dx, dy)+.001 {
							t.Fatal("background dissolves through a protected tile")
						}
					}
				}
			}
		}
		for _, p := range r.exit.plans {
			for i := 1; i < len(p.times); i++ {
				if p.radii[i] < p.radii[i-1]-.001 {
					t.Fatal("diffusion contour moved backwards")
				}
			}
		}
		if output := os.Getenv("JOURNAL_NATIVE_RENDER_OUTPUT"); output != "" {
			name := "cold"
			if warm {
				name = "warm"
			}
			for _, sample := range []struct {
				name string
				time float64
			}{{"start", 0}, {"middle", 900}} {
				if sample.time == 0 {
					r.exit = nil
					r.render(0)
					r.finish(350)
				} else {
					r.render(sample.time)
				}
				f, err := os.Create(filepath.Join(output, name+"-"+sample.name+".png"))
				if err != nil {
					t.Fatal(err)
				}
				err = png.Encode(f, r.frame)
				f.Close()
				if err != nil {
					t.Fatal(err)
				}
			}
		}
		if maximum := r.render(r.exit.end + 10); maximum > 1 {
			t.Fatalf("native cover fails to become fully clear: alpha=%d", maximum)
		}
	}
}

func TestNativeLaunchResize(t *testing.T) {
	r, err := newNativeLaunchRenderer(720, 550, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, size := range [][2]int{{720, 550}, {1920, 1080}, {1120, 740}} {
		r.resize(size[0], size[1])
		r.exit = nil
		r.finish(350)
		began := time.Now()
		for i := 0; i < 10; i++ {
			r.render(350 + float64(i)*50)
		}
		t.Logf("%dx%d reveal average %.2fms/frame", size[0], size[1], float64(time.Since(began))/float64(time.Millisecond)/10)
		if r.render(r.exit.end+10) > 1 {
			t.Fatal("resized native cover did not finish")
		}
	}
}
