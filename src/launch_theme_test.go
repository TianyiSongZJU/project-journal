package main

import "testing"

func TestLaunchThemeColors(t *testing.T) {
	original := [3]float64{220, 232, 211}
	if got := (launchTheme{Accent: "fern"}).color(220, 232, 211); got != original {
		t.Fatal("default artwork changed", got)
	}
	for _, accent := range []string{"fern", "slate", "iris", "clay", "sand"} {
		c := (launchTheme{Accent: accent, Dark: true}).color(250, 252, 250)
		for _, v := range c {
			if v < 20 || v > 55 {
				t.Fatalf("startup background too bright/dark: %s %v", accent, c)
			}
		}
	}
	blue := (launchTheme{Accent: "slate"}).color(220, 232, 211)
	if blue[2] <= blue[0] {
		t.Fatal("blue artwork retains green tint", blue)
	}
}

func TestCustomLaunchHue(t *testing.T) {
	for _, value := range []float64{0, 60, 120, 180, 240, 300, 359} {
		theme := launchTheme{Accent: "custom", Hue: &value}
		color := theme.color(220, 232, 211)
		for _, channel := range color {
			if channel < 0 || channel > 255 {
				t.Fatalf("invalid custom color %v", color)
			}
		}
		max, min := color[0], color[0]
		for _, channel := range color[1:] {
			if channel > max {
				max = channel
			}
			if channel < min {
				min = channel
			}
		}
		if max-min < 20 {
			t.Fatalf("custom hue lost saturation: %v", color)
		}
	}
	red, blue := 0.0, 240.0
	a := (launchTheme{Accent: "custom", Hue: &red}).color(220, 232, 211)
	b := (launchTheme{Accent: "custom", Hue: &blue}).color(220, 232, 211)
	if a[0] <= a[2] || b[2] <= b[0] {
		t.Fatalf("custom hue ignored: %v %v", a, b)
	}
}
