#!/bin/sh
set -eu
JOURNAL_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
JOURNAL_GO=${JOURNAL_GO:-go}
cd "$JOURNAL_ROOT/src"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$JOURNAL_GO" build -mod=vendor -trimpath -ldflags='-s -w -H windowsgui' -o "$JOURNAL_ROOT/项目手记-Windows.exe.next" .
mv -f "$JOURNAL_ROOT/项目手记-Windows.exe.next" "$JOURNAL_ROOT/项目手记-Windows.exe"
