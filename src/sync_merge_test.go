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
	if preview.Revision != rev || preview.SourceRevision != revision(source) || len(preview.Items) != 7 || preview.Items[6].Category != "操作历史" || preview.Items[6].apply != nil {
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

func TestPartitionMergeTargetsOwningRecords(t *testing.T) {
	data := t.TempDir()
	s := &Store{dir: data}
	base := fixture()
	id, date := base.Entries[0].ProjectID, base.Entries[0].Date
	base.Projects[0].Note = "当前总体"
	base.Entries[0].Note = "当前当日备注"
	rev, err := s.save(base, "new")
	if err != nil {
		t.Fatal(err)
	}
	write := func(name string, value any) {
		t.Helper()
		file := storagePath(data, name)
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.MkdirAll(filepath.Dir(file), 0755); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(file, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	noteName := "笔记/" + id + " (conflict).json"
	write(noteName, projectNotes{ProjectID: id, Note: "副本总体", Daily: map[string]string{date: "副本当日备注", "2026-12-09": "缺少记录"}})
	preview, err := s.previewMerge(noteName)
	if err != nil || preview.CurrentFile != "笔记/"+id+".json" || len(preview.Items) != 3 || preview.Items[2].Effect != "review" {
		t.Fatalf("note preview: %+v, %v", preview, err)
	}
	rev, err = s.mergeCopy(noteName, rev, preview.SourceRevision, []string{"note/" + id})
	if err != nil {
		t.Fatal(err)
	}
	month := date[:7]
	timeName := "时间记录/" + month + " (conflict).json"
	entry := base.Entries[0]
	entry.Hours = 2.5
	entry.Note = ""
	write(timeName, monthRecords{Month: month, Entries: []Entry{entry}})
	preview, err = s.previewMerge(timeName)
	if err != nil || len(preview.Items) != 1 {
		t.Fatalf("time preview: %+v, %v", preview, err)
	}
	rev, err = s.mergeCopy(timeName, rev, preview.SourceRevision, []string{"entry/" + entryKey(entry)})
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := s.read()
	if err != nil || got.Projects[0].Note != "副本总体" || got.Entries[0].Note != "当前当日备注" || got.Entries[0].Hours != 2.5 {
		t.Fatalf("scope or notes lost: %+v, %v", got, err)
	}
	weekName := "周记/2026-11-16 (conflict).json"
	write(weekName, weeklyDocument{Week: "2026-11-16", WeekJournal: WeekJournal{Title: "副本周记"}})
	preview, err = s.previewMerge(weekName)
	if err != nil || len(preview.Items) != 1 || preview.Items[0].Effect != "add" {
		t.Fatalf("week preview: %+v, %v", preview, err)
	}
	found := false
	for _, c := range s.syncCopies() {
		found = found || c.Name == weekName
	}
	if !found {
		t.Fatal("weekly conflict not listed")
	}
	if _, err := s.previewMerge("笔记/../项目手记.json"); err == nil {
		t.Fatal("non-canonical source accepted")
	}
	if _, err := s.mergeCopy(weekName, rev, "stale", []string{"week/2026-11-16"}); !errors.Is(err, errConflict) {
		t.Fatal("stale partition accepted")
	}
}

func TestRawDiffWhenPartitionCannotBeMerged(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	state := fixture()
	rev, err := s.save(state, "new")
	if err != nil {
		t.Fatal(err)
	}
	id := state.Projects[0].ID
	name := "笔记/" + id + " 2.json"
	if err := os.WriteFile(storagePath(s.dir, name), []byte(`{"projectId":`), 0600); err != nil {
		t.Fatal(err)
	}
	preview, err := s.previewMerge(name)
	if err != nil || len(preview.Items) != 1 || preview.Items[0].Effect != "review" || len(preview.Items[0].Current) != 1 || preview.CurrentFile != "笔记/"+id+".json" {
		t.Fatalf("missing read-only comparison: %+v, %v", preview, err)
	}
	if _, err = s.mergeCopy(name, rev, preview.SourceRevision, []string{"file"}); err == nil {
		t.Fatal("accepted applying malformed fragment")
	}
}

func TestTimelinePreviewAlignsSegmentsAndRenamedProjects(t *testing.T) {
	current, incoming := fixture(), fixture()
	date, id := current.Entries[0].Date, current.Projects[0].ID
	current.Projects[0].Name = "旧名称"
	incoming.Projects[0].Name = "新名称"
	incoming.Projects = append(incoming.Projects, Project{ID: "different", Name: "旧名称", Color: "#778899"})
	before := TimelineBlock{ID: "segment", Start: 540, End: 600, ProjectID: id}
	after := TimelineBlock{ID: "segment", Start: 550, End: 630, ProjectID: "different"}
	current.TimelineDays = map[string]TimelineDay{date: {Blocks: []TimelineBlock{before}}}
	incoming.TimelineDays = map[string]TimelineDay{date: {Blocks: []TimelineBlock{after}}}
	items := mergeItems(current, incoming)
	if len(items) != 3 || items[1].Title != "旧名称 → 新名称" || items[0].Context == "" {
		t.Fatalf("missing project identity: %+v", items)
	}
	timeline := items[2]
	a, b := timeline.Current[0], timeline.Incoming[0]
	if a.Key != b.Key || a.Period.Start != 540 || b.Period.End != 630 || b.Period.ProjectID != "different" || len(timeline.Requires) != 1 {
		t.Fatalf("segments not matched: %+v", timeline)
	}
	if _, err := applyMergeItems(current, items, []string{timeline.ID}); err == nil {
		t.Fatal("orphan timeline was accepted")
	}
}

func TestHistoryConflictShowsOperationsAndUndoPosition(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	current := fixture()
	rev, err := s.save(current, "new")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(storagePath(s.dir, "操作历史.json"))
	if err != nil {
		t.Fatal(err)
	}
	var incoming ChangeHistory
	if err = json.Unmarshal(raw, &incoming); err != nil {
		t.Fatal(err)
	}
	incoming.Versions[len(incoming.Versions)-1].Label = "移动时间段"
	incoming.Cursor = 0
	name := "操作历史 (conflict).json"
	raw, _ = json.Marshal(incoming)
	if err = os.WriteFile(storagePath(s.dir, name), raw, 0600); err != nil {
		t.Fatal(err)
	}
	preview, err := s.previewMerge(name)
	if err != nil || len(preview.Items) != 1 || preview.Items[0].Effect != "review" {
		t.Fatalf("operation preview: %+v, %v", preview, err)
	}
	item := preview.Items[0]
	if item.Category != "操作历史" || len(item.Incoming) != 2 || item.Incoming[0].Value != "移动时间段 · 已撤销" {
		t.Fatalf("unreadable history: %+v", item)
	}
	if _, err = s.mergeCopy(name, rev, preview.SourceRevision, []string{item.ID}); err == nil {
		t.Fatal("operation history was selectable")
	}
}
