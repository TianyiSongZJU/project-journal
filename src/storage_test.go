package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPartitionedStorageMigrationAndScopedWrites(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	st := fixture()
	st.Projects[0].Note = "总体笔记"
	st.Projects[0].Deadlines[0].Note = "截止备注"
	st.Projects = append(st.Projects, Project{ID: "p2", Name: "另一项目", Color: "#315c46", Note: "另一笔记", Deadlines: []Deadline{}})
	st.Entries = append(st.Entries, Entry{ProjectID: "p2", Date: "2026-11-01", Kind: "hours", Hours: 2, Note: "跨月笔记"}, Entry{ProjectID: "p1", Date: "2026-10-23", Kind: "none", Note: "只有笔记"})
	b := TimelineBlock{ID: "one", Start: 540, End: 600, ProjectID: "p1"}
	st.TimelineDays = map[string]TimelineDay{"2026-10-22": {Blocks: []TimelineBlock{b}, Applied: []TimelineBlock{b}}}
	st.TimelineRead = map[string]string{"2026-10-23": strings.Repeat("a", 64)}
	raw, _ := diskJSON(st)
	os.WriteFile(filepath.Join(s.dir, "项目手记.json"), raw, 0600)
	os.MkdirAll(filepath.Join(s.dir, "自动记录"), 0755)
	os.WriteFile(filepath.Join(s.dir, "自动记录", "old.json"), []byte("original clues"), 0600)
	if e := s.migrateStorage(); e != nil {
		t.Fatal(e)
	}
	got, rev, e := s.read()
	if e != nil || !sameSnapshot(snapshot(got), snapshot(st)) {
		t.Fatal("migration changed data", e)
	}
	old, e := os.ReadFile(filepath.Join(s.dir, "备份", "分文件迁移前", "项目手记.json"))
	if e != nil || !bytes.Equal(old, raw) {
		t.Fatal("migration backup", e)
	}
	main, _ := os.ReadFile(filepath.Join(s.dir, "项目手记.json"))
	if bytes.Contains(main, []byte("总体笔记")) || bytes.Contains(main, []byte("跨月笔记")) {
		t.Fatal("notes leaked into main")
	}
	var oldReader State
	_ = json.Unmarshal(main, &oldReader)
	if validate(oldReader) == nil {
		t.Fatal("old software must reject new storage format")
	}
	paths := []string{"时间记录/2026-10.json", "时间记录/2026-11.json", "笔记/p2.json"}
	previous := map[string][]byte{}
	for _, p := range paths {
		previous[p], e = os.ReadFile(filepath.Join(s.dir, p))
		if e != nil {
			t.Fatal(e)
		}
	}
	got.Projects[0].Note = "只修改项目一"
	rev, e = s.save(got, rev)
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range paths {
		b, _ := os.ReadFile(filepath.Join(s.dir, p))
		if !bytes.Equal(b, previous[p]) {
			t.Fatal("unrelated file rewritten", p)
		}
	}
	got, _, e = s.read()
	if e != nil {
		t.Fatal(e)
	}
	got.Projects[0].Name = "新名称"
	_, e = s.save(got, rev)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(s.dir, "笔记", "p1.json")); e != nil {
		t.Fatal("rename moved notes")
	}
}
func TestPartitionIntegrityAndTransactionRecovery(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	rev, e := s.save(fixture(), "new")
	if e != nil {
		t.Fatal(e)
	}
	st, _, _ := s.read()
	st.Projects[0].Note = "恢复的笔记"
	st.Entries[0].Hours = 3
	st.History = appendHistory(st, st)
	doc, parts, e := s.makeDisk(st, true)
	if e != nil {
		t.Fatal(e)
	}
	parts["项目手记.json"], _ = diskJSON(doc)
	tx := storageTransaction{Version: 1, Writes: map[string]storageWrite{}}
	for name, b := range parts {
		r, _ := fileRevision(filepath.Join(s.dir, name))
		if r != revision(b) {
			tx.Writes[name] = storageWrite{Before: r, Data: b}
		}
	}
	b, _ := diskJSON(tx)
	os.WriteFile(s.transactionPath(), b, 0600)
	// Simulate power loss after one partition was published but before the manifest.
	for name, w := range tx.Writes {
		if name != "项目手记.json" {
			os.WriteFile(filepath.Join(s.dir, name), w.Data, 0600)
			break
		}
	}
	reopened := &Store{dir: s.dir}
	got, _, e := reopened.read()
	if e != nil || got.Entries[0].Hours != 3 || got.Projects[0].Note != "恢复的笔记" {
		t.Fatal("transaction did not recover", e)
	}
	if _, e = os.Stat(s.transactionPath()); !os.IsNotExist(e) {
		t.Fatal("completed transaction remains")
	}
	// A partition delivered without its new manifest must never be silently incorporated.
	path := filepath.Join(s.dir, "笔记", "p1.json")
	os.WriteFile(path, []byte("external version"), 0600)
	if _, _, e = reopened.read(); e == nil || !strings.Contains(e.Error(), "笔记/p1.json") {
		t.Fatal("partial sync not identified", e)
	}
	if _, e = reopened.save(st, rev); e == nil {
		t.Fatal("partial sync overwritten")
	}
	actual, _ := os.ReadFile(path)
	if string(actual) != "external version" {
		t.Fatal("external data overwritten")
	}
}
func TestInterruptedTransactionRefusesDivergentExternalWrite(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	_, e := s.save(fixture(), "new")
	if e != nil {
		t.Fatal(e)
	}
	main, _ := os.ReadFile(filepath.Join(s.dir, "项目手记.json"))
	notePath := filepath.Join(s.dir, "笔记", "p1.json")
	before, _ := fileRevision(notePath)
	tx := storageTransaction{Version: 1, Writes: map[string]storageWrite{"项目手记.json": {Before: revision(main), Data: main}, "笔记/p1.json": {Before: before, Data: []byte("local pending")}}}
	b, _ := diskJSON(tx)
	os.WriteFile(s.transactionPath(), b, 0600)
	os.WriteFile(notePath, []byte("remote changed"), 0600)
	if _, _, e = s.read(); !errors.Is(e, errConflict) {
		t.Fatal("divergent recovery must stop", e)
	}
	got, _ := os.ReadFile(notePath)
	if string(got) != "remote changed" {
		t.Fatal("remote overwritten")
	}
}
func TestPartitionBackupsAndDeleteUndoRemainSelfConsistent(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	st := fixture()
	rev, e := s.save(st, "new")
	if e != nil {
		t.Fatal(e)
	}
	st.Projects = []Project{}
	st.Entries = []Entry{}
	rev, e = s.save(st, rev)
	if e != nil {
		t.Fatal(e)
	}
	got, _, e := s.restoreHistory(rev, 1)
	if e != nil || len(got.Projects) != 1 || got.Entries[0].Note != "实验" {
		t.Fatal("delete undo", e)
	}
	paths, _ := filepath.Glob(filepath.Join(s.dir, "备份", "*.json"))
	for _, p := range paths {
		b, _ := os.ReadFile(p)
		if _, e = s.readDiskBytes(b, true); e != nil {
			t.Fatal("backup unreadable", e)
		}
	}
}
func TestNestedSyncCopiesRecognizedAndArchived(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	rev, e := s.save(fixture(), "new")
	if e != nil {
		t.Fatal(e)
	}
	name := "笔记/p1 (conflicted copy).json"
	os.WriteFile(filepath.Join(s.dir, name), []byte("do not lose"), 0600)
	copies := s.syncCopies()
	if len(copies) != 1 || copies[0].Kind != "partition" || copies[0].Valid {
		t.Fatal(copies)
	}
	if _, e = s.resolveCopy(name, copies[0].Revision, rev, true); e == nil {
		t.Fatal("fragment must not replace whole state")
	}
	if _, e = s.resolveCopy(name, copies[0].Revision, rev, false); e != nil {
		t.Fatal(e)
	}
	paths, _ := filepath.Glob(filepath.Join(s.dir, "备份", "同步副本", "*.json"))
	if len(paths) != 1 {
		t.Fatal(paths)
	}
	b, _ := os.ReadFile(paths[0])
	if string(b) != "do not lose" {
		t.Fatal("copy lost")
	}
}
