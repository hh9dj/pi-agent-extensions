/**
 * Persist plan Markdown snapshots under `<repoRoot>/.plan/plan-{date-time}.md`.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import {
	buildPlanFilename,
	formatPlanMarkdown,
	formatPlanTimestamp,
	type PlanModePhase,
	type PlanStep,
} from "./utils";

const execFileAsync = promisify(execFile);

export const PLAN_DIR_NAME = ".plan";

export async function resolveRepoRoot(cwd: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			timeout: 2000,
		});
		const root = stdout.trim();
		return root.length > 0 ? root : cwd;
	} catch {
		return cwd;
	}
}

export interface SavePlanFileOptions {
	cwd: string;
	existingPath?: string;
	title?: string;
	summary?: string;
	createdAt?: string;
	phase: PlanModePhase | "completed";
	steps: readonly PlanStep[];
}

export interface SavePlanFileResult {
	filePath: string;
	relativePath: string;
	createdAt: string;
}

export async function savePlanMarkdownFile(
	options: SavePlanFileOptions,
): Promise<SavePlanFileResult> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const now = new Date();
	const createdAt = options.createdAt ?? formatPlanTimestamp(now).displayStamp;

	const filePath =
		options.existingPath ?? join(repoRoot, PLAN_DIR_NAME, buildPlanFilename(now));

	await mkdir(dirname(filePath), { recursive: true });

	const markdown = formatPlanMarkdown({
		title: options.title,
		summary: options.summary,
		createdAt,
		phase: options.phase,
		steps: options.steps,
	});

	await writeFile(filePath, markdown, "utf8");

	const rel = relative(repoRoot, filePath);
	return {
		filePath,
		relativePath: rel && !rel.startsWith("..") ? rel : filePath,
		createdAt,
	};
}
