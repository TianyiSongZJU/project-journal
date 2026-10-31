package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

// User allocations are independent of the collector's evidence and survive review/restart.
// Applied is the last explicitly confirmed allocation, used to update only its delta.
type TimelineBlock struct {
	ID        string `json:"id"`
	Start     int    `json:"start"`
	End       int    `json:"end"`
	ProjectID string `json:"projectId"`
}
type TimelineDay struct {
	Blocks  []TimelineBlock `json:"blocks"`
	Applied []TimelineBlock `json:"applied"`
}
type TimelineRequest struct {
	Revision string          `json:"revision"`
	Date     string          `json:"date"`
	Blocks   []TimelineBlock `json:"blocks"`
	Apply    bool            `json:"apply"`
}

func validateTimelineBlocks(blocks []TimelineBlock, projects []Project, checkProjects bool) error {
	if len(blocks) > 96 {
		return errors.New("一天最多保留 96 个时间段")
	}
	ids := map[string]bool{}
	known := map[string]bool{}
	for _, p := range projects {
		known[p.ID] = true
	}
	list := append([]TimelineBlock(nil), blocks...)
	sort.Slice(list, func(i, j int) bool { return list[i].Start < list[j].Start })
	end := 0
	for _, b := range list {
		if b.ID == "" || len(b.ID) > 100 || ids[b.ID] || b.Start < 0 || b.End > 1440 || b.End <= b.Start || b.Start%15 != 0 || b.End%15 != 0 || b.Start < end {
			return errors.New("时间段需按 15 分钟对齐，且不能重叠")
		}
		if checkProjects && b.ProjectID != "" && !known[b.ProjectID] {
			return errors.New("所选项目已不存在，请重新分配")
		}
		ids[b.ID] = true
		end = b.End
	}
	return nil
}
func timelineTotals(blocks []TimelineBlock) map[string]int {
	totals := map[string]int{}
	for _, b := range blocks {
		if b.ProjectID != "" {
			totals[b.ProjectID] += b.End - b.Start
		}
	}
	return totals
}
func (a *AutoCollector) saveTimeline(req TimelineRequest) (State, string, error) {
	if !validDate(req.Date) {
		return State{}, "", errors.New("日期无效")
	}
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	st, rev, err := a.store.read()
	if err != nil {
		return State{}, "", err
	}
	if rev != req.Revision {
		return State{}, "", errConflict
	}
	if err = validateTimelineBlocks(req.Blocks, st.Projects, true); err != nil {
		return State{}, "", err
	}
	if st.TimelineDays == nil {
		st.TimelineDays = map[string]TimelineDay{}
	}
	old := st.TimelineDays[req.Date]
	day := TimelineDay{Blocks: append([]TimelineBlock{}, req.Blocks...), Applied: old.Applied}
	sort.Slice(day.Blocks, func(i, j int) bool { return day.Blocks[i].Start < day.Blocks[j].Start })
	if req.Apply {
		before, after := timelineTotals(old.Applied), timelineTotals(day.Blocks)
		projects := map[string]bool{}
		for p := range before {
			projects[p] = true
		}
		for p := range after {
			projects[p] = true
		}
		for pid := range projects {
			delta := float64(after[pid]-before[pid]) / 60
			if delta == 0 {
				continue
			}
			index := -1
			for i, e := range st.Entries {
				if e.ProjectID == pid && e.Date == req.Date {
					index = i
					break
				}
			}
			hours := 0.0
			if index >= 0 {
				var known bool
				hours, known = autoEntryHours(st, st.Entries[index])
				if !known {
					return State{}, "", errors.New("已有五档未配置估算小时，请先配置再计入时间线")
				}
			}
			if hours+1e-8 < float64(before[pid])/60 {
				return State{}, "", errors.New("当天时长已小于原先计入的时间线，请先核对手动记录，再调整选区")
			}

			other := Entry{Kind: "none"}
			if index >= 0 {
				other = timelineOtherEntry(st, st.Entries[index], float64(before[pid])/60)
			}
			base, known := autoEntryHours(st, other)
			if !known {
				return State{}, "", errors.New("请先配置其他已记的五档估算小时")
			}
			next := base + float64(after[pid])/60
			if next > 24+1e-8 {
				return State{}, "", errors.New("计入后超过 24 小时，请核对已有记录")
			}
			if index < 0 && next > 0 {
				st.Entries = append(st.Entries, Entry{ProjectID: pid, Date: req.Date})
				index = len(st.Entries) - 1
			}
			if index >= 0 {
				entry := &st.Entries[index]
				entry.Kind, entry.Hours = other.Kind, other.Hours
				entry.OtherKind, entry.OtherHours = "", 0
				if after[pid] > 0 {
					entry.OtherKind, entry.OtherHours = other.Kind, other.Hours
					entry.Kind, entry.Hours = "hours", math.Max(0, next)
				}
				if entry.Kind == "none" && entry.Note == "" {
					st.Entries = append(st.Entries[:index], st.Entries[index+1:]...)
				}
			}
			for i := range st.Projects {
				if st.Projects[i].ID == pid {
					st.Projects[i].UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
				}
			}
		}
		day.Applied = []TimelineBlock{}
		for _, b := range day.Blocks {
			if b.ProjectID != "" {
				day.Applied = append(day.Applied, b)
			}
		}
	}
	st.TimelineDays[req.Date] = day
	rev, err = a.store.saveLocked(st, req.Revision)
	if err != nil {
		return State{}, "", err
	}
	st, _, err = a.store.read()
	return st, rev, err
}
func (a *AutoCollector) handleTimeline(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		// Include confirmed evidence too: it remains useful when adjusting the evening allocation.
		logs, warnings := a.logsChecked()
		c, _ := a.configSnapshot()
		merged := map[string]AutoEvidence{}
		devices := map[string]string{}
		deviceIDs := map[string]string{}
		for _, log := range logs {
			for id, e := range log.Evidence {
				merged[id] = e
				devices[id] = log.DeviceName
				deviceIDs[id] = log.DeviceID
			}
		}
		merged = classifyFileBursts(merged, c)
		type timelineEvidence struct {
			AutoEvidence
			DeviceName string `json:"deviceName"`
			DeviceID   string `json:"deviceId"`
		}
		list := []timelineEvidence{}
		for _, e := range merged {
			if validDate(e.Date) {
				list = append(list, timelineEvidence{e, devices[e.ID], deviceIDs[e.ID]})
			}
		}
		sort.Slice(list, func(i, j int) bool {
			if list[i].Date == list[j].Date {
				return list[i].ID < list[j].ID
			}
			return list[i].Date < list[j].Date
		})
		stamps := map[string]string{}
		grouped := map[string][]AutoEvidence{}
		for _, e := range list {
			grouped[e.Date] = append(grouped[e.Date], e.AutoEvidence)
		}
		for date, items := range grouped {
			raw, _ := json.Marshal(items)
			sum := sha256.Sum256(raw)
			stamps[date] = hex.EncodeToString(sum[:])
		}
		if today := r.URL.Query().Get("reminders"); today != "" {
			if !validDate(today) {
				autoFail(w, errors.New("日期无效"), 400)
				return
			}
			end, _ := time.Parse("2006-01-02", today)
			start := end.AddDate(0, 0, -7).Format("2006-01-02")
			a.store.mu.Lock()
			st, _, err := a.store.read()
			a.store.mu.Unlock()
			if err != nil {
				autoFail(w, err, 500)
				return
			}
			recent := []timelineEvidence{}
			days := map[string]TimelineDay{}
			read := map[string]string{}
			recentStamps := map[string]string{}
			for _, item := range list {
				if item.Date >= start && item.Date < today {
					recent = append(recent, item)
					days[item.Date] = st.TimelineDays[item.Date]
					read[item.Date] = st.TimelineRead[item.Date]
					recentStamps[item.Date] = stamps[item.Date]
				}
			}
			ids := []string{}
			for _, project := range st.Projects {
				ids = append(ids, project.ID)
			}
			var engine strings.Builder
			for _, file := range []string{"auto-timeline.js", "time-suggestions.js", "suggestion-history.js"} {
				source, err := assets.ReadFile("web/" + file)
				if err != nil {
					autoFail(w, err, 500)
					return
				}
				for _, line := range strings.Split(string(source), "\n") {
					if strings.HasPrefix(line, "import ") {
						continue
					}
					engine.WriteString(strings.ReplaceAll(line, "export ", ""))
					engine.WriteByte('\n')
				}
			}
			autoJSON(w, map[string]any{"evidence": recent, "timelineDays": days, "timelineRead": read, "dateStamps": recentStamps, "projectIds": ids, "rules": c.SuggestionRules, "gapMinutes": c.FileGapMinutes, "start": start, "end": today, "engine": engine.String(), "warnings": warnings})
			return
		}
		autoJSON(w, map[string]any{"evidence": list, "dateStamps": stamps, "warnings": warnings})
		return
	}
	if r.Method != "PUT" {
		w.WriteHeader(405)
		return
	}
	var req TimelineRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		autoFail(w, fmt.Errorf("时间线格式无效"), 400)
		return
	}
	st, rev, err := a.saveTimeline(req)
	if err != nil {
		code := 400
		if errors.Is(err, errConflict) {
			code = 409
		}
		autoFail(w, err, code)
		return
	}
	autoJSON(w, Envelope{Revision: rev, State: st, DataPath: a.store.dir})
}

