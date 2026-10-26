package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The API keeps its complete State shape. Only the on-disk representation is partitioned.
type diskState struct {
	StorageVersion int               `json:"storageVersion"`
	Version        int               `json:"version"`
	Projects       []Project         `json:"projects"`
	Settings       Settings          `json:"settings"`
	EntryOrder     []string          `json:"entryOrder,omitempty"`
	Files          map[string]string `json:"files"`
}
type projectNotes struct {
	ProjectID string            `json:"projectId"`
	Note      string            `json:"note"`
	Daily     map[string]string `json:"daily,omitempty"`
	Deadlines map[string]string `json:"deadlines,omitempty"`
}
type monthRecords struct {
	Month        string                 `json:"month"`
	Entries      []Entry                `json:"entries"`
	TimelineDays map[string]TimelineDay `json:"timelineDays,omitempty"`
	TimelineRead map[string]string      `json:"timelineRead,omitempty"`
}
type storageWrite struct {
	Before string `json:"before"`
	Data   []byte `json:"data"`
}
type storageTransaction struct {
	Version int                     `json:"version"`
	Writes  map[string]storageWrite `json:"writes"`
}

func diskJSON(v any) ([]byte, error) {
	b, e := json.MarshalIndent(v, "", "  ")
	return append(b, '\n'), e
}
func storageDevice() string {
	host, _ := os.Hostname()
	home, _ := os.UserHomeDir()
	return shortHash(host + "/" + home)
}
func (s *Store) transactionPath() string {
	return storagePath(s.dir, ".保存事务-"+storageDevice()+".json")
}
func safeStoragePath(name string) bool {
	if name == "项目手记.json" || name == "操作历史.json" || name == "线索处理.json" {
		return true
	}
	parts := strings.Split(name, "/")
	if len(parts) == 2 && parts[0] == "笔记" {
		return strings.HasSuffix(parts[1], ".json") && validID.MatchString(strings.TrimSuffix(parts[1], ".json"))
	}
	if len(parts) == 2 && parts[0] == "时间记录" {
		return strings.HasSuffix(parts[1], ".json") && validDate(strings.TrimSuffix(parts[1], ".json")+"-01")
	}
	return false
}
func fileRevision(path string) (string, error) {
	b, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		return "new", nil
	}
	if e != nil {
		return "", e
	}
	return revision(b), nil
}
func (s *Store) recoverTransaction() error {
	b, e := os.ReadFile(s.transactionPath())
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	var tx storageTransaction
	if json.Unmarshal(b, &tx) != nil || tx.Version != 1 || tx.Writes["项目手记.json"].Data == nil {
		return errors.New("保存事务无法读取，原文件已保留")
	}
	names := []string{}
	for name, w := range tx.Writes {
		if !safeStoragePath(name) {
			return errors.New("保存事务包含无效路径")
		}
		current, e := fileRevision(storagePath(s.dir, filepath.FromSlash(name)))
		if e != nil {
			return e
		}
		if current != w.Before && current != revision(w.Data) {
			return fmt.Errorf("%w：%s 在保存恢复期间发生变化，事务已保留", errConflict, name)
		}
		if name != "项目手记.json" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	names = append(names, "项目手记.json") // Publish the manifest last.
	for _, name := range names {
		w := tx.Writes[name]
		path := storagePath(s.dir, filepath.FromSlash(name))
		current, e := fileRevision(path)
		if e != nil {
			return e
		}
		if current == revision(w.Data) {
			continue
		}
		if e = os.MkdirAll(filepath.Dir(path), 0755); e != nil {
			return e
		}
		if e = atomicWrite(path, w.Data); e != nil {
			return e
		}
	}
	return os.Remove(s.transactionPath())
}
func (s *Store) archivePart(b []byte) (string, error) {
	hash := revision(b)
	path := storagePath(s.dir, "历史内容", hash+".json")
	if existing, e := os.ReadFile(path); e == nil {
		if !bytes.Equal(existing, b) {
			return "", errors.New("历史内容校验失败")
		}
		return hash, nil
	} else if !os.IsNotExist(e) {
		return "", e
	}
	if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return "", e
	}
	return hash, atomicWrite(path, b)
}
func splitState(st State) (diskState, map[string][]byte, error) {
	d := diskState{StorageVersion: 2, Version: 2, Settings: st.Settings, Projects: []Project{}, Files: map[string]string{}}
	parts := map[string][]byte{}
	notes := map[string]*projectNotes{}
	months := map[string]*monthRecords{}
	month := func(date string) *monthRecords {
		key := date[:7]
		if months[key] == nil {
			months[key] = &monthRecords{Month: key, Entries: []Entry{}, TimelineDays: map[string]TimelineDay{}, TimelineRead: map[string]string{}}
		}
		return months[key]
	}
	for _, p := range st.Projects {
		n := &projectNotes{ProjectID: p.ID, Note: p.Note, Daily: map[string]string{}, Deadlines: map[string]string{}}
		p.Note = ""
		p.Deadlines = append([]Deadline{}, p.Deadlines...)
		for i := range p.Deadlines {
			if p.Deadlines[i].Note != "" {
				n.Deadlines[p.Deadlines[i].ID] = p.Deadlines[i].Note
				p.Deadlines[i].Note = ""
			}
		}
		notes[p.ID] = n
		d.Projects = append(d.Projects, p)
	}
	for _, e := range st.Entries {
		d.EntryOrder = append(d.EntryOrder, e.ProjectID+"/"+e.Date)
		if e.Note != "" {
			notes[e.ProjectID].Daily[e.Date] = e.Note
		}
		e.Note = ""
		m := month(e.Date)
		m.Entries = append(m.Entries, e)
	}
	for date, day := range st.TimelineDays {
		month(date).TimelineDays[date] = day
	}
	for date, stamp := range st.TimelineRead {
		month(date).TimelineRead[date] = stamp
	}
	for id, n := range notes {
		b, e := diskJSON(n)
		if e != nil {
			return d, nil, e
		}
		parts["笔记/"+id+".json"] = b
	}
	for key, m := range months {
		b, e := diskJSON(m)
		if e != nil {
			return d, nil, e
		}
		parts["时间记录/"+key+".json"] = b
	}
	if len(st.AutoReviewed) > 0 {
		b, e := diskJSON(st.AutoReviewed)
		if e != nil {
			return d, nil, e
		}
		parts["线索处理.json"] = b
	}
	return d, parts, nil
}
func (s *Store) hydrateDisk(d diskState, archived bool) (State, error) {
	if d.StorageVersion != 2 || d.Version != 2 {
		return State{}, errors.New("无法读取此分文件数据版本")
	}
	st := State{Version: 1, Projects: d.Projects, Settings: d.Settings, Entries: []Entry{}, TimelineDays: map[string]TimelineDay{}, TimelineRead: map[string]string{}}
	notes := map[string]projectNotes{}
	entries := map[string]Entry{}
	for name, hash := range d.Files {
		if !safeStoragePath(name) || name == "项目手记.json" || len(hash) != 64 {
			return st, errors.New("数据索引包含无效文件")
		}
		path := storagePath(s.dir, filepath.FromSlash(name))
		if archived {
			path = storagePath(s.dir, "历史内容", hash+".json")
		}
		b, e := os.ReadFile(path)
		if e != nil {
			return st, fmt.Errorf("%s 尚未同步完整或无法读取，已停止写入：%w", name, e)
		}
		if revision(b) != hash {
			return st, fmt.Errorf("%s 与数据索引不一致，可能尚未同步完成或存在冲突；已停止写入", name)
		}
		switch {
		case strings.HasPrefix(name, "笔记/"):
			var n projectNotes
			if e = json.Unmarshal(b, &n); e != nil {
				return st, e
			}
			if name != "笔记/"+n.ProjectID+".json" {
				return st, errors.New("笔记项目索引不一致")
			}
			notes[n.ProjectID] = n
		case strings.HasPrefix(name, "时间记录/"):
			var m monthRecords
			if e = json.Unmarshal(b, &m); e != nil {
				return st, e
			}
			if name != "时间记录/"+m.Month+".json" {
				return st, errors.New("时间记录月份索引不一致")
			}
			for _, v := range m.Entries {
				if !validDate(v.Date) || v.Date[:7] != m.Month {
					return st, errors.New("时间记录日期不属于该月份")
				}
				key := v.ProjectID + "/" + v.Date
				if _, ok := entries[key]; ok {
					return st, errors.New("时间记录重复")
				}
				entries[key] = v
			}
			for date, v := range m.TimelineDays {
				if !validDate(date) || date[:7] != m.Month {
					return st, errors.New("时间线月份不一致")
				}
				st.TimelineDays[date] = v
			}
			for date, v := range m.TimelineRead {
				if !validDate(date) || date[:7] != m.Month {
					return st, errors.New("已读日期月份不一致")
				}
				st.TimelineRead[date] = v
			}
		case name == "线索处理.json":
			if e = json.Unmarshal(b, &st.AutoReviewed); e != nil {
				return st, e
			}
		case name == "操作历史.json":
			var h ChangeHistory
			if e = json.Unmarshal(b, &h); e != nil {
				return st, e
			}
			for i, v := range h.Versions {
				var old diskState
				if e = json.Unmarshal(v.Snapshot, &old); e != nil {
					return st, e
				}
				if _, ok := old.Files["操作历史.json"]; ok {
					return st, errors.New("历史快照不得嵌套操作历史")
				}
				prior, e := s.hydrateDisk(old, true)
				if e != nil {
					return st, e
				}
				h.Versions[i].Snapshot = snapshot(prior)
			}
			if !usableHistory(&h) {
				return st, errors.New("操作历史索引无效")
			}
			st.History = &h
		default:
			return st, errors.New("数据索引文件类型无效")
		}
	}
	for i, p := range st.Projects {
		n, ok := notes[p.ID]
		if !ok {
			return st, fmt.Errorf("项目 %s 的笔记文件尚未同步", p.Name)
		}
		st.Projects[i].Note = n.Note
		st.Projects[i].Deadlines = append([]Deadline{}, p.Deadlines...)
		for j, v := range p.Deadlines {
			st.Projects[i].Deadlines[j].Note = n.Deadlines[v.ID]
		}
	}
	for _, key := range d.EntryOrder {
		v, ok := entries[key]
		if !ok {
			return st, errors.New("每日记录索引不完整")
		}
		v.Note = notes[v.ProjectID].Daily[v.Date]
		st.Entries = append(st.Entries, v)
		delete(entries, key)
	}
	if len(entries) > 0 {
		return st, errors.New("每日记录索引数量不一致")
	}
	return st, validate(st)
}
func (s *Store) readDiskBytes(b []byte, archived bool) (State, error) {
	var header struct {
		StorageVersion int `json:"storageVersion"`
	}
	if e := json.Unmarshal(b, &header); e != nil {
		return State{}, e
	}
	if header.StorageVersion != 0 {
		var d diskState
		if e := json.Unmarshal(b, &d); e != nil {
			return State{}, e
		}
		return s.hydrateDisk(d, archived)
	}
	var st State
	if e := json.Unmarshal(b, &st); e != nil {
		return st, e
	}
	return st, validate(st)
}
func (s *Store) makeDisk(st State, withHistory bool) (diskState, map[string][]byte, error) {
	d, parts, e := splitState(st)
	if e != nil {
		return d, nil, e
	}
	if withHistory && st.History != nil {
		h := &ChangeHistory{Cursor: st.History.Cursor, Versions: append([]HistoryVersion{}, st.History.Versions...)}
		for i, v := range h.Versions {
			var old State
			if e = json.Unmarshal(v.Snapshot, &old); e != nil {
				return d, nil, e
			}
			if e = validate(old); e != nil {
				return d, nil, e
			}
			doc, _, err := s.makeDisk(old, false)
			if err != nil {
				return d, nil, err
			}
			h.Versions[i].Snapshot, _ = json.Marshal(doc)
		}
		parts["操作历史.json"], e = diskJSON(h)
		if e != nil {
			return d, nil, e
		}
	}
	for name, b := range parts {
		hash, err := s.archivePart(b)
		if err != nil {
			return d, nil, err
		}
		d.Files[name] = hash
	}
	return d, parts, nil
}
func (s *Store) commitDisk(st State, base string) (string, error) {
	d, parts, e := s.makeDisk(st, true)
	if e != nil {
		return "", e
	}
	// A partition may arrive before its manifest during cloud synchronization.
	// Never treat that changed partition as an expected pre-save value.
	if raw, err := os.ReadFile(storagePath(s.dir, "项目手记.json")); err == nil {
		if revision(raw) != base {
			return "", errConflict
		}
		var current diskState
		if json.Unmarshal(raw, &current) == nil && current.StorageVersion == 2 {
			for name, hash := range current.Files {
				if !safeStoragePath(name) {
					return "", errors.New("数据索引路径无效")
				}
				actual, err := fileRevision(storagePath(s.dir, filepath.FromSlash(name)))
				if err != nil {
					return "", err
				}
				if actual != hash {
					return "", fmt.Errorf("%w：%s 尚未同步完整", errConflict, name)
				}
			}
		}
	}
	b, e := diskJSON(d)
	if e != nil {
		return "", e
	}
	parts["项目手记.json"] = b
	tx := storageTransaction{Version: 1, Writes: map[string]storageWrite{}}
	for name, content := range parts {
		before, e := fileRevision(storagePath(s.dir, filepath.FromSlash(name)))
		if e != nil {
			return "", e
		}
		if name == "项目手记.json" && before != base {
			return "", errConflict
		}
		if before != revision(content) {
			tx.Writes[name] = storageWrite{Before: before, Data: content}
		}
	}
	if len(tx.Writes) == 0 {
		return revision(b), nil
	}
	if _, ok := tx.Writes["项目手记.json"]; !ok {
		tx.Writes["项目手记.json"] = storageWrite{Before: base, Data: b}
	}
	journal, e := diskJSON(tx)
	if e != nil {
		return "", e
	}
	if e = atomicWrite(s.transactionPath(), journal); e != nil {
		return "", e
	}
	if e = s.recoverTransaction(); e != nil {
		return "", e
	}
	return revision(b), nil
}
func (s *Store) backupState(st State) error {
	d, _, e := s.makeDisk(st, false)
	if e != nil {
		return e
	}
	b, e := diskJSON(d)
	if e != nil {
		return e
	}
	path := storagePath(s.dir, "备份", time.Now().Format("20060102-150405.000000000")+".json")
	if e = os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return e
	}
	return atomicWrite(path, b)
}

