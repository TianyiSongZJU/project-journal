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

A native overlay stays above WebKit while the saved page is restored. A low-contrast pale-green relief wallpaper uses a 5×5 grid extending beyond the window edges, with only a few large tiles visible at a time. Native gradient layers and an oblique projection create the material and space without loading videos or a 3D engine.

The selected presets share 11-point travel, 1.05 scale, 52-degree tilt, -31-degree rotation, 44-point gaps, 30-point corners, 4-point depth, the original pale-green palette, pale green #dce8d3, paper #eef3eb, and 0.28 light. To keep the large tiles legible, their wave opacity now ranges from 0.28 to 0.64, with a 1-point white rim at 0.42 opacity and a tighter 14-point shadow at 0.14 opacity, offset (8, -10). Full restarts use a 1.6-second period, 8% diagonal phase gap, and 48% initial phase. Recreated windows use a 1-second period, 13% phase gap, and 100% initial phase. The visible center starts in a rise on full restart and close to its crest on warm reopen. Both show artwork immediately; existing windows do not replay it. Preview-only loading durations and total playback times never impose a fixed loading wait.

When the real page is ready, each tile keeps moving until it has descended approximately two thirds of its travel, then fades during the rest of that descent. Opacity stays at its crest value during this first part of the descent so the movement is visible before fading. Diagonal phases remain unwrapped within a shared sweep. A tile rests flat after landing until the last diagonal completes the sweep; only then may the next sweep begin while loading continues. When ready, already landed tiles disappear immediately, and the others fade in their original diagonal order. An early tile never waits for its next cycle while later tiles are still exiting. Fades take up to 320 ms for either preset, shortened near the end of an existing descent so an invisible tile never rises again before removal. The background and lighting reveal the real page with a broad feathered gradient mask over the same interval. The mask travels explicitly from the lower-left to the upper-right screen corner, so the leading region becomes clear while the trailing region remains covered; there is no uniform whole-background opacity fade. Screen coordinates preserve an obvious diagonal instead of the nearly vertical direction produced by the oblique tile projection. A transition spanning 120% of the diagonal uses seven smoothstep alpha levels, extending beyond the screen edges for a broader dissolve. Mask frames follow window layout. Reduce Motion removes the surface immediately. All animations are removed on completion, and `pageReady.elapsedMs` includes the transition.

The login agent runs `open -g <application> --args --background`. This mode uses accessory activation, creates the status item and backend observer, and does not create a window or WebKit view. Monitoring respects the existing enabled/paused preferences. `source: "backgroundStart"` records a `monitorReady` stage after observer configuration succeeds; no `pageReady` is expected until a user opens a window, which gets a separate measurement.

After building the app, run `scripts/install-macos-autostart.sh` to install/update the user login agent. This does not quit an already running application. Normal manual application launches still open a window; status menu and Dock reopen actions create or raise it when running in the background.
