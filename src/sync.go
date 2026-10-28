package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type SyncCopy struct {
	Kind     string `json:"kind,omitempty"`
	Name     string `json:"name"`
	Revision string `json:"revision"`
	Projects int    `json:"projects"`
	Entries  int    `json:"entries"`
	Modified string `json:"modified"`
	Valid    bool   `json:"valid"`
}

func defaultDataDir(base string) string {
	english := filepath.Join(base, "data")
	if info, e := os.Stat(english); e == nil && info.IsDir() {
		return english
	}
	nested := filepath.Join(base, "项目手记", "数据")
	if info, e := os.Stat(nested); e == nil && info.IsDir() {
		return nested
	}
	legacy := filepath.Join(base, "数据")
	if info, e := os.Stat(legacy); e == nil && info.IsDir() {
		return legacy
	}
	return english
}
func (s *Store) syncCopies() []SyncCopy {
	out := []SyncCopy{}
	_ = filepath.WalkDir(s.dir, func(path string, f os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(s.dir, path)
		rel = logicalStoragePath(rel)
		if f.IsDir() {
			if rel == "." || rel == "笔记" || rel == "时间记录" || rel == "自动记录" || strings.HasPrefix(rel, "自动记录/") && strings.Count(rel, "/") == 1 {
				return nil
			}
			return filepath.SkipDir
		}
		if f.Type()&os.ModeSymlink != 0 || !strings.HasSuffix(strings.ToLower(rel), ".json") {
			return nil
		}
		root := !strings.Contains(rel, "/")
		kind := "partition"
		if root {
			if rel == "项目手记.json" || rel == "操作历史.json" || rel == "线索处理.json" {
				return nil
			}
			if !strings.HasPrefix(rel, "项目手记") && !strings.HasPrefix(rel, "操作历史") && !strings.HasPrefix(rel, "线索处理") {
				return nil
			}
			if strings.HasPrefix(rel, "项目手记") {
				kind = "main"
			}
		} else {
			if safeStoragePath(rel) {
				return nil
			}
			if strings.HasPrefix(rel, "自动记录/") {
				name := strings.TrimSuffix(f.Name(), ".json")
				if name == "索引" || validDate(name+"-01") || strings.Count(rel, "/") == 1 && validID.MatchString(name) {
					return nil
				}
			}
		}
		info, e := f.Info()
		if e != nil || info.Size() > 32<<20 {
			return nil
		}
		b, e := os.ReadFile(path)
		if e != nil {
			return nil
		}
		st, e := s.readDiskBytes(b, true)
		valid := kind == "main" && e == nil
		out = append(out, SyncCopy{Kind: kind, Name: rel, Revision: revision(b), Projects: len(st.Projects), Entries: len(st.Entries), Modified: info.ModTime().Format("2006-01-02 15:04"), Valid: valid})
		return nil
	})
	return out
}
func (s *Store) resolveCopy(name, sourceRevision, baseRevision string, adopt bool) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, current, e := s.read()
	if e != nil {
		return "", e
	}
	if current != baseRevision {
		return "", errConflict
	}
	var found *SyncCopy
	for _, c := range s.syncCopies() {
		if c.Name == name {
			cc := c
			found = &cc
			break
		}
	}
	if found == nil {
		return "", errors.New("找不到该同步副本，请重新载入")
	}
	if found.Revision != sourceRevision {
		return "", errConflict
	}
	source := storagePath(s.dir, name)
	b, e := os.ReadFile(source)
	if e != nil {
		return "", e
	}
	if revision(b) != sourceRevision {
		return "", errConflict
	}
	var candidate State
	if adopt {
		candidate, e = s.readDiskBytes(b, true)
		if e != nil {
			return "", e
		}
		if e = validate(candidate); e != nil {
			return "", e
		}
	}
	archiveDir := storagePath(s.dir, "备份", "同步副本")
	if e = os.MkdirAll(archiveDir, 0755); e != nil {
		return "", e
	}
	archive := filepath.Join(archiveDir, time.Now().Format("20060102-150405.000000000")+"-"+filepath.Base(name))
	if e = os.Rename(source, archive); e != nil {
		return "", e
	}
	captured, e := os.ReadFile(archive)
	if e != nil {
		return "", e
	}
	if revision(captured) != sourceRevision {
		if _, e = os.Stat(source); os.IsNotExist(e) {
			os.Rename(archive, source)
		}
		return "", errConflict
	}
	if adopt {
		rev, e := s.saveLocked(candidate, baseRevision)
		if e != nil {
			return "", fmt.Errorf("副本已保存在备份/同步副本中，主数据未能更新：%w", e)
		}
		return rev, nil
	}
	return current, nil
}
