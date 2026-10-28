package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAutoMonthlyMigrationAllEvidenceAndOnlyChangedMonth(t *testing.T) {
	s := &Store{dir: t.TempDir()}
	home := t.TempDir()
	a, e := newAutoCollector(s, home)
	if e != nil {
		t.Fatal(e)
	}
	log := emptyAutoLog(a.log.DeviceID, a.log.DeviceName)
	for _, month := range []string{"2026-10", "2026-11"} {
		date := month + "-01"
		id := log.DeviceID + "/" + date + "/one"
		log.Evidence[id] = AutoEvidence{ID: id, Date: date, Kind: "file", Name: "笔记.md", Stamp: "v1", At: date + "T01:00:00Z"}
		log.AppUsage[date] = AutoAppUsage{Date: date, App: "Word", Slots: map[int64]int64{time.Date(2026, 10, 1, 1, 0, 0, 0, time.UTC).Unix(): 300}}
	}
	log.Index["p1/file.md"] = "stamp"
	log.Edits["old"] = AutoEdit{ID: "old", Note: "旧草稿备注"}
	raw, _ := diskJSON(log)
	os.MkdirAll(filepath.Dir(a.logPath()), 0755)
	os.WriteFile(a.logPath(), raw, 0600)
	a, e = newAutoCollector(s, home)
	if e != nil {
		t.Fatal(e)
	}
	defer a.close()
	if len(a.log.Evidence) != 2 || len(a.log.AppUsage) != 2 || a.log.Edits["old"].Note != "旧草稿备注" || a.log.Index["p1/file.md"] != "stamp" {
		t.Fatal("migration lost fields")
	}
	if _, e = os.Stat(a.logPath()); !os.IsNotExist(e) {
		t.Fatal("old log not archived")
	}
	path := filepath.Join(s.dir, "自动记录", a.log.DeviceID, "2026-10.json")
	before, _ := os.Stat(path)
	id := a.log.DeviceID + "/2026-11-02/two"
	a.log.Evidence[id] = AutoEvidence{ID: id, Date: "2026-11-02", Kind: "file", Stamp: "v2"}
	a.dirty = true
	if e = a.flush(); e != nil {
		t.Fatal(e)
	}
	after, _ := os.Stat(path)
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatal("unchanged previous month rewritten")
	}
	// Another device can contribute monthly records and its old edit metadata.
	other := emptyAutoLog("windows-device", "Windows")
	other.Evidence["other-one"] = AutoEvidence{ID: "other-one", Date: "2026-11-01", Kind: "file"}
	other.Edits["edit"] = AutoEdit{ID: "edit", Note: "跨设备备注"}
	for name, part := range partitionAutoLog(other) {
		b, _ := diskJSON(part)
		p := filepath.Join(s.dir, "自动记录", other.DeviceID, name+".json")
		os.MkdirAll(filepath.Dir(p), 0755)
		os.WriteFile(p, b, 0600)
	}
	logs := a.logs()
	if len(logs) != 2 {
		t.Fatal("monthly logs not grouped by device", len(logs))
	}
	found := false
	for _, l := range logs {
		if l.DeviceID == other.DeviceID {
			found = l.Edits["edit"].Note == "跨设备备注" && len(l.Evidence) == 1
		}
	}
	if !found {
		t.Fatal("remote month or metadata lost")
	}
	// External changes to this device's log cannot be overwritten.
	p := filepath.Join(s.dir, "自动记录", a.log.DeviceID, "2026-11.json")
	b, _ := os.ReadFile(p)
	var external AutoLog
	json.Unmarshal(b, &external)
	external.Evidence["external"] = AutoEvidence{ID: "external", Date: "2026-11-03", Kind: "file"}
	b, _ = diskJSON(external)
	os.WriteFile(p, b, 0600)
	a.log.Evidence["another"] = AutoEvidence{ID: "another", Date: "2026-11-04", Kind: "file"}
	a.dirty = true
	if e = a.flush(); e == nil {
		t.Fatal("external own-device edit overwritten")
	}
}
