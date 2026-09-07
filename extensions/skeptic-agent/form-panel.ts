import {
    Input,
    Key,
    matchesKey,
    type Component,
    type KeybindingsManager,
    type TUI,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { LineWriter } from "./form-text";
import {
    allAnswered,
    buildAnswers,
    currentOptions,
    isAnswered,
    type Answer,
    type FormState,
    type RenderOption,
} from "./form-state";
import { renderQuestionView, renderReviewView, renderTabBar } from "./form-views";
import type { Question } from "./schemas";

type KeyAction = Parameters<KeybindingsManager["matches"]>[1];

export class FormPanel implements Component {
    private tab = 0;
    private readonly optionFocus: number[];
    private readonly answers: string[][];
    private editingQuestion = -1;
    private cached: string[] | undefined;
    private readonly input = new Input();

    constructor(
        private readonly tui: TUI,
        private readonly theme: Theme,
        private readonly keybindings: KeybindingsManager,
        private readonly done: (value: Answer[] | null) => void,
        private readonly questions: Question[],
    ) {
        this.optionFocus = questions.map(() => 0);
        this.answers = questions.map(() => []);
        this.input.onSubmit = (value) => this.submitDraft(value);
        this.input.onEscape = () => {
            this.leaveEditing();
            this.refresh();
        };
        if (questions[0]!.options.length === 0) {
            this.beginEditing(0, "");
        }
    }

    handleInput(data: string): void {
        if (this.editingQuestion >= 0) {
            this.input.handleInput(data);
            this.refresh();
            return;
        }
        if (this.tab === this.questions.length) {
            this.handleReviewInput(data);
            return;
        }
        this.handleQuestionInput(data);
    }

    render(width: number): string[] {
        if (this.cached) return this.cached;

        const renderWidth = Math.max(1, width);
        const state = this.snapshot();
        const out = new LineWriter(renderWidth);
        const border = this.theme.fg("accent", "─".repeat(renderWidth));

        out.add(border);
        out.addWithPrefix(" ", renderTabBar(state, this.theme));
        out.add("");

        if (state.tab === this.questions.length) {
            out.lines.push(...renderReviewView(state, this.theme, renderWidth));
        } else {
            out.lines.push(
                ...renderQuestionView(state, state.tab, this.theme, this.input, renderWidth),
            );
        }

        out.add("");
        out.add(border);

        this.cached = out.lines;
        return out.lines;
    }

    invalidate(): void {
        this.cached = undefined;
    }

    private get totalTabs(): number {
        return this.questions.length + 1;
    }

    private snapshot(): FormState {
        return {
            questions: this.questions,
            answers: this.answers,
            tab: this.tab,
            optionFocus: this.optionFocus,
            editingQuestion: this.editingQuestion,
        };
    }

    private refresh(): void {
        this.cached = undefined;
        this.tui.requestRender();
    }

    private kb(action: KeyAction, data: string): boolean {
        return this.keybindings.matches(data, action);
    }

    private isUp(data: string): boolean {
        return this.kb("tui.select.up", data);
    }

    private isDown(data: string): boolean {
        return this.kb("tui.select.down", data);
    }

    private isConfirm(data: string): boolean {
        return this.kb("tui.select.confirm", data);
    }

    private isCancel(data: string): boolean {
        return this.kb("tui.select.cancel", data);
    }

    private isNext(data: string): boolean {
        return this.kb("tui.input.tab", data) || this.kb("tui.editor.cursorRight", data);
    }

    private isPrev(data: string): boolean {
        return this.kb("tui.editor.cursorLeft", data) || matchesKey(data, Key.shift("tab"));
    }

    private leaveEditing(): void {
        this.editingQuestion = -1;
        this.input.focused = false;
    }

    private beginEditing(questionIndex: number, initial: string): void {
        this.editingQuestion = questionIndex;
        this.input.setValue(initial);
        this.input.focused = true;
        this.refresh();
    }

    private advance(): void {
        this.goToTab(this.tab < this.questions.length - 1 ? this.tab + 1 : this.questions.length);
    }

    private goToTab(nextTab: number): void {
        this.tab = nextTab;
        if (this.tab === this.questions.length) {
            this.leaveEditing();
            this.refresh();
            return;
        }
        const question = this.questions[this.tab]!;
        if (question.options.length === 0) {
            if (isAnswered(this.answers, this.tab)) {
                this.leaveEditing();
                this.refresh();
            } else {
                this.beginEditing(this.tab, "");
            }
            return;
        }
        this.leaveEditing();
        this.refresh();
    }

    private saveAnswer(questionIndex: number, values: string[]): void {
        this.answers[questionIndex] = values.filter(Boolean);
    }

    private toggleMulti(questionIndex: number, label: string): void {
        const current = this.answers[questionIndex]!;
        this.answers[questionIndex] = current.includes(label)
            ? current.filter((value) => value !== label)
            : [...current, label];
        this.refresh();
    }

    private submitDraft(rawValue: string): void {
        if (this.editingQuestion < 0) return;
        const questionIndex = this.editingQuestion;
        const question = this.questions[questionIndex]!;
        const trimmed = rawValue.trim();
        this.leaveEditing();

        if (question.options.length === 0) {
            this.saveAnswer(questionIndex, [trimmed]);
            this.advance();
            return;
        }

        if (!trimmed) {
            this.refresh();
            return;
        }
        if (question.isMultipleChoice) {
            const current = this.answers[questionIndex]!;
            if (!current.includes(trimmed)) current.push(trimmed);
            this.saveAnswer(questionIndex, current);
            this.refresh();
        } else {
            this.saveAnswer(questionIndex, [trimmed]);
            this.advance();
        }
    }

    private handleReviewInput(data: string): void {
        if (this.isConfirm(data)) {
            if (allAnswered(this.questions, this.answers)) {
                this.done(buildAnswers(this.questions, this.answers));
            }
            return;
        }
        if (this.isCancel(data)) {
            this.done(null);
            return;
        }
        if (this.isPrev(data)) {
            this.goToTab(this.questions.length - 1);
            return;
        }
        if (this.isNext(data)) {
            this.goToTab(0);
        }
    }

    private handleQuestionInput(data: string): void {
        const question = this.questions[this.tab]!;

        if (this.isNext(data)) {
            this.goToTab((this.tab + 1) % this.totalTabs);
            return;
        }
        if (this.isPrev(data)) {
            this.goToTab((this.tab - 1 + this.totalTabs) % this.totalTabs);
            return;
        }

        if (question.options.length === 0) {
            if (this.isConfirm(data)) {
                this.beginEditing(this.tab, this.answers[this.tab]![0] ?? "");
                return;
            }
            if (this.isCancel(data)) {
                this.done(null);
            }
            return;
        }

        const options: RenderOption[] = currentOptions(question);
        const focus = this.optionFocus[this.tab]!;

        if (this.isUp(data)) {
            this.optionFocus[this.tab] = Math.max(0, focus - 1);
            this.refresh();
            return;
        }
        if (this.isDown(data)) {
            this.optionFocus[this.tab] = Math.min(options.length - 1, focus + 1);
            this.refresh();
            return;
        }

        if (question.isMultipleChoice) {
            if (matchesKey(data, Key.space)) {
                const option = options[focus]!;
                if (!option.isOther) {
                    this.toggleMulti(this.tab, option.label);
                }
                return;
            }
            if (this.isConfirm(data)) {
                const option = options[focus]!;
                if (option.isOther) {
                    this.beginEditing(this.tab, "");
                    return;
                }
                if (isAnswered(this.answers, this.tab)) {
                    this.advance();
                }
                return;
            }
        } else {
            if (this.isConfirm(data)) {
                const option = options[focus]!;
                if (option.isOther) {
                    this.beginEditing(this.tab, "");
                    return;
                }
                this.saveAnswer(this.tab, [option.label]);
                this.advance();
                return;
            }
        }

        if (this.isCancel(data)) {
            this.done(null);
        }
    }
}
