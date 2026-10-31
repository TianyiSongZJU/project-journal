package main

import "testing"

func TestDailyMenuHoursMatchesEntryTotals(t *testing.T) {
	estimate := 2.5
	st := State{Settings: Settings{Estimates: map[string]*float64{"短": &estimate}}, Entries: []Entry{
		{Date: "2026-10-31", Kind: "hours", Hours: 4, OtherKind: "hours", OtherHours: 1},
		{Date: "2026-10-31", Kind: "短"}, {Date: "2026-10-31", Kind: "中"},
		{Date: "2026-10-31", Kind: "none"}, {Date: "2026-10-30", Kind: "hours", Hours: 8},
	}}
	total, estimated, missing := dailyMenuHours(st, "2026-10-31")
	if total != 6.5 || estimated != 2.5 || missing != 1 {
		t.Fatalf("got %v %v %v", total, estimated, missing)
	}
	total, estimated, missing = dailyMenuHours(st, "2026-11-01")
	if total != 0 || estimated != 0 || missing != 0 {
		t.Fatal("a new day must start at zero")
	}
}
