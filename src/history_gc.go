package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// A full day unreferenced on this device, plus the same minimum file age,
// leaves time for synchronizers to deliver a manifest after its content.
const historyArchiveGrace = 24 * time.Hour

type historyGCState struct {
	Version    int                  `json:"version"`
	Candidates map[string]time.Time `json:"candidates"`
}
type historyGCResult struct {
	Removed int
	Bytes   int64
	Pending int
}

func archiveHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	b, e := hex.DecodeString(value)
	return e == nil && len(b) == 32 && strings.ToLower(value) == value
}
func (s *Store) historyGCPath() string {
	return filepath.Join(s.dir, ".history-gc-"+storageDevice()+".json")
}

// Follow hashes only from live files, retained backups, synchronization copies
// and synchronization version folders. Never root the archive directory itself.
// Keep the raw roots so a concurrent sync delivery can cancel sweeping.
func (s *Store) historyArchiveRoots() (map[string][]byte, error) {
	return s.referenceRoots(false)
}

func (s *Store) referenceRoots(includeActivity bool) (map[string][]byte, error) {
	roots := map[string][]byte{}
	err := filepath.WalkDir(s.dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case "history-content", "历史内容", ".git":
				return filepath.SkipDir
			case "activity", "自动记录":
				if !includeActivity {
					return filepath.SkipDir
				}
			}
			return nil
		}
		if strings.HasPrefix(d.Name(), ".history-gc-") || strings.HasPrefix(d.Name(), ".note-image-gc-") {
			return nil
		}
		if strings.HasPrefix(d.Name(), ".保存事务-") {
			return errors.New("存在尚未完成的保存事务，暂缓历史回收")
		}
		if d.Type()&os.ModeSymlink != 0 {
			return errors.New("历史引用目录包含符号链接，暂缓回收")
		}
		if !strings.Contains(strings.ToLower(d.Name()), ".json") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		roots[path] = raw
		return nil
	})
	return roots, err
}
func equalArchiveRoots(a, b map[string][]byte) bool {
	if len(a) != len(b) {
		return false
	}
	for name, raw := range a {
		if other, ok := b[name]; !ok || revision(raw) != revision(other) {
			return false
		}
	}
	return true
}
func (s *Store) referencedArchives(roots map[string][]byte) (map[string]bool, error) {
	marked := map[string]bool{}
	var walk func(any) error
	var visit func(string, bool) error
	visit = func(hash string, required bool) error {
		if !archiveHash(hash) {
			if required {
				return errors.New("历史引用哈希无效")
			}
			return nil
		}
		if marked[hash] {
			return nil
		}
		raw, err := os.ReadFile(storagePath(s.dir, "历史内容", hash+".json"))
		if os.IsNotExist(err) && !required {
			return nil
		}
		if err != nil {
			return fmt.Errorf("历史引用尚未同步完整：%w", err)
		}
		if revision(raw) != hash {
			return errors.New("历史归档校验失败，暂缓回收")
		}
		marked[hash] = true
		var v any
		if err = json.Unmarshal(raw, &v); err != nil {
			return err
		}
		return walk(v)
	}
	walk = func(v any) error {
		switch value := v.(type) {
		case map[string]any:
			if ref, ok := value["snapshotHash"]; ok {
				hash, valid := ref.(string)
				if !valid {
					return errors.New("历史版本引用无效")
				}
				if err := visit(hash, true); err != nil {
					return err
				}
			}
			if version, ok := value["storageVersion"]; ok {
				if version != float64(2) && version != float64(3) {
					return errors.New("存在未知存储版本，暂缓回收")
				}
				files, ok := value["files"].(map[string]any)
				if !ok {
					return errors.New("历史文件索引无效")
				}
				for name, entry := range files {
					hash, ok := entry.(string)
					if !ok || !safeStoragePath(name) || name == "项目手记.json" {
						return errors.New("历史文件引用无效")
					}
					if err := visit(hash, true); err != nil {
						return err
					}
				}
			}
			for _, child := range value {
				if err := walk(child); err != nil {
					return err
				}
			}
		case []any:
			for _, child := range value {
				if err := walk(child); err != nil {
					return err
				}
			}
		case string:
			if archiveHash(value) {
				return visit(value, false)
			}
		}
		return nil
	}
	for path, raw := range roots {
		var v any
		if err := json.Unmarshal(raw, &v); err != nil {
			// Opaque partition conflict copies are preserved but contain no indexes.
			// A damaged manifest/history may hide references: fail closed.
			name := filepath.Base(path)
			if strings.HasPrefix(name, "项目手记") || strings.HasPrefix(name, "操作历史") {
				return nil, err
			}
			continue
		}
		if err := walk(v); err != nil {
			return nil, err
		}
	}
	return marked, nil
}

