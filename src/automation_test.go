package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func autoFixture(t *testing.T) (*AutoCollector, State, string, string) {
	t.Helper()
	s := &Store{dir: t.TempDir()}
	st := fixture()
	rev, e := s.save(st, "new")
	if e != nil {
		t.Fatal(e)
	}
	a, e := newAutoCollector(s, t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(a.close)
	root := filepath.Join(t.TempDir(), "tmp", "资料")
	os.MkdirAll(root, 0700)
	a.config.Enabled = true
	a.config.HistorySince = time.Now().AddDate(-1, 0, 0).Format("2006-01-02")
	a.config.Bindings = []AutoBinding{{ProjectID: st.Projects[0].ID, Path: root, AddedAt: time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339Nano)}}
	return a, st, rev, root
}
func TestAutoMetadataDedupAndIgnore(t *testing.T) {
	a, st, _, root := autoFixture(t)
	file := filepath.Join(root, "研究汇报.pptx")
	os.WriteFile(file, []byte("not read"), 0600)
	a.ingestPaths([]string{file, file})
	a.ingestPaths([]string{file})
	d := autoDrafts(st, a.logs())
	if len(d) != 1 || len(d[0].Evidence) != 1 || d[0].Kind != "none" || d[0].Seconds != 0 {
		t.Fatalf("%+v", d)
	}
	os.MkdirAll(filepath.Join(root, "Reference"), 0700)
	ref := filepath.Join(root, "Reference", "ignore.pdf")
	os.WriteFile(ref, []byte("x"), 0600)
	a.ingestPaths([]string{ref})
	if pid := a.matchActivity(AutoActivity{Title: "研究汇报 — PowerPoint"}, a.config); pid != st.Projects[0].ID {
		t.Fatal("known file title mapping", pid)
	}
	if len(a.log.Evidence) != 1 {
		t.Fatal("reference collected")
	}
	if e := a.flush(); e != nil {
		t.Fatal(e)
	}
	writes := a.stats.Writes
	a.ingestPaths([]string{file})
	a.flush()
	if a.stats.Writes != writes || a.timer != nil {
		t.Fatal("unchanged file causes writes")
	}
	reload, e := newAutoCollector(a.store, a.home)
	if e != nil {
		t.Fatal(e)
	}
	defer reload.close()
	if len(autoDrafts(st, reload.logs())) != 1 {
		t.Fatal("spool lost")
	}
}
func TestAutoReviewPreservesManualAndUndoRequeues(t *testing.T) {
	a, st, rev, root := autoFixture(t)
	date := time.Now().Format("2006-01-02")
	pid := st.Projects[0].ID
	st.Entries = []Entry{{ProjectID: pid, Date: date, Kind: "hours", Hours: 2, Note: "原备注"}}
	rev, e := a.store.save(st, rev)
	if e != nil {
		t.Fatal(e)
	}
	file := filepath.Join(root, "汇报.pptx")
	os.WriteFile(file, []byte("x"), 0600)
	a.ingestPaths([]string{file})
	d := autoDrafts(st, a.logs())[0]
	if e = a.saveEdit(AutoEdit{ID: d.ID, Digest: d.Digest, Note: "整理汇报", Kind: "长", ProjectID: pid}); e != nil {
		t.Fatal(e)
	}
	if autoDrafts(st, a.logs())[0].Edit == nil {
		t.Fatal("edit lost")
	}
	note := "整理汇报"
	req := AutoReviewRequest{Revision: rev, Items: []AutoReviewItem{{ID: d.ID, Digest: d.Digest, Kind: "长", Note: &note}}}
	saved, rev, e := a.review(req)
	if e != nil {
		t.Fatal(e)
	}
	entry := saved.Entries[0]
	if entry.Kind != "hours" || entry.Hours != 2 || entry.Note != "原备注\n整理汇报" {
		t.Fatal(entry)
	}
	if len(autoDrafts(saved, a.logs())) != 0 {
		t.Fatal("accepted still pending")
	}
	undone, rev, e := a.store.restoreHistory(rev, saved.History.Cursor-1)
	if e != nil {
		t.Fatal(e)
	}
	if len(autoDrafts(undone, a.logs())) != 1 {
		t.Fatal("undo did not requeue")
	}
	d = autoDrafts(undone, a.logs())[0]
	req = AutoReviewRequest{Revision: rev, Items: []AutoReviewItem{{ID: d.ID, Digest: d.Digest, Ignore: true}}}
	saved, _, e = a.review(req)
	if e != nil || len(autoDrafts(saved, a.logs())) != 0 || saved.Entries[0].Note != "原备注" {
		t.Fatal("ignore", e, saved.Entries)
	}
	_, _, e = a.review(req)
	if !errors.Is(e, errConflict) {
		t.Fatal("stale mutation", e)
	}
}
func TestAutoActivityIdleGapsMidnightAndIncrement(t *testing.T) {
	a, st, _, root := autoFixture(t)
	a.config.Activity = true
	start := time.Date(2026, 8, 1, 23, 59, 30, 0, time.Local)
	v := AutoActivity{App: "PowerPoint", Title: "汇报", Document: filepath.Join(root, "汇报.pptx"), At: start.Format(time.RFC3339Nano)}
	a.ingestActivity(v)
	v.At = start.Add(time.Minute).Format(time.RFC3339Nano)
	a.ingestActivity(v)
	ds := autoDrafts(st, a.logs())
	if len(ds) != 2 || ds[0].Seconds != 30 || ds[1].Seconds != 30 {
		t.Fatal(ds)
	}
	v.At = start.Add(20 * time.Minute).Format(time.RFC3339Nano)
	a.ingestActivity(v)
	v.IdleSeconds = 600
	v.At = start.Add(21 * time.Minute).Format(time.RFC3339Nano)
	a.ingestActivity(v)
	if len(a.logs()[0].Evidence) != 2 {
		t.Fatal("sleep/idle counted")
	}
	st.AutoReviewed = map[string]AutoMark{}
	for _, d := range ds {
		for _, tok := range d.Tokens {
			st.AutoReviewed[tok.ID] = AutoMark{Seconds: tok.Seconds, Stamp: tok.Stamp}
		}
	}
	if len(autoDrafts(st, a.logs())) != 0 {
		t.Fatal("reviewed activity reappears")
	}
	a.activity = nil
	v.IdleSeconds = 0
	v.At = start.Add(30 * time.Minute).Format(time.RFC3339Nano)
	a.ingestActivity(v)
	v.At = start.Add(31 * time.Minute).Format(time.RFC3339Nano)
	a.ingestActivity(v)
	if d := autoDrafts(st, a.logs()); len(d) != 1 || d[0].Seconds != 60 {
		t.Fatal("incremental accounting", d)
	}
}
func TestAutoHistoricalBaselineAndConfig(t *testing.T) {
	a, st, _, root := autoFixture(t)
	file := filepath.Join(root, "旧文件.docx")
	os.WriteFile(file, []byte("x"), 0600)
	old := time.Now().AddDate(0, -2, 0)
	os.Chtimes(file, old, old)
	a.config.Bindings[0].AddedAt = time.Now().UTC().Format(time.RFC3339Nano)
	a.scan(false, make(chan struct{}))
	if len(autoDrafts(st, a.logs())) != 0 {
		t.Fatal("old files invented as new activity")
	}
	a.scan(true, make(chan struct{}))
	if len(autoDrafts(st, a.logs())) == 0 {
		t.Fatal("history not found")
	}
	child := filepath.Join(root, "child")
	os.MkdirAll(child, 0700)
	c := a.config
	c.Bindings = append([]AutoBinding{}, c.Bindings...)
	c.Bindings = append(c.Bindings, AutoBinding{ProjectID: st.Projects[0].ID, Path: child})
	if b := matchBinding(filepath.Join(child, "x"), c); b == nil || b.Path != child {
		t.Fatal("child mapping")
	}
	c.Enabled = false
	if e := a.saveConfig(c, a.configRev); e != nil {
		t.Fatal(e)
	}
	if e := a.saveConfig(c, "stale"); !errors.Is(e, errConflict) {
		t.Fatal(e)
	}
}
func TestAutoSyncConflictChoosesLatestEvidence(t *testing.T) {
	a, st, _, root := autoFixture(t)
	file := filepath.Join(root, "x.pdf")
	os.WriteFile(file, []byte("x"), 0600)
	a.ingestPaths([]string{file})
	logs := a.logs()
	other := logs[0]
	other.Evidence = map[string]AutoEvidence{}
	for id, e := range logs[0].Evidence {
		e.Stamp = "new"
		e.At = time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)
		other.Evidence[id] = e
	}
	d := autoDrafts(st, append(logs, other))
	if len(d) != 1 || len(d[0].Tokens) != 1 || d[0].Tokens[0].Stamp != "new" {
		t.Fatal(d)
	}
}

