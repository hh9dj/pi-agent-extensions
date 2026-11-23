/**
 * subagent — delegate tasks to specialized sub-agents using either
 * in-process SDK sessions (`createAgentSession`) or isolated subprocesses
 * (`pi --mode json -p --no-session`).
 *
 * Modes:
 *   - Single:   { agent?, task, cwd?, runtime? }
 *   - Parallel: { tasks: [{ agent?, task, cwd?, runtime? }, ...] }
 *   - Chain:    { chain: [{ agent?, task, cwd?, runtime? }, ...] }
 *
 * Discovery:
 *   - Always loads bundled agents and user agents (~/.pi/agent/agents/*.md).
 *   - Automatically includes project agents (.pi/agents/*.md) only when
 *     `ctx.isProjectTrusted()` is true.
 *   - Injects the fresh, sorted agent list into the system prompt via
 *     `before_agent_start`.
 */

import * as path from "node:path";
import type {
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_AGENT_NAME,
	discoverAgents,
	formatAvailableAgents,
	type AgentConfig,
} from "./agents";
import { renderSubagentCall, renderSubagentResult } from "./render";
import {
	createEmptyUsage,
	createUnknownAgentResult,
	getFinalOutput,
	getResultOutput,
	getSubagentDepth,
	getSubagentMaxDepth,
	isFailedResult,
	mapWithConcurrencyLimit,
	MAX_CONCURRENCY,
	MAX_PARALLEL_TASKS,
	truncateParallelOutput,
	type OnUpdateCallback,
	type SingleResult,
	type SubagentDetails,
} from "./runner-common";
import { runInProcessAgent } from "./runner-inprocess";
import { runSubprocessAgent } from "./runner-subprocess";
import {
	SubagentParamsSchema,
	type AgentRuntime,
	type SubagentParams,
} from "./schemas";

const TOOL_DESCRIPTION = [
	"Delegate tasks to specialized sub-agents with isolated context windows.",
	"Modes: single ({ agent?, task }), parallel ({ tasks: [...] }), or chain ({ chain: [...] } with {previous} placeholder).",
	`When "agent" is omitted, defaults to "${DEFAULT_AGENT_NAME}".`,
	"See <available_subagents> in the system prompt for currently available agent names, runtimes, and descriptions.",
].join(" ");

function resolveWorkingDir(baseCwd: string, customCwd: string | undefined): string {
	if (!customCwd) return baseCwd;
	return path.resolve(baseCwd, customCwd);
}

async function runAgent(options: {
	ctx: ExtensionContext;
	agents: AgentConfig[];
	agentName: string;
	task: string;
	cwd: string | undefined;
	runtimeOverride: AgentRuntime | undefined;
	step: number | undefined;
	signal: AbortSignal | undefined;
	onUpdate: OnUpdateCallback | undefined;
	makeDetails: (results: SingleResult[]) => SubagentDetails;
}): Promise<SingleResult> {
	const {
		ctx,
		agents,
		agentName,
		task,
		cwd,
		runtimeOverride,
		step,
		signal,
		onUpdate,
		makeDetails,
	} = options;

	const agent = agents.find((a) => a.name === agentName);
	if (!agent) {
		return createUnknownAgentResult(agentName, agents, task, step);
	}

	const effectiveRuntime = runtimeOverride ?? agent.runtime;
	const resolvedCwd = resolveWorkingDir(ctx.cwd, cwd);
	const runnerOptions = {
		agent,
		task,
		cwd: resolvedCwd,
		step,
		signal,
		onUpdate,
		makeDetails,
		ctx,
	};

	if (effectiveRuntime === "in-process") {
		return runInProcessAgent(runnerOptions);
	}
	return runSubprocessAgent(runnerOptions);
}

function formatAgentsForSystemPrompt(agents: AgentConfig[]): string {
	const entries = agents
		.map((a) => `- ${a.name} (${a.runtime}, ${a.source}): ${a.description}`)
		.join("\n");
	return `<available_subagents>\n${entries}\n</available_subagents>`;
}

