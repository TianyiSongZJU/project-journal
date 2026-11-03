package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWeeklyStorageAndHistory(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	st := fixture()
	st.Weekly = map[string]WeekJournal{"2026-11-02": {Title: "把思路理清", Note: "跨项目的手记", Goals: []WeekGoal{{ID: "goal-1", Text: "读完资料"}}}}
	if err := validate(st); err != nil {
		t.Fatal(err)
	}
	rev, err := s.save(st, "new")
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := s.read()
	if err != nil || got.Weekly["2026-11-02"].Title != "把思路理清" {
		t.Fatal(got, err)
	}
	prior, _ := os.ReadFile(filepath.Join(s.dir, "周记", "2026-11-02.json"))
	got.Weekly["2026-11-09"] = WeekJournal{Title: "另一周", Goals: []WeekGoal{}}
	_, err = s.save(got, rev)
	if err != nil {
		t.Fatal(err)
	}
	unchanged, _ := os.ReadFile(filepath.Join(s.dir, "周记", "2026-11-02.json"))
	if !bytes.Equal(prior, unchanged) {
		t.Fatal("other week changed")
	}
	loaded, _, err := s.read()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.History == nil {
		t.Fatal("missing history")
	}
	for _, version := range loaded.History.Versions {
		var priorState State
		if err = json.Unmarshal(version.Snapshot, &priorState); err != nil {
			t.Fatal(err)
		}
		if err = validate(priorState); err != nil {
			t.Fatal(err)
		}
	}
	current, base, err := s.read()
	if err != nil {
		t.Fatal(err)
	}
	restored, newBase, err := s.restoreHistory(base, current.History.Cursor-1)
	if err != nil || len(restored.Weekly) != 1 {
		t.Fatal("undo lost weekly snapshot", err)
	}
	redone, _, err := s.restoreHistory(newBase, current.History.Cursor)
	if err != nil || len(redone.Weekly) != 2 {
		t.Fatal("redo lost weekly snapshot", err)
	}
	raw, err := diskJSON(loaded)
	if err != nil {
		t.Fatal(err)
	}
	var exported State
	if err = json.Unmarshal(raw, &exported); err != nil || len(exported.Weekly) != 2 {
		t.Fatal("export lost weeks", err)
	}
}
func TestWeeklyValidation(t *testing.T) {
	st := emptyState()
	st.Weekly = map[string]WeekJournal{"2026-11-03": {Title: "bad"}}
	if validate(st) == nil {
		t.Fatal("Tuesday accepted")
	}
	st.Weekly = map[string]WeekJournal{"2026-11-02": {Goals: []WeekGoal{{ID: "same"}, {ID: "same"}}}}
	if validate(st) == nil {
		t.Fatal("duplicate goals")
	}
	if safeStoragePath("周记/../x.json") || safeStoragePath("周记/2026-11-03.json") {
		t.Fatal("unsafe week path accepted")
	}
}

func TestWeeklyEnglishLayout(t *testing.T) {
	root := t.TempDir()
	if err := ensureStorageLayout(root); err != nil {
		t.Fatal(err)
	}
	if storagePath(root, "周记/2026-11-02.json") != filepath.Join(root, "weekly", "2026-11-02.json") {
		t.Fatal("weekly layout mismatch")
	}
	if logicalStoragePath("weekly/2026-11-02.json") != "周记/2026-11-02.json" {
		t.Fatal("weekly reverse mapping mismatch")
	}
}
