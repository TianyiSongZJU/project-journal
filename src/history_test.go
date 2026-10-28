package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHistoryUndoRedoBoundAndBranch(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	st := fixture()
	rev := "new"
	var e error
	for i := 0; i < 14; i++ {
		st.Projects[0].Note = string(rune('a' + i))
		rev, e = s.save(st, rev)
		if e != nil {
			t.Fatal(e)
		}
	}
	saved, _, _ := s.read()
	if len(saved.History.Versions) != 15 || saved.History.Cursor != 14 {
		t.Fatal("five-minute history", saved.History)
	}
	undone, rev, e := s.restoreHistory(rev, 13)
	if e != nil || undone.Projects[0].Note != "m" {
		t.Fatal("undo", e, undone.Projects)
	}
	reopened := &Store{dir: s.dir}
	redone, rev, e := reopened.restoreHistory(rev, 14)
	if e != nil || redone.Projects[0].Note != "n" {
		t.Fatal("redo across reopen", e)
	}
	_, _, e = reopened.restoreHistory("stale", 13)
	if !errors.Is(e, errConflict) {
		t.Fatal("stale history must conflict", e)
	}
	undone, rev, e = reopened.restoreHistory(rev, 12)
	if e != nil {
		t.Fatal(e)
	}
	undone.Projects[0].Note = "branch"
	rev, e = reopened.save(undone, rev)
	if e != nil {
		t.Fatal(e)
	}
	saved, _, _ = reopened.read()
	if saved.History.Cursor != 13 || len(saved.History.Versions) != 14 {
		t.Fatal("redo branch not discarded")
	}
	if _, _, e = reopened.restoreHistory(rev, 14); e == nil {
		t.Fatal("discarded future still restorable")
	}
	files, _ := filepath.Glob(filepath.Join(s.dir, "备份", "*.json"))
	if len(files) < 14 {
		t.Fatal("backup missing")
	}
	if _, e = os.Stat(filepath.Join(s.dir, "项目手记.json")); e != nil {
		t.Fatal(e)
	}
}
func TestLegacyBackupsBecomeUndoHistory(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "备份"), 0755)
	before := fixture()
	after := fixture()
	after.Projects[0].Note = "导入后的版本"
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	os.WriteFile(filepath.Join(dir, "备份", "20261022-190000.json"), a, 0644)
	os.WriteFile(filepath.Join(dir, "项目手记.json"), b, 0644)
	s := &Store{dir: dir}
	st, rev, e := s.read()
	if e != nil || st.History == nil || st.History.Cursor != 1 {
		t.Fatal("legacy history", e)
	}
	restored, _, e := s.restoreHistory(rev, 0)
	if e != nil || restored.Projects[0].Note != before.Projects[0].Note {
		t.Fatal("legacy undo", e)
	}
}
func TestDeadlineNoteRoundTrip(t *testing.T) {
	store := &Store{dir: t.TempDir()}
	st := fixture()
	st.Projects[0].Deadlines = append(st.Projects[0].Deadlines, Deadline{ID: "note-node", Name: "提交材料", Date: "2026-12-01", Priority: "高", Note: "准备申报书和预算附件"})
	_, e := store.save(st, "new")
	if e != nil {
		t.Fatal(e)
	}
	got, _, e := store.read()
	if e != nil || got.Projects[0].Deadlines[len(got.Projects[0].Deadlines)-1].Note != "准备申报书和预算附件" {
		t.Fatal("deadline note lost", e)
	}
}

func TestHistoryRetentionTimeOrCount(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	versions := make([]HistoryVersion, 31)
	for i := range versions {
		versions[i] = HistoryVersion{At: now.Add(time.Duration(i-30) * time.Minute).Format(time.RFC3339), Label: fmt.Sprint(i)}
	}
	kept := retainedHistory(versions, now)
	if len(kept) != 11 || kept[0].Label != "20" {
		t.Fatal("at least ten operations", len(kept), kept[0].Label)
	}
	for i := 15; i < len(versions); i++ {
		versions[i].At = now.Add(time.Duration(i-30) * 10 * time.Second).Format(time.RFC3339)
	}
	kept = retainedHistory(versions, now)
	if len(kept) != 17 || kept[0].Label != "14" {
		t.Fatal("recent burst and predecessor", len(kept), kept[0].Label)
	}
	kept = retainedHistory(versions, now.Add(6*time.Minute))
	if len(kept) != 11 {
		t.Fatal("aged history returns to ten operations", len(kept))
	}
}
