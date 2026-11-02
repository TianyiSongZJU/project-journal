package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func oldArchive(t *testing.T, s *Store, value any, now time.Time) string {
	t.Helper()
	b, e := diskJSON(value)
	if e != nil {
		t.Fatal(e)
	}
	hash, e := s.archivePart(b)
	if e != nil {
		t.Fatal(e)
	}
	path := storagePath(s.dir, "历史内容", hash+".json")
	if e = os.Chtimes(path, now.Add(-72*time.Hour), now.Add(-72*time.Hour)); e != nil {
		t.Fatal(e)
	}
	return hash
}
func TestHistoryGCGraceUndoAndBackups(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	now := time.Now()
	rev, e := s.save(fixture(), "new")
	if e != nil {
		t.Fatal(e)
	}
	st, _, _ := s.read()
	st.Projects[0].Note = "changed"
	rev, e = s.save(st, rev)
	if e != nil {
		t.Fatal(e)
	}
	st, _, e = s.read()
	if e != nil {
		t.Fatal(e)
	}
	// Keep a nested manifest exclusively via a sync version; all three parts
	// (manifest -> undo list -> old note) must remain reachable.
	orphan := oldArchive(t, s, map[string]string{"discard": "unused"}, now)
	note := oldArchive(t, s, projectNotes{ProjectID: "sync", Note: "only in old sync version"}, now)
	doc := diskState{StorageVersion: 2, Version: 2, Files: map[string]string{"笔记/sync.json": note}}
	snapshot, _ := json.Marshal(doc)
	h := ChangeHistory{Versions: []HistoryVersion{{Snapshot: snapshot}}}
	history := oldArchive(t, s, h, now)
	root := diskState{StorageVersion: 2, Version: 2, Files: map[string]string{"操作历史.json": history}}
	raw, _ := diskJSON(root)
	os.MkdirAll(filepath.Join(s.dir, ".stversions"), 0755)
	os.WriteFile(filepath.Join(s.dir, ".stversions", "项目手记.json"), raw, 0600)
	first, e := s.collectHistoryArchives(now)
	if e != nil || first.Removed != 0 || first.Pending < 1 {
		t.Fatal(first, e)
	}
	early, e := s.collectHistoryArchives(now.Add(23 * time.Hour))
	if e != nil || early.Removed != 0 {
		t.Fatal(early, e)
	}
	second, e := s.collectHistoryArchives(now.Add(25 * time.Hour))
	if e != nil || second.Removed < 1 {
		t.Fatal(second, e)
	}
	if _, e = os.Stat(storagePath(s.dir, "历史内容", orphan+".json")); !os.IsNotExist(e) {
		t.Fatal("orphan not reclaimed", e)
	}
	for _, hash := range []string{note, history} {
		if _, e = os.Stat(storagePath(s.dir, "历史内容", hash+".json")); e != nil {
			t.Fatal("sync version lost", e)
		}
	}
	got, gotRev, e := s.read()
	if e != nil || rev != gotRev || !reflect.DeepEqual(st, got) {
		t.Fatal("live state changed", e)
	}
	for cursor := range got.History.Versions {
		restored, base, e := s.restoreHistory(gotRev, cursor)
		if e != nil {
			t.Fatal("undo/redo", cursor, e)
		}
		gotRev = base
		var expected State
		json.Unmarshal(got.History.Versions[cursor].Snapshot, &expected)
		if !sameSnapshot(snapshotState(restored), snapshotState(expected)) {
			t.Fatal("wrong restored state")
		}
	}
	backups, _ := filepath.Glob(storagePath(s.dir, "备份", "*.json"))
	for _, path := range backups {
		raw, _ := os.ReadFile(path)
		if _, e = s.readDiskBytes(raw, true); e != nil {
			t.Fatal("backup lost", e)
		}
	}
}
func snapshotState(st State) json.RawMessage { return snapshot(st) }
func TestHistoryGCReferenceReappearanceResetsGrace(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	s.save(fixture(), "new")
	now := time.Now()
	hash := oldArchive(t, s, map[string]string{"value": "temporary"}, now)
	if _, e := s.collectHistoryArchives(now); e != nil {
		t.Fatal(e)
	}
	// An arriving synchronization copy references it, resetting the candidate.
	raw, _ := diskJSON(map[string]string{"reference": hash})
	path := filepath.Join(s.dir, "线索处理 (conflict).json")
	os.WriteFile(path, raw, 0600)
	if _, e := s.collectHistoryArchives(now.Add(25 * time.Hour)); e != nil {
		t.Fatal(e)
	}
	os.Remove(path)
	result, e := s.collectHistoryArchives(now.Add(26 * time.Hour))
	if e != nil || result.Removed != 0 {
		t.Fatal("lost reset grace", result, e)
	}
}
func TestHistoryGCFailsClosedOnIncompleteSyncAndTransactions(t *testing.T) {
	for _, mode := range []string{"missing", "corrupt-manifest", "transaction", "unknown-version"} {
		t.Run(mode, func(t *testing.T) {
			s := &Store{dir: t.TempDir()}
			s.save(fixture(), "new")
			now := time.Now()
			hash := oldArchive(t, s, map[string]string{"value": "orphan"}, now)
			if _, e := s.collectHistoryArchives(now); e != nil {
				t.Fatal(e)
			}
			name := "项目手记 (conflict).json"
			raw := []byte("broken")
			switch mode {
			case "missing":
				raw, _ = diskJSON(diskState{StorageVersion: 2, Version: 2, Files: map[string]string{"笔记/lost.json": revision([]byte("missing"))}})
			case "transaction":
				name = ".保存事务-other.json"
				raw = []byte("pending")
			case "unknown-version":
				raw = []byte(`{"storageVersion":99}`)
			}
			os.WriteFile(filepath.Join(s.dir, name), raw, 0600)
			if _, e := s.collectHistoryArchives(now.Add(25 * time.Hour)); e == nil {
				t.Fatal("unsafe GC allowed", mode)
			}
			if _, e := os.Stat(storagePath(s.dir, "历史内容", hash+".json")); e != nil {
				t.Fatal("orphan should remain on failure", e)
			}
		})
	}
}
func TestCompactHistoryRemainsReadable(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	rev, e := s.save(fixture(), "new")
	if e != nil {
		t.Fatal(e)
	}
	st, _, _ := s.read()
	st.Projects[0].Name = "new"
	_, e = s.save(st, rev)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := os.ReadFile(filepath.Join(s.dir, "操作历史.json"))
	var h ChangeHistory
	if e = json.Unmarshal(raw, &h); e != nil || !usableHistory(&h) {
		t.Fatal(e)
	}
	pretty, _ := diskJSON(h)
	if len(raw) >= len(pretty) {
		t.Fatal("history did not shrink")
	}
	if _, _, e = s.read(); e != nil {
		t.Fatal(e)
	}
}
