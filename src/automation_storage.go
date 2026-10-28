package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func emptyAutoLog(device, name string) AutoLog {
	return AutoLog{Version: 1, DeviceID: device, DeviceName: name, Evidence: map[string]AutoEvidence{}, Index: map[string]string{}, Edits: map[string]AutoEdit{}, AppUsage: map[string]AutoAppUsage{}}
}
func mergeAutoLog(dst *AutoLog, src AutoLog) {
	for k, v := range src.Evidence {
		dst.Evidence[k] = v
	}
	for k, v := range src.Index {
		dst.Index[k] = v
	}
	for k, v := range src.Edits {
		dst.Edits[k] = v
	}
	for k, v := range src.AppUsage {
		dst.AppUsage[k] = v
	}
	if src.UpdatedAt > dst.UpdatedAt {
		dst.UpdatedAt = src.UpdatedAt
	}
}
func partitionAutoLog(log AutoLog) map[string]AutoLog {
	out := map[string]AutoLog{}
	get := func(month string) AutoLog {
		if v, ok := out[month]; ok {
			return v
		}
		v := emptyAutoLog(log.DeviceID, log.DeviceName)
		v.UpdatedAt = log.UpdatedAt
		return v
	}
	for id, e := range log.Evidence {
		if !validDate(e.Date) {
			continue
		}
		m := e.Date[:7]
		v := get(m)
		v.Evidence[id] = e
		out[m] = v
	}
	for id, e := range log.AppUsage {
		if !validDate(e.Date) {
			continue
		}
		m := e.Date[:7]
		v := get(m)
		v.AppUsage[id] = e
		out[m] = v
	}
	index := get("索引")
	index.Index = log.Index
	index.Edits = log.Edits
	out["索引"] = index
	return out
}
func (a *AutoCollector) loadMonthlyLogs() error {
	if a.logRevisions == nil {
		a.logRevisions = map[string]string{}
	}
	paths, e := filepath.Glob(storagePath(a.store.dir, "自动记录", a.log.DeviceID, "*.json"))
	if e != nil {
		return e
	}
	for _, path := range paths {
		name := strings.TrimSuffix(filepath.Base(path), ".json")
		if name != "索引" && !validDate(name+"-01") {
			continue
		}
		b, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		var l AutoLog
		if json.Unmarshal(b, &l) != nil || l.Version != 1 || l.DeviceID != a.log.DeviceID {
			return fmt.Errorf("自动线索文件无法读取，原文件已保留：%s", path)
		}
		if name != "索引" {
			for _, v := range l.Evidence {
				if !validDate(v.Date) || v.Date[:7] != name {
					return fmt.Errorf("自动线索月份不一致：%s", path)
				}
			}
			for _, v := range l.AppUsage {
				if !validDate(v.Date) || v.Date[:7] != name {
					return fmt.Errorf("前台活动月份不一致：%s", path)
				}
			}
		}
		mergeAutoLog(&a.log, l)
		a.logRevisions[path] = revision(b)
	}
	return nil
}
func (a *AutoCollector) writeMonthlyLogs() error {
	parts := partitionAutoLog(a.log)
	names := make([]string, 0, len(parts))
	for name := range parts {
		names = append(names, name)
	}
	sort.Strings(names)
	if a.logRevisions == nil {
		a.logRevisions = map[string]string{}
	}
	for _, name := range names {
		l := parts[name]
		path := storagePath(a.store.dir, "自动记录", a.log.DeviceID, name+".json")
		// A month unchanged by collection must not be rewritten merely to update a timestamp.
		l.UpdatedAt = ""
		content, e := diskJSON(l)
		if e != nil {
			return e
		}
		existing, e := os.ReadFile(path)
		if e != nil && !os.IsNotExist(e) {
			return e
		}
		if e == nil {
			var prev AutoLog
			if json.Unmarshal(existing, &prev) != nil {
				return fmt.Errorf("自动线索文件损坏：%s", path)
			}
			prev.UpdatedAt = ""
			previous, _ := diskJSON(prev)
			if string(previous) == string(content) {
				a.logRevisions[path] = revision(existing)
				continue
			}
		}
		before := "new"
		if len(existing) > 0 {
			before = revision(existing)
		}
		expected := a.logRevisions[path]
		if expected == "" {
			expected = "new"
		}
		if before != expected {
			return fmt.Errorf("%w：自动线索 %s 已由其他副本修改", errConflict, filepath.Base(path))
		}
		l.UpdatedAt = a.log.UpdatedAt
		content, e = diskJSON(l)
		if e != nil {
			return e
		}
		if e = os.MkdirAll(filepath.Dir(path), 0755); e != nil {
			return e
		}
		if e = atomicWrite(path, content); e != nil {
			return e
		}
		a.logRevisions[path] = revision(content)
	}
	return nil
}
