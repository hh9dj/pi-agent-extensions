import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { FormPanel } from "./form-panel";
import type { Answer } from "./form-state";
import type { Question } from "./schemas";

export type { Answer } from "./form-state";

export function runForm(
    ctx: ExtensionContext,
    questions: Question[],
    signal: AbortSignal,
): Promise<Answer[] | null> {
    return ctx.ui.custom<Answer[] | null>((tui, theme, keybindings, done) => {
        let finished = false;
        const finish = (value: Answer[] | null) => {
            if (finished) return;
            finished = true;
            done(value);
        };

        if (signal?.aborted) {
            finish(null);
        }
        const onAbort = () => finish(null);
        signal?.addEventListener("abort", onAbort);

        const panel = new FormPanel(tui, theme, keybindings, finish, questions);

        return {
            render: (width) => panel.render(width),
            invalidate: () => panel.invalidate(),
            handleInput: (data) => panel.handleInput(data),
            dispose: () => signal?.removeEventListener("abort", onAbort),
        };
    });
}