// A verbatim migration copy stays outside normal rotating backups.
func (s *Store) backupLegacy() error {
	root := storagePath(s.dir, "备份", "分文件迁移前")
	if _, e := os.Stat(filepath.Join(root, "完成")); e == nil {
		return nil
	}
	if e := os.MkdirAll(root, 0755); e != nil {
		return e
	}
	for _, name := range []string{"项目手记.json", "自动记录"} {
		source := storagePath(s.dir, name)
		e := filepath.WalkDir(source, func(path string, d os.DirEntry, err error) error {
			if os.IsNotExist(err) {
				return nil
			}
			if err != nil {
				return err
			}
			if d.Type()&os.ModeSymlink != 0 {
				return errors.New("迁移源包含符号链接，已停止")
			}
			rel, _ := filepath.Rel(s.dir, path)
			target := filepath.Join(root, rel)
			if d.IsDir() {
				return os.MkdirAll(target, 0755)
			}
			b, e := os.ReadFile(path)
			if e != nil {
				return e
			}
			if existing, e := os.ReadFile(target); e == nil {
				if !bytes.Equal(existing, b) {
					return errors.New("迁移前备份已存在且内容不同，已保留两边数据并停止")
				}
				return nil
			}
			if e = os.MkdirAll(filepath.Dir(target), 0755); e != nil {
				return e
			}
			return atomicWrite(target, b)
		})
		if e != nil {
			return e
		}
	}
	return atomicWrite(filepath.Join(root, "完成"), []byte("迁移前原始文件备份；请保留。\n"))
}
func (s *Store) migrateStorage() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, rev, e := s.read()
	if e != nil || rev == "new" {
		return e
	}
	b, e := os.ReadFile(storagePath(s.dir, "项目手记.json"))
	if e != nil {
		return e
	}
	var head diskState
	_ = json.Unmarshal(b, &head)
	if head.StorageVersion == 2 {
		return nil
	}
	if e = s.backupLegacy(); e != nil {
		return e
	}
	_, e = s.commitDisk(st, rev)
	if e != nil {
		return e
	}
	got, _, e := s.read()
	if e != nil {
		return e
	}
	if !sameSnapshot(snapshot(got), snapshot(st)) {
		return errors.New("迁移核对失败，迁移前备份已保留")
	}
	return nil
}
