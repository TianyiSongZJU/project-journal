package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func historyRefs(t *testing.T, s *Store) []string {
	t.Helper()
	raw, e := os.ReadFile(filepath.Join(s.dir, "操作历史.json"))
	if e != nil {
		t.Fatal(e)
	}
	var h ChangeHistory
	if e = json.Unmarshal(raw, &h); e != nil {
		t.Fatal(e)
	}
	hashes := []string{}
	for _, v := range h.Versions {
		var ref historySnapshotRef
		if e = json.Unmarshal(v.Snapshot, &ref); e != nil || !archiveHash(ref.SnapshotHash) {
			t.Fatal("missing snapshot reference", e)
		}
		raw, e = os.ReadFile(storagePath(s.dir, "历史内容", ref.SnapshotHash+".json"))
		if e != nil || revision(raw) != ref.SnapshotHash {
			t.Fatal("invalid archived manifest", e)
		}
		hashes = append(hashes, ref.SnapshotHash)
	}
	return hashes
}
func TestHistoryVersionsAreSharedAcrossUndoLists(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	rev, e := s.save(fixture(), "new")
	if e != nil {
		t.Fatal(e)
	}
	first := historyRefs(t, s)
	st, _, _ := s.read()
	st.Projects[0].Note = "next"
	rev, e = s.save(st, rev)
	if e != nil {
		t.Fatal(e)
	}
	second := historyRefs(t, s)
	for i, hash := range first {
		if second[i] != hash {
			t.Fatal("prior manifest copied instead of reused")
		}
	}
	got, _, e := s.read()
	if e != nil {
		t.Fatal(e)
	}
	for i := range got.History.Versions {
		_, rev, e = s.restoreHistory(rev, i)
		if e != nil {
			t.Fatal("undo/redo", e)
		}
	}
	raw, _ := os.ReadFile(filepath.Join(s.dir, "项目手记.json"))
	var doc diskState
	json.Unmarshal(raw, &doc)
	if doc.StorageVersion != 3 {
		t.Fatal("old readers must reject the reference format")
	}
}
func TestLegacyInlineHistoryUpgradesWithoutChangingVersions(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	base := fixture()
	next := fixture()
	next.Projects[0].Note = "newer note"
	expected := next
	expected.History = appendHistory(base, next)
	// Create a genuine v2 manifest and inline history without the v3 writer.
	oldDoc := func(st State) diskState {
		doc, parts, e := splitState(st)
		if e != nil {
			t.Fatal(e)
		}
		doc.StorageVersion = 2
		for name, raw := range parts {
			hash, e := s.archivePart(raw)
			if e != nil {
				t.Fatal(e)
			}
			doc.Files[name] = hash
		}
		return doc
	}
	h := ChangeHistory{Cursor: expected.History.Cursor, Versions: append([]HistoryVersion{}, expected.History.Versions...)}
	for i, v := range h.Versions {
		var st State
		json.Unmarshal(v.Snapshot, &st)
		h.Versions[i].Snapshot, _ = json.Marshal(oldDoc(st))
	}
	doc := oldDoc(next)
	raw, _ := diskJSON(h)
	hash, e := s.archivePart(raw)
	if e != nil {
		t.Fatal(e)
	}
	doc.Files["操作历史.json"] = hash
	for name, hash := range doc.Files {
		raw, _ := os.ReadFile(storagePath(s.dir, "历史内容", hash+".json"))
		path := storagePath(s.dir, filepath.FromSlash(name))
		os.MkdirAll(filepath.Dir(path), 0755)
		os.WriteFile(path, raw, 0600)
	}
	raw, _ = diskJSON(doc)
	os.WriteFile(filepath.Join(s.dir, "项目手记.json"), raw, 0600)
	before, rev, e := s.read()
	if e != nil || !sameSnapshot(snapshot(before), snapshot(expected)) || len(before.History.Versions) != len(expected.History.Versions) {
		t.Fatal("legacy read", e)
	}
	_, e = s.commitDisk(before, rev)
	if e != nil {
		t.Fatal(e)
	}
	after, _, e := s.read()
	if e != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("upgrade altered state or undo history", e)
	}
	historyRefs(t, s)
}
func TestMissingHistoryManifestStopsReadAndSave(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	rev, e := s.save(fixture(), "new")
	if e != nil {
		t.Fatal(e)
	}
	refs := historyRefs(t, s)
	path := storagePath(s.dir, "历史内容", refs[0]+".json")
	original, _ := os.ReadFile(filepath.Join(s.dir, "项目手记.json"))
	os.Remove(path)
	if _, _, e = s.read(); e == nil {
		t.Fatal("missing manifest silently accepted")
	}
	if _, e = s.save(fixture(), rev); e == nil {
		t.Fatal("incomplete sync overwritten")
	}
	current, _ := os.ReadFile(filepath.Join(s.dir, "项目手记.json"))
	if !bytes.Equal(current, original) {
		t.Fatal("current data changed")
	}
}
