# Offline Markdown editor

The note editor uses Milkdown 7.23 / ProseMirror. The web app keeps its existing
Markdown textarea as the source for saving and source mode; the rich editor emits
synchronous changes into that field. Opening a note never rewrites its source.

To regenerate the committed offline assets:

```sh
cd src/editor
npm ci --ignore-scripts
npm run build
```

`build.mjs` creates `../web/vendor/markdown-editor.js`, its CSS and complete
third-party notices. It shares the application's bundled KaTeX renderer/fonts.
No runtime CDN requests are needed. The lockfile pins the full dependency tree.

`entry.js` configures headings, immediate inline Markdown/math, native list DOM,
tasks, block math, source synchronization, and image resizing. Resized images use
safe `<img ... style="zoom:...%;">` syntax compatible with Typora. Alt text is
preserved. `../web/markdown-images.js` is shared by editor import/export and the
read-only renderer, and only admits image URLs and whitelisted size attributes.

Run `tests/markdown-live.browser.cjs` from `src` with `JOURNAL_CORE` set to a built
backend and `JOURNAL_PLAYWRIGHT_MODULE` to Playwright's module path. The test uses
isolated temporary records. Set `JOURNAL_BROWSER=webkit` for the Mac browser engine
or `JOURNAL_PLATFORM=windows` for the Windows presentation.

`inline-behavior.js` provides source editing inside inline equations, focus-based
emphasis delimiters, and stable markers for empty list items. These decorations
are visual only and never become part of the saved Markdown.

Markdown snapshots are coalesced after 300 ms of idle time, with a 1.5 s maximum
wait while typing. Explicit save, navigation, source switching, focus leaving,
and destruction flush synchronously. Context reset cancels pending snapshots.

`block-math.js` keeps the existing portable display-math schema and replaces
only its node view. Equations render without code-editor controls, open a themed
source field on click or keyboard entry, and keep native selection/IME handling
while synchronizing minimal text transactions into the shared undo history.
The nested source field opts out of automatic Markdown textarea enhancement.

The browser regression also covers quote rule geometry and nesting, inline-code
boundaries, measured inline-math source width, display-math editing/undo/exit,
invalid formulas, ordinary code fallback, mixed table/list/quote roundtrips and
plain-text paste. `JOURNAL_MARKDOWN_SCREENSHOTS` exports light/dark rendered and
editing states for visual inspection. Synthetic IME tests do not replace a
manual check of the operating system candidate window or multi-hour testing.

Automatic save snapshots preserve an active equation source field; explicit
save or mode changes finish its editing session before serializing.
