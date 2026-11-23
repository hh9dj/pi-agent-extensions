# subagent

`subagent` tool and `/subagents` command — delegate single, parallel, or chained tasks to specialized sub-agents with isolated context windows.

Supports two execution runtimes selectable per agent (or overridden per call):

- `in-process`: runs `createAgentSession()` in-process with `SessionManager.inMemory()`. Fast startup, low memory overhead, attaches `builtin:codemode` by default, and inherits the parent session's `ModelRuntime` (so custom provider extensions such as `npm:pi-antigravity` keep working even with `noExtensions: true`). Best for read-only scouts, planners, and reviewers.
- `subprocess`: spawns an isolated `pi --mode json -p --no-session` process. Full process isolation, hard `SIGTERM`/`SIGKILL` cancellation, full pi startup environment by default. Best for coding workers, test runners, and project-local agents.

## Modes

- Single: `{ "agent": "scout", "task": "Find authentication code" }` (`agent` defaults to `"worker"` when omitted)
- Parallel: `{ "tasks": [{ "agent": "scout", "task": "..." }, { "agent": "reviewer", "task": "..." }] }` (max 8 tasks, 4 concurrent, 50 KB model-visible output cap per task)
- Chain: `{ "chain": [{ "agent": "scout", "task": "..." }, { "agent": "planner", "task": "Plan using: {previous}" }] }` (stops on first failure)

Any mode accepts optional `runtime` (`"in-process"` or `"subprocess"`) and `cwd`.

## Agent Definitions

Agents are Markdown files with YAML frontmatter:

```markdown
---
name: scout
description: Fast read-only codebase recon
runtime: in-process
model: antigravity/gemini-4-neon
tools: read, grep, find, ls, codemode
extensions:
  - builtin:codemode
---

System prompt appended for this agent.
```

- `runtime`: `in-process` or `subprocess` (default: `subprocess`).
- `tools`: comma-separated string or YAML list (default: pi's default tools, `read`, `bash`, `edit`, `write` plus `defaultTools` from settings). Also supports `+name`/`-name` deltas such as `tools: +codemode`.
- `model`: optional `provider/model-id` (for example `antigravity/gemini-4-neon` or `deepseek/deepseek-chat`). When omitted, the sub-agent inherits the parent session's active model and thinking level.
- `extensions`: optional control over which extensions load for this agent:
  - omitted: `subprocess` loads all normal configured/discovered extensions; `in-process` loads no user extensions, attaches `builtin:codemode`, and inherits the parent's `ModelRuntime` (including extension-registered providers).
  - `all` (or `true`): loads all configured/discovered extensions in both runtimes.
  - `none` (or `false`): passes `--no-extensions` in `subprocess` or `noExtensions: true` with no factories in `in-process`.
  - list or comma-separated allowlist (for example `[builtin:codemode, npm:pi-antigravity]` or `[builtin:codemode, ~/.pi/agent/extensions/my-ext.ts]`): disables normal discovery and loads only the listed built-ins (`builtin:codemode`, `builtin:mcp`, `builtin:tool-search`), package specifiers (`npm:...`, `git:...`), or paths. Note that subprocess agents using a custom provider extension (such as `npm:pi-antigravity`) must include that provider extension if they disable normal discovery.

### Discovery and Precedence

Agents are discovered fresh on each turn (no `/reload` needed) and injected into the system prompt via `before_agent_start` as `<available_subagents>`:

1. Bundled examples: `extensions/subagent/agents/*.md`
2. User agents: `~/.pi/agent/agents/*.md` (overrides bundled agents with the same name)
3. Project agents: nearest `.pi/agents/*.md` — loaded automatically only when `ctx.isProjectTrusted()` is true (overrides bundled and user agents)

If no `worker` file exists, a minimal built-in `worker` fallback is always available.

### Bundled Example Agents

Delete any file from `extensions/subagent/agents/` that you do not want:

In-process (`runtime: in-process`):

- `scout.md`: fast read-only codebase reconnaissance for handoff
- `planner.md`: read-only implementation planner
- `reviewer.md`: read-only code reviewer for bugs, edge cases, and regressions

Subprocess (`runtime: subprocess`):

- `worker.md`: general-purpose coding agent with full tools
- `tester.md`: isolated build, lint, typecheck, and test runner
- `fixer.md`: targeted bug and type-error fixer

## Security and Limits

- Strict project trust: `.pi/agents/*.md` is never scanned or executed when `ctx.isProjectTrusted()` is false.
- Recursive spawning is bounded by `PI_SUBAGENT_DEPTH` and `PI_SUBAGENT_MAX_DEPTH` (default max depth: `1`).

## Command

- `/subagents`: list currently discovered agents, their source, runtime, model, tools, and extensions.

Source: `schemas.ts` (tool input), `agents.ts` (discovery), `runner-common.ts` (shared types and limits), `runner-subprocess.ts` (isolated CLI runner), `runner-inprocess.ts` (SDK runner), `render.ts` (TUI display), `index.ts` (tool and command registration).
