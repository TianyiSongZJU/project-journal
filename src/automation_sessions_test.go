package main

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sessionFixture() (State, int64) {
	st := fixture()
	st.Entries = nil
	for k, v := range map[string]float64{"很短": .25, "短": .5, "中": 1, "长": 2, "很长": 4} {
		v := v
		st.Settings.Estimates[k] = &v
	}
	base, _ := time.ParseInLocation("2006-01-02 15:04", "2026-10-23 10:00", time.Local)
	return st, base.Unix()
}
func fileEvidence(id, name string, base int64, offsets ...int64) AutoEvidence {
	e := AutoEvidence{ID: "mac/" + id, ProjectID: "p1", Date: "2026-10-23", Kind: "file", Name: name, RelativePath: name, Path: "/files/" + name, At: time.Unix(base, 0).UTC().Format(time.RFC3339Nano), Stamp: "latest"}
	for i, n := range offsets {
		e.Touches = append(e.Touches, AutoFileTouch{At: base + n, Stamp: fmt.Sprint(n, "/", i)})
	}
	return e
}
func draftForEvidence(st State, list ...AutoEvidence) AutoDraft {
	log := AutoLog{DeviceID: "mac", DeviceName: "Mac", Evidence: map[string]AutoEvidence{}}
	for _, e := range list {
		log.Evidence[e.ID] = e
	}
	return autoDrafts(st, []AutoLog{log})[0]
}
func TestFileSessionsAcrossFilesAndLongGaps(t *testing.T) {
	st, base := sessionFixture()
	a := fileEvidence("a", "初稿.docx", base, 0, 20*60, 2*60*60)
	b := fileEvidence("b", "图表.xlsx", base, 8*60)
	d := draftForEvidence(st, a, b)
	if len(d.Sessions) != 2 || d.Sessions[0].Seconds != 20*60 || d.RangeMin != 10 || d.RangeMax != 30 || d.Confidence != "较弱" || d.Seconds != 0 || d.Hours != 0 || d.Kind == "none" {
		t.Fatalf("%+v", d)
	}
	if !strings.Contains(d.Basis, "保存间隔不等于实际投入") {
		t.Fatal(d.Basis)
	}
}
func TestSingleSaveAndLegacyDatesDoNotInventTime(t *testing.T) {
	st, base := sessionFixture()
	for _, e := range []AutoEvidence{fileEvidence("single", "初稿.docx", base, 0), fileEvidence("legacy", "旧记录.docx", base)} {
		d := draftForEvidence(st, e)
		if d.Kind != "none" || d.RangeMax != 0 || d.Seconds != 0 || d.Hours != 0 || d.Confidence != "不足" {
			t.Fatalf("%+v", d)
		}
	}
}
func TestBulkChangesDoNotBecomeFileWorkTime(t *testing.T) {
	st, base := sessionFixture()
	m := map[string]AutoEvidence{}
	for i := 0; i < 12; i++ {
		e := fileEvidence(fmt.Sprint(i), fmt.Sprint(i, ".pptx"), base, 0, 20)
		m[e.ID] = e
	}
	outside := fileEvidence("outside", "other.docx", base, 0)
	outside.ProjectID = "other"
	m[outside.ID] = outside
	if !markFileBursts(m, base+25) {
		t.Fatal("burst missed")
	}
	if m[outside.ID].Touches[0].Bulk {
		t.Fatal("cross-project contamination")
	}
	delete(m, outside.ID)
	d := autoDrafts(st, []AutoLog{{Evidence: m}})[0]
	if d.BulkFiles != 12 || d.RangeMax != 0 || d.Kind != "none" || !strings.Contains(d.Basis, "复制／同步") {
		t.Fatalf("%+v", d)
	}
}
func TestForegroundMergeDoesNotChargeGapsOrFileSpans(t *testing.T) {
	st, base := sessionFixture()
	e := AutoEvidence{ID: "mac/activity", ProjectID: "p1", Date: "2026-10-23", Kind: "activity", App: "Word", Seconds: 20 * 60, Stamp: "1200", Spans: []AutoSpan{{base, base + 10*60}, {base + 13*60, base + 23*60}}}
	f := fileEvidence("file", "初稿.docx", base, 0, 10*60, 20*60)
	d := draftForEvidence(st, e, f)
	if d.Seconds != 20*60 || d.Confidence != "较强" || d.RangeMin != 15 || d.RangeMax != 25 || d.Hours != 1.0/3 {
		t.Fatalf("%+v", d)
	}
	active := 0
	for _, s := range d.Sessions {
		if s.Source == "activity" {
			active++
			if s.Seconds != 20*60 {
				t.Fatal("charged idle gap")
			}
		}
	}
	if active != 1 {
		t.Fatal(d.Sessions)
	}
}
func TestExistingTimeKeepsSuggestionOutOfDefaultDraft(t *testing.T) {
	st, base := sessionFixture()
	st.Entries = []Entry{{ProjectID: "p1", Date: "2026-10-23", Kind: "hours", Hours: 2, Note: "人工记录"}}
	d := draftForEvidence(st, fileEvidence("a", "初稿.docx", base, 0, 10*60))
	if d.Kind != "none" || d.Hours != 0 || d.Existing == nil || d.RangeMax == 0 || !strings.Contains(d.Basis, "已有时长") {
		t.Fatalf("%+v", d)
	}
}
func TestNewFileTouchDoesNotReuseReviewedSession(t *testing.T) {
	st, base := sessionFixture()
	e := fileEvidence("a", "初稿.docx", base, 0, 10*60, 60*60)
	st.AutoReviewed = map[string]AutoMark{e.ID: {Stamp: "previous", ReviewedAt: time.Unix(base+30*60, 0).UTC().Format(time.RFC3339Nano)}}
	d := draftForEvidence(st, e)
	if len(d.Sessions) != 1 || d.Sessions[0].Start != base+60*60 || d.RangeMax != 0 {
		t.Fatalf("reused reviewed observations: %+v", d)
	}
}
func TestMirroredFileVersionsDoNotDoubleSession(t *testing.T) {
	st, base := sessionFixture()
	a := fileEvidence("a", "初稿.docx", base, 0, 10*60)
	b := a
	b.ID = "win/a"
	d := draftForEvidence(st, a, b)
	if len(d.Sessions) != 1 || d.Sessions[0].Seconds != 10*60 || len(d.Evidence) != 1 {
		t.Fatalf("%+v", d)
	}
}
func TestLiveFileTouchPersistsAndHistoryDoesNotCreateTouch(t *testing.T) {
	a, _, _, root := autoFixture(t)
	file := filepath.Join(root, "初稿.docx")
	os.WriteFile(file, []byte("a"), 0600)
	a.ingestPaths([]string{file})
	a.flush()
	before := a.logs()[0]
	for _, e := range before.Evidence {
		if len(e.Touches) != 1 {
			t.Fatalf("%+v", e)
		}
	}
	reloaded, err := newAutoCollector(a.store, a.home)
	if err != nil {
		t.Fatal(err)
	}
	defer reloaded.close()
	for _, e := range reloaded.logs()[0].Evidence {
		if len(e.Touches) != 1 {
			t.Fatal("touch lost on reload")
		}
	}
	old := filepath.Join(root, "历史.docx")
	os.WriteFile(old, []byte("old"), 0600)
	a.inspectFile(old, true, false)
	for _, e := range a.logs()[0].Evidence {
		if e.Name == "历史.docx" && len(e.Touches) > 0 {
			t.Fatal("history inferred activity")
		}
	}
}

