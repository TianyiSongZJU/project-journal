package main

// Native counterpart of JournalLaunchSurface in macos.swift and launch-relief.js.
// All times are milliseconds in one monotonic animation clock.
import (
	"math"
	"sort"
)

type reliefPoint struct{ x, y float64 }
type reliefTile struct {
	row, col       int
	x, y, start    float64
	center, source reliefPoint
	exit, opacity  float64
}
type reliefPlan struct {
	tile         reliefTile
	begin        float64
	times, radii []float64
}
type nativeReliefScene struct {
	w, h                                  int
	a, b, c, d, det, scale                float64
	period, cycle, fade, diffusion, outer float64
	tiles                                 []reliefTile
}
type nativeReliefExit struct {
	tiles      []reliefTile
	plans      []reliefPlan
	end, sweep float64
}

func reliefClamp(v float64) float64  { return math.Max(0, math.Min(1, v)) }
func reliefSmooth(v float64) float64 { v = reliefClamp(v); return v * v * (3 - 2*v) }
func reliefEase(x, x1, x2 float64) float64 {
	x = reliefClamp(x)
	lo, hi, t := 0., 1., x
	for i := 0; i < 16; i++ {
		t = (lo + hi) / 2
		value := 3*(1-t)*(1-t)*t*x1 + 3*(1-t)*t*t*x2 + t*t*t
		if value < x {
			lo = t
		} else {
			hi = t
		}
	}
	return 3*(1-t)*t*t + t*t*t
}
func (s *nativeReliefScene) project(x, y float64) reliefPoint {
	return reliefPoint{float64(s.w)/2 + s.a*x + s.c*y, float64(s.h)/2 + 10 + s.b*x + s.d*y}
}
func (s *nativeReliefScene) inverse(x, y float64) reliefPoint {
	x -= float64(s.w) / 2
	y -= float64(s.h)/2 + 10
	return reliefPoint{(s.d*x - s.c*y) / s.det, (s.a*y - s.b*x) / s.det}
}
func newNativeReliefScene(w, h int, warm bool) *nativeReliefScene {
	s := &nativeReliefScene{w: w, h: h, period: 1600, fade: 440, diffusion: 620}
	gap, initial := .08, .48
	if warm {
		s.period, s.fade, s.diffusion = 1000, 330, 500
		gap, initial = .13, 1
	}
	s.cycle = s.period * (1 + 8*gap)
	s.scale = math.Max(float64(w)/1024, float64(h)/710) * 1.05
	angle, tilt := 31*math.Pi/180, math.Cos(52*math.Pi/180)
	s.a, s.b, s.c, s.d = math.Cos(angle)*s.scale, -math.Sin(angle)*tilt*s.scale, -math.Sin(angle)*s.scale, -math.Cos(angle)*tilt*s.scale
	s.det = s.a*s.d - s.b*s.c
	for row := 0; row < 5; row++ {
		for col := 0; col < 5; col++ {
			x, y := float64(col-2)*354, float64(row-2)*354
			center := s.project(x, y)
			left, right, top, bottom := math.Inf(1), math.Inf(-1), math.Inf(1), math.Inf(-1)
			for _, dx := range []float64{-155, 155} {
				for _, dy := range []float64{-155, 155} {
					p := s.project(x+dx, y+dy)
					left = math.Min(left, p.x)
					right = math.Max(right, p.x)
					top = math.Min(top, p.y)
					bottom = math.Max(bottom, p.y)
				}
			}
			if right < -12 || left > float64(w)+12 || bottom < -12 || top > float64(h)+12 {
				continue
			}
			source := reliefPoint{x, y}
			if center.x < 0 || center.x > float64(w) || center.y < 0 || center.y > float64(h) {
				source = s.inverse((math.Max(0, left)+math.Min(float64(w), right))/2, (math.Max(0, top)+math.Min(float64(h), bottom))/2)
			}
			s.tiles = append(s.tiles, reliefTile{row: row, col: col, x: x, y: y, center: center, source: source, start: -(initial - float64(row+col)*gap) * s.period})
		}
	}
	reach := 0.
	for y := 0; y <= 8; y++ {
		for x := 0; x <= 8; x++ {
			p := s.inverse(float64(w*x)/8, float64(h*y)/8)
			near := math.Inf(1)
			for _, tile := range s.tiles {
				near = math.Min(near, math.Hypot(p.x-tile.source.x, p.y-tile.source.y))
			}
			reach = math.Max(reach, near)
		}
	}
	margin := (math.Hypot(s.d/s.det, -s.b/s.det)*float64(w) + math.Hypot(-s.c/s.det, s.a/s.det)*float64(h)) / 16
	s.outer = (reach + margin + 16) / .45
	return s
}
func (s *nativeReliefScene) wave(tile reliefTile, time, sweep float64) (float64, float64) {
	if sweep < 0 {
		sweep = math.Floor(math.Max(0, time-tile.start) / s.cycle)
	}
	t := reliefClamp((time - tile.start - sweep*s.cycle) / s.period)
	lift := 11 * (1 - reliefEase((t-.5)*2, .37, .63))
	if t < .5 {
		lift = 11 * reliefEase(t*2, .37, .63)
	}
	opacity := .64
	if t < .5 {
		opacity = .28 + .36*reliefEase(t*2, .37, .63)
	} else if t > .805 {
		opacity = .64 - .36*reliefEase((t-.805)/.195, .37, .63)
	}
	return lift, opacity
}
func (s *nativeReliefScene) finish(time float64) *nativeReliefExit {
	// The leading tile's start is independent of viewport clipping.
	initial := .48
	if s.period == 1000 {
		initial = 1
	}
	e := &nativeReliefExit{sweep: math.Floor(math.Max(0, time+initial*s.period) / s.cycle)}
	first := 8
	for _, tile := range s.tiles {
		first = min(first, tile.row+tile.col)
	}
	for _, tile := range s.tiles {
		age := time - tile.start - e.sweep*s.cycle
		tile.exit = time + math.Max(0, math.Max(.805*s.period-age, float64(tile.row+tile.col-first)*80))
		tile.opacity = .64
		if age >= .805*s.period {
			_, tile.opacity = s.wave(tile, time, e.sweep)
		}
		e.tiles = append(e.tiles, tile)
		e.end = math.Max(e.end, tile.exit+s.fade*.5+s.diffusion)
	}
	for _, tile := range e.tiles {
		p := reliefPlan{tile: tile, begin: tile.exit + s.fade*.35}
		for i := 0; i <= 80; i++ {
			p.times = append(p.times, p.begin+(e.end-p.begin)*float64(i)/80)
		}
		for _, other := range e.tiles {
			t := other.exit + s.fade*.5
			if t > p.begin && t < e.end {
				p.times = append(p.times, t)
			}
		}
		sort.Float64s(p.times)
		radius, previous := 0., p.begin
		for _, t := range p.times {
			safe := s.outer
			for _, other := range e.tiles {
				if t <= other.exit+s.fade*.5+.000001 {
					dx := math.Max(0, math.Abs(other.x-tile.source.x)-167)
					dy := math.Max(0, math.Abs(other.y-tile.source.y)-167)
					safe = math.Min(safe, math.Max(dx, dy))
				}
			}
			radius = math.Min(safe, radius+s.outer/s.diffusion*math.Max(0, t-previous))
			previous = t
			p.radii = append(p.radii, radius)
		}
		e.plans = append(e.plans, p)
	}
	return e
}
func (p *reliefPlan) radius(time float64) float64 {
	if time <= p.begin {
		return 0
	}
	if time >= p.times[len(p.times)-1] {
		return p.radii[len(p.radii)-1]
	}
	i := 1
	for i < len(p.times)-1 && p.times[i] < time {
		i++
	}
	return p.radii[i-1] + (p.radii[i]-p.radii[i-1])*(time-p.times[i-1])/(p.times[i]-p.times[i-1])
}
