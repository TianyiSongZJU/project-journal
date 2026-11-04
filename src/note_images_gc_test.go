package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func gcImage(t *testing.T, s *Store, label string, now time.Time) string {
	t.Helper()
	body := []byte("image-content-" + label)
	sum := sha256.Sum256(body)
	name := hex.EncodeToString(sum[:]) + ".png"
	folder := filepath.Join(s.dir, "images")
	if err := os.MkdirAll(folder, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(folder, name)
	if err := os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, now.Add(-72*time.Hour), now.Add(-72*time.Hour)); err != nil {
		t.Fatal(err)
	}
	return name
}
func imageExists(s *Store, name string) bool {
	_, e := os.Stat(filepath.Join(s.dir, "images", name))
	return e == nil
}
func imageGCStore(t *testing.T) *Store {
	t.Helper()
	s := &Store{dir: t.TempDir()}
	if _, err := s.save(fixture(), "new"); err != nil {
		t.Fatal(err)
	}
	return s
}
func gcPass(t *testing.T, s *Store, now time.Time) historyGCResult {
	t.Helper()
	r, e := s.collectNoteImages(now)
	if e != nil {
		t.Fatal(e)
	}
	return r
}

func TestImageGCRetainsNotesUndoRedoAndReclaimsOrphans(t *testing.T) {
	s := imageGCStore(t)
	now := time.Now()
	shared := gcImage(t, s, "shared", now)
	history := gcImage(t, s, "history", now)
	orphan := gcImage(t, s, "orphan", now)
	st, rev, _ := s.read()
	st.Projects[0].Note = "![old](/api/note-images/" + history + ")"
	rev, err := s.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	st, _, _ = s.read()
	st.Projects[0].Note = "<img src=\"/api/note-images/" + shared + "\" style=\"zoom:75%;\">"
	st.Weekly = map[string]WeekJournal{"2026-11-02": {Note: "![shared](/api/note-images/" + shared + ")"}}
	rev, err = s.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	before, _, _ := s.read()
	if r := gcPass(t, s, now); r.Removed != 0 {
		t.Fatal(r)
	}
	if r := gcPass(t, s, now.Add(23*time.Hour)); r.Removed != 0 {
		t.Fatal(r)
	}
	r := gcPass(t, s, now.Add(25*time.Hour))
	if r.Removed != 1 || imageExists(s, orphan) {
		t.Fatal("unreferenced image not reclaimed", r)
	}
	if !imageExists(s, shared) || !imageExists(s, history) {
		t.Fatal("live/history image removed")
	}
	after, gotRev, e := s.read()
	if e != nil || rev != gotRev || !sameSnapshot(snapshot(before), snapshot(after)) {
		t.Fatal("state changed during image GC", e)
	}
	for cursor := range after.History.Versions {
		_, gotRev, e = s.restoreHistory(gotRev, cursor)
		if e != nil {
			t.Fatal("undo/redo lost", e)
		}
	}
}

func TestImageGCReferencesResetGraceAndUploadsRefreshAge(t *testing.T) {
	s := imageGCStore(t)
	now := time.Now()
	name := gcImage(t, s, "reappear", now)
	gcPass(t, s, now)
	syncRoot := filepath.Join(s.dir, "同步副本.json")
	raw, _ := json.Marshal(map[string]string{"note": "![restored](/api/note-images/" + name + ")"})
	os.WriteFile(syncRoot, raw, 0600)
	gcPass(t, s, now.Add(25*time.Hour))
	if !imageExists(s, name) {
		t.Fatal("reappeared image removed")
	}
	os.Remove(syncRoot)
	gcPass(t, s, now.Add(26*time.Hour))
	gcPass(t, s, now.Add(49*time.Hour))
	if !imageExists(s, name) {
		t.Fatal("reference disappearance did not restart grace")
	}
	path := filepath.Join(s.dir, "images", name)
	os.Chtimes(path, now.Add(49*time.Hour), now.Add(49*time.Hour))
	gcPass(t, s, now.Add(51*time.Hour))
	if !imageExists(s, name) {
		t.Fatal("recent upload not protected")
	}
	gcPass(t, s, now.Add(76*time.Hour))
	if imageExists(s, name) {
		t.Fatal("expired image retained forever")
	}
}

