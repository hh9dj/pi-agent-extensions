/**
 * Pure utility functions for plan mode:
 * - Read-only bash command validation (allowlist + destructive denylist)
 * - Active tool set transitions
 * - Structured plan step state transitions
 * - Markdown serialization and timestamp helpers
 * - Stale context message filtering
 */

export const PLAN_TOOL_NAME = "plan_steps";
export const PLAN_MODE_ENTRY_TYPE = "plan-mode";
export const PLAN_MODE_CONTEXT_TYPE = "plan-mode-context";
export const PLAN_EXECUTION_CONTEXT_TYPE = "plan-execution-context";

export const PLAN_MODE_READ_TOOLS = ["read", "grep", "find", "ls"] as const;
export const PLAN_MODE_DISABLED_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "skipped";

export interface PlanStep {
	id: number;
	title: string;
	details?: string;
	status: PlanStepStatus;
	note?: string;
}

export interface PlanStepInput {
	id?: number;
	title: string;
	details?: string;
	status?: PlanStepStatus;
	note?: string;
}

export type PlanModePhase = "idle" | "planning" | "executing";

export interface PlanModeState {
	enabled: boolean;
	executing: boolean;
	steps: PlanStep[];
	toolsBeforePlanMode?: string[];
	planFilePath?: string;
	title?: string;
	summary?: string;
	createdAt?: string;
}

export interface BashCheckResult {
	allowed: boolean;
	reason?: string;
}

export interface PlanStats {
	total: number;
	done: number;
	completed: number;
	skipped: number;
	inProgress: number;
	pending: number;
	remaining: PlanStep[];
}

// ─── Tool Set Transitions ───────────────────────────────────────────────────

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values)];
}

export function computePlanModeTools(toolsBeforePlanMode: readonly string[]): string[] {
	const kept = toolsBeforePlanMode.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name));
	return uniqueStrings([...kept, ...PLAN_MODE_READ_TOOLS, PLAN_TOOL_NAME]);
}

export function computeExecutionModeTools(toolsBeforePlanMode: readonly string[]): string[] {
	return uniqueStrings([...toolsBeforePlanMode, PLAN_TOOL_NAME]);
}

export function computeRestoredTools(
	toolsBeforePlanMode: readonly string[] | undefined,
	currentActiveTools: readonly string[],
): string[] {
	if (toolsBeforePlanMode !== undefined) {
		return uniqueStrings(toolsBeforePlanMode);
	}
	return uniqueStrings(currentActiveTools.filter((name) => name !== PLAN_TOOL_NAME));
}

// ─── Bash Read-Only Validation ──────────────────────────────────────────────

