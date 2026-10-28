package main

// The macOS .app provides the native WKWebView window and runs this backend
// with --no-open. Direct execution remains useful for diagnostics.
func runWindow(address string) { openURL(address); select {} }
