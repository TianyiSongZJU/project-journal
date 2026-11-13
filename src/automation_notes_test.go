package main

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestSavedJournalNotesSupplyProjectEvidence(t *testing.T) {
	a, st, revision, _ := autoFixture(t)
	a.config.Bindings = nil
	pid := st.Projects[0].ID
	project := NoteEdit{ProjectID: pid}
	daily := NoteEdit{ProjectID: pid, Date: "2025-01-12"}
	today := time.Now()
	now := time.Date(today.Year(), today.Month(), today.Day(), 12, 0, 0, 0, time.Local)
	save := func(edit NoteEdit, expected bool) {
		t.Helper()
		rev, changed, err := a.store.saveNoteEdit(st, revision, edit)
		if err != nil || changed != expected {
			t.Fatalf("change=%v, err=%v, want change=%v", changed, err, expected)
		}
		revision = rev
		if changed {
			a.ingestNoteEdit(edit, now)
			now = now.Add(2 * time.Minute)
		}
	}
	st.Projects[0].Note = "测试内容，不进入自动记录"
	save(project, true)
	save(project, false)
	st.Entries = append(st.Entries, Entry{ProjectID: pid, Date: daily.Date, Kind: "hours", Hours: 1, Note: "测试当日备注"})
	save(daily, true)
	st.Entries[len(st.Entries)-1].Hours = 2
	save(daily, false)
	st.Projects[0].Note += "。"
	save(project, true)
	_, changed, err := a.store.saveNoteEdit(st, "stale", project)
	if !errors.Is(err, errConflict) || changed {
		t.Fatalf("conflicting save change=%v err=%v", changed, err)
	}
	drafts := autoDrafts(st, a.logs())
	if len(drafts) != 1 || drafts[0].ProjectID != pid || len(drafts[0].Evidence) != 2 {
		t.Fatalf("drafts=%+v", drafts)
	}
	for _, item := range drafts[0].Evidence {
		if item.Kind != "file" || item.Source != "手记修改" || item.Path != "" || strings.Contains(item.Name, "测试") {
			t.Fatalf("unexpected evidence: %+v", item)
		}
		if item.Name == "项目总体笔记" && len(item.Touches) != 2 {
			t.Fatalf("project touches=%+v", item.Touches)
		}
	}
	if drafts[0].Date != today.Format("2006-01-02") {
		t.Fatal("evidence date must reflect the edit, not the daily note date")
	}
	a.config.Enabled = false
	a.ingestNoteEdit(project, now)
	if len(a.log.Evidence) != 2 {
		t.Fatal("disabled collector generated evidence")
	}
}

func TestJournalAppForegroundUsesExistingActivityTracking(t *testing.T) {
	a, _, _, _ := autoFixture(t)
	a.config.Activity = true
	now := time.Now().Truncate(time.Minute)
	a.ingestActivity(AutoActivity{At: now.Format(time.RFC3339Nano), App: "ProjectJournal.exe"})
	a.ingestActivity(AutoActivity{At: now.Add(40 * time.Second).Format(time.RFC3339Nano), App: "Other"})
	for _, usage := range a.log.AppUsage {
		if usage.App == "项目手记" && usage.ProjectID == "" {
			var seconds int64
			for _, value := range usage.Slots {
				seconds += value
			}
			if seconds == 40 {
				return
			}
		}
	}
	t.Fatalf("own foreground activity missing: %+v", a.log.AppUsage)
}