// Review markers acknowledge evidence without changing allocations or recorded hours.
type TimelineReviewRequest struct {
	Revision string            `json:"revision"`
	Dates    map[string]string `json:"dates"`
}

func (a *AutoCollector) saveTimelineReview(req TimelineReviewRequest) (State, string, error) {
	if len(req.Dates) == 0 || len(req.Dates) > 366 {
		return State{}, "", errors.New("每次请选择 1–366 个日期")
	}
	for date, stamp := range req.Dates {
		if !validDate(date) {
			return State{}, "", errors.New("日期无效")
		}
		if stamp != "" {
			b, e := hex.DecodeString(stamp)
			if e != nil || len(b) != 32 {
				return State{}, "", errors.New("线索标记无效")
			}
		}
	}
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	st, rev, err := a.store.read()
	if err != nil {
		return st, rev, err
	}
	if rev != req.Revision {
		return st, rev, errConflict
	}
	if st.TimelineRead == nil {
		st.TimelineRead = map[string]string{}
	}
	for date, stamp := range req.Dates {
		if stamp == "" {
			delete(st.TimelineRead, date)
		} else {
			st.TimelineRead[date] = stamp
		}
	}
	rev, err = a.store.saveLocked(st, req.Revision)
	if err != nil {
		return State{}, "", err
	}
	st, _, err = a.store.read()
	return st, rev, err
}
func (a *AutoCollector) handleTimelineReview(w http.ResponseWriter, r *http.Request) {
	if r.Method != "PUT" {
		w.WriteHeader(405)
		return
	}
	var req TimelineReviewRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<17))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		autoFail(w, errors.New("日期标记格式无效"), 400)
		return
	}
	st, rev, err := a.saveTimelineReview(req)
	if err != nil {
		code := 400
		if errors.Is(err, errConflict) {
			code = 409
		}
		autoFail(w, err, code)
		return
	}
	autoJSON(w, Envelope{Revision: rev, State: st, DataPath: a.store.dir})
}

// Older files only stored the total; infer the editable remainder once, without changing that total.
func timelineOtherEntry(st State, e Entry, applied float64) Entry {
	if e.OtherKind != "" {
		e.Kind, e.Hours = e.OtherKind, e.OtherHours
		return e
	}
	if applied > 0 {
		total, _ := autoEntryHours(st, e)
		e.Kind, e.Hours = "hours", math.Max(0, total-applied)
	}
	return e
}
