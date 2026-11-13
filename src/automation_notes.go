package main

import (
	"strconv"
	"time"
)

const journalNoteSource = "手记修改"

// NoteEdit identifies the draft explicitly saved by an editor. Ordinary state
// changes, history restores and sync merges do not generate these touches.
type NoteEdit struct {
	ProjectID string `json:"projectId"`
	Date      string `json:"date,omitempty"`
}

func noteText(st State, edit NoteEdit) (string, bool) {
	for _, project := range st.Projects {
		if project.ID != edit.ProjectID {
			continue
		}
		if edit.Date == "" {
			return project.Note, true
		}
		if !validDate(edit.Date) {
			return "", false
		}
		for _, entry := range st.Entries {
			if entry.ProjectID == edit.ProjectID && entry.Date == edit.Date {
				return entry.Note, true
			}
		}
		return "", true
	}
	return "", false
}

func (s *Store) saveNoteEdit(st State, base string, edit NoteEdit) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	revision, err := s.saveStateLocked(st, base, nil, func(previous State) {
		before, foundBefore := noteText(previous, edit)
		after, foundAfter := noteText(st, edit)
		changed = foundBefore && foundAfter && before != after
	})
	return revision, changed, err
}

func (a *AutoCollector) ingestNoteEdit(edit NoteEdit, when time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || !a.config.Enabled {
		return
	}
	name, key := "项目总体笔记", "journal-note/project"
	if edit.Date != "" {
		name, key = "当日备注 · "+edit.Date, "journal-note/daily/"+edit.Date
	}
	date := when.In(time.Local).Format("2006-01-02")
	id := a.log.DeviceID + "/" + date + "/" + shortHash(edit.ProjectID+"/"+key)
	stamp := strconv.FormatInt(when.UnixNano(), 10) + ":note"
	item := AutoEvidence{ID: id, Date: date, ProjectID: edit.ProjectID, Kind: "file", Name: name,
		RelativePath: key, Stamp: stamp, At: when.UTC().Format(time.RFC3339Nano), Source: journalNoteSource}
	item.Touches = appendFileTouch(a.log.Evidence[id].Touches, AutoFileTouch{At: when.Unix(), Stamp: stamp})
	a.log.Evidence[id] = item
	a.dirty = true
	a.scheduleLocked()
}
