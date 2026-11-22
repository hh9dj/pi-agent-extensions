/**
 * plan_steps — TypeBox schemas for structured plan creation and step progress tracking.
 */

import { Type, type Static } from "typebox";

export const PlanStepStatusSchema = Type.Enum(
	["pending", "in_progress", "completed", "skipped"],
	{
		type: "string",
		description: "Step status: pending, in_progress, completed, or skipped",
	},
);

export const PlanStepInputSchema = Type.Object({
	id: Type.Optional(
		Type.Integer({
			minimum: 1,
			description: "Optional 1-based step number; auto-numbered sequentially if omitted",
		}),
	),
	title: Type.String({
		minLength: 1,
		description: "Concise step title or action description",
	}),
	details: Type.Optional(
		Type.String({
			description: "Optional implementation details, target files, or verification notes",
		}),
	),
	status: Type.Optional(PlanStepStatusSchema),
	note: Type.Optional(
		Type.String({
			description: "Optional progress note for this step",
		}),
	),
});

export const PlanStepsParamsSchema = Type.Object({
	action: Type.Enum(["set", "update", "list"], {
		type: "string",
		description:
			"'set' creates or replaces the ordered plan steps; 'update' changes one step's status/note; 'list' returns the current plan.",
	}),
	title: Type.Optional(
		Type.String({
			description: "Optional short plan title (used with action 'set')",
		}),
	),
	summary: Type.Optional(
		Type.String({
			description: "Optional brief overview of the plan (used with action 'set')",
		}),
	),
	steps: Type.Optional(
		Type.Array(PlanStepInputSchema, {
			minItems: 1,
			description: "Ordered list of plan steps (required for action 'set')",
		}),
	),
	id: Type.Optional(
		Type.Integer({
			minimum: 1,
			description: "Step number to update (required for action 'update')",
		}),
	),
	status: Type.Optional(PlanStepStatusSchema),
	note: Type.Optional(
		Type.String({
			description: "Optional progress note, outcome, or skip reason (used with action 'update')",
		}),
	),
});

export type PlanStepsParams = Static<typeof PlanStepsParamsSchema>;
