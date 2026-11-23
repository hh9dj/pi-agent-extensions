/**
 * subagent — TypeBox schemas for single, parallel, and chained delegation.
 */

import { Type, type Static } from "typebox";

export const AgentRuntimeSchema = Type.Enum(["in-process", "subprocess"], {
	type: "string",
	description:
		'Execution runtime override. "in-process" uses createAgentSession() for fast runs; "subprocess" spawns an isolated `pi --mode json` process.',
});

export const TaskItemSchema = Type.Object({
	agent: Type.Optional(
		Type.String({
			minLength: 1,
			description: 'Name of the agent to invoke. Defaults to "worker" when omitted.',
		}),
	),
	task: Type.String({
		minLength: 1,
		description: "Task to delegate to the sub-agent.",
	}),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the sub-agent.",
		}),
	),
	runtime: Type.Optional(AgentRuntimeSchema),
});

export const ChainStepSchema = Type.Object({
	agent: Type.Optional(
		Type.String({
			minLength: 1,
			description: 'Name of the agent to invoke for this step. Defaults to "worker" when omitted.',
		}),
	),
	task: Type.String({
		minLength: 1,
		description: "Task for this step. Use {previous} to inject the previous step's final output.",
	}),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for this step.",
		}),
	),
	runtime: Type.Optional(AgentRuntimeSchema),
});

export const SubagentParamsSchema = Type.Object({
	agent: Type.Optional(
		Type.String({
			minLength: 1,
			description: 'Name of the agent to invoke in single mode. Defaults to "worker" when omitted.',
		}),
	),
	task: Type.Optional(
		Type.String({
			minLength: 1,
			description: "Task to delegate in single mode.",
		}),
	),
	tasks: Type.Optional(
		Type.Array(TaskItemSchema, {
			minItems: 1,
			description: "Array of independent tasks to run in parallel.",
		}),
	),
	chain: Type.Optional(
		Type.Array(ChainStepSchema, {
			minItems: 1,
			description: "Ordered array of steps to run sequentially with {previous} substitution.",
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for single mode.",
		}),
	),
	runtime: Type.Optional(AgentRuntimeSchema),
});

export type AgentRuntime = Static<typeof AgentRuntimeSchema>;
export type TaskItem = Static<typeof TaskItemSchema>;
export type ChainStep = Static<typeof ChainStepSchema>;
export type SubagentParams = Static<typeof SubagentParamsSchema>;
