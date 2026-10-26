package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

type folderMove struct{ ProjectID, From, To string }

// Resolve existing ancestors too, because the old folder may already be gone.
func resolveFolderAncestors(path string) string {
	current := filepath.Clean(path)
	suffix := []string{}
	for {
		if resolved, e := filepath.EvalSymlinks(current); e == nil {
			for i := len(suffix) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, suffix[i])
			}
			return resolved
		}
		parent := filepath.Dir(current)
		if parent == current {
			return filepath.Clean(path)
		}
		suffix = append(suffix, filepath.Base(current))
		current = parent
	}
}
func rebaseFolderPath(path, from, to string) (string, bool) {
	if !under(path, from) {
		return "", false
	}
	rel, e := filepath.Rel(from, path)
	if e != nil {
		return "", false
	}
	return filepath.Join(to, rel), true
}

// Only a saved binding can establish a lineage. Caller-supplied identity roots are ignored.
func prepareFolderMoves(c *AutoConfig, old AutoConfig) ([]folderMove, error) {
	explicit := []folderMove{}
	for _, b := range c.Bindings {
		if b.RelocateFrom == "" {
			continue
		}
		found := false
		for _, saved := range old.Bindings {
			if saved.ProjectID == b.ProjectID && pathKey(saved.Path) == pathKey(b.RelocateFrom) {
				found = true
				break
			}
		}
		if !found {
			return nil, errors.New("原资料夹绑定已变化，请重新打开设置后定位")
		}
		target, e := filepath.EvalSymlinks(b.Path)
		if e != nil {
			return nil, fmt.Errorf("新资料夹不可用：%s", b.Path)
		}
		if pathKey(target) != pathKey(b.RelocateFrom) && under(target, resolveFolderAncestors(b.RelocateFrom)) {
			return nil, errors.New("请重新选择移动或改名后的同一层级资料夹，不要选择原资料夹的子文件夹")
		}
		explicit = append(explicit, folderMove{b.ProjectID, b.RelocateFrom, target})
	}
	moves := []folderMove{}
	for i, b := range c.Bindings {
		origin := b.Path
		if b.RelocateFrom != "" {
			origin = b.RelocateFrom
		}
		var saved *AutoBinding
		for j := range old.Bindings {
			v := &old.Bindings[j]
			if v.ProjectID == b.ProjectID && pathKey(v.Path) == pathKey(origin) {
				saved = v
				break
			}
		}
		c.Bindings[i].SourceRoot = ""
		c.Bindings[i].RelocateFrom = ""
		c.Bindings[i].AddedAt = ""
		if saved == nil {
			continue
		}
		c.Bindings[i].SourceRoot = saved.SourceRoot
		c.Bindings[i].AddedAt = saved.AddedAt
		var best *folderMove
		for j := range explicit {
			m := &explicit[j]
			if under(origin, m.From) && (best == nil || len(m.From) > len(best.From)) {
				best = m
			}
		}
		if best == nil {
			continue
		}
		target, ok := rebaseFolderPath(origin, best.From, best.To)
		if !ok {
			return nil, errors.New("资料夹路径无法重新定位")
		}
		c.Bindings[i].Path = target
		c.Bindings[i].AddedAt = saved.AddedAt
		if pathKey(target) != pathKey(origin) {
			if c.Bindings[i].SourceRoot == "" {
				c.Bindings[i].SourceRoot = origin
			}
			moves = append(moves, folderMove{b.ProjectID, origin, target})
		}
	}
	return moves, nil
}

// Copy aliases rather than deleting old keys. If saving the config fails, the old
// binding still works and the extra aliases are harmless; retrying is idempotent.
func (a *AutoCollector) relocateFileIndexLocked(moves []folderMove) error {
	if len(moves) == 0 {
		return nil
	}
	index := map[string]string{}
	for key, stamp := range a.log.Index {
		index[key] = stamp
	}
	for key, stamp := range a.log.Index {
		var best *folderMove
		var path string
		for i := range moves {
			m := &moves[i]
			prefix := m.ProjectID + "/"
			if !strings.HasPrefix(key, prefix) {
				continue
			}
			p := strings.TrimPrefix(key, prefix)
			if under(p, m.From) && (best == nil || len(m.From) > len(best.From)) {
				best = m
				path = p
			}
		}
		if best == nil {
			continue
		}
		target, ok := rebaseFolderPath(path, best.From, best.To)
		if !ok {
			continue
		}
		next := best.ProjectID + "/" + pathKey(target)
		index[next] = stamp // Old aliases may have stale signatures after moving back; evidence is separate.
	}
	a.log.Index = index
	// Persist aliases before publishing the new binding. Existing monthly evidence
	// is kept intact, including IDs, review marks, timestamps and file signatures.
	a.dirty = true
	if e := a.writeMonthlyLogs(); e != nil {
		return e
	}
	return nil
}
