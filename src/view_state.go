package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// Window position is local to this device and is not part of synchronized records.
func localViewStateHandler(home string) http.HandlerFunc {
	var mu sync.Mutex
	path := filepath.Join(home, "view-state.json")
	return func(w http.ResponseWriter, r *http.Request) {
		write := func(value any) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(value)
		}
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case http.MethodGet:
			b, err := os.ReadFile(path)
			var value map[string]json.RawMessage
			if err != nil || json.Unmarshal(b, &value) != nil || value == nil {
				write(map[string]any{})
				return
			}
			write(value)
		case http.MethodPut:
			b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<10))
			var value map[string]json.RawMessage
			if err != nil || json.Unmarshal(b, &value) != nil || value == nil {
				http.Error(w, "界面位置格式无效", 400)
				return
			}
			b, _ = json.Marshal(value)
			if err = os.MkdirAll(home, 0755); err == nil {
				err = atomicWrite(path, b)
			}
			if err != nil {
				http.Error(w, "界面位置尚未保存", 500)
				return
			}
			write(map[string]bool{"ok": true})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}
