package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Shared-data synchronizers may deliver image content before a note/history.
// Require both a full day observed unreferenced and a full day since upload.
const noteImageGrace = 24 * time.Hour

var noteImageReference = regexp.MustCompile(`[a-f0-9]{64}\.(?:png|jpg|gif|webp)`)

func (s *Store) noteImageGCPath() string {
	return filepath.Join(s.dir, ".note-image-gc-"+storageDevice()+".json")
}

// Physical partitions left after deleting a project/week are not live roots.
// Retained historical copies are still reached through their archived manifests.
func (s *Store) imageReferenceRoots() (map[string][]byte, error) {
	roots, err := s.referenceRoots(true)
	if err != nil {
		return nil, err
	}
	raw, ok := roots[storagePath(s.dir, "项目手记.json")]
	if !ok {
		return roots, nil
	}
	var current diskState
	if err = json.Unmarshal(raw, &current); err != nil {
		return nil, err
	}
	if current.StorageVersion != 2 && current.StorageVersion != 3 {
		return roots, nil
	}
	for path := range roots {
		rel, e := filepath.Rel(s.dir, path)
		if e != nil {
			return nil, e
		}
		name := logicalStoragePath(rel)
		if name != "项目手记.json" && safeStoragePath(name) {
			if _, live := current.Files[name]; !live {
				delete(roots, path)
			}
		}
	}
	return roots, nil
}

// Follow the same graph as undo/redo and retained backups. Unreachable archive
// files are deliberately not roots, otherwise obsolete image references would
// pin files forever. Decode JSON strings so escaped Markdown and HTML also work.
func (s *Store) referencedNoteImages(roots map[string][]byte) (map[string]bool, error) {
	archives, err := s.referencedArchives(roots)
	if err != nil {
		return nil, err
	}
	used := map[string]bool{}
	var walk func(any)
	walk = func(v any) {
		switch value := v.(type) {
		case string:
			for _, name := range noteImageReference.FindAllString(value, -1) {
				used[name] = true
			}
		case []any:
			for _, child := range value {
				walk(child)
			}
		case map[string]any:
			for _, child := range value {
				walk(child)
			}
		}
	}
	mark := func(raw []byte) error {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
		walk(value)
		return nil
	}
	for path, raw := range roots {
		if err = mark(raw); err != nil {
			return nil, fmt.Errorf("图片引用文件无法读取，暂缓清理 %s: %w", filepath.Base(path), err)
		}
	}
	for hash := range archives {
		raw, e := os.ReadFile(storagePath(s.dir, "历史内容", hash+".json"))
		if e != nil {
			return nil, e
		}
		if revision(raw) != hash {
			return nil, errors.New("历史图片引用校验失败，暂缓清理")
		}
		if e = mark(raw); e != nil {
			return nil, e
		}
	}
	return used, nil
}

// Caller owns Store.mu, also used by uploads and state/history saves. Metadata
// is device-local and excluded from roots, so candidate names cannot self-pin.
func (s *Store) collectNoteImages(now time.Time) (historyGCResult, error) {
	result := historyGCResult{}
	if _, _, err := s.read(); err != nil {
		return result, err
	}
	roots, err := s.imageReferenceRoots()
	if err != nil {
		return result, err
	}
	used, err := s.referencedNoteImages(roots)
	if err != nil {
		return result, err
	}
	previous := historyGCState{Version: 1, Candidates: map[string]time.Time{}}
	if raw, e := os.ReadFile(s.noteImageGCPath()); e == nil {
		var decoded historyGCState
		if e = json.Unmarshal(raw, &decoded); e != nil || decoded.Version != 1 || decoded.Candidates == nil {
			return result, errors.New("图片清理状态无法读取，已保留图片")
		}
		previous = decoded
	} else if !os.IsNotExist(e) {
		return result, e
	}
	folder := filepath.Join(s.dir, "images")
	info, err := os.Lstat(folder)
	if os.IsNotExist(err) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return result, errors.New("图片目录不是普通目录，暂缓清理")
	}
	entries, err := os.ReadDir(folder)
	if err != nil {
		return result, err
	}
	next := historyGCState{Version: 1, Candidates: map[string]time.Time{}}
	for _, entry := range entries {
		name := entry.Name()
		if !entry.Type().IsRegular() || !noteImageName.MatchString(name) || used[name] {
			continue
		}
		info, e := entry.Info()
		if e != nil {
			return result, e
		}
		since, ok := previous.Candidates[name]
		if !ok || since.After(now) || info.ModTime().After(since) {
			since = now
		}
		next.Candidates[name] = since
		if since.After(now.Add(-noteImageGrace)) || info.ModTime().After(now.Add(-noteImageGrace)) {
			continue
		}
		// Only files actually created by our content-addressed uploader are eligible.
		if info.Size() > noteImageLimit {
			continue
		}
		path := filepath.Join(folder, name)
		file, e := os.Open(path)
		if e != nil {
			return result, e
		}
		digest := sha256.New()
		n, readErr := io.Copy(digest, io.LimitReader(file, noteImageLimit+1))
		file.Close()
		if readErr != nil {
			return result, readErr
		}
		if n != info.Size() || hex.EncodeToString(digest.Sum(nil)) != strings.SplitN(name, ".", 2)[0] {
			continue
		}
		latest, e := s.imageReferenceRoots()
		if e != nil {
			return result, e
		}
		if !equalArchiveRoots(roots, latest) {
			return result, errConflict
		}
		fresh, e := os.Lstat(path)
		if e != nil {
			return result, e
		}
		if !fresh.Mode().IsRegular() || !os.SameFile(info, fresh) || !fresh.ModTime().Equal(info.ModTime()) || fresh.Size() != info.Size() {
			continue
		}
		if e = os.Remove(path); e != nil {
			return result, e
		}
		result.Removed++
		result.Bytes += info.Size()
		delete(next.Candidates, name)
	}
	// Verify again before persisting first observations as well.
	latest, err := s.imageReferenceRoots()
	if err != nil {
		return result, err
	}
	if !equalArchiveRoots(roots, latest) {
		return result, errConflict
	}
	result.Pending = len(next.Candidates)
	raw, err := diskJSON(next)
	if err != nil {
		return result, err
	}
	return result, atomicWrite(s.noteImageGCPath(), raw)
}
