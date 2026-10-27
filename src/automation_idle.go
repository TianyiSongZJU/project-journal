package main

import (
	"math"
	"time"
)

// Activity counters remain provisional until another input confirms a short pause.
// Keep only the credited portions needed to undo an idle grace window. These
// contain no window titles or document paths, and persist with the same monthly
// counters so a restart cannot leave a confirmed idle window charged forever.
type AutoActivityPending struct {
	Bucket            int64  `json:"bucket"`
	Start             int64  `json:"start"`
	End               int64  `json:"end"`
	Seconds           int64  `json:"seconds"`
	Basis             string `json:"basis,omitempty"`
	AttributedSeconds int64  `json:"attributedSeconds,omitempty"`
}

func activityLastInput(now time.Time, idle float64) time.Time {
	if math.IsNaN(idle) || idle <= 0 {
		return now
	}
	if math.IsInf(idle, 1) || idle >= float64(math.MaxInt64)/float64(time.Second) {
		return time.Time{}
	}
	return now.Add(-time.Duration(idle * float64(time.Second)))
}

// Must hold a.mu. Only this device's provisional automatic evidence is changed;
// user allocations, confirmed notes/hours, and other devices are independent.
func (a *AutoCollector) reconcileActivityIdleLocked(lastInput time.Time, confirmed bool) {
	changed := false
	for key, usage := range a.log.AppUsage {
		if len(usage.Pending) == 0 {
			continue
		}
		kept := make([]AutoActivityPending, 0, len(usage.Pending))
		for _, part := range usage.Pending {
			if !time.Unix(0, part.End).After(lastInput) {
				changed = true
				continue
			}
			if !confirmed {
				kept = append(kept, part)
				continue
			}
			preserved := int64(0)
			if lastInput.After(time.Unix(0, part.Start)) {
				preserved = int64(lastInput.Sub(time.Unix(0, part.Start)) / time.Second)
			}
			remove := part.Seconds - min(part.Seconds, preserved)
			if remove > 0 {
				usage.Slots[part.Bucket] = max(int64(0), usage.Slots[part.Bucket]-remove)
				if usage.Slots[part.Bucket] == 0 {
					delete(usage.Slots, part.Bucket)
				}
			}
			attributed := part.AttributedSeconds - min(part.AttributedSeconds, preserved)
			if attributed > 0 && usage.Attribution[part.Bucket] != nil {
				by := usage.Attribution[part.Bucket]
				by[part.Basis] = max(int64(0), by[part.Basis]-attributed)
				if by[part.Basis] == 0 {
					delete(by, part.Basis)
				}
				if len(by) == 0 {
					delete(usage.Attribution, part.Bucket)
				}
			}
			changed = true
		}
		usage.Pending = kept
		// Keep an empty usage row as a monthly tombstone: the storage partition must
		// rewrite that month even when its last observed seconds were all idle.
		a.log.AppUsage[key] = usage
	}
	if changed {
		a.dirty = true
		a.scheduleLocked()
	}
}
