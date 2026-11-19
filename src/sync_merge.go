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
	Label  string       `json:"label"`
	Value  string       `json:"value"`
	Key    string       `json:"key,omitempty"`
	Period *mergePeriod `json:"period,omitempty"`
}
type mergeItem struct {
	ID       string       `json:"id"`
	Category string       `json:"category"`
	Title    string       `json:"title"`
	Context  string       `json:"context,omitempty"`
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
	CurrentFile    string      `json:"currentFile,omitempty"`
	Items          []mergeItem `json:"items"`
}
type mergeDraft struct {
	state    State
	projects map[string]int
	entries  map[string]Entry
}

func field(label, value string) mergeField { return mergeField{Label: label, Value: value} }
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
	return []mergeField{field("名称", p.Name), field("分组", p.Group), field("颜色", p.Color), field("状态", projectStatus(p.Completed)), field("项目编号", p.ID)}
}
func projectStatus(completed bool) string {
	if completed {
		return "已完成"
	}
	return "进行中"
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
func jsonText(value any) string {
	raw, _ := json.MarshalIndent(value, "", "  ")
	return string(raw)
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
	localNames := map[string]bool{}
	for _, p := range current.Projects {
		local[p.ID] = p
		localNames[p.Name] = true
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
			notice := "总体笔记、截止节点和每日记录可单独选择。"
			if localNames[b.Name] {
				notice = "当前已有同名项目。采用副本会新增一个独立项目。" + notice
			}
			add("project/"+id, "项目", projectDisplayName(b), nil, projectFields(b), func(d *mergeDraft) {
				d.projects[id] = len(d.state.Projects)
				d.state.Projects = append(d.state.Projects, meta)
			}, nil, notice)
			items[len(items)-1].Context = "副本项目编号 " + id
		case !hasB:
			add("project/"+id, "项目", projectDisplayName(a), projectFields(a), nil, nil, nil, "保留当前项目及其关联记录。")
			items[len(items)-1].Context = "当前项目编号 " + id
			continue
		default:
			old, next := projectFields(a), projectFields(b)
			if !jsonEqual(old, next) {
				title := projectDisplayName(a)
				if nextTitle := projectDisplayName(b); nextTitle != title {
					title += " → " + nextTitle
				}
				add("project/"+id, "项目", title, old, next, func(d *mergeDraft) {
					p := &d.state.Projects[d.projects[id]]
					p.Name, p.Group, p.Color, p.Completed = b.Name, b.Group, b.Color, b.Completed
				}, nil, "应用项目名称、分组、颜色和状态。关联笔记、节点和时间记录各自选择。")
				items[len(items)-1].Context = "同一项目 · " + id
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
	if order := projectOrderDifference(current.Projects, incoming.Projects, local, remote); order != nil {
		items = append(items, *order)
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
	for _, date := range orderedMergeKeys(current.TimelineDays, incoming.TimelineDays) {
		a, okA := current.TimelineDays[date]
		b, okB := incoming.TimelineDays[date]
		if okA == okB && jsonEqual(a, b) {
			continue
		}
		timelineChanged[date] = true
		var apply func(*mergeDraft)
		notice := "采用副本时，整天的时段和对应每日记录一起写入，保持计时一致。"
		reasons := []string{}
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
		if !okB {
			reasons = append(reasons, "副本没有这一天的时间线")
		}
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
		if okB && (!retains(a.Blocks, b.Blocks) || !retains(a.Applied, b.Applied)) {
			reasons = append(reasons, "副本缺少当前已有的时段")
		}
		for _, dep := range deps {
			if _, ok := remote[strings.TrimPrefix(dep, "project/")]; !ok {
				reasons = append(reasons, "副本缺少时段所属项目")
				break
			}
		}
		for _, e := range byLeft[date] {
			if _, ok := right[entryKey(e)]; !ok {
				reasons = append(reasons, "副本缺少当前已有的每日记录")
				break
			}
		}
		if len(reasons) == 0 {
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
			notice = strings.Join(reasons, "，") + "。当前这一天的时间线和每日记录会保留。"
		}
		before, after := timelineMergeFields(a, byLeft[date], local, remote), timelineMergeFields(b, byRight[date], remote, local)
		if jsonEqual(before, after) {
			before = append(before, field("时段内部标识", jsonText(a)))
			after = append(after, field("时段内部标识", jsonText(b)))
		}
		add("timeline/"+date, "时间线", date, before, after, apply, deps, notice)
		items[len(items)-1].Context = "按当天整组核对"
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
		if hasA && hasB && jsonEqual(before, after) {
			before = append(before, field("记录原始值", jsonText(a)))
			after = append(after, field("记录原始值", jsonText(b)))
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
		if hasA && hasB && jsonEqual(before, after) {
			before = append(before, field("目标内部标识", jsonText(a.Goals)))
			after = append(after, field("目标内部标识", jsonText(b.Goals)))
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

func mergeSourceAllowed(name string) bool {
	if name == "" || filepath.ToSlash(filepath.Clean(name)) != name || strings.ContainsAny(name, `\:`) ||
		!strings.HasSuffix(strings.ToLower(name), ".json") || safeStoragePath(name) {
		return false
	}
	parts := strings.Split(name, "/")
	for _, part := range parts {
		if part == "" || strings.HasPrefix(part, ".") {
			return false
		}
	}
	if len(parts) == 1 {
		return strings.HasPrefix(name, "项目手记") || strings.HasPrefix(name, "操作历史") || strings.HasPrefix(name, "线索处理")
	}
	switch parts[0] {
	case "笔记", "时间记录", "周记":
		return len(parts) == 2
	case "自动记录":
		stem := strings.TrimSuffix(parts[len(parts)-1], ".json")
		return len(parts) <= 3 && stem != "索引" && !validDate(stem+"-01") && (len(parts) != 2 || !validID.MatchString(stem))
	}
	return false
}

func (s *Store) readMergeFile(name string) ([]byte, error) {
	path := storagePath(s.dir, filepath.FromSlash(name))
	for parent := filepath.Dir(path); parent != s.dir && parent != filepath.Dir(parent); parent = filepath.Dir(parent) {
		info, err := os.Lstat(parent)
		if err != nil || !info.IsDir() {
			return nil, errors.New("副本目录无法读取")
		}
	}
	info, e := os.Lstat(path)
	if e != nil || !info.Mode().IsRegular() || info.Size() > 32<<20 {
		return nil, errors.New("副本无法读取或文件过大")
	}
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	actual, e := f.Stat()
	if e != nil || !os.SameFile(info, actual) {
		return nil, errConflict
	}
	raw, e := io.ReadAll(io.LimitReader(f, (32<<20)+1))
	if e != nil || len(raw) > 32<<20 {
		return nil, errors.New("副本无法读取或文件过大")
	}
	return raw, nil
}

func (s *Store) readMergeItems(current State, name string) ([]mergeItem, string, string, error) {
	if !mergeSourceAllowed(name) {
		return nil, "", "", errors.New("不是可对比的同步副本")
	}
	raw, err := s.readMergeFile(name)
	if err != nil {
		return nil, "", "", err
	}
	source := revision(raw)
	if !strings.Contains(name, "/") && strings.HasPrefix(name, "项目手记") {
		incoming, err := s.readDiskBytes(raw, true)
		if err == nil {
			items := mergeItems(current, incoming)
			items = append(items, historyMergeItems(current.History, incoming.History)...)
			if !jsonEqual(current.Settings, incoming.Settings) {
				items = append(items, mergeItem{ID: "settings", Category: "设置", Title: "项目手记设置", Effect: "review", Current: []mergeField{field("设置", jsonText(current.Settings))}, Incoming: []mergeField{field("设置", jsonText(incoming.Settings))}, Notice: "采用记录时仍保留当前应用设置。"})
			}
			return items, source, "项目手记.json", nil
		}
		return s.rawMergeItems(name, "项目手记.json", raw, "完整数据尚无法读取。以下是索引或文件原文，缺失的内容同步完成后才能合并。"), source, "项目手记.json", nil
	}
	if !strings.Contains(name, "/") && strings.HasPrefix(name, "操作历史") {
		const canonical = "操作历史.json"
		var incoming, before ChangeHistory
		base, baseErr := s.readMergeFile(canonical)
		if json.Unmarshal(raw, &incoming) == nil && usableHistory(&incoming) {
			if baseErr == nil && json.Unmarshal(base, &before) == nil && usableHistory(&before) {
				return historyMergeItems(&before, &incoming), source, canonical, nil
			}
			return historyMergeItems(nil, &incoming), source, canonical, nil
		}
	}
	canonical, items, reason := partitionMergeItems(current, name, raw)
	if reason == "" {
		return items, source, canonical, nil
	}
	return s.rawMergeItems(name, canonical, raw, reason), source, canonical, nil
}

func (s *Store) rawMergeItems(name, canonical string, raw []byte, reason string) []mergeItem {
	textField := func(data []byte) mergeField {
		var formatted bytes.Buffer
		if len(data) <= 400000 && json.Indent(&formatted, bytes.TrimSpace(data), "", "  ") == nil {
			data = formatted.Bytes()
		}
		if len(data) > 400000 {
			data = append(bytes.ToValidUTF8(data[:400000], []byte("�")), []byte("\n…其余内容请导出查看")...)
		}
		return field("文件原文", string(data))
	}
	var before []mergeField
	if canonical != "" {
		if current, err := s.readMergeFile(canonical); err == nil {
			if bytes.Equal(current, raw) {
				return []mergeItem{}
			}
			before = []mergeField{textField(current)}
		}
	}
	return []mergeItem{{ID: "file", Category: "文件原文", Title: name, Effect: "review", Current: before, Incoming: []mergeField{textField(raw)}, Notice: reason}}
}
func (s *Store) previewMerge(name string) (mergePreview, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, rev, e := s.read()
	if e != nil {
		return mergePreview{}, e
	}
	items, source, currentFile, e := s.readMergeItems(current, name)
	if e != nil {
		return mergePreview{}, e
	}
	if len(items) > 5000 {
		return mergePreview{}, errors.New("差异过多，无法在一个窗口中完整对比，请先导出副本")
	}
	return mergePreview{Revision: rev, SourceRevision: source, CurrentFile: currentFile, Items: items}, nil
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
	items, rawRev, _, e := s.readMergeItems(current, name)
	if e != nil {
		return "", e
	}
	if source != rawRev {
		return "", errConflict
	}
	result, e := applyMergeItems(current, items, selected)
	if e != nil {
		return "", e
	}
	return s.saveLocked(result, base)
}
