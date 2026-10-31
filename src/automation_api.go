package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"strings"
	"time"
)

func autoJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}
func autoFail(w http.ResponseWriter, e error, code int) {
	w.WriteHeader(code)
	autoJSON(w, map[string]string{"error": e.Error()})
}
func (a *AutoCollector) handle(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.URL.Path, "/api/auto") {
		return false
	}
	switch r.URL.Path {
	case "/api/auto/timeline/review":
		a.handleTimelineReview(w, r)
	case "/api/auto/timeline":
		a.handleTimeline(w, r)
	case "/api/auto/day-summary":
		if r.Method != "GET" {
			w.WriteHeader(405)
			return true
		}
		date := r.URL.Query().Get("date")
		if !validDate(date) {
			autoFail(w, errors.New("日期无效"), 400)
			return true
		}
		a.store.mu.Lock()
		st, _, err := a.store.read()
		a.store.mu.Unlock()
		if err != nil {
			autoFail(w, err, 500)
			return true
		}
		hours, estimated, missing := dailyMenuHours(st, date)
		autoJSON(w, map[string]any{"date": date, "hours": hours, "estimatedHours": estimated, "missing": missing})
	case "/api/auto/status":
		if r.Method != "GET" {
			w.WriteHeader(405)
			return true
		}
		c, cr := a.configSnapshot()
		a.mu.Lock()
		stats := a.stats
		a.mu.Unlock()
		autoJSON(w, map[string]any{"config": c, "configRevision": cr, "stats": effectiveAutoStats(c, stats), "platform": runtime.GOOS})
	case "/api/auto":
		if r.Method != "GET" {
			w.WriteHeader(405)
			return true
		}
		a.store.mu.Lock()
		st, rev, e := a.store.read()
		a.store.mu.Unlock()
		if e != nil {
			autoFail(w, e, 500)
			return true
		}
		c, cr := a.configSnapshot()
		a.mu.Lock()
		stats := a.stats
		a.mu.Unlock()
		autoJSON(w, map[string]any{"config": c, "configRevision": cr, "drafts": autoDrafts(st, a.logs(), c), "stats": effectiveAutoStats(c, stats), "revision": rev, "deviceId": a.log.DeviceID, "platform": runtime.GOOS})
	case "/api/auto/config":
		if r.Method != "PUT" {
			w.WriteHeader(405)
			return true
		}
		var req struct {
			Config   AutoConfig `json:"config"`
			Revision string     `json:"revision"`
		}
		if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); e != nil {
			autoFail(w, e, 400)
			return true
		}
		if e := a.saveConfig(req.Config, req.Revision); e != nil {
			code := 400
			if errors.Is(e, errConflict) {
				code = 409
			}
			autoFail(w, e, code)
			return true
		}
		c, cr := a.configSnapshot()
		autoJSON(w, map[string]any{"config": c, "configRevision": cr})
	case "/api/auto/scan":
		if r.Method != "POST" {
			w.WriteHeader(405)
			return true
		}
		c, _ := a.configSnapshot()
		if len(c.Bindings) == 0 {
			autoFail(w, errors.New("先给项目绑定资料文件夹"), 400)
			return true
		}
		a.mu.Lock()
		if strings.HasPrefix(a.stats.Status, "正在") {
			a.mu.Unlock()
			autoFail(w, errors.New("正在核对文件，请稍候"), 409)
			return true
		}
		cancel := make(chan struct{})
		if a.scanCancel != nil {
			close(a.scanCancel)
		}
		a.scanCancel = cancel
		a.stats.Status = "正在核对文件日期"
		a.mu.Unlock()
		go a.scan(true, cancel)
		autoJSON(w, map[string]bool{"ok": true})
	case "/api/auto/edit":
		if r.Method != "POST" {
			w.WriteHeader(405)
			return true
		}
		var edit AutoEdit
		if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&edit); e != nil {
			autoFail(w, e, 400)
			return true
		}
		if e := a.saveEdit(edit); e != nil {
			autoFail(w, e, 409)
		} else {
			autoJSON(w, map[string]bool{"ok": true})
		}
	case "/api/auto/events":
		if r.Method != "POST" {
			w.WriteHeader(405)
			return true
		}
		var req struct {
			Reconcile bool          `json:"reconcile"`
			Paths     []string      `json:"paths"`
			Activity  *AutoActivity `json:"activity"`
			Status    string        `json:"status"`
			Error     string        `json:"error"`
			Watching  *int          `json:"watching"`
		}
		if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&req); e != nil || len(req.Paths) > 4096 {
			autoFail(w, errors.New("采集事件无效"), 400)
			return true
		}
		if req.Reconcile {
			a.reconcile()
		}
		if len(req.Paths) > 0 {
			a.ingestPaths(req.Paths)
		}
		if req.Activity != nil {
			a.ingestActivity(*req.Activity)
		}
		if req.Status != "" || req.Error != "" || req.Watching != nil {
			a.mu.Lock()
			if req.Status != "" {
				a.stats.Status = req.Status
			}
			a.stats.Error = req.Error
			if req.Watching != nil {
				a.stats.Watching = *req.Watching
			}
			a.mu.Unlock()
		}
		autoJSON(w, map[string]bool{"ok": true})
	case "/api/auto/flush":
		if r.Method != "POST" {
			w.WriteHeader(405)
			return true
		}
		if e := a.flush(); e != nil {
			autoFail(w, e, 500)
		} else {
			autoJSON(w, map[string]bool{"ok": true})
		}
	case "/api/auto/review":
		if r.Method != "POST" {
			w.WriteHeader(405)
			return true
		}
		var req AutoReviewRequest
		if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&req); e != nil {
			autoFail(w, e, 400)
			return true
		}
		st, rev, e := a.review(req)
		if e != nil {
			code := 400
			if errors.Is(e, errConflict) || errors.Is(e, errAutoChanged) {
				code = 409
			}
			autoFail(w, e, code)
			return true
		}
		autoJSON(w, Envelope{Revision: rev, State: st, DataPath: a.store.dir})
	default:
		http.NotFound(w, r)
	}
	return true
}

