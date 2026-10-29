#!/bin/sh
# Package only explicit application/license files. Never copy data/ or local/.
set -eu
JOURNAL_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
JOURNAL_OUT=${1:-"$JOURNAL_ROOT/dist"}
mkdir -p "$JOURNAL_OUT"
JOURNAL_STAGE=$(mktemp -d)
trap 'rm -rf "$JOURNAL_STAGE"' EXIT
mkdir -p "$JOURNAL_STAGE/project-journal-macos" "$JOURNAL_STAGE/project-journal-windows"
cp -R "$JOURNAL_ROOT/项目手记.app" "$JOURNAL_STAGE/project-journal-macos/"
cp "$JOURNAL_ROOT/项目手记-Windows.exe" "$JOURNAL_STAGE/project-journal-windows/"
cp -R "$JOURNAL_ROOT/build/windows/licenses" "$JOURNAL_STAGE/project-journal-windows/"
for JOURNAL_PLATFORM in macos windows; do
 cp "$JOURNAL_ROOT/docs/download-readme.md" "$JOURNAL_STAGE/project-journal-$JOURNAL_PLATFORM/README.md"
 cp "$JOURNAL_ROOT/docs/releases-2.1.0.md" "$JOURNAL_STAGE/project-journal-$JOURNAL_PLATFORM/START-HERE.md"
done
(cd "$JOURNAL_STAGE" && /usr/bin/ditto -c -k --keepParent project-journal-macos "$JOURNAL_OUT/project-journal-macos-universal.zip")
(cd "$JOURNAL_STAGE" && /usr/bin/ditto -c -k --keepParent project-journal-windows "$JOURNAL_OUT/project-journal-windows-x64.zip")
(cd "$JOURNAL_OUT" && shasum -a 256 project-journal-macos-universal.zip project-journal-windows-x64.zip > SHA256SUMS.txt)
