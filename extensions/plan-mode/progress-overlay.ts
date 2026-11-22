/**
 * Centered floating popup overlay for inspecting plan mode state and step progress.
 * Triggered by /todos and /plan-progress.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	decodeKittyPrintable,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type TUI,
} from "@earendil-works/pi-tui";
import {
	getPlanStats,
	type PlanModePhase,
	type PlanStep,
	type PlanStepStatus,
} from "./utils";

export interface PlanOverlaySnapshot {
	phase: PlanModePhase;
	title?: string;
	summary?: string;
	planFileDisplay?: string;
	steps: readonly PlanStep[];
}

function padRight(text: string, targetWidth: number): string {
	const w = visibleWidth(text);
	if (w >= targetWidth) {
		return truncateToWidth(text, targetWidth, "");
	}
	return text + " ".repeat(targetWidth - w);
}

function wrapWithIndent(
	prefix: string,
	body: string,
	width: number,
	continuationIndent?: string,
): string[] {
	const prefixWidth = visibleWidth(prefix);
	if (prefixWidth >= width) {
		return [truncateToWidth(prefix + body, width)];
	}
	const cont = continuationIndent ?? " ".repeat(prefixWidth);
	const contWidth = visibleWidth(cont);
	const firstWidth = Math.max(1, width - prefixWidth);
	const wrappedFirst = wrapTextWithAnsi(body, firstWidth);
	if (wrappedFirst.length <= 1) {
		return [prefix + (wrappedFirst[0] ?? "")];
	}

	const lines: string[] = [prefix + wrappedFirst[0]!];
	const restText = wrappedFirst.slice(1).join(" ");
	const contAvail = Math.max(1, width - contWidth);
	for (const line of wrapTextWithAnsi(restText, contAvail)) {
		lines.push(cont + line);
	}
	return lines;
}

export class PlanProgressOverlay implements Component {
	private scrollOffset = 0;
	private maxScroll = 0;
	private lastBodyViewport = 10;
	private cachedKey?: string;
	private cachedLines?: string[];

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly snapshot: PlanOverlaySnapshot,
		private readonly onClose: () => void,
	) {}

	handleInput(data: string): void {
		const decoded = decodeKittyPrintable(data) ?? data;

		if (
			matchesKey(data, "escape") ||
			matchesKey(data, "return") ||
			matchesKey(data, "ctrl+c") ||
			decoded === "q" ||
			decoded === "Q"
		) {
			this.onClose();
			return;
		}

		const halfPage = Math.max(1, Math.floor(this.lastBodyViewport / 2));
		let nextOffset = this.scrollOffset;

		if (decoded === "j" || matchesKey(data, "down")) {
			nextOffset += 1;
		} else if (decoded === "k" || matchesKey(data, "up")) {
			nextOffset -= 1;
		} else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) {
			nextOffset += halfPage;
		} else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) {
			nextOffset -= halfPage;
		} else if (decoded === "g" || matchesKey(data, "home")) {
			nextOffset = 0;
		} else if (decoded === "G" || matchesKey(data, "end")) {
			nextOffset = this.maxScroll;
		} else {
			return;
		}

		const clamped = Math.max(0, Math.min(this.maxScroll, nextOffset));
		if (clamped !== this.scrollOffset) {
			this.scrollOffset = clamped;
			this.cachedLines = undefined;
			this.tui.requestRender();
		}
	}

	invalidate(): void {
		this.cachedKey = undefined;
		this.cachedLines = undefined;
	}

	private renderPhaseBadge(): string {
		const th = this.theme;
		switch (this.snapshot.phase) {
			case "planning":
				return th.fg("warning", th.bold("PLANNING"));
			case "executing":
				return th.fg("accent", th.bold("EXECUTING"));
			case "idle":
				return th.fg("muted", "IDLE");
		}
	}

	private renderStatusMarker(status: PlanStepStatus): { icon: string; badge: string } {
		const th = this.theme;
		switch (status) {
			case "completed":
				return {
					icon: th.fg("success", "✓"),
					badge: th.fg("success", "[completed]"),
				};
			case "in_progress":
				return {
					icon: th.fg("accent", "◐"),
					badge: th.fg("accent", "[in_progress]"),
				};
			case "skipped":
				return {
					icon: th.fg("muted", "⊘"),
					badge: th.fg("muted", "[skipped]"),
				};
			case "pending":
				return {
					icon: th.fg("dim", "○"),
					badge: th.fg("dim", "[pending]"),
				};
		}
	}

	private buildBodyLines(contentWidth: number): string[] {
		const th = this.theme;
		const lines: string[] = [];

		if (this.snapshot.summary?.trim()) {
			for (const line of wrapTextWithAnsi(
				th.fg("muted", this.snapshot.summary.trim()),
				contentWidth,
			)) {
				lines.push(line);
			}
			lines.push("");
		}

		if (this.snapshot.steps.length === 0) {
			lines.push(th.fg("dim", "No plan steps recorded yet."));
			lines.push(th.fg("dim", "Run /plan to enter read-only planning mode."));
			return lines;
		}

		for (let i = 0; i < this.snapshot.steps.length; i++) {
			const step = this.snapshot.steps[i]!;
			const { icon, badge } = this.renderStatusMarker(step.status);
			const num = th.fg("accent", `${step.id}.`);
			const titleText =
				step.status === "completed"
					? th.fg("muted", th.strikethrough(step.title))
					: step.status === "skipped"
						? th.fg("dim", step.title)
						: step.status === "in_progress"
							? th.bold(th.fg("text", step.title))
							: th.fg("text", step.title);

			const prefix = `${icon} ${num} ${badge} `;
			lines.push(...wrapWithIndent(prefix, titleText, contentWidth, "    "));

			if (step.details) {
				lines.push(
					...wrapWithIndent(
						`    ${th.fg("dim", "Details: ")}`,
						th.fg("muted", step.details),
						contentWidth,
						"      ",
					),
				);
			}

			if (step.note) {
				lines.push(
					...wrapWithIndent(
						`    ${th.fg("warning", "Note: ")}`,
						th.fg("text", step.note),
						contentWidth,
						"      ",
					),
				);
			}

			if (i < this.snapshot.steps.length - 1) {
				lines.push("");
			}
		}

		return lines;
	}

	render(width: number): string[] {
		const boxWidth = Math.max(24, width);
		const innerWidth = Math.max(10, boxWidth - 4); // "│ " + content + " │"
		const termRows = Math.max(12, this.tui.terminal.rows || 24);
		const maxOverlayRows = Math.max(10, Math.floor(termRows * 0.8) - 2);

		const headerRows = this.snapshot.planFileDisplay ? 2 : 1;
		// top border (1) + headerRows + divider (1) + divider (1) + footer (1) + bottom border (1)
		const chromeRows = 5 + headerRows;
		const maxBodyViewport = Math.max(3, maxOverlayRows - chromeRows);

		const cacheKey = `${boxWidth}:${maxBodyViewport}:${this.scrollOffset}`;
		if (this.cachedLines && this.cachedKey === cacheKey) {
			return this.cachedLines;
		}

		const th = this.theme;
		const border = (text: string) => th.fg("borderAccent", text);
		const divider = (text: string) => th.fg("borderMuted", text);
		const panelLine = (line: string) => th.bg("customMessageBg", line);

		const stats = getPlanStats(this.snapshot.steps);
		const allBodyLines = this.buildBodyLines(innerWidth);
		const bodyViewport = Math.min(allBodyLines.length, maxBodyViewport);
		this.lastBodyViewport = Math.max(1, maxBodyViewport);
		this.maxScroll = Math.max(0, allBodyLines.length - maxBodyViewport);
		if (this.scrollOffset > this.maxScroll) {
			this.scrollOffset = this.maxScroll;
		}

		const visibleBody = allBodyLines.slice(
			this.scrollOffset,
			this.scrollOffset + bodyViewport,
		);

		const frameRow = (content: string): string => {
			const padded = padRight(content, innerWidth);
			return panelLine(`${border("│")} ${padded} ${border("│")}`);
		};

		const hRule = "─".repeat(boxWidth - 2);
		const topBorder = panelLine(border(`╭${hRule}╮`));
		const midDivider = panelLine(`${border("├")}${divider(hRule)}${border("┤")}`);
		const bottomBorder = panelLine(border(`╰${hRule}╯`));

		// Header row: title + mode badge on left, progress count on right
		const titleText = th.bold(th.fg("accent", this.snapshot.title?.trim() || "Plan Progress"));
		const modeBadge = this.renderPhaseBadge();
		const leftHeader = `${titleText}  ${modeBadge}`;
		const progressText = th.fg(
			stats.total > 0 && stats.done === stats.total ? "success" : "muted",
			`${stats.done}/${stats.total} done`,
		);
		const gap = Math.max(1, innerWidth - visibleWidth(leftHeader) - visibleWidth(progressText));
		const headerLine =
			visibleWidth(leftHeader) + 1 + visibleWidth(progressText) <= innerWidth
				? `${leftHeader}${" ".repeat(gap)}${progressText}`
				: truncateToWidth(`${leftHeader}  ${progressText}`, innerWidth);

		const lines: string[] = [topBorder, frameRow(headerLine)];

		if (this.snapshot.planFileDisplay) {
			lines.push(
				frameRow(
					truncateToWidth(
						`${th.fg("dim", "File: ")}${th.fg("muted", this.snapshot.planFileDisplay)}`,
						innerWidth,
					),
				),
			);
		}

		lines.push(midDivider);

		for (const bodyLine of visibleBody) {
			lines.push(frameRow(bodyLine));
		}

		lines.push(midDivider);

		// Footer row: key hints + scroll position when scrollable
		const canScroll = this.maxScroll > 0;
		const hints = canScroll
			? th.fg("dim", "j/k or ↑/↓ scroll · g/G top/bottom · Esc/q/Enter close")
			: th.fg("dim", "Esc / q / Enter to close");
		const scrollInfo = canScroll
			? th.fg(
					"muted",
					`${this.scrollOffset + 1}-${Math.min(allBodyLines.length, this.scrollOffset + bodyViewport)}/${allBodyLines.length}`,
				)
			: "";

		const footerLine =
			scrollInfo && visibleWidth(hints) + 2 + visibleWidth(scrollInfo) <= innerWidth
				? `${hints}${" ".repeat(innerWidth - visibleWidth(hints) - visibleWidth(scrollInfo))}${scrollInfo}`
				: truncateToWidth(scrollInfo ? `${scrollInfo}  ${hints}` : hints, innerWidth);

		lines.push(frameRow(footerLine));
		lines.push(bottomBorder);

		this.cachedKey = `${boxWidth}:${maxBodyViewport}:${this.scrollOffset}`;
		this.cachedLines = lines;
		return lines;
	}
}
