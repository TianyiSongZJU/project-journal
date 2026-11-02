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
