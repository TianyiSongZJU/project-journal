package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type mergeField struct {
	Label string `json:"label"`
	Value string `json:"value"`
}
type mergeItem struct {
	ID       string       `json:"id"`
	Category string       `json:"category"`
	Title    string       `json:"title"`
	Effect   string       `json:"effect"`
	Current  []mergeField `json:"current,omitempty"`
	Incoming []mergeField `json:"incoming,omitempty"`
	Requires []string     `json:"requires,omitempty"`
	Notice   string       `json:"notice,omitempty"`
	apply    func(*mergeDraft)
}
type mergePreview struct {
	Revision       string      `json:"revision"`
	SourceRevision string      `json:"sourceRevision"`
	Items          []mergeItem `json:"items"`
}
type mergeDraft struct {
	state    State
	projects map[string]int
	entries  map[string]Entry
}

func field(label, value string) mergeField { return mergeField{label, value} }
func yesNo(value bool) string {
	if value {
		return "是"
	}
	return "否"
}
func entryKey(e Entry) string { return e.ProjectID + "/" + e.Date }
func hoursText(kind string, hours float64) string {
	switch kind {
	case "hours":
		return fmt.Sprintf("%g 小时", hours)
	case "", "none":
		return "无"
	default:
		return kind
	}
}
func entryFields(e Entry) []mergeField {
	fields := []mergeField{field("投入", hoursText(e.Kind, e.Hours)), field("当日备注", e.Note)}
	if e.OtherKind != "" {
		fields = append(fields, field("其他已记", hoursText(e.OtherKind, e.OtherHours)))
	}
	return fields
}
func projectFields(p Project) []mergeField {
	return []mergeField{field("名称", p.Name), field("分组", p.Group), field("颜色", p.Color), field("已完成", yesNo(p.Completed))}
}
func deadlineFields(d Deadline) []mergeField {
	return []mergeField{field("名称", d.Name), field("日期", d.Date), field("优先级", d.Priority), field("已完成", yesNo(d.Done)), field("备注", d.Note)}
}
func weekFields(w WeekJournal) []mergeField {
	goals := make([]string, 0, len(w.Goals))
	for _, g := range w.Goals {
		mark := "☐"
		if g.Done {
			mark = "☑"
		}
		goals = append(goals, mark+" "+g.Text)
	}
	return []mergeField{field("标题", w.Title), field("本周目标", strings.Join(goals, "\n")), field("本周手记", w.Note)}
}
func jsonEqual(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return bytes.Equal(x, y)
}
func orderedMergeKeys[T any](a, b map[string]T) []string {
	keys := make([]string, 0, len(a)+len(b))
	for k := range a {
		keys = append(keys, k)
	}
	for k := range b {
		if _, ok := a[k]; !ok {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}
func mergeItems(current, incoming State) []mergeItem {
	items := []mergeItem{}
	local, remote := map[string]Project{}, map[string]Project{}
	for _, p := range current.Projects {
		local[p.ID] = p
	}
	for _, p := range incoming.Projects {
		remote[p.ID] = p
	}
	name := func(id string) string {
		if p, ok := local[id]; ok {
			return projectDisplayName(p)
		}
		if p, ok := remote[id]; ok {
			return projectDisplayName(p)
		}
		if id == "" {
			return "待分配"
		}
		return id
	}
	requires := func(id string) []string {
		if _, ok := local[id]; !ok && id != "" {
			return []string{"project/" + id}
		}
		return nil
	}
	add := func(id, category, title string, old, next []mergeField, apply func(*mergeDraft), deps []string, notice string) {
		effect := "change"
		if old == nil {
			effect = "add"
		}
		if next == nil {
			effect = "local"
		} else if apply == nil {
			effect = "review"
		}
		items = append(items, mergeItem{ID: id, Category: category, Title: title, Effect: effect, Current: old, Incoming: next, Requires: deps, Notice: notice, apply: apply})
	}
	for _, id := range orderedMergeKeys(local, remote) {
		a, hasA := local[id]
		b, hasB := remote[id]
		switch {
		case !hasA:
			meta := b
			meta.Note = ""
			meta.Deadlines = []Deadline{}
			add("project/"+id, "项目", b.Name, nil, projectFields(b), func(d *mergeDraft) {
				d.projects[id] = len(d.state.Projects)
				d.state.Projects = append(d.state.Projects, meta)
			}, nil, "笔记、节点和每日记录可单独选择。")
		case !hasB:
			add("project/"+id, "项目", a.Name, projectFields(a), nil, nil, nil, "项目及相关内容保持原样。")
			continue
		default:
			old, next := projectFields(a), projectFields(b)
			if !jsonEqual(old, next) {
				add("project/"+id, "项目", a.Name, old, next, func(d *mergeDraft) {
					p := &d.state.Projects[d.projects[id]]
					p.Name, p.Group, p.Color, p.Completed = b.Name, b.Group, b.Color, b.Completed
				}, nil, "")
			}
		}
		if a.Note != b.Note {
			var before, after []mergeField
			if a.Note != "" {
				before = []mergeField{field("总体笔记", a.Note)}
			}
			if b.Note != "" {
				after = []mergeField{field("总体笔记", b.Note)}
			}
			var apply func(*mergeDraft)
			if after != nil {
				apply = func(d *mergeDraft) { d.state.Projects[d.projects[id]].Note = b.Note }
			}
			add("note/"+id, "总体笔记", name(id), before, after, apply, requires(id), "")
		}
		l, r := map[string]Deadline{}, map[string]Deadline{}
		for _, x := range a.Deadlines {
			l[x.ID] = x
		}
		for _, x := range b.Deadlines {
			r[x.ID] = x
		}
		for _, key := range orderedMergeKeys(l, r) {
			x, hasX := l[key]
			y, hasY := r[key]
			if hasX && hasY && x == y {
				continue
			}
			var before, after []mergeField
			var apply func(*mergeDraft)
			title := x.Name
			if hasX {
				before = deadlineFields(x)
			}
			if hasY {
				title = y.Name
				after = deadlineFields(y)
				apply = func(d *mergeDraft) {
					p := &d.state.Projects[d.projects[id]]
					for i, z := range p.Deadlines {
						if z.ID == key {
							p.Deadlines[i] = y
							return
						}
					}
					p.Deadlines = append(p.Deadlines, y)
				}
			}
			add("deadline/"+id+"/"+key, "截止节点", name(id)+" · "+title, before, after, apply, requires(id), "")
		}
	}
	left, right := map[string]Entry{}, map[string]Entry{}
	byLeft, byRight := map[string][]Entry{}, map[string][]Entry{}
	for _, e := range current.Entries {
		left[entryKey(e)] = e
		byLeft[e.Date] = append(byLeft[e.Date], e)
	}
	for _, e := range incoming.Entries {
		right[entryKey(e)] = e
		byRight[e.Date] = append(byRight[e.Date], e)
	}
	timelineChanged := map[string]bool{}
	timelineFields := func(day TimelineDay, entries []Entry) []mergeField {
		fields := []mergeField{}
		for _, set := range []struct {
			label  string
			blocks []TimelineBlock
		}{{"划取时段", day.Blocks}, {"已计入时段", day.Applied}} {
			lines := []string{}
			for _, b := range set.blocks {
				lines = append(lines, fmt.Sprintf("%02d:%02d–%02d:%02d · %s", b.Start/60, b.Start%60, b.End/60, b.End%60, name(b.ProjectID)))
			}
			fields = append(fields, field(set.label, strings.Join(lines, "\n")))
		}
		for _, e := range entries {
			for _, f := range entryFields(e) {
				fields = append(fields, field(name(e.ProjectID)+" · "+f.Label, f.Value))
			}
		}
		return fields
	}
	for _, date := range orderedMergeKeys(current.TimelineDays, incoming.TimelineDays) {
		a, okA := current.TimelineDays[date]
		b, okB := incoming.TimelineDays[date]
		if okA == okB && jsonEqual(a, b) {
			continue
		}
		timelineChanged[date] = true
		var apply func(*mergeDraft)
		notice := "整天的时间线及对应每日记录一起应用，避免重复计时。"
		needs := map[string]bool{}
		for _, e := range byRight[date] {
			for _, id := range requires(e.ProjectID) {
				needs[id] = true
			}
		}
		for _, block := range append(append([]TimelineBlock{}, b.Blocks...), b.Applied...) {
			for _, id := range requires(block.ProjectID) {
				needs[id] = true
			}
		}
		deps := make([]string, 0, len(needs))
		for id := range needs {
			deps = append(deps, id)
		}
		sort.Strings(deps)
		canApply := okB
		// An absent block might be an unsynced local addition, not an intended deletion.
		retains := func(before, after []TimelineBlock) bool {
			ids := map[string]bool{}
			for _, x := range after {
				ids[x.ID] = true
			}
			for _, x := range before {
				if !ids[x.ID] {
					return false
				}
			}
			return true
		}
		if !retains(a.Blocks, b.Blocks) || !retains(a.Applied, b.Applied) {
			canApply = false
		}
		for _, dep := range deps {
			if _, ok := remote[strings.TrimPrefix(dep, "project/")]; !ok {
				canApply = false
			}
		}
		for _, e := range byLeft[date] {
			if _, ok := right[entryKey(e)]; !ok {
				canApply = false
			}
		}
		if canApply {
			apply = func(d *mergeDraft) {
				if d.state.TimelineDays == nil {
					d.state.TimelineDays = map[string]TimelineDay{}
				}
				d.state.TimelineDays[date] = b
				for _, e := range byRight[date] {
					d.entries[entryKey(e)] = e
				}
			}
		} else {
			notice = "副本缺少本地已有的时间线或每日记录，此项仅供对比，避免覆盖本地内容。"
		}
		add("timeline/"+date, "时间线", date, timelineFields(a, byLeft[date]), timelineFields(b, byRight[date]), apply, deps, notice)
	}
	for _, key := range orderedMergeKeys(left, right) {
		a, hasA := left[key]
		b, hasB := right[key]
		if hasA && hasB && a == b {
			continue
		}
		e := a
		if hasB {
			e = b
		}
		if timelineChanged[e.Date] {
			continue
		}
		var before, after []mergeField
		var apply func(*mergeDraft)
		if hasA {
			before = entryFields(a)
		}
		if hasB {
			after = entryFields(b)
			apply = func(d *mergeDraft) { d.entries[key] = b }
		}
		add("entry/"+key, "每日记录", e.Date+" · "+name(e.ProjectID), before, after, apply, requires(e.ProjectID), "")
	}
	for _, date := range orderedMergeKeys(current.Weekly, incoming.Weekly) {
		a, hasA := current.Weekly[date]
		b, hasB := incoming.Weekly[date]
		if hasA && hasB && jsonEqual(a, b) {
			continue
		}
		var before, after []mergeField
		var apply func(*mergeDraft)
		if hasA {
			before = weekFields(a)
		}
		if hasB {
			after = weekFields(b)
			apply = func(d *mergeDraft) {
				if d.state.Weekly == nil {
					d.state.Weekly = map[string]WeekJournal{}
				}
				d.state.Weekly[date] = b
			}
		}
		add("week/"+date, "周记", date, before, after, apply, nil, "")
	}
	return items
}
func applyMergeItems(current State, items []mergeItem, selected []string) (State, error) {
	if len(selected) == 0 {
		return current, errors.New("请先选择要应用的差异")
	}
	byID := make(map[string]mergeItem, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	chosen := map[string]bool{}
	for _, id := range selected {
		item, ok := byID[id]
		if !ok || item.apply == nil {
			return current, errors.New("选中的差异已失效，请重新比较")
		}
		chosen[id] = true
	}
	for id := range chosen {
		for _, dep := range byID[id].Requires {
			if !chosen[dep] {
				return current, fmt.Errorf("“%s”需要同时导入所属项目", byID[id].Title)
			}
		}
	}
	d := mergeDraft{state: current, projects: map[string]int{}, entries: map[string]Entry{}}
	d.state.Projects = append([]Project{}, current.Projects...)
	d.state.TimelineDays = maps.Clone(current.TimelineDays)
	d.state.Weekly = maps.Clone(current.Weekly)
	for i, p := range current.Projects {
		d.projects[p.ID] = i
		d.state.Projects[i].Deadlines = append([]Deadline{}, p.Deadlines...)
	}
	for _, e := range current.Entries {
		d.entries[entryKey(e)] = e
	}
	for _, item := range items {
		if chosen[item.ID] {
			item.apply(&d)
		}
	}
	d.state.Entries = make([]Entry, 0, len(d.entries))
	for _, e := range current.Entries {
		key := entryKey(e)
		d.state.Entries = append(d.state.Entries, d.entries[key])
		delete(d.entries, key)
	}
	for _, key := range orderedMergeKeys(d.entries, nil) {
		d.state.Entries = append(d.state.Entries, d.entries[key])
	}
	return d.state, validate(d.state)
}

// Read only complete main snapshots. Partition conflict copies have no full state to compare.
func (s *Store) readMergeCopy(name string) (State, string, error) {
	if filepath.Base(name) != name || strings.ContainsAny(name, "/\\:") || !strings.HasPrefix(name, "项目手记") || name == "项目手记.json" || !strings.HasSuffix(strings.ToLower(name), ".json") {
		return State{}, "", errors.New("只能对比完整的同步副本")
	}
	path := storagePath(s.dir, name)
	info, e := os.Lstat(path)
	if e != nil || !info.Mode().IsRegular() || info.Size() > 32<<20 {
		return State{}, "", errors.New("副本无法读取或文件过大")
	}
	f, e := os.Open(path)
	if e != nil {
		return State{}, "", e
	}
	defer f.Close()
	actual, e := f.Stat()
	if e != nil || !os.SameFile(info, actual) {
		return State{}, "", errConflict
	}
	raw, e := io.ReadAll(io.LimitReader(f, (32<<20)+1))
	if e != nil || len(raw) > 32<<20 {
		return State{}, "", errors.New("副本无法读取或文件过大")
	}
	st, e := s.readDiskBytes(raw, true)
	return st, revision(raw), e
}
func (s *Store) previewMerge(name string) (mergePreview, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, rev, e := s.read()
	if e != nil {
		return mergePreview{}, e
	}
	incoming, source, e := s.readMergeCopy(name)
	if e != nil {
		return mergePreview{}, e
	}
	items := mergeItems(current, incoming)
	if len(items) > 5000 {
		return mergePreview{}, errors.New("差异过多，无法在一个窗口中完整对比，请先导出副本")
	}
	return mergePreview{Revision: rev, SourceRevision: source, Items: items}, nil
}
func (s *Store) mergeCopy(name, base, source string, selected []string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, rev, e := s.read()
	if e != nil {
		return "", e
	}
	if base != rev {
		return "", errConflict
	}
	incoming, rawRev, e := s.readMergeCopy(name)
	if e != nil {
		return "", e
	}
	if source != rawRev {
		return "", errConflict
	}
	result, e := applyMergeItems(current, mergeItems(current, incoming), selected)
	if e != nil {
		return "", e
	}
	return s.saveLocked(result, base)
}
