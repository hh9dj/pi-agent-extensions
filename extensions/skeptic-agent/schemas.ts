/**
 * skeptic_agent — schemas.
 *
 * Schemas describe what the LLM is allowed to pass to this tool. pi uses them
 * to (a) validate the call and (b) tell the model what arguments exist.
 *
 * The shape mirrors opencode's `question` tool: each question has a list of
 * options and an optional `multiple` flag. The UI always adds a
 * "Type your own answer" row, so `options: []` means a free-text answer.
 *
 * Learn Typebox: https://github.com/sinclairzx81/typebox
 */

import { Type, type Static } from "typebox";

// One option in a question.
const OptionSchema = Type.Object({
    label: Type.String({ description: "Display text (1-5 words, concise)" }),
    description: Type.String({ description: "Explanation of choice" }),
});

// A single question — the type the TUI form consumes.
const QuestionSchema = Type.Object({
    question: Type.String({ description: "Complete question", minLength: 1 }),
    header: Type.String({ description: "Very short label (max 30 chars)", maxLength: 30 }),
    options: Type.Array(OptionSchema, { description: "Available choices" }),
    multiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple choices" })),
});

// The top-level shape the LLM sends: `{ questions: [...] }`.
export const AskUserParamsSchema = Type.Object({
    questions: Type.Array(QuestionSchema, { description: "Questions to ask", minItems: 1 }),
});

// TypeScript types derived from the schemas.
export type AskUserParams = Static<typeof AskUserParamsSchema>;
export type Question = Static<typeof QuestionSchema>;
export type Option = Static<typeof OptionSchema>;
