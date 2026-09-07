import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export class LineWriter {
    readonly lines: string[] = [];

    constructor(private readonly width: number) {}

    add(text: string): void {
        this.lines.push(...wrapTextWithAnsi(text, this.width));
    }

    addWithPrefix(prefix: string, text: string): void {
        const prefixWidth = visibleWidth(prefix);
        if (prefixWidth >= this.width) {
            this.add(prefix + text);
            return;
        }
        const wrapped = wrapTextWithAnsi(text, this.width - prefixWidth);
        const continuation = " ".repeat(prefixWidth);
        wrapped.forEach((line, i) => {
            this.lines.push(i === 0 ? prefix + line : continuation + line);
        });
    }
}
