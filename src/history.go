package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type HistoryVersion struct {
	At       string          `json:"at"`
	Label    string          `json:"label"`
	Snapshot json.RawMessage `json:"snapshot"`
}
type ChangeHistory struct {
	Cursor   int              `json:"cursor"`
	Versions []HistoryVersion `json:"versions"`
}

func snapshot(st State) json.RawMessage { st.History = nil; b, _ := json.Marshal(st); return b }
func sameSnapshot(a, b []byte) bool {
	var x, y bytes.Buffer
	if json.Compact(&x, a) != nil || json.Compact(&y, b) != nil {
		return false
	}
	return bytes.Equal(x.Bytes(), y.Bytes())
}
func usableHistory(h *ChangeHistory) bool {
	return h != nil && len(h.Versions) > 0 && h.Cursor >= 0 && h.Cursor < len(h.Versions)
}
func changeLabel(before, after State) string {
	if len(after.Projects) > len(before.Projects) {
		return "新增项目"
	}
	if len(after.Projects) < len(before.Projects) {
		return "删除项目"
	}
	old := map[string]Entry{}
	for _, e := range before.Entries {
		old[e.ProjectID+"/"+e.Date] = e
	}
	changed := 0
	pid := ""
	date := ""
	for _, e := range after.Entries {
		key := e.ProjectID + "/" + e.Date
		if v, ok := old[key]; !ok || v != e {
			changed++
			pid = e.ProjectID
			date = e.Date
		}
		delete(old, key)
	}
	for _, e := range old {
		changed++
		pid = e.ProjectID
		date = e.Date
	}
	name := "项目"
	for _, p := range append(after.Projects, before.Projects...) {
		if p.ID == pid {
			name = projectDisplayName(p)
			break
		}
	}
	if changed > 1 {
		return fmt.Sprintf("%s · 修改 %d 天记录", name, changed)
	}
	if changed == 1 {
		return name + " · " + date + " 记录"
	}
	gb, _ := json.Marshal(before.Settings.ProjectGroups)
	ga, _ := json.Marshal(after.Settings.ProjectGroups)
	if !bytes.Equal(gb, ga) {
		return "管理项目分组"
	}
	for i, p := range after.Projects {
		for _, q := range before.Projects {
			if p.ID == q.ID {
				if p.Note != q.Note {
					return projectDisplayName(p) + " · 总体笔记"
				}
				a, _ := json.Marshal(p.Deadlines)
				b, _ := json.Marshal(q.Deadlines)
				if !bytes.Equal(a, b) {
					return projectDisplayName(p) + " · 截止节点"
				}
				if p.Group != q.Group {
					return projectDisplayName(p) + " · 调整分组"
				}
				if p.Name != q.Name || p.Color != q.Color || p.Completed != q.Completed {
					return projectDisplayName(p) + " · 项目设置"
				}
			}
		}
		if i < len(before.Projects) && p.ID != before.Projects[i].ID {
			return "调整项目排序"
		}
	}
	ta, _ := json.Marshal(before.TimelineDays)
	tb, _ := json.Marshal(after.TimelineDays)
	if !bytes.Equal(ta, tb) {
		return "调整活动时间线"
	}
	a, _ := json.Marshal(before.AutoReviewed)
	b, _ := json.Marshal(after.AutoReviewed)
	if !bytes.Equal(a, b) {
		return "处理自动记录草稿"
	}
	ra, _ := json.Marshal(before.TimelineRead)
	rb, _ := json.Marshal(after.TimelineRead)
	if !bytes.Equal(ra, rb) {
		return "调整历史日期已读状态"
	}
	return "修改显示或估算设置"
}
func appendHistory(before, after State) *ChangeHistory {
	h := before.History
	old, new := snapshot(before), snapshot(after)
	if !usableHistory(h) || !sameSnapshot(h.Versions[h.Cursor].Snapshot, old) {
		h = &ChangeHistory{Versions: []HistoryVersion{{At: time.Now().UTC().Format(time.RFC3339), Label: "起始版本", Snapshot: old}}}
	}
	if bytes.Equal(old, new) {
		return h
	}
	h = &ChangeHistory{Versions: append([]HistoryVersion{}, h.Versions[:h.Cursor+1]...)}
	h.Versions = append(h.Versions, HistoryVersion{At: time.Now().UTC().Format(time.RFC3339), Label: changeLabel(before, after), Snapshot: new})
	h.Versions = retainedHistory(h.Versions, time.Now())
	h.Cursor = len(h.Versions) - 1
	return h
}

