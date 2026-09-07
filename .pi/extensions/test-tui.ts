import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

class TestTuiPanel implements Component {
    private readonly tabs = ["Type", "About"];
    private activeTab = 0;
    private cached: string[] | undefined;
    private readonly input = new Input();

    constructor(
        private readonly tui: TUI,
        private readonly theme: Theme,
        private readonly done: (value: string | null) => void,
    ) {
        this.input.focused = true;
        this.input.onSubmit = (value) => this.done(value.trim() || null);
        this.input.onEscape = () => this.done(null);
    }

    handleInput(data: string): void {
        if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
            this.switchTab(1);
            return;
        }
        if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
            this.switchTab(-1);
            return;
        }
        if (this.activeTab === 0) {
            this.input.handleInput(data);
            this.refresh();
            return;
        }
        if (data === "h") {
            this.switchTab(-1);
            return;
        }
        if (data === "l") {
            this.switchTab(1);
        }
    }

    render(width: number): string[] {
        if (this.cached) return this.cached;

        const lines: string[] = [];
        const w = Math.max(4, width);
        const border = (s: string) => this.theme.fg("accent", s);

        lines.push(border(`┌${"─".repeat(w - 2)}┐`));
        lines.push(`${border("│")} ${this.renderTabBar(w - 4)} ${border("│")}`);
        lines.push(border(`├${"─".repeat(w - 2)}┤`));
        for (const line of this.renderBody(w)) {
            lines.push(`${border("│")} ${line} ${border("│")}`);
        }
        lines.push(border(`└${"─".repeat(w - 2)}┘`));

        this.cached = lines;
        return lines;
    }

    invalidate(): void {
        this.cached = undefined;
    }

    private refresh(): void {
        this.cached = undefined;
        this.tui.requestRender();
    }

    private switchTab(delta: number): void {
        this.activeTab =
            (this.activeTab + delta + this.tabs.length) % this.tabs.length;
        this.refresh();
    }

    private renderTabBar(width: number): string {
        const separator = this.theme.fg("dim", "│");
        const rendered = this.tabs
            .map((tab, i) => {
                const label = ` ${tab} `;
                return i === this.activeTab
                    ? this.theme.bg("selectedBg", this.theme.fg("text", label))
                    : this.theme.fg("muted", label);
            })
            .join(separator);
        return pad(rendered, width);
    }

    private renderBody(width: number): string[] {
        if (this.activeTab === 1) {
            return [
                pad(this.theme.fg("dim", "Tab/←→ switch • Esc cancel"), width),
            ];
        }
        return this.input
            .render(Math.max(1, width))
            .map((line) => pad(line, width));
    }
}

function pad(text: string, padTo: number): string {
    return text + " ".repeat(Math.max(0, padTo - visibleWidth(text)));
}

export default function testTui(pi: ExtensionAPI) {
    pi.registerCommand("test-tui", {
        description: "Render a tabbed text-input TUI panel in the editor area",
        handler: async (_args, ctx) => {
            if (ctx.mode !== "tui") {
                ctx.ui.notify("test-tui needs an interactive TUI", "warning");
                return;
            }

            const result = await ctx.ui.custom<string | null>(
                (tui, theme, _keybindings, done) =>
                    new TestTuiPanel(tui, theme, done),
            );

            if (result === null) {
                ctx.ui.notify("cancelled", "info");
            } else {
                ctx.ui.notify(`you typed: ${result}`, "info");
            }
        },
    });
}