func TestAutoCrossDeviceTimeUnionAndReviewedCoverage(t *testing.T) {
	_, st, _, _ := autoFixture(t)
	pid := st.Projects[0].ID
	date := "2026-08-12"
	base := time.Date(2026, 8, 12, 9, 0, 0, 0, time.Local).Unix()
	evidence := func(id string, start, end int64) AutoEvidence {
		return AutoEvidence{ID: id, Date: date, ProjectID: pid, Kind: "activity", Name: "汇报", App: "PowerPoint", Seconds: end - start, Stamp: fmt.Sprint(end - start), Spans: []AutoSpan{{base + start, base + end}}}
	}
	mac := evidence("mac/activity", 0, 3600)
	win := evidence("win/activity", 1800, 5400)
	logs := []AutoLog{{DeviceName: "Mac", Evidence: map[string]AutoEvidence{mac.ID: mac}}, {DeviceName: "Windows", Evidence: map[string]AutoEvidence{win.ID: win}}}
	ds := autoDrafts(st, logs)
	if len(ds) != 1 || ds[0].Seconds != 5400 {
		t.Fatal("overlap must count once", ds)
	}
	st.AutoReviewed = map[string]AutoMark{mac.ID: {Stamp: mac.Stamp, Seconds: mac.Seconds, SourceKey: autoSourceKey(mac), Spans: mac.Spans}}
	ds = autoDrafts(st, logs)
	if len(ds) != 1 || ds[0].Seconds != 1800 {
		t.Fatal("already reviewed remote overlap must not return", ds)
	}
	win = evidence("win/activity", 3600, 7200)
	logs[1].Evidence[win.ID] = win
	ds = autoDrafts(st, logs)
	if len(ds) != 1 || ds[0].Seconds != 3600 {
		t.Fatal("sequential time must remain", ds)
	}
	st.AutoReviewed[win.ID] = AutoMark{Seconds: win.Seconds, Stamp: win.Stamp, Spans: win.Spans, SourceKey: autoSourceKey(win)}
	if len(autoDrafts(st, logs)) != 0 {
		t.Fatal("all reviewed must disappear")
	}
}
func TestAutoSyncFileMetadataDedupAcrossPathsAndLateArrival(t *testing.T) {
	a, st, rev, root := autoFixture(t)
	file := filepath.Join(root, "汇报.pptx")
	os.WriteFile(file, []byte("x"), 0600)
	a.ingestPaths([]string{file})
	local := autoDrafts(st, a.logs())[0].Evidence[0]
	other := local
	other.ID = "windows/" + other.Date + "/same-file"
	other.Path = `C:\School\CNCC\汇报.pptx`
	other.RelativePath = `汇报.pptx`
	parts := strings.Split(other.Stamp, ":")
	ns, _ := strconv.ParseInt(parts[0], 10, 64)
	other.Stamp = fmt.Sprintf("%d:%s", ns/1000000000*1000000000, parts[1])
	remote := AutoLog{DeviceID: "windows", Version: 1, DeviceName: "Windows", Evidence: map[string]AutoEvidence{other.ID: other}}
	logs := append(a.logs(), remote)
	d := autoDrafts(st, logs)
	if len(d) != 1 || len(d[0].Evidence) != 1 || len(d[0].Tokens) != 2 || d[0].Seconds != 0 {
		t.Fatal("same sync file twice", d)
	}
	// Accept the Mac version before the other device has synced: the late counterpart stays reviewed.
	d = autoDrafts(st, a.logs())
	saved, _, err := a.review(AutoReviewRequest{Revision: rev, Items: []AutoReviewItem{{ID: d[0].ID, Digest: d[0].Digest}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(autoDrafts(saved, logs)) != 0 {
		t.Fatal("late sync file reappeared")
	}
}
func TestAutoExtensionFiltersAndStatus(t *testing.T) {
	a, st, _, root := autoFixture(t)
	a.config.Extensions = []string{"pptx", "md"}
	for _, name := range []string{"保留.PPTX", "笔记.md", "跳过.zip", "跳过.docx"} {
		p := filepath.Join(root, name)
		os.WriteFile(p, []byte("x"), 0600)
		a.ingestPaths([]string{p})
	}
	d := autoDrafts(st, a.logs())
	if len(d) != 1 || len(d[0].Evidence) != 2 || a.stats.FilesChecked != 2 {
		t.Fatal("extension filtering", d, a.stats)
	}
	if got := normalizedAutoExtensions([]string{".PPTX", "word", "*.MD", "pptx"}); len(got) != 5 {
		t.Fatal(got)
	}
	c := a.config
	c.Enabled = false
	if s := effectiveAutoStats(c, AutoStats{Status: "监听中", Watching: 3}); s.Status != "已暂停" || s.Watching != 0 {
		t.Fatal(s)
	}
	c.Enabled = true
	if s := effectiveAutoStats(c, AutoStats{Watching: 1}); s.Status != "监听中" {
		t.Fatal(s)
	}
}

func TestProjectExtensionFiltersStayIndependent(t *testing.T) {
	a, st, _, root := autoFixture(t)
	child := filepath.Join(root, "code")
	if err := os.MkdirAll(child, 0700); err != nil {
		t.Fatal(err)
	}
	other := st.Projects[0]
	other.ID = "other"
	other.Name = "代码项目"
	other.Deadlines = []Deadline{}
	st.Projects = append(st.Projects, other)
	a.store.mu.Lock()
	_, rev, err := a.store.read()
	a.store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.store.save(st, rev); err != nil {
		t.Fatal(err)
	}
	c, cr := a.configSnapshot()
	c.Enabled = false
	c.Bindings = append(c.Bindings, AutoBinding{ProjectID: "other", Path: child})
	c.ProjectExtensions = map[string][]string{st.Projects[0].ID: {"pptx"}, "other": {".PY", "myext"}}
	if err = a.saveConfig(c, cr); err != nil {
		t.Fatal(err)
	}
	c, _ = a.configSnapshot()
	root = c.Bindings[0].Path
	child = c.Bindings[1].Path
	if !allowedAutoFile(filepath.Join(root, "报告.pptx"), c) || allowedAutoFile(filepath.Join(root, "脚本.py"), c) || !allowedAutoFile(filepath.Join(child, "脚本.py"), c) || allowedAutoFile(filepath.Join(child, "报告.pptx"), c) || !allowedAutoFile(filepath.Join(child, "自定义.myext"), c) {
		t.Fatal("project filters leaked between nested bindings")
	}
	c.ProjectExtensions["other"] = []string{}
	if allowedAutoFile(filepath.Join(child, "脚本.py"), c) {
		t.Fatal("empty project selection must disable all file types")
	}
	if allowedAutoFile(filepath.Join(child, "脚本.py"), AutoConfig{Bindings: c.Bindings, ProjectExtensions: map[string][]string{}}) || !allowedAutoFile(filepath.Join(child, "报告.pptx"), AutoConfig{Bindings: c.Bindings, ProjectExtensions: map[string][]string{}}) {
		t.Fatal("new project should default to documents only")
	}
}

func TestLegacyFileTypesBecomeIndependentProjectDefaults(t *testing.T) {
	a, st, _, _ := autoFixture(t)
	c, _ := a.configSnapshot()
	c.Enabled = false
	c.Extensions = []string{"pptx"}
	c.ProjectExtensions = nil
	c.FileTypesDefaultsVersion = 0
	home := t.TempDir()
	raw, _ := json.Marshal(c)
	if err := os.WriteFile(filepath.Join(home, "自动记录设置.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	upgraded, err := newAutoCollector(a.store, home)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.close()
	config, rev := upgraded.configSnapshot()
	if len(config.ProjectExtensions[st.Projects[0].ID]) != len(defaultAutoExtensions()) {
		t.Fatal("project presets were not enabled")
	}
	backup, err := os.ReadFile(filepath.Join(home, "自动记录设置-文档默认类型调整前.json"))
	if err != nil || string(backup) != string(raw) {
		t.Fatal("original local settings not backed up")
	}
	saved, err := os.ReadFile(filepath.Join(home, "自动记录设置.json"))
	if err != nil || revision(saved) != rev {
		t.Fatal("configuration revision did not follow migration")
	}
}

func TestDocumentDefaultsLeaveCustomProjectChoicesAlone(t *testing.T) {
	c := AutoConfig{Extensions: allAutoExtensions(), ProjectExtensions: map[string][]string{"default": allAutoExtensions(), "custom": {"py", "myext"}}}
	if !restoreDocumentDefaults(&c) || len(c.ProjectExtensions["default"]) != len(defaultAutoExtensions()) || len(c.Extensions) != len(defaultAutoExtensions()) {
		t.Fatal("broad defaults were not restored")
	}
	if len(c.ProjectExtensions["custom"]) != 2 || c.ProjectExtensions["custom"][0] != "py" {
		t.Fatal("custom choices were overwritten")
	}
	c.ProjectExtensions["default"] = allAutoExtensions()
	if restoreDocumentDefaults(&c) {
		t.Fatal("defaults migration must run only once")
	}
}
func TestCompactAttributionKeepsBasisWithoutWindowTitles(t *testing.T) {
	a, st, _, root := autoFixture(t)
	a.config.Activity = true
	at := time.Now().Truncate(15 * time.Minute).Add(time.Minute)
	a.ingestActivity(AutoActivity{At: at.Format(time.RFC3339Nano), App: "Word", Title: "private document title", Document: filepath.Join(root, "private.docx")})
	a.ingestActivity(AutoActivity{At: at.Add(time.Minute).Format(time.RFC3339Nano), App: "Word", Document: filepath.Join(root, "private.docx")})
	if len(a.log.AppUsage) != 1 {
		t.Fatal(a.log.AppUsage)
	}
	found := false
	for _, usage := range a.log.AppUsage {
		if usage.ProjectID != st.Projects[0].ID {
			t.Fatal(usage)
		}
		for _, basis := range usage.Attribution {
			found = basis["document"] == 60
		}
	}
	if !found {
		t.Fatal("document attribution duration missing")
	}
	raw, _ := json.Marshal(a.log.AppUsage)
	if strings.Contains(string(raw), "private") {
		t.Fatal("raw title or filename archived")
	}
	expanded := expandAutoUsage(a.log)
	found = false
	for _, e := range expanded.Evidence {
		if e.Attribution["document"] == 60 {
			found = true
		}
	}
	if !found {
		t.Fatal("API lost attribution basis")
	}
}
func TestSuggestionRuleSettingsValidateAndPersist(t *testing.T) {
	a, _, _, _ := autoFixture(t)
	c, rev := a.configSnapshot()
	c.Enabled = false
	c.SuggestionRules = map[string]bool{"document": false, "filename": true, "gap": false}
	if err := a.saveConfig(c, rev); err != nil {
		t.Fatal(err)
	}
	saved, rev := a.configSnapshot()
	if saved.SuggestionRules["document"] || !saved.SuggestionRules["filename"] || saved.SuggestionRules["gap"] {
		t.Fatal(saved.SuggestionRules)
	}
	raw, err := os.ReadFile(filepath.Join(a.home, "自动记录设置.json"))
	if err != nil {
		t.Fatal(err)
	}
	var decoded AutoConfig
	if json.Unmarshal(raw, &decoded) != nil || decoded.SuggestionRules["filename"] != true {
		t.Fatal("rules not persisted")
	}
	saved.SuggestionRules = map[string]bool{"unknown": true}
	if err := a.saveConfig(saved, rev); err == nil {
		t.Fatal("unknown rule accepted")
	}
}