function formatAgentsReport(cwd: string, projectTrusted: boolean): string {
	const discovery = discoverAgents(cwd, projectTrusted);
	const projectStatus = projectTrusted
		? discovery.projectAgentsDir ?? "(none found)"
		: "(ignored — project not trusted)";

	const lines: string[] = [
		`Sub-agents (projectTrusted: ${projectTrusted}, depth: ${getSubagentDepth()}/${getSubagentMaxDepth()})`,
		`Bundled dir: ${discovery.bundledAgentsDir}`,
		`User dir: ${discovery.userAgentsDir}`,
		`Project dir: ${projectStatus}`,
		"",
	];

	if (discovery.agents.length === 0) {
		lines.push("No agents found.");
		return lines.join("\n");
	}

	for (const agent of discovery.agents) {
		const model = agent.model ?? "inherit";
		const tools = agent.tools ? agent.tools.join(", ") : "default";
		const extensions =
			agent.extensions === undefined
				? agent.runtime === "in-process"
					? "default (codemode + inherited providers)"
					: "default (all)"
				: Array.isArray(agent.extensions)
					? agent.extensions.join(", ")
					: agent.extensions;
		lines.push(
			`- ${agent.name} [${agent.source} | ${agent.runtime}] model=${model} tools=${tools} extensions=${extensions}`,
		);
		lines.push(`  ${agent.description}`);
		if (agent.filePath) {
			lines.push(`  file: ${agent.filePath}`);
		}
	}

	return lines.join("\n");
}

