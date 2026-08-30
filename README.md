# pi-agent-extensions

Personal [pi coding agent](https://pi.dev) extensions, bundled as one git pi package.

## Install

```bash
pi install git:github.com/hh9dj/pi-agent-extensions@main
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "git:github.com/hh9dj/pi-agent-extensions@main"
  ]
}
```

Then `/reload` in pi.

## Extensions

### clipboard

Auto-copies the final assistant response to the system clipboard on
`agent_settled`. Uses pi's `copyToClipboard()` (wl-copy / xclip / pbcopy / OSC 52).

Config: `~/.pi/agent/clipboard.json` — `{ "enabled": true }` (default: enabled,
read fresh on every settle).

### deepseek-tier

Publishes DeepSeek peak/off-peak pricing as a footer status via
`ctx.ui.setStatus()`. Refreshes every 60s.

Config: `~/.pi/agent/deepseek-tier.json` (optional; see defaults in
`extensions/deepseek-tier/README.md`).

### session-browser

`/browse-sessions` — exports all pi sessions to static HTML and opens a
searchable index in the browser. No deps, no server.

See `extensions/session-browser/README.md`.

### skeptic-agent

`skeptic_agent` tool — asks the user clarifying questions through a TUI form.
Used to resolve ambiguous requirements and trade-offs.
