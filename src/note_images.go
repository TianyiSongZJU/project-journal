package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const noteImageLimit = 12 << 20

var noteImageName = regexp.MustCompile(`^[a-f0-9]{64}\.(png|jpg|gif|webp)$`)

// Called only inside the authenticated, same-origin application handler.
func noteImageHandler(root string) http.HandlerFunc { return (&Store{dir: root}).noteImageHandler() }

func (s *Store) noteImageHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		folder := filepath.Join(s.dir, "images")
		if r.URL.Path == "/api/note-images" {
			if r.Method != "POST" {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, noteImageLimit))
			if err != nil {
				http.Error(w, "图片不能超过 12 MB", 413)
				return
			}
			kind := http.DetectContentType(body)
			ext := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}[kind]
			if ext == "" {
				http.Error(w, "请选择 PNG、JPEG、GIF 或 WebP 图片", 415)
				return
			}
			s.mu.Lock()
			defer s.mu.Unlock()
			sum := sha256.Sum256(body)
			name := hex.EncodeToString(sum[:]) + "." + ext
			if err = os.MkdirAll(folder, 0755); err == nil {
				err = atomicWrite(filepath.Join(folder, name), body)
			}
			if err != nil {
				http.Error(w, "图片保存失败，请检查数据目录", 500)
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			json.NewEncoder(w).Encode(map[string]string{"url": "/api/note-images/" + name})
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/api/note-images/")
		if !noteImageName.MatchString(name) {
			http.NotFound(w, r)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			w.WriteHeader(405)
			return
		}
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeFile(w, r, filepath.Join(folder, name))
	}
}
