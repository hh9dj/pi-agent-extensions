/**
 * subagent — isolated subprocess runner (`pi --mode json -p --no-session`).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { withFileMutationQueue, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents";
import {
	createEmptyUsage,
	getFinalOutput,
	getSubagentDepth,
	isRecord,
	recordMessage,
	SUBAGENT_DEPTH_ENV,
	toSubagentMessage,
	type OnUpdateCallback,
	type SingleResult,
	type SubagentDetails,
	type SubagentMessage,
} from "./runner-common";

export interface RunAgentOptions {
	agent: AgentConfig;
	task: string;
	cwd: string;
	step?: number;
	signal?: AbortSignal;
	onUpdate?: OnUpdateCallback;
	makeDetails: (results: SingleResult[]) => SubagentDetails;
	ctx: ExtensionContext;
}

async function writePromptToTempFile(
	agentName: string,
	prompt: string,
): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

export function parseJsonlEventMessage(line: string): SubagentMessage | null {
	const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
	if (!normalized.trim()) return null;

	let event: unknown;
	try {
		event = JSON.parse(normalized);
	} catch {
		return null;
	}

	if (!isRecord(event)) return null;
	if ((event.type === "message_end" || event.type === "tool_result_end") && event.message) {
		return toSubagentMessage(event.message);
	}
	return null;
}

export async function runSubprocessAgent(options: RunAgentOptions): Promise<SingleResult> {
	const { agent, task, cwd, step, signal, onUpdate, makeDetails, ctx } = options;

	if (signal?.aborted) {
		throw new Error("Subagent was aborted");
	}

	const inheritedModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	const inheritsDispatchConfig = !agent.model;
	const model = agent.model ?? inheritedModel;

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent.extensions === "none") {
		args.push("--no-extensions");
	} else if (Array.isArray(agent.extensions)) {
		args.push("--no-extensions");
		for (const extPath of agent.extensions) {
			args.push("-e", extPath);
		}
	}
	if (model) args.push("--model", model);
	if (inheritsDispatchConfig && ctx.thinkingLevel) {
		args.push("--thinking", ctx.thinkingLevel);
	}
	if (agent.tools && agent.tools.length > 0) {
		args.push("--tools", agent.tools.join(","));
	}

	const currentResult: SingleResult = {
		agent: agent.name,
		agentSource: agent.source,
		runtime: "subprocess",
		task,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: createEmptyUsage(),
		model,
		step,
	};

	const emitUpdate = () => {
		onUpdate?.({
			content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
			details: makeDetails([currentResult]),
		});
	};

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);
		emitUpdate();

		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					[SUBAGENT_DEPTH_ENV]: String(getSubagentDepth() + 1),
				},
			});

			const decoder = new StringDecoder("utf8");
			let buffer = "";
			let killTimer: ReturnType<typeof setTimeout> | undefined;

			const processLine = (line: string) => {
				const msg = parseJsonlEventMessage(line);
				if (!msg) return;
				recordMessage(currentResult, msg);
				emitUpdate();
			};

			const killProc = () => {
				wasAborted = true;
				proc.kill("SIGTERM");
				killTimer = setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
				killTimer.unref?.();
			};

			const cleanup = () => {
				if (killTimer) {
					clearTimeout(killTimer);
					killTimer = undefined;
				}
				signal?.removeEventListener("abort", killProc);
			};

			proc.stdout.on("data", (chunk: Buffer) => {
				buffer += decoder.write(chunk);
				let newlineIdx = buffer.indexOf("\n");
				while (newlineIdx !== -1) {
					const line = buffer.slice(0, newlineIdx);
					buffer = buffer.slice(newlineIdx + 1);
					processLine(line);
					newlineIdx = buffer.indexOf("\n");
				}
			});

			proc.stderr.on("data", (chunk: Buffer) => {
				currentResult.stderr += chunk.toString("utf8");
			});

			proc.on("close", (code) => {
				cleanup();
				buffer += decoder.end();
				if (buffer.length > 0) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", (err) => {
				cleanup();
				if (!currentResult.stderr) currentResult.stderr = err.message;
				resolve(1);
			});

			if (signal) {
				if (signal.aborted) {
					killProc();
				} else {
					signal.addEventListener("abort", killProc, { once: true });
				}
			}
		});

		currentResult.exitCode = exitCode;
		if (wasAborted) {
			currentResult.stopReason = "aborted";
			throw new Error("Subagent was aborted");
		}
		return currentResult;
	} finally {
		if (tmpPromptPath) {
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				// Ignore cleanup errors.
			}
		}
		if (tmpPromptDir) {
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				// Ignore cleanup errors.
			}
		}
	}
}
