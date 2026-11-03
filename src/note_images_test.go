package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNoteImages(t *testing.T) {
	dir := t.TempDir()
	handler := noteImageHandler(dir)
	png := append([]byte{137, 80, 78, 71, 13, 10, 26, 10}, make([]byte, 32)...)
	post := func(body []byte) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler(w, httptest.NewRequest("POST", "/api/note-images", bytes.NewReader(body)))
		return w
	}
	w := post(png)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var saved map[string]string
	json.Unmarshal(w.Body.Bytes(), &saved)
	if !noteImageName.MatchString(filepath.Base(saved["url"])) {
		t.Fatal(saved)
	}
	again := post(png)
	if again.Body.String() != w.Body.String() {
		t.Fatal("image names are not stable")
	}
	files, _ := os.ReadDir(filepath.Join(dir, "images"))
	if len(files) != 1 {
		t.Fatal("duplicate files")
	}
	read := httptest.NewRecorder()
	handler(read, httptest.NewRequest("GET", saved["url"], nil))
	if read.Code != 200 || !bytes.Equal(read.Body.Bytes(), png) {
		t.Fatal("image not readable")
	}
	if post([]byte("<svg onload='alert(1)'></svg>")).Code != http.StatusUnsupportedMediaType {
		t.Fatal("active image accepted")
	}
	if post(make([]byte, noteImageLimit+1)).Code != 413 {
		t.Fatal("size limit")
	}
	for _, path := range []string{"/api/note-images/../项目手记.json", "/api/note-images/secret.png"} {
		w := httptest.NewRecorder()
		handler(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 404 {
			t.Fatal(path, w.Code)
		}
	}
}
