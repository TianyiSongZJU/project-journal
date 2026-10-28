package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestEnglishLayoutPreservesHistoryAndClues(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	st := fixture()
	st.Projects[0].Note = "personal note"
	rev, e := s.save(st, "new")
	if e != nil {
		t.Fatal(e)
	}
	before, _, e := s.read()
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := os.ReadFile(filepath.Join(s.dir, "项目手记.json"))
	var d diskState
	if e = json.Unmarshal(raw, &d); e != nil {
		t.Fatal(e)
	}
	a, e := newAutoCollector(s, t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	if e = a.writeMonthlyLogs(); e != nil {
		t.Fatal(e)
	}
	// Rename physical directories without changing any manifest or archive bytes.
	for logical, physical := range storageFolders {
		old := filepath.Join(s.dir, logical)
		if _, e = os.Stat(old); e == nil {
			if e = os.Rename(old, filepath.Join(s.dir, physical)); e != nil {
				t.Fatal(e)
			}
		}
	}
	if e = os.WriteFile(filepath.Join(s.dir, ".english-layout"), []byte("1"), 0600); e != nil {
		t.Fatal(e)
	}
	got, gotRev, e := s.read()
	if e != nil || gotRev != rev || !sameSnapshot(snapshot(got), snapshot(before)) {
		t.Fatal("read changed state", e)
	}
	restored, e := s.hydrateDisk(d, true)
	if e != nil || !sameSnapshot(snapshot(restored), snapshot(before)) {
		t.Fatal("history cannot hydrate", e)
	}
	got.Projects[0].Note = "updated"
	if _, e = s.save(got, rev); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(s.dir, "notes", "p1.json")); e != nil {
		t.Fatal(e)
	}
	for logical := range storageFolders {
		if _, e = os.Stat(filepath.Join(s.dir, logical)); !os.IsNotExist(e) {
			t.Fatal("legacy directory recreated", logical)
		}
	}
	if e = a.loadMonthlyLogs(); e != nil {
		t.Fatal(e)
	}
	if len(s.syncCopies()) != 0 {
		t.Fatal("canonical English partitions treated as conflicts")
	}
	b, _ := os.ReadFile(filepath.Join(s.dir, "history-content", d.Files["笔记/p1.json"]+".json"))
	if !bytes.Contains(b, []byte("personal note")) {
		t.Fatal("original note archive lost")
	}
}
