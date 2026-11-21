// Question form, modeled on opencode's TUI form
// (packages/tui/src/routes/session/form.tsx): same layout, keys and flow.
import {
    decodeKittyPrintable,
    Input,
    Key,
    matchesKey,
    truncateToWidth,
    visibleWidth,
    wrapTextWithAnsi,
    type Component,
    type Focusable,
    type KeybindingsManager,
    type TUI,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
    CUSTOM_PLACEHOLDER,
    isSingle,
    pickedIndex,
    replaceCustom,
    rowCount,
    tabCount,
    toggle,
} from "./form-state";
import type { Question } from "./schemas";

type KeyAction = Parameters<KeybindingsManager["matches"]>[1];

const TAB_LABEL_MAX = 24;
const REVIEW_LABEL_MAX = 40;

class LineWriter {
    readonly lines: string[] = [];

    constructor(readonly width: number) {}

    add(text: string): void {
        this.lines.push(...wrapTextWithAnsi(text, this.width));
    }

    // Wrap `text` and indent continuation lines to the width of `prefix`.
    addWithPrefix(prefix: string, text: string): void {
        const prefixWidth = visibleWidth(prefix);
        if (prefixWidth >= this.width) {
            this.add(prefix + text);
            return;
        }
        const continuation = " ".repeat(prefixWidth);
        wrapTextWithAnsi(text, this.width - prefixWidth).forEach((line, i) => {
            this.lines.push(i === 0 ? prefix + line : continuation + line);
        });
    }
}

function truncate(label: string, max: number): string {
    return label.length > max ? label.slice(0, max - 1).trimEnd() + "…" : label;
}

// A printable character typed by the user (plain or Kitty CSI-u encoded).
function printable(data: string): string | undefined {
    const char = decodeKittyPrintable(data) ?? data;
    return /^[^\p{C}\p{Zl}\p{Zp}]$/u.test(char) ? char : undefined;
}

export class FormPanel implements Component, Focusable {
    private tab = 0;
    private selected = 0;
    private editing = false;
    private readonly answers: string[][];
    private readonly custom: string[];
    private readonly input = new Input();
    private cached: string[] | undefined;
    private _focused = false;

    constructor(
        private readonly tui: TUI,
        private readonly theme: Theme,
        private readonly keybindings: KeybindingsManager,
        private readonly done: (value: string[][] | null) => void,
        private readonly questions: Question[],
    ) {
        this.answers = questions.map(() => []);
        this.custom = questions.map(() => "");
    }

    get focused(): boolean {
        return this._focused;
    }

    set focused(value: boolean) {
        this._focused = value;
        this.input.focused = value && this.editing;
    }

    // ─── State ──────────────────────────────────────────────────────────────

    private get single(): boolean {
        return isSingle(this.questions);
    }

    private get onSubmitTab(): boolean {
        return !this.single && this.tab >= this.questions.length;
    }

    private get question(): Question {
        return this.questions[this.tab]!;
    }

    private get onCustomRow(): boolean {
        return this.selected === this.question.options.length;
    }

    private get customPicked(): boolean {
        const value = this.custom[this.tab]!;
        return value !== "" && this.answers[this.tab]!.includes(value);
    }

    private refresh(): void {
        this.cached = undefined;
        this.tui.requestRender();
    }

    private submit(): void {
        this.done(this.answers.map((answer) => [...answer]));
    }

    private selectTab(index: number): void {
        const total = tabCount(this.questions);
        this.tab = (index + total) % total;
        this.setEditing(false);
        this.selected = this.onSubmitTab
            ? 0
            : pickedIndex(this.question, this.answers[this.tab]!, this.custom[this.tab]!);
    }

    private setEditing(value: boolean): void {
        this.editing = value;
        this.input.focused = value && this._focused;
    }

    // Start the inline editor with `text`, cursor at the end.
    private startEditing(text: string): void {
        this.input.setValue("");
        if (text) this.input.handleInput(text);
        this.setEditing(true);
        this.setCustom(text);
    }

    // The custom value is the answer as soon as it is typed (like opencode).
    private setCustom(text: string): void {
        const previous = this.custom[this.tab]!;
        if (previous === text) return;
        this.custom[this.tab] = text;
        this.answers[this.tab] = this.question.multiple
            ? replaceCustom(this.answers[this.tab]!, previous, text)
            : text
              ? [text]
              : [];
    }

