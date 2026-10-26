#!/bin/sh
set -eu
JOURNAL_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
JOURNAL_GO=${JOURNAL_GO:-go}
JOURNAL_APP="$JOURNAL_ROOT/项目手记.app"
JOURNAL_TMP=$(mktemp -d)
trap 'rm -rf "$JOURNAL_TMP"' EXIT
cd "$JOURNAL_ROOT/src"
for JOURNAL_ARCH in arm64 amd64; do
 GOOS=darwin GOARCH="$JOURNAL_ARCH" CGO_ENABLED=0 "$JOURNAL_GO" build -mod=vendor -trimpath -ldflags='-s -w' -o "$JOURNAL_TMP/core-$JOURNAL_ARCH" .
done
swiftc -O -module-cache-path "$JOURNAL_TMP/swift-arm64" -target arm64-apple-macos13.0 macos.swift AutoObserver.swift -o "$JOURNAL_TMP/window-arm64"
swiftc -O -module-cache-path "$JOURNAL_TMP/swift-amd64" -target x86_64-apple-macos13.0 macos.swift AutoObserver.swift -o "$JOURNAL_TMP/window-amd64"
mkdir -p "$JOURNAL_APP/Contents/MacOS" "$JOURNAL_APP/Contents/Resources"
cp "$JOURNAL_ROOT/assets/Info.plist" "$JOURNAL_APP/Contents/Info.plist"
cp "$JOURNAL_ROOT/assets/icons/AppIcon.icns" "$JOURNAL_APP/Contents/Resources/AppIcon.icns"
lipo -create "$JOURNAL_TMP/core-arm64" "$JOURNAL_TMP/core-amd64" -output "$JOURNAL_TMP/journal-core"
lipo -create "$JOURNAL_TMP/window-arm64" "$JOURNAL_TMP/window-amd64" -output "$JOURNAL_TMP/ProjectJournal"
cp "$JOURNAL_TMP/journal-core" "$JOURNAL_APP/Contents/Resources/journal-core.next"
mv -f "$JOURNAL_APP/Contents/Resources/journal-core.next" "$JOURNAL_APP/Contents/Resources/journal-core"
cp "$JOURNAL_TMP/ProjectJournal" "$JOURNAL_APP/Contents/MacOS/ProjectJournal.next"
mv -f "$JOURNAL_APP/Contents/MacOS/ProjectJournal.next" "$JOURNAL_APP/Contents/MacOS/ProjectJournal"
codesign --force --deep --sign - "$JOURNAL_APP"
codesign --verify --deep --strict "$JOURNAL_APP"
