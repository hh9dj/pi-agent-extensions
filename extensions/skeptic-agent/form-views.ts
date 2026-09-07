import type { Input } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { LineWriter } from "./form-text";
import {
    currentOptions,
    customValues,
    isAnswered,
    allAnswered,
    type FormState,
} from "./form-state";

export function renderTabBar(state: FormState, theme: Theme): string {
    const tabs: string[] = [];
    for (let i = 0; i < state.questions.length; i++) {
        const active = i === state.tab;
        const answered = isAnswered(state.answers, i);
        const label = `${answered ? "■" : "□"} ${state.questions[i]!.header}`;
        tabs.push(
            active
                ? theme.bg("selectedBg", theme.fg("text", ` ${label} `))
                : theme.fg(answered ? "success" : "muted", ` ${label} `),
        );
    }
    const submitActive = state.tab === state.questions.length;
    const allDone = allAnswered(state.questions, state.answers);
    const submitLabel = allDone ? "✓ Review" : "Review";
    tabs.push(
        submitActive
            ? theme.bg("selectedBg", theme.fg("text", ` ${submitLabel} `))
            : theme.fg(allDone ? "success" : "dim", ` ${submitLabel} `),
    );
    return tabs.join(" ");
}

export function renderQuestionView(
    state: FormState,
    questionIndex: number,
    theme: Theme,
    input: Input,
    width: number,
): string[] {
    const question = state.questions[questionIndex]!;
    const isEditingQuestion = state.editingQuestion === questionIndex;
    const out = new LineWriter(width);

    out.addWithPrefix(" ", theme.fg("text", question.question));
    out.add("");

    if (question.options.length === 0) {
        if (isEditingQuestion) {
            out.addWithPrefix(" ", theme.fg("muted", "Your answer:"));
            for (const line of input.render(Math.max(1, width - 2))) {
                out.addWithPrefix(" ", theme.fg("text", line));
            }
            out.add("");
            out.addWithPrefix(" ", theme.fg("dim", "Enter to submit • Esc to cancel"));
        } else {
            const saved = state.answers[questionIndex][0];
            if (saved) {
                out.addWithPrefix(" ", theme.fg("text", saved));
                out.addWithPrefix(" ", theme.fg("dim", "Enter to edit • Tab/←→ tabs • Esc cancel"));
            } else {
                out.addWithPrefix(" ", theme.fg("muted", "Free text answer"));
                out.addWithPrefix(" ", theme.fg("dim", "Enter to type • Tab/←→ tabs • Esc cancel"));
            }
        }
        return out.lines;
    }

    const options = currentOptions(question);
    const focus = state.optionFocus[questionIndex]!;
    const selected = new Set(state.answers[questionIndex]);

    options.forEach((option, index) => {
        const focused = index === focus;
        const isOther = option.isOther === true;
        const isSelected = !isOther && selected.has(option.label);
        const marker = question.isMultipleChoice
            ? isOther
                ? " "
                : isSelected
                  ? theme.fg("success", "[x]")
                  : "[ ]"
            : focused
              ? theme.fg("accent", ">")
              : " ";
        const prefix = ` ${marker} `;
        const recommendedMark = option.recommended ? " [recommended]" : "";
        const label = `${index + 1}. ${option.label}${recommendedMark}${isOther && isEditingQuestion ? " ✎" : ""}`;
        const color = focused || (isOther && isEditingQuestion) ? "accent" : "text";
        out.addWithPrefix(prefix, theme.fg(color, label));
        if (option.description) {
            out.addWithPrefix("      ", theme.fg("muted", option.description));
        }
    });

    const customValuesList = customValues(question, state.answers[questionIndex]);
    for (const value of customValuesList) {
        out.add("");
        out.addWithPrefix(" ", theme.fg("text", `✎ ${value}`));
    }

    if (isEditingQuestion) {
        out.add("");
        out.addWithPrefix(" ", theme.fg("muted", "Your answer:"));
        for (const line of input.render(Math.max(1, width - 2))) {
            out.addWithPrefix(" ", theme.fg("text", line));
        }
    }

    out.add("");
    const help = question.isMultipleChoice
        ? "Space toggle • Enter next • Tab/←→ tabs • Esc cancel"
        : "↑↓ select • Enter choose • Tab/←→ tabs • Esc cancel";
    out.addWithPrefix(" ", theme.fg("dim", help));

    return out.lines;
}

export function renderReviewView(state: FormState, theme: Theme, width: number): string[] {
    const out = new LineWriter(width);

    out.addWithPrefix(" ", theme.fg("accent", theme.bold("Review")));
    out.add("");

    state.questions.forEach((question, index) => {
        const values = state.answers[index].join(", ") || theme.fg("warning", "unanswered");
        out.addWithPrefix(
            " ",
            theme.fg("muted", `${question.header}: `) + theme.fg("text", values),
        );
    });

    out.add("");
    const submitText = allAnswered(state.questions, state.answers)
        ? theme.fg("success", "> Submit")
        : theme.fg(
              "warning",
              `Unanswered: ${state.questions
                  .filter((_, i) => !isAnswered(state.answers, i))
                  .map((q) => q.header)
                  .join(", ")}`,
          );
    out.addWithPrefix(" ", submitText);

    out.add("");
    out.addWithPrefix(" ", theme.fg("dim", "Enter submit • Tab/←→ back • Esc cancel"));

    return out.lines;
}
