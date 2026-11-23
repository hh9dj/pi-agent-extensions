/**
 * subagent — TUI renderCall and renderResult components.
 */

import * as os from "node:os";
import {
	getMarkdownTheme,
	type AgentToolResult,
	type Theme,
	type ThemeColor,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, type Component } from "@earendil-works/pi-tui";
import { DEFAULT_AGENT_NAME } from "./agents";
import {
	getDisplayItems,
	getFinalOutput,
	isFailedResult,
	type DisplayItem,
	type SingleResult,
	type SubagentDetails,
	type UsageStats,
} from "./runner-common";
import type { SubagentParams } from "./schemas";

const COLLAPSED_ITEM_COUNT = 10;

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(usage: Partial<UsageStats>, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function aggregateUsage(results: SingleResult[]): Partial<UsageStats> {
	const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
	for (const r of results) {
		total.input += r.usage.input;
		total.output += r.usage.output;
		total.cacheRead += r.usage.cacheRead;
		total.cacheWrite += r.usage.cacheWrite;
		total.cost += r.usage.cost;
		total.turns += r.usage.turns;
	}
	return total;
}

function shortenPath(rawPath: string): string {
	const home = os.homedir();
	return rawPath.startsWith(home) ? `~${rawPath.slice(home.length)}` : rawPath;
}

function formatLineRange(offset: unknown, limit: unknown): string {
	const start = typeof offset === "number" && Number.isFinite(offset) ? offset : undefined;
	const count = typeof limit === "number" && Number.isFinite(limit) ? limit : undefined;
	if (start !== undefined && count !== undefined) return `:${start}-${start + count - 1}`;
	if (start !== undefined) return `:${start}+`;
	if (count !== undefined) return `:1-${count}`;
	return "";
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	fg: (color: ThemeColor, text: string) => string,
): string {
	switch (toolName) {
		case "bash": {
			const command = typeof args.command === "string" ? args.command : "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return fg("muted", "$ ") + fg("toolOutput", preview);
		}
		case "read": {
			const rawPath = String(args.file_path ?? args.path ?? "...");
			const range = formatLineRange(args.offset, args.limit);
			let text = fg("accent", shortenPath(rawPath));
			if (range) text += fg("warning", range);
			return fg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = String(args.file_path ?? args.path ?? "...");
			const content = typeof args.content === "string" ? args.content : "";
			const lines = content ? content.split("\n").length : 0;
			let text = fg("muted", "write ") + fg("accent", shortenPath(rawPath));
			if (lines > 1) text += fg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = String(args.file_path ?? args.path ?? "...");
			return fg("muted", "edit ") + fg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = String(args.path ?? ".");
			return fg("muted", "ls ") + fg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = String(args.pattern ?? "*");
			const rawPath = String(args.path ?? ".");
			return fg("muted", "find ") + fg("accent", pattern) + fg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = String(args.pattern ?? "");
			const rawPath = String(args.path ?? ".");
			return fg("muted", "grep ") + fg("accent", `/${pattern}/`) + fg("dim", ` in ${shortenPath(rawPath)}`);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return fg("accent", toolName) + fg("dim", ` ${preview}`);
		}
	}
}

function statusIcon(result: SingleResult, theme: Theme): string {
	if (result.exitCode === -1) return theme.fg("warning", "⏳");
	return isFailedResult(result) ? theme.fg("error", "✗") : theme.fg("success", "✓");
}

function agentMetaLabel(result: SingleResult, theme: Theme): string {
	return theme.fg("muted", ` (${result.agentSource} · ${result.runtime})`);
}

function renderDisplayItemsText(
	items: DisplayItem[],
	theme: Theme,
	expanded: boolean,
	limit?: number,
): string {
	const toShow = limit ? items.slice(-limit) : items;
	const skipped = limit && items.length > limit ? items.length - limit : 0;
	let text = "";
	if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
	for (const item of toShow) {
		if (item.type === "text") {
			const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
			text += `${theme.fg("toolOutput", preview)}\n`;
		} else {
			text += `${theme.fg("muted", "→ ")}${formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
		}
	}
	return text.trimEnd();
}

export function renderSubagentCall(args: SubagentParams, theme: Theme): Component {
	const runtimeSuffix = args.runtime ? theme.fg("muted", ` (${args.runtime})`) : "";

	if (args.chain && args.chain.length > 0) {
		let text =
			theme.fg("toolTitle", theme.bold("subagent ")) +
			theme.fg("accent", `chain (${args.chain.length} steps)`) +
			runtimeSuffix;

		for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
			const step = args.chain[i];
			const agentName = step.agent || DEFAULT_AGENT_NAME;
			const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
			const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
			text +=
				"\n  " +
				theme.fg("muted", `${i + 1}. `) +
				theme.fg("accent", agentName) +
				(step.runtime ? theme.fg("muted", ` (${step.runtime})`) : "") +
				theme.fg("dim", ` ${preview}`);
		}
		if (args.chain.length > 3) {
			text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
		}
		return new Text(text, 0, 0);
	}

	if (args.tasks && args.tasks.length > 0) {
		let text =
			theme.fg("toolTitle", theme.bold("subagent ")) +
			theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
			runtimeSuffix;

		for (const item of args.tasks.slice(0, 3)) {
			const agentName = item.agent || DEFAULT_AGENT_NAME;
			const preview = item.task.length > 40 ? `${item.task.slice(0, 40)}...` : item.task;
			text +=
				`\n  ${theme.fg("accent", agentName)}` +
				(item.runtime ? theme.fg("muted", ` (${item.runtime})`) : "") +
				theme.fg("dim", ` ${preview}`);
		}
		if (args.tasks.length > 3) {
			text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
		}
		return new Text(text, 0, 0);
	}

	const agentName = args.agent || DEFAULT_AGENT_NAME;
	const preview = args.task
		? args.task.length > 60
			? `${args.task.slice(0, 60)}...`
			: args.task
		: "...";

	const text =
		theme.fg("toolTitle", theme.bold("subagent ")) +
		theme.fg("accent", agentName) +
		runtimeSuffix +
		`\n  ${theme.fg("dim", preview)}`;
	return new Text(text, 0, 0);
}

export function renderSubagentResult(
	result: AgentToolResult<SubagentDetails>,
	options: ToolRenderResultOptions,
	theme: Theme,
): Component {
	const { expanded } = options;
	const details = result.details;

	if (!details || details.results.length === 0) {
		const first = result.content[0];
		return new Text(first?.type === "text" ? first.text : "(no output)", 0, 0);
	}

	const mdTheme = getMarkdownTheme();

	if (details.mode === "single" && details.results.length === 1) {
		const r = details.results[0];
		const isRunning = r.exitCode === -1;
		const isError = !isRunning && isFailedResult(r);
		const icon = statusIcon(r, theme);
		const displayItems = getDisplayItems(r.messages);
		const finalOutput = getFinalOutput(r.messages);

		if (expanded && !isRunning) {
			const container = new Container();
			let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${agentMetaLabel(r, theme)}`;
			if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
			container.addChild(new Text(header, 0, 0));

			if (isError && (r.errorMessage || r.stderr)) {
				container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage || r.stderr}`), 0, 0));
			}

			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
			container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));

			if (displayItems.length === 0 && !finalOutput) {
				container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
			} else {
				for (const item of displayItems) {
					if (item.type === "toolCall") {
						container.addChild(
							new Text(
								theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
								0,
								0,
							),
						);
					}
				}
				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
				}
			}

			const usageStr = formatUsageStats(r.usage, r.model);
			if (usageStr) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
			}
			return container;
		}

		let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${agentMetaLabel(r, theme)}`;
		if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;

		if (isError && (r.errorMessage || r.stderr)) {
			text += `\n${theme.fg("error", `Error: ${r.errorMessage || r.stderr}`)}`;
		} else if (displayItems.length === 0) {
			text += `\n${theme.fg("muted", isRunning ? "(running...)" : "(no output)")}`;
		} else {
			text += `\n${renderDisplayItemsText(displayItems, theme, false, COLLAPSED_ITEM_COUNT)}`;
			if (displayItems.length > COLLAPSED_ITEM_COUNT) {
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
			}
		}

		const usageStr = formatUsageStats(r.usage, r.model);
		if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
		return new Text(text, 0, 0);
	}

	if (details.mode === "chain") {
		const running = details.results.filter((r) => r.exitCode === -1).length;
		const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
		const isRunning = running > 0;
		const icon = isRunning
			? theme.fg("warning", "⏳")
			: successCount === details.results.length
				? theme.fg("success", "✓")
				: theme.fg("error", "✗");

		if (expanded && !isRunning) {
			const container = new Container();
			container.addChild(
				new Text(
					`${icon} ${theme.fg("toolTitle", theme.bold("chain "))}${theme.fg("accent", `${successCount}/${details.results.length} steps`)}`,
					0,
					0,
				),
			);

			for (const r of details.results) {
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				container.addChild(new Spacer(1));
				container.addChild(
					new Text(
						`${theme.fg("muted", `─── Step ${r.step ?? "?"}: `)}${theme.fg("accent", r.agent)}${agentMetaLabel(r, theme)} ${statusIcon(r, theme)}`,
						0,
						0,
					),
				);
				container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

				for (const item of displayItems) {
					if (item.type === "toolCall") {
						container.addChild(
							new Text(
								theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
								0,
								0,
							),
						);
					}
				}
				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
				}

				const stepUsage = formatUsageStats(r.usage, r.model);
				if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
			}

			const totalUsage = formatUsageStats(aggregateUsage(details.results));
			if (totalUsage) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", `Total: ${totalUsage}`), 0, 0));
			}
			return container;
		}

		let text = `${icon} ${theme.fg("toolTitle", theme.bold("chain "))}${theme.fg("accent", `${successCount}/${details.results.length} steps`)}`;
		for (const r of details.results) {
			const displayItems = getDisplayItems(r.messages);
			text += `\n\n${theme.fg("muted", `─── Step ${r.step ?? "?"}: `)}${theme.fg("accent", r.agent)}${agentMetaLabel(r, theme)} ${statusIcon(r, theme)}`;
			if (displayItems.length === 0) {
				text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
			} else {
				text += `\n${renderDisplayItemsText(displayItems, theme, false, 5)}`;
			}
		}
		if (!isRunning) {
			const totalUsage = formatUsageStats(aggregateUsage(details.results));
			if (totalUsage) text += `\n\n${theme.fg("dim", `Total: ${totalUsage}`)}`;
		}
		text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
		return new Text(text, 0, 0);
	}

	if (details.mode === "parallel") {
		const running = details.results.filter((r) => r.exitCode === -1).length;
		const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
		const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
		const isRunning = running > 0;
		const icon = isRunning
			? theme.fg("warning", "⏳")
			: failCount > 0
				? theme.fg("warning", "◐")
				: theme.fg("success", "✓");
		const status = isRunning
			? `${successCount + failCount}/${details.results.length} done, ${running} running`
			: `${successCount}/${details.results.length} tasks`;

		if (expanded && !isRunning) {
			const container = new Container();
			container.addChild(
				new Text(
					`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
					0,
					0,
				),
			);

			for (const r of details.results) {
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				container.addChild(new Spacer(1));
				container.addChild(
					new Text(
						`${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)}${agentMetaLabel(r, theme)} ${statusIcon(r, theme)}`,
						0,
						0,
					),
				);
				container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

				for (const item of displayItems) {
					if (item.type === "toolCall") {
						container.addChild(
							new Text(
								theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
								0,
								0,
							),
						);
					}
				}
				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
				}

				const taskUsage = formatUsageStats(r.usage, r.model);
				if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
			}

			const totalUsage = formatUsageStats(aggregateUsage(details.results));
			if (totalUsage) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", `Total: ${totalUsage}`), 0, 0));
			}
			return container;
		}

		let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
		for (const r of details.results) {
			const displayItems = getDisplayItems(r.messages);
			text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)}${agentMetaLabel(r, theme)} ${statusIcon(r, theme)}`;
			if (displayItems.length === 0) {
				text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
			} else {
				text += `\n${renderDisplayItemsText(displayItems, theme, false, 5)}`;
			}
		}
		if (!isRunning) {
			const totalUsage = formatUsageStats(aggregateUsage(details.results));
			if (totalUsage) text += `\n\n${theme.fg("dim", `Total: ${totalUsage}`)}`;
		}
		if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
		return new Text(text, 0, 0);
	}

	const first = result.content[0];
	return new Text(first?.type === "text" ? first.text : "(no output)", 0, 0);
}