const DESTRUCTIVE_UNQUOTED_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
	{ pattern: /\brm\b/i, label: "rm" },
	{ pattern: /\brmdir\b/i, label: "rmdir" },
	{ pattern: /\bmv\b/i, label: "mv" },
	{ pattern: /\bcp\b/i, label: "cp" },
	{ pattern: /\bmkdir\b/i, label: "mkdir" },
	{ pattern: /\btouch\b/i, label: "touch" },
	{ pattern: /\bchmod\b/i, label: "chmod" },
	{ pattern: /\bchown\b/i, label: "chown" },
	{ pattern: /\bchgrp\b/i, label: "chgrp" },
	{ pattern: /\bln\b/i, label: "ln" },
	{ pattern: /\btee\b/i, label: "tee" },
	{ pattern: /\btruncate\b/i, label: "truncate" },
	{ pattern: /\bdd\b/i, label: "dd" },
	{ pattern: /\bshred\b/i, label: "shred" },
	{ pattern: /\binstall\b/i, label: "install" },
	{ pattern: /\b(npm|pnpm|bun)\s+(install|i|add|remove|rm|uninstall|update|up|ci|link|unlink|publish|init|create)\b/i, label: "package mutation" },
	{ pattern: /\byarn\s+(add|remove|install|upgrade|publish|link|unlink|init|create)\b/i, label: "package mutation" },
	{ pattern: /\b(pip|pip3|uv)\s+(install|uninstall|add|remove|sync)\b/i, label: "package mutation" },
	{ pattern: /\bcargo\s+(install|uninstall|add|remove|publish)\b/i, label: "package mutation" },
	{ pattern: /\b(apt|apt-get|dnf|yum|pacman|brew|nix-env)\s+(install|remove|purge|update|upgrade|uninstall)\b/i, label: "package mutation" },
	{
		pattern:
			/\bgit\b(?:\s+(?:-C\s+\S+|--git-dir(?:=\S+|\s+\S+)|--work-tree(?:=\S+|\s+\S+)|--no-pager|-P|-c\s+\S+))*\s+(add|commit|push|pull|fetch|merge|rebase|reset|checkout|switch|restore|clean|stash\s+(push|save|pop|apply|drop|clear)|cherry-pick|revert|init|clone|am|apply|rm|mv|bisect|notes\s+(add|append|edit|remove))\b/i,
		label: "mutating git command",
	},
	{ pattern: /\bsudo\b/i, label: "sudo" },
	{ pattern: /\bsu\b/i, label: "su" },
	{ pattern: /\bdoas\b/i, label: "doas" },
	{ pattern: /\bkill\b/i, label: "kill" },
	{ pattern: /\bpkill\b/i, label: "pkill" },
	{ pattern: /\bkillall\b/i, label: "killall" },
	{ pattern: /\breboot\b/i, label: "reboot" },
	{ pattern: /\bshutdown\b/i, label: "shutdown" },
	{ pattern: /\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask)\b/i, label: "systemctl" },
	{ pattern: /\bservice\s+\S+\s+(start|stop|restart|reload)\b/i, label: "service" },
	{ pattern: /\b(vi|vim|nvim|nano|emacs|code|subl|hx|helix|ed)\b/i, label: "editor" },
];

const SIMPLE_SAFE_COMMANDS: ReadonlySet<string> = new Set([
	"rg",
	"grep",
	"egrep",
	"fgrep",
	"fd",
	"fdfind",
	"ls",
	"eza",
	"exa",
	"tree",
	"cat",
	"bat",
	"head",
	"tail",
	"less",
	"more",
	"wc",
	"sort",
	"uniq",
	"cut",
	"tr",
	"diff",
	"cmp",
	"comm",
	"file",
	"stat",
	"readlink",
	"realpath",
	"basename",
	"dirname",
	"du",
	"df",
	"pwd",
	"echo",
	"printf",
	"cd",
	"true",
	"false",
	"test",
	"[",
	"jq",
	"yq",
	"which",
	"whereis",
	"type",
	"env",
	"printenv",
	"uname",
	"whoami",
	"id",
	"date",
	"cal",
	"uptime",
	"ps",
	"free",
]);

/**
 * Strip contents inside single or double quotes so pattern checks on command
 * tokens and operators do not false-positive on search patterns like `rg "rm -rf"`.
 */
function maskQuotedContent(segment: string): string {
	let out = "";
	let inSingle = false;
	let inDouble = false;
	let escaped = false;

	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i]!;
		if (escaped) {
			escaped = false;
			if (!inSingle && !inDouble) out += ch;
			continue;
		}
		if (ch === "\\" && !inSingle) {
			escaped = true;
			if (!inDouble) out += ch;
			continue;
		}
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
			out += "'";
			continue;
		}
		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			out += '"';
			continue;
		}
		if (inSingle || inDouble) {
			continue;
		}
		out += ch;
	}
	return out;
}

interface ParsedSegments {
	segments: string[];
	blockedReason?: string;
}

/**
 * Split a shell command line into individual pipeline/chained segments while
 * detecting unquoted redirections, command substitutions, and backgrounding.
 */
