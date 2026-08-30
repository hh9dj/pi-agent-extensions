# session-browser

`/browse-sessions` — browse all pi sessions (all projects) as static HTML.

What it does:

1. Scans every project's session files under
   `~/.pi/agent/sessions/**/*.jsonl`.
2. Exports each session to HTML in-process (pi's own `/export` code path,
   deep-imported via `getPackageDir()`), mtime-cached: only sessions changed
   since the last run are re-exported.
3. Writes `~/.pi/agent/export/index.html` — one entry per session (display
   name from `/name`, project path, date), fuzzy search by name/project/date,
   light/dark toggle (defaults to the configured pi theme, persisted in
   localStorage). The page is a standalone template at
   `extensions/session-browser/index.html`.
4. Opens the index in the browser; clicking an entry opens that session's
   pre-exported HTML page.