// Keep ten undo operations or all operations in the last five minutes,
// whichever is longer, including the predecessor needed to undo the first one.
func retainedHistory(versions []HistoryVersion, now time.Time) []HistoryVersion {
	if len(versions) <= 11 {
		return versions
	}
	start := len(versions) - 11
	cutoff := now.Add(-5 * time.Minute)
	for i, v := range versions {
		at, err := time.Parse(time.RFC3339, v.At)
		if err == nil && !at.Before(cutoff) {
			if i > 0 {
				i--
			}
			if i < start {
				start = i
			}
			break
		}
	}
	return versions[start:]
}
func (s *Store) restoreHistory(base string, cursor int) (State, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, rev, e := s.read()
	if e != nil {
		return State{}, "", e
	}
	if rev != base {
		return State{}, "", errConflict
	}
	h := current.History
	if !usableHistory(h) || cursor < 0 || cursor >= len(h.Versions) {
		return State{}, "", errors.New("这个历史版本已不可用")
	}
	if !sameSnapshot(snapshot(current), h.Versions[h.Cursor].Snapshot) {
		return State{}, "", errors.New("同步数据已变化，请重新载入后操作")
	}
	var next State
	if e = json.Unmarshal(h.Versions[cursor].Snapshot, &next); e != nil {
		return State{}, "", e
	}
	next.History = nil
	if e = validate(next); e != nil {
		return State{}, "", e
	}
	history := &ChangeHistory{Cursor: cursor, Versions: h.Versions}
	rev, e = s.saveWithHistoryLocked(next, base, history)
	next.History = history
	return next, rev, e
}

// Older versions already kept complete backups. Adopt ten usable snapshots on
// first read without changing the data file or its optimistic revision.
func (s *Store) historyFromBackups(current State) *ChangeHistory {
	paths, _ := filepath.Glob(storagePath(s.dir, "备份", "*.json"))
	sort.Strings(paths)
	if len(paths) > 10 {
		paths = paths[len(paths)-10:]
	}
	states := []State{}
	times := []string{}
	for _, path := range paths {
		b, e := os.ReadFile(path)
		if e != nil {
			continue
		}
		old, err := s.readDiskBytes(b, true)
		if err != nil {
			continue
		}
		old.History = nil
		if len(states) > 0 && sameSnapshot(snapshot(states[len(states)-1]), snapshot(old)) {
			continue
		}
		info, e := os.Stat(path)
		if e != nil {
			continue
		}
		states = append(states, old)
		times = append(times, info.ModTime().UTC().Format(time.RFC3339))
	}
	if len(states) == 0 {
		return nil
	}
	if !sameSnapshot(snapshot(states[len(states)-1]), snapshot(current)) {
		states = append(states, current)
		at := time.Now()
		if info, e := os.Stat(storagePath(s.dir, "项目手记.json")); e == nil {
			at = info.ModTime()
		}
		times = append(times, at.UTC().Format(time.RFC3339))
	}
	h := &ChangeHistory{}
	for i, st := range states {
		label := "起始版本"
		if i > 0 {
			label = changeLabel(states[i-1], st)
		}
		h.Versions = append(h.Versions, HistoryVersion{At: times[i], Label: label, Snapshot: snapshot(st)})
	}
	h.Cursor = len(h.Versions) - 1
	return h
}

func projectDisplayName(p Project) string {
	if p.Group != "" {
		return p.Group + " / " + p.Name
	}
	return p.Name
}