func TestActivityRuleDefaultsAndReclassification(t *testing.T) {
	c := autoRules(AutoConfig{})
	if c.FileGapMinutes != 15 || c.BurstWindowSeconds != 30 || c.BurstFiles != 12 {
		t.Fatal(c)
	}
	st, base := sessionFixture()
	e := fileEvidence("a", "初稿.docx", base, 0, 8*60, 20*60)
	log := AutoLog{Evidence: map[string]AutoEvidence{e.ID: e}}
	original := autoDrafts(st, []AutoLog{log})[0]
	changed := autoDrafts(st, []AutoLog{log}, AutoConfig{FileGapMinutes: 5})[0]
	if original.RangeMax == 0 || changed.RangeMax != 0 || len(changed.Sessions) != 3 || original.Digest == changed.Digest {
		t.Fatalf("default=%+v changed=%+v", original, changed)
	}
	m := map[string]AutoEvidence{}
	for i := 0; i < 12; i++ {
		e := fileEvidence(fmt.Sprint(i), fmt.Sprint(i, ".docx"), base, 0)
		e.Touches[0].Bulk = true
		m[e.ID] = e
	}
	small := autoDrafts(st, []AutoLog{{Evidence: m}})[0]
	large := autoDrafts(st, []AutoLog{{Evidence: m}}, AutoConfig{BurstFiles: 20})[0]
	if small.BulkFiles != 12 || large.BulkFiles != 0 {
		t.Fatalf("bulk threshold was not recalculated: %d %d", small.BulkFiles, large.BulkFiles)
	}
	// Reclassification must not mutate caller-owned log slices.
	if !m["mac/0"].Touches[0].Bulk {
		t.Fatal("mutated input log")
	}
}

