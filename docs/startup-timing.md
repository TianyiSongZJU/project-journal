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
