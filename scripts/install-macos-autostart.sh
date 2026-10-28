#!/bin/sh
set -eu
JOURNAL_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
JOURNAL_AGENT="$HOME/Library/LaunchAgents/local.projectjournal.autostart.plist"
python3 - "$JOURNAL_ROOT" "$JOURNAL_AGENT" <<'PY'
import pathlib, plistlib, sys
root, target = map(pathlib.Path, sys.argv[1:])
app = root / '项目手记.app'
if not app.is_dir():
    raise SystemExit('Build the macOS application first.')
config = plistlib.loads(target.read_bytes()) if target.exists() else {}
config.update(Label='local.projectjournal.autostart', RunAtLoad=True,
              KeepAlive=False, LimitLoadToSessionType='Aqua',
              ProgramArguments=['/usr/bin/open', '-g', str(app), '--args', '--background'])
target.parent.mkdir(parents=True, exist_ok=True)
temporary = target.with_suffix('.plist.next')
temporary.write_bytes(plistlib.dumps(config))
temporary.replace(target)
PY
launchctl bootout "gui/$(id -u)/local.projectjournal.autostart" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$JOURNAL_AGENT"
