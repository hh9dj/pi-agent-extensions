# skeptic-agent

`skeptic_agent` tool — asks the user clarifying questions through a TUI form.

Used to resolve ambiguous requirements, discuss trade-offs, and confirm
decisions that materially change what gets built. Schema, keys and look follow
opencode's `question` tool.

## Schema

```json
{
  "questions": [
    {
      "question": "Complete question",
      "header": "Short label",
      "options": [{ "label": "Option (Recommended)", "description": "Why" }],
      "multiple": false
    }
  ]
}
```

A "Type your own answer" row is always added. `options: []` gives a free-text
question. One single-choice question submits as soon as it is answered.
Otherwise the form shows one tab per question plus a Submit tab.

## Keys

- `←`/`h`, `→`/`l`, `tab`/`shift+tab`: previous or next tab
- `↑`/`k`, `↓`/`j`: move the selection
- `1`–`9`: pick that row
- `enter`: pick (single) or toggle (multiple); submit on the Submit tab
- `space`: toggle (multiple)
- Type on the "Type your own answer" row to start editing it
- While editing: `enter` confirm, `esc` close, `tab`/`shift+tab` confirm and move, `↑` back to the options, `ctrl+c` clear
- `esc`/`ctrl+c`: dismiss the form and stop the agent turn

Source: `schemas.ts` (tool input), `form-state.ts` (pure helpers),
`form-panel.ts` (TUI form), `index.ts` (tool registration).
