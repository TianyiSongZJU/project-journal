package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// File observations are evidence of saves, not measurements of work time.
func autoRules(c AutoConfig) AutoConfig {
	if c.FileGapMinutes == 0 {
		c.FileGapMinutes = 15
	}
	if c.BurstWindowSeconds == 0 {
		c.BurstWindowSeconds = 30
	}
	if c.BurstFiles == 0 {
		c.BurstFiles = 12
	}
	return c
}

type AutoSession struct {
	Spans   []AutoSpan `json:"spans"`
	Start   int64      `json:"start"`
	End     int64      `json:"end"`
	Source  string     `json:"source"`
	Seconds int64      `json:"seconds"`
}

func appendFileTouch(list []AutoFileTouch, touch AutoFileTouch) []AutoFileTouch {
	if len(list) > 0 && list[len(list)-1].Stamp == touch.Stamp {
		return list
	}
	list = append(list, touch)
	// Bound per-file daily metadata, without a timer or additional directory scans.
	if len(list) > 512 {
		list = append([]AutoFileTouch(nil), list[len(list)-512:]...)
	}
	return list
}

func markFileBursts(evidence map[string]AutoEvidence, now int64, configs ...AutoConfig) bool {
	c := AutoConfig{}
	if len(configs) > 0 {
		c = configs[0]
	}
	c = autoRules(c)
	window := int64(c.BurstWindowSeconds)
	projects := map[string]map[string]bool{}
	for _, e := range evidence {
		if e.Kind != "file" {
			continue
		}
		for _, t := range e.Touches {
			if t.At > now || t.At < now-window {
				continue
			}
			if projects[e.ProjectID] == nil {
				projects[e.ProjectID] = map[string]bool{}
			}
			projects[e.ProjectID][e.Path] = true
		}
	}
	changed := false
	for id, e := range evidence {
		if e.Kind != "file" || len(projects[e.ProjectID]) < c.BurstFiles {
			continue
		}
		for i, t := range e.Touches {
			if t.At <= now && t.At >= now-window && !t.Bulk {
				e.Touches[i].Bulk = true
				changed = true
			}
		}
		evidence[id] = e
	}
	return changed
}

func fileSessions(touches map[string]AutoFileTouch, gapMinutes int) []AutoSession {
	times := []int64{}
	for _, t := range touches {
		if !t.Bulk {
			times = append(times, t.At)
		}
	}
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	result := []AutoSession{}
	for _, at := range times {
		n := len(result)
		if n == 0 || at-result[n-1].End > int64(gapMinutes*60) {
			result = append(result, AutoSession{Start: at, End: at, Source: "file"})
			continue
		}
		result[n-1].End = at
	}
	for i := range result {
		result[i].Seconds = result[i].End - result[i].Start
		if result[i].Seconds > 0 {
			result[i].Spans = []AutoSpan{{Start: result[i].Start, End: result[i].End}}
		}
	}
	return result
}

func foregroundSessions(spans []AutoSpan) []AutoSession {
	result := []AutoSession{}
	for _, s := range mergeAutoSpans(spans) {
		n := len(result)
		if n > 0 && s.Start-result[n-1].End <= 5*60 {
			result[n-1].End = s.End
			result[n-1].Seconds += s.End - s.Start
			result[n-1].Spans = append(result[n-1].Spans, s)
		} else {
			result = append(result, AutoSession{Start: s.Start, End: s.End, Source: "activity", Seconds: s.End - s.Start, Spans: []AutoSpan{s}})
		}
	}
	return result
}

func nearestAutoKind(st State, minutes float64) string {
	best, kind := math.Inf(1), "none"
	for _, k := range []string{"很短", "短", "中", "长", "很长"} {
		if h := st.Settings.Estimates[k]; h != nil {
			if delta := math.Abs(*h*60 - minutes); delta < best {
				best, kind = delta, k
			}
		}
	}
	return kind
}

