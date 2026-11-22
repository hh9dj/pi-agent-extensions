# plan-mode

Read-only planning workflow for Pi with structured `plan_steps` tracking,
persistent `.plan/plan-{date-time}.md` files, a centered `/todos` progress
popup, and Zentui indicator integration.

## Commands and Flags

- `/plan`: toggle read-only plan mode on or off.
- `--plan`: start a session directly in plan mode.
- `/todos` (alias `/plan-progress`): open a centered popup overlay showing the
  current mode, completion count, and all plan steps with status markers and
  notes.

Overlay keys:

- `j`/`k` or `↑`/`↓`: scroll line by line
- `PageUp`/`PageDown` or `Ctrl+U`/`Ctrl+D`: scroll half page
- `g`/`G` or `Home`/`End`: jump to top or bottom
- `Escape`, `q`, or `Enter`: close

## Workflow

1. Entering plan mode snapshots active tools, disables `edit` and `write`,
   enables `read`, `grep`, `find`, `ls`, and `plan_steps`, and keeps other
   non-write tools active.
2. While plan mode is active, `bash` calls are restricted to allowlisted
   read-only inspection commands (`rg`, `fd`, `ast-grep`, `ls`, `cat`, `head`,
   `tail`, `wc`, `diff`, `tree`, read-only `git` subcommands, etc.) with
   redirections, command substitutions, editors, package installs, and
   destructive commands blocked.
3. The model records steps via `plan_steps` (`action: "set"`), which writes
   `<repoRoot>/.plan/plan-{date-time}.md`.
4. After the planning turn finishes, choose "Execute the plan", "Refine the
   plan", or "Stay in plan mode".
5. During execution mode, previous tools are restored while `plan_steps` stays
   active to update step statuses (`pending`, `in_progress`, `completed`,
   `skipped`) and notes. Once every step is `completed` or `skipped`, execution
   mode ends, `plan_steps` is deactivated, and indicators clear.

## Zentui Integration

- Working line: automatically publishes `planning` / `executing done/total` via
  `zentui:working-line-segment` (key `plan-mode:state`) whenever Zentui's
  working line is enabled.
- Starship footer: publishes via `ctx.ui.setStatus("plan-mode", ...)`. Preserve
  distinct planning (warning) and executing (accent) colors in
  `~/.pi/agent/zentui.json`:

```json
{
  "components": {
    "footer": {
      "styles": {
        "starship": {
          "extensionStatuses": {
            "colorModes": {
              "plan-mode": "original"
            }
          }
        }
      }
    }
  }
}
```

- Minimalist/Opencode editor or custom Starship template: optionally map a
  custom variable alias to `plan-mode:status` via `zentui:variable` (when
  referenced, the duplicate footer status is suppressed automatically).

Source: `utils.ts` (command validation and pure state transitions),
`schemas.ts` (TypeBox schema), `plan-file.ts` (`.plan/plan-*.md` persistence),
`progress-overlay.ts` (centered popup), `zentui.ts` (indicator sync),
`index.ts` (extension entry point).
