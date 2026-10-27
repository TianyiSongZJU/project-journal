# macOS startup timing

The native application writes device-local JSON Lines to `local/macos/startup-times.jsonl`, or the configured `JournalAutomationHome`. This file is ignored by Git along with other local settings. It contains launch IDs, timestamps, process IDs, stage names, durations, and one of the four page IDs. It contains no project names, document paths, or activity content.

Each launch records these stages once, with `elapsedMs` measured using the monotonic clock from the beginning of application `main`:

- `mainStarted`: application code begins execution.
- `appLaunched`: AppKit finishes initial application setup.
- `windowShown`: the initial window has been ordered on screen; this is not a guarantee that the display has presented a frame.
- `backendStarted`: immediately before launching the local backend.
- `backendReady`: the backend supplies its authenticated local URL; the URL and token are never logged.
- `pageReady`: the saved page and scroll position have been restored and the page revealed, followed by two animation frames to allow a paint opportunity. `pageMs` measures from the page navigation start.

`pageReady.elapsedMs` is the main startup metric. This is an application measurement, not a physical click-to-screen measurement: it excludes Launch Services, executable loading before main, and display presentation latency. Missing later stages indicate an incomplete launch. No extra requests are made to the backend for timing.

For repeated measurements, quit with Command-Q, then open the app and wait for content to appear. Closing only the window leaves the process running and does not create another startup measurement. Logs are pruned after 256 KiB, retaining the latest 500 events before appending the next event. Logging failures do not interrupt startup.

## Reopening windows

Each explicit status menu action starts a separate measurement with `source: "statusBar"`. Dock reopening uses `source: "dock"`. A complete process launch uses `source: "coldStart"`. `windowMode` distinguishes `newWindow` (a closed window is recreated) from `existingWindow` (an existing window is raised, including unminimizing). Each measurement has its own ID, start time, and stage deduplication. Reopen measurements start at `openRequested`, then record `windowShown` and `pageReady`. For an existing page, `pageMs` is omitted because the page is not reloaded.

For status bar measurements, close the window with its red button and choose **打开项目手记** from the status menu. Repeat without quitting. For an existing window measurement, minimize or hide it and use the same menu action. Time spent opening the status menu before choosing the action is excluded.

## Startup presentation and login

A native overlay stays above WebKit while the saved page is restored. Full launches show five small green tiles without text. The tiles enter once, then slowly change opacity while waiting. Recreated windows use the same surface with a 200 ms delay before showing the tiles. Existing windows do not show a loading animation. When the page is ready, the surface fades away in 120 ms; there is no minimum animation playback time. Reduce Motion disables tile motion and the final fade. `pageReady.elapsedMs` includes this final transition.

The login agent runs `open -g <application> --args --background`. This mode uses accessory activation, creates the status item and backend observer, and does not create a window or WebKit view. Monitoring respects the existing enabled/paused preferences. `source: "backgroundStart"` records a `monitorReady` stage after observer configuration succeeds; no `pageReady` is expected until a user opens a window, which gets a separate measurement.

After building the app, run `scripts/install-macos-autostart.sh` to install/update the user login agent. This does not quit an already running application. Normal manual application launches still open a window; status menu and Dock reopen actions create or raise it when running in the background.
