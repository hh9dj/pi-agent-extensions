# pi-agent-extensions

Personal [pi coding agent](https://pi.dev) extensions, bundled as one git pi package.

## Install

```bash
pi install git:github.com/hh9dj/pi-agent-extensions
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/hh9dj/pi-agent-extensions"]
}
```

## Extensions

- [clipboard](extensions/clipboard/README.md)
- [DeepSeek-tier](extensions/deepseek-tier/README.md)
- [plan-mode](extensions/plan-mode/README.md)
- [skeptic-agent](extensions/skeptic-agent/README.md)
- [subagent](extensions/subagent/README.md)

## Pi packages to try

### Context and token efficiency

- https://pi.dev/packages/pi-observational-memory - background observations and reflections for long, multi-compaction sessions
- https://pi.dev/packages/pi-cache-optimizer - in-place skill list compression, proxy cache keys, and footer cache stats

### DeepSeek

- https://pi.dev/packages/pi-reasonix - DeepSeek prefix stabilization, tool-call repair, and head/tail tool-result compaction
- https://pi.dev/packages/pi-deepseek-search - DeepSeek Search and Fetch APIs (uses DEEPSEEK_API_KEY)

### Web and browser

- https://pi.dev/packages/donsetch - local Rust binary for keyless web search, JS/PDF fetch, focused reads, crawl, and screenshots
- https://pi.dev/packages/bladebro - local Rust Chromium browser automation (act, see, state, run, vision)