func TestImageGCBackupSyncAndDraftRoots(t *testing.T) {
	s := imageGCStore(t)
	now := time.Now()
	backup := gcImage(t, s, "backup", now)
	sync := gcImage(t, s, "sync", now)
	draft := gcImage(t, s, "draft", now)
	stale := gcImage(t, s, "stale-archive", now)
	// These snapshots are only reachable through a retained backup/sync version.
	for _, pair := range [][2]string{{"备份", backup}, {".stversions", sync}} {
		note := oldArchive(t, s, map[string]string{"note": "/api/note-images/" + pair[1]}, now)
		manifest := diskState{StorageVersion: 3, Version: 2, Files: map[string]string{"笔记/p.json": note}}
		raw, _ := json.Marshal(manifest)
		folder := storagePath(s.dir, pair[0])
		os.MkdirAll(folder, 0755)
		os.WriteFile(filepath.Join(folder, "retained.json"), raw, 0600)
	}
	oldArchive(t, s, map[string]string{"note": "/api/note-images/" + stale}, now) // Unreachable archives cannot pin images.
	stalePath := storagePath(s.dir, "笔记", "deleted-project.json")
	os.MkdirAll(filepath.Dir(stalePath), 0755)
	staleRaw, _ := json.Marshal(map[string]string{"note": "/api/note-images/" + stale})
	os.WriteFile(stalePath, staleRaw, 0600)
	folder := storagePath(s.dir, "自动记录", "device")
	os.MkdirAll(folder, 0755)
	raw, _ := json.Marshal(map[string]any{"edits": map[string]any{"draft": map[string]string{"note": "/api/note-images/" + draft}}})
	os.WriteFile(filepath.Join(folder, "2026-11.json"), raw, 0600)
	gcPass(t, s, now)
	gcPass(t, s, now.Add(25*time.Hour))
	for _, name := range []string{backup, sync, draft} {
		if !imageExists(s, name) {
			t.Fatal("retained reference removed", name)
		}
	}
	if imageExists(s, stale) {
		t.Fatal("unreachable archive permanently pinned image")
	}
}

func TestImageGCWaitsForCompleteAndValidReferences(t *testing.T) {
	for _, kind := range []string{"broken-root", "pending-save", "missing-snapshot", "damaged-snapshot", "broken-gc-state"} {
		t.Run(kind, func(t *testing.T) {
			s := imageGCStore(t)
			now := time.Now()
			name := gcImage(t, s, kind, now)
			gcPass(t, s, now)
			switch kind {
			case "broken-root":
				os.WriteFile(filepath.Join(s.dir, "同步副本.json"), []byte("{incomplete"), 0600)
			case "pending-save":
				os.WriteFile(s.transactionPath(), []byte("{incomplete"), 0600)
			case "missing-snapshot":
				raw, _ := json.Marshal(historySnapshotRef{SnapshotHash: revision([]byte("missing"))})
				os.WriteFile(filepath.Join(s.dir, "同步副本.json"), raw, 0600)
			case "damaged-snapshot":
				hash := oldArchive(t, s, map[string]string{"note": "reference"}, now)
				os.WriteFile(storagePath(s.dir, "历史内容", hash+".json"), []byte("changed"), 0600)
				raw, _ := json.Marshal(historySnapshotRef{SnapshotHash: hash})
				os.WriteFile(filepath.Join(s.dir, "同步副本.json"), raw, 0600)
			case "broken-gc-state":
				os.WriteFile(s.noteImageGCPath(), []byte("{}"), 0600)
			}
			if _, e := s.collectNoteImages(now.Add(25 * time.Hour)); e == nil {
				t.Fatal("unsafe GC was allowed")
			}
			if !imageExists(s, name) {
				t.Fatal("image lost on incomplete data")
			}
		})
	}
}