export default function initExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event, ctx) => {
		if (!pi.getActiveTools().includes("subagent")) return undefined;
		if (getSubagentDepth() >= getSubagentMaxDepth()) return undefined;
		const { agents } = discoverAgents(ctx.cwd, ctx.isProjectTrusted());
		if (agents.length === 0) return undefined;

		const section = formatAgentsForSystemPrompt(agents);
		return {
			systemPrompt: `${event.systemPrompt}\n\n${section}`,
		};
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: TOOL_DESCRIPTION,
		promptSnippet:
			"Delegate focused, parallel, or chained tasks to isolated sub-agents (in-process or subprocess)",
		promptGuidelines: [
			"Use subagent to keep noisy exploration, log analysis, or independent parallel work out of the main context window.",
			"Prefer fast in-process agents (such as scout, planner, reviewer) for read-only exploration and analysis, and subprocess agents (such as worker, tester, fixer) for shell commands or file edits.",
			"Do not run parallel sub-agents that edit the same files simultaneously.",
		],
		parameters: SubagentParamsSchema,

		async execute(
			_toolCallId: string,
			params: SubagentParams,
			signal: AbortSignal | undefined,
			onUpdate: AgentToolUpdateCallback<SubagentDetails> | undefined,
			ctx: ExtensionContext,
		) {
			const projectTrusted = ctx.isProjectTrusted();
			const discovery = discoverAgents(ctx.cwd, projectTrusted);
			const agents = discovery.agents;

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					projectTrusted,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});

			const depth = getSubagentDepth();
			const maxDepth = getSubagentMaxDepth();
			if (depth >= maxDepth) {
				return {
					content: [
						{
							type: "text",
							text: `Subagent nesting limit reached (depth ${depth} >= max ${maxDepth}). Set PI_SUBAGENT_MAX_DEPTH to allow deeper nesting.`,
						},
					],
					details: makeDetails("single")([]),
					isError: true,
				};
			}

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			if (modeCount !== 1) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode: single ({ task, agent? }), parallel ({ tasks }), or chain ({ chain }).\nAvailable agents: ${formatAvailableAgents(agents)}`,
						},
					],
					details: makeDetails("single")([]),
					isError: true,
				};
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const agentName = step.agent || DEFAULT_AGENT_NAME;
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								const current = partial.details?.results[0];
								if (!current) return;
								onUpdate({
									content: partial.content,
									details: makeDetails("chain")([...results, current]),
								});
							}
						: undefined;

					const result = await runAgent({
						ctx,
						agents,
						agentName,
						task: taskWithContext,
						cwd: step.cwd ?? params.cwd,
						runtimeOverride: step.runtime ?? params.runtime,
						step: i + 1,
						signal,
						onUpdate: chainUpdate,
						makeDetails: makeDetails("chain"),
					});
					results.push(result);

					if (isFailedResult(result)) {
						const errorMsg = getResultOutput(result);
						return {
							content: [
								{
									type: "text",
									text: `Chain stopped at step ${i + 1} (${agentName}): ${errorMsg}`,
								},
							],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}

				const lastResult = results[results.length - 1];
				return {
					content: [{ type: "text", text: getFinalOutput(lastResult.messages) || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Maximum is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
						isError: true,
					};
				}

				const allResults: SingleResult[] = params.tasks.map((item) => {
					const agentName = item.agent || DEFAULT_AGENT_NAME;
					const matched = agents.find((a) => a.name === agentName);
					return {
						agent: agentName,
						agentSource: matched?.source ?? "unknown",
						runtime: item.runtime ?? params.runtime ?? matched?.runtime ?? "subprocess",
						task: item.task,
						exitCode: -1,
						messages: [],
						stderr: "",
						usage: createEmptyUsage(),
					};
				});

				const emitParallelUpdate = () => {
					if (!onUpdate) return;
					const running = allResults.filter((r) => r.exitCode === -1).length;
					const done = allResults.length - running;
					onUpdate({
						content: [
							{
								type: "text",
								text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
							},
						],
						details: makeDetails("parallel")([...allResults]),
					});
				};

				emitParallelUpdate();

				const results = await mapWithConcurrencyLimit(
					params.tasks,
					MAX_CONCURRENCY,
					async (item, index) => {
						const agentName = item.agent || DEFAULT_AGENT_NAME;
						const result = await runAgent({
							ctx,
							agents,
							agentName,
							task: item.task,
							cwd: item.cwd ?? params.cwd,
							runtimeOverride: item.runtime ?? params.runtime,
							step: undefined,
							signal,
							onUpdate: (partial) => {
								if (partial.details?.results[0]) {
									allResults[index] = partial.details.results[0];
									emitParallelUpdate();
								}
							},
							makeDetails: makeDetails("parallel"),
						});
						allResults[index] = result;
						emitParallelUpdate();
						return result;
					},
				);

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateParallelOutput(getResultOutput(r));
					const status = isFailedResult(r)
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "completed";
					return `### [${r.agent} · ${r.runtime}] ${status}\n\n${output}`;
				});

				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
					isError: successCount === 0,
				};
			}

			const agentName = params.agent || DEFAULT_AGENT_NAME;
			const result = await runAgent({
				ctx,
				agents,
				agentName,
				task: params.task!,
				cwd: params.cwd,
				runtimeOverride: params.runtime,
				step: undefined,
				signal,
				onUpdate,
				makeDetails: makeDetails("single"),
			});

			if (isFailedResult(result)) {
				const errorMsg = getResultOutput(result);
				return {
					content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
					details: makeDetails("single")([result]),
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
				details: makeDetails("single")([result]),
			};
		},

		renderCall(args, theme) {
			return renderSubagentCall(args, theme);
		},

		renderResult(result, options, theme) {
			return renderSubagentResult(result, options, theme);
		},
	});

	pi.registerCommand("subagents", {
		description: "List discovered sub-agents for the current directory and trust state",
		handler: async (_args, ctx) => {
			const report = formatAgentsReport(ctx.cwd, ctx.isProjectTrusted());
			if (ctx.hasUI) {
				ctx.ui.notify(report, "info");
			} else {
				console.log(report);
			}
		},
	});
}
