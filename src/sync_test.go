package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestRootLaunchersKeepExistingDataLocation(t *testing.T) {
	base := t.TempDir()
	nested := filepath.Join(base, "项目手记", "数据")
	os.MkdirAll(nested, 0755)
	if got := defaultDataDir(base); got != nested {
		t.Fatal(got)
	}
	elsewhere := t.TempDir()
	if got := defaultDataDir(elsewhere); got != filepath.Join(elsewhere, "data") {
		t.Fatal(got)
	}
}
func TestSyncCopyResolvePreservesBothVersions(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	rev, e := s.save(fixture(), "new")
	if e != nil {
		t.Fatal(e)
	}
	candidate := fixture()
	candidate.Entries[0].Hours = 4
	copyBytes, _ := json.Marshal(candidate)
	name := "项目手记 (conflicted copy).json"
	os.WriteFile(filepath.Join(s.dir, name), copyBytes, 0600)
	copies := s.syncCopies()
	if len(copies) != 1 || !copies[0].Valid {
		t.Fatal(copies)
	}
	if _, e = s.resolveCopy(name, "stale", rev, true); !errors.Is(e, errConflict) {
		t.Fatal("changed copy must not be adopted", e)
	}
	newRev, e := s.resolveCopy(name, copies[0].Revision, rev, true)
	if e != nil || newRev == rev {
		t.Fatal(e)
	}
	got, _, _ := s.read()
	if got.Entries[0].Hours != 4 {
		t.Fatal(got)
	}
	if len(s.syncCopies()) != 0 {
		t.Fatal("copy not archived")
	}
	archives, _ := filepath.Glob(filepath.Join(s.dir, "备份", "同步副本", "*.json"))
	if len(archives) != 1 {
		t.Fatal(archives)
	}
	b, _ := os.ReadFile(archives[0])
	if string(b) != string(copyBytes) {
		t.Fatal("copy changed during archive")
	}
	backups, _ := filepath.Glob(filepath.Join(s.dir, "备份", "*.json"))
	if len(backups) != 1 {
		t.Fatal("previous canonical must be backed up")
	}
	b, _ = os.ReadFile(backups[0])
	old, err := s.readDiskBytes(b, true)
	if err != nil {
		t.Fatal(err)
	}
	if old.Entries[0].Hours != 1.5 {
		t.Fatal("old canonical lost")
	}
}
func TestKeepCanonicalAndArchiveInvalidCopy(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	rev, _ := s.save(fixture(), "new")
	name := "项目手记-同步冲突.json"
	os.WriteFile(filepath.Join(s.dir, name), []byte("broken"), 0600)
	copies := s.syncCopies()
	if len(copies) != 1 || copies[0].Valid {
		t.Fatal(copies)
	}
	if _, e := s.resolveCopy(name, copies[0].Revision, rev, true); e == nil {
		t.Fatal("invalid copy adopted")
	}
	next, e := s.resolveCopy(name, copies[0].Revision, rev, false)
	if e != nil || next != rev {
		t.Fatal(e)
	}
	got, _, _ := s.read()
	if got.Entries[0].Hours != 1.5 {
		t.Fatal("canonical changed")
	}
	if _, e = s.resolveCopy("../outside.json", "x", rev, false); e == nil {
		t.Fatal("path traversal accepted")
	}
}
