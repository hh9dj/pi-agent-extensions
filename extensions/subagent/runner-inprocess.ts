/**
 * subagent — in-process SDK runner using `createAgentSession()`.
 *
 * Inherits registered custom providers from the parent session's ModelRuntime
 * (so provider extensions such as `npm:pi-antigravity` work even when
 * `noExtensions: true`) and attaches `builtin:codemode` by default.
 */

import * as path from "node:path";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	type ExtensionContext,
	type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { AgentExtensionsConfig } from "./agents";
import {
	createEmptyUsage,
	getFinalOutput,
	recordMessage,
	toSubagentMessage,
	type SingleResult,
} from "./runner-common";
import type { RunAgentOptions } from "./runner-subprocess";

type ResolvedModel = NonNullable<ExtensionContext["model"]>;

interface BuiltinExtensionFactories {
	createCodemodeExtension?: (options?: { mode?: "on" | "only" }) => InlineExtension;
	createMcpExtension?: () => InlineExtension;
	createToolSearchExtension?: () => InlineExtension;
}

function getBuiltinFactories(): BuiltinExtensionFactories {
	return piCodingAgent as unknown as BuiltinExtensionFactories;
}

function resolveModelBySpec(spec: string, ctx: ExtensionContext): ResolvedModel | undefined {
	const trimmed = spec.trim();
	const registry = ctx.modelRegistry;
	if (!trimmed || !registry) return undefined;

	const slashIdx = trimmed.indexOf("/");
	if (slashIdx > 0) {
		const provider = trimmed.slice(0, slashIdx);
		const modelId = trimmed.slice(slashIdx + 1);
		const exact = registry.find(provider, modelId);
		if (exact) return exact;
	}

	const allModels = registry.getAll();
	const exactId = allModels.find((m) => m.id === trimmed || `${m.provider}/${m.id}` === trimmed);
	if (exactId) return exactId;

	const lower = trimmed.toLowerCase();
	return allModels.find(
		(m) => m.id.toLowerCase() === lower || `${m.provider}/${m.id}`.toLowerCase() === lower,
	);
}

async function resolveChildModelRuntime(
	ctx: ExtensionContext,
	agentDir: string,
): Promise<ModelRuntime | undefined> {
	const registry = ctx.modelRegistry;
	if (!registry) return undefined;

	// Prefer the parent session's live ModelRuntime so extension-registered
	// providers, OAuth tokens, and runtime API keys work without reloading
	// interactive extensions. AgentSession.dispose() does not mutate it.
	const parentRuntime = (registry as unknown as { runtime?: ModelRuntime }).runtime;
	if (parentRuntime) {
		return parentRuntime;
	}

	// Fallback for custom/mocked ModelRegistry implementations: build a fresh
	// runtime and mirror any extension-registered providers through public APIs.
	const providerIds = registry.getRegisteredProviderIds?.() ?? [];
	if (providerIds.length === 0) return undefined;

	const runtime = await ModelRuntime.create({
		authPath: path.join(agentDir, "auth.json"),
		modelsPath: path.join(agentDir, "models.json"),
	});
	for (const providerId of providerIds) {
		const nativeProvider = registry.getRegisteredNativeProvider(providerId);
		if (nativeProvider) {
			runtime.registerNativeProvider(nativeProvider);
			continue;
		}
		const config = registry.getRegisteredProviderConfig(providerId);
		if (config) {
			runtime.registerProvider(providerId, config);
		}
	}
	return runtime;
}

interface ResolvedInProcessExtensions {
	noExtensions: boolean;
	extensionFactories: InlineExtension[];
	additionalExtensionPaths: string[];
	shouldBindExtensions: boolean;
}