// Caller owns the Store mutex. The first pass only records candidates; a later
// pass can reclaim them. A new/reappearing reference resets that grace period.
func (s *Store) collectHistoryArchives(now time.Time) (historyGCResult, error) {
	result := historyGCResult{}
	if _, _, err := s.read(); err != nil {
		return result, err
	}
	roots, err := s.historyArchiveRoots()
	if err != nil {
		return result, err
	}
	marked, err := s.referencedArchives(roots)
	if err != nil {
		return result, err
	}
	previous := historyGCState{Version: 1, Candidates: map[string]time.Time{}}
	if raw, e := os.ReadFile(s.historyGCPath()); e == nil {
		if e = json.Unmarshal(raw, &previous); e != nil || previous.Version != 1 {
			return result, errors.New("历史回收状态无法读取，已保留归档")
		}
	} else if !os.IsNotExist(e) {
		return result, e
	}
	next := historyGCState{Version: 1, Candidates: map[string]time.Time{}}
	archiveDir := storagePath(s.dir, "历史内容")
	if info, e := os.Lstat(archiveDir); e == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
		return result, errors.New("历史归档目录不是普通目录，暂缓回收")
	}
	paths, err := os.ReadDir(archiveDir)
	if os.IsNotExist(err) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	var remove []string
	for _, entry := range paths {
		if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		hash := strings.TrimSuffix(entry.Name(), ".json")
		if !archiveHash(hash) || marked[hash] {
			continue
		}
		info, e := entry.Info()
		if e != nil {
			return result, e
		}
		since, ok := previous.Candidates[hash]
		if !ok || since.After(now) || info.ModTime().After(since) {
			since = now
		}
		next.Candidates[hash] = since
		if !since.After(now.Add(-historyArchiveGrace)) && !info.ModTime().After(now.Add(-historyArchiveGrace)) {
			remove = append(remove, hash)
		}
	}
	// Check all roots again even when no files are due; do not advance candidates
	// based on a view that synchronization has already replaced.
	latest, err := s.historyArchiveRoots()
	if err != nil {
		return result, err
	}
	if !equalArchiveRoots(roots, latest) {
		return result, errConflict
	}
	for _, hash := range remove {
		// Fail closed on a sync delivery during sweeping as well.
		latest, err = s.historyArchiveRoots()
		if err != nil {
			return result, err
		}
		if !equalArchiveRoots(roots, latest) {
			return result, errConflict
		}
		path := storagePath(s.dir, "历史内容", hash+".json")
		info, e := os.Lstat(path)
		if e != nil {
			return result, e
		}
		if !info.Mode().IsRegular() || info.ModTime().After(now.Add(-historyArchiveGrace)) {
			continue
		}
		raw, e := os.ReadFile(path)
		if e != nil {
			return result, e
		}
		if revision(raw) != hash {
			continue
		} // Never delete an unexpected user file.
		if e = os.Remove(path); e != nil {
			return result, e
		}
		result.Removed++
		result.Bytes += info.Size()
		delete(next.Candidates, hash)
	}
	result.Pending = len(next.Candidates)
	raw, err := diskJSON(next)
	if err != nil {
		return result, err
	}
	return result, atomicWrite(s.historyGCPath(), raw)
}
func (s *Store) maintainHistoryArchives() {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		s.mu.Lock()
		_, err := s.collectHistoryArchives(time.Now())
		_, imageErr := s.collectNoteImages(time.Now())
		s.mu.Unlock()
		if err != nil {
			log.Printf("历史归档回收已暂缓：%v", err)
		}
		if imageErr != nil {
			log.Printf("未引用图片回收已暂缓：%v", imageErr)
		}
		<-ticker.C
	}
}
