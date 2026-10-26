package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"
)

func TestDayTimelinePersistentDraftAndDifference(t *testing.T) {
	a, st, rev, _ := autoFixture(t)
	pid := st.Projects[0].ID
	date := "2026-10-23"
	st.Entries = []Entry{{ProjectID: pid, Date: date, Kind: "hours", Hours: 2, Note: "原有笔记"}}
	var err error
	rev, err = a.store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	b := TimelineBlock{ID: "morning", Start: 9*60 + 15, End: 10*60 + 30}
	saved, rev, err := a.saveTimeline(TimelineRequest{Revision: rev, Date: date, Blocks: []TimelineBlock{b}})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Entries[0].Hours != 2 || len(saved.TimelineDays[date].Blocks) != 1 || len(saved.TimelineDays[date].Applied) != 0 {
		t.Fatal("draft changed records")
	}
	b.ProjectID = pid
	saved, rev, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: date, Blocks: []TimelineBlock{b}, Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Entries[0].Hours != 3.25 || saved.Entries[0].Note != "原有笔记" {
		t.Fatalf("%+v", saved.Entries)
	}
	// Applying twice is idempotent.
	saved, rev, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: date, Blocks: []TimelineBlock{b}, Apply: true})
	if err != nil || saved.Entries[0].Hours != 3.25 {
		t.Fatal("repeated apply changed time", err)
	}
	b.End -= 15
	saved, rev, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: date, Blocks: []TimelineBlock{b}})
	if err != nil || saved.Entries[0].Hours != 3.25 {
		t.Fatal("draft adjustment changed record", err)
	}
	saved, rev, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: date, Blocks: []TimelineBlock{b}, Apply: true})
	if err != nil || saved.Entries[0].Hours != 3 {
		t.Fatal("difference not applied", err)
	}
	// Removing an applied block returns only the timeline contribution.
	beforeUndo := saved.History.Cursor
	saved, rev, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: date, Blocks: []TimelineBlock{}, Apply: true})
	if err != nil || saved.Entries[0].Hours != 2 {
		t.Fatal("manual base lost", err)
	}
	restored, _, err := a.store.restoreHistory(rev, beforeUndo)
	if err != nil || restored.Entries[0].Hours != 3 || len(restored.TimelineDays[date].Blocks) != 1 {
		t.Fatal("undo failed", err)
	}
}
func TestDayTimelineValidationAndConflict(t *testing.T) {
	a, st, rev, _ := autoFixture(t)
	pid := st.Projects[0].ID
	bad := [][]TimelineBlock{{{ID: "a", Start: 540, End: 556}}, {{ID: "a", Start: 540, End: 600}, {ID: "b", Start: 585, End: 660}}, {{ID: "a", Start: 540, End: 600, ProjectID: "missing"}}, {{ID: "a", Start: 0, End: 1455}}, {{ID: "a", Start: 0, End: 15}, {ID: "a", Start: 15, End: 30}}}
	for _, blocks := range bad {
		if _, _, err := a.saveTimeline(TimelineRequest{Revision: rev, Date: "2026-10-23", Blocks: blocks}); err == nil {
			t.Fatal("accepted invalid", blocks)
		}
	}
	if _, _, err := a.saveTimeline(TimelineRequest{Revision: "old", Date: "2026-10-23", Blocks: []TimelineBlock{}}); !errors.Is(err, errConflict) {
		t.Fatal(err)
	}
	st.Entries = []Entry{{ProjectID: pid, Date: "2026-10-23", Kind: "hours", Hours: 24}}
	rev, err := a.store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: "2026-10-23", Blocks: []TimelineBlock{{ID: "a", Start: 0, End: 15, ProjectID: pid}}, Apply: true}); err == nil {
		t.Fatal("24-hour limit ignored")
	}
}
func TestDayTimelineMoveBetweenProjectsAndUnknownEstimate(t *testing.T) {
	a, st, rev, _ := autoFixture(t)
	pid := st.Projects[0].ID
	st.Projects = append(st.Projects, Project{ID: "second", Name: "第二项目", Color: "#557766"})
	st.Entries = nil
	rev, err := a.store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	b := TimelineBlock{ID: "a", Start: 540, End: 615, ProjectID: pid}
	saved, rev, err := a.saveTimeline(TimelineRequest{Revision: rev, Date: "2026-10-23", Blocks: []TimelineBlock{b}, Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	b.ProjectID = "second"
	saved, rev, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: "2026-10-23", Blocks: []TimelineBlock{b}, Apply: true})
	if err != nil || len(saved.Entries) != 1 || saved.Entries[0].ProjectID != "second" || math.Abs(saved.Entries[0].Hours-1.25) > 1e-10 {
		t.Fatal("move duplicated allocation", err, saved.Entries)
	}
	saved.Entries = append(saved.Entries, Entry{ProjectID: pid, Date: "2026-10-23", Kind: "短"})
	saved.Settings.Estimates["短"] = nil
	rev, err = a.store.save(saved, rev)
	if err != nil {
		t.Fatal(err)
	}
	b.ProjectID = pid
	if _, _, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: "2026-10-23", Blocks: []TimelineBlock{b}, Apply: true}); err == nil {
		t.Fatal("unknown manual estimate silently overwritten")
	}
}

