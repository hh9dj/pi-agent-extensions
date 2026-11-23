/**
 * subagent — shared runner types, recursion guards, usage accounting, and formatting helpers.
 */

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, AgentSource } from "./agents";
import type { AgentRuntime } from "./schemas";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const PER_TASK_OUTPUT_CAP = 50 * 1024;

export const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
export const SUBAGENT_MAX_DEPTH_ENV = "PI_SUBAGENT_MAX_DEPTH";
export const DEFAULT_MAX_DEPTH = 1;

export interface SubagentTextBlock {
	type: "text";
	text: string;
}

export interface SubagentToolCallBlock {
	type: "toolCall";
	name: string;
	arguments: Record<string, unknown>;
}

export type SubagentContentBlock =
	| SubagentTextBlock
	| SubagentToolCallBlock
	| { type: string; [key: string]: unknown };

export interface SubagentMessageUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: {
		total?: number;
	};
}

export interface SubagentMessage {
	role: string;
	content: string | SubagentContentBlock[];
	usage?: SubagentMessageUsage;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	agent: string;
	agentSource: AgentSource;
	runtime: AgentRuntime;
	task: string;
	exitCode: number;
	messages: SubagentMessage[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	projectTrusted: boolean;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

export function createEmptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getSubagentDepth(): number {
	return parseNonNegativeInt(process.env[SUBAGENT_DEPTH_ENV], 0);
}

export function getSubagentMaxDepth(): number {
	return parseNonNegativeInt(process.env[SUBAGENT_MAX_DEPTH_ENV], DEFAULT_MAX_DEPTH);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function toSubagentMessage(raw: unknown): SubagentMessage | null {
	if (!isRecord(raw) || typeof raw.role !== "string") return null;
	const content = raw.content;
	if (typeof content !== "string" && !Array.isArray(content)) return null;

	return {
		role: raw.role,
		content: content as string | SubagentContentBlock[],
		usage: isRecord(raw.usage) ? (raw.usage as SubagentMessageUsage) : undefined,
		model: typeof raw.model === "string" ? raw.model : undefined,
		stopReason: typeof raw.stopReason === "string" ? raw.stopReason : undefined,
		errorMessage: typeof raw.errorMessage === "string" ? raw.errorMessage : undefined,
	};
}

export function recordMessage(result: SingleResult, msg: SubagentMessage): void {
	result.messages.push(msg);

	if (msg.role === "assistant") {
		result.usage.turns++;
		const usage = msg.usage;
		if (usage) {
			result.usage.input += usage.input || 0;
			result.usage.output += usage.output || 0;
			result.usage.cacheRead += usage.cacheRead || 0;
			result.usage.cacheWrite += usage.cacheWrite || 0;
			result.usage.cost += usage.cost?.total || 0;
			result.usage.contextTokens = usage.totalTokens || 0;
		}
		if (!result.model && msg.model) result.model = msg.model;
		if (msg.stopReason) result.stopReason = msg.stopReason;
		if (msg.errorMessage) result.errorMessage = msg.errorMessage;
	}
}

export function getFinalOutput(messages: SubagentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		if (typeof msg.content === "string") {
			if (msg.content.trim()) return msg.content;
			continue;
		}
		const textParts: string[] = [];
		for (const part of msg.content) {
			if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
				textParts.push(part.text);
			}
		}
		if (textParts.length > 0) return textParts.join("\n");
	}
	return "";
}

export function getDisplayItems(messages: SubagentMessage[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		if (typeof msg.content === "string") {
			if (msg.content.trim()) items.push({ type: "text", text: msg.content });
			continue;
		}
		for (const part of msg.content) {
			if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
				items.push({ type: "text", text: part.text });
			} else if (part.type === "toolCall" && typeof part.name === "string") {
				const args = isRecord(part.arguments) ? part.arguments : {};
				items.push({ type: "toolCall", name: part.name, args });
			}
		}
	}
	return items;
}

export function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

export function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

export function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	const omitted = byteLength - Buffer.byteLength(truncated, "utf8");
	return `${truncated}\n\n[Output truncated: ${omitted} bytes omitted. Full output preserved in tool details.]`;
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;

	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});

	await Promise.all(workers);
	return results;
}

export function createUnknownAgentResult(
	agentName: string,
	agents: AgentConfig[],
	task: string,
	step: number | undefined,
): SingleResult {
	const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
	return {
		agent: agentName,
		agentSource: "unknown",
		runtime: "subprocess",
		task,
		exitCode: 1,
		messages: [],
		stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
		usage: createEmptyUsage(),
		step,
	};
}
