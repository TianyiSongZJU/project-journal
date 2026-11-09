package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSelectiveSyncMergeKeepsUnchosenAndOriginalCopy(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	current := fixture()
	pid := current.Projects[0].ID
	current.Projects[0].Note = "当前笔记"
	current.Weekly = map[string]WeekJournal{"2026-10-26": {Title: "当前周记", Note: "当前内容"}}
	current.Entries[0].Note = "当前每日备注"
	rev, err := s.save(current, "new")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(current)
	var incoming State
	if err := json.Unmarshal(raw, &incoming); err != nil {
		t.Fatal(err)
	}
	incoming.Projects[0].Note = "副本笔记"
	incoming.Entries[0].Note = "副本每日备注"
	incoming.Weekly["2026-10-26"] = WeekJournal{Title: "副本周记", Note: "副本内容"}
	incoming.Projects = append(incoming.Projects, Project{ID: "new", Name: "新项目", Color: "#778899", Note: "新笔记"})
	incoming.Entries = append(incoming.Entries, Entry{ProjectID: "new", Date: "2026-10-28", Kind: "hours", Hours: 2})
	name := "项目手记-冲突副本.json"
	path := filepath.Join(s.dir, name)
	source, _ := json.Marshal(incoming)
	if err := os.WriteFile(path, source, 0600); err != nil {
		t.Fatal(err)
	}
	preview, err := s.previewMerge(name)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Revision != rev || preview.SourceRevision != revision(source) || len(preview.Items) != 6 {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	before, gotRev, err := s.read()
	if err != nil || gotRev != rev || before.Projects[0].Note != "当前笔记" {
		t.Fatalf("preview wrote state: %v", err)
	}
	if _, err = s.mergeCopy(name, rev, preview.SourceRevision, []string{"entry/new/2026-10-28"}); err == nil {
		t.Fatal("accepted orphan entry")
	}
	if _, err = s.mergeCopy(name, rev, "stale", []string{"note/" + pid}); !errors.Is(err, errConflict) {
		t.Fatalf("stale source accepted: %v", err)
	}
	_, err = s.mergeCopy(name, rev, preview.SourceRevision, []string{"note/" + pid, "project/new", "entry/new/2026-10-28"})
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := s.read()
	if err != nil {
		t.Fatal(err)
	}
	if got.Projects[0].Note != "副本笔记" || got.Entries[0].Note != "当前每日备注" || got.Weekly["2026-10-26"].Title != "当前周记" || len(got.Projects) != 2 || len(got.Entries) != 2 || got.Projects[1].Note != "" || got.Entries[1].Hours != 2 {
		t.Fatalf("unexpected merged state: %+v", got)
	}
	retained, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(retained, source) {
		t.Fatal("source copy was changed or removed")
	}
	backups, _ := filepath.Glob(storagePath(s.dir, "备份", "*.json"))
	if len(backups) != 1 {
		t.Fatal("previous canonical backup missing")
	}
	if _, err = s.mergeCopy(name, rev, preview.SourceRevision, []string{"week/2026-10-26"}); !errors.Is(err, errConflict) {
		t.Fatalf("stale main accepted: %v", err)
	}
}
func TestSyncMergeGroupsTimelineAndRetainsLocalOnly(t *testing.T) {
	current := fixture()
	date := current.Entries[0].Date
	pid := current.Projects[0].ID
	a := TimelineBlock{ID: "a", Start: 540, End: 600, ProjectID: pid}
	b := TimelineBlock{ID: "a", Start: 540, End: 630, ProjectID: pid}
	current.TimelineDays = map[string]TimelineDay{date: {Blocks: []TimelineBlock{a}, Applied: []TimelineBlock{a}}}
	current.Weekly = map[string]WeekJournal{"2026-10-26": {Title: "仅当前"}}
	incoming := fixture()
	incoming.Entries[0].Hours = 2
	incoming.TimelineDays = map[string]TimelineDay{date: {Blocks: []TimelineBlock{b}, Applied: []TimelineBlock{b}}}
	items := mergeItems(current, incoming)
	if len(items) != 2 || items[0].ID != "timeline/"+date || items[0].apply == nil || items[1].Effect != "local" {
		t.Fatalf("unexpected diff: %+v", items)
	}
	if _, err := applyMergeItems(current, items, []string{"week/2026-10-26"}); err == nil {
		t.Fatal("accepted removing a local-only week")
	}
	got, err := applyMergeItems(current, items, []string{"timeline/" + date})
	if err != nil {
		t.Fatal(err)
	}
	if got.TimelineDays[date].Applied[0].End != 630 || got.Entries[0].Hours != 2 || got.Weekly["2026-10-26"].Title != "仅当前" || current.TimelineDays[date].Applied[0].End != 600 {
		t.Fatalf("incorrect or in-place timeline merge: %+v", got)
	}
	b.ID = "other"
	incoming.TimelineDays[date] = TimelineDay{Blocks: []TimelineBlock{b}, Applied: []TimelineBlock{b}}
	if item := mergeItems(current, incoming)[0]; item.apply != nil || item.Effect != "review" {
		t.Fatal("accepted deletion of an unrepresented local time block")
	}
}