func TestDayTimelineProtectsManualReduction(t *testing.T) {
	a, st, rev, _ := autoFixture(t)
	pid := st.Projects[0].ID
	st.Entries = nil
	rev, err := a.store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	b := TimelineBlock{ID: "one", Start: 540, End: 660, ProjectID: pid}
	saved, rev, err := a.saveTimeline(TimelineRequest{Revision: rev, Date: "2026-10-23", Blocks: []TimelineBlock{b}, Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	saved.Entries[0].Hours = 0.5
	rev, err = a.store.save(saved, rev)
	if err != nil {
		t.Fatal(err)
	}
	b.End = 675
	if _, _, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: "2026-10-23", Blocks: []TimelineBlock{b}, Apply: true}); err == nil {
		t.Fatal("manual reduction was silently overwritten")
	}
}

func TestForegroundStorageUsesQuarterHourAppTotals(t *testing.T) {
	a, _, _, _ := autoFixture(t)
	a.config.Activity = true
	start := time.Date(2026, 10, 23, 9, 0, 0, 0, time.Local)
	for i := 0; i <= 14; i++ {
		a.ingestActivity(AutoActivity{App: "Word", Title: fmt.Sprintf("不同窗口标题%d", i), At: start.Add(time.Duration(i) * time.Minute).Format(time.RFC3339Nano)})
	}
	if len(a.log.AppUsage) != 1 {
		t.Fatalf("window switches created %d records", len(a.log.AppUsage))
	}
	for _, e := range a.logs()[0].Evidence {
		if e.BucketStart == 0 || e.Seconds != 14*60 || len(e.Spans) != 0 || e.Name != "Word" {
			t.Fatalf("not compact: %+v", e)
		}
	}
	a.activity = nil
	a.activityAt = time.Time{}
	for _, at := range []time.Time{start.Add(14*time.Minute + 30*time.Second), start.Add(15*time.Minute + 30*time.Second)} {
		a.ingestActivity(AutoActivity{App: "Browser", Title: "不用存窗口标题", At: at.Format(time.RFC3339Nano)})
	}
	compact, _ := json.Marshal(a.log.AppUsage)
	if len(compact) > 600 || strings.Contains(string(compact), "不同窗口标题") {
		t.Fatalf("unexpected storage %s", compact)
	}
	buckets := 0
	for _, e := range a.logs()[0].Evidence {
		if e.App == "Browser" {
			buckets++
			if e.Seconds != 30 || len(e.Spans) != 0 {
				t.Fatalf("boundary %+v", e)
			}
		}
	}
	if buckets != 2 {
		t.Fatal("quarter boundary was not split")
	}
}

func TestTimelineReviewPreservesAllocationsAndHours(t *testing.T) {
	a, st, rev, _ := autoFixture(t)
	st.Entries = []Entry{{ProjectID: st.Projects[0].ID, Date: "2026-10-23", Kind: "hours", Hours: 2}}
	st.TimelineDays = map[string]TimelineDay{"2026-10-23": {Blocks: []TimelineBlock{{ID: "one", Start: 540, End: 600}}}}
	rev, err := a.store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	stamp := strings.Repeat("a", 64)
	next, newRev, err := a.saveTimelineReview(TimelineReviewRequest{Revision: rev, Dates: map[string]string{"2026-10-23": stamp, "2026-10-22": stamp}})
	if err != nil {
		t.Fatal(err)
	}
	if next.TimelineRead["2026-10-23"] != stamp || next.Entries[0].Hours != 2 || len(next.TimelineDays["2026-10-23"].Blocks) != 1 {
		t.Fatal("review changed time records")
	}
	if _, _, err = a.saveTimelineReview(TimelineReviewRequest{Revision: rev, Dates: map[string]string{"2026-10-23": ""}}); !errors.Is(err, errConflict) {
		t.Fatal("stale review must conflict")
	}
	next, _, err = a.saveTimelineReview(TimelineReviewRequest{Revision: newRev, Dates: map[string]string{"2026-10-23": ""}})
	if err != nil || next.TimelineRead["2026-10-23"] != "" || next.TimelineRead["2026-10-22"] != stamp {
		t.Fatal("unread must only clear selected date")
	}
	if _, _, err = a.saveTimelineReview(TimelineReviewRequest{Dates: map[string]string{"bad": ""}}); err == nil {
		t.Fatal("invalid dates accepted")
	}
}

func TestTimelineKeepsExplicitOtherTime(t *testing.T) {
	a, st, rev, _ := autoFixture(t)
	pid := st.Projects[0].ID
	date := "2026-10-23"
	estimate := 1.5
	st.Settings.Estimates["中"] = &estimate
	st.Entries = []Entry{{ProjectID: pid, Date: date, Kind: "中", Note: "笔记"}}
	rev, err := a.store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	block := TimelineBlock{ID: "one", Start: 540, End: 660, ProjectID: pid}
	st, rev, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: date, Blocks: []TimelineBlock{block}, Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	if st.Entries[0].Hours != 3.5 || st.Entries[0].OtherKind != "中" {
		t.Fatal(st.Entries)
	}
	// A daily form edits only the manual component, retaining the materialized total for heatmaps.
	st.Entries[0].OtherKind = "hours"
	st.Entries[0].OtherHours = .5
	st.Entries[0].Hours = 2.5
	rev, err = a.store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	block.End = 600
	st, rev, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: date, Blocks: []TimelineBlock{block}, Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	if st.Entries[0].Hours != 1.5 || st.Entries[0].OtherHours != .5 {
		t.Fatal(st.Entries)
	}
	st, _, err = a.saveTimeline(TimelineRequest{Revision: rev, Date: date, Blocks: []TimelineBlock{}, Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	if st.Entries[0].Kind != "hours" || st.Entries[0].Hours != .5 || st.Entries[0].OtherKind != "" || st.Entries[0].Note != "笔记" {
		t.Fatal(st.Entries)
	}
}