func TestImageGCDoesNotRemoveRecentUnexpectedOrLinkedFiles(t *testing.T) {
	s := imageGCStore(t)
	now := time.Now()
	recent := gcImage(t, s, "fresh", now)
	changed := gcImage(t, s, "different-content", now)
	os.WriteFile(filepath.Join(s.dir, "images", "personal.png"), []byte("personal"), 0600)
	gcPass(t, s, now)
	path := filepath.Join(s.dir, "images", recent)
	os.Chtimes(path, now.Add(24*time.Hour), now.Add(24*time.Hour))
	path = filepath.Join(s.dir, "images", changed)
	os.WriteFile(path, []byte("user replaced image"), 0600)
	os.Chtimes(path, now.Add(-72*time.Hour), now.Add(-72*time.Hour))
	gcPass(t, s, now.Add(25*time.Hour))
	for _, name := range []string{recent, changed, "personal.png"} {
		if !imageExists(s, name) {
			t.Fatal("unexpected deletion", name)
		}
	}
	symlink := gcImage(t, s, "symlink", now)
	path = filepath.Join(s.dir, "images", symlink)
	os.Remove(path)
	target := filepath.Join(t.TempDir(), "outside.png")
	os.WriteFile(target, []byte("external"), 0600)
	if e := os.Symlink(target, path); e != nil {
		t.Skip(e)
	}
	if _, err := s.collectNoteImages(now.Add(26 * time.Hour)); err == nil {
		t.Fatal("linked root should defer cleanup")
	}
	if !imageExists(s, symlink) {
		t.Fatal("linked file removed")
	}

}

func TestImageGCUploaderAndCollectorUseSameStore(t *testing.T) {
	s := imageGCStore(t)
	now := time.Now()
	png := append([]byte{137, 80, 78, 71, 13, 10, 26, 10}, make([]byte, 32)...)
	handler := s.noteImageHandler()
	w := httptest.NewRecorder()
	handler(w, httptest.NewRequest("POST", "/api/note-images", bytes.NewReader(png)))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var saved map[string]string
	json.Unmarshal(w.Body.Bytes(), &saved)
	name := filepath.Base(saved["url"])
	gcPass(t, s, now)
	gcPass(t, s, now.Add(23*time.Hour))
	if !imageExists(s, name) {
		t.Fatal("in-flight/unsaved upload was collected")
	}
}

// Signal when the handler has fully read the upload, before it can acquire
// Store.mu. A cleanup owning that mutex must prevent the file write/response.
type imageUploadReader struct {
	*bytes.Reader
	ready chan struct{}
}

func (r imageUploadReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if err == io.EOF {
		select {
		case <-r.ready:
		default:
			close(r.ready)
		}
	}
	return n, err
}
func TestImageGCSerializesUploads(t *testing.T) {
	s := imageGCStore(t)
	png := append([]byte{137, 80, 78, 71, 13, 10, 26, 10}, make([]byte, 32)...)
	ready := make(chan struct{})
	done := make(chan struct{})
	response := httptest.NewRecorder()
	s.mu.Lock()
	locked := true
	defer func() {
		if locked {
			s.mu.Unlock()
		}
	}()
	go func() {
		s.noteImageHandler()(response, httptest.NewRequest("POST", "/api/note-images", imageUploadReader{bytes.NewReader(png), ready}))
		close(done)
	}()
	select {
	case <-ready:
	case <-time.After(3 * time.Second):
		t.Fatal("upload did not reach lock")
	}
	select {
	case <-done:
		t.Fatal("upload bypassed cleanup mutex")
	case <-time.After(20 * time.Millisecond):
	}
	s.mu.Unlock()
	locked = false
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("upload remained blocked")
	}
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
}
