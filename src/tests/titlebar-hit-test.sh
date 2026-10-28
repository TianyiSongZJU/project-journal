#!/bin/sh
set -eu
JOURNAL_SOURCE=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
JOURNAL_TEST_TMP=$(mktemp -d)
trap 'rm -rf "$JOURNAL_TEST_TMP"' EXIT
sed '/^final class JournalApp:/,$d' "$JOURNAL_SOURCE/macos.swift" > "$JOURNAL_TEST_TMP/main.swift"
cat "$JOURNAL_SOURCE/tests/titlebar-hit-test.swift" >> "$JOURNAL_TEST_TMP/main.swift"
swiftc -module-cache-path "$JOURNAL_TEST_TMP/cache" "$JOURNAL_TEST_TMP/main.swift" -o "$JOURNAL_TEST_TMP/titlebar-hit-test"
"$JOURNAL_TEST_TMP/titlebar-hit-test"