    // Pick a single-choice answer, then move on.
    private pick(value: string): void {
        this.answers[this.tab] = [value];
        if (this.single) {
            this.submit();
            return;
        }
        this.selectTab(this.tab + 1);
    }

    // Enter / space / digit on the focused row.
    private activate(): void {
        const question = this.question;
        if (this.onCustomRow) {
            const value = this.custom[this.tab]!;
            if (question.multiple && this.customPicked) {
                this.answers[this.tab] = toggle(this.answers[this.tab]!, value);
                return;
            }
            this.startEditing(value);
            return;
        }
        const label = question.options[this.selected]!.label;
        if (question.multiple) {
            this.answers[this.tab] = toggle(this.answers[this.tab]!, label);
            return;
        }
        this.pick(label);
    }

    // ─── Keys ───────────────────────────────────────────────────────────────

    private kb(action: KeyAction, data: string): boolean {
        return this.keybindings.matches(data, action);
    }

    private isNext(data: string): boolean {
        return this.kb("tui.input.tab", data) || matchesKey(data, Key.right) || matchesKey(data, "l");
    }

    private isPrev(data: string): boolean {
        return matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left) || matchesKey(data, "h");
    }

    handleInput(data: string): void {
        if (this.editing) this.handleEditInput(data);
        else this.handleSelectInput(data);
        this.refresh();
    }

    private handleSelectInput(data: string): void {
        // Typing on the custom row starts the editor with that character.
        const char = printable(data);
        if (!this.onSubmitTab && this.onCustomRow && char !== undefined && char !== " ") {
            this.startEditing(this.custom[this.tab]! + char);
            return;
        }
        if (this.kb("tui.select.cancel", data)) {
            this.done(null);
            return;
        }
        if (this.isPrev(data)) {
            this.selectTab(this.tab - 1);
            return;
        }
        if (this.isNext(data)) {
            this.selectTab(this.tab + 1);
            return;
        }
        if (this.onSubmitTab) {
            if (this.kb("tui.select.confirm", data)) this.submit();
            return;
        }

        const total = rowCount(this.question);
        if (this.kb("tui.select.up", data) || matchesKey(data, "k")) {
            this.selected = (this.selected - 1 + total) % total;
            return;
        }
        if (this.kb("tui.select.down", data) || matchesKey(data, "j")) {
            this.selected = (this.selected + 1) % total;
            return;
        }
        for (let index = 0; index < Math.min(total, 9); index++) {
            if (matchesKey(data, String(index + 1) as Parameters<typeof matchesKey>[1])) {
                this.selected = index;
                this.activate();
                return;
            }
        }
        if (this.kb("tui.select.confirm", data) || (this.question.multiple && matchesKey(data, Key.space))) {
            this.activate();
        }
    }

    private handleEditInput(data: string): void {
        const text = this.input.getValue().trim();
        if (matchesKey(data, Key.escape)) {
            this.setEditing(false);
            return;
        }
        // ctrl+c clears the text, or closes the editor when already empty.
        if (matchesKey(data, Key.ctrl("c"))) {
            if (!this.input.getValue()) {
                this.setEditing(false);
                return;
            }
            this.input.setValue("");
            this.setCustom("");
            return;
        }
        const back = matchesKey(data, Key.shift("tab"));
        if (back || matchesKey(data, Key.tab)) {
            this.setCustom(text);
            this.selectTab(this.tab + (back ? -1 : 1));
            return;
        }
        if (this.kb("tui.select.up", data)) {
            if (this.selected === 0) return;
            this.setEditing(false);
            this.selected -= 1;
            return;
        }
        if (this.kb("tui.select.confirm", data)) {
            this.setCustom(text);
            this.setEditing(false);
            if (this.question.multiple || !text) return;
            if (this.single) {
                this.submit();
                return;
            }
            this.selectTab(this.tab + 1);
            return;
        }
        this.input.handleInput(data);
        this.setCustom(this.input.getValue());
    }

    // ─── Render ─────────────────────────────────────────────────────────────

    render(width: number): string[] {
        if (this.cached) return this.cached;

        const theme = this.theme;
        const bar = theme.fg("accent", "┃") + "  ";
        const out = new LineWriter(Math.max(1, width - visibleWidth(bar)));

        out.add("");
        out.add(theme.fg("muted", "Questions"));
        if (!this.single) {
            out.add("");
            out.add(this.renderTabs(width));
        }
        out.add("");
        if (this.onSubmitTab) this.renderReview(out);
        else this.renderQuestion(out);
        out.add("");
        out.add(this.renderFooter());
        out.add("");

        this.cached = out.lines.map((line) => truncateToWidth(bar + line, width));
        return this.cached;
    }

    invalidate(): void {
        this.cached = undefined;
    }

    private renderTabs(width: number): string {
        const theme = this.theme;
        const labels = this.questions.map((question) => truncate(question.header, TAB_LABEL_MAX));
        const tabsWidth =
            labels.reduce((sum, label) => sum + visibleWidth(label) + 3, visibleWidth("Submit") + 3) - 1;

        if (tabsWidth > width - 8) {
            const total = this.questions.length;
            const answered = this.answers.filter((answer) => answer.length > 0).length;
            const position = this.onSubmitTab ? "Review" : `Question ${this.tab + 1} of ${total}`;
            return theme.bold(theme.fg("accent", position)) + theme.fg("muted", `   · ${answered}/${total} completed`);
        }

        const tab = (label: string, active: boolean) =>
            active
                ? theme.inverse(theme.bold(theme.fg("accent", ` ${label} `)))
                : theme.fg("muted", ` ${label} `);
        return [...labels.map((label, index) => tab(label, index === this.tab)), tab("Submit", this.onSubmitTab)].join(
            " ",
        );
    }

    private renderQuestion(out: LineWriter): void {
        const theme = this.theme;
        const question = this.question;
        const answer = this.answers[this.tab]!;
        const multi = question.multiple === true;

        out.add(theme.fg("text", question.question));
        out.add("");

        const checkbox = (active: boolean, checked: boolean) =>
            theme.fg(active ? "accent" : checked ? "success" : "muted", `[${checked ? "✓" : " "}]`) + " ";

        question.options.forEach((option, index) => {
            const active = index === this.selected;
            const picked = answer.includes(option.label);
            const number = theme.fg(active ? "accent" : "muted", `${index + 1}.`) + " ";
            const prefix = number + (multi ? checkbox(active, picked) : "");
            const mark = !multi && picked ? theme.fg("success", " ✓") : "";
            out.addWithPrefix(prefix, theme.fg(active ? "accent" : "text", option.label) + mark);
            if (option.description) {
                out.addWithPrefix(" ".repeat(multi ? 7 : 3), theme.fg("muted", option.description));
            }
        });

        const index = question.options.length;
        const active = this.onCustomRow;
        const value = this.custom[this.tab]!;
        const checked = this.customPicked || (multi && active && this.editing);
        const number = theme.fg(active ? "accent" : "muted", `${index + 1}.`) + " ";
        const prefix = number + (multi ? checkbox(active, checked) : "");
        if (this.editing) {
            // Input renders "> " before the text; drop it to edit inline.
            const inputWidth = Math.max(3, out.width - visibleWidth(prefix) + 2);
            const line = this.input.render(inputWidth)[0] ?? "> ";
            out.addWithPrefix(prefix, theme.fg("accent", line.slice(2)));
            return;
        }
        const mark = !multi && this.customPicked ? theme.fg("success", " ✓") : "";
        out.addWithPrefix(prefix, theme.fg(active ? "accent" : "text", value || CUSTOM_PLACEHOLDER) + mark);
    }

    private renderReview(out: LineWriter): void {
        const theme = this.theme;
        this.questions.forEach((question, index) => {
            const answer = this.answers[index]!;
            const value = answer.length > 0 ? theme.fg("text", answer.join(", ")) : theme.fg("muted", "(not answered)");
            out.add(theme.fg("muted", `${truncate(question.header, REVIEW_LABEL_MAX)}:`) + " " + value);
        });
    }

    private renderFooter(): string {
        const theme = this.theme;
        const hint = (key: string, label: string) => theme.fg("text", key) + " " + theme.fg("muted", label);
        const hints: string[] = [];
        if (!this.single) hints.push(hint("⇆", "tab"));
        if (!this.onSubmitTab && !this.editing) hints.push(hint("↑↓", "select"));
        hints.push(hint("enter", this.actionLabel()));
        hints.push(hint("esc", this.editing ? "close" : "dismiss"));
        return hints.join("  ");
    }

    private actionLabel(): string {
        if (this.onSubmitTab) return "submit";
        if (this.question.multiple) {
            if (this.onCustomRow && this.editing) return "done";
            if (this.onCustomRow && !this.custom[this.tab]) return "edit";
            return "toggle";
        }
        if (this.single) return "submit";
        return "confirm";
    }
}
