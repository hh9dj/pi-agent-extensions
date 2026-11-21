// skeptic_agent tool: schemas in ./schemas.ts, TUI form in ./form-panel.ts.
// Behavior, keys and look follow opencode's `question` tool.
import type {
    AgentToolUpdateCallback, // type of the `onUpdate` progress callback
    ExtensionAPI, // the `pi` object pi gives every extension
    ExtensionContext, // the `ctx` object passed to tools/events
} from "@earendil-works/pi-coding-agent";

import { AskUserParamsSchema, type AskUserParams, type Question } from "./schemas";
import { FormPanel } from "./form-panel";

const DESCRIPTION = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- A "Type your own answer" option is added automatically; don't include a separate option for free form answers
- Set \`multiple: true\` to allow selecting more than one option
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`;

const DISMISSED = "The user dismissed this question";

// Text the model reads, same format as opencode.
function toModelContent(questions: Question[], answers: string[][]): string {
    const formatted = questions
        .map((question, index) => {
            const answer = answers[index]?.length ? answers[index].join(", ") : "Unanswered";
            return `"${question.question}"="${answer}"`;
        })
        .join(", ");
    return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`;
}

// Open the form and wait until the user submits (answers) or dismisses (null).
export function runForm(ctx: ExtensionContext, questions: Question[], signal: AbortSignal | undefined) {
    return ctx.ui.custom<string[][] | null>((tui, theme, keybindings, done) => {
        let finished = false;
        const finish = (value: string[][] | null) => {
            if (finished) return;
            finished = true;
            done(value);
        };

        if (signal?.aborted) finish(null);
        const onAbort = () => finish(null);
        signal?.addEventListener("abort", onAbort);

        const panel = new FormPanel(tui, theme, keybindings, finish, questions);
        return Object.assign(panel, {
            dispose: () => signal?.removeEventListener("abort", onAbort),
        });
    });
}

// `export default function initExtension(pi)` is the entry point pi calls when
// the extension loads. Here we tell pi "there is a tool called skeptic_agent".
export default function initExtension(pi: ExtensionAPI) {
    pi.registerTool({
        name: "skeptic_agent",
        label: "Skeptic Agent",
        description: DESCRIPTION,
        promptSnippet:
            "Ask the user questions to clarify requirements, resolve ambiguity, and decide trade-offs",
        promptGuidelines: [
            "Use skeptic_agent for ambiguous requirements, and to know user preferences.",
            "Use skeptic_agent to discuss trade-offs.",
            "Use skeptic_agent to challenge user choices, suggest alternative choices.",
            "Use skeptic_agent only when the answer materially changes what gets built; skip questions answerable from context or codebase conventions.",
            "In skeptic_agent, present specific options with brief trade-offs; avoid open-ended or multi-part questions.",
            "Batch independent questions into one skeptic_agent call; ask follow-up questions after answers arrive.",
            "In skeptic_agent, set option descriptions to explain trade-offs or consequences concisely.",
            'In skeptic_agent, put a recommended option first and end its label with "(Recommended)" only when you have a genuine best choice.',
        ],
        parameters: AskUserParamsSchema,
        executionMode: "sequential",

        execute: async (
            _toolCallId: string,
            params: AskUserParams,
            signal: AbortSignal | undefined,
            onUpdate: AgentToolUpdateCallback | undefined,
            ctx: ExtensionContext,
        ) => {
            // This tool needs the interactive TUI (custom UI + keyboard).
            if (ctx.mode !== "tui") {
                throw new Error("skeptic_agent requires an interactive TUI session.");
            }

            // Tell the TUI "tool is waiting for the user" so it doesn't look frozen.
            onUpdate?.({
                content: [{ type: "text", text: "Waiting for user input..." }],
                details: { waiting: true },
            });

            // Hide the spinner while the form is up.
            ctx.ui.setWorkingVisible(false);
            let answers: string[][] | null;
            try {
                answers = await runForm(ctx, params.questions, signal);
            } finally {
                ctx.ui.setWorkingVisible(true);
            }

            if (!answers) {
                // Like opencode, dismissing the form ends the agent turn.
                ctx.abort();
                return {
                    content: [{ type: "text", text: DISMISSED }],
                    details: { cancelled: true, answers: [] as string[][] },
                };
            }

            return {
                content: [{ type: "text", text: toModelContent(params.questions, answers) }],
                details: { cancelled: false, answers },
            };
        },
    });
}
