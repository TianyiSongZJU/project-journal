package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// Machine-local roots never get mixed with paths on a second computer.
type AutoBinding struct {
	SourceRoot   string `json:"sourceRoot,omitempty"`
	RelocateFrom string `json:"relocateFrom,omitempty"`
	ProjectID    string `json:"projectId"`
	Path         string `json:"path"`
	AddedAt      string `json:"addedAt,omitempty"`
}
type AutoConfig struct {
	SuggestionRules          map[string]bool     `json:"suggestionRules,omitempty"`
	FileTypesDefaultsVersion int                 `json:"fileTypesDefaultsVersion,omitempty"`
	ProjectExtensions        map[string][]string `json:"projectExtensions,omitempty"`
	FileGapMinutes           int                 `json:"fileGapMinutes"`
	BurstWindowSeconds       int                 `json:"burstWindowSeconds"`
	BurstFiles               int                 `json:"burstFiles"`
	Extensions               []string            `json:"extensions"`
	Enabled                  bool                `json:"enabled"`
	Activity                 bool                `json:"activity"`
	DeviceName               string              `json:"deviceName"`
	Bindings                 []AutoBinding       `json:"bindings"`
	Excludes                 []string            `json:"excludes"`
	HistorySince             string              `json:"historySince"`
	IdleMinutes              int                 `json:"idleMinutes"`
}
type AutoFileTouch struct {
	At    int64  `json:"at"`
	Stamp string `json:"stamp"`
	Bulk  bool   `json:"bulk,omitempty"`
}
type AutoEvidence struct {
	Attribution  map[string]int64 `json:"attribution,omitempty"`
	BucketStart  int64            `json:"bucketStart,omitempty"`
	Touches      []AutoFileTouch  `json:"touches,omitempty"`
	ID           string           `json:"id"`
	Date         string           `json:"date"`
	ProjectID    string           `json:"projectId"`
	Kind         string           `json:"kind"`
	Name         string           `json:"name"`
	Path         string           `json:"path,omitempty"`
	RelativePath string           `json:"relativePath,omitempty"`
	Spans        []AutoSpan       `json:"spans,omitempty"`
	App          string           `json:"app,omitempty"`
	Stamp        string           `json:"stamp"`
	At           string           `json:"at"`
	Seconds      int64            `json:"seconds,omitempty"`
	Source       string           `json:"source"`
}
type AutoMark struct {
	CountedSpans   []AutoSpan `json:"countedSpans,omitempty"`
	CountedProject string     `json:"countedProject,omitempty"`
	CountedDate    string     `json:"countedDate,omitempty"`
	SourceKey      string     `json:"sourceKey,omitempty"`
	Spans          []AutoSpan `json:"spans,omitempty"`
	Stamp          string     `json:"stamp"`
	Seconds        int64      `json:"seconds,omitempty"`
	Decision       string     `json:"decision"`
	ReviewedAt     string     `json:"reviewedAt,omitempty"`
}
type AutoEdit struct {
	SelectedSessions *[]int  `json:"selectedSessions,omitempty"`
	AddTime          bool    `json:"addTime,omitempty"`
	ID               string  `json:"id"`
	Digest           string  `json:"digest"`
	ProjectID        string  `json:"projectId"`
	Kind             string  `json:"kind"`
	Hours            float64 `json:"hours"`
	Note             string  `json:"note"`
	ReplaceTime      bool    `json:"replaceTime"`
	At               string  `json:"at"`
}
type AutoAppUsage struct {
	Pending     []AutoActivityPending      `json:"pending,omitempty"`
	Attribution map[int64]map[string]int64 `json:"attribution,omitempty"`
	Date        string                     `json:"date"`
	ProjectID   string                     `json:"projectId,omitempty"`
	App         string                     `json:"app"`
	Slots       map[int64]int64            `json:"slots"`
}
type AutoLog struct {
	AppUsage   map[string]AutoAppUsage `json:"appUsage,omitempty"`
	Edits      map[string]AutoEdit     `json:"edits,omitempty"`
	Version    int                     `json:"version"`
	DeviceID   string                  `json:"deviceId"`
	DeviceName string                  `json:"deviceName"`
	UpdatedAt  string                  `json:"updatedAt"`
	Evidence   map[string]AutoEvidence `json:"evidence"`
	Index      map[string]string       `json:"index,omitempty"`
}
type AutoToken struct {
	SourceKey string     `json:"sourceKey,omitempty"`
	Spans     []AutoSpan `json:"spans,omitempty"`
	ID        string     `json:"id"`
	Stamp     string     `json:"stamp"`
	Seconds   int64      `json:"seconds,omitempty"`
}
type AutoDraft struct {
	CountedSpans []AutoSpan     `json:"countedSpans"`
	Confidence   string         `json:"confidence"`
	RangeMin     int            `json:"rangeMin"`
	RangeMax     int            `json:"rangeMax"`
	Sessions     []AutoSession  `json:"sessions"`
	BulkFiles    int            `json:"bulkFiles"`
	ID           string         `json:"id"`
	Digest       string         `json:"digest"`
	Date         string         `json:"date"`
	ProjectID    string         `json:"projectId"`
	ProjectName  string         `json:"projectName"`
	Note         string         `json:"note"`
	Kind         string         `json:"kind"`
	Hours        float64        `json:"hours"`
	Seconds      int64          `json:"seconds"`
	Basis        string         `json:"basis"`
	Evidence     []AutoEvidence `json:"evidence"`
	Tokens       []AutoToken    `json:"tokens"`
	Devices      []string       `json:"devices"`
	Edit         *AutoEdit      `json:"edit,omitempty"`
	Existing     *Entry         `json:"existing,omitempty"`
}
type AutoActivity struct {
	At          string  `json:"at"`
	App         string  `json:"app"`
	Title       string  `json:"title"`
	Document    string  `json:"document"`
	IdleSeconds float64 `json:"idleSeconds"`
	Paused      bool    `json:"paused"`
	TitleAccess bool    `json:"titleAccess"`
}
type AutoStats struct {
	FileBatches     int64  `json:"fileBatches"`
	FilesChecked    int64  `json:"filesChecked"`
	Scans           int64  `json:"scans"`
	Writes          int64  `json:"writes"`
	ActivitySamples int64  `json:"activitySamples"`
	StartedAt       string `json:"startedAt"`
	Watching        int    `json:"watching"`
	Status          string `json:"status"`
	Error           string `json:"error,omitempty"`
	TitleAccess     bool   `json:"titleAccess"`
}
type AutoCollector struct {
	mu           sync.Mutex
	store        *Store
	home         string
	config       AutoConfig
	configRev    string
	logRevisions map[string]string
	log          AutoLog
	stats        AutoStats
	timer        *time.Timer
	dirty        bool
	scanCancel   chan struct{}
	stopMonitor  func()
	activity     *AutoActivity
	activityAt   time.Time
	recentFiles  map[string]int64
	closed       bool
}

