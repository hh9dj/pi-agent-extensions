/**
 * plan-mode — read-only planning workflow with structured step tracking,
 * persistent `.plan/plan-{date-time}.md` files, centered `/todos` overlay,
 * and Zentui indicator integration.
 */

import { relative } from "node:path";
import type {
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { savePlanMarkdownFile } from "./plan-file";
import { PlanProgressOverlay } from "./progress-overlay";
import { PlanStepsParamsSchema, type PlanStepsParams } from "./schemas";
import {
	checkBashCommand,
	computeExecutionModeTools,
	computePlanModeTools,
	computeRestoredTools,
	filterStaleContextMessages,
	formatStepsForContext,
	getNextActionableStep,
	getPhase,
	getPlanStats,
	isPlanComplete,
	normalizeSteps,
	PLAN_EXECUTION_CONTEXT_TYPE,
	PLAN_MODE_CONTEXT_TYPE,
	PLAN_MODE_DISABLED_TOOLS,
	PLAN_MODE_ENTRY_TYPE,
	PLAN_TOOL_NAME,
	updateStepStatus,
	type PlanModeState,
	type PlanStep,
	type PlanStepStatus,
} from "./utils";
import { clearPlanIndicators, syncPlanIndicators } from "./zentui";

interface PlanStepsToolDetails {
	action: "set" | "update" | "list";
	steps: PlanStep[];
	updatedId?: number;
	planFileRelative?: string;
}

const MAX_WIDGET_STEPS = 6;
const WIDGET_KEY = "plan-todos";

function formatDisplayPath(cwd: string, filePath: string | undefined): string | undefined {
	if (!filePath) return undefined;
	const rel = relative(cwd, filePath);
	if (rel && !rel.startsWith("..")) return rel;
	return filePath;
}

function stepMarkerPlain(status: PlanStepStatus): string {
	switch (status) {
		case "completed":
			return "✓";
		case "in_progress":
			return "◐";
		case "skipped":
			return "⊘";
		case "pending":
			return "○";
	}
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let steps: PlanStep[] = [];
	let toolsBeforePlanMode: string[] | undefined;
	let planFilePath: string | undefined;
	let planTitle: string | undefined;
	let planSummary: string | undefined;
	let createdAt: string | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only planning workflow)",
		type: "boolean",
		default: false,
	});

	function snapshotState(): PlanModeState {
		return {
			enabled: planModeEnabled,
			executing: executionMode,
			steps: steps.map((s) => ({ ...s })),
			toolsBeforePlanMode: toolsBeforePlanMode ? [...toolsBeforePlanMode] : undefined,
			planFilePath,
			title: planTitle,
			summary: planSummary,
			createdAt,
		};
	}

	function persistState(): void {
		pi.appendEntry(PLAN_MODE_ENTRY_TYPE, snapshotState());
	}

	function captureToolsBeforePlanMode(): string[] {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools().filter((name) => name !== PLAN_TOOL_NAME);
		}
		return toolsBeforePlanMode;
	}

	function applyPlanModeTools(): void {
		const saved = captureToolsBeforePlanMode();
		pi.setActiveTools(computePlanModeTools(saved));
	}

	function applyExecutionModeTools(): void {
		const saved = captureToolsBeforePlanMode();
		pi.setActiveTools(computeExecutionModeTools(saved));
	}

	function restorePreviousTools(): void {
		const current = pi.getActiveTools();
		const restored = computeRestoredTools(toolsBeforePlanMode, current);
		toolsBeforePlanMode = undefined;
		pi.setActiveTools(restored);
	}

	function deactivatePlanToolIfIdle(): void {
		const current = pi.getActiveTools();
		if (current.includes(PLAN_TOOL_NAME)) {
			pi.setActiveTools(current.filter((name) => name !== PLAN_TOOL_NAME));
		}
	}

	function updateWidget(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (!executionMode || steps.length === 0) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}

		const th = ctx.ui.theme;
		const stats = getPlanStats(steps);
		const visible = steps.slice(0, MAX_WIDGET_STEPS);
		const lines = visible.map((step) => {
			if (step.status === "completed") {
				return `${th.fg("success", "✓")} ${th.fg("muted", `${step.id}. ${th.strikethrough(step.title)}`)}`;
			}
			if (step.status === "skipped") {
				return `${th.fg("muted", "⊘")} ${th.fg("dim", `${step.id}. ${step.title} (skipped)`)}`;
			}
			if (step.status === "in_progress") {
				return `${th.fg("accent", "◐")} ${th.bold(`${step.id}. ${step.title}`)}`;
			}
			return `${th.fg("dim", "○")} ${th.fg("text", `${step.id}. ${step.title}`)}`;
		});

		if (steps.length > MAX_WIDGET_STEPS) {
			lines.push(
				th.fg(
					"dim",
					`  +${steps.length - MAX_WIDGET_STEPS} more (${stats.done}/${stats.total} done — run /todos to view all)`,
				),
			);
		}

		ctx.ui.setWidget(WIDGET_KEY, lines);
	}

	function updateUI(ctx: ExtensionContext): void {
		const phase = getPhase(planModeEnabled, executionMode);
		syncPlanIndicators(pi, ctx, phase, steps);
		updateWidget(ctx);
	}

	async function persistPlanMarkdown(
		cwd: string,
		overridePhase?: "planning" | "executing" | "completed" | "idle",
	): Promise<string | undefined> {
		if (steps.length === 0) return undefined;
		try {
			const saved = await savePlanMarkdownFile({
				cwd,
				existingPath: planFilePath,
				title: planTitle,
				summary: planSummary,
				createdAt,
				phase: overridePhase ?? getPhase(planModeEnabled, executionMode),
				steps,
			});
			planFilePath = saved.filePath;
			createdAt = saved.createdAt;
			return saved.relativePath;
		} catch {
			return formatDisplayPath(cwd, planFilePath);
		}
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			planModeEnabled = false;
			executionMode = false;
			restorePreviousTools();
			updateUI(ctx);
			persistState();
			if (ctx.hasUI) {
				ctx.ui.notify("Plan mode disabled. Previous tools restored.", "info");
			}
			return;
		}

		// Starting a fresh planning session from idle clears any prior completed plan
		if (!executionMode) {
			steps = [];
			planFilePath = undefined;
			planTitle = undefined;
			planSummary = undefined;
			createdAt = undefined;
		}

		planModeEnabled = true;
		executionMode = false;
		applyPlanModeTools();
		updateUI(ctx);
		persistState();

		if (ctx.hasUI) {
			ctx.ui.notify(
				"Plan mode enabled (read-only). Write tools disabled; bash restricted to read-only commands.",
				"info",
			);
		}
	}

	async function openProgressPopup(ctx: ExtensionContext): Promise<void> {
		const phase = getPhase(planModeEnabled, executionMode);
		const stats = getPlanStats(steps);

		if (ctx.mode !== "tui") {
			if (!ctx.hasUI) return;
			if (steps.length === 0) {
				ctx.ui.notify(`Plan mode (${phase}): no steps recorded. Run /plan to start.`, "info");
				return;
			}
			const list = steps
				.map((s) => `${s.id}. ${stepMarkerPlain(s.status)} [${s.status}] ${s.title}${s.note ? ` — ${s.note}` : ""}`)
				.join("\n");
			ctx.ui.notify(`Plan (${phase}, ${stats.done}/${stats.total}):\n${list}`, "info");
			return;
		}

		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) =>
				new PlanProgressOverlay(
					tui,
					theme,
					{
						phase,
						title: planTitle,
						summary: planSummary,
						planFileDisplay: formatDisplayPath(ctx.cwd, planFilePath),
						steps: steps.map((s) => ({ ...s })),
					},
					() => done(),
				),
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: "74%",
					minWidth: 46,
					maxHeight: "82%",
					margin: 1,
				},
			},
		);
	}

	// ─── Commands ───────────────────────────────────────────────────────────

	pi.registerCommand("plan", {
		description: "Toggle read-only plan mode on or off",
		handler: async (_args, ctx) => {
			togglePlanMode(ctx);
		},
	});

	pi.registerCommand("todos", {
		description: "Open plan progress overlay",
		handler: async (_args, ctx) => {
			await openProgressPopup(ctx);
		},
	});

	pi.registerCommand("plan-progress", {
		description: "Open plan progress overlay (alias for /todos)",
		handler: async (_args, ctx) => {
			await openProgressPopup(ctx);
		},
	});

	// ─── Structured Plan Tool ───────────────────────────────────────────────

	// `defaultActive: false` is supported by Pi >= 1.x so the tool adds zero schema
	// tokens during normal non-plan sessions. For older runtimes, `session_start`
	// also deactivates it when idle.
	const planStepsTool: ToolDefinition<typeof PlanStepsParamsSchema, PlanStepsToolDetails> & {
		defaultActive?: boolean;
	} = {
		name: PLAN_TOOL_NAME,
		label: "Plan Steps",
		description:
			"Create, replace, list, or update structured plan steps and track execution progress. " +
			"Use action='set' to record or revise the ordered plan steps (persisted to .plan/plan-{date-time}.md). " +
			"Use action='update' to set a step's status (pending, in_progress, completed, skipped) with an optional note. " +
			"Use action='list' to inspect current steps.",
		promptSnippet: "Record ordered plan steps and update step progress during plan mode and execution",
		promptGuidelines: [
			"In plan mode, call plan_steps with action='set' to record the concrete step-by-step plan.",
			"During plan execution, call plan_steps with action='update' to mark each step in_progress when starting and completed or skipped when done.",
		],
		parameters: PlanStepsParamsSchema,
		executionMode: "sequential",
		defaultActive: false,

		async execute(
			_toolCallId: string,
			params: PlanStepsParams,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<PlanStepsToolDetails> | undefined,
			ctx: ExtensionContext,
		) {
			if (params.action === "list") {
				const stats = getPlanStats(steps);
				const relPath = formatDisplayPath(ctx.cwd, planFilePath);
				const text =
					steps.length === 0
						? "No plan steps recorded."
						: `Plan (${getPhase(planModeEnabled, executionMode)}, ${stats.done}/${stats.total} done)${relPath ? ` [${relPath}]` : ""}:\n${formatStepsForContext(steps)}`;
				return {
					content: [{ type: "text", text }],
					details: {
						action: "list",
						steps: steps.map((s) => ({ ...s })),
						planFileRelative: relPath,
					},
				};
			}

			if (params.action === "set") {
				if (!params.steps || params.steps.length === 0) {
					throw new Error("plan_steps action='set' requires a non-empty 'steps' array.");
				}
				const normalized = normalizeSteps(params.steps);
				if (normalized.length === 0) {
					throw new Error("plan_steps action='set' received no valid steps with non-empty titles.");
				}

				steps = normalized;
				if (params.title !== undefined) {
					planTitle = params.title.trim() || undefined;
				}
				if (params.summary !== undefined) {
					planSummary = params.summary.trim() || undefined;
				}

				const relPath = await persistPlanMarkdown(ctx.cwd);
				updateUI(ctx);
				persistState();

				const text =
					`Recorded ${steps.length} plan step(s)${relPath ? ` and saved to ${relPath}` : ""}.\n` +
					formatStepsForContext(steps);

				return {
					content: [{ type: "text", text }],
					details: {
						action: "set",
						steps: steps.map((s) => ({ ...s })),
						planFileRelative: relPath,
					},
				};
			}

			if (params.action === "update") {
				if (params.id === undefined) {
					throw new Error("plan_steps action='update' requires 'id'.");
				}
				if (params.status === undefined) {
					throw new Error("plan_steps action='update' requires 'status'.");
				}

				const result = updateStepStatus(steps, params.id, params.status, params.note);
				if (result.error || !result.updated) {
					throw new Error(result.error ?? `Failed to update step #${params.id}.`);
				}

				steps = result.steps;
				const nextPhase = isPlanComplete(steps)
					? "completed"
					: getPhase(planModeEnabled, executionMode);
				const relPath = await persistPlanMarkdown(ctx.cwd, nextPhase);
				updateUI(ctx);
				persistState();

				const stats = getPlanStats(steps);
				const noteText = result.updated.note ? ` (note: ${result.updated.note})` : "";
				const text =
					`Updated step #${result.updated.id} (${result.updated.title}) -> ${result.updated.status}${noteText}. ` +
					`Progress: ${stats.done}/${stats.total}.${relPath ? ` Updated ${relPath}.` : ""}`;

				return {
					content: [{ type: "text", text }],
					details: {
						action: "update",
						steps: steps.map((s) => ({ ...s })),
						updatedId: result.updated.id,
						planFileRelative: relPath,
					},
				};
			}

			throw new Error(`Unsupported plan_steps action: ${String(params.action)}`);
		},

		renderCall(args, theme) {
			let header =
				theme.fg("toolTitle", theme.bold("plan_steps ")) +
				theme.fg("muted", args.action);
			if (args.action === "set" && Array.isArray(args.steps)) {
				header += ` ${theme.fg("dim", `(${args.steps.length} steps)`)}`;
			} else if (args.action === "update") {
				if (args.id !== undefined) header += ` ${theme.fg("accent", `#${args.id}`)}`;
				if (args.status) header += ` ${theme.fg("dim", `→ ${args.status}`)}`;
			}
			return new Text(header, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}

			const stats = getPlanStats(details.steps);
			const fileSuffix = details.planFileRelative
				? ` ${theme.fg("dim", `(${details.planFileRelative})`)}`
				: "";

			if (details.action === "update" && details.updatedId !== undefined) {
				const step = details.steps.find((s) => s.id === details.updatedId);
				if (step) {
					const markerColor =
						step.status === "completed"
							? "success"
							: step.status === "in_progress"
								? "accent"
								: "muted";
					let text =
						`${theme.fg(markerColor, stepMarkerPlain(step.status))} ` +
						`${theme.fg("accent", `#${step.id}`)} ${theme.fg("text", step.title)} ` +
						`${theme.fg("dim", `[${step.status}] ${stats.done}/${stats.total}`)}${fileSuffix}`;
					if (step.note) {
						text += `\n${theme.fg("dim", `  Note: ${step.note}`)}`;
					}
					return new Text(text, 0, 0);
				}
			}

			if (details.steps.length === 0) {
				return new Text(theme.fg("dim", "No plan steps"), 0, 0);
			}

			const header =
				theme.fg("success", `✓ ${details.steps.length} step(s)`) +
				theme.fg("muted", ` (${stats.done}/${stats.total} done)`) +
				fileSuffix;

			const shown = expanded ? details.steps : details.steps.slice(0, 6);
			const rows = shown.map((s) => {
				const color =
					s.status === "completed"
						? "success"
						: s.status === "in_progress"
							? "accent"
							: "dim";
				const title =
					s.status === "completed" ? theme.fg("muted", s.title) : theme.fg("text", s.title);
				return `${theme.fg(color, stepMarkerPlain(s.status))} ${theme.fg("accent", `${s.id}.`)} ${title}`;
			});
			if (!expanded && details.steps.length > shown.length) {
				rows.push(theme.fg("dim", `... +${details.steps.length - shown.length} more`));
			}

			return new Text([header, ...rows].join("\n"), 0, 0);
		},
	};

	pi.registerTool(planStepsTool);

	// ─── Read-Only Enforcement ──────────────────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) return;

		if (PLAN_MODE_DISABLED_TOOLS.has(event.toolName)) {
			return {
				block: true,
				reason:
					`Plan mode is read-only: tool "${event.toolName}" is blocked. ` +
					"Do not modify files while planning; record changes in plan_steps instead.",
			};
		}

		if (event.toolName === "bash") {
			const input = event.input as { command?: unknown };
			const command = typeof input.command === "string" ? input.command : "";
			const check = checkBashCommand(command);
			if (!check.allowed) {
				return {
					block: true,
					reason:
						`${check.reason ?? "Command blocked in read-only plan mode."}\n` +
						`Stay read-only while planning (use /plan to leave plan mode if edits are required).\n` +
						`Command: ${command}`,
				};
			}
		}
	});

	// ─── Context Steering ───────────────────────────────────────────────────

	pi.on("before_agent_start", async (event) => {
		const messageType = (event as { messageType?: "user" | "custom" }).messageType;
		if (messageType !== undefined && messageType !== "user") {
			return;
		}

		if (planModeEnabled) {
			const existingPlanSection =
				steps.length > 0
					? `\n\nCurrent recorded plan steps:\n${formatStepsForContext(steps)}\nRevise them with \`${PLAN_TOOL_NAME}\` (action="set") if the user asks for changes.`
					: "";

			return {
				message: {
					customType: PLAN_MODE_CONTEXT_TYPE,
					display: false,
					content: `[PLAN MODE ACTIVE — READ-ONLY]
You are currently in read-only plan mode.

Rules:
- Do NOT modify files, run write commands, or make state changes.
- Built-in \`edit\` and \`write\` tools are disabled, and \`bash\` is restricted to read-only inspection commands.
- Non-write tools (such as \`read\`, \`grep\`, \`find\`, \`ls\`, \`skeptic_agent\`, \`google_search\`, \`read_url_content\`, \`codemode\`) remain available for exploration and clarification.
- Inspect the codebase thoroughly before finalizing your plan.
- Record your concrete, ordered step-by-step plan by calling the \`${PLAN_TOOL_NAME}\` tool with \`action: "set"\` (include concise step titles and useful details).
- Present a clear summary of the plan to the user once recorded.${existingPlanSection}`,
				},
			};
		}

		if (executionMode && steps.length > 0) {
			const stats = getPlanStats(steps);
			if (stats.remaining.length === 0) return;

			return {
				message: {
					customType: PLAN_EXECUTION_CONTEXT_TYPE,
					display: false,
					content: `[EXECUTING PLAN — ${stats.done}/${stats.total} completed]
Full tool access is enabled. Continue executing the approved plan in order.

Remaining steps:
${formatStepsForContext(stats.remaining)}

Progress tracking:
- Call \`${PLAN_TOOL_NAME}\` with \`action: "update"\`, \`id\`, and \`status: "in_progress"\` when starting a step.
- Call \`${PLAN_TOOL_NAME}\` with \`action: "update"\`, \`id\`, and \`status: "completed"\` (or \`"skipped"\` with a \`note\`) as soon as each step finishes.`,
				},
			};
		}
	});

	pi.on("context", async (event) => {
		if (planModeEnabled && executionMode) return;
		if (!planModeEnabled || !executionMode) {
			return {
				messages: filterStaleContextMessages(
					event.messages as Array<(typeof event.messages)[number] & { customType?: string }>,
					planModeEnabled,
					executionMode,
				),
			};
		}
	});

	// ─── Lifecycle & Post-Plan Workflow ─────────────────────────────────────

	pi.on("agent_start", async (_event, ctx) => {
		syncPlanIndicators(pi, ctx, getPhase(planModeEnabled, executionMode), steps);
	});

	pi.on("agent_end", async (event, ctx) => {
		// 1. Execution mode completion check
		if (executionMode && isPlanComplete(steps)) {
			const stats = getPlanStats(steps);
			const relPath = await persistPlanMarkdown(ctx.cwd, "completed");

			executionMode = false;
			restorePreviousTools();
			updateUI(ctx);
			persistState();

			if (ctx.hasUI) {
				const skippedNote = stats.skipped > 0 ? `, ${stats.skipped} skipped` : "";
				const fileNote = relPath ? ` (${relPath})` : "";
				ctx.ui.notify(
					`Plan complete: ${stats.completed} completed${skippedNote}.${fileNote}`,
					"info",
				);
			}
			return;
		}

		// 2. Plan mode next-action prompt once a plan has been recorded
		if (!planModeEnabled || !ctx.hasUI || steps.length === 0) return;

		// Skip prompting if the turn was aborted or ended with an error
		const lastAssistant = [...event.messages]
			.reverse()
			.find((m) => m.role === "assistant") as
			| { role: "assistant"; stopReason?: string }
			| undefined;
		if (lastAssistant?.stopReason === "aborted" || lastAssistant?.stopReason === "error") {
			return;
		}

		const choice = await ctx.ui.select("Plan ready — what next?", [
			"Execute the plan",
			"Refine the plan",
			"Stay in plan mode",
		]);

		if (choice === "Execute the plan") {
			const firstStep = getNextActionableStep(steps);
			if (!firstStep) return;

			planModeEnabled = false;
			executionMode = true;
			applyExecutionModeTools();
			const relPath = await persistPlanMarkdown(ctx.cwd, "executing");
			updateUI(ctx);
			persistState();

			const remaining = getPlanStats(steps).remaining;
			const execContent =
				`Execute the approved plan${relPath ? ` (${relPath})` : ""}.\n\n` +
				`Steps:\n${formatStepsForContext(remaining)}\n\n` +
				`Start with step ${firstStep.id}: ${firstStep.title}\n` +
				`Use \`${PLAN_TOOL_NAME}\` (action="update") to mark each step \`in_progress\` when starting and \`completed\` or \`skipped\` when done.`;

			pi.sendMessage(
				{
					customType: "plan-mode-execute",
					content: execContent,
					display: true,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	function restoreFromBranch(ctx: ExtensionContext, applyCliFlagIfFresh: boolean): void {
		planModeEnabled = false;
		executionMode = false;
		steps = [];
		toolsBeforePlanMode = undefined;
		planFilePath = undefined;
		planTitle = undefined;
		planSummary = undefined;
		createdAt = undefined;

		const branch = ctx.sessionManager.getBranch();
		let restoredEntry: PlanModeState | undefined;
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as {
				type?: string;
				customType?: string;
				data?: PlanModeState;
			};
			if (entry.type === "custom" && entry.customType === PLAN_MODE_ENTRY_TYPE && entry.data) {
				restoredEntry = entry.data;
				break;
			}
		}

		if (restoredEntry) {
			planModeEnabled = Boolean(restoredEntry.enabled);
			executionMode = Boolean(restoredEntry.executing) && !planModeEnabled;
			steps = Array.isArray(restoredEntry.steps)
				? restoredEntry.steps.map((s) => ({ ...s }))
				: [];
			toolsBeforePlanMode = Array.isArray(restoredEntry.toolsBeforePlanMode)
				? [...restoredEntry.toolsBeforePlanMode]
				: undefined;
			planFilePath = restoredEntry.planFilePath;
			planTitle = restoredEntry.title;
			planSummary = restoredEntry.summary;
			createdAt = restoredEntry.createdAt;
		} else if (applyCliFlagIfFresh && pi.getFlag("plan") === true) {
			planModeEnabled = true;
			captureToolsBeforePlanMode();
			persistState();
		}

		if (planModeEnabled) {
			applyPlanModeTools();
		} else if (executionMode) {
			applyExecutionModeTools();
		} else {
			deactivatePlanToolIfIdle();
		}

		updateUI(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		restoreFromBranch(ctx, true);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx, false);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearPlanIndicators(pi, ctx);
		if (ctx.hasUI) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		}
	});
}
