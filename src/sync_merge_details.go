package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

func projectOrderDifference(current, incoming []Project, local, remote map[string]Project) *mergeItem {
	order := func(projects []Project, other map[string]Project) ([]string, []string) {
		ids, labels := []string{}, []string{}
		for _, p := range projects {
			if _, ok := other[p.ID]; !ok {
				continue
			}
			ids = append(ids, p.ID)
			labels = append(labels, fmt.Sprintf("%d. %s · %s", len(ids), projectDisplayName(p), p.ID))
		}
		return ids, labels
	}
	a, aLabels := order(current, remote)
	b, bLabels := order(incoming, local)
	if jsonEqual(a, b) {
		return nil
	}
	return &mergeItem{ID: "project-order", Category: "项目", Title: "两边共有项目的排序", Effect: "review", Current: []mergeField{field("项目顺序", strings.Join(aLabels, "\n"))}, Incoming: []mergeField{field("项目顺序", strings.Join(bLabels, "\n"))}, Notice: "采用项目内容时，当前的项目排序会保留。"}
}

type mergePeriod struct {
	Start     int    `json:"start"`
	End       int    `json:"end"`
	Project   string `json:"project"`
	ProjectID string `json:"projectId"`
	Color     string `json:"color,omitempty"`
}

func timelineMergeFields(day TimelineDay, entries []Entry, projects, other map[string]Project) []mergeField {
	project := func(id string) (string, string) {
		if id == "" {
			return "待分配", ""
		}
		p, ok := projects[id]
		if !ok {
			p, ok = other[id]
		}
		if ok {
			return projectDisplayName(p), p.Color
		}
		return id, ""
	}
	fields := []mergeField{}
	for _, set := range []struct {
		key, label string
		blocks     []TimelineBlock
	}{
		{"applied", "已计入时段", day.Applied}, {"marked", "划取时段", day.Blocks},
	} {
		blocks := append([]TimelineBlock(nil), set.blocks...)
		sort.SliceStable(blocks, func(i, j int) bool { return blocks[i].Start < blocks[j].Start })
		for _, block := range blocks {
			name, color := project(block.ProjectID)
			f := field(set.label, fmt.Sprintf("%02d:%02d–%02d:%02d · %s", block.Start/60, block.Start%60, block.End/60, block.End%60, name))
			f.Key = set.key + "/" + block.ID
			f.Period = &mergePeriod{Start: block.Start, End: block.End, Project: name, ProjectID: block.ProjectID, Color: color}
			fields = append(fields, f)
		}
	}
	records := append([]Entry(nil), entries...)
	sort.SliceStable(records, func(i, j int) bool { return records[i].ProjectID < records[j].ProjectID })
	for _, entry := range records {
		name, _ := project(entry.ProjectID)
		for _, f := range entryFields(entry) {
			f.Key = "entry/" + entry.ProjectID + "/" + f.Label
			f.Label = name + " · " + f.Label
			fields = append(fields, f)
		}
	}
	return fields
}

func historyMergeItems(current, incoming *ChangeHistory) []mergeItem {
	type historyEvent struct {
		key, time, label string
		active, undone   bool
	}
	events := func(history *ChangeHistory) ([]historyEvent, map[string]historyEvent) {
		index := map[string]historyEvent{}
		if !usableHistory(history) {
			return nil, index
		}
		rows := make([]historyEvent, 0, len(history.Versions))
		seen := map[string]int{}
		for i, v := range history.Versions {
			stamp := v.At
			if parsed, err := time.Parse(time.RFC3339, v.At); err == nil {
				stamp = parsed.Local().Format("2006-01-02 15:04:05")
			}
			var normalized bytes.Buffer
			raw := []byte(v.Snapshot)
			if json.Compact(&normalized, raw) == nil {
				raw = normalized.Bytes()
			}
			fingerprint := v.At + "/" + v.Label + "/" + revision(raw)
			seen[fingerprint]++
			key := fmt.Sprintf("%s/%d", fingerprint, seen[fingerprint])
			row := historyEvent{key: key, time: stamp, label: v.Label, active: i == history.Cursor, undone: i > history.Cursor}
			rows = append(rows, row)
			index[key] = row
		}
		return rows, index
	}
	left, byLeft := events(current)
	right, byRight := events(incoming)
	describe := func(rows []historyEvent, other map[string]historyEvent) []mergeField {
		out := []mergeField{}
		for i := len(rows) - 1; i >= 0; i-- {
			row := rows[i]
			if peer, ok := other[row.key]; ok && peer.active == row.active && peer.undone == row.undone {
				continue
			}
			label := row.label
			if row.active {
				label += " · 停在此版本"
			}
			if row.undone {
				label += " · 已撤销"
			}
			f := field(row.time, label)
			f.Key = row.key
			out = append(out, f)
		}
		return out
	}
	a, b := describe(left, byRight), describe(right, byLeft)
	if len(a)+len(b) == 0 {
		return nil
	}
	title := "两边的操作记录"
	if len(left) == 0 {
		title = "副本中的操作记录"
	} else if len(right) == 0 {
		title = "当前的操作记录"
	}
	return []mergeItem{{ID: "history", Category: "操作历史", Title: title, Context: fmt.Sprintf("当前 %d 个版本 · 副本 %d 个版本", len(left), len(right)), Effect: "review", Current: a, Incoming: b, Notice: "这里显示不同的操作和撤销位置。合并结果会记为一次新的本地操作，撤销和重做沿用当前应用规则。"}}
}
