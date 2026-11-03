package main

import "math"

// Startup colors are resolved once, before the web page is available.
type launchTheme struct {
	Scheme string `json:"scheme"`
	Accent string `json:"accent"`
	Dark   bool   `json:"-"`
}

func (t launchTheme) color(r, g, b float64) [3]float64 {
	if !t.Dark && (t.Accent == "" || t.Accent == "fern") {
		return [3]float64{r, g, b}
	}
	hue, ok := map[string]float64{"fern": 148, "slate": 211, "iris": 282, "clay": 17, "sand": 41}[t.Accent]
	if !ok {
		hue = 148
	}
	source := (math.Max(r, math.Max(g, b)) + math.Min(r, math.Min(g, b))) / 510
	l, s := source, .10
	if source > .94 {
		s = .05
	}
	if t.Dark {
		s = .045
		if t.Accent != "fern" && t.Accent != "" {
			s = .025
		}
		l = .04
		if source > .65 {
			l = .12 + (1-source)*.5
		}
	}
	c := (1 - math.Abs(2*l-1)) * s
	x := c * (1 - math.Abs(math.Mod(hue/60, 2)-1))
	m := l - c/2
	var out [3]float64
	switch {
	case hue < 60:
		out = [3]float64{c, x, 0}
	case hue < 120:
		out = [3]float64{x, c, 0}
	case hue < 180:
		out = [3]float64{0, c, x}
	case hue < 240:
		out = [3]float64{0, x, c}
	case hue < 300:
		out = [3]float64{x, 0, c}
	default:
		out = [3]float64{c, 0, x}
	}
	for i := range out {
		out[i] = (out[i] + m) * 255
	}
	return out
}