func TestActivityRulePersistenceAndValidation(t *testing.T) {
	a, _, _, _ := autoFixture(t)
	c, rev := a.configSnapshot()
	c.FileGapMinutes = 7
	c.BurstWindowSeconds = 60
	c.BurstFiles = 18
	if err := a.saveConfig(c, rev); err != nil {
		t.Fatal(err)
	}
	reloaded, err := newAutoCollector(a.store, a.home)
	if err != nil {
		t.Fatal(err)
	}
	defer reloaded.close()
	saved, _ := reloaded.configSnapshot()
	if saved.FileGapMinutes != 7 || saved.BurstWindowSeconds != 60 || saved.BurstFiles != 18 {
		t.Fatal(saved)
	}
	for _, bad := range []AutoConfig{{FileGapMinutes: -1}, {FileGapMinutes: 121}, {BurstWindowSeconds: 4}, {BurstFiles: 2}, {BurstFiles: 201}} {
		value, revision := a.configSnapshot()
		if bad.FileGapMinutes != 0 {
			value.FileGapMinutes = bad.FileGapMinutes
		}
		if bad.BurstWindowSeconds != 0 {
			value.BurstWindowSeconds = bad.BurstWindowSeconds
		}
		if bad.BurstFiles != 0 {
			value.BurstFiles = bad.BurstFiles
		}
		if a.saveConfig(value, revision) == nil {
			t.Fatalf("accepted invalid rule: %+v", bad)
		}
	}
}

func TestTimelineUnionExcludesForegroundIdleAndPriorCounted(t *testing.T) {
	base := int64(100000)
	d := AutoDraft{Sessions: []AutoSession{
		{Spans: []AutoSpan{{base, base + 20*60}}},
		{Spans: []AutoSpan{{base, base + 30*60}, {base + 32*60, base + 45*60}}},
	}}
	spans, err := selectedAutoSpans(d, []int{0, 1}, nil)
	if err != nil || autoSpanSeconds(spans) != 43*60 {
		t.Fatalf("%v %v", spans, err)
	}
	spans, err = selectedAutoSpans(d, []int{0, 1}, []AutoSpan{{base, base + 35*60}})
	if err != nil || autoSpanSeconds(spans) != 10*60 {
		t.Fatalf("%v %v", spans, err)
	}
	if _, err = selectedAutoSpans(d, []int{0, 0}, nil); err == nil {
		t.Fatal("duplicate selection accepted")
	}
	if _, err = selectedAutoSpans(d, []int{9}, nil); err == nil {
		t.Fatal("invalid selection accepted")
	}
}
func TestTimelineConfirmationAddsMinutesAndDeduplicatesNewSource(t *testing.T) {
	a, st, rev, _ := autoFixture(t)
	pid := st.Projects[0].ID
	st.Entries = []Entry{{ProjectID: pid, Date: "2026-10-23", Kind: "hours", Hours: 2, Note: "手记"}}
	rev, err := a.store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	base := int64(1792720800)
	e := AutoEvidence{ID: a.log.DeviceID + "/timeline-one", ProjectID: pid, Date: "2026-10-23", Kind: "activity", Stamp: "one", Seconds: 43 * 60, Spans: []AutoSpan{{base, base + 30*60}, {base + 32*60, base + 45*60}}}
	a.mu.Lock()
	a.log.Evidence[e.ID] = e
	a.mu.Unlock()
	ds := autoDrafts(st, a.logs())
	ids := []int{0}
	note := "自动活动"
	saved, next, err := a.review(AutoReviewRequest{Revision: rev, Items: []AutoReviewItem{{ID: ds[0].ID, Digest: ds[0].Digest, ProjectID: pid, SelectedSessions: &ids, AddTime: true, Note: &note, Hours: 24}}})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(saved.Entries[0].Hours-(2+43.0/60)) > 1e-10 {
		t.Fatalf("%+v", saved.Entries)
	}
	if autoSpanSeconds(countedAutoSpans(saved, pid, "2026-10-23")) != 43*60 {
		t.Fatal("counted ledger lost")
	}
	e.ID = a.log.DeviceID + "/timeline-two"
	e.Stamp = "two"
	e.Seconds = 60 * 60
	e.Spans = []AutoSpan{{base, base + 60*60}}
	a.mu.Lock()
	a.log.Evidence[e.ID] = e
	a.mu.Unlock()
	ds = autoDrafts(saved, a.logs())
	ids = nil
	for i := range ds[0].Sessions {
		ids = append(ids, i)
	}
	saved, _, err = a.review(AutoReviewRequest{Revision: next, Items: []AutoReviewItem{{ID: ds[0].ID, Digest: ds[0].Digest, ProjectID: pid, SelectedSessions: &ids, AddTime: true, Note: &note}}})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(saved.Entries[0].Hours-3) > 1e-10 {
		t.Fatalf("overlap counted twice: %+v", saved.Entries)
	}
}