export function splitShellCommands(command: string): ParsedSegments {
	const segments: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	let escaped = false;

	const pushCurrent = () => {
		const trimmed = current.trim();
		if (trimmed.length > 0) {
			segments.push(trimmed);
		}
		current = "";
	};

	for (let i = 0; i < command.length; i++) {
		const ch = command[i]!;
		const next = command[i + 1];

		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}

		if (ch === "\\" && !inSingle) {
			current += ch;
			escaped = true;
			continue;
		}

		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
			current += ch;
			continue;
		}

		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			current += ch;
			continue;
		}

		// Command substitution is active inside double quotes and unquoted text.
		if (!inSingle) {
			if (ch === "`" || (ch === "$" && next === "(")) {
				return {
					segments: [],
					blockedReason: "Command substitution ($(...) or backticks) is blocked in plan mode. Stay read-only.",
				};
			}
		}

		if (inSingle || inDouble) {
			current += ch;
			continue;
		}

		// Process substitution
		if ((ch === "<" || ch === ">") && next === "(") {
			return {
				segments: [],
				blockedReason: "Process substitution (<(...) or >(...)) is blocked in plan mode. Stay read-only.",
			};
		}

		// Allow harmless stderr redirections: 2>&1 and 2>/dev/null (or 2> /dev/null)
		if (ch === "2" && next === ">") {
			const rest = command.slice(i);
			const stderrToStdout = /^2>&1(?=\s|$|[;|&])/.exec(rest);
			if (stderrToStdout) {
				i += stderrToStdout[0].length - 1;
				continue;
			}
			const stderrToNull = /^2>\s*\/dev\/null(?=\s|$|[;|&])/.exec(rest);
			if (stderrToNull) {
				i += stderrToNull[0].length - 1;
				continue;
			}
		}

		// Block all other output redirections (>, >>, >|, &>, 1>, 2>, etc.)
		if (ch === ">" || (ch === "&" && next === ">")) {
			return {
				segments: [],
				blockedReason: "Output redirection (> / >>) is blocked in plan mode. Stay read-only.",
			};
		}

		// Chaining and pipeline operators
		if (ch === "\n" || ch === ";") {
			pushCurrent();
			continue;
		}
		if (ch === "|" && next === "|") {
			pushCurrent();
			i++;
			continue;
		}
		if (ch === "|") {
			pushCurrent();
			continue;
		}
		if (ch === "&" && next === "&") {
			pushCurrent();
			i++;
			continue;
		}
		if (ch === "&") {
			return {
				segments: [],
				blockedReason: "Background execution (&) is blocked in plan mode. Stay read-only.",
			};
		}

		current += ch;
	}

	if (inSingle || inDouble) {
		return {
			segments: [],
			blockedReason: "Unterminated quote in command; blocked in plan mode.",
		};
	}

	pushCurrent();
	return { segments };
}

function isAllowedGitSegment(unquoted: string): boolean {
	// Strip leading `git` and safe global flags (`-C <dir>`, `--no-pager`, `-P`, `--git-dir=...`, `--work-tree=...`)
	const rest = unquoted
		.replace(/^\s*git\b/, "")
		.replace(/(?:\s+(?:-C\s+\S+|--no-pager|-P|--git-dir(?:=\S+|\s+\S+)|--work-tree(?:=\S+|\s+\S+)))+/g, "")
		.trim();

	if (!rest) return false;
	const match = /^([a-z0-9-]+)(?:\s+(.*))?$/i.exec(rest);
	if (!match) return false;
	const sub = match[1]!.toLowerCase();
	const args = (match[2] ?? "").trim();

	switch (sub) {
		case "status":
		case "log":
		case "diff":
		case "show":
		case "ls-files":
		case "ls-tree":
		case "ls-remote":
		case "rev-parse":
		case "rev-list":
		case "merge-base":
		case "describe":
		case "blame":
		case "shortlog":
		case "grep":
		case "cat-file":
		case "symbolic-ref":
		case "name-rev":
		case "count-objects":
			return true;

		case "branch":
			// Block mutating branch flags; allow listing/inspection flags or bare `git branch`
			if (/(?:^|\s)(?:-[dDmMcCf]|--delete|--move|--copy|--force|--set-upstream-to|--unset-upstream|--edit-description)\b/.test(args)) {
				return false;
			}
			// Bare `git branch` or flag-based inspection (e.g. -a, -r, -v, --list, --show-current)
			return args.length === 0 || args.startsWith("-");

		case "remote":
			return args.length === 0 || /^(?:-v|--verbose|show\b|get-url\b)/i.test(args);

		case "stash":
			return /^(?:list|show)\b/i.test(args);

		case "tag":
			if (/(?:^|\s)(?:-[adfs]|--annotate|--delete|--force|--sign)\b/.test(args)) {
				return false;
			}
			return args.length === 0 || /^(?:-l|--list|-n\d*|--sort|--contains|--merged|--no-merged|--points-at)\b/.test(args);

		case "config":
			return /(?:^|\s)(?:--get|--get-all|--get-regexp|--list|-l|--show-origin|--show-scope)\b/.test(args);

		case "reflog":
			return args.length === 0 || /^(?:show\b|-)/.test(args);

		case "worktree":
			return /^list\b/i.test(args);

		default:
			return false;
	}
}

