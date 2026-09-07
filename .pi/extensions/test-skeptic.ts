import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runForm, type Answer } from "../../extensions/skeptic-agent/form-tui";
import type { Question } from "../../extensions/skeptic-agent/schemas";

const FIXTURES: Question[] = [
    {
        question: "Describe the goal in one sentence.",
        header: "Goal",
        isMultipleChoice: false,
        options: [],
    },
    {
        question: "Which data store should we use?",
        header: "Storage",
        isMultipleChoice: false,
        options: [
            {
                label: "SQLite",
                description: "Embedded, zero config, single file",
                recommended: true,
            },
            {
                label: "Postgres",
                description: "Full server, needed for concurrent writers",
            },
            {
                label: "JSON file",
                description: "Fine under ~1k records, trivially debuggable",
            },
        ],
    },
    {
        question: "Which features ship in v1?",
        header: "Scope",
        isMultipleChoice: true,
        options: [
            { label: "Search" },
            { label: "Export to CSV" },
            { label: "Dark mode" },
        ],
    },
    {
        question: "Tab order OK?",
        header: "Nav",
        isMultipleChoice: false,
        options: [{ label: "Yes" }, { label: "No" }],
    },
];

export default function testSkeptic(pi: ExtensionAPI) {
    pi.registerCommand("test-skeptic", {
        description: "Open the skeptic form with fixture questions (no LLM)",
        handler: async (_args, ctx) => {
            if (ctx.mode !== "tui") {
                ctx.ui.notify("test-skeptic needs an interactive TUI", "warning");
                return;
            }
            ctx.ui.setWorkingVisible(false);
            let result: Answer[] | null;
            try {
                result = await runForm(ctx, FIXTURES, new AbortController().signal);
            } finally {
                ctx.ui.setWorkingVisible(true);
            }
            if (!result) {
                ctx.ui.notify("cancelled", "info");
                return;
            }
            const summary = result
                .map((a) => `${a.header}: ${a.values.join(", ") || "(none)"}`)
                .join("\n");
            ctx.ui.notify(`answers:\n${summary}`, "info");
        },
    });
}
