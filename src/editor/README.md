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