function isAllowedSegment(rawSegment: string): BashCheckResult {
	const unquoted = maskQuotedContent(rawSegment).trim();
	if (!unquoted) {
		return { allowed: false, reason: "Empty command segment." };
	}

	// Ignore shell comment-only lines
	if (unquoted.startsWith("#")) {
		return { allowed: true };
	}

	// Denylist check first (on unquoted command structure)
	for (const { pattern, label } of DESTRUCTIVE_UNQUOTED_PATTERNS) {
		if (pattern.test(unquoted)) {
			return {
				allowed: false,
				reason: `Plan mode is read-only: blocked destructive pattern (${label}). Do not modify files or system state.`,
			};
		}
	}

	const firstTokenMatch = /^([^\s]+)/.exec(unquoted);
	const cmd = firstTokenMatch?.[1];
	if (!cmd) {
		return { allowed: false, reason: "Unable to parse command." };
	}

	if (SIMPLE_SAFE_COMMANDS.has(cmd)) {
		return { allowed: true };
	}

	if (cmd === "find") {
		if (/(?:^|\s)-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)\b/.test(unquoted)) {
			return {
				allowed: false,
				reason: "Plan mode is read-only: find with -delete/-exec/-ok/-fprint flags is blocked.",
			};
		}
		return { allowed: true };
	}

	if (cmd === "ast-grep" || cmd === "sg") {
		if (/(?:^|\s)(?:--rewrite|-r|--update-all|-U|--interactive|-i)\b/.test(unquoted)) {
			return {
				allowed: false,
				reason: `Plan mode is read-only: ${cmd} rewrite/update flags are blocked.`,
			};
		}
		return { allowed: true };
	}

	if (cmd === "sed") {
		if (/(?:^|\s)(?:-i|--in-place)\b/.test(unquoted)) {
			return {
				allowed: false,
				reason: "Plan mode is read-only: sed in-place editing (-i) is blocked.",
			};
		}
		if (/(?:^|\s)-n\b/.test(unquoted)) {
			return { allowed: true };
		}
		return {
			allowed: false,
			reason: "Plan mode is read-only: only sed -n (read-only printing) is allowlisted.",
		};
	}

	if (cmd === "awk") {
		if (/\bsystem\s*\(|\bgetline\b|[>|]/.test(rawSegment)) {
			return {
				allowed: false,
				reason: "Plan mode is read-only: awk with system(), getline, or redirections is blocked.",
			};
		}
		return { allowed: true };
	}

	if (cmd === "git") {
		if (isAllowedGitSegment(unquoted)) {
			return { allowed: true };
		}
		return {
			allowed: false,
			reason: "Plan mode is read-only: only read-only git subcommands (status, log, diff, show, branch, ls-files, etc.) are allowed.",
		};
	}

	if (cmd === "command") {
		if (/^command\s+-[vV]\b/.test(unquoted)) {
			return { allowed: true };
		}
		return {
			allowed: false,
			reason: "Plan mode is read-only: only `command -v` is allowlisted.",
		};
	}

	if (cmd === "npm") {
		if (/^npm\s+(?:list|ls|view|info|search|outdated|audit|why|--version|-v)\b/i.test(unquoted)) {
			return { allowed: true };
		}
		return {
			allowed: false,
			reason: "Plan mode is read-only: only read-only npm inspection commands (ls, view, info, outdated, audit, why) are allowed.",
		};
	}

	if (cmd === "yarn") {
		if (/^yarn\s+(?:list|info|why|audit|--version|-v)\b/i.test(unquoted)) {
			return { allowed: true };
		}
		return {
			allowed: false,
			reason: "Plan mode is read-only: only read-only yarn inspection commands are allowed.",
		};
	}

	if (cmd === "pnpm") {
		if (/^pnpm\s+(?:list|ls|why|audit|--version|-v)\b/i.test(unquoted)) {
			return { allowed: true };
		}
		return {
			allowed: false,
			reason: "Plan mode is read-only: only read-only pnpm inspection commands are allowed.",
		};
	}

	if (cmd === "node" && /^node\s+(?:--version|-v)\s*$/.test(unquoted)) {
		return { allowed: true };
	}

	if ((cmd === "python" || cmd === "python3") && /^python3?\s+(?:--version|-V)\s*$/.test(unquoted)) {
		return { allowed: true };
	}

	if (cmd === "rustc" && /^rustc\s+(?:--version|-V)\s*$/.test(unquoted)) {
		return { allowed: true };
	}

	if (cmd === "cargo" && /^cargo\s+(?:--version|-V|metadata|tree)\b/.test(unquoted)) {
		return { allowed: true };
	}

	if (cmd === "go" && /^go\s+(?:version|list|doc)\b/.test(unquoted)) {
		return { allowed: true };
	}

	if (cmd === "gh" && /^gh\s+(?:pr\s+(?:view|list|diff|checks|status)|issue\s+(?:view|list|status)|repo\s+view)\b/.test(unquoted)) {
		return { allowed: true };
	}

	return {
		allowed: false,
		reason: `Plan mode is read-only: command "${cmd}" is not on the read-only allowlist. Stay read-only and do not modify files.`,
	};
}

