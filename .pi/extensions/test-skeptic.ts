import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runForm } from "../../extensions/skeptic-agent/index";
import type { Question } from "../../extensions/skeptic-agent/schemas";

const FIXTURES: Question[] = [
    {
        question: "Describe the goal in one sentence.",
        header: "Goal",
        options: [],
    },
    {
        question: "Which data store should we use?",
        header: "Storage",
        options: [
            {
                label: "SQLite (Recommended)",
                description: "Embedded, zero config, single file",
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
        multiple: true,
        options: [
            { label: "Search", description: "Full-text search over records" },
            { label: "Export to CSV", description: "Download the current view" },
            { label: "Dark mode", description: "Follow the system theme" },
        ],
    },
    {
        question: "Tab order OK?",
        header: "Nav",
        options: [
            { label: "Yes", description: "Keep the current order" },
            { label: "No", description: "Reorder the tabs" },
        ],
    },
];

export default function testSkeptic(pi: ExtensionAPI) {
    pi.registerCommand("test-skeptic", {
        description:
            "Open the skeptic form with fixture questions (no LLM). Pass `single` for a one-question form.",
        handler: async (args, ctx) => {
            if (ctx.mode !== "tui") {
                ctx.ui.notify("test-skeptic needs an interactive TUI", "warning");
                return;
            }
            const questions = args.trim() === "single" ? [FIXTURES[1]!] : FIXTURES;
            ctx.ui.setWorkingVisible(false);
            let result: string[][] | null;
            try {
                result = await runForm(ctx, questions, new AbortController().signal);
            } finally {
                ctx.ui.setWorkingVisible(true);
            }
            if (!result) {
                ctx.ui.notify("dismissed", "info");
                return;
            }
            const summary = questions
                .map((q, i) => `${q.header}: ${result[i]!.join(", ") || "(none)"}`)
                .join("\n");
            ctx.ui.notify(`answers:\n${summary}`, "info");
        },
    });
}