function resolveInProcessExtensions(
	extensions: AgentExtensionsConfig | undefined,
): ResolvedInProcessExtensions {
	const factories = getBuiltinFactories();
	const codemodeFactory = factories.createCodemodeExtension?.({ mode: "on" });

	// Default for in-process agents: keep user extensions disabled for fast,
	// side-effect-free runs, while attaching built-in codemode.
	if (extensions === undefined) {
		return {
			noExtensions: true,
			extensionFactories: codemodeFactory ? [codemodeFactory] : [],
			additionalExtensionPaths: [],
			shouldBindExtensions: false,
		};
	}

	if (extensions === "none") {
		return {
			noExtensions: true,
			extensionFactories: [],
			additionalExtensionPaths: [],
			shouldBindExtensions: false,
		};
	}

	if (extensions === "all") {
		return {
			noExtensions: false,
			extensionFactories: codemodeFactory ? [codemodeFactory] : [],
			additionalExtensionPaths: [],
			shouldBindExtensions: true,
		};
	}

	const extensionFactories: InlineExtension[] = [];
	const additionalExtensionPaths: string[] = [];
	let shouldBindExtensions = false;

	for (const entry of extensions) {
		if (entry === "builtin:codemode") {
			if (codemodeFactory) extensionFactories.push(codemodeFactory);
			continue;
		}
		if (entry === "builtin:mcp") {
			const mcpFactory = factories.createMcpExtension?.();
			if (mcpFactory) {
				extensionFactories.push(mcpFactory);
				shouldBindExtensions = true;
			}
			continue;
		}
		if (entry === "builtin:tool-search") {
			const tsFactory = factories.createToolSearchExtension?.();
			if (tsFactory) extensionFactories.push(tsFactory);
			continue;
		}
		additionalExtensionPaths.push(entry);
		shouldBindExtensions = true;
	}

	return {
		noExtensions: true,
		extensionFactories,
		additionalExtensionPaths,
		shouldBindExtensions,
	};
}

export async function runInProcessAgent(options: RunAgentOptions): Promise<SingleResult> {
	const { agent, task, cwd, step, signal, onUpdate, makeDetails, ctx } = options;

	if (signal?.aborted) {
		throw new Error("Subagent was aborted");
	}

	const inheritsDispatchConfig = !agent.model;
	let model: ResolvedModel | undefined = ctx.model;

	if (agent.model) {
		const resolved = resolveModelBySpec(agent.model, ctx);
		if (!resolved) {
			return {
				agent: agent.name,
				agentSource: agent.source,
				runtime: "in-process",
				task,
				exitCode: 1,
				messages: [],
				stderr: "",
				usage: createEmptyUsage(),
				model: agent.model,
				stopReason: "error",
				errorMessage: `Model "${agent.model}" not found in model registry for in-process agent "${agent.name}".`,
				step,
			};
		}
		model = resolved;
	}

	const modelLabel = model ? `${model.provider}/${model.id}` : agent.model;

	const currentResult: SingleResult = {
		agent: agent.name,
		agentSource: agent.source,
		runtime: "in-process",
		task,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: createEmptyUsage(),
		model: modelLabel,
		step,
	};

	const emitUpdate = () => {
		onUpdate?.({
			content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
			details: makeDetails([currentResult]),
		});
	};

	const agentDir = getAgentDir();
	const extConfig = resolveInProcessExtensions(agent.extensions);
	const modelRuntime = await resolveChildModelRuntime(ctx, agentDir);

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		noExtensions: extConfig.noExtensions,
		extensionFactories: extConfig.extensionFactories.length > 0 ? extConfig.extensionFactories : undefined,
		additionalExtensionPaths:
			extConfig.additionalExtensionPaths.length > 0 ? extConfig.additionalExtensionPaths : undefined,
		noThemes: true,
		noPromptTemplates: true,
		appendSystemPromptOverride: agent.systemPrompt.trim()
			? (base) => [...base, agent.systemPrompt]
			: undefined,
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		cwd,
		agentDir,
		modelRuntime,
		model,
		thinkingLevel: inheritsDispatchConfig ? ctx.thinkingLevel : undefined,
		tools: agent.tools && agent.tools.length > 0 ? agent.tools : undefined,
		excludeTools: ["subagent"],
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
	});

	if (extConfig.shouldBindExtensions) {
		await session.bindExtensions({});
	}

	let wasAborted = false;
	const onAbort = () => {
		wasAborted = true;
		void session.abort();
	};

	const unsubscribe = session.subscribe((event) => {
		if (event.type === "message_end" && "message" in event && event.message) {
			const msg = toSubagentMessage(event.message);
			if (!msg) return;
			recordMessage(currentResult, msg);
			emitUpdate();
		}
	});

	if (signal) {
		if (signal.aborted) {
			onAbort();
		} else {
			signal.addEventListener("abort", onAbort, { once: true });
		}
	}

	emitUpdate();

	try {
		await session.prompt(`Task: ${task}`);
	} catch (err) {
		if (!wasAborted) {
			currentResult.exitCode = 1;
			currentResult.stopReason = "error";
			currentResult.errorMessage = err instanceof Error ? err.message : String(err);
			return currentResult;
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
		unsubscribe();
		session.dispose();
	}

	if (wasAborted || currentResult.stopReason === "aborted") {
		currentResult.exitCode = 1;
		currentResult.stopReason = "aborted";
		throw new Error("Subagent was aborted");
	}

	currentResult.exitCode = currentResult.stopReason === "error" ? 1 : 0;
	return currentResult;
}