var currentAuto *AutoCollector

func shortHash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:12]) }
func autoHome(dataDir, override string) string {
	if override == "" {
		override = os.Getenv("JOURNAL_AUTOMATION_HOME")
	}
	if override != "" {
		return override
	}
	base, e := os.UserConfigDir()
	if e != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "ProjectJournal", shortHash(dataDir))
}
func newAutoCollector(store *Store, home string) (*AutoCollector, error) {
	host, _ := os.Hostname()
	user, _ := os.UserHomeDir()
	device := shortHash(host + "/" + user + "/" + runtime.GOOS)
	a := &AutoCollector{store: store, home: home, config: AutoConfig{DeviceName: map[string]string{"darwin": "我的 Mac", "windows": "我的 Windows"}[runtime.GOOS], Bindings: []AutoBinding{}, Excludes: []string{".git", "node_modules", "Reference", "References", "备份", "__pycache__", "tmp"}, HistorySince: time.Now().AddDate(-1, 0, 0).Format("2006-01-02"), IdleMinutes: 5}, log: AutoLog{Version: 1, DeviceID: device, Evidence: map[string]AutoEvidence{}, Index: map[string]string{}}, stats: AutoStats{StartedAt: time.Now().UTC().Format(time.RFC3339), Status: "未开启"}}
	if a.config.DeviceName == "" {
		a.config.DeviceName = "本机"
	}
	b, e := os.ReadFile(filepath.Join(home, "自动记录设置.json"))
	if e == nil {
		if json.Unmarshal(b, &a.config) != nil {
			return nil, errors.New("本机自动记录设置无法读取，原文件已保留")
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	if a.config.Extensions == nil {
		a.config.Extensions = defaultAutoExtensions()
	}
	a.config = autoRules(a.config)
	if len(b) == 0 {
		a.config.FileTypesDefaultsVersion = 2
	} else if restoreDocumentDefaults(&a.config) {
		backup := filepath.Join(home, "自动记录设置-文档默认类型调整前.json")
		if _, err := os.Stat(backup); os.IsNotExist(err) {
			if err = atomicWrite(backup, b); err != nil {
				return nil, err
			}
		}
		upgraded, err := json.MarshalIndent(a.config, "", "  ")
		if err != nil {
			return nil, err
		}
		if err = atomicWrite(filepath.Join(home, "自动记录设置.json"), upgraded); err != nil {
			return nil, err
		}
		b = upgraded
	}
	a.configRev = revision(b)
	legacyPath := a.logPath()
	legacyBytes, legacyErr := os.ReadFile(legacyPath)
	a.log = emptyAutoLog(device, a.config.DeviceName)
	if legacyErr == nil {
		var old AutoLog
		if json.Unmarshal(legacyBytes, &old) != nil || old.Version != 1 || old.DeviceID != device {
			return nil, errors.New("本机自动记录旧文件无法读取，原文件已保留")
		}
		mergeAutoLog(&a.log, old)
	} else if !os.IsNotExist(legacyErr) {
		return nil, legacyErr
	}
	if e = a.loadMonthlyLogs(); e != nil {
		return nil, e
	}
	if legacyErr == nil {
		if e = store.backupLegacy(); e != nil {
			return nil, e
		}
		if e = a.writeMonthlyLogs(); e != nil {
			return nil, e
		}
		// Verify every observation after splitting before archiving the legacy source.
		verify := &AutoCollector{store: store, log: emptyAutoLog(device, a.config.DeviceName)}
		if e = verify.loadMonthlyLogs(); e != nil {
			return nil, e
		}
		oldJSON, _ := json.Marshal(a.log.Evidence)
		newJSON, _ := json.Marshal(verify.log.Evidence)
		oldUsage, _ := json.Marshal(a.log.AppUsage)
		newUsage, _ := json.Marshal(verify.log.AppUsage)
		oldIndex, _ := json.Marshal(a.log.Index)
		newIndex, _ := json.Marshal(verify.log.Index)
		oldEdits, _ := json.Marshal(a.log.Edits)
		newEdits, _ := json.Marshal(verify.log.Edits)
		if string(oldJSON) != string(newJSON) || string(oldUsage) != string(newUsage) || string(oldIndex) != string(newIndex) || string(oldEdits) != string(newEdits) {
			return nil, errors.New("自动线索迁移核对失败，旧文件已保留")
		}
		archive := storagePath(store.dir, "备份", "自动线索旧版", device+".json")
		if e = os.MkdirAll(filepath.Dir(archive), 0755); e != nil {
			return nil, e
		}
		if e = atomicWrite(archive, legacyBytes); e != nil {
			return nil, e
		}
		if e = os.Remove(legacyPath); e != nil {
			return nil, e
		}
	}
	return a, nil
}
func (a *AutoCollector) logPath() string {
	return storagePath(a.store.dir, "自动记录", a.log.DeviceID+".json")
}
func (a *AutoCollector) configSnapshot() (AutoConfig, string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.config, a.configRev
}
func pathKey(p string) string {
	p = filepath.Clean(p)
	if runtime.GOOS == "windows" {
		p = strings.ToLower(p)
	}
	return p
}
func under(path, root string) bool {
	rel, e := filepath.Rel(pathKey(root), pathKey(path))
	return e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}
func (a *AutoCollector) ignored(path string, c AutoConfig) bool {
	if under(path, a.store.dir) || under(path, a.home) {
		return true
	}
	binding := matchBinding(path, c)
	if binding == nil {
		return true
	}
	relative, err := filepath.Rel(binding.Path, path)
	if err != nil {
		return true
	}
	for _, part := range strings.FieldsFunc(relative, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part != "." && (strings.HasPrefix(part, ".") || strings.HasPrefix(part, "~$")) {
			return true
		}
		for _, x := range c.Excludes {
			if strings.EqualFold(strings.TrimSpace(x), part) {
				return true
			}
		}
	}
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".tmp" || ext == ".swp" || ext == ".temp" || strings.HasSuffix(strings.ToLower(path), ".app")
}
func matchBinding(path string, c AutoConfig) *AutoBinding {
	var best *AutoBinding
	for i := range c.Bindings {
		b := &c.Bindings[i]
		if under(path, b.Path) && (best == nil || len(b.Path) > len(best.Path)) {
			best = b
		}
	}
	return best
}
func (a *AutoCollector) saveConfig(c AutoConfig, base string) error {
	c = autoRules(c)
	for key := range c.SuggestionRules {
		if key != "document" && key != "filename" && key != "folder" && key != "files" && key != "gap" && key != "ignoreBulk" {
			return errors.New("未知的建议区间规则")
		}
	}
	if c.FileGapMinutes < 1 || c.FileGapMinutes > 120 || c.BurstWindowSeconds < 5 || c.BurstWindowSeconds > 300 || c.BurstFiles < 3 || c.BurstFiles > 200 {
		return errors.New("活动规则超出范围：合段 1–120 分钟，批量窗口 5–300 秒，数量 3–200 个")
	}

	if c.Extensions == nil {
		c.Extensions = defaultAutoExtensions()
	}
	c.Extensions = normalizedAutoExtensions(c.Extensions)
	if len(c.Extensions) == 0 || len(c.Extensions) > 100 {
		return errors.New("请至少选择一种文件后缀")
	}
	for _, ext := range c.Extensions {
		if len(ext) > 20 || strings.IndexFunc(ext, func(r rune) bool { return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '-') }) >= 0 {
			return errors.New("文件后缀只填写 pptx、docx、md 这样的名称")
		}
	}
	if !validDate(c.HistorySince) || c.IdleMinutes < 1 || c.IdleMinutes > 60 || len(c.Bindings) > 100 || len(c.Excludes) > 100 || len(c.DeviceName) > 100 {
		return errors.New("自动记录设置无效")
	}
	a.store.mu.Lock()
	st, _, e := a.store.read()
	a.store.mu.Unlock()
	if e != nil {
		return e
	}
	ids := map[string]bool{}
	for _, p := range st.Projects {
		ids[p.ID] = true
	}
	if len(c.ProjectExtensions) > 1000 {
		return errors.New("项目文件类型设置过多")
	}
	for pid, values := range c.ProjectExtensions {
		if !ids[pid] {
			delete(c.ProjectExtensions, pid)
			continue
		}
		values = normalizedAutoExtensions(values)
		if len(values) > 100 {
			return errors.New("每个项目最多设置 100 个文件后缀")
		}
		for _, ext := range values {
			if len(ext) > 20 || strings.IndexFunc(ext, func(r rune) bool { return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '-') }) >= 0 {
				return errors.New("文件后缀只能包含字母、数字、下划线和短横线")
			}
		}
		c.ProjectExtensions[pid] = values
	}
	old, oldRevision := a.configSnapshot()
	if base != oldRevision {
		return errConflict
	}
	moves, e := prepareFolderMoves(&c, old)
	if e != nil {
		return e
	}
	seen := map[string]bool{}
	for i, b := range c.Bindings {
		if !ids[b.ProjectID] {
			return errors.New("绑定的项目不存在")
		}
		if !filepath.IsAbs(b.Path) {
			return errors.New("请填写文件夹的完整路径")
		}
		p, e := filepath.EvalSymlinks(b.Path)
		if e != nil {
			return fmt.Errorf("文件夹不可用：%s", b.Path)
		}
		info, e := os.Stat(p)
		if e != nil || !info.IsDir() {
			return fmt.Errorf("请选择文件夹：%s", b.Path)
		}
		key := pathKey(p)
		if seen[key] {
			return errors.New("同一文件夹只能绑定一次；子文件夹可绑定其他项目")
		}
		if under(p, a.store.dir) {
			return errors.New("请绑定项目资料文件夹，不要绑定软件的数据目录")
		}
		seen[key] = true
		c.Bindings[i].Path = p
		if c.Bindings[i].AddedAt == "" {
			c.Bindings[i].AddedAt = time.Now().UTC().Format(time.RFC3339Nano)
		}
		for _, ob := range old.Bindings {
			if ob.ProjectID == b.ProjectID && pathKey(ob.Path) == key {
				c.Bindings[i].AddedAt = ob.AddedAt
				break
			}
		}
	}
	a.mu.Lock()
	if base != a.configRev {
		a.mu.Unlock()
		return errConflict
	}
	if e = os.MkdirAll(a.home, 0700); e != nil {
		a.mu.Unlock()
		return e
	}
	if e = a.relocateFileIndexLocked(moves); e != nil {
		a.mu.Unlock()
		return e
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	if e = atomicWrite(filepath.Join(a.home, "自动记录设置.json"), b); e != nil {
		a.mu.Unlock()
		return e
	}
	a.config = c
	a.configRev = revision(b)
	a.log.DeviceName = c.DeviceName
	a.activity = nil
	a.mu.Unlock()
	before, _ := json.Marshal(struct {
		B []AutoBinding
		X []string
		E []string
		P map[string][]string
	}{old.Bindings, old.Excludes, old.Extensions, old.ProjectExtensions})
	after, _ := json.Marshal(struct {
		B []AutoBinding
		X []string
		E []string
		P map[string][]string
	}{c.Bindings, c.Excludes, c.Extensions, c.ProjectExtensions})
	a.restartWithScan(!old.Enabled || string(before) != string(after))
	return nil
}
func (a *AutoCollector) restart() { a.restartWithScan(true) }
func (a *AutoCollector) restartWithScan(scan bool) {
	a.mu.Lock()
	if a.stopMonitor != nil {
		a.stopMonitor()
		a.stopMonitor = nil
	}
	if a.scanCancel != nil {
		close(a.scanCancel)
		a.scanCancel = nil
	}
	c := a.config
	a.stats.Watching = 0
	a.stats.Error = ""
	if !c.Enabled {
		a.stats.Status = "已暂停"
		a.mu.Unlock()
		a.flush()
		return
	}
	a.stats.Status = "监听中"
	a.stats.Watching = 0
	cancel := make(chan struct{})
	a.scanCancel = cancel
	a.mu.Unlock()
	stop := startAutoPlatform(a, c)
	a.mu.Lock()
	a.stopMonitor = stop
	a.mu.Unlock()
	if scan {
		go a.scan(false, cancel)
	}
}
func (a *AutoCollector) scan(history bool, cancel <-chan struct{}) {
	c, _ := a.configSnapshot()
	a.mu.Lock()
	a.stats.Scans++
	a.stats.Status = "正在核对文件日期"
	a.mu.Unlock()
	for _, root := range c.Bindings {
		_ = filepath.WalkDir(root.Path, func(path string, d fs.DirEntry, err error) error {
			select {
			case <-cancel:
				return fs.SkipAll
			default:
			}
			if err != nil {
				return nil
			}
			if a.ignored(path, c) {
				if d != nil && d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 {
				return nil
			}
			a.inspectFile(path, history, true)
			return nil
		})
	}
	a.mu.Lock()
	if a.config.Enabled {
		a.stats.Status = "监听中"
	} else {
		a.stats.Status = "已暂停"
	}
	a.mu.Unlock()
	a.flush()
}
func (a *AutoCollector) inspectFile(path string, history, scan bool) {
	c, _ := a.configSnapshot()
	if (!c.Enabled && !history) || a.ignored(path, c) {
		return
	}
	binding := matchBinding(path, c)
	if binding == nil || !allowedAutoFile(path, c) {
		return
	}
	info, e := os.Stat(path)
	if e != nil || !info.Mode().IsRegular() {
		return
	}
	stamp := fmt.Sprintf("%d:%d", info.ModTime().UnixNano(), info.Size())
	key := binding.ProjectID + "/" + pathKey(path)
	a.mu.Lock()
	defer a.mu.Unlock()
	a.stats.FilesChecked++
	old, known := a.log.Index[key]
	if known && old == stamp && !history {
		return
	}
	a.log.Index[key] = stamp
	a.dirty = true
	source := "文件变化"
	at := info.ModTime()
	if history {
		source = "文件日期"
	} else if scan {
		source = "重新核对的文件日期"
		added, _ := time.Parse(time.RFC3339Nano, binding.AddedAt)
		if !known && at.Before(added) {
			a.scheduleLocked()
			return
		}
	}
	dates := []time.Time{at}
	if history {
		if birth := fileCreationTime(info); !birth.IsZero() && birth.In(time.Local).Format("2006-01-02") != at.In(time.Local).Format("2006-01-02") {
			dates = append(dates, birth)
		}
	}
	for _, when := range dates {
		date := when.In(time.Local).Format("2006-01-02")
		if date < c.HistorySince || date > time.Now().Format("2006-01-02") {
			continue
		}
		relative, _ := filepath.Rel(binding.Path, path)
		identityKey := key
		if binding.SourceRoot != "" {
			identityKey = binding.ProjectID + "/" + pathKey(filepath.Join(binding.SourceRoot, relative))
		}
		id := a.log.DeviceID + "/" + date + "/" + shortHash(identityKey)
		previous := a.log.Evidence[id]
		item := AutoEvidence{RelativePath: filepath.ToSlash(relative), ID: id, Date: date, ProjectID: binding.ProjectID, Kind: "file", Name: info.Name(), Path: path, Stamp: stamp, At: when.UTC().Format(time.RFC3339Nano), Source: source}
		item.Touches = previous.Touches
		observed := time.Now()
		if !history && !scan && date == observed.Format("2006-01-02") {
			item.Touches = appendFileTouch(item.Touches, AutoFileTouch{At: observed.Unix(), Stamp: stamp})
			if a.recentFiles == nil {
				a.recentFiles = map[string]int64{}
			}
			a.recentFiles[id] = observed.Unix()
		}
		a.log.Evidence[id] = item
	}
	a.scheduleLocked()
}
func (a *AutoCollector) ingestPaths(paths []string) {
	a.mu.Lock()
	a.stats.FileBatches++
	a.mu.Unlock()
	seen := map[string]bool{}
	for _, p := range paths {
		if seen[p] {
			continue
		}
		seen[p] = true
		a.inspectFile(p, false, false)
	}
	a.mu.Lock()
	now := time.Now().Unix()
	recent := map[string]AutoEvidence{}
	for id, at := range a.recentFiles {
		if at < now-int64(autoRules(a.config).BurstWindowSeconds) {
			delete(a.recentFiles, id)
		} else {
			recent[id] = a.log.Evidence[id]
		}
	}
	if markFileBursts(recent, now, a.config) {
		for id, e := range recent {
			a.log.Evidence[id] = e
		}
		a.dirty = true
		a.scheduleLocked()
	}
	a.mu.Unlock()
}
func (a *AutoCollector) scheduleLocked() {
	if a.closed {
		return
	}
	if a.timer == nil {
		a.timer = time.AfterFunc(45*time.Second, func() { a.flush() })
	}
}
func (a *AutoCollector) flush() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.timer != nil {
		a.timer.Stop()
		a.timer = nil
	}
	if !a.dirty {
		return nil
	}
	if e := os.MkdirAll(filepath.Dir(a.logPath()), 0755); e != nil {
		a.stats.Error = e.Error()
		return e
	}
	a.log.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	e := a.writeMonthlyLogs()
	if e != nil {
		a.stats.Error = e.Error()
		a.scheduleLocked()
		return e
	}
	a.dirty = false
	a.stats.Writes++
	return nil
}
func (a *AutoCollector) close() {
	a.mu.Lock()
	a.closed = true
	if a.stopMonitor != nil {
		a.stopMonitor()
	}
	if a.scanCancel != nil {
		close(a.scanCancel)
		a.scanCancel = nil
	}
	a.mu.Unlock()
	a.flush()
}
func (a *AutoCollector) matchActivity(v AutoActivity, c AutoConfig) string {
	pid, _ := a.matchActivityEvidence(v, c)
	return pid
}
func (a *AutoCollector) matchActivityEvidence(v AutoActivity, c AutoConfig) (string, string) {
	if v.Document != "" {
		if b := matchBinding(v.Document, c); b != nil {
			return b.ProjectID, "document"
		}
	}
	hay := strings.ToLower(v.Title)
	// A known document filename can identify its project without reading the document.
	matched := map[string]bool{}
	for key := range a.log.Index {
		name := strings.ToLower(filepath.Base(key))
		stem := strings.TrimSuffix(name, filepath.Ext(name))
		if len([]rune(stem)) < 3 || !strings.Contains(hay, stem) {
			continue
		}
		for _, b := range c.Bindings {
			if strings.HasPrefix(key, b.ProjectID+"/") && under(strings.TrimPrefix(key, b.ProjectID+"/"), b.Path) {
				matched[b.ProjectID] = true
			}
		}
	}
	if len(matched) == 1 {
		for id := range matched {
			return id, "filename"
		}
	}
	if len(matched) > 1 {
		return "", ""
	}
	var pid string
	for _, b := range c.Bindings {
		name := strings.ToLower(filepath.Base(b.Path))
		if len([]rune(name)) >= 3 && strings.Contains(hay, name) {
			if pid != "" && pid != b.ProjectID {
				return "", ""
			}
			pid = b.ProjectID
		}
	}
	return pid, "folder"
}
func (a *AutoCollector) ingestActivity(v AutoActivity) {
	c, _ := a.configSnapshot()
	if !c.Enabled || !c.Activity {
		return
	}
	now, e := time.Parse(time.RFC3339Nano, v.At)
	if e != nil {
		now = time.Now()
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.stats.ActivitySamples++
	a.stats.TitleAccess = v.TitleAccess
	if !a.activityAt.IsZero() && now.Before(a.activityAt) {
		return
	}
	lastInput := activityLastInput(now, v.IdleSeconds)
	idleConfirmed := v.IdleSeconds >= float64(c.IdleMinutes*60)
	a.reconcileActivityIdleLocked(lastInput, idleConfirmed)
	prev := a.activity
	start := a.activityAt
	a.activity = &v
	a.activityAt = now
	if prev == nil || prev.Paused || prev.IdleSeconds >= float64(c.IdleMinutes*60) {
		return
	}
	elapsed := now.Sub(start).Seconds()
	if elapsed < 1 || elapsed > 150 {
		return
	}
	if idleConfirmed {
		// Once idle is confirmed, the current sample may only retain the
		// portion before the last input; earlier provisional samples are undone above.
		elapsed = min(elapsed, lastInput.Sub(start).Seconds())
	}
	if elapsed <= 0 {
		return
	}
	app := strings.TrimSpace(prev.App)
	if app == "" || strings.Contains(strings.ToLower(app), "项目手记") || app == "Finder" || strings.EqualFold(app, "explorer.exe") {
		return
	}
	pid, basis := a.matchActivityEvidence(*prev, c)
	end := start.Add(time.Duration(elapsed * float64(time.Second)))
	for start.Before(end) {
		local := start.In(time.Local)
		boundary := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, time.Local)
		bucketStart := start.Unix() / 900 * 900
		bucketEnd := time.Unix(bucketStart+900, 0)
		stop := end
		if bucketEnd.Before(stop) {
			stop = bucketEnd
		}
		if boundary.Before(stop) {
			stop = boundary
		}
		date := local.Format("2006-01-02")
		// Keep one app total per quarter-hour, instead of every window switch/span.
		// Project matching above still uses the current title, but titles are not archived.
		if a.log.AppUsage == nil {
			a.log.AppUsage = map[string]AutoAppUsage{}
		}
		key := date + "/" + shortHash(pid+"/"+app)
		item := a.log.AppUsage[key]
		item.Date, item.ProjectID, item.App = date, pid, app
		if item.Slots == nil {
			item.Slots = map[int64]int64{}
		}
		before := item.Slots[bucketStart]
		item.Slots[bucketStart] += int64(stop.Sub(start).Seconds())
		if item.Slots[bucketStart] > 900 {
			item.Slots[bucketStart] = 900
		}
		credited := max(int64(0), item.Slots[bucketStart]-before)
		attributed := int64(0)
		if pid != "" && basis != "" {
			if item.Attribution == nil {
				item.Attribution = map[int64]map[string]int64{}
			}
			if item.Attribution[bucketStart] == nil {
				item.Attribution[bucketStart] = map[string]int64{}
			}
			beforeBasis := item.Attribution[bucketStart][basis]
			item.Attribution[bucketStart][basis] += int64(stop.Sub(start).Seconds())
			if item.Attribution[bucketStart][basis] > 900 {
				item.Attribution[bucketStart][basis] = 900
			}
			attributed = max(int64(0), item.Attribution[bucketStart][basis]-beforeBasis)
		}
		if !idleConfirmed && stop.After(lastInput) && (credited > 0 || attributed > 0) {
			item.Pending = append(item.Pending, AutoActivityPending{Bucket: bucketStart, Start: start.UnixNano(), End: stop.UnixNano(), Seconds: credited, Basis: basis, AttributedSeconds: attributed})
		}
		a.log.AppUsage[key] = item
		start = stop
	}
	a.dirty = true
	a.scheduleLocked()
}
func (a *AutoCollector) logs() []AutoLog { logs, _ := a.logsChecked(); return logs }
func (a *AutoCollector) logsChecked() ([]AutoLog, []string) {
	warnings := []string{}
	a.mu.Lock()
	b, _ := json.Marshal(a.log)
	a.mu.Unlock()
	var own AutoLog
	json.Unmarshal(b, &own)
	logs := []AutoLog{own}
	paths, _ := filepath.Glob(storagePath(a.store.dir, "自动记录", "*.json"))
	monthly, _ := filepath.Glob(storagePath(a.store.dir, "自动记录", "*", "*.json"))
	paths = append(paths, monthly...)
	for _, p := range paths {
		if filepath.Clean(p) == a.logPath() || filepath.Base(filepath.Dir(p)) == a.log.DeviceID {
			continue
		}
		name := strings.TrimSuffix(filepath.Base(p), ".json")
		if filepath.Dir(p) != storagePath(a.store.dir, "自动记录") && name != "索引" && !validDate(name+"-01") {
			continue
		}
		b, e := os.ReadFile(p)
		if e != nil {
			warnings = append(warnings, filepath.Base(p)+" 尚未同步完整")
			continue
		}
		var v AutoLog
		if json.Unmarshal(b, &v) != nil || v.Version != 1 || !validID.MatchString(v.DeviceID) || len(v.Evidence) > 100000 {
			warnings = append(warnings, filepath.Base(p)+" 无法读取")
			continue
		}
		if filepath.Dir(p) == storagePath(a.store.dir, "自动记录") {
			if filepath.Base(p) != v.DeviceID+".json" {
				continue
			}
		} else {
			if filepath.Base(filepath.Dir(p)) != v.DeviceID {
				warnings = append(warnings, "设备线索索引不一致")
				continue
			}
			if name != "索引" {
				valid := true
				for _, entry := range v.Evidence {
					valid = valid && validDate(entry.Date) && strings.HasPrefix(entry.Date, name+"-")
				}
				for _, entry := range v.AppUsage {
					valid = valid && validDate(entry.Date) && strings.HasPrefix(entry.Date, name+"-")
				}
				if !valid {
					warnings = append(warnings, filepath.Base(p)+" 月份不一致")
					continue
				}
			}
		}
		logs = append(logs, v)
	}
	merged := map[string]*AutoLog{}
	for _, l := range logs {
		target := merged[l.DeviceID]
		if target == nil {
			v := emptyAutoLog(l.DeviceID, l.DeviceName)
			target = &v
			merged[l.DeviceID] = target
		}
		mergeAutoLog(target, l)
	}
	ids := make([]string, 0, len(merged))
	for id := range merged {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	result := []AutoLog{}
	for _, id := range ids {
		result = append(result, expandAutoUsage(*merged[id]))
	}
	return result, warnings
}
func autoDrafts(st State, logs []AutoLog, configs ...AutoConfig) []AutoDraft {
	c := AutoConfig{}
	if len(configs) > 0 {
		c = configs[0]
	}
	c = autoRules(c)
	by := map[string]*AutoDraft{}
	projectNames := map[string]string{}
	for _, p := range st.Projects {
		projectNames[p.ID] = projectDisplayName(p)
	}
	merged := map[string]AutoEvidence{}
	devices := map[string]string{}
	edits := map[string]AutoEdit{}
	for _, l := range logs {
		l = expandAutoUsage(l)
		for id, e := range l.Evidence {
			old, ok := merged[id]
			if !ok || (e.Kind == "activity" && e.Seconds > old.Seconds) || (e.Kind == "file" && e.At > old.At) {
				merged[id] = e
				devices[id] = l.DeviceName
			}
		}
		for id, e := range l.Edits {
			if e.At > edits[id].At {
				edits[id] = e
			}
		}
	}
	merged = classifyFileBursts(merged, c)
	reviewedFiles := map[string]map[string]bool{}
	reviewedTime := map[string][]AutoSpan{}
	for id, m := range st.AutoReviewed {
		key := m.SourceKey
		if key == "" {
			if raw, ok := merged[id]; ok && raw.Kind == "file" && raw.Stamp == m.Stamp {
				key = autoSourceKey(raw)
			}
		}
		if strings.HasPrefix(key, "file/") {
			if reviewedFiles[key] == nil {
				reviewedFiles[key] = map[string]bool{}
			}
			reviewedFiles[key][strings.SplitN(id, "/", 2)[0]] = true
		}
		if strings.HasPrefix(key, "activity/") {
			reviewedTime[key] = append(reviewedTime[key], m.Spans...)
		}
	}
	pendingTime := map[string][]AutoSpan{}
	legacyTime := map[string]map[string]int64{}
	fileSeen := map[string]bool{}
	fileTouches := map[string]map[string]AutoFileTouch{}
	bulkFiles := map[string]map[string]bool{}
	for _, e := range merged {
		if !validDate(e.Date) {
			continue
		}
		mark := st.AutoReviewed[e.ID]
		sourceKey := autoSourceKey(e)
		crossReviewed := false
		for device := range reviewedFiles[sourceKey] {
			if device != strings.SplitN(e.ID, "/", 2)[0] {
				crossReviewed = true
			}
		}
		if e.Kind == "file" && (mark.Stamp == e.Stamp || crossReviewed) {
			continue
		}
		var spans []AutoSpan
		var legacy int64
		if e.Kind == "activity" {
			spans, legacy = pendingAutoSpans(e, mark.Seconds)
			spans = subtractAutoSpans(spans, reviewedTime[sourceKey])
			e.Seconds = autoSpanSeconds(spans) + legacy
			if e.Seconds <= 0 {
				continue
			}
		}
		pid := e.ProjectID
		if projectNames[pid] == "" {
			pid = ""
		}
		key := e.Date + "/" + pid
		d := by[key]
		if d == nil {
			d = &AutoDraft{ID: key, Date: e.Date, ProjectID: pid, ProjectName: projectNames[pid], Kind: "none", Evidence: []AutoEvidence{}, Tokens: []AutoToken{}, Devices: []string{}}
			if pid == "" {
				d.ProjectName = "未归类活动"
			}
			by[key] = d
		}
		if e.Kind == "file" {
			if fileTouches[key] == nil {
				fileTouches[key] = map[string]AutoFileTouch{}
			}
			if bulkFiles[key] == nil {
				bulkFiles[key] = map[string]bool{}
			}
			cutoff := int64(0)
			if reviewed, err := time.Parse(time.RFC3339Nano, mark.ReviewedAt); err == nil {
				cutoff = reviewed.Unix()
			}
			for _, touch := range e.Touches {
				if touch.At <= cutoff || touch.At <= 0 || time.Unix(touch.At, 0).In(time.Local).Format("2006-01-02") != e.Date {
					continue
				}
				if touch.Bulk {
					bulkFiles[key][e.RelativePath+"/"+e.Name] = true
					continue
				}
				version := e
				version.Stamp = touch.Stamp
				identity := autoSourceKey(version)
				if old, ok := fileTouches[key][identity]; !ok || touch.At < old.At {
					fileTouches[key][identity] = touch
				}
			}
		}
		if e.Kind != "file" || !fileSeen[sourceKey] {
			d.Evidence = append(d.Evidence, e)
		}
		if e.Kind == "file" {
			fileSeen[sourceKey] = true
		}
		raw := merged[e.ID]
		d.Tokens = append(d.Tokens, AutoToken{ID: e.ID, Stamp: raw.Stamp, Seconds: raw.Seconds, SourceKey: sourceKey, Spans: raw.Spans})
		if e.Kind == "activity" {
			pendingTime[key] = append(pendingTime[key], spans...)
			if legacyTime[key] == nil {
				legacyTime[key] = map[string]int64{}
			}
			deviceID := strings.SplitN(e.ID, "/", 2)[0]
			legacyTime[key][deviceID] += legacy
		}
		device := devices[e.ID]
		if device == "" {
			device = "其他电脑"
		}
		if !containsString(d.Devices, device) {
			d.Devices = append(d.Devices, device)
		}
	}
	result := []AutoDraft{}
	for key, d := range by {
		d.Seconds = autoSpanSeconds(pendingTime[key])
		hasLegacy := false
		for _, legacy := range legacyTime[key] {
			if legacy > 0 {
				hasLegacy = true
			}
			if legacy > d.Seconds {
				d.Seconds = legacy
			}
		}
		sort.Slice(d.Evidence, func(i, j int) bool { return d.Evidence[i].ID < d.Evidence[j].ID })
		sort.Slice(d.Tokens, func(i, j int) bool { return d.Tokens[i].ID < d.Tokens[j].ID })
		b, _ := json.Marshal(d.Tokens)
		d.Digest = shortHash(string(b) + fmt.Sprintf("/rules:%d:%d:%d", c.FileGapMinutes, c.BurstWindowSeconds, c.BurstFiles))
		names := []string{}
		for _, e := range d.Evidence {
			label := "修改 " + e.Name
			if e.Kind == "activity" {
				label = "使用 " + e.App
				if e.Name != e.App {
					label += " · " + e.Name
				}
			}
			if !containsString(names, label) {
				names = append(names, label)
			}
		}
		d.Note = strings.Join(names, "；")
		suggestAutoDraft(d, st, pendingTime[key], fileTouches[key], len(bulkFiles[key]), hasLegacy, c)
		d.CountedSpans = countedAutoSpans(st, d.ProjectID, d.Date)
		for i := range st.Entries {
			if st.Entries[i].ProjectID == d.ProjectID && st.Entries[i].Date == d.Date {
				x := st.Entries[i]
				d.Existing = &x
				break
			}
		}
		if d.Existing != nil && d.Existing.Kind != "none" {
			d.Kind = "none"
			d.Hours = 0
			d.Basis += "；当天已有时长，可选择活动段后累加"
		}
		if edit, ok := edits[d.ID]; ok {
			latestReview := ""
			for _, t := range d.Tokens {
				if r := st.AutoReviewed[t.ID].ReviewedAt; r > latestReview {
					latestReview = r
				}
			}
			if edit.At > latestReview {
				d.Edit = &edit
			}
		}
		result = append(result, *d)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Date == result[j].Date {
			return result[i].ProjectName < result[j].ProjectName
		}
		return result[i].Date < result[j].Date
	})
	return result
}
func containsString(list []string, value string) bool {
	for _, s := range list {
		if s == value {
			return true
		}
	}
	return false
}

func (a *AutoCollector) reconcile() {
	a.mu.Lock()
	if !a.config.Enabled || a.closed || strings.HasPrefix(a.stats.Status, "正在") {
		a.mu.Unlock()
		return
	}
	cancel := make(chan struct{})
	if a.scanCancel != nil {
		close(a.scanCancel)
	}
	a.scanCancel = cancel
	a.stats.Status = "正在核对文件日期"
	a.mu.Unlock()
	go a.scan(false, cancel)
}
func (a *AutoCollector) saveEdit(edit AutoEdit) error {
	if len(edit.Note) > 20000 || len(edit.ID) > 500 || edit.Hours < 0 || edit.Hours > 24 {
		return errors.New("草稿编辑无效")
	}
	a.store.mu.Lock()
	st, _, err := a.store.read()
	a.store.mu.Unlock()
	if err != nil {
		return err
	}
	found := false
	config, _ := a.configSnapshot()
	for _, d := range autoDrafts(st, a.logs(), config) {
		if d.ID == edit.ID {
			found = true
			break
		}
	}
	if !found {
		return errAutoChanged
	}
	edit.At = time.Now().UTC().Format(time.RFC3339Nano)
	a.mu.Lock()
	a.log.Edits[edit.ID] = edit
	a.dirty = true
	a.mu.Unlock()
	return a.flush()
}

// Expand compact counters only for API/legacy calculations; never write derived evidence back.
func expandAutoUsage(log AutoLog) AutoLog {
	if len(log.AppUsage) == 0 {
		return log
	}
	copyEvidence := make(map[string]AutoEvidence, len(log.Evidence))
	for id, e := range log.Evidence {
		copyEvidence[id] = e
	}
	log.Evidence = copyEvidence
	for _, usage := range log.AppUsage {
		if !validDate(usage.Date) || usage.App == "" {
			continue
		}
		for bucket, seconds := range usage.Slots {
			if seconds <= 0 || seconds > 900 || bucket <= 0 {
				continue
			}
			id := log.DeviceID + "/" + usage.Date + "/app-summary-" + shortHash(fmt.Sprint(bucket)+"/"+usage.ProjectID+"/"+usage.App)
			log.Evidence[id] = AutoEvidence{ID: id, Date: usage.Date, ProjectID: usage.ProjectID, Kind: "activity", Name: usage.App, App: usage.App, BucketStart: bucket, Seconds: seconds, Stamp: fmt.Sprint(seconds), At: time.Unix(bucket, 0).UTC().Format(time.RFC3339Nano), Source: "前台应用占比", Attribution: usage.Attribution[bucket]}
		}
	}
	return log
}
