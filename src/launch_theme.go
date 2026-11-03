package main

import "math"

// Startup colors are resolved once, before the web page is available.
type launchTheme struct {
	Scheme string   `json:"scheme"`
	Accent string   `json:"accent"`
	Hue    *float64 `json:"hue,omitempty"`
	Dark   bool     `json:"-"`
}

func (t launchTheme) color(r, g, b float64) [3]float64 {
	hue, ok := map[string]float64{"fern": 148, "slate": 218, "iris": 286, "clay": 24, "sand": 34, "rose": 340, "macaron": 334}[t.Accent]
	if !ok {
		hue = 148
	}
	if t.Accent == "custom" && t.Hue != nil && !math.IsNaN(*t.Hue) && !math.IsInf(*t.Hue, 0) {
		hue = math.Round(math.Max(0, math.Min(359, *t.Hue)))
	}
	if !t.Dark && hue == 148 {
		return [3]float64{r, g, b}
	}
	source := (math.Max(r, math.Max(g, b)) + math.Min(r, math.Min(g, b))) / 510
	l, s := source, 0.0
	spread := (math.Max(r, math.Max(g, b)) - math.Min(r, math.Min(g, b))) / 255
	if spread > 0 {
		s = spread / (1 - math.Abs(2*source-1))
	}
	if !t.Dark {
		max, min := math.Max(r, math.Max(g, b)), math.Min(r, math.Min(g, b))
		sourceHue := 0.0
		if max != min {
			switch max {
			case r:
				sourceHue = math.Mod((g-b)/(max-min), 6) * 60
			case g:
				sourceHue = ((b-r)/(max-min) + 2) * 60
			default:
				sourceHue = ((r-g)/(max-min) + 4) * 60
			}
		}
		if t.Accent != "fern" && t.Accent != "custom" && ok {
			hue = math.Mod(hue+(math.Mod(sourceHue-110+540, 360)-180)*.15+360, 360)
			s = math.Min(.14, s*.65)
		} else {
			hue = math.Mod(sourceHue+hue-148+720, 360)
		}
	}
	if t.Dark {
		s = .045
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