export function checkBashCommand(command: string): BashCheckResult {
	if (typeof command !== "string" || command.trim().length === 0) {
		return { allowed: false, reason: "Plan mode is read-only: empty command blocked." };
	}

	const parsed = splitShellCommands(command);
	if (parsed.blockedReason) {
		return { allowed: false, reason: parsed.blockedReason };
	}
	if (parsed.segments.length === 0) {
		return { allowed: false, reason: "Plan mode is read-only: empty command blocked." };
	}

	for (const segment of parsed.segments) {
		const check = isAllowedSegment(segment);
		if (!check.allowed) {
			return check;
		}
	}

	return { allowed: true };
}

export function isSafeCommand(command: string): boolean {
	return checkBashCommand(command).allowed;
}

// ─── Plan Step State Transitions ────────────────────────────────────────────

const VALID_STATUSES: ReadonlySet<string> = new Set([
	"pending",
	"in_progress",
	"completed",
	"skipped",
]);

export function isValidStepStatus(value: unknown): value is PlanStepStatus {
	return typeof value === "string" && VALID_STATUSES.has(value);
}

export function normalizeSteps(inputs: readonly PlanStepInput[]): PlanStep[] {
	const usedIds = new Set<number>();
	let nextId = 1;

	return inputs
		.map((input) => {
			const title = input.title.trim();
			let id =
				typeof input.id === "number" && Number.isInteger(input.id) && input.id >= 1 && !usedIds.has(input.id)
					? input.id
					: nextId;
			while (usedIds.has(id)) {
				id++;
			}
			usedIds.add(id);
			nextId = Math.max(nextId, id + 1);

			const step: PlanStep = {
				id,
				title,
				status: isValidStepStatus(input.status) ? input.status : "pending",
			};
			if (input.details?.trim()) {
				step.details = input.details.trim();
			}
			if (input.note?.trim()) {
				step.note = input.note.trim();
			}
			return step;
		})
		.filter((step) => step.title.length > 0);
}

export function updateStepStatus(
	steps: readonly PlanStep[],
	id: number,
	status: PlanStepStatus,
	note?: string,
): { steps: PlanStep[]; updated?: PlanStep; error?: string } {
	const index = steps.findIndex((step) => step.id === id);
	if (index === -1) {
		return {
			steps: [...steps],
			error: `Step #${id} not found. Valid step IDs: ${steps.map((s) => s.id).join(", ") || "none"}.`,
		};
	}

	const existing = steps[index]!;
	const updated: PlanStep = {
		...existing,
		status,
	};
	if (note !== undefined) {
		const trimmed = note.trim();
		if (trimmed.length > 0) {
			updated.note = trimmed;
		} else {
			delete updated.note;
		}
	}

	const nextSteps = steps.map((step, i) => (i === index ? updated : step));
	return { steps: nextSteps, updated };
}

