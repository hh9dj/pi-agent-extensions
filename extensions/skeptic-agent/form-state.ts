import type { Option, Question } from "./schemas";

export interface Answer {
    header: string;
    question: string;
    values: string[];
}

export type RenderOption = Option & { isOther?: boolean };

export const OTHER_LABEL = "Type your own answer";

export interface FormState {
    readonly questions: Question[];
    readonly answers: string[][];
    readonly tab: number;
    readonly optionFocus: readonly number[];
    readonly editingQuestion: number;
}

export function currentOptions(question: Question): RenderOption[] {
    return [...question.options, { label: OTHER_LABEL, isOther: true }];
}

export function customValues(question: Question, answers: string[]): string[] {
    const optionLabels = new Set(question.options.map((o) => o.label));
    return answers.filter((value) => !optionLabels.has(value));
}

export function isAnswered(answers: string[][], index: number): boolean {
    return answers[index].length > 0;
}

export function allAnswered(questions: Question[], answers: string[][]): boolean {
    return questions.every((_, index) => isAnswered(answers, index));
}

export function buildAnswers(questions: Question[], answers: string[][]): Answer[] {
    return questions.map((question, index) => ({
        header: question.header,
        question: question.question,
        values: answers[index] ?? [],
    }));
}
