<p align="center"><img src="src/web/app-icon.png" width="96" alt="Project Journal icon"></p>
<h1 align="center">Project Journal · 项目手记</h1>
<p align="center">A local-first work journal for long-running projects.</p>
<p align="center"><a href="https://github.com/TianyiSongZJU/project-journal/releases/latest">Download</a> · <a href="README.md">中文</a> · <a href="docs/development.md">Build & development</a></p>

![Annual review with project time distribution and daily notes](docs/images/year-review.png)

Keep project notes, daily progress, deadlines and time records together. Optionally collect foreground activity and file-change clues, review suggested time blocks, and confirm what belongs to each project.

This is an early, personally maintained desktop app for **macOS and Windows**. The interface is currently primarily in Chinese. No account or hosted service is required.

## What it does

- Projects and groups, Markdown project notes, daily entries, deadlines and completed-project archives.
- A daily timeline with manual allocation in 15-minute increments; other manually recorded time is accounted for separately.
- Optional foreground activity and folder-change collection, with device/source details for suggested time blocks.
- Annual and monthly heatmaps, project/group distributions, and hours/days display in the annual review.
- Local JSON storage partitioned by project, month and device; history recovery, sync-copy warnings and folder relocation.
- Restores the previous view and display preferences. macOS has a menu-bar app and background-only login startup.

**Clues are not measured work.** Suggestions help you recall your day; they require review and confirmation. Conflicting project evidence from multiple devices needs a human decision.

## Screenshots

All screenshots use reproducible, fictional sample data. They show the desktop content area, without native window chrome.

**Monthly review and daily progress**

![Monthly review](docs/images/month-review.png)

**Project notes, milestones and history**

![Project notes](docs/images/project-notes.png)

**Activity clues, file changes and confirmed allocations**

![Daily timeline](docs/images/day-timeline.png)

**Inspect the evidence behind a suggestion**

![Suggestion details](docs/images/clue-details.png)

## Download and run

Download a ZIP from [Releases](https://github.com/TianyiSongZJU/project-journal/releases/latest), rather than the automatically generated source archives.

| Platform | Package | Requirements |
| --- | --- | --- |
| macOS | project-journal-macos-universal.zip | macOS 13+, Apple Silicon or Intel |
| Windows | project-journal-windows-x64.zip | Windows x64, Microsoft WebView2 Runtime |

Extract the full package to a writable, permanent folder. On Mac, open 项目手记.app; on Windows, run 项目手记-Windows.exe. Keep the license materials provided with the download.

The Mac app is ad-hoc signed and not Apple-notarized; Windows builds do not have a paid code-signing certificate. Your OS may require explicit approval. Verify the download source before approving it. If WebView2 is missing, install it from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).

The Mac universal build has been built and signature-verified locally. Windows is cross-compiled; native device compatibility feedback is welcome.

## First steps

1. In 项目 (Projects), create a project and write its goal or next steps.
2. Use 记一笔 (New entry) to record progress and time. A note without time is fine.
3. Optionally enable foreground activity or bind a project folder under 记录 → 记录设置 (Record → Settings).
4. In 记录 (Record), select or adopt suggested time blocks, assign projects, review, then choose 计入项目 (Apply).
5. Use 回顾 (Review) to explore monthly/annual work and deadlines.

Monitoring is optional. Window title availability depends on OS permissions, including macOS Accessibility permissions. File watching records metadata, not document contents. The app does not record screenshots, keystroke contents, audio or video. Confirmed idle periods are deducted retrospectively, but activity is still an imperfect proxy for work.

## Your data

The app uses a sibling data/ folder. Keep the entire folder, including .english-layout, notes/, time/, activity/, history-content/ and backups/. Older installations may use a legacy layout; do not manually rename files referenced by old indexes.

To share records between Mac and Windows, sync **all of data/** using your own sync tool. The app has no built-in cloud service. Source documents are separate; bind their local folder on each device. Local preferences, monitoring settings and absolute folder paths must remain device-specific.

Finish saving and syncing on one device before editing on the next. Revision checks, conflict-copy warnings and merged activity clues do not guarantee conflict-free real-time editing on arbitrary file-sync services. Keep independent backups. Local files are not encrypted. When updating, preserve your data and device settings and replace the application files only.

More details: [data and privacy](docs/privacy.md) (Chinese).

## Try fictional data

The generator refuses to overwrite an existing output directory. Never merge demo data into your own journal.

```sh
python3 scripts/make-demo.py --output /tmp/project-journal-demo
cd src
go run . --ui-only --no-open --data-dir /tmp/project-journal-demo/data --auto-home /tmp/project-journal-demo/local
```

Open the session URL printed by the server and select **2026-10-28**. The demo has no folder bindings and monitoring is disabled.

## Build

Requires Go 1.24 or compatible. The Mac shell also requires Xcode Command Line Tools. Runtime Go dependencies are vendored.

```sh
git clone https://github.com/TianyiSongZJU/project-journal.git
cd project-journal
./scripts/build-macos.sh
# Or cross-compile Windows with: ./scripts/build-windows.sh
cd src
go test ./...
node --test tests/*.test.js
```

See [development notes](docs/development.md) for screenshots and license packaging. Do not commit personal data or logs.

## Contribute and license

Report issues with OS/app version and reproduction steps, using fictional data. See [CONTRIBUTING](CONTRIBUTING.md) and [SECURITY](SECURITY.md).

Project code is [MIT licensed](LICENSE). Dependencies retain their respective terms in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md). The app icon was created with generative assistance; prompts and edit history are documented in assets/icons/设计说明.md.
