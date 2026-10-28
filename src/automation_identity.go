package main

import (
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type AutoSpan struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

func mergeAutoSpans(list []AutoSpan) []AutoSpan {
	list = append([]AutoSpan{}, list...)
	sort.Slice(list, func(i, j int) bool { return list[i].Start < list[j].Start })
	out := []AutoSpan{}
	for _, s := range list {
		if s.End <= s.Start {
			continue
		}
		n := len(out)
		if n > 0 && s.Start <= out[n-1].End {
			if s.End > out[n-1].End {
				out[n-1].End = s.End
			}
		} else {
			out = append(out, s)
		}
	}
	return out
}
func autoSpanSeconds(list []AutoSpan) int64 {
	var n int64
	for _, s := range mergeAutoSpans(list) {
		n += s.End - s.Start
	}
	return n
}
func subtractAutoSpans(list, covered []AutoSpan) []AutoSpan {
	result := []AutoSpan{}
	covers := mergeAutoSpans(covered)
	for _, s := range mergeAutoSpans(list) {
		cursor := s.Start
		for _, c := range covers {
			if c.End <= cursor {
				continue
			}
			if c.Start >= s.End {
				break
			}
			if c.Start > cursor {
				result = append(result, AutoSpan{cursor, c.Start})
			}
			if c.End > cursor {
				cursor = c.End
			}
			if cursor >= s.End {
				break
			}
		}
		if cursor < s.End {
			result = append(result, AutoSpan{cursor, s.End})
		}
	}
	return result
}

// Skip the already-reviewed chronological prefix; old cumulative-only data is kept conservative.
func pendingAutoSpans(e AutoEvidence, reviewed int64) ([]AutoSpan, int64) {
	known := autoSpanSeconds(e.Spans)
	legacy := e.Seconds - known
	if legacy < 0 {
		legacy = 0
	}
	remainingLegacy := legacy - reviewed
	if remainingLegacy < 0 {
		remainingLegacy = 0
	}
	skip := reviewed - legacy
	if skip < 0 {
		skip = 0
	}
	out := []AutoSpan{}
	for _, s := range mergeAutoSpans(e.Spans) {
		length := s.End - s.Start
		if skip >= length {
			skip -= length
			continue
		}
		s.Start += skip
		skip = 0
		out = append(out, s)
	}
	return out, remainingLegacy
}
func autoSourceKey(e AutoEvidence) string {
	if e.Kind == "activity" {
		return "activity/" + e.Date + "/" + e.ProjectID
	}
	rel := e.RelativePath
	if rel == "" {
		rel = e.Name
	}
	rel = strings.ToLower(strings.ReplaceAll(rel, "\\", "/"))
	parts := strings.Split(e.Stamp, ":")
	stamp := e.Stamp
	if len(parts) == 2 {
		if ns, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
			stamp = strconv.FormatInt(ns/1000000000, 10) + ":" + parts[1]
		}
	}
	return "file/" + shortHash(e.ProjectID+"/"+e.Date+"/"+rel+"/"+stamp)
}
func defaultAutoExtensions() []string {
	return []string{"ppt", "pptx", "pptm", "doc", "docx", "docm", "md", "markdown", "pdf", "txt", "tex", "xls", "xlsx"}
}
func restoreDocumentDefaults(c *AutoConfig) bool {
	if c.FileTypesDefaultsVersion >= 2 {
		return false
	}
	full := normalizedAutoExtensions(allAutoExtensions())
	same := func(values []string) bool {
		values = normalizedAutoExtensions(values)
		if len(values) != len(full) {
			return false
		}
		set := map[string]bool{}
		for _, v := range values {
			set[v] = true
		}
		for _, v := range full {
			if !set[v] {
				return false
			}
		}
		return true
	}
	if same(c.Extensions) {
		c.Extensions = defaultAutoExtensions()
	}
	if c.ProjectExtensions == nil && len(c.Bindings) > 0 {
		c.ProjectExtensions = map[string][]string{}
		for _, b := range c.Bindings {
			c.ProjectExtensions[b.ProjectID] = defaultAutoExtensions()
		}
	}
	for pid, values := range c.ProjectExtensions {
		if same(values) {
			c.ProjectExtensions[pid] = defaultAutoExtensions()
		}
	}
	c.FileTypesDefaultsVersion = 2
	return true
}
func allAutoExtensions() []string {
	return []string{"ppt", "pptx", "pptm", "doc", "docx", "docm", "md", "markdown", "pdf", "txt", "tex", "xls", "xlsx", "xlsm", "csv", "py", "ipynb", "r", "jl", "js", "jsx", "ts", "tsx", "html", "css", "scss", "vue", "svelte", "json", "yaml", "yml", "toml", "xml", "sql", "sh", "go", "rs", "c", "h", "cpp", "hpp", "java", "kt", "swift", "m", "mm", "png", "jpg", "jpeg", "svg", "webp", "psd", "ai"}
}
func normalizedAutoExtensions(values []string) []string {
	aliases := map[string][]string{"word": {"doc", "docx", "docm"}, "powerpoint": {"ppt", "pptx", "pptm"}, "excel": {"xls", "xlsx", "xlsm"}}
	seen := map[string]bool{}
	result := []string{}
	for _, v := range values {
		v = strings.ToLower(strings.TrimSpace(v))
		v = strings.TrimPrefix(v, "*.")
		v = strings.TrimPrefix(v, ".")
		group := aliases[v]
		if group == nil {
			group = []string{v}
		}
		for _, ext := range group {
			if ext != "" && !seen[ext] {
				seen[ext] = true
				result = append(result, ext)
			}
		}
	}
	return result
}
func allowedAutoFile(path string, c AutoConfig) bool {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(path)), ".")
	list := c.Extensions
	if binding := matchBinding(path, c); binding != nil {
		if values, ok := c.ProjectExtensions[binding.ProjectID]; ok {
			list = values
		} else if c.ProjectExtensions != nil {
			list = defaultAutoExtensions()
		}
	}
	if list == nil {
		list = defaultAutoExtensions()
	}
	for _, v := range list {
		if ext == v {
			return true
		}
	}
	return false
}
