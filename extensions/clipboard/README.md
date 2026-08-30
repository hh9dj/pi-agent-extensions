# clipboard

Copies the final assistant response to the system clipboard automatically.

## How it works

Subscribes to pi's `agent_settled` event — fired once per prompt when the agent
is truly done (no retries, compaction retries, or queued follow-ups left). Takes
the last assistant message on the current branch plus the user prompt that
triggered it, and copies both to the clipboard via pi's own `copyToClipboard()`
helper (the same one behind the built-in `/copy` command; picks
wl-copy/xclip/pbcopy or OSC 52 per environment).

The copied text is markdown, with the prompt and response separated by headers:

```markdown
## User

<your prompt>

## Assistant

<final response>
```

No user prompt found (edge case) → only the assistant text is copied.
Aborted/cancelled turns produce no copy (partial responses are skipped).

## Enable / disable

Config file: `~/.pi/agent/clipboard.json`

```json
{ "enabled": true }
```
