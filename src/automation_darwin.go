package main

import (
	"os"
	"sync"
	"syscall"
	"time"
)

func startAutoPlatform(a *AutoCollector, c AutoConfig) func() { return func() {} }
func fileCreationTime(info os.FileInfo) time.Time {
	if s, ok := info.Sys().(*syscall.Stat_t); ok {
		return time.Unix(s.Birthtimespec.Sec, s.Birthtimespec.Nsec)
	}
	return time.Time{}
}

func watchParent(pid int, stop func()) func() {
	if pid <= 0 {
		return func() {}
	}
	fd, err := syscall.Kqueue()
	if err != nil {
		return func() {}
	}
	event := syscall.Kevent_t{Ident: uint64(pid), Filter: syscall.EVFILT_PROC, Flags: syscall.EV_ADD | syscall.EV_ONESHOT, Fflags: syscall.NOTE_EXIT}
	if _, err = syscall.Kevent(fd, []syscall.Kevent_t{event}, nil, nil); err != nil {
		syscall.Close(fd)
		go stop()
		return func() {}
	}
	var once sync.Once
	closeFD := func() { once.Do(func() { syscall.Close(fd) }) }
	go func() {
		events := make([]syscall.Kevent_t, 1)
		if n, e := syscall.Kevent(fd, nil, events, nil); e == nil && n > 0 {
			stop()
		}
		closeFD()
	}()
	return closeFD
}
