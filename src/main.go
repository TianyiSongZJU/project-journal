package main

import (
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed web/*
var assets embed.FS

type Project struct {
	Group     string     `json:"group,omitempty"`
	ID        string     `json:"id"`
	CreatedAt string     `json:"createdAt,omitempty"`
	UpdatedAt string     `json:"updatedAt,omitempty"`
	Name      string     `json:"name"`
	Color     string     `json:"color"`
	Note      string     `json:"note"`
	Completed bool       `json:"completed"`
	Deadlines []Deadline `json:"deadlines"`
}
type Deadline struct {
	Note     string `json:"note,omitempty"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Date     string `json:"date"`
	Priority string `json:"priority"`
	Done     bool   `json:"done"`
}
type Entry struct {
	OtherKind  string  `json:"otherKind,omitempty"`
	OtherHours float64 `json:"otherHours,omitempty"`
	ProjectID  string  `json:"projectId"`
	Date       string  `json:"date"`
	Kind       string  `json:"kind"`
	Hours      float64 `json:"hours"`
	Note       string  `json:"note"`
}
type AppAliasGroup struct {
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"`
}
type Settings struct {
	AppAliases             *[]AppAliasGroup    `json:"appAliases,omitempty"`
	ProjectPaletteVersion  int                 `json:"projectPaletteVersion,omitempty"`
	DistributionGroupYear  *bool               `json:"distributionGroupYear,omitempty"`
	DistributionGroupMonth *bool               `json:"distributionGroupMonth,omitempty"`
	ProjectGroups          []string            `json:"projectGroups,omitempty"`
	Estimates              map[string]*float64 `json:"estimates"`
	ShowMonthProjects      bool                `json:"showMonthProjects,omitempty"`
	ProjectSort            string              `json:"projectSort,omitempty"`
}
type State struct {
	TimelineRead map[string]string      `json:"timelineRead,omitempty"`
	TimelineDays map[string]TimelineDay `json:"timelineDays,omitempty"`
	AutoReviewed map[string]AutoMark    `json:"autoReviewed,omitempty"`
	History      *ChangeHistory         `json:"history,omitempty"`
	Version      int                    `json:"version"`
	Projects     []Project              `json:"projects"`
	Entries      []Entry                `json:"entries"`
	Settings     Settings               `json:"settings"`
}
type Envelope struct {
	Revision   string     `json:"revision"`
	State      State      `json:"state"`
	DataPath   string     `json:"dataPath,omitempty"`
	SyncCopies []SyncCopy `json:"syncCopies,omitempty"`
}
type Store struct {
	mu  sync.Mutex
	dir string
}

var nativeClose = func() {}
var uiOnly bool
var showLaunchError = func(message string) { log.Print(message) }

func fatalLaunch(e error) { showLaunchError(e.Error()); os.Exit(1) }

var validID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
var validColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func emptyState() State {
	return State{Version: 1, Projects: []Project{}, Entries: []Entry{}, Settings: Settings{Estimates: map[string]*float64{"很短": nil, "短": nil, "中": nil, "长": nil, "很长": nil}}}
}
func validDate(s string) bool {
	d, e := time.Parse("2006-01-02", s)
	return e == nil && d.Format("2006-01-02") == s && d.Year() >= 1900 && d.Year() <= 2200
}
func validate(s State) error {
	for date, stamp := range s.TimelineRead {
		if !validDate(date) || len(stamp) != 64 {
			return errors.New("历史日期已读标记无效")
		}
	}
	for date, day := range s.TimelineDays {
		if !validDate(date) {
			return errors.New("时间线日期无效")
		}
		if err := validateTimelineBlocks(day.Blocks, s.Projects, false); err != nil {
			return err
		}
		if err := validateTimelineBlocks(day.Applied, s.Projects, false); err != nil {
			return err
		}
	}

	if s.Version != 1 {
		return errors.New("无法读取此数据版本，请使用匹配的软件版本")
	}
	if len(s.Projects) > 10000 || len(s.Entries) > 1000000 {
		return errors.New("记录数量超出限制")
	}
	ids := map[string]bool{}
	ds := map[string]bool{}
	if len(s.Settings.ProjectGroups) > 500 {
		return errors.New("分组数量过多")
	}
	groups := map[string]bool{}
	for _, g := range s.Settings.ProjectGroups {
		if strings.TrimSpace(g) == "" || len(g) > 240 || groups[g] {
			return errors.New("分组名称不能为空、重复或过长")
		}
		groups[g] = true
	}
	if s.Settings.AppAliases != nil {
		if len(*s.Settings.AppAliases) > 100 {
			return errors.New("应用名称分组数量过多")
		}
		used := map[string]bool{}
		for _, group := range *s.Settings.AppAliases {
			if strings.TrimSpace(group.Name) == "" || len([]rune(group.Name)) > 120 || len(group.Aliases) > 50 {
				return errors.New("应用名称合并设置无效")
			}
			own := map[string]bool{}
			for _, name := range append([]string{group.Name}, group.Aliases...) {
				key := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(name)), ".exe")
				if key == "" || len([]rune(name)) > 120 || used[key] {
					return errors.New("应用名称不能为空、过长或出现在多个分组")
				}
				own[key] = true
			}
			for key := range own {
				used[key] = true
			}
		}
	}
	for _, p := range s.Projects {
		if len(p.Group) > 240 {
			return errors.New("项目分组名称过长")
		}
		if !validID.MatchString(p.ID) || ids[p.ID] || strings.TrimSpace(p.Name) == "" || len(p.Name) > 500 || !validColor.MatchString(p.Color) {
			return errors.New("项目名称、颜色或编号无效")
		}
		ids[p.ID] = true
		for _, d := range p.Deadlines {
			if !validID.MatchString(d.ID) || ds[d.ID] || strings.TrimSpace(d.Name) == "" || !validDate(d.Date) || (d.Priority != "高" && d.Priority != "中" && d.Priority != "低") {
				return errors.New("截止节点的名称、日期、编号或优先级无效")
			}
			ds[d.ID] = true
		}
	}
	keys := map[string]bool{}
	for _, e := range s.Entries {
		key := e.ProjectID + "/" + e.Date
		if !ids[e.ProjectID] || !validDate(e.Date) || keys[key] {
			return errors.New("每日记录的项目或日期无效，或同一项目当天有重复记录")
		}
		keys[key] = true
		if e.OtherKind != "" {
			if e.OtherKind != "none" && e.OtherKind != "hours" && e.OtherKind != "很短" && e.OtherKind != "短" && e.OtherKind != "中" && e.OtherKind != "长" && e.OtherKind != "很长" {
				return errors.New("其他已记时长类型无效")
			}
			if math.IsNaN(e.OtherHours) || math.IsInf(e.OtherHours, 0) || e.OtherHours < 0 || e.OtherHours > 24 || (e.OtherKind != "hours" && e.OtherHours != 0) {
				return errors.New("其他已记时长无效")
			}
		}
		if e.Kind != "none" && e.Kind != "hours" && e.Kind != "短" && e.Kind != "中" && e.Kind != "长" && e.Kind != "很短" && e.Kind != "很长" {
			return errors.New("未知时长类型")
		}
		if math.IsNaN(e.Hours) || math.IsInf(e.Hours, 0) || e.Hours < 0 || e.Hours > 24 || (e.Kind != "hours" && e.Hours != 0) {
			return errors.New("每天每个项目的精确时长需介于 0 至 24 小时，概括记录不能同时包含精确小时")
		}
	}
	for k, v := range s.Settings.Estimates {
		if k != "短" && k != "中" && k != "长" && k != "很短" && k != "很长" {
			return errors.New("未知估算类型")
		}
		if v != nil && (math.IsNaN(*v) || math.IsInf(*v, 0) || *v < 0 || *v > 24) {
			return errors.New("估算小时需介于 0 至 24 小时")
		}
	}
	return nil
}
func revision(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func (s *Store) read() (State, string, error) {
	if e := s.recoverTransaction(); e != nil {
		return State{}, "", e
	}
	b, e := os.ReadFile(storagePath(s.dir, "项目手记.json"))
	if os.IsNotExist(e) {
		for _, dir := range []string{"笔记", "时间记录"} {
			paths, _ := filepath.Glob(storagePath(s.dir, dir, "*.json"))
			if len(paths) > 0 {
				return State{}, "", errors.New("主数据文件尚未同步完整，已停止写入")
			}
		}
		return emptyState(), "new", nil
	}
	if e != nil {
		return State{}, "", e
	}
	st, e := s.readDiskBytes(b, false)
	if e != nil {
		return State{}, "", fmt.Errorf("数据无法完整读取，原文件已保留：%w", e)
	}
	if st.History == nil {
		st.History = s.historyFromBackups(st)
	}
	return st, revision(b), nil
}
func atomicWrite(path string, b []byte) error {
	f, e := os.CreateTemp(filepath.Dir(path), ".journal-save-*")
	if e != nil {
		return e
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(tmp, path); e != nil {
		return e
	}
	return nil
}

var errConflict = errors.New("数据已被其他页面或同步更新。请先导出当前编辑内容，再重新载入核对")

func (s *Store) save(st State, base string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(st, base)
}
func (s *Store) saveLocked(st State, base string) (string, error) {
	return s.saveWithHistoryLocked(st, base, nil)
}
func (s *Store) saveWithHistoryLocked(st State, base string, history *ChangeHistory) (string, error) {
	if e := validate(st); e != nil {
		return "", e
	}
	previous, rev, e := s.read()
	if e != nil {
		return "", e
	}
	if rev != base {
		return "", errConflict
	}
	if e = os.MkdirAll(s.dir, 0755); e != nil {
		return "", e
	}
	if rev != "new" {
		if e = s.backupState(previous); e != nil {
			return "", fmt.Errorf("备份失败，本次未保存：%w", e)
		}
	}
	if history == nil {
		history = appendHistory(previous, st)
	}
	st.History = history
	nextRev, e := s.commitDisk(st, rev)
	if e != nil {
		return "", e
	}
	backups, _ := filepath.Glob(storagePath(s.dir, "备份", "*.json"))
	sort.Strings(backups)
	if len(backups) > 60 {
		for _, p := range backups[:len(backups)-60] {
			os.Remove(p)
		}
	}
	return nextRev, nil
}
func openURL(address string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", address)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", address)
	default:
		cmd = exec.Command("xdg-open", address)
	}
	if e := cmd.Start(); e != nil {
		log.Println("请手动打开", address)
	}
}

type Session struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func main() {
	flag.BoolVar(&uiOnly, "ui-only", false, "只打开界面，复用后台采集")
	parentPID := flag.Int("parent-pid", 0, "原生宿主进程退出时停止服务")
	autoDir := flag.String("auto-home", "", "本机自动记录设置目录，测试时可覆盖")
	dataDir := flag.String("data-dir", "", "数据文件夹")
	noOpen := flag.Bool("no-open", false, "不自动打开浏览器")
	port := flag.Int("port", 0, "本地端口，0 为自动分配")
	windowURL := flag.Bool("window-url", false, "输出独立窗口地址")
	flag.Parse()
	exe, e := os.Executable()
	if e != nil {
		fatalLaunch(e)
	}
	base := filepath.Dir(exe)
	if strings.HasSuffix(strings.ToLower(base), "macos") {
		base = filepath.Clean(filepath.Join(base, "..", "..", ".."))
	}
	if *dataDir == "" {
		*dataDir = defaultDataDir(base)
	}
	*dataDir, _ = filepath.Abs(*dataDir)
	if e = ensureStorageLayout(*dataDir); e != nil {
		fatalLaunch(e)
	}
	store := &Store{dir: *dataDir}
	if _, _, e = store.read(); e != nil {
		fatalLaunch(e)
	}
	pathHash := sha256.Sum256([]byte(*dataDir))
	sessionPath := filepath.Join(os.TempDir(), fmt.Sprintf("project-journal-%x.json", pathHash[:12]))
	if b, e := os.ReadFile(sessionPath); e == nil {
		var existing Session
		if json.Unmarshal(b, &existing) == nil {
			client := http.Client{Timeout: time.Second}
			req, _ := http.NewRequest("GET", existing.URL+"/api/ping", nil)
			if req != nil {
				req.Header.Set("X-Journal-Token", existing.Token)
				if res, e := client.Do(req); e == nil {
					body, _ := io.ReadAll(io.LimitReader(res.Body, 200))
					res.Body.Close()
					if res.StatusCode == 200 && string(body) == "project-journal-v1" {
						if *windowURL {
							fmt.Println(existing.URL + "/?token=" + existing.Token)
							for {
								time.Sleep(time.Second)
								if response, err := client.Do(req); err != nil {
									return
								} else {
									response.Body.Close()
									if response.StatusCode != 200 {
										return
									}
								}
							}
						}
						if !*noOpen {
							runWindow(existing.URL + "/?token=" + existing.Token)
						}
						fmt.Println(existing.URL)
						return
					}
				}
			}
		}
	}
	listener, e := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", *port))
	if e != nil {
		fatalLaunch(e)
	}
	address := "http://" + listener.Addr().String()
	if e = store.migrateStorage(); e != nil {
		fatalLaunch(e)
	}
	collector, autoErr := newAutoCollector(store, autoHome(store.dir, *autoDir))
	if autoErr != nil {
		fatalLaunch(autoErr)
	}
	currentAuto = collector
	collector.restart()
	defer collector.close()
	random := make([]byte, 32)
	if _, e = rand.Read(random); e != nil {
		fatalLaunch(e)
	}
	token := hex.EncodeToString(random)
	session := Session{URL: address, Token: token}
	b, _ := json.Marshal(session)
	if e = os.WriteFile(sessionPath, b, 0600); e != nil {
		fatalLaunch(e)
	}
	defer os.Remove(sessionPath)
	var seenMu sync.Mutex
	lastSeen := time.Now()
	touch := func() { seenMu.Lock(); lastSeen = time.Now(); seenMu.Unlock() }
	mux := http.NewServeMux()
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	stopParent := watchParent(*parentPID, func() { server.Close() })
	defer stopParent()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	doneSignals := make(chan struct{})
	defer close(doneSignals)
	go func() {
		select {
		case <-signals:
			server.Close()
			nativeClose()
		case <-doneSignals:
		}
	}()
	jsonOut := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(v)
	}
	fail := func(w http.ResponseWriter, msg string, status int) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": msg})
	}
	files, _ := fs.Sub(assets, "web")
	static := http.FileServer(http.FS(files))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
		if r.Host != listener.Addr().String() {
			http.Error(w, "Invalid host", 403)
			return
		}
		if r.URL.Path == "/" && r.URL.Query().Get("token") == token {
			http.SetCookie(w, &http.Cookie{Name: "journal_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		cookie, _ := r.Cookie("journal_session")
		if r.Header.Get("X-Journal-Token") != token && (cookie == nil || cookie.Value != token) {
			http.Error(w, "请双击启动程序打开项目手记。", 403)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != address {
			http.Error(w, "Invalid origin", 403)
			return
		}
		touch()
		if collector.handle(w, r) {
			return
		}
		switch r.URL.Path {
		case "/api/ping":
			io.WriteString(w, "project-journal-v1")
		case "/api/state":
			switch r.Method {
			case "GET":
				store.mu.Lock()
				st, rev, e := store.read()
				store.mu.Unlock()
				if e != nil {
					fail(w, e.Error(), 500)
					return
				}
				jsonOut(w, Envelope{Revision: rev, State: st, DataPath: store.dir, SyncCopies: store.syncCopies()})
			case "PUT":
				var req Envelope
				dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<20))
				dec.DisallowUnknownFields()
				if e := dec.Decode(&req); e != nil {
					fail(w, "提交的数据格式无效", 400)
					return
				}
				var extra any
				if dec.Decode(&extra) != io.EOF {
					fail(w, "提交包含多余数据", 400)
					return
				}
				rev, e := store.save(req.State, req.Revision)
				if e != nil {
					code := 400
					if errors.Is(e, errConflict) {
						code = 409
					}
					fail(w, e.Error(), code)
					return
				}
				store.mu.Lock()
				saved, _, _ := store.read()
				store.mu.Unlock()
				jsonOut(w, map[string]any{"revision": rev, "history": saved.History})
			default:
				w.WriteHeader(405)
			}

		case "/api/history":
			if r.Method != "POST" {
				w.WriteHeader(405)
				return
			}
			var req struct {
				Revision string `json:"revision"`
				Cursor   int    `json:"cursor"`
			}
			if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); e != nil {
				fail(w, "历史操作格式无效", 400)
				return
			}
			st, rev, e := store.restoreHistory(req.Revision, req.Cursor)
			if e != nil {
				code := 400
				if errors.Is(e, errConflict) {
					code = 409
				}
				fail(w, e.Error(), code)
				return
			}
			jsonOut(w, Envelope{Revision: rev, State: st, DataPath: store.dir, SyncCopies: store.syncCopies()})

		case "/api/storage/expand":
			if r.Method != "POST" {
				w.WriteHeader(405)
				return
			}
			raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<20))
			if e != nil {
				fail(w, "备份文件过大或无法读取", 400)
				return
			}
			st, e := store.readDiskBytes(raw, true)
			if e != nil {
				fail(w, e.Error(), 400)
				return
			}
			jsonOut(w, st)
		case "/api/sync-copies":
			if r.Method != "GET" {
				w.WriteHeader(405)
				return
			}
			jsonOut(w, store.syncCopies())
		case "/api/sync-copy":
			if r.Method != "GET" {
				w.WriteHeader(405)
				return
			}
			name := r.URL.Query().Get("name")
			found := false
			for _, c := range store.syncCopies() {
				if c.Name == name {
					found = true
					break
				}
			}
			if !found {
				fail(w, "找不到同步副本", 404)
				return
			}
			b, e := os.ReadFile(storagePath(store.dir, name))
			if e != nil {
				fail(w, e.Error(), 400)
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Write(b)
		case "/api/resolve-copy":
			if r.Method != "POST" {
				w.WriteHeader(405)
				return
			}
			var req struct {
				Name           string `json:"name"`
				Revision       string `json:"revision"`
				SourceRevision string `json:"sourceRevision"`
				Adopt          bool   `json:"adopt"`
			}
			if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); e != nil {
				fail(w, "请求无效", 400)
				return
			}
			rev, e := store.resolveCopy(req.Name, req.SourceRevision, req.Revision, req.Adopt)
			if e != nil {
				code := 400
				if errors.Is(e, errConflict) {
					code = 409
				}
				fail(w, e.Error(), code)
				return
			}
			jsonOut(w, map[string]string{"revision": rev})
		case "/api/quit":
			if r.Method != "POST" {
				w.WriteHeader(405)
				return
			}
			jsonOut(w, map[string]bool{"ok": true})
			go func() { time.Sleep(150 * time.Millisecond); server.Close(); nativeClose() }()
		default:
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.NotFound(w, r)
				return
			}
			if r.Method != "GET" && r.Method != "HEAD" {
				w.WriteHeader(405)
				return
			}
			static.ServeHTTP(w, r)
		}
	})
	if *noOpen && !*windowURL {
		go func() {
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				seenMu.Lock()
				idle := time.Since(lastSeen)
				seenMu.Unlock()
				cfg, _ := collector.configSnapshot()
				if idle > 5*time.Minute && !cfg.Enabled {
					server.Close()
					return
				}
			}
		}()
	}
	if *windowURL {
		fmt.Println(address + "/?token=" + url.QueryEscape(token))
	}
	fmt.Println("项目手记已启动：", address)
	fmt.Println("数据位置：", store.dir)
	if *noOpen {
		if e = server.Serve(listener); e != nil && !errors.Is(e, http.ErrServerClosed) {
			fatalLaunch(e)
		}
	} else {
		go func() {
			if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Println(err)
			}
		}()
		runWindow(address + "/?token=" + url.QueryEscape(token))
		server.Close()
	}
}
