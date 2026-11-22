/**
 * Zentui + native footer indicator synchronization.
 *
 * Publishes distinct planning vs executing indicators across:
 * 1. Zentui Working line (`zentui:working-line-segment` v1, key `plan-mode:state`)
 *    — automatically displayed when Zentui's working line is enabled.
 * 2. Zentui Custom variable (`zentui:variable` v1, key `plan-mode:status`)
 *    — active when referenced by a Minimalist/Opencode editor or Starship template;
 *    suppresses the duplicate footer status while active.
 * 3. Pi footer status (`ctx.ui.setStatus("plan-mode", ...)`)
 *    — rendered by Zentui's Starship/Hidden footer and Pi's native footer.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPlanStats, type PlanModePhase, type PlanStep } from "./utils";

export const PLAN_STATUS_KEY = "plan-mode";
export const ZENTUI_WORKING_LINE_CAPABILITY_EVENT = "zentui:working-line-segment-capability";
export const ZENTUI_WORKING_LINE_EVENT = "zentui:working-line-segment";
export const ZENTUI_WORKING_LINE_KEY = "plan-mode:state";

export const ZENTUI_VARIABLE_CAPABILITY_EVENT = "zentui:variable-capability";
export const ZENTUI_VARIABLE_EVENT = "zentui:variable";
export const ZENTUI_VARIABLE_KEY = "plan-mode:status";

interface ZentuiCapabilityProbe {
	supported: boolean;
	active: boolean;
	key?: string;
	version?: number;
}

export function formatFooterStatusText(
	ctx: ExtensionContext,
	phase: PlanModePhase,
	steps: readonly PlanStep[],
): string | undefined {
	if (phase === "planning") {
		const label = steps.length > 0 ? `⏸ plan (${steps.length})` : "⏸ plan";
		return ctx.ui.theme.fg("warning", label);
	}
	if (phase === "executing") {
		const stats = getPlanStats(steps);
		return ctx.ui.theme.fg("accent", `▶ plan ${stats.done}/${stats.total}`);
	}
	return undefined;
}

export function formatWorkingLineText(
	phase: PlanModePhase,
	steps: readonly PlanStep[],
): string | undefined {
	if (phase === "planning") {
		return steps.length > 0 ? `planning (${steps.length} steps)` : "planning";
	}
	if (phase === "executing") {
		const stats = getPlanStats(steps);
		return `executing ${stats.done}/${stats.total}`;
	}
	return undefined;
}

export function syncPlanIndicators(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	phase: PlanModePhase,
	steps: readonly PlanStep[],
): void {
	const statusText = formatFooterStatusText(ctx, phase, steps);
	const workingText = formatWorkingLineText(phase, steps);

	// 1. Custom variable (editor metadata or Starship custom template) vs footer status
	const varProbe: ZentuiCapabilityProbe = {
		supported: false,
		active: false,
		key: ZENTUI_VARIABLE_KEY,
	};
	pi.events.emit(ZENTUI_VARIABLE_CAPABILITY_EVENT, varProbe);

	if (varProbe.active) {
		pi.events.emit(ZENTUI_VARIABLE_EVENT, {
			key: ZENTUI_VARIABLE_KEY,
			text: statusText,
		});
		ctx.ui.setStatus(PLAN_STATUS_KEY, undefined);
	} else {
		if (varProbe.supported) {
			pi.events.emit(ZENTUI_VARIABLE_EVENT, {
				key: ZENTUI_VARIABLE_KEY,
				text: undefined,
			});
		}
		ctx.ui.setStatus(PLAN_STATUS_KEY, statusText);
	}

	// 2. Zentui Working line segment (plain text so Zentui owns animation/colors)
	const workingProbe: ZentuiCapabilityProbe = {
		supported: false,
		active: false,
	};
	pi.events.emit(ZENTUI_WORKING_LINE_CAPABILITY_EVENT, workingProbe);

	if (workingProbe.active) {
		pi.events.emit(ZENTUI_WORKING_LINE_EVENT, {
			key: ZENTUI_WORKING_LINE_KEY,
			text: workingText,
		});
	} else if (workingProbe.supported && workingText === undefined) {
		pi.events.emit(ZENTUI_WORKING_LINE_EVENT, {
			key: ZENTUI_WORKING_LINE_KEY,
			text: undefined,
		});
	}
}

export function clearPlanIndicators(pi: ExtensionAPI, ctx: ExtensionContext): void {
	ctx.ui.setStatus(PLAN_STATUS_KEY, undefined);
	pi.events.emit(ZENTUI_VARIABLE_EVENT, {
		key: ZENTUI_VARIABLE_KEY,
		text: undefined,
	});
	pi.events.emit(ZENTUI_WORKING_LINE_EVENT, {
		key: ZENTUI_WORKING_LINE_KEY,
		text: undefined,
	});
}
