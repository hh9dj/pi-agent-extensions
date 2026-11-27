/**
 * deepseek-tier — publishes DeepSeek peak/off-peak pricing tier as a footer
 * status (`deepseekTier`) when a DeepSeek model is active.
 *
 * Optional config: ~/.pi/agent/deepseek-tier.json
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type Config = {
	enabled: boolean;
	peakWindowsUtc: [number, number][];
	labels: { peak: string; offPeak: string };
};

const STATUS_KEY = "deepseekTier";
const REFRESH_MS = 60_000;
const DEFAULTS: Config = {
	enabled: true,
	peakWindowsUtc: [[1, 4], [6, 10]],
	labels: { peak: "peak pricing", offPeak: "off-peak pricing" },
};

function loadConfig(): Config {
	try {
		const raw = JSON.parse(readFileSync(join(getAgentDir(), "deepseek-tier.json"), "utf8"));
		if (!raw || typeof raw !== "object") return DEFAULTS;
		return {
			enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
			peakWindowsUtc: Array.isArray(raw.peakWindowsUtc)
				? raw.peakWindowsUtc.filter(
						(w: unknown): w is [number, number] =>
							Array.isArray(w) && typeof w[0] === "number" && typeof w[1] === "number",
					)
				: DEFAULTS.peakWindowsUtc,
			labels: {
				peak: typeof raw.labels?.peak === "string" ? raw.labels.peak : DEFAULTS.labels.peak,
				offPeak:
					typeof raw.labels?.offPeak === "string" ? raw.labels.offPeak : DEFAULTS.labels.offPeak,
			},
		};
	} catch {
		return DEFAULTS;
	}
}

function isDeepseek(model: ExtensionContext["model"]): boolean {
	return Boolean(model && /deepseek/i.test(`${model.provider} ${model.id} ${model.name}`));
}

function isPeak(date: Date, windows: [number, number][]): boolean {
	const day = date.getUTCDay();
	if (day === 0 || day === 6) return false;
	const hour = date.getUTCHours();
	return windows.some(([start, end]) => hour >= start && hour < end);
}

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	if (!config.enabled) return;

	let timer: ReturnType<typeof setInterval> | undefined;
	const stop = () => {
		clearInterval(timer);
		timer = undefined;
	};

	const update = (ctx: ExtensionContext) => {
		if (!isDeepseek(ctx.model)) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const peak = isPeak(new Date(), config.peakWindowsUtc);
		const text = `🐋: ${peak ? config.labels.peak : config.labels.offPeak}`;
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(peak ? "error" : "muted", text));
	};

	pi.on("session_start", (_event, ctx) => {
		stop();
		update(ctx);
		if (ctx.hasUI) {
			timer = setInterval(() => update(ctx), REFRESH_MS);
			timer.unref?.();
		}
	});

	pi.on("model_select", (_event, ctx) => update(ctx));

	pi.on("session_shutdown", (_event, ctx) => {
		stop();
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
