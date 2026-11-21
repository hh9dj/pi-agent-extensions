// Pure helpers for the question form. No TUI imports.
import type { Question } from "./schemas";

export const CUSTOM_PLACEHOLDER = "Type your own answer";

// One question with a single choice is answered and submitted in one step:
// no tab bar, no Submit tab.
export function isSingle(questions: Question[]): boolean {
    return questions.length === 1 && questions[0]!.multiple !== true;
}

// Question tabs plus the Submit tab (except in single mode).
export function tabCount(questions: Question[]): number {
    return isSingle(questions) ? 1 : questions.length + 1;
}

// Options plus the custom "Type your own answer" row.
export function rowCount(question: Question): number {
    return question.options.length + 1;
}

// Row to focus when a tab opens: the picked option, else the custom row when
// the custom value is picked, else the first row.
export function pickedIndex(question: Question, answer: string[], custom: string): number {
    const index = question.options.findIndex((option) => answer.includes(option.label));
    if (index >= 0) return index;
    if (custom && answer.includes(custom)) return question.options.length;
    return 0;
}

export function toggle(values: string[], value: string): string[] {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

// Replace the previous custom value in a multi-select answer.
export function replaceCustom(values: string[], previous: string, next: string): string[] {
    const rest = previous ? values.filter((item) => item !== previous) : values;
    return next && !rest.includes(next) ? [...rest, next] : rest;
}