export function getPlanStats(steps: readonly PlanStep[]): PlanStats {
	let completed = 0;
	let skipped = 0;
	let inProgress = 0;
	let pending = 0;
	const remaining: PlanStep[] = [];

	for (const step of steps) {
		switch (step.status) {
			case "completed":
				completed++;
				break;
			case "skipped":
				skipped++;
				break;
			case "in_progress":
				inProgress++;
				remaining.push(step);
				break;
			case "pending":
				pending++;
				remaining.push(step);
				break;
		}
	}

	return {
		total: steps.length,
		done: completed + skipped,
		completed,
		skipped,
		inProgress,
		pending,
		remaining,
	};
}

export function isPlanComplete(steps: readonly PlanStep[]): boolean {
	return steps.length > 0 && steps.every((s) => s.status === "completed" || s.status === "skipped");
}

export function getNextActionableStep(steps: readonly PlanStep[]): PlanStep | undefined {
	return (
		steps.find((s) => s.status === "in_progress") ??
		steps.find((s) => s.status === "pending")
	);
}

export function getPhase(enabled: boolean, executing: boolean): PlanModePhase {
	if (enabled) return "planning";
	if (executing) return "executing";
	return "idle";
}

// ─── Markdown Serialization ─────────────────────────────────────────────────

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

export function formatPlanTimestamp(date: Date): { filenameStamp: string; displayStamp: string } {
	const year = date.getFullYear();
	const month = pad2(date.getMonth() + 1);
	const day = pad2(date.getDate());
	const hours = pad2(date.getHours());
	const minutes = pad2(date.getMinutes());
	const seconds = pad2(date.getSeconds());
	return {
		filenameStamp: `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`,
		displayStamp: `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`,
	};
}

export function buildPlanFilename(date: Date): string {
	const { filenameStamp } = formatPlanTimestamp(date);
	return `plan-${filenameStamp}.md`;
}

function markdownCheckbox(status: PlanStepStatus): string {
	switch (status) {
		case "completed":
			return "[x]";
		case "in_progress":
			return "[-]";
		case "skipped":
			return "[~]";
		case "pending":
			return "[ ]";
	}
}

export function formatPlanMarkdown(options: {
	title?: string;
	summary?: string;
	createdAt?: string;
	phase: PlanModePhase | "completed";
	steps: readonly PlanStep[];
}): string {
	const stats = getPlanStats(options.steps);
	const heading = options.title?.trim() || "Plan";
	const lines: string[] = [
		`# ${heading}`,
		"",
	];

	if (options.createdAt) {
		lines.push(`- Created: ${options.createdAt}`);
	}
	lines.push(`- Status: ${options.phase}`);
	lines.push(`- Progress: ${stats.done}/${stats.total}`);

	if (options.summary?.trim()) {
		lines.push("", "## Summary", "", options.summary.trim());
	}

	lines.push("", "## Steps", "");

	for (const step of options.steps) {
		const statusSuffix = step.status === "skipped" ? " (skipped)" : step.status === "in_progress" ? " (in progress)" : "";
		lines.push(`${step.id}. ${markdownCheckbox(step.status)} ${step.title}${statusSuffix}`);
		if (step.details) {
			lines.push(`   - Details: ${step.details}`);
		}
		if (step.note) {
			lines.push(`   - Note: ${step.note}`);
		}
	}

	lines.push("");
	return lines.join("\n");
}

export function formatStepsForContext(steps: readonly PlanStep[]): string {
	return steps
		.map((step) => {
			let line = `${step.id}. [${step.status}] ${step.title}`;
			if (step.details) line += `\n   Details: ${step.details}`;
			if (step.note) line += `\n   Note: ${step.note}`;
			return line;
		})
		.join("\n");
}

// ─── Context Filtering ──────────────────────────────────────────────────────

export function filterStaleContextMessages<T extends { customType?: string }>(
	messages: readonly T[],
	planModeEnabled: boolean,
	executionMode: boolean,
): T[] {
	return messages.filter((msg) => {
		if (!planModeEnabled && msg.customType === PLAN_MODE_CONTEXT_TYPE) {
			return false;
		}
		if (!executionMode && msg.customType === PLAN_EXECUTION_CONTEXT_TYPE) {
			return false;
		}
		return true;
	});
}
