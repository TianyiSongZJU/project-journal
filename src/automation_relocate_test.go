package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func copyFolderConfig(c AutoConfig) AutoConfig {
	b, _ := json.Marshal(c)
	var out AutoConfig
	json.Unmarshal(b, &out)
	return out
}
func TestRelocateFolderRetainsHistoryIdentityAndNestedBindings(t *testing.T) {
	a, st, rev, oldRoot := autoFixture(t)
	oldRoot, _ = filepath.EvalSymlinks(oldRoot)
	a.config.Bindings[0].Path = oldRoot
	st.Projects = append(st.Projects, Project{ID: "child", Name: "子项目", Color: "#315c46", Deadlines: []Deadline{}})
	if _, e := a.store.save(st, rev); e != nil {
		t.Fatal(e)
	}
	oldChild := filepath.Join(oldRoot, "子资料")
	os.MkdirAll(oldChild, 0700)
	parentFile := filepath.Join(oldRoot, "报告.pptx")
	childFile := filepath.Join(oldChild, "笔记.md")
	os.WriteFile(parentFile, []byte("original"), 0600)
	os.WriteFile(childFile, []byte("child"), 0600)
	a.config.Bindings = append(a.config.Bindings, AutoBinding{ProjectID: "child", Path: oldChild, AddedAt: a.config.Bindings[0].AddedAt})
	a.ingestPaths([]string{parentFile, childFile})
	if e := a.flush(); e != nil {
		t.Fatal(e)
	}
	before, _ := json.Marshal(a.log.Evidence)
	oldBindings := copyFolderConfig(a.config).Bindings
	oldIDs := map[string]string{}
	for id, e := range a.log.Evidence {
		oldIDs[e.ProjectID] = id
	}
	stateBefore, _, _ := a.store.read()
	newRoot := filepath.Join(filepath.Dir(oldRoot), "改名资料")
	if e := os.Rename(oldRoot, newRoot); e != nil {
		t.Fatal(e)
	}
	c, r := a.configSnapshot()
	c = copyFolderConfig(c)
	c.Enabled = false
	c.Bindings[0].RelocateFrom = oldRoot
	c.Bindings[0].Path = newRoot
	if e := a.saveConfig(c, r); e != nil {
		t.Fatal(e)
	}
	cfg, firstRev := a.configSnapshot()
	if cfg.Bindings[0].SourceRoot != oldRoot || cfg.Bindings[1].SourceRoot != oldChild || cfg.Bindings[1].Path != filepath.Join(newRoot, "子资料") {
		t.Fatal("lineage or nested binding lost", cfg.Bindings)
	}
	for i, b := range cfg.Bindings {
		if b.AddedAt != oldBindings[i].AddedAt || b.RelocateFrom != "" {
			t.Fatal("binding date changed or request persisted")
		}
	}
	after, _ := json.Marshal(a.log.Evidence)
	if string(before) != string(after) {
		t.Fatal("relocation rewrote historical observations")
	}
	a.mu.Lock()
	a.config.Enabled = true
	a.mu.Unlock()
	newFile := filepath.Join(newRoot, "报告.pptx")
	newChildFile := filepath.Join(newRoot, "子资料", "笔记.md")
	a.ingestPaths([]string{newFile, newChildFile})
	after, _ = json.Marshal(a.log.Evidence)
	if string(before) != string(after) {
		t.Fatal("unchanged moved files generated evidence")
	}
	// A real later save continues the original observation rather than inventing a second file.
	os.WriteFile(newFile, []byte("new version with more bytes"), 0600)
	a.ingestPaths([]string{newFile})
	if len(a.log.Evidence) != 2 || a.log.Evidence[oldIDs["p1"]].Path != newFile || len(a.log.Evidence[oldIDs["p1"]].Touches) != 2 {
		t.Fatal("future changes lost stable identity")
	}
	if e := a.flush(); e != nil {
		t.Fatal(e)
	}
	// Relocate back after a modification; stale cache aliases must not block the move.
	if e := os.Rename(newRoot, oldRoot); e != nil {
		t.Fatal(e)
	}
	c, r = a.configSnapshot()
	c = copyFolderConfig(c)
	c.Enabled = false
	c.Bindings[0].RelocateFrom = newRoot
	c.Bindings[0].Path = oldRoot
	if e := a.saveConfig(c, r); e != nil {
		t.Fatal(e)
	}
	cfg, _ = a.configSnapshot()
	if cfg.Bindings[0].SourceRoot != oldRoot || cfg.Bindings[1].Path != oldChild {
		t.Fatal("move back lost lineage")
	}
	if e := a.saveConfig(c, firstRev); !errors.Is(e, errConflict) {
		t.Fatal("stale relocation accepted", e)
	}
	reopened, e := newAutoCollector(a.store, a.home)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.close()
	if reopened.config.Bindings[0].SourceRoot != oldRoot || reopened.log.Index["p1/"+pathKey(parentFile)] == "" {
		t.Fatal("relocation did not survive restart")
	}
	stateAfter, _, _ := a.store.read()
	if !sameSnapshot(snapshot(stateBefore), snapshot(stateAfter)) {
		t.Fatal("relocation changed notes or recorded time")
	}
}
func TestRelocateFolderValidationPreservesConfiguration(t *testing.T) {
	a, _, _, root := autoFixture(t)
	root, _ = filepath.EvalSymlinks(root)
	a.config.Bindings[0].Path = root
	before, rev := a.configSnapshot()
	before = copyFolderConfig(before)
	for _, tc := range []string{"missing", "unknown-source", "duplicate", "child"} {
		t.Run(tc, func(t *testing.T) {
			c := copyFolderConfig(before)
			c.Enabled = false
			c.Bindings[0].RelocateFrom = root
			target := filepath.Join(t.TempDir(), "new")
			os.MkdirAll(target, 0700)
			c.Bindings[0].Path = target
			switch tc {
			case "missing":
				c.Bindings[0].Path = filepath.Join(target, "absent")
			case "unknown-source":
				c.Bindings[0].RelocateFrom = target
			case "duplicate":
				c.Bindings = append(c.Bindings, AutoBinding{ProjectID: "p1", Path: target})
			case "child":
				target = filepath.Join(root, "nested")
				os.MkdirAll(target, 0700)
				c.Bindings[0].Path = target
			}
			if e := a.saveConfig(c, rev); e == nil {
				t.Fatal("invalid relocation accepted")
			}
			current, currentRev := a.configSnapshot()
			if currentRev != rev || current.Bindings[0].Path != root {
				t.Fatal("invalid action changed configuration")
			}
		})
	}
	// Never accept a client-selected source root as a history identity.
	c := copyFolderConfig(before)
	c.Enabled = false
	c.Bindings[0].SourceRoot = "/untrusted"
	if e := a.saveConfig(c, rev); e != nil {
		t.Fatal(e)
	}
	current, _ := a.configSnapshot()
	if current.Bindings[0].SourceRoot != "" {
		t.Fatal("untrusted identity persisted")
	}
}