type AutoReviewItem struct {
	SelectedSessions *[]int  `json:"selectedSessions,omitempty"`
	AddTime          bool    `json:"addTime,omitempty"`
	ID               string  `json:"id"`
	Digest           string  `json:"digest"`
	ProjectID        string  `json:"projectId"`
	Kind             string  `json:"kind"`
	Hours            float64 `json:"hours"`
	Note             *string `json:"note"`
	Ignore           bool    `json:"ignore"`
	ReplaceTime      bool    `json:"replaceTime"`
}
type AutoReviewRequest struct {
	Revision string           `json:"revision"`
	Items    []AutoReviewItem `json:"items"`
}

var errAutoChanged = errors.New("草稿刚有新活动，请刷新后核对再确认")

func appendAutoNote(old, note string) string {
	add := []string{}
	for _, part := range strings.FieldsFunc(note, func(r rune) bool { return r == '；' || r == '\n' }) {
		part = strings.TrimSpace(part)
		if part != "" && !strings.Contains(old, part) && !containsString(add, part) {
			add = append(add, part)
		}
	}
	if len(add) == 0 {
		return old
	}
	if strings.TrimSpace(old) == "" {
		return strings.Join(add, "；")
	}
	return old + "\n" + strings.Join(add, "；")
}
func (a *AutoCollector) review(req AutoReviewRequest) (State, string, error) {
	if len(req.Items) == 0 || len(req.Items) > 500 {
		return State{}, "", errors.New("一次请选择 1 至 500 条草稿")
	}
	logs := a.logs()
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	st, rev, e := a.store.read()
	if e != nil {
		return State{}, "", e
	}
	if rev != req.Revision {
		return State{}, "", errConflict
	}
	config, _ := a.configSnapshot()
	drafts := autoDrafts(st, logs, config)
	lookup := map[string]AutoDraft{}
	for _, d := range drafts {
		lookup[d.ID] = d
	}
	if st.AutoReviewed == nil {
		st.AutoReviewed = map[string]AutoMark{}
	}
	seen := map[string]bool{}
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	for _, item := range req.Items {
		d, ok := lookup[item.ID]
		if !ok || d.Digest != item.Digest || seen[item.ID] {
			return State{}, "", errAutoChanged
		}
		seen[item.ID] = true
		var counted []AutoSpan
		countedProject := item.ProjectID
		if countedProject == "" {
			countedProject = d.ProjectID
		}
		if !item.Ignore {
			pid := item.ProjectID
			if pid == "" {
				pid = d.ProjectID
			}
			pi := -1
			for i, p := range st.Projects {
				if p.ID == pid {
					pi = i
					break
				}
			}
			if pi < 0 {
				return State{}, "", errors.New("请为未归类活动选择一个项目")
			}
			kind := item.Kind
			if kind == "" {
				kind = d.Kind
			}
			hours := 0.0
			if kind == "hours" {
				hours = item.Hours
			}
			if item.SelectedSessions != nil {
				covered := countedAutoSpans(st, pid, d.Date)
				counted, e = selectedAutoSpans(d, *item.SelectedSessions, covered)
				if e != nil {
					return State{}, "", e
				}
				seconds := autoSpanSeconds(counted)
				kind, hours = "none", 0
				if seconds > 0 {
					kind, hours = "hours", float64(seconds)/3600
				}
			}
			note := d.Note
			if item.Note != nil {
				note = *item.Note
			}
			found := -1
			for i, e := range st.Entries {
				if e.ProjectID == pid && e.Date == d.Date {
					found = i
					break
				}
			}
			if found < 0 {
				if kind != "none" || strings.TrimSpace(note) != "" {
					st.Entries = append(st.Entries, Entry{ProjectID: pid, Date: d.Date, Kind: kind, Hours: hours, Note: note})
				}
			} else {
				entry := &st.Entries[found]
				appliedHours := float64(timelineTotals(st.TimelineDays[d.Date].Applied)[pid]) / 60
				other := timelineOtherEntry(st, *entry, appliedHours)
				entry.Kind, entry.Hours = other.Kind, other.Hours
				entry.Note = appendAutoNote(entry.Note, note)
				if (item.AddTime || item.SelectedSessions != nil) && !item.ReplaceTime && kind != "none" {
					oldHours, known := autoEntryHours(st, *entry)
					if !known {
						return State{}, "", errors.New("已有五档尚未配置估算小时，请先配置或选择替换时长")
					}
					addition, known := autoEntryHours(st, Entry{Kind: kind, Hours: hours})
					if !known {
						return State{}, "", errors.New("请先配置五档估算小时")
					}
					if oldHours+addition > 24 {
						return State{}, "", errors.New("累加后超过一天 24 小时，请重新选择活动段")
					}
					entry.Kind, entry.Hours = "hours", oldHours+addition
				}
				if item.ReplaceTime {
					if kind == "none" {
						return State{}, "", errors.New("要替换已有时长，请先选择五档或填写小时")
					}
					entry.Kind = kind
					entry.Hours = hours
				}
				entry.OtherKind, entry.OtherHours = "", 0
				if appliedHours > 0 {
					base, known := autoEntryHours(st, *entry)
					if !known {
						return State{}, "", errors.New("请先配置其他已记的估算小时")
					}
					if base+appliedHours > 24 {
						return State{}, "", errors.New("其他已记加时间线超过 24 小时")
					}
					entry.OtherKind, entry.OtherHours = entry.Kind, entry.Hours
					entry.Kind, entry.Hours = "hours", base+appliedHours
				}

			}
			st.Projects[pi].UpdatedAt = stamp
		}

		if len(counted) > 0 {
			key := "timeline/" + d.Date + "/" + countedProject
			previous := st.AutoReviewed[key]
			st.AutoReviewed[key] = AutoMark{CountedProject: countedProject, CountedDate: d.Date, CountedSpans: mergeAutoSpans(append(previous.CountedSpans, counted...)), Decision: "accept", ReviewedAt: stamp}
		}
		for _, t := range d.Tokens {
			decision := "accept"
			if item.Ignore {
				decision = "ignore"
			}
			st.AutoReviewed[t.ID] = AutoMark{Stamp: t.Stamp, Seconds: t.Seconds, Decision: decision, ReviewedAt: stamp, SourceKey: t.SourceKey, Spans: t.Spans}
		}
	}
	if e = validate(st); e != nil {
		return State{}, "", e
	}
	rev, e = a.store.saveLocked(st, req.Revision)
	if e != nil {
		return State{}, "", e
	}
	saved, _, e := a.store.read()
	return saved, rev, e
}
func autoStatus(a *AutoCollector, status string, e error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.stats.Status = status
	if e != nil {
		a.stats.Error = fmt.Sprint(e)
	}
}

func effectiveAutoStats(c AutoConfig, s AutoStats) AutoStats {
	if !c.Enabled {
		s.Status = "已暂停"
		s.Watching = 0
		s.Error = ""
		return s
	}
	if len(c.Bindings) == 0 {
		s.Status = "待绑定资料夹"
		s.Watching = 0
		return s
	}
	if s.Error != "" {
		s.Status = "监听异常"
		return s
	}
	if strings.HasPrefix(s.Status, "正在") {
		return s
	}
	if s.Watching == 0 {
		s.Status = "正在启动监听"
	} else {
		s.Status = "监听中"
	}
	return s
}

// Match the all-project daily total in the UI; entries already include applied timelines.
func dailyMenuHours(st State, date string) (total, estimated float64, missing int) {
	for _, entry := range st.Entries {
		if entry.Date != date {
			continue
		}
		hours, ok := autoEntryHours(st, entry)
		if !ok {
			missing++
			continue
		}
		total += hours
		if entry.Kind != "hours" && entry.Kind != "none" {
			estimated += hours
		}
	}
	return
}
