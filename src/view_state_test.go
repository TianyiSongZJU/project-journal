package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalViewStatePersistsWithoutBusinessData(t *testing.T) {
	home := t.TempDir()
	handler := localViewStateHandler(home)
	call := func(method, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler(w, httptest.NewRequest(method, "/api/view-state", strings.NewReader(body)))
		return w
	}
	if w := call("GET", ""); w.Code != 200 || strings.TrimSpace(w.Body.String()) != "{}" {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := call("PUT", `{"page":"auto","timeline":{"visibleHours":8},"date":"2026-10-25"}`); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	restored := httptest.NewRecorder()
	localViewStateHandler(home)(restored, httptest.NewRequest("GET", "/api/view-state", nil))
	if !strings.Contains(restored.Body.String(), `"page":"auto"`) {
		t.Fatal(restored.Body.String())
	}
	if w := call("PUT", "[]"); w.Code != 400 {
		t.Fatal("reject non-object", w.Code)
	}
	if w := call("PUT", `{"large":"`+strings.Repeat("x", 33<<10)+`"}`); w.Code != 400 {
		t.Fatal("reject oversized view", w.Code)
	}
	if w := call("DELETE", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatal(w.Code)
	}
	other := httptest.NewRecorder()
	localViewStateHandler(t.TempDir())(other, httptest.NewRequest("GET", "/api/view-state", nil))
	if strings.TrimSpace(other.Body.String()) != "{}" {
		t.Fatal("device preferences leaked")
	}
	if err := os.WriteFile(filepath.Join(home, "view-state.json"), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if w := call("GET", ""); strings.TrimSpace(w.Body.String()) != "{}" {
		t.Fatal("corrupt preferences must not block app startup")
	}
}
