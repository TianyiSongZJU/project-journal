package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func idleTotals(a *AutoCollector) (seconds, attributed int64, pending int) {
	for _, u := range a.log.AppUsage {
		for _, n := range u.Slots {
			seconds += n
		}
		for _, by := range u.Attribution {
			for _, n := range by {
				attributed += n
			}
		}
		pending += len(u.Pending)
	}
	return
}
func idleSample(a *AutoCollector, at time.Time, idle float64, app, doc string) {
	a.ingestActivity(AutoActivity{At: at.Format(time.RFC3339Nano), IdleSeconds: idle, App: app, Document: doc, Title: "Private window title that must not persist"})
}
func TestIdleRollbackAcrossQuarterMonthAndRestart(t *testing.T) {
	a, _, rev, root := autoFixture(t)
	a.config.Activity = true
	a.config.IdleMinutes = 5
	start := time.Date(2026, 10, 31, 23, 55, 0, 0, time.Local)
	doc := filepath.Join(root, "work.docx")
	for minute := 0; minute <= 7; minute++ {
		idleSample(a, start.Add(time.Duration(minute)*time.Minute), float64(max(0, minute-3)*60), "Word", doc)
	}
	seconds, attributed, pending := idleTotals(a)
	if seconds != 420 || attributed != 420 || pending == 0 {
		t.Fatalf("provisional: %d %d %d", seconds, attributed, pending)
	}
	if err := a.flush(); err != nil {
		t.Fatal(err)
	}
	a.close()
	resumed, err := newAutoCollector(a.store, a.home)
	if err != nil {
		t.Fatal(err)
	}
	defer resumed.close()
	resumed.config = a.config
	idleSample(resumed, start.Add(8*time.Minute), 300, "Word", doc)
	seconds, attributed, pending = idleTotals(resumed)
	if seconds != 180 || attributed != 180 || pending != 0 {
		t.Fatalf("rollback: %d %d %d", seconds, attributed, pending)
	}
	idleSample(resumed, start.Add(9*time.Minute), 360, "Word", doc)
	if n, _, _ := idleTotals(resumed); n != 180 {
		t.Fatalf("deducted twice: %d", n)
	}
	if err := resumed.flush(); err != nil {
		t.Fatal(err)
	}
	again, err := newAutoCollector(a.store, a.home)
	if err != nil {
		t.Fatal(err)
	}
	defer again.close()
	if n, at, p := idleTotals(again); n != 180 || at != 180 || p != 0 {
		t.Fatalf("month resurrected: %d %d %d", n, at, p)
	}
	_, after, err := a.store.read()
	if err != nil || after != rev {
		t.Fatal("manual records changed", err)
	}
	raw, _ := json.Marshal(resumed.log.AppUsage)
	if strings.Contains(string(raw), "Private window") || strings.Contains(string(raw), doc) {
		t.Fatal("private content leaked")
	}
}
func TestIdleShortPauseRemainsAndResumeStartsFresh(t *testing.T) {
	a, _, _, root := autoFixture(t)
	a.config.Activity = true
	a.config.IdleMinutes = 5
	start := time.Date(2026, 10, 27, 10, 0, 0, 0, time.Local)
	doc := filepath.Join(root, "work.docx")
	for minute := 0; minute <= 4; minute++ {
		idleSample(a, start.Add(time.Duration(minute)*time.Minute), float64(minute*60), "Word", doc)
	}
	idleSample(a, start.Add(5*time.Minute), 0, "Word", doc)
	if n, at, p := idleTotals(a); n != 300 || at != 300 || p != 0 {
		t.Fatalf("short pause: %d %d %d", n, at, p)
	}
	for minute := 6; minute <= 10; minute++ {
		idleSample(a, start.Add(time.Duration(minute)*time.Minute), float64((minute-5)*60), "Word", doc)
	}
	if n, _, _ := idleTotals(a); n != 300 {
		t.Fatalf("idle not undone: %d", n)
	}
	idleSample(a, start.Add(11*time.Minute), 0, "Word", doc)
	idleSample(a, start.Add(12*time.Minute), 0, "Word", doc)
	if n, _, p := idleTotals(a); n != 360 || p != 0 {
		t.Fatalf("resume bridged idle: %d %d", n, p)
	}
}
func TestIdlePartialIntervalAndLongSamplingGap(t *testing.T) {
	a, _, _, root := autoFixture(t)
	a.config.Activity = true
	start := time.Date(2026, 10, 27, 10, 14, 30, 0, time.Local)
	doc := filepath.Join(root, "work.docx")
	idleSample(a, start, 0, "Word", doc)
	idleSample(a, start.Add(time.Minute), 30, "Word", doc)
	idleSample(a, start.Add(6*time.Minute), 330, "Word", doc)
	if n, at, p := idleTotals(a); n != 30 || at != 30 || p != 0 {
		t.Fatalf("partial: %d %d %d", n, at, p)
	}
	for _, u := range a.log.AppUsage {
		for bucket, n := range u.Slots {
			if time.Unix(bucket, 0).Minute() != 0 || n != 30 {
				t.Fatalf("wrong quarter: %v %d", time.Unix(bucket, 0), n)
			}
		}
	}
}
func TestIdleRollbackPreservesOtherAppsAndPriorCounters(t *testing.T) {
	a, _, _, root := autoFixture(t)
	a.config.Activity = true
	start := time.Date(2026, 10, 27, 9, 0, 0, 0, time.Local)
	doc := filepath.Join(root, "work.docx")
	a.log.AppUsage["historical"] = AutoAppUsage{Date: "2026-10-26", App: "Other", Slots: map[int64]int64{start.Add(-24 * time.Hour).Unix(): 90}}
	idleSample(a, start, 0, "Word", doc)
	idleSample(a, start.Add(time.Minute), 0, "Word", doc)
	idleSample(a, start.Add(2*time.Minute), 60, "PowerPoint", doc)
	idleSample(a, start.Add(3*time.Minute), 120, "PowerPoint", doc)
	idleSample(a, start.Add(6*time.Minute), 300, "PowerPoint", doc)
	if n, at, p := idleTotals(a); n != 150 || at != 60 || p != 0 {
		t.Fatalf("cross app: %d %d %d", n, at, p)
	}
	for _, u := range a.log.AppUsage {
		if u.App == "PowerPoint" && len(u.Slots) > 0 {
			t.Fatal("another app still charged")
		}
	}
	idleSample(a, start.Add(2*time.Minute), 900, "Word", doc)
	if n, _, _ := idleTotals(a); n != 150 {
		t.Fatalf("stale report changed counters: %d", n)
	}
}