func suggestAutoDraft(d *AutoDraft, st State, foreground []AutoSpan, touches map[string]AutoFileTouch, bulk int, legacy bool, configs ...AutoConfig) {
	c := AutoConfig{}
	if len(configs) > 0 {
		c = configs[0]
	}
	c = autoRules(c)
	d.Sessions = foregroundSessions(foreground)
	files := fileSessions(touches, c.FileGapMinutes)
	d.Sessions = append(d.Sessions, files...)
	sort.Slice(d.Sessions, func(i, j int) bool { return d.Sessions[i].Start < d.Sessions[j].Start })
	d.BulkFiles = bulk
	d.Confidence = "不足"
	d.Kind = "none"
	if d.Seconds > 0 {
		minutes := float64(d.Seconds) / 60
		d.Confidence = "较强"
		d.RangeMin = int(math.Max(0, math.Floor((minutes-5)/5)*5))
		d.RangeMax = int(math.Min(24*60, math.Ceil((minutes+5)/5)*5))
		d.Kind = nearestAutoKind(st, minutes)
		d.Hours = float64(d.Seconds) / 3600
		d.Basis = fmt.Sprintf("前台活跃约 %d 分钟；重叠时段去重，短暂切换合并展示，空闲不补算", int(math.Round(minutes)))
		if legacy {
			d.Basis += "；旧版累计取保守值"
		}
	} else {
		var span int64
		segments := 0
		for _, s := range files {
			if s.Seconds >= 120 {
				span += s.Seconds
				segments++
			}
		}
		if segments > 0 {
			minutes := float64(span) / 60
			d.Confidence = "较弱"
			d.RangeMin = int(math.Max(5, math.Floor(minutes*.5/5)*5))
			d.RangeMax = int(math.Ceil((minutes+float64(segments)*10)/5) * 5)
			// Cap a daily suggestion; it remains an editable, explicitly weak reference.
			if d.RangeMax > 24*60 {
				d.RangeMax = 24 * 60
			}
			if d.RangeMin > d.RangeMax {
				d.RangeMin = d.RangeMax
			}
			d.Kind = nearestAutoKind(st, float64(d.RangeMin+d.RangeMax)/2)
			d.Basis = fmt.Sprintf("文件活动 %d 段，修改跨度约 %d 分钟；参考 %d–%d 分钟，保存间隔不等于实际投入", segments, int(math.Round(minutes)), d.RangeMin, d.RangeMax)
		} else if len(touches) == 1 {
			d.Basis = "仅一次保存，无法判断投入时长"
		} else if len(touches) > 1 {
			d.Basis = "仅零散或密集保存，尚不足以推断投入时长"
		} else {
			d.Basis = "仅有文件日期，无法还原活动过程，时长待确认"
		}
	}
	if bulk > 0 {
		d.Basis += fmt.Sprintf("；%d 个文件可能为复制／同步，相关变化不计入时长建议", bulk)
	}
	if d.RangeMax > 0 && d.Kind == "none" {
		d.Basis += "；未配置五档估算，请自行选择时长"
	}
}

// Recompute pending evidence with current rules, so changing thresholds takes effect immediately.
// Sort once, then slide a distinct-file window; merge flagged ranges without quadratic marking.
func classifyFileBursts(evidence map[string]AutoEvidence, c AutoConfig) map[string]AutoEvidence {
	type observation struct {
		id, path string
		index    int
		at       int64
	}
	groups := map[string][]observation{}
	result := make(map[string]AutoEvidence, len(evidence))
	for id, e := range evidence {
		if e.Kind == "file" {
			e.Touches = append([]AutoFileTouch(nil), e.Touches...)
			for i, t := range e.Touches {
				e.Touches[i].Bulk = false
				device := strings.SplitN(e.ID, "/", 2)[0]
				group := device + "/" + e.Date + "/" + e.ProjectID
				path := e.RelativePath
				if path == "" {
					path = e.Name
				}
				groups[group] = append(groups[group], observation{id: id, path: strings.ToLower(path), index: i, at: t.At})
			}
		}
		result[id] = e
	}
	for _, list := range groups {
		sort.Slice(list, func(i, j int) bool { return list[i].at < list[j].at })
		counts := map[string]int{}
		left := 0
		ranges := [][2]int{}
		for right, o := range list {
			counts[o.path]++
			for left <= right && o.at-list[left].at > int64(c.BurstWindowSeconds) {
				counts[list[left].path]--
				if counts[list[left].path] == 0 {
					delete(counts, list[left].path)
				}
				left++
			}
			if len(counts) >= c.BurstFiles {
				n := len(ranges)
				if n > 0 && left <= ranges[n-1][1]+1 {
					ranges[n-1][1] = right
				} else {
					ranges = append(ranges, [2]int{left, right})
				}
			}
		}
		for _, r := range ranges {
			for i := r[0]; i <= r[1]; i++ {
				o := list[i]
				e := result[o.id]
				e.Touches[o.index].Bulk = true
				result[o.id] = e
			}
		}
	}
	return result
}

// Counted project intervals survive changes in file/app evidence and cross-device sync.
func countedAutoSpans(st State, project, date string) []AutoSpan {
	var spans []AutoSpan
	for _, mark := range st.AutoReviewed {
		if mark.CountedProject == project && mark.CountedDate == date {
			spans = append(spans, mark.CountedSpans...)
		}
	}
	return mergeAutoSpans(spans)
}
func selectedAutoSpans(d AutoDraft, indices []int, covered []AutoSpan) ([]AutoSpan, error) {
	var spans []AutoSpan
	seen := map[int]bool{}
	for _, index := range indices {
		if index < 0 || index >= len(d.Sessions) || seen[index] {
			return nil, fmt.Errorf("活动段选择无效，请刷新后重选")
		}
		seen[index] = true
		spans = append(spans, d.Sessions[index].Spans...)
	}
	return subtractAutoSpans(mergeAutoSpans(spans), covered), nil
}
func autoEntryHours(st State, entry Entry) (float64, bool) {
	if entry.Kind == "hours" {
		return entry.Hours, true
	}
	if entry.Kind == "none" {
		return 0, true
	}
	if h := st.Settings.Estimates[entry.Kind]; h != nil {
		return *h, true
	}
	return 0, false
}
