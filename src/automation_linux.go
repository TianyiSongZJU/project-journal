package main

import (
	"os"
	"time"
)

func startAutoPlatform(a *AutoCollector, c AutoConfig) func() { return func() {} }
func fileCreationTime(info os.FileInfo) time.Time             { return time.Time{} }

func watchParent(pid int, stop func()) func() { return func() {} }
