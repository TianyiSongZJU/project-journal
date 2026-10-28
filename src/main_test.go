package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func fixture() State {
	s := emptyState()
	s.Projects = append(s.Projects, Project{ID: "p1", Name: "论文", Color: "#315c46", Deadlines: []Deadline{{ID: "d1", Name: "初稿", Date: "2026-12-01", Priority: "高"}}})
	s.Entries = append(s.Entries, Entry{ProjectID: "p1", Date: "2026-10-22", Kind: "hours", Hours: 1.5, Note: "实验"})
	return s
}
func TestSaveReloadBackupAndConflict(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	st, rev, e := s.read()
	if e != nil || rev != "new" || len(st.Projects) != 0 {
		t.Fatal(st, rev, e)
	}
	rev, e = s.save(fixture(), rev)
	if e != nil {
		t.Fatal(e)
	}
	got, gotRev, e := s.read()
	if e != nil || gotRev != rev || got.Entries[0].Hours != 1.5 {
		t.Fatal(got, e)
	}
	next := got
	next.Entries[0].Hours = 3
	nextRev, e := s.save(next, rev)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.save(next, rev); !errors.Is(e, errConflict) {
		t.Fatal("stale save must be rejected", e)
	}
	files, _ := filepath.Glob(filepath.Join(s.dir, "备份", "*.json"))
	if len(files) != 1 {
		t.Fatal(files)
	}
	b, _ := os.ReadFile(files[0])
	previous, err := s.readDiskBytes(b, true)
	if err != nil {
		t.Fatal(err)
	}
	if previous.Entries[0].Hours != 1.5 {
		t.Fatal("backup must retain prior value")
	}
	external := fixture()
	external.Projects[0].Note = "另一台电脑的修改"
	b, _ = json.Marshal(external)
	os.WriteFile(filepath.Join(s.dir, "项目手记.json"), b, 0600)
	if _, e = s.save(next, nextRev); !errors.Is(e, errConflict) {
		t.Fatal("external edit must be detected", e)
	}
}
func TestCorruptDataPreserved(t *testing.T) {
	dir := t.TempDir()
	s := &Store{dir: dir}
	path := filepath.Join(dir, "项目手记.json")
	original := []byte("broken")
	os.WriteFile(path, original, 0600)
	if _, _, e := s.read(); e == nil {
		t.Fatal("corrupt input must fail")
	}
	if _, e := s.save(fixture(), "new"); e == nil {
		t.Fatal("must not overwrite corrupt input")
	}
	b, _ := os.ReadFile(path)
	if string(b) != "broken" {
		t.Fatal("original lost")
	}
}
func TestValidation(t *testing.T) {
	cases := []struct {
		name string
		edit func(*State)
	}{{"duplicate day", func(s *State) { s.Entries = append(s.Entries, s.Entries[0]) }}, {"missing project", func(s *State) { s.Entries[0].ProjectID = "absent" }}, {"bad date", func(s *State) { s.Entries[0].Date = "2026-02-30" }}, {"negative hours", func(s *State) { s.Entries[0].Hours = -1 }}, {"excess hours", func(s *State) { s.Entries[0].Hours = 25 }}, {"mixed types", func(s *State) { s.Entries[0].Kind = "短" }}, {"unknown priority", func(s *State) { s.Projects[0].Deadlines[0].Priority = "紧急" }}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := fixture()
			tc.edit(&s)
			if validate(s) == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
	s := fixture()
	s.Entries[0].Kind = "中"
	s.Entries[0].Hours = 0
	if e := validate(s); e != nil {
		t.Fatal(e)
	}
}

func TestFiveLevelsAndOrderingMetadataRoundTrip(t *testing.T) {
	store := &Store{dir: t.TempDir()}
	st := fixture()
	st.Projects[0].CreatedAt = "2026-10-01T00:00:00Z"
	st.Projects[0].UpdatedAt = "2026-10-22T00:00:00Z"
	st.Settings.ProjectSort = "deadline"
	st.Settings.ShowMonthProjects = true
	v := 0.25
	st.Settings.Estimates["很短"] = &v
	st.Entries[0].Kind = "很短"
	st.Entries[0].Hours = 0
	st.Entries = append(st.Entries, Entry{ProjectID: "p1", Date: "2026-10-23", Kind: "很长", Hours: 0})
	if _, err := store.save(st, "new"); err != nil {
		t.Fatal(err)
	}
	got, _, err := store.read()
	if err != nil || got.Settings.ProjectSort != "deadline" || !got.Settings.ShowMonthProjects || got.Projects[0].CreatedAt != st.Projects[0].CreatedAt || got.Projects[0].UpdatedAt != st.Projects[0].UpdatedAt || got.Entries[0].Kind != "很短" || got.Entries[1].Kind != "很长" {
		t.Fatal(got, err)
	}
}

func TestNotesWithoutDurationRoundTrip(t *testing.T) {
	store := &Store{dir: t.TempDir()}
	st := fixture()
	st.Entries[0].Kind = "none"
	st.Entries[0].Hours = 0
	st.Entries[0].Note = "保留备注"
	if _, err := store.save(st, "new"); err != nil {
		t.Fatal(err)
	}
	got, _, err := store.read()
	if err != nil || got.Entries[0].Kind != "none" || got.Entries[0].Note != "保留备注" {
		t.Fatal(got, err)
	}
}

func TestProjectGroupsPersistAndUndo(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	st := fixture()
	rev, e := s.save(st, "new")
	if e != nil {
		t.Fatal(e)
	}
	st.Projects[0].Group = "科研"
	st.Settings.ProjectGroups = []string{"科研", "汇报"}
	rev, e = s.save(st, rev)
	if e != nil {
		t.Fatal(e)
	}
	got, _, e := s.read()
	if e != nil || got.Projects[0].Group != "科研" || len(got.Settings.ProjectGroups) != 2 {
		t.Fatal(got, e)
	}
	got, _, e = s.restoreHistory(rev, got.History.Cursor-1)
	if e != nil || got.Projects[0].Group != "" {
		t.Fatal("group undo", got, e)
	}
	st.Settings.ProjectGroups = []string{"科研", "科研"}
	if validate(st) == nil {
		t.Fatal("duplicate group allowed")
	}
}
