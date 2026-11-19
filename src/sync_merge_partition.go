package main

import (
	"encoding/json"
	"maps"
	"path"
	"strings"
	"time"
	"unicode"
)

func partitionMergeItems(current State, name string, raw []byte) (string, []mergeItem, string) {
	const invalid = "副本格式异常或与当前数据不匹配。可以核对原文。"
	incoming := current
	// Conflict suffixes on common sync providers follow a space, bracket or dot.
	stem := strings.TrimSuffix(path.Base(name), path.Ext(name))
	prefix, _, found := strings.Cut(stem, ".")
	if i := strings.IndexFunc(prefix, func(r rune) bool { return unicode.IsSpace(r) || r == '(' || r == '[' }); i >= 0 {
		prefix, found = prefix[:i], true
	}
	inferred := path.Join(path.Dir(name), prefix+".json")
	if !found || !safeStoragePath(inferred) {
		inferred = ""
	}
	switch {
	case strings.HasPrefix(name, "笔记/"):
		var part projectNotes
		if json.Unmarshal(raw, &part) != nil || !validID.MatchString(part.ProjectID) {
			return inferred, nil, invalid
		}
		canonical := "笔记/" + part.ProjectID + ".json"
		incoming.Projects = append([]Project{}, current.Projects...)
		incoming.Entries = append([]Entry{}, current.Entries...)
		for i, project := range current.Projects {
			if project.ID != part.ProjectID {
				continue
			}
			project.Note = part.Note
			project.Deadlines = append([]Deadline{}, project.Deadlines...)
			linkedDeadlines, linkedDates := map[string]bool{}, map[string]bool{}
			for j, d := range project.Deadlines {
				linkedDeadlines[d.ID] = true
				if note, ok := part.Deadlines[d.ID]; ok {
					project.Deadlines[j].Note = note
				}
			}
			incoming.Projects[i] = project
			for j, entry := range incoming.Entries {
				if entry.ProjectID != project.ID {
					continue
				}
				linkedDates[entry.Date] = true
				if note, ok := part.Daily[entry.Date]; ok {
					incoming.Entries[j].Note = note
				}
			}
			items := mergeItems(current, incoming)
			for _, set := range []struct {
				title, prefix string
				notes         map[string]string
				linked        map[string]bool
			}{{"当日备注", "unlinked-daily/", part.Daily, linkedDates}, {"截止备注", "unlinked-deadline/", part.Deadlines, linkedDeadlines}} {
				for _, key := range orderedMergeKeys(set.notes, nil) {
					if !set.linked[key] {
						items = append(items, mergeItem{ID: set.prefix + key, Title: project.Name + " · " + key, Category: set.title, Effect: "review", Incoming: []mergeField{field(set.title, set.notes[key])}, Notice: "当前数据没有对应的记录，请先合并包含该记录的副本。"})
					}
				}
			}
			return canonical, items, ""
		}
		return canonical, nil, "当前数据中没有这份笔记所属的项目。请先合并项目，再回来核对笔记。"
	case strings.HasPrefix(name, "周记/"):
		var part weeklyDocument
		if json.Unmarshal(raw, &part) != nil {
			return inferred, nil, invalid
		}
		day, err := time.Parse("2006-01-02", part.Week)
		if err != nil || !validDate(part.Week) || day.Weekday() != time.Monday {
			return inferred, nil, invalid
		}
		canonical := "周记/" + part.Week + ".json"
		incoming.Weekly = maps.Clone(current.Weekly)
		if incoming.Weekly == nil {
			incoming.Weekly = map[string]WeekJournal{}
		}
		incoming.Weekly[part.Week] = part.WeekJournal
		if validate(incoming) != nil {
			return canonical, nil, invalid
		}
		return canonical, mergeItems(current, incoming), ""
	case strings.HasPrefix(name, "时间记录/"):
		var part monthRecords
		if json.Unmarshal(raw, &part) != nil || !validDate(part.Month+"-01") {
			return inferred, nil, invalid
		}
		canonical := "时间记录/" + part.Month + ".json"
		incoming.Entries = nil
		notes := map[string]string{}
		inMonth := func(date string) bool { return validDate(date) && date[:7] == part.Month }
		for _, entry := range current.Entries {
			if inMonth(entry.Date) {
				notes[entryKey(entry)] = entry.Note
			} else {
				incoming.Entries = append(incoming.Entries, entry)
			}
		}
		for _, entry := range part.Entries {
			if !inMonth(entry.Date) {
				return canonical, nil, invalid
			}
			entry.Note = notes[entryKey(entry)]
			incoming.Entries = append(incoming.Entries, entry)
		}
		incoming.TimelineDays = make(map[string]TimelineDay)
		for date, day := range current.TimelineDays {
			if !inMonth(date) {
				incoming.TimelineDays[date] = day
			}
		}
		for date, day := range part.TimelineDays {
			if !inMonth(date) {
				return canonical, nil, invalid
			}
			incoming.TimelineDays[date] = day
		}
		if validate(incoming) != nil {
			return canonical, nil, invalid
		}
		return canonical, mergeItems(current, incoming), ""
	case strings.HasPrefix(name, "操作历史"):
		return "操作历史.json", nil, "操作历史可查看文件差异。合并不会改写当前的撤销记录。"
	case strings.HasPrefix(name, "线索处理"):
		return "线索处理.json", nil, "线索处理状态可查看文件差异。请在记录页处理线索。"
	default:
		var log AutoLog
		canonical := ""
		if json.Unmarshal(raw, &log) == nil && validID.MatchString(log.DeviceID) {
			folder := path.Dir(name)
			if folder == "自动记录/"+log.DeviceID && (prefix == "索引" || validDate(prefix+"-01")) {
				canonical = folder + "/" + prefix + ".json"
			} else if folder == "自动记录" {
				canonical = folder + "/" + log.DeviceID + ".json"
			}
		}
		return canonical, nil, "自动采集副本供核对。采集时间和线索可在记录页处理。"
	}
}
