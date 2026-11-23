/**
 * subagent — multi-tier agent discovery with bundled, user, and project definitions.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentRuntime } from "./schemas";

export type AgentSource = "builtin" | "bundled" | "user" | "project" | "unknown";
export type AgentExtensionsConfig = "all" | "none" | string[];

export interface AgentConfig {
	name: string;
	description: string;
	runtime: AgentRuntime;
	tools?: string[];
	model?: string;
	extensions?: AgentExtensionsConfig;
	systemPrompt: string;
	source: Exclude<AgentSource, "unknown">;
	filePath?: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	bundledAgentsDir: string;
	userAgentsDir: string;
	projectAgentsDir: string | null;
}

export const DEFAULT_AGENT_NAME = "worker";

const FALLBACK_WORKER_AGENT: AgentConfig = {
	name: DEFAULT_AGENT_NAME,
	description: "General-purpose sub-agent with isolated context and default tools",
	runtime: "subprocess",
	systemPrompt: [
		"You are a general-purpose sub-agent operating in an isolated context window.",
		"Complete the assigned task autonomously and return a clear, concise summary of what you found or changed.",
	].join("\n"),
	source: "builtin",
};

type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	runtime?: unknown;
	tools?: unknown;
	model?: unknown;
	extensions?: unknown;
};

function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function normalizeExtensionEntry(entry: string, baseDir?: string): string {
	const trimmed = entry.trim();
	const lower = trimmed.toLowerCase();
	if (lower === "codemode" || lower === "builtin:codemode") return "builtin:codemode";
	if (lower === "mcp" || lower === "builtin:mcp") return "builtin:mcp";
	if (lower === "tool_search" || lower === "tool-search" || lower === "builtin:tool-search") {
		return "builtin:tool-search";
	}
	if (trimmed.startsWith("builtin:") || trimmed.startsWith("npm:") || trimmed.startsWith("git:")) {
		return trimmed;
	}
	if (trimmed === "~") return os.homedir();
	if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
	if ((trimmed.startsWith("./") || trimmed.startsWith("../")) && baseDir) {
		return path.resolve(baseDir, trimmed);
	}
	return trimmed;
}

function parseExtensions(value: unknown, baseDir?: string): AgentExtensionsConfig | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "boolean") return value ? "all" : "none";
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (!normalized) return undefined;
		if (normalized === "all" || normalized === "true") return "all";
		if (normalized === "none" || normalized === "false") return "none";
		const list = value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean)
			.map((item) => normalizeExtensionEntry(item, baseDir));
		return list.length > 0 ? list : undefined;
	}
	if (Array.isArray(value)) {
		const list = value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter(Boolean)
			.map((item) => normalizeExtensionEntry(item, baseDir));
		return list.length > 0 ? list : "none";
	}
	return undefined;
}

function parseRuntime(value: unknown): AgentRuntime {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "in-process" || normalized === "inprocess" || normalized === "sdk") {
			return "in-process";
		}
		if (normalized === "subprocess" || normalized === "isolated" || normalized === "process") {
			return "subprocess";
		}
	}
	return "subprocess";
}

function isDirectory(dirPath: string): boolean {
	try {
		return fs.statSync(dirPath).isDirectory();
	} catch {
		return false;
	}
}

function loadAgentsFromDir(dir: string, source: "bundled" | "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];
	if (!isDirectory(dir)) return agents;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	entries.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		let parsed: { frontmatter: AgentFrontmatter; body: string };
		try {
			parsed = parseFrontmatter<AgentFrontmatter>(content);
		} catch {
			continue;
		}

		const { frontmatter, body } = parsed;
		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
			continue;
		}

		const name = frontmatter.name.trim();
		const description = frontmatter.description.trim();
		if (!name || !description) continue;

		const model =
			typeof frontmatter.model === "string" && frontmatter.model.trim().length > 0
				? frontmatter.model.trim()
				: undefined;

		agents.push({
			name,
			description,
			runtime: parseRuntime(frontmatter.runtime),
			tools: parseToolList(frontmatter.tools),
			model,
			extensions: parseExtensions(frontmatter.extensions, path.dirname(filePath)),
			systemPrompt: body.trim(),
			source,
			filePath,
		});
	}

	return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = path.resolve(cwd);
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function getBundledAgentsDir(): string {
	return path.join(__dirname, "agents");
}

export function discoverAgents(cwd: string, includeProjectAgents: boolean): AgentDiscoveryResult {
	const bundledAgentsDir = getBundledAgentsDir();
	const userAgentsDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = includeProjectAgents ? findNearestProjectAgentsDir(cwd) : null;

	const bundledAgents = loadAgentsFromDir(bundledAgentsDir, "bundled");
	const userAgents = loadAgentsFromDir(userAgentsDir, "user");
	const projectAgents = projectAgentsDir ? loadAgentsFromDir(projectAgentsDir, "project") : [];

	const agentMap = new Map<string, AgentConfig>();
	agentMap.set(FALLBACK_WORKER_AGENT.name, FALLBACK_WORKER_AGENT);
	for (const agent of bundledAgents) agentMap.set(agent.name, agent);
	for (const agent of userAgents) agentMap.set(agent.name, agent);
	for (const agent of projectAgents) agentMap.set(agent.name, agent);

	const agents = Array.from(agentMap.values()).sort((a, b) => a.name.localeCompare(b.name));

	return {
		agents,
		bundledAgentsDir,
		userAgentsDir,
		projectAgentsDir,
	};
}

export function formatAvailableAgents(agents: AgentConfig[]): string {
	if (agents.length === 0) return "none";
	return agents.map((a) => `${a.name} (${a.source}, ${a.runtime})`).join(", ");
}
